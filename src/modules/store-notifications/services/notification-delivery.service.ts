import { Prisma, type OutboxJobs } from '@prisma/client';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { digest } from '../../../utils/crypto.js';
import { type TemplateValue } from '../../../shared/templates/template-values.js';
import {
  renderRichTemplate,
  type RichTemplateValues,
} from '../../../shared/templates/rich-template.js';
import { types } from '../store-notifications.validation.js';
import {
  StoreNotificationSettings,
  getStoreIntegration,
} from './store-notifications-support.service.js';

export async function scheduleStoreNotifications(
  tx: Prisma.TransactionClient,
  provider: string,
  store: any,
  order: any,
  previous: any,
  topic: string,
) {
  const setting = (store.data as any)?.nodeNotifications as StoreNotificationSettings | undefined;
  if (!setting?.enabled) return;
  const selected: string[] = [];
  if (topic.endsWith('create') || topic === 'order.created') selected.push('order_confirmation');
  if (provider === 'shopify') {
    if (order.financialStatus === 'paid' && previous?.financialStatus !== 'paid')
      selected.push('payment_confirmation');
    if (order.fulfillmentStatus === 'fulfilled' && previous?.fulfillmentStatus !== 'fulfilled')
      selected.push('shipment_tracking');
    if (order.status === 'cancelled' && previous?.status !== 'cancelled')
      selected.push('order_cancelled');
    if (order.financialStatus === 'refunded' && previous?.financialStatus !== 'refunded')
      selected.push('refund_processed');
  } else if (previous?.status !== order.status) {
    const map: Record<string, string> = {
      processing: 'order_processing',
      completed: 'order_completed',
      'on-hold': 'order_on_hold',
      cancelled: 'order_cancelled',
      refunded: 'refund_processed',
      failed: 'order_failed',
    };
    if (map[order.status]) selected.push(map[order.status]);
    if (
      ['processing', 'completed'].includes(order.status) &&
      !['processing', 'completed'].includes(previous?.status)
    )
      selected.push('payment_confirmation');
  }
  for (const type of [...new Set(selected)]) {
    if (!setting.rules.some((rule) => rule.type === type)) continue;
    const dedupeKey = `store-notification:${provider}:${store.id}:${order.id}:${type}`;
    await tx.outboxJobs.upsert({
      where: { dedupeKey },
      create: {
        vendorId: store.vendorId,
        kind: 'store-notification',
        dedupeKey,
        payload: { provider, integrationId: store.id, orderId: order.id, type },
      },
      update: {},
    });
  }
}

