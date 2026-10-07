import { Prisma } from '@prisma/client';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { access, scope, filter, select, projection, result } from './order-support.service.js';
export async function list(input: ServiceContext) {
  const q = input.validatedQuery;
  const data = await db.$transaction(
    async (tx) => {
      const a = await access(tx, input);
      if (q.customer_phone && !a.phone)
        throw new ApiError(403, 'FORBIDDEN', 'Phone search requires phone visibility');
      const where = filter(a.vendorId, q);
      const [ids, count] = await Promise.all([
        tx.$queryRaw<{ id: number }[]>(
          Prisma.sql`SELECT o._id AS id FROM whatsapp_orders o WHERE ${where} ORDER BY o.created_at DESC,o._id DESC LIMIT ${q.per_page} OFFSET ${(q.page - 1) * q.per_page}`,
        ),
        tx.$queryRaw<{ total: bigint }[]>(
          Prisma.sql`SELECT count(*) AS total FROM whatsapp_orders o WHERE ${where}`,
        ),
      ]);
      const rows = await tx.whatsappOrders.findMany({
        where: { id: { in: ids.map((r) => r.id) }, vendorId: a.vendorId },
        select,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      return {
        orders: {
          data: rows.map((r) => projection(r, a.phone)),
          total: Number(count[0].total),
          current_page: q.page,
          per_page: q.per_page,
          last_page: Math.max(1, Math.ceil(Number(count[0].total) / q.per_page)),
        },
        filters: q,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  return result(data);
}
export async function detail(input: ServiceContext) {
  const data = await db.$transaction(
    async (tx) => {
      const a = await access(tx, input);
      const row = await tx.whatsappOrders.findFirst({
        where: { vendorId: a.vendorId, uid: input.params.orderUid },
        select,
      });
      if (
        !row ||
        (row.contactId !== null &&
          !(await tx.contacts.findFirst({
            where: { id: row.contactId, vendorId: a.vendorId },
            select: { id: true },
          })))
      )
        throw new ApiError(404, 'NOT_FOUND', 'Order not found');
      const payments = await tx.whatsappPayments.findMany({
        where: { vendorId: a.vendorId, orderId: row.orderId },
        select: {
          uid: true,
          amount: true,
          currency: true,
          status: true,
          gateway: true,
          paymentMethod: true,
          createdAt: true,
          paymentCompletedAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 100,
      });
      return {
        order: projection(row, a.phone),
        payments: payments.map((p) => ({
          _uid: p.uid,
          amount: p.amount.toString(),
          currency: p.currency,
          status: p.status,
          gateway: p.gateway,
          payment_method: p.paymentMethod,
          created_at: p.createdAt,
          payment_completed_at: p.paymentCompletedAt,
        })),
        payments_limit: 100,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  return result(data);
}
export async function statistics(input: ServiceContext) {
  const data = await db.$transaction(
    async (tx) => {
      const a = await access(tx, input);
      const rows = await tx.$queryRaw<
        { status: string; currency: string; total: bigint; amount: Prisma.Decimal }[]
      >(
        Prisma.sql`SELECT o.status,o.currency,count(*) AS total,sum(o.total_amount) AS amount FROM whatsapp_orders o WHERE ${scope(a.vendorId)} GROUP BY o.status,o.currency`,
      );
      const payments = await tx.$queryRaw<
        { status: string; currency: string; total: bigint; amount: Prisma.Decimal }[]
      >(
        Prisma.sql`SELECT p.status,p.currency,count(*) AS total,sum(p.amount) AS amount FROM whatsapp_payments p WHERE p.vendors__id=${a.vendorId} AND EXISTS (SELECT 1 FROM whatsapp_orders o WHERE o.order_id=p.order_id AND ${scope(a.vendorId)}) GROUP BY p.status,p.currency`,
      );
      const count = (r: typeof rows, states: string[]) =>
        r
          .filter((x) => !states.length || states.includes(x.status))
          .reduce((n, x) => n + Number(x.total), 0);
      const sums = (r: typeof rows, states: string[]) =>
        Object.fromEntries(
          [...new Set(r.map((x) => x.currency))].sort().map((currency) => [
            currency,
            r
              .filter((x) => x.currency === currency && states.includes(x.status))
              .reduce((n, x) => n.add(x.amount), new Prisma.Decimal(0))
              .toString(),
          ]),
        );
      return {
        order_statistics: {
          total_orders: count(rows, []),
          pending_orders: count(rows, ['pending', 'awaiting_address', 'awaiting_payment']),
          completed_orders: count(rows, ['delivered']),
          cancelled_orders: count(rows, ['cancelled']),
          total_revenue_by_currency: sums(rows, ['delivered']),
          pending_revenue_by_currency: sums(rows, ['paid', 'confirmed', 'shipped']),
        },
        payment_statistics: {
          total_payments: count(payments, []),
          successful_payments: count(payments, ['completed']),
          failed_payments: count(payments, ['failed', 'cancelled']),
          pending_payments: count(payments, ['pending', 'processing']),
          total_amount_by_currency: sums(payments, ['completed']),
          pending_amount_by_currency: sums(payments, ['pending', 'processing']),
          refunded_amount_by_currency: sums(payments, ['refunded', 'partially_refunded']),
        },
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  return result(data);
}
