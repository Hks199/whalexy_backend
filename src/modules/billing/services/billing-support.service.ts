import { Prisma } from '@prisma/client';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';

export async function baseSubscriptionActive(
  vendorId: number,
  at = new Date(),
  client: Prisma.TransactionClient = db,
) {
  return Boolean(
    (await client.subscriptions.findFirst({
      where: {
        vendorId,
        type: { not: 'addon_ai_replies' },
        OR: [
          {
            stripeStatus: { in: ['active', 'trialing'] },
            OR: [{ endsAt: null }, { endsAt: { gt: at } }],
          },
          { stripeStatus: 'canceled', endsAt: { gt: at } },
        ],
      },
      select: { id: true },
    })) ||
    (await client.manualSubscriptions.findFirst({
      where: { vendorId, status: 'active', OR: [{ endsAt: null }, { endsAt: { gt: at } }] },
      select: { id: true },
    })),
  );
}

export const supportedBillingProviders = [
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
];

export const subscriptionStatusMap = [
  'incomplete',
  'incomplete_expired',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'paused',
];

export function throwSubscriptionResponseError(message: string): never {
  throw new ApiError(400, 'INVALID_STRIPE_EVENT', message);
}

export function parseStripeId(value: unknown, prefix: string) {
  if (typeof value !== 'string' || !new RegExp(`^${prefix}_[A-Za-z0-9]{1,200}$`).test(value))
    throwSubscriptionResponseError('Invalid Stripe resource identifier');
  return value;
}

export function parseProviderTimestamp(value: unknown, required = false) {
  if (value == null) {
    if (required) throwSubscriptionResponseError('Stripe timestamp is required');
    return null;
  }
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 253402300799)
    throwSubscriptionResponseError('Invalid Stripe timestamp');
  return new Date(Number(value) * 1000);
}
