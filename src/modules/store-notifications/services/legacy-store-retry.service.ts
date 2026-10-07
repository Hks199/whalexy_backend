import { Prisma } from '@prisma/client';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { currentContactPermissions } from '../../contact-workflows/services/contact-administration.service.js';
import { baseSubscriptionActive } from '../../billing/services/billing-support.service.js';
import { digest } from '../../../utils/crypto.js';
import { getStoreIntegration } from './store-notifications-support.service.js';
const safeErrors = [
  'PROVIDER_REJECTED',
  'INTEGRATION_NOT_CONFIGURED',
  'TEMPLATE_REQUIRED',
  'BUSINESS_INACTIVE',
  'SENDER_ACCESS_REVOKED',
];
export async function retryStoreNotification(
  input: ServiceContext,
  provider: 'shopify' | 'woocommerce',
) {
  const vendorId = input.identity!.vendorId!,
    notificationId = input.params.notificationId,
    key = input.headers['idempotency-key'];
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(key))
    throw new ApiError(400, 'IDEMPOTENCY_REQUIRED', 'A valid Idempotency-Key is required');
  const requestHash = digest(JSON.stringify({ provider, notificationId }));
  const result = await db
    .$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`store-retry:${vendorId}:${provider}:${notificationId}`},0))`;
        const permissions = await currentContactPermissions(tx, input),
          has = (p: string) => permissions.includes('*') || permissions.includes(p);
        if (!has('vendor.integrations.manage') || !has('vendor.chats.reply'))
          throw new ApiError(
            403,
            'FORBIDDEN',
            'Store retry requires integration and messaging permissions',
          );
        const notification =
          provider === 'shopify'
            ? await tx.shopifyOrderNotifications.findFirst({
                where: { id: notificationId, vendorId },
                include: { refShopifyOrdersId: true },
              })
            : await tx.woocommerceOrderNotifications.findFirst({
                where: { id: notificationId, vendorId },
                include: { refWoocommerceOrdersId: true },
              });
        if (!notification) throw new ApiError(404, 'NOT_FOUND', 'Notification not found');
        const order =
          (notification as any).refShopifyOrdersId ?? (notification as any).refWoocommerceOrdersId;
        const contact = notification.contactId
          ? await tx.contacts.findFirst({
              where: {
                id: notification.contactId,
                vendorId,
                ...(!has('vendor.chats.view_all')
                  ? { assignedUserId: input.identity!.userId }
                  : {}),
              },
            })
          : null;
        if (!contact) throw new ApiError(404, 'NOT_FOUND', 'Notification recipient not found');
        if (order?.vendorId !== vendorId)
          throw new ApiError(
            409,
            'STORE_REFERENCE_INVALID',
            'Reconcile imported order ownership before retrying',
          );
        const replay = await tx.nativeIdempotency.findUnique({
          where: { vendorId_key: { vendorId, key: `store-retry:${key}` } },
        });
        if (replay) {
          if (replay.requestHash !== requestHash)
            throw new ApiError(
              409,
              'IDEMPOTENCY_CONFLICT',
              'Key was used for another notification retry',
            );
          return replay.response;
        }
        if (!(await baseSubscriptionActive(vendorId, new Date(), tx)))
          throw new ApiError(
            403,
            'SUBSCRIPTION_REQUIRED',
            'An active base subscription is required',
          );
        if (
          !['failed', 'blocked'].includes(notification.status) ||
          notification.whatsappMessageId ||
          notification.messageId ||
          notification.sentAt ||
          notification.deliveredAt ||
          notification.readAt
        )
          throw new ApiError(
            409,
            'NOTIFICATION_STATE',
            'Only an unsent known failure can be retried',
          );
        if (provider === 'woocommerce' && (notification as any).retryCount >= 3)
          throw new ApiError(409, 'RETRY_LIMIT', 'Notification reached its retry limit');
        const jobs = await tx.outboxJobs.findMany({
          where: {
            vendorId,
            kind: 'whatsapp-send',
            AND: [
              { payload: { path: ['storeNotification', 'provider'], equals: provider } },
              {
                payload: { path: ['storeNotification', 'notificationId'], equals: notificationId },
              },
            ],
          },
          take: 2,
        });
        if (jobs.length !== 1)
          throw new ApiError(
            409,
            'NOTIFICATION_RECONCILIATION_REQUIRED',
            'One native delivery job must be reconciled before retrying',
          );
        const job = jobs[0];
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`outbox-retry:${job.id}`},0))`;
        if (
          !['failed', 'blocked'].includes(job.status) ||
          !safeErrors.includes(job.lastError ?? '')
        )
          throw new ApiError(
            409,
            'PROVIDER_RECONCILIATION_REQUIRED',
            'The job does not establish a safe retry',
          );
        const p = job.payload as any,
          n = p.storeNotification;
        if (
          !n ||
          n.provider !== provider ||
          n.notificationId !== notificationId ||
          n.integrationId !==
            ((order as any).shopifyIntegrationsId ?? (order as any).woocommerceIntegrationsId)
        )
          throw new ApiError(
            409,
            'STORE_REFERENCE_INVALID',
            'Delivery references require reconciliation',
          );
        if (
          !Number.isInteger(p.messageId) ||
          p.messageId <= 0 ||
          !Number.isInteger(n.templateId) ||
          n.templateId <= 0 ||
          !Number.isInteger(n.integrationId) ||
          n.integrationId <= 0 ||
          typeof p.phoneNumberId !== 'string' ||
          !/^\d{5,100}$/.test(p.phoneNumberId)
        )
          throw new ApiError(
            409,
            'STORE_REFERENCE_INVALID',
            'Native delivery identifiers require reconciliation',
          );
        const store = await getStoreIntegration(tx, vendorId, provider, n.integrationId),
          setting = (store.data as any)?.nodeNotifications;
        const template = await tx.whatsappTemplates.findFirst({
          where: { id: n.templateId, vendorId, status: 'APPROVED' },
        });
        const log = await tx.whatsappMessageLogs.findFirst({
          where: {
            id: p.messageId,
            vendorId,
            contactId: contact.id,
            contactWaId: contact.waId,
            wabPhoneNumberId: p.phoneNumberId,
          },
        });
        if (
          order.updatedAt > job.createdAt ||
          !store.isActive ||
          !setting?.enabled ||
          digest(JSON.stringify(setting)) !== n.settingsRevision ||
          !template ||
          template.updatedAt.toISOString() !== n.templateRevision ||
          !log ||
          log.isIncomingMessage !== false ||
          log.type !== 'template' ||
          log.whatsappMessageId ||
          ['sent', 'delivered', 'read', 'uncertain', 'cancelled'].includes(log.status ?? '') ||
          contact.status !== 1 ||
          !contact.waId ||
          (contact.platform && contact.platform !== 'whatsapp') ||
          p.payload?.to !== contact.waId ||
          p.payload?.type !== 'template' ||
          p.payload?.template?.name !== template.templateName ||
          p.payload?.template?.language?.code !== template.languageCode ||
          setting.phoneNumberId !== p.phoneNumberId ||
          (contact.wabPhoneNumberId && contact.wabPhoneNumberId !== p.phoneNumberId) ||
          (order.status === 'cancelled' && notification.notificationType !== 'order_cancelled')
        )
          throw new ApiError(
            409,
            'NOTIFICATION_CONFIGURATION_CHANGED',
            'Reconcile changed delivery configuration before retrying',
          );
        if (
          !(await tx.integrationCredentials.findUnique({
            where: {
              vendorId_provider_externalId: {
                vendorId,
                provider: 'whatsapp',
                externalId: p.phoneNumberId,
              },
            },
          }))
        )
          throw new ApiError(
            409,
            'INTEGRATION_NOT_CONFIGURED',
            'Reconnect the original sender before retrying',
          );
        if (
          template.category?.toUpperCase() === 'MARKETING' &&
          (await tx.contacts.findFirst({
            where: {
              vendorId,
              waId: contact.waId,
              whatsappOptOut: { not: null },
              OR: [{ wabPhoneNumberId: null }, { wabPhoneNumberId: p.phoneNumberId }],
            },
            select: { id: true },
          }))
        )
          throw new ApiError(409, 'MARKETING_OPT_OUT', 'Recipient opted out of marketing');
        const nextPayload = { ...p, sentByUserId: input.identity!.userId };
        delete nextPayload.apiKeyId;
        if (input.identity!.apiKeyId) nextPayload.apiKeyId = input.identity!.apiKeyId;
        const changed = await tx.outboxJobs.updateMany({
          where: { id: job.id, vendorId, status: job.status, lastError: job.lastError },
          data: {
            status: 'pending',
            attempts: 0,
            lastError: null,
            lockedAt: null,
            availableAt: new Date(),
            payload: nextPayload as Prisma.InputJsonObject,
          },
        });
        if (changed.count !== 1)
          throw new ApiError(409, 'JOB_STATE', 'Delivery changed during retry');
        await tx.whatsappMessageLogs.update({
          where: { id: log.id },
          data: { status: 'queued', updatedAt: new Date() },
        });
        if (provider === 'shopify')
          await tx.shopifyOrderNotifications.update({
            where: { id: notificationId },
            data: { status: 'queued', errorMessage: null, updatedAt: new Date() },
          });
        else
          await tx.woocommerceOrderNotifications.update({
            where: { id: notificationId },
            data: {
              status: 'queued',
              errorMessage: null,
              retryCount: { increment: 1 },
              updatedAt: new Date(),
            },
          });
        await tx.auditEvents.create({
          data: {
            vendorId,
            actorId: input.identity!.userId,
            action: 'store-notification-retry',
            resource: provider,
            resourceId: String(notificationId),
          },
        });
        const response = {
          success: true,
          message: 'Notification queued for retry',
          status: 'pending',
          notification_id: notificationId,
          job_id: job.id,
        };
        await tx.nativeIdempotency.create({
          data: { vendorId, key: `store-retry:${key}`, requestHash, response },
        });
        return response;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 },
    )
    .catch((error) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034')
        throw new ApiError(
          409,
          'RETRY_CONFLICT',
          'Retry state changed; retry the same idempotent request',
        );
      throw error;
    });
  return serviceResult(result, { status: 202, format: 'json' });
}
