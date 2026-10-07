import { Prisma, type OutboxJobs } from '@prisma/client';
import { db } from '../../database/client.js';
import { ApiError } from '../../shared/api-error.js';
import { once } from '../services/webhook-receipts.service.js';

export async function paymentWebhook(provider: string, body: any) {
  if (provider !== 'razorpay')
    throw new ApiError(
      503,
      'WEBHOOK_HANDLER_PENDING',
      'Stripe subscription reconciliation requires a verified handler',
    );
  const entity = body.payload?.payment?.entity;
  if (!entity || !['payment.captured', 'payment.failed'].includes(body.event))
    throw new ApiError(503, 'WEBHOOK_HANDLER_PENDING', 'Payment event requires a verified handler');
  if (
    typeof entity.id !== 'string' ||
    !/^pay_[A-Za-z0-9]{1,200}$/.test(entity.id) ||
    !/^\d{1,15}$/.test(String(entity.amount)) ||
    entity.status !== (body.event === 'payment.captured' ? 'captured' : 'failed')
  )
    throw new ApiError(400, 'INVALID_PAYMENT_EVENT', 'Invalid Razorpay payment snapshot');
  const matches = await db.whatsappPayments.findMany({
    where: { paymentId: entity.id, gateway: 'razorpay' },
    take: 2,
  });
  if (matches.length !== 1)
    throw new ApiError(
      503,
      'UNROUTABLE_PAYMENT',
      'Payment must map to exactly one registered record',
    );
  const payment = matches[0];
  const amount = new Prisma.Decimal(String(entity.amount)).dividedBy(100);
  if (!amount.equals(payment.amount) || entity.currency !== payment.currency)
    throw new ApiError(409, 'PAYMENT_MISMATCH', 'Payment amount or currency does not match');
  await once(`payment:${body.event}:${entity.id}`, 'razorpay', body, async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`razorpay-payment:${entity.id}`},0))`;
    const current = await tx.whatsappPayments.findUniqueOrThrow({ where: { id: payment.id } });
    if (!amount.equals(current.amount) || entity.currency !== current.currency)
      throw new ApiError(409, 'PAYMENT_MISMATCH', 'Payment changed before reconciliation');
    if (current.status === 'completed' && body.event === 'payment.failed') return;
    const completed = body.event === 'payment.captured';
    await tx.whatsappPayments.update({
      where: { id: payment.id },
      data: {
        status: completed ? 'completed' : 'failed',
        paymentCompletedAt: completed ? new Date() : null,
      },
    });
    if (completed)
      await tx.whatsappOrders.updateMany({
        where: { orderId: payment.orderId, vendorId: payment.vendorId },
        data: { status: 'paid', paymentStatus: 'completed', paymentCompletedAt: new Date() },
      });
  });
}
export async function handleRazorpayWebhook(job: OutboxJobs) {
  const payload = job.payload as any;

  await paymentWebhook('razorpay', payload.body);
  await db.webhookReceipts.update({
    where: { eventKey: payload.eventKey },
    data: { processedAt: new Date() },
  });
  return;
}
