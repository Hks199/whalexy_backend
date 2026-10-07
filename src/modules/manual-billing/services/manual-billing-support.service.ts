import { Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import { ApiError } from '../../../shared/api-error.js';
import { type BillingPlan } from '../../billing-checkout/billing-checkout.service.js';

export type Quote = {
  version: number;
  planId: string;
  title: string;
  amountMinor: number;
  currency: string;
  minorDigits: number;
  interval: string;
  months: number;
  paymentMethod: string;
  expiresAt: number;
  creditSubscriptionId: number | null;
  creditMinor: number;
  creditDays: number;
  startedAt?: string;
  receiptId?: string;
  transactionReference?: string;
  submittedAt?: string;
};

export const subscriptionPeriods: Record<string, number> = {
  monthly: 1,
  half_yearly: 6,
  yearly: 12,
};

export function manualPeriod(start: Date, months: number, creditDays = 0) {
  return DateTime.fromJSDate(start, { zone: 'utc' }).plus({ months, days: creditDays }).toJSDate();
}

export function getPlanPrice(plan: BillingPlan) {
  if (!Intl.supportedValuesOf('currency').includes(plan.currency))
    throw new ApiError(503, 'INVALID_MANUAL_PLAN', 'Configure a supported currency');
  const digits =
    new Intl.NumberFormat('en', { style: 'currency', currency: plan.currency }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  const major = new Prisma.Decimal(plan.amount).div(new Prisma.Decimal(10).pow(digits));
  if (digits > 4 || major.gt('999999999.9999'))
    throw new ApiError(503, 'INVALID_MANUAL_PLAN', 'Plan amount exceeds manual billing precision');
  return { digits, major };
}

export function presentManualSubscription(row: any) {
  const q = row.data?.nativeManual as Quote | undefined;
  return {
    id: row.id,
    uid: row.uid,
    status: row.status,
    planId: row.planId,
    endsAt: row.endsAt,
    createdAt: row.createdAt,
    ...(q
      ? {
          title: q.title,
          amountMinor: q.amountMinor,
          currency: q.currency,
          interval: q.interval,
          paymentMethod: q.paymentMethod,
          creditMinor: q.creditMinor,
          creditDays: q.creditDays,
          quoteExpiresAt: q.expiresAt,
          receiptId: q.receiptId ?? null,
          transactionReference: q.transactionReference ?? null,
        }
      : {}),
    rejectionReason: row.data?.rejectionReason ?? null,
  };
}

export async function lockVendorBilling(tx: Prisma.TransactionClient, vendorId: number) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`manual-billing:${vendorId}`},0))`;
}

export async function assertNoStripeConflict(tx: Prisma.TransactionClient, vendorId: number) {
  if (
    await tx.subscriptions.findFirst({
      where: {
        vendorId,
        type: { not: 'addon_ai_replies' },
        OR: [
          {
            stripeStatus: {
              in: ['active', 'trialing', 'past_due', 'incomplete', 'unpaid', 'paused'],
            },
          },
          { stripeStatus: 'canceled', endsAt: { gt: new Date() } },
        ],
      },
      select: { id: true },
    })
  )
    throw new ApiError(
      409,
      'SUBSCRIPTION_EXISTS',
      'Resolve the current provider subscription before making a manual payment',
    );
  const checkouts = await tx.nativeIdempotency.findMany({
    where: { vendorId, key: { startsWith: 'stripe:checkout:' } },
    select: { response: true },
  });
  if (
    checkouts.some((row) => {
      const value = row.response as any;
      return value?.state !== 'complete' || !['expired'].includes(value?.result?.status);
    })
  )
    throw new ApiError(
      409,
      'CHECKOUT_EXISTS',
      'Reconcile existing provider checkout before making a manual payment',
    );
}

export async function calculateSubscriptionCredit(
  tx: Prisma.TransactionClient,
  vendorId: number,
  plan: BillingPlan,
  at: Date,
) {
  const rows = await tx.manualSubscriptions.findMany({
    where: { vendorId, status: 'active', OR: [{ endsAt: null }, { endsAt: { gt: at } }] },
  });
  if (rows.length > 1)
    throw new ApiError(
      409,
      'MANUAL_BALANCE_AMBIGUOUS',
      'Reconcile multiple active manual subscriptions first',
    );
  const current = rows[0];
  if (!current) return { creditSubscriptionId: null, creditMinor: 0, creditDays: 0 };
  const old = (current.data as any)?.nativeManual as Quote | undefined;
  if (
    !old?.startedAt ||
    !current.endsAt ||
    old.currency !== plan.currency ||
    !Number.isSafeInteger(old.amountMinor) ||
    old.amountMinor < 0 ||
    !Number.isSafeInteger(old.creditMinor) ||
    old.creditMinor < 0
  )
    throw new ApiError(
      409,
      'MANUAL_BALANCE_UNVERIFIED',
      'Reconcile the existing subscription balance and currency first',
    );
  const start = new Date(old.startedAt).getTime(),
    total = current.endsAt.getTime() - start,
    remaining = current.endsAt.getTime() - at.getTime();
  if (!Number.isFinite(start) || total <= 0 || remaining > total)
    throw new ApiError(409, 'MANUAL_BALANCE_UNVERIFIED', 'Existing subscription period is invalid');
  // Carry remaining monetary value forward as whole days, preserving source
  // extension behavior. Integer minor units avoid floating monetary rounding.
  const amount = old.amountMinor + old.creditMinor;
  const creditMinor =
    remaining > 0
      ? new Prisma.Decimal(amount)
          .mul(remaining)
          .div(total)
          .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
          .toNumber()
      : 0;
  const days =
    (manualPeriod(at, subscriptionPeriods[plan.interval]).getTime() - at.getTime()) / 86400000;
  const creditDays =
    plan.amount > 0
      ? new Prisma.Decimal(creditMinor).mul(days).div(plan.amount).floor().toNumber()
      : 0;
  if (creditDays > 3650)
    throw new ApiError(409, 'MANUAL_BALANCE_UNVERIFIED', 'Carry-forward duration requires review');
  return { creditSubscriptionId: current.id, creditMinor, creditDays };
}

export async function reviewNativeManual(
  tx: Prisma.TransactionClient,
  current: any,
  actorId: number,
  action: 'approve' | 'reject',
  endsAt?: Date,
) {
  const quote = current.data?.nativeManual as Quote | undefined;
  if (!quote) {
    if (action === 'approve' && !endsAt)
      throw new ApiError(
        400,
        'ENDS_AT_REQUIRED',
        'Legacy payment review needs an explicit expiry date',
      );
    return { endsAt };
  }
  if (action === 'reject') return {};
  if (endsAt)
    throw new ApiError(
      400,
      'SERVER_CALCULATED_PERIOD',
      'Native payment expiry is calculated from its stored quote',
    );
  if (
    !quote.receiptId ||
    !quote.transactionReference ||
    quote.version !== 1 ||
    !subscriptionPeriods[quote.interval] ||
    quote.months !== subscriptionPeriods[quote.interval]
  )
    throw new ApiError(
      409,
      'PAYMENT_PROOF_REQUIRED',
      'A native submitted quote and payment evidence are required',
    );
  await assertNoStripeConflict(tx, current.vendorId);
  const at = new Date();
  const active = await tx.manualSubscriptions.findMany({
    where: {
      vendorId: current.vendorId,
      status: 'active',
      OR: [{ endsAt: null }, { endsAt: { gt: at } }],
    },
  });
  const expired =
    quote.creditSubscriptionId !== null
      ? await tx.manualSubscriptions.findFirst({
          where: {
            id: quote.creditSubscriptionId,
            vendorId: current.vendorId,
            status: 'active',
            endsAt: { lte: at },
          },
        })
      : null;
  if (
    active.length > 1 ||
    (active.length === 1 && active[0].id !== quote.creditSubscriptionId) ||
    (active.length === 0 && quote.creditSubscriptionId !== null && !expired)
  )
    throw new ApiError(
      409,
      'MANUAL_BALANCE_CHANGED',
      'Subscription balance changed; review a fresh quote',
    );
  const plan: BillingPlan = {
    id: quote.planId,
    title: quote.title,
    priceId: 'price_snapshot',
    interval: quote.interval as BillingPlan['interval'],
    amount: quote.amountMinor,
    currency: quote.currency,
  };
  const balance = await calculateSubscriptionCredit(tx, current.vendorId, plan, at),
    expiry = manualPeriod(at, quote.months, balance.creditDays),
    vendor = await tx.vendors.findUniqueOrThrow({
      where: { id: current.vendorId },
      select: { title: true },
    });
  const invoice = {
    id: `MS-${current.uid}`,
    subscriptionId: current.id,
    vendorId: current.vendorId,
    businessName: vendor.title,
    title: quote.title,
    planId: quote.planId,
    amountMinor: quote.amountMinor,
    currency: quote.currency,
    minorDigits: quote.minorDigits,
    interval: quote.interval,
    paid: true,
    issuedAt: at.toISOString(),
    periodStartsAt: at.toISOString(),
    periodEndsAt: expiry.toISOString(),
    creditMinor: balance.creditMinor,
    creditDays: balance.creditDays,
    transactionReference: quote.transactionReference,
    paymentMethod: quote.paymentMethod,
    reviewedBy: actorId,
  };
  await tx.manualSubscriptions.updateMany({
    where: { vendorId: current.vendorId, status: 'active' },
    data: { status: 'superseded', updatedAt: at },
  });
  return {
    endsAt: expiry,
    nativeManual: { ...quote, ...balance, startedAt: at.toISOString() },
    invoice,
  };
}
