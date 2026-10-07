import { Prisma } from '@prisma/client';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { csvCell } from '../../contacts/services/contact-csv.js';
import { access, filter, select, projection } from './order-support.service.js';
export async function exportOrders(input: ServiceContext) {
  const q = input.validatedQuery;
  const csv = await db.$transaction(
    async (tx) => {
      const a = await access(tx, input);
      if (q.customer_phone && !a.phone)
        throw new ApiError(403, 'FORBIDDEN', 'Phone search requires phone visibility');
      const where = filter(a.vendorId, q);
      const ids = await tx.$queryRaw<{ id: number }[]>(
        Prisma.sql`SELECT o._id AS id FROM whatsapp_orders o WHERE ${where} ORDER BY o.created_at DESC,o._id DESC LIMIT 10001`,
      );
      if (ids.length > 10000)
        throw new ApiError(409, 'EXPORT_TOO_LARGE', 'Narrow filters to at most 10000 orders');
      const rows = await tx.whatsappOrders.findMany({
        where: { id: { in: ids.map((r) => r.id) }, vendorId: a.vendorId },
        select,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      const lines = [
        [
          'Order ID',
          'Customer Phone',
          'Customer Name',
          'Status',
          'Total Amount',
          'Currency',
          'Items Count',
          'Delivery Address',
          'Payment Status',
          'Ordered At',
          'Payment Completed At',
        ]
          .map(csvCell)
          .join(','),
      ];
      for (const row of rows) {
        const p = projection(row, a.phone);
        lines.push(
          [
            p.order_id,
            p.customer_phone,
            p.customer_name,
            p.status,
            p.total_amount,
            p.currency,
            p.items.length,
            p.delivery_address,
            p.payment_status,
            p.ordered_at?.toISOString().replace('T', ' ').slice(0, 19),
            p.payment_completed_at?.toISOString().replace('T', ' ').slice(0, 19),
          ]
            .map(csvCell)
            .join(','),
        );
      }
      return lines.join('\r\n') + '\r\n';
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 },
  );
  return serviceResult(csv, {
    status: 200,
    format: 'send',
    contentType: 'text/csv; charset=utf-8',
    headers: {
      'Content-Disposition': 'attachment; filename="whatsapp_orders.csv"',
      'Cache-Control': 'no-store',
    },
  });
}
