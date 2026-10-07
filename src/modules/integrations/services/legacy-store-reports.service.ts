import { Prisma } from '@prisma/client';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { currentContactPermissions } from '../../contact-workflows/services/contact-administration.service.js';
type Provider = 'shopify' | 'woocommerce';
async function authorize(tx: Prisma.TransactionClient, input: ServiceContext) {
  const permissions = await currentContactPermissions(tx, input);
  if (!permissions.includes('*') && !permissions.includes('vendor.integrations.manage'))
    throw new ApiError(403, 'FORBIDDEN', 'Integration management permission required');
}
async function integration(
  tx: Prisma.TransactionClient,
  input: ServiceContext,
  provider: Provider,
) {
  const where = {
    vendorId: input.identity!.vendorId!,
    ...(input.validatedQuery.integration_id ? { id: input.validatedQuery.integration_id } : {}),
  };
  const rows =
    provider === 'shopify'
      ? await tx.shopifyIntegrations.findMany({
          where,
          take: 2,
          select: {
            id: true,
            isActive: true,
            shopDomain: true,
            connectedAt: true,
            lastSyncAt: true,
            webhookId: true,
            notificationTypes: true,
          },
        })
      : await tx.woocommerceIntegrations.findMany({
          where,
          take: 2,
          select: { id: true, isActive: true, siteUrl: true, connectedAt: true, lastSyncAt: true },
        });
  if (rows.length > 1)
    throw new ApiError(
      409,
      'STORE_SCOPE_REQUIRED',
      'Select one owned integration with integration_id',
    );
  if (input.validatedQuery.integration_id && rows.length !== 1)
    throw new ApiError(404, 'NOT_FOUND', 'Store integration not found');
  return rows[0];
}
export async function status(input: ServiceContext, provider: Provider) {
  return db.$transaction(
    async (tx) => {
      await authorize(tx, input);
      const row = await integration(tx, input, provider);
      if (provider === 'shopify') {
        if (!row)
          return serviceResult(
            { connected: false, shop_domain: null, last_sync: null, webhook_configured: false },
            { status: 200, format: 'json' },
          );
        const shop = row as {
          isActive: boolean;
          connectedAt: Date | null;
          shopDomain: string;
          lastSyncAt: Date | null;
          webhookId: string | null;
          notificationTypes: string | null;
        };
        if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(shop.shopDomain))
          throw new ApiError(
            409,
            'STORE_METADATA_INVALID',
            'Stored store domain requires reconciliation',
          );
        return serviceResult(
          {
            connected: Boolean(shop.isActive && shop.connectedAt),
            shop_domain: shop.shopDomain,
            last_sync: shop.lastSyncAt,
            webhook_configured: Boolean(shop.webhookId),
            notification_types: shop.notificationTypes ? shop.notificationTypes.split(',') : [],
          },
          { status: 200, format: 'json' },
        );
      }
      if (!row)
        return serviceResult(
          { connected: false, message: 'No WooCommerce integration found' },
          { status: 200, format: 'json' },
        );
      const woo = row as {
        isActive: boolean;
        siteUrl: string;
        connectedAt: Date | null;
        lastSyncAt: Date | null;
      };
      let url: URL;
      try {
        url = new URL(woo.siteUrl);
      } catch {
        throw new ApiError(
          409,
          'STORE_METADATA_INVALID',
          'Stored store URL requires reconciliation',
        );
      }
      if (
        !['https:', 'http:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw new ApiError(
          409,
          'STORE_METADATA_INVALID',
          'Stored store URL requires reconciliation',
        );
      return serviceResult(
        {
          connected: woo.isActive,
          site_url: woo.siteUrl,
          connected_at: woo.connectedAt,
          last_sync: woo.lastSyncAt,
        },
        { status: 200, format: 'json' },
      );
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 },
  );
}
const rate = (part: number, total: number) =>
  total ? Math.round((part / total) * 10000) / 100 : 0;
