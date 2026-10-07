import { Prisma } from '@prisma/client';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { digest } from '../../../utils/crypto.js';
import { access, scope, select, revision } from './order-support.service.js';
export async function updateStatus(input: ServiceContext) {
  const raw = input.headers['idempotency-key'];
  if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(raw))
    throw new ApiError(400, 'IDEMPOTENCY_REQUIRED', 'A valid Idempotency-Key is required');
  const hash = digest(
    JSON.stringify([input.params.orderUid, input.body.status, input.body.revision]),
  );
  const response = await db.$transaction(
    async (tx) => {
      const a = await access(tx, input);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`whalexy:order-status:${a.vendorId}`},0))`;
      const name = `legacy-order-status:${a.vendorId}:${input.identity!.userId}:${raw}`;
      const replays = await tx.configurations.findMany({ where: { name }, take: 2 });
      if (replays.length > 1)
        throw new ApiError(409, 'ORDER_REVIEW_REQUIRED', 'Duplicate replay entries');
      if (replays.length) {
        let stored: any;
        try {
          stored = JSON.parse(replays[0].value ?? '');
        } catch {
          throw new ApiError(409, 'ORDER_REVIEW_REQUIRED', 'Invalid replay entry');
        }
        if (!stored || stored.nativeVersion !== 1 || stored.response?.reaction !== 1)
          throw new ApiError(409, 'ORDER_REVIEW_REQUIRED', 'Invalid replay response');
        if (stored.hash !== hash)
          throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Key was used for another status change');
        return stored.response;
      }
      const locked = await tx.$queryRaw<{ id: number }[]>(
        Prisma.sql`SELECT o._id AS id FROM whatsapp_orders o WHERE o._uid=${input.params.orderUid} AND ${scope(a.vendorId)} FOR UPDATE OF o`,
      );
      if (!locked.length) throw new ApiError(404, 'NOT_FOUND', 'Order not found');
      const row = await tx.whatsappOrders.findUniqueOrThrow({
        where: { id: locked[0].id },
        select,
      });
      if (revision(row) !== input.body.revision)
        throw new ApiError(409, 'ORDER_CONFLICT', 'Order changed; read again before saving');
      const next = input.body.status;
      if (['paid', 'refunded'].includes(next))
        throw new ApiError(
          409,
          'PAYMENT_RECONCILIATION_REQUIRED',
          'Payment and refund states require verified provider reconciliation',
        );
      const transitions: Record<string, string[]> = {
        pending: ['awaiting_address', 'awaiting_payment', 'cancelled'],
        awaiting_address: ['awaiting_payment', 'cancelled'],
        awaiting_payment: ['cancelled'],
        paid: ['confirmed'],
        confirmed: ['shipped'],
        shipped: ['delivered'],
        delivered: [],
        cancelled: [],
        refunded: [],
      };
      if (next !== row.status && !transitions[row.status]?.includes(next))
        throw new ApiError(
          409,
          'INVALID_ORDER_TRANSITION',
          'Order transition requires reconciliation',
        );
      if (next === 'cancelled' && next !== row.status) {
        if (
          (row.paymentStatus && !['failed', 'cancelled'].includes(row.paymentStatus)) ||
          (await tx.whatsappPayments.count({
            where: {
              vendorId: a.vendorId,
              orderId: row.orderId,
              status: { notIn: ['failed', 'cancelled'] },
            },
          }))
        )
          throw new ApiError(
            409,
            'PAYMENT_RECONCILIATION_REQUIRED',
            'Resolve payments before cancellation',
          );
      }
      if (['confirmed', 'shipped', 'delivered'].includes(next) && next !== row.status) {
        const payments = await tx.whatsappPayments.findMany({
          where: {
            vendorId: a.vendorId,
            orderId: row.orderId,
            status: 'completed',
            currency: row.currency,
            gateway: 'razorpay',
            amount: row.totalAmount.sub(row.discountAmount),
          },
          take: 2,
        });
        const payment = payments.length === 1 ? payments[0] : null;
        if (
          row.paymentStatus !== 'completed' ||
          !payment ||
          !/^pay_[A-Za-z0-9]{1,200}$/.test(payment.paymentId) ||
          !(await tx.webhookReceipts.findFirst({
            where: {
              provider: 'razorpay',
              eventKey: `payment:payment.captured:${payment.paymentId}`,
              processedAt: { not: null },
            },
            select: { id: true },
          }))
        )
          throw new ApiError(
            409,
            'PAYMENT_RECONCILIATION_REQUIRED',
            'Fulfillment requires a reconciled matching payment',
          );
      }
      const at = new Date();
      const saved =
        next === row.status
          ? row
          : await tx.whatsappOrders.update({
              where: { id: row.id },
              data: {
                status: next,
                updatedAt: at,
                ...(next === 'shipped' ? { shippedAt: at } : {}),
                ...(next === 'delivered' ? { deliveredAt: at } : {}),
              },
              select,
            });
      await tx.auditEvents.create({
        data: {
          vendorId: a.vendorId,
          actorId: input.identity!.userId,
          action: 'status',
          resource: 'whatsapp-order',
          resourceId: String(row.id),
          metadata: { previous: row.status, status: next },
        },
      });
      const response = {
        reaction: 1,
        message: 'Order status updated successfully',
        data: {
          _uid: saved.uid,
          status: saved.status,
          revision: revision(saved),
          shipped_at: saved.shippedAt,
          delivered_at: saved.deliveredAt,
        },
      };
      await tx.configurations.create({
        data: { name, dataType: 4, value: JSON.stringify({ nativeVersion: 1, hash, response }) },
      });
      return response;
    },
    { timeout: 15000 },
  );
  return serviceResult(response, { status: 200, format: 'json' });
}