export async function queueStoreNotification(job: OutboxJobs) {
  const p = job.payload as any;
  if (!['shopify', 'woocommerce'].includes(p.provider) || !types.includes(p.type) || !job.vendorId)
    throw new ApiError(400, 'INVALID_STORE_NOTIFICATION', 'Invalid store notification');
  await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`store-notification:${job.id}`},0))`;
      const receiptKey = `store-notification:${job.id}`;
      if (await tx.webhookReceipts.findUnique({ where: { eventKey: receiptKey } })) return;
      const store = await getStoreIntegration(tx, job.vendorId!, p.provider, p.integrationId),
        setting = (store.data as any)?.nodeNotifications as StoreNotificationSettings | undefined;
      const order =
        p.provider === 'shopify'
          ? await tx.shopifyOrders.findFirst({
              where: { id: p.orderId, vendorId: job.vendorId!, shopifyIntegrationsId: store.id },
            })
          : await tx.woocommerceOrders.findFirst({
              where: {
                id: p.orderId,
                vendorId: job.vendorId!,
                woocommerceIntegrationsId: store.id,
              },
            });
      const rule = setting?.enabled
        ? setting.rules.find((rule) => rule.type === p.type)
        : undefined;
      const cancel = async () => {
        await tx.webhookReceipts.create({
          data: {
            provider: 'store-notification',
            eventKey: receiptKey,
            payload: { cancelled: true },
            processedAt: new Date(),
          },
        });
      };
      if (!store.isActive || !order || !rule) {
        await cancel();
        return;
      }
      if (order.status === 'cancelled' && p.type !== 'order_cancelled') {
        await cancel();
        return;
      }
      if (
        !(await tx.integrationCredentials.findUnique({
          where: {
            vendorId_provider_externalId: {
              vendorId: job.vendorId!,
              provider: 'whatsapp',
              externalId: setting!.phoneNumberId,
            },
          },
        }))
      )
        throw new ApiError(
          503,
          'STORE_PHONE_NOT_CONFIGURED',
          'Store notification sender is disconnected',
        );
      const raw = (
        p.provider === 'shopify' ? (order as any).data : (order as any).orderData
      ) as any;
      const customer = raw?.customer ?? {},
        billing = raw?.billing_address ?? raw?.billing ?? {};
      const phone = String(
        (order as any).phone ?? billing.phone ?? raw?.shipping_address?.phone ?? '',
      ).replace(/[\s()+.-]/g, '');
      if (!/^[1-9]\d{4,19}$/.test(phone))
        throw new ApiError(
          409,
          'STORE_CUSTOMER_PHONE_REQUIRED',
          'Order needs an international customer phone number',
        );
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`store-contact:${job.vendorId}:${setting!.phoneNumberId}:${phone}`},0))`;
      let contact = await tx.contacts.findFirst({
        where: {
          vendorId: job.vendorId!,
          waId: phone,
          wabPhoneNumberId: setting!.phoneNumberId,
          OR: [{ platform: 'whatsapp' }, { platform: null }],
        },
        orderBy: { id: 'asc' },
      });
      if (!contact)
        contact = await tx.contacts.create({
          data: {
            vendorId: job.vendorId!,
            waId: phone,
            wabPhoneNumberId: setting!.phoneNumberId,
            platform: 'whatsapp',
            firstName:
              String(customer.first_name ?? billing.first_name ?? '').slice(0, 100) || null,
            lastName: String(customer.last_name ?? billing.last_name ?? '').slice(0, 100) || null,
          },
        });
      if (contact.status !== 1) {
        await cancel();
        return;
      }
      const template = await tx.whatsappTemplates.findFirst({
        where: { vendorId: job.vendorId!, id: rule.templateId, status: 'APPROVED' },
      });
      if (!template)
        throw new ApiError(
          503,
          'STORE_TEMPLATE_NOT_CONFIGURED',
          'Store notification needs its approved template',
        );
      if (
        template.category?.toUpperCase() === 'MARKETING' &&
        (await tx.contacts.findFirst({
          where: {
            vendorId: job.vendorId!,
            waId: phone,
            whatsappOptOut: { not: null },
            OR: [{ wabPhoneNumberId: null }, { wabPhoneNumberId: setting!.phoneNumberId }],
          },
          select: { id: true },
        }))
      ) {
        await cancel();
        return;
      }
      const values: Record<string, string> = {
        orderNumber: order.orderNumber,
        orderId: String((order as any).shopifyOrderId ?? (order as any).woocommerceOrderId),
        customerName: [contact.firstName, contact.lastName].filter(Boolean).join(' '),
        total: String((order as any).totalPrice ?? (order as any).total),
        currency: order.currency,
        status: order.status,
        trackingNumber: String(raw?.fulfillments?.[0]?.tracking_number ?? ''),
        trackingUrl: String(raw?.fulfillments?.[0]?.tracking_url ?? ''),
      };
      const convert = (v: any): TemplateValue =>
        v.orderField ? { literal: values[v.orderField] || v.fallback || '-' } : v;
      const parameters: RichTemplateValues = {
        ...rule,
        bodyParameters: rule.bodyParameters.map(convert),
        headerParameters: rule.headerParameters.map(convert),
        buttonParameters: rule.buttonParameters?.map((button) => ({
          index: button.index,
          value: convert(button.value),
        })),
      };
      const components = await renderRichTemplate(
        tx,
        job.vendorId!,
        contact,
        template.data,
        parameters,
      );
      const notification =
        p.provider === 'shopify'
          ? await tx.shopifyOrderNotifications.create({
              data: {
                vendorId: job.vendorId!,
                shopifyOrdersId: order.id,
                contactId: contact.id,
                notificationType: p.type,
                status: 'queued',
              },
            })
          : await tx.woocommerceOrderNotifications.create({
              data: {
                vendorId: job.vendorId!,
                woocommerceOrdersId: order.id,
                contactId: contact.id,
                templateId: template.id,
                notificationType: p.type,
                status: 'queued',
              },
            });
      if (p.provider === 'shopify')
        await tx.shopifyOrders.update({ where: { id: order.id }, data: { contactId: contact.id } });
      else
        await tx.woocommerceOrders.update({
          where: { id: order.id },
          data: { contactId: contact.id },
        });
      const log = await tx.whatsappMessageLogs.create({
        data: {
          vendorId: job.vendorId!,
          contactId: contact.id,
          contactWaId: phone,
          wabPhoneNumberId: setting!.phoneNumberId,
          type: 'template',
          status: 'queued',
          isIncomingMessage: false,
          messagedAt: new Date(),
        },
      });
      await tx.outboxJobs.create({
        data: {
          vendorId: job.vendorId!,
          kind: 'whatsapp-send',
          dedupeKey: `store-send:${job.id}`,
          payload: {
            messageId: log.id,
            phoneNumberId: setting!.phoneNumberId,
            storeNotification: {
              provider: p.provider,
              notificationId: notification.id,
              integrationId: store.id,
              settingsRevision: digest(JSON.stringify(setting)),
              templateId: template.id,
              templateRevision: template.updatedAt.toISOString(),
            },
            payload: {
              messaging_product: 'whatsapp',
              to: phone,
              type: 'template',
              template: {
                name: template.templateName,
                language: { code: template.languageCode },
                components,
              },
            },
          },
        },
      });
      await tx.webhookReceipts.create({
        data: {
          provider: 'store-notification',
          eventKey: receiptKey,
          payload: { notificationId: notification.id },
          processedAt: new Date(),
        },
      });
    },
    { timeout: 15000 },
  );
}

