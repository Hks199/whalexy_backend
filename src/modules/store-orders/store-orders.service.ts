import { Prisma, type OutboxJobs } from '@prisma/client';
import { db } from '../../database/client.js';
import { ApiError } from '../../shared/api-error.js';
import { scheduleStoreNotifications } from '../store-notifications/services/notification-delivery.service.js';

export const storeTopics: Record<string, readonly string[]> = {
  shopify: [
    'orders/create',
    'orders/updated',
    'orders/paid',
    'orders/fulfilled',
    'orders/cancelled',
  ],
  woocommerce: ['order.created', 'order.updated'],
};
export function invalid(message = 'Invalid store order data'): never {
  throw new ApiError(400, 'INVALID_STORE_ORDER', message);
}
export function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, any>;
}
export function identifier(value: unknown, int = false): string {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value <= 0))
    invalid('Order ID must be an exact positive integer');
  const id = String(value ?? '');
  if (!/^[1-9]\d{0,39}$/.test(id) || (int && Number(id) > 2147483647))
    invalid('Order ID is outside the supported range');
  return id;
}
export function text(value: unknown, max = 500, fallback: string | null = null): string | null {
  if (value == null) return fallback;
  if (typeof value !== 'string' && typeof value !== 'number') invalid();
  const result = String(value);
  if (result.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(result)) invalid();
  return result;
}
export function money(value: unknown, required = false): Prisma.Decimal {
  if (value == null) {
    if (required) invalid('Order total is required');
    return new Prisma.Decimal(0);
  }
  const amount = String(value);
  if (!/^\d{1,14}(?:\.\d{1,4})?$/.test(amount))
    invalid('Order amount must be a non-negative decimal with at most four decimal places');
  return new Prisma.Decimal(amount);
}
export function date(value: unknown, gmt = false, required = false): Date | null {
  if (value == null || value === '') {
    if (required) invalid('Order modification timestamp is required');
    return null;
  }
  if (typeof value !== 'string' || value.length > 60) invalid('Invalid order timestamp');
  const normalized = gmt && !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? `${value}Z` : value;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized))
    invalid('Order timestamp requires a timezone');
  const result = new Date(normalized);
  if (!Number.isFinite(result.getTime()) || result.getTime() > Date.now() + 300000)
    invalid('Invalid or future order timestamp');
  return result;
}
export function items(value: unknown) {
  if (value == null) return 0;
  if (!Array.isArray(value) || value.length > 1000) invalid('Invalid order line items');
  let total = 0;
  for (const row of value) {
    const quantity = object(row).quantity;
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > 1000000)
      invalid('Invalid item quantity');
    total += quantity;
  }
  if (total > 2147483647) invalid('Order item total is too large');
  return total;
}
export function currency(value: unknown) {
  if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) invalid('Order currency is required');
  return value;
}
export function normalizeShopifyOrder(input: unknown, topic: string) {
  const body = object(input),
    order = body.order ? object(body.order) : body;
  const orderId = identifier(order.id),
    modified = date(order.updated_at, false, true)!;
  const cancelled = date(order.cancelled_at),
    closed = date(order.closed_at);
  if (topic === 'orders/paid' && order.financial_status !== 'paid')
    invalid('Paid topic requires a paid order snapshot');
  if (topic === 'orders/fulfilled' && order.fulfillment_status !== 'fulfilled')
    invalid('Fulfilled topic requires a fulfilled order snapshot');
  if (topic === 'orders/cancelled' && !cancelled)
    invalid('Cancelled topic requires an order cancellation timestamp');
  return {
    orderId,
    modified,
    raw: order as Prisma.InputJsonObject,
    data: {
      shopifyOrderId: orderId,
      orderNumber: text(order.order_number, 100, orderId)!,
      name: text(order.name, 255, `#${orderId}`)!,
      email: text(order.email ?? order.customer?.email, 254),
      phone: text(order.phone ?? order.billing_address?.phone ?? order.shipping_address?.phone, 50),
      currency: currency(order.currency),
      totalPrice: money(order.total_price, true),
      subtotalPrice: money(order.subtotal_price),
      totalTax: money(order.total_tax),
      totalDiscounts: money(order.total_discounts),
      totalWeight: money(order.total_weight),
      totalItems: items(order.line_items),
      financialStatus:
        topic === 'orders/paid' ? 'paid' : text(order.financial_status, 50, 'pending')!,
      fulfillmentStatus:
        topic === 'orders/fulfilled'
          ? 'fulfilled'
          : text(order.fulfillment_status, 50, 'unfulfilled')!,
      status: cancelled || topic === 'orders/cancelled' ? 'cancelled' : closed ? 'closed' : 'open',
      tags: text(order.tags, 2000),
      note: text(order.note, 10000),
      createdAtShopify: date(order.created_at),
      updatedAtShopify: modified,
      processedAtShopify: date(order.processed_at),
      cancelledAtShopify: cancelled ?? (topic === 'orders/cancelled' ? modified : null),
      closedAtShopify: closed,
      processedAt: date(order.processed_at),
      cancelledAt: cancelled ?? (topic === 'orders/cancelled' ? modified : null),
      closedAt: closed,
    },
  };
}
export function normalizeWooOrder(input: unknown) {
  const body = object(input),
    order = body.order ? object(body.order) : body;
  const orderId = identifier(order.id, true),
    modified = date(
      order.date_modified_gmt ?? order.date_modified,
      order.date_modified_gmt != null,
      true,
    )!;
  const billing = order.billing == null ? {} : object(order.billing);
  return {
    orderId,
    modified,
    raw: order as Prisma.InputJsonObject,
    data: {
      woocommerceOrderId: Number(orderId),
      orderNumber: text(order.number, 100, orderId)!,
      status: text(order.status, 50, 'pending')!,
      total: money(order.total, true),
      currency: currency(order.currency),
      totalTax: money(order.total_tax),
      totalShipping: money(order.shipping_total),
      totalDiscount: money(order.discount_total),
      totalItems: items(order.line_items),
      customerNote: text(order.customer_note, 10000),
      paymentMethod: text(order.payment_method, 100),
      paymentMethodTitle: text(order.payment_method_title, 255),
      dateCreated: date(
        order.date_created_gmt ?? order.date_created,
        order.date_created_gmt != null,
      ),
      dateModified: modified,
      dateCompleted: date(
        order.date_completed_gmt ?? order.date_completed,
        order.date_completed_gmt != null,
      ),
      datePaid: date(order.date_paid_gmt ?? order.date_paid, order.date_paid_gmt != null),
      customerData: billing as Prisma.InputJsonObject,
      orderData: order as Prisma.InputJsonObject,
    },
  };
}
// Internal-only transactions: interrupted order processing can be retried without repeating a remote effect.
export async function ingestStoreOrder(job: OutboxJobs) {
  const provider = job.kind.slice(8),
    payload = job.payload as any;
  if (!storeTopics[provider]?.includes(payload.topic))
    throw new ApiError(503, 'WEBHOOK_HANDLER_PENDING', 'Store topic is not implemented');
  if (
    !job.vendorId ||
    typeof payload.credentialId !== 'string' ||
    typeof payload.eventKey !== 'string'
  )
    throw new ApiError(503, 'STORE_CONTEXT_PENDING', 'Store webhook identity is missing');
  const normalized =
    provider === 'shopify'
      ? normalizeShopifyOrder(payload.body, payload.topic)
      : normalizeWooOrder(payload.body);
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`store:${provider}:${payload.credentialId}:${normalized.orderId}`},0))`;
    const receipt = await tx.webhookReceipts.findUnique({ where: { eventKey: payload.eventKey } });
    if (!receipt || receipt.provider !== provider)
      throw new ApiError(409, 'INVALID_STORE_RECEIPT', 'Store receipt is not available');
    if (receipt.processedAt) return;
    const credential = await tx.integrationCredentials.findFirst({
      where: { id: payload.credentialId, vendorId: job.vendorId!, provider },
    });
    const vendor = await tx.vendors.findUnique({
      where: { id: job.vendorId! },
      select: { status: true },
    });
    if (!credential || vendor?.status !== 1)
      throw new ApiError(
        503,
        'STORE_NOT_CONFIGURED',
        'Store is disconnected or business is inactive',
      );
    const integrationId = (credential.metadata as any)?.integrationId;
    if (!Number.isSafeInteger(integrationId) || integrationId < 1)
      throw new ApiError(
        503,
        'STORE_NOT_CONFIGURED',
        'Store needs a validated integration mapping',
      );
    if (provider === 'shopify') {
      const integration = await tx.shopifyIntegrations.findFirst({
        where: {
          id: integrationId,
          vendorId: job.vendorId!,
          isActive: true,
          shopDomain: credential.externalId,
        },
      });
      if (!integration)
        throw new ApiError(503, 'STORE_NOT_CONFIGURED', 'Active Shopify store is unavailable');
      const input = normalized as ReturnType<typeof normalizeShopifyOrder>;
      const previous = await tx.shopifyOrders.findUnique({
        where: {
          shopifyIntegrationsId_shopifyOrderId: {
            shopifyIntegrationsId: integrationId,
            shopifyOrderId: input.orderId,
          },
        },
      });
      if (!previous?.updatedAtShopify || previous.updatedAtShopify <= input.modified) {
        const data = { ...input.data, data: input.raw, updatedAt: new Date() };
        // Equal-revision events cannot regress a terminal status.
        if (previous?.updatedAtShopify?.getTime() === input.modified.getTime()) {
          if (previous.financialStatus === 'paid' && data.financialStatus === 'pending')
            data.financialStatus = 'paid';
          if (previous.fulfillmentStatus === 'fulfilled') data.fulfillmentStatus = 'fulfilled';
          if (previous.cancelledAt) {
            data.status = 'cancelled';
            data.cancelledAt = previous.cancelledAt;
            data.cancelledAtShopify = previous.cancelledAtShopify;
          }
        }
        const saved = await tx.shopifyOrders.upsert({
          where: {
            shopifyIntegrationsId_shopifyOrderId: {
              shopifyIntegrationsId: integrationId,
              shopifyOrderId: input.orderId,
            },
          },
          create: { ...data, vendorId: job.vendorId!, shopifyIntegrationsId: integrationId },
          update: data,
        });
        await scheduleStoreNotifications(tx, provider, integration, saved, previous, payload.topic);
      }
      await tx.shopifyIntegrations.update({
        where: { id: integrationId },
        data: { lastSyncAt: new Date(), updatedAt: new Date() },
      });
    } else {
      const integration = await tx.woocommerceIntegrations.findFirst({
        where: { id: integrationId, vendorId: job.vendorId!, isActive: true },
      });
      if (!integration || new URL(integration.siteUrl).hostname !== credential.externalId)
        throw new ApiError(503, 'STORE_NOT_CONFIGURED', 'Active WooCommerce store is unavailable');
      const input = normalized as ReturnType<typeof normalizeWooOrder>;
      const previous = await tx.woocommerceOrders.findUnique({
        where: {
          woocommerceIntegrationsId_woocommerceOrderId: {
            woocommerceIntegrationsId: integrationId,
            woocommerceOrderId: Number(input.orderId),
          },
        },
      });
      if (!previous?.dateModified || previous.dateModified < input.modified) {
        const data = { ...input.data, updatedAt: new Date() };
        const saved = await tx.woocommerceOrders.upsert({
          where: {
            woocommerceIntegrationsId_woocommerceOrderId: {
              woocommerceIntegrationsId: integrationId,
              woocommerceOrderId: Number(input.orderId),
            },
          },
          create: { ...data, vendorId: job.vendorId!, woocommerceIntegrationsId: integrationId },
          update: data,
        });
        await scheduleStoreNotifications(tx, provider, integration, saved, previous, payload.topic);
      }
      await tx.woocommerceIntegrations.update({
        where: { id: integrationId },
        data: { lastSyncAt: new Date(), updatedAt: new Date() },
      });
    }
    await tx.webhookReceipts.update({
      where: { eventKey: payload.eventKey },
      data: { processedAt: new Date() },
    });
  });
}
