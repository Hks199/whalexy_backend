import { orderLineItems } from './store-history-projection.service.js';
import { Prisma } from '@prisma/client';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { currentContactPermissions } from '../../contact-workflows/services/contact-administration.service.js';
type Provider = 'shopify' | 'woocommerce';
const commonOrderSelect = {
  id: true,
  uid: true,
  orderNumber: true,
  status: true,
  currency: true,
  totalItems: true,
  totalTax: true,
  createdAt: true,
  updatedAt: true,
} as const;
const shopifySelect = {
  ...commonOrderSelect,
  shopifyOrderId: true,
  shopifyIntegrationsId: true,
  name: true,
  email: true,
  phone: true,
  financialStatus: true,
  fulfillmentStatus: true,
  totalPrice: true,
  subtotalPrice: true,
  totalDiscounts: true,
  totalWeight: true,
  tags: true,
  note: true,
  processedAt: true,
  cancelledAt: true,
  closedAt: true,
  createdAtShopify: true,
  updatedAtShopify: true,
} satisfies Prisma.ShopifyOrdersSelect;
const wooSelect = {
  ...commonOrderSelect,
  woocommerceOrderId: true,
  woocommerceIntegrationsId: true,
  total: true,
  totalShipping: true,
  totalDiscount: true,
  paymentMethod: true,
  paymentMethodTitle: true,
  shippingMethod: true,
  shippingMethodTitle: true,
  customerNote: true,
  dateCreated: true,
  dateModified: true,
  dateCompleted: true,
  datePaid: true,
  dateCancelled: true,
  dateRefunded: true,
} satisfies Prisma.WoocommerceOrdersSelect;
const notificationSelect = {
  id: true,
  uid: true,
  notificationType: true,
  status: true,
  sentAt: true,
  deliveredAt: true,
  readAt: true,
  createdAt: true,
  updatedAt: true,
} as const;
function project(row: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key === 'id'
        ? '_id'
        : key === 'uid'
          ? '_uid'
          : key.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase()),
      value instanceof Prisma.Decimal ? value.toString() : value,
    ]),
  );
}
function page(rows: unknown[], total: number, query: any) {
  return {
    data: rows,
    total,
    page: query.page,
    limit: query.limit,
    has_more: query.page * query.limit < total,
  };
}
function literalSearch(value: string) {
  return value.replace(/[\\%_]/g, '\\$&');
}
function dateRange(q: any) {
  return q.date_from
    ? {
        gte: new Date(q.date_from + 'T00:00:00.000Z'),
        lt: new Date(new Date(q.date_to + 'T00:00:00.000Z').getTime() + 86400000),
      }
    : undefined;
}
async function authorize(tx: Prisma.TransactionClient, input: ServiceContext, provider: Provider) {
  const permissions = await currentContactPermissions(tx, input);
  if (!permissions.includes('*') && !permissions.includes('vendor.integrations.manage'))
    throw new ApiError(403, 'FORBIDDEN', 'Integration management permission required');
  const id = input.validatedQuery.integration_id,
    vendorId = input.identity!.vendorId!;
  if (id) {
    const store =
      provider === 'shopify'
        ? await tx.shopifyIntegrations.findFirst({ where: { id, vendorId }, select: { id: true } })
        : await tx.woocommerceIntegrations.findFirst({
            where: { id, vendorId },
            select: { id: true },
          });
    if (!store) throw new ApiError(404, 'NOT_FOUND', 'Store integration not found');
  }
}
function shopifyScope(input: ServiceContext): Prisma.ShopifyOrdersWhereInput {
  const vendorId = input.identity!.vendorId!;
  return {
    vendorId,
    refShopifyIntegrationsId: { vendorId },
    ...(input.validatedQuery.integration_id
      ? { shopifyIntegrationsId: input.validatedQuery.integration_id }
      : {}),
    OR: [{ contactId: null }, { refContactId: { vendorId } }],
  };
}
function wooScope(input: ServiceContext): Prisma.WoocommerceOrdersWhereInput {
  const vendorId = input.identity!.vendorId!;
  return {
    vendorId,
    refWoocommerceIntegrationsId: { vendorId },
    ...(input.validatedQuery.integration_id
      ? { woocommerceIntegrationsId: input.validatedQuery.integration_id }
      : {}),
    OR: [{ contactId: null }, { refContactId: { vendorId } }],
  };
}
async function notificationPage(
  tx: Prisma.TransactionClient,
  input: ServiceContext,
  provider: Provider,
  orderId?: number,
) {
  const q = input.validatedQuery,
    vendorId = input.identity!.vendorId!;
  const common = {
    vendorId,
    ...(q.status ? { status: q.status } : {}),
    createdAt: dateRange(q),
    OR: [{ contactId: null }, { refContactId: { vendorId } }],
  };
  const options = {
    skip: (q.page - 1) * q.limit,
    take: q.limit,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] as const,
  };
  if (provider === 'shopify') {
    const where: Prisma.ShopifyOrderNotificationsWhereInput = {
      ...common,
      refShopifyOrdersId: shopifyScope(input),
      ...(orderId ? { shopifyOrdersId: orderId } : {}),
      ...(q.notification_type ? { notificationType: q.notification_type } : {}),
      ...(q.search
        ? {
            AND: [
              {
                OR: [
                  { notificationType: { contains: literalSearch(q.search), mode: 'insensitive' } },
                  {
                    refShopifyOrdersId: {
                      orderNumber: { contains: literalSearch(q.search), mode: 'insensitive' },
                    },
                  },
                ],
              },
            ],
          }
        : {}),
    };
    const total = await tx.shopifyOrderNotifications.count({ where });
    const rows = await tx.shopifyOrderNotifications.findMany({
      where,
      ...options,
      orderBy: [...options.orderBy],
      select: { ...notificationSelect, shopifyOrdersId: true },
    });
    return page(rows.map(project), total, q);
  }
  const where: Prisma.WoocommerceOrderNotificationsWhereInput = {
    ...common,
    refWoocommerceOrdersId: wooScope(input),
    ...(orderId ? { woocommerceOrdersId: orderId } : {}),
    ...(q.type ? { notificationType: q.type } : {}),
    AND: [
      { OR: [{ templateId: null }, { refTemplateId: { vendorId } }] },
      ...(q.search
        ? [
            {
              OR: [
                {
                  notificationType: {
                    contains: literalSearch(q.search),
                    mode: 'insensitive' as const,
                  },
                },
                {
                  refWoocommerceOrdersId: {
                    orderNumber: {
                      contains: literalSearch(q.search),
                      mode: 'insensitive' as const,
                    },
                  },
                },
              ],
            },
          ]
        : []),
    ],
  };
  const total = await tx.woocommerceOrderNotifications.count({ where });
  const rows = await tx.woocommerceOrderNotifications.findMany({
    where,
    ...options,
    orderBy: [...options.orderBy],
    select: { ...notificationSelect, woocommerceOrdersId: true, retryCount: true },
  });
  return page(rows.map(project), total, q);
}
export async function listOrders(input: ServiceContext, provider: Provider) {
  return db.$transaction(
    async (tx) => {
      await authorize(tx, input, provider);
      const q = input.validatedQuery;
      const options = {
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
      };
      let rows: Record<string, unknown>[], total: number;
      if (provider === 'shopify') {
        const where: Prisma.ShopifyOrdersWhereInput = {
          ...shopifyScope(input),
          ...(q.status ? { status: q.status } : {}),
          ...(q.financial_status ? { financialStatus: q.financial_status } : {}),
          ...(q.fulfillment_status ? { fulfillmentStatus: q.fulfillment_status } : {}),
          createdAt: dateRange(q),
          ...(q.search
            ? {
                AND: [
                  {
                    OR: ['orderNumber', 'name', 'email'].map((field) => ({
                      [field]: { contains: literalSearch(q.search), mode: 'insensitive' },
                    })),
                  },
                ],
              }
            : {}),
        };
        total = await tx.shopifyOrders.count({ where });
        rows = await tx.shopifyOrders.findMany({ where, ...options, select: shopifySelect });
      } else {
        const where: Prisma.WoocommerceOrdersWhereInput = {
          ...wooScope(input),
          ...(q.status ? { status: q.status } : {}),
          createdAt: dateRange(q),
          ...(q.search
            ? { orderNumber: { contains: literalSearch(q.search), mode: 'insensitive' } }
            : {}),
        };
        total = await tx.woocommerceOrders.count({ where });
        rows = await tx.woocommerceOrders.findMany({ where, ...options, select: wooSelect });
      }
      return serviceResult(
        { orders: page(rows.map(project), total, q) },
        { status: 200, format: 'json' },
      );
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 },
  );
}
export async function listNotifications(input: ServiceContext, provider: Provider) {
  return db.$transaction(
    async (tx) => {
      await authorize(tx, input, provider);
      return serviceResult(
        { notifications: await notificationPage(tx, input, provider) },
        { status: 200, format: 'json' },
      );
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 },
  );
}
export async function orderDetails(input: ServiceContext, provider: Provider) {
  return db.$transaction(
    async (tx) => {
      await authorize(tx, input, provider);
      const rows =
        provider === 'shopify'
          ? await tx.shopifyOrders.findMany({
              where: { ...shopifyScope(input), shopifyOrderId: input.params.orderId },
              select: { ...shopifySelect, data: true },
              take: 2,
            })
          : await tx.woocommerceOrders.findMany({
              where: { ...wooScope(input), woocommerceOrderId: input.params.orderId },
              select: { ...wooSelect, orderData: true },
              take: 2,
            });
      if (!rows.length) throw new ApiError(404, 'NOT_FOUND', 'Order not found');
      if (rows.length > 1)
        throw new ApiError(
          409,
          'STORE_SCOPE_REQUIRED',
          'Select one owned integration with integration_id',
        );
      return serviceResult(
        {
          order: {
            ...project(
              Object.fromEntries(
                Object.entries(rows[0]).filter(([key]) => !['data', 'orderData'].includes(key)),
              ),
            ),
            line_items: orderLineItems('data' in rows[0] ? rows[0].data : rows[0].orderData),
          },
          notifications: await notificationPage(tx, input, provider, rows[0].id),
        },
        { status: 200, format: 'json' },
      );
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 },
  );
}
