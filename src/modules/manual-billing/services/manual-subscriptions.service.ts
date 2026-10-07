import { Prisma } from '@prisma/client';
import { db } from '../../../database/client.js';
import { digest } from '../../../utils/crypto.js';
import { ApiError } from '../../../shared/api-error.js';
import { billingPlans } from '../../billing-checkout/billing-checkout.service.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { headerValue } from '../../../utils/headers.js';
import {
  presentManualSubscription,
  lockVendorBilling,
  getPlanPrice,
  assertNoStripeConflict,
  calculateSubscriptionCredit,
  Quote,
  subscriptionPeriods,
  manualPeriod,
} from './manual-billing-support.service.js';

export async function listManualSubscriptions(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!,
    { page, limit } = requestInput.validatedQuery;
  const [items, total] = await Promise.all([
    db.manualSubscriptions.findMany({
      where: { vendorId },
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { id: 'desc' },
    }),
    db.manualSubscriptions.count({ where: { vendorId } }),
  ]);
  return serviceResult(
    { items: items.map(presentManualSubscription), total, page, limit },
    { status: 200, format: 'json' },
  );
}

export async function quoteManualSubscription(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!,
    raw = headerValue(requestInput.headers, 'Idempotency-Key');
  if (!raw || !/^[A-Za-z0-9_-]{8,100}$/.test(raw))
    throw new ApiError(400, 'IDEMPOTENCY_REQUIRED', 'A valid Idempotency-Key is required');
  const key = `manual-quote:${raw}`,
    hash = digest(JSON.stringify(requestInput.body));
  const result = await db.$transaction(async (tx) => {
    await lockVendorBilling(tx, vendorId);
    const prior = await tx.nativeIdempotency.findUnique({
      where: { vendorId_key: { vendorId, key } },
    });
    if (prior) {
      if (prior.requestHash !== hash)
        throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Quote key was used for another request');
      return prior.response;
    }
    const plan = billingPlans().find((p) => p.id === requestInput.body.planId);
    if (!plan?.manualPayments)
      throw new ApiError(400, 'INVALID_MANUAL_PLAN', 'This plan does not allow manual payments');
    const { major, digits } = getPlanPrice(plan);
    await assertNoStripeConflict(tx, vendorId);
    const at = new Date();
    const pending = await tx.manualSubscriptions.findFirst({
      where: { vendorId, status: 'pending' },
      select: { id: true },
    });
    if (pending)
      throw new ApiError(
        409,
        'MANUAL_REQUEST_PENDING',
        'A payment request is already awaiting review',
      );
    await tx.manualSubscriptions.updateMany({
      where: { vendorId, status: 'initiated' },
      data: { status: 'cancelled', updatedAt: at },
    });
    const balance = await calculateSubscriptionCredit(tx, vendorId, plan, at),
      quote: Quote = {
        version: 1,
        planId: plan.id,
        title: plan.title,
        amountMinor: plan.amount,
        currency: plan.currency,
        minorDigits: digits,
        interval: plan.interval,
        months: subscriptionPeriods[plan.interval],
        paymentMethod: requestInput.body.paymentMethod,
        expiresAt: at.getTime() + 900000,
        ...balance,
      };
    const row = await tx.manualSubscriptions.create({
      data: {
        vendorId,
        planId: plan.id,
        charges: major,
        chargesFrequency: plan.interval,
        status: 'initiated',
        endsAt: manualPeriod(at, quote.months, quote.creditDays),
        data: { nativeManual: quote as unknown as Prisma.InputJsonValue },
      },
    });
    const result = JSON.parse(JSON.stringify(presentManualSubscription(row)));
    await tx.nativeIdempotency.create({
      data: { vendorId, key, requestHash: hash, response: result },
    });
    await tx.auditEvents.create({
      data: {
        vendorId,
        actorId: requestInput.identity!.userId,
        action: 'quote',
        resource: 'manual-subscription',
        resourceId: String(row.id),
      },
    });
    return result;
  });
  return serviceResult(result, { status: 201, format: 'json' });
}