export async function storeSendAllowed(vendorId: number, p: any) {
  const n = p.storeNotification;
  if (!n) return true;
  const store = await getStoreIntegration(db, vendorId, n.provider, n.integrationId),
    setting = (store.data as any)?.nodeNotifications;
  const template = await db.whatsappTemplates.findFirst({
    where: { id: n.templateId, vendorId, status: 'APPROVED' },
  });
  const notification =
    n.provider === 'shopify'
      ? await db.shopifyOrderNotifications.findFirst({
          where: { id: n.notificationId, vendorId },
          include: { refShopifyOrdersId: true },
        })
      : await db.woocommerceOrderNotifications.findFirst({
          where: { id: n.notificationId, vendorId },
          include: { refWoocommerceOrdersId: true },
        });
  const order =
    (notification as any)?.refShopifyOrdersId ?? (notification as any)?.refWoocommerceOrdersId;
  if (
    !store.isActive ||
    !setting?.enabled ||
    digest(JSON.stringify(setting)) !== n.settingsRevision ||
    !template ||
    template.updatedAt.toISOString() !== n.templateRevision ||
    !notification ||
    notification.status !== 'queued' ||
    (order?.status === 'cancelled' && notification.notificationType !== 'order_cancelled')
  )
    return false;
  if (
    template.category?.toUpperCase() === 'MARKETING' &&
    (await db.contacts.findFirst({
      where: {
        vendorId,
        waId: p.payload?.to,
        whatsappOptOut: { not: null },
        OR: [{ wabPhoneNumberId: null }, { wabPhoneNumberId: p.phoneNumberId }],
      },
      select: { id: true },
    }))
  )
    return false;
  return true;
}

export async function recordStoreDelivery(
  tx: Prisma.TransactionClient,
  vendorId: number,
  n: any,
  status: string,
  messageId?: string,
) {
  if (!n) return;
  const data = {
    status,
    updatedAt: new Date(),
    ...(messageId
      ? { whatsappMessageId: messageId, messageId, sentAt: new Date(), errorMessage: null }
      : {}),
  };
  const where = {
    id: n.notificationId,
    vendorId,
    status: { in: ['pending', 'queued', 'processing', 'blocked', 'uncertain'] },
  };
  if (n.provider === 'shopify') await tx.shopifyOrderNotifications.updateMany({ where, data });
  else if (n.provider === 'woocommerce')
    await tx.woocommerceOrderNotifications.updateMany({ where, data });
}