type Counts = { total: number; paid: number; fulfilled: number; other: number };
type NotificationCounts = {
  total: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  pending: number;
  recent: number;
  recentSent: number;
};
export async function statistics(input: ServiceContext, provider: Provider) {
  return db.$transaction(
    async (tx) => {
      await authorize(tx, input);
      const vendorId = input.identity!.vendorId!,
        selected = input.validatedQuery.integration_id;
      if (selected) await integration(tx, input, provider);
      const orders =
          provider === 'shopify' ? Prisma.sql`shopify_orders` : Prisma.sql`woocommerce_orders`,
        stores =
          provider === 'shopify'
            ? Prisma.sql`shopify_integrations`
            : Prisma.sql`woocommerce_integrations`,
        notifications =
          provider === 'shopify'
            ? Prisma.sql`shopify_order_notifications`
            : Prisma.sql`woocommerce_order_notifications`;
      const integrationColumn =
          provider === 'shopify'
            ? Prisma.sql`o.shopify_integrations__id`
            : Prisma.sql`o.woocommerce_integrations__id`,
        orderColumn =
          provider === 'shopify'
            ? Prisma.sql`n.shopify_orders__id`
            : Prisma.sql`n.woocommerce_orders__id`;
      const from = Prisma.sql`FROM ${orders} o JOIN ${stores} i ON i._id=${integrationColumn} AND i.vendors__id=o.vendors__id WHERE o.vendors__id=${vendorId} ${selected ? Prisma.sql`AND i._id=${selected}` : Prisma.empty}`;
      const paid =
          provider === 'shopify'
            ? Prisma.sql`o.financial_status IN ('paid','partially_paid')`
            : Prisma.sql`o.status IN ('processing','completed')`,
        fulfilled =
          provider === 'shopify'
            ? Prisma.sql`o.fulfillment_status IN ('fulfilled','partial')`
            : Prisma.sql`o.status='completed'`,
        other =
          provider === 'shopify'
            ? Prisma.sql`o.status='cancelled'`
            : Prisma.sql`o.status='pending'`;
      const [order] = await tx.$queryRaw<Counts[]>(
        Prisma.sql`SELECT COUNT(*)::integer AS total,COUNT(*) FILTER(WHERE ${paid})::integer AS paid,COUNT(*) FILTER(WHERE ${fulfilled})::integer AS fulfilled,COUNT(*) FILTER(WHERE ${other})::integer AS other ${from}`,
      );
      const recent = new Date(Date.now() - 30 * 86400000);
      const [notice] = await tx.$queryRaw<NotificationCounts[]>(
        Prisma.sql`SELECT COUNT(*)::integer AS total,COUNT(*) FILTER(WHERE n.status IN ('sent','delivered','read'))::integer AS sent,COUNT(*) FILTER(WHERE n.status IN ('delivered','read'))::integer AS delivered,COUNT(*) FILTER(WHERE n.status='read')::integer AS read,COUNT(*) FILTER(WHERE n.status='failed')::integer AS failed,COUNT(*) FILTER(WHERE n.status='pending')::integer AS pending,COUNT(*) FILTER(WHERE n.created_at>=${recent})::integer AS recent,COUNT(*) FILTER(WHERE n.created_at>=${recent} AND n.status IN ('sent','delivered','read'))::integer AS "recentSent" FROM ${notifications} n JOIN ${orders} o ON o._id=${orderColumn} AND o.vendors__id=n.vendors__id JOIN ${stores} i ON i._id=${integrationColumn} AND i.vendors__id=o.vendors__id WHERE n.vendors__id=${vendorId} ${selected ? Prisma.sql`AND i._id=${selected}` : Prisma.empty} AND (n.contacts__id IS NULL OR EXISTS(SELECT 1 FROM contacts c WHERE c._id=n.contacts__id AND c.vendors__id=n.vendors__id))`,
      );
      if (provider === 'shopify')
        return serviceResult(
          {
            orders: {
              total_orders: order.total,
              paid_orders: order.paid,
              fulfilled_orders: order.fulfilled,
              cancelled_orders: order.other,
              payment_rate: rate(order.paid, order.total),
              fulfillment_rate: rate(order.fulfilled, order.total),
            },
            notifications: {
              total_notifications: notice.total,
              sent_notifications: notice.sent,
              delivered_notifications: notice.delivered,
              read_notifications: notice.read,
              failed_notifications: notice.failed,
              delivery_rate: rate(notice.delivered, notice.total),
              read_rate: rate(notice.read, notice.total),
            },
          },
          { status: 200, format: 'json' },
        );
      return serviceResult(
        {
          success: true,
          data: {
            orders: {
              total_orders: order.total,
              paid_orders: order.paid,
              fulfilled_orders: order.fulfilled,
              pending_orders: order.other,
            },
            notifications: {
              total_notifications: notice.total,
              sent_notifications: notice.sent,
              failed_notifications: notice.failed,
              pending_notifications: notice.pending,
            },
            success_rate: rate(notice.recentSent, notice.recent),
          },
        },
        { status: 200, format: 'json' },
      );
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 },
  );
}