export async function getManualSubscription(requestInput: ServiceContext) {
  const row = await db.manualSubscriptions.findFirst({
    where: { id: Number(requestInput.params.id), vendorId: requestInput.identity!.vendorId! },
  });
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Payment request not found');
  return serviceResult(presentManualSubscription(row), { status: 200, format: 'json' });
}

export async function submitManualPayment(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!,
    id = Number(requestInput.params.id),
    b = requestInput.body;
  const row = await db.$transaction(async (tx) => {
    await lockVendorBilling(tx, vendorId);
    const current = await tx.manualSubscriptions.findFirst({ where: { id, vendorId } }),
      q = (current?.data as any)?.nativeManual as Quote | undefined;
    if (!current || !q) throw new ApiError(404, 'NOT_FOUND', 'Native payment request not found');
    if (
      current.status === 'pending' &&
      q.transactionReference === b.transactionReference &&
      q.receiptId === b.receiptId
    )
      return current;
    if (current.status !== 'initiated' || q.expiresAt <= Date.now())
      throw new ApiError(409, 'QUOTE_EXPIRED', 'Create a fresh quote before submitting payment');
    await assertNoStripeConflict(tx, vendorId);
    const receipt = await tx.nativeMedia.findFirst({
      where: {
        id: b.receiptId,
        vendorId,
        ownerId: requestInput.identity!.userId,
        mimeType: { in: ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'] },
      },
    });
    if (!receipt)
      throw new ApiError(
        400,
        'INVALID_RECEIPT',
        'Choose your uploaded payment receipt from this business',
      );
    const reference = `manual-payment:${q.paymentMethod}:${b.transactionReference}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${reference},0))`;
    if (await tx.nativeIdempotency.findFirst({ where: { key: reference }, select: { id: true } }))
      throw new ApiError(
        409,
        'PAYMENT_REFERENCE_USED',
        'Payment reference has already been submitted',
      );
    await tx.nativeIdempotency.create({
      data: {
        vendorId,
        key: reference,
        requestHash: digest(`${id}:${b.receiptId}`),
        response: { subscriptionId: id },
      },
    });
    const row = await tx.manualSubscriptions.update({
      where: { id },
      data: {
        status: 'pending',
        data: {
          ...(current.data as any),
          nativeManual: {
            ...q,
            transactionReference: b.transactionReference,
            receiptId: b.receiptId,
            submittedAt: new Date().toISOString(),
          },
        },
        updatedAt: new Date(),
      },
    });
    await tx.auditEvents.create({
      data: {
        vendorId,
        actorId: requestInput.identity!.userId,
        action: 'submit-payment',
        resource: 'manual-subscription',
        resourceId: String(id),
      },
    });
    return row;
  });
  return serviceResult(presentManualSubscription(row), { status: 200, format: 'json' });
}

export async function cancelManualPayment(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!,
    id = Number(requestInput.params.id);
  const row = await db.$transaction(async (tx) => {
    await lockVendorBilling(tx, vendorId);
    const current = await tx.manualSubscriptions.findFirst({ where: { id, vendorId } });
    if (!current) throw new ApiError(404, 'NOT_FOUND', 'Payment request not found');
    if (!['initiated', 'pending'].includes(current.status))
      throw new ApiError(
        409,
        'SUBSCRIPTION_STATE',
        'Only an unreviewed payment request can be cancelled',
      );
    await tx.auditEvents.create({
      data: {
        vendorId,
        actorId: requestInput.identity!.userId,
        action: 'cancel-payment',
        resource: 'manual-subscription',
        resourceId: String(id),
      },
    });
    return tx.manualSubscriptions.update({
      where: { id },
      data: { status: 'cancelled', updatedAt: new Date() },
    });
  });
  return serviceResult(presentManualSubscription(row), { status: 200, format: 'json' });
}
