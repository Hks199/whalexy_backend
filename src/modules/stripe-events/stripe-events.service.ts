import type { OutboxJobs, Prisma } from '@prisma/client';
import { db } from '../../database/client.js';
import { ApiError } from '../../shared/api-error.js';
import {
  providerId,
  stripeConfigured,
  stripeRequest,
} from '../../infrastructure/providers/stripe.client.js';
import { ingestStripeSubscription } from '../billing/services/stripe-subscriptions.service.js';

export async function fullSubscription(id: string) {
  const row = await stripeRequest(`/subscriptions/${providerId(id, 'sub')}`);
  if (row.id !== id || row.object !== 'subscription' || !Array.isArray(row.items?.data))
    throw new ApiError(502, 'PROVIDER_RESPONSE', 'Invalid subscription response');
  if (row.items.has_more) {
    const all: any[] = [],
      seen = new Set<string>();
    let after: string | undefined;
    for (let page = 0; page < 100; page++) {
      const list = await stripeRequest('/subscription_items', undefined, undefined, {
        subscription: id,
        limit: '100',
        ...(after ? { starting_after: after } : {}),
      });
      if (!Array.isArray(list.data) || list.data.length > 100)
        throw new ApiError(502, 'PROVIDER_RESPONSE', 'Invalid subscription item list');
      for (const item of list.data) {
        if (item.subscription !== id || seen.has(item.id))
          throw new ApiError(502, 'PROVIDER_RESPONSE', 'Invalid or duplicate subscription item');
        seen.add(providerId(item.id, 'si'));
        all.push(item);
      }
      if (!list.has_more) {
        row.items = { data: all, has_more: false };
        return row;
      }
      const last = list.data.at(-1)?.id;
      if (!last || last === after)
        throw new ApiError(502, 'PROVIDER_RESPONSE', 'Subscription pagination did not advance');
      after = last;
    }
    throw new ApiError(503, 'STRIPE_ITEMS_PENDING', 'Subscription pagination exceeded its bound');
  }
  return row;
}
export async function ingestStripeEvent(job: OutboxJobs) {
  const p = job.payload as any,
    event = p.body,
    type = String(event?.type ?? ''),
    object = event?.data?.object;
  if (type.startsWith('customer.subscription.') && !stripeConfigured())
    return ingestStripeSubscription(job);
  let subscriptionId: string, customerId: string;
  if (
    [
      'customer.subscription.created',
      'customer.subscription.updated',
      'customer.subscription.deleted',
    ].includes(type)
  ) {
    subscriptionId = providerId(object?.id, 'sub');
    customerId = providerId(
      typeof object.customer === 'object' ? object.customer?.id : object.customer,
      'cus',
    );
  } else if (
    [
      'checkout.session.completed',
      'checkout.session.async_payment_succeeded',
      'checkout.session.async_payment_failed',
      'checkout.session.expired',
    ].includes(type)
  ) {
    const id = providerId(object?.id, 'cs');
    customerId = providerId(
      typeof object.customer === 'object' ? object.customer?.id : object.customer,
      'cus',
    );
    const vendor = await db.vendors.findMany({
      where: { stripeId: customerId },
      select: { id: true },
      take: 2,
    });
    if (vendor.length !== 1)
      throw new ApiError(
        503,
        'UNROUTABLE_CUSTOMER',
        'Checkout customer must map to exactly one business',
      );
    const tracked = await db.nativeIdempotency.findFirst({
      where: {
        vendorId: vendor[0].id,
        key: { startsWith: 'stripe:checkout:' },
        response: { path: ['result', 'id'], equals: id },
      },
    });
    if (!tracked)
      throw new ApiError(503, 'UNROUTABLE_CHECKOUT', 'Checkout is not a tracked business request');
    const session = await stripeRequest(`/checkout/sessions/${id}`);
    if (session.id !== id || session.customer !== customerId || session.mode !== 'subscription')
      throw new ApiError(409, 'CHECKOUT_OWNER_MISMATCH', 'Checkout ownership cannot be reconciled');
    await db.nativeIdempotency.update({
      where: { id: tracked.id },
      data: { response: { state: 'complete', result: session as Prisma.InputJsonObject } },
    });
    if (session.status === 'expired') {
      await db.webhookReceipts.update({
        where: { eventKey: p.eventKey },
        data: { processedAt: new Date() },
      });
      return;
    }
    if (session.status !== 'complete' || !session.subscription)
      throw new ApiError(
        503,
        'STRIPE_CHECKOUT_PENDING',
        'Checkout is not complete at the provider',
      );
    subscriptionId = providerId(
      typeof session.subscription === 'object' ? session.subscription.id : session.subscription,
      'sub',
    );
  } else if (
    [
      'invoice.paid',
      'invoice.payment_failed',
      'invoice.payment_action_required',
      'invoice.finalized',
    ].includes(type)
  ) {
    providerId(object?.id, 'in');
    customerId = providerId(
      typeof object.customer === 'object' ? object.customer?.id : object.customer,
      'cus',
    );
    const ref = object.subscription ?? object.parent?.subscription_details?.subscription;
    if (!ref)
      throw new ApiError(
        503,
        'WEBHOOK_HANDLER_PENDING',
        'Invoice does not belong to a subscription',
      );
    subscriptionId = providerId(typeof ref === 'object' ? ref.id : ref, 'sub');
  } else
    throw new ApiError(
      503,
      'WEBHOOK_HANDLER_PENDING',
      'Stripe event type requires another handler',
    );
  // Serialize provider reads with local writes. Later reads cannot be overwritten by
  // an earlier request whose response arrived late; webhook timestamps are not used
  // to infer the ordering of current provider snapshots.
  await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`stripe-subscription:${subscriptionId}`},0))`;
      if ((await tx.webhookReceipts.findUnique({ where: { eventKey: p.eventKey } }))?.processedAt)
        return;
      const snapshot = await fullSubscription(subscriptionId),
        actualCustomer =
          typeof snapshot.customer === 'object' ? snapshot.customer?.id : snapshot.customer;
      if (actualCustomer !== customerId)
        throw new ApiError(
          409,
          'SUBSCRIPTION_OWNER_MISMATCH',
          'Provider subscription belongs to another customer',
        );
      const body = {
        ...event,
        type:
          snapshot.status === 'canceled'
            ? 'customer.subscription.deleted'
            : 'customer.subscription.updated',
        created: Math.floor(Date.now() / 1000),
        data: { object: snapshot },
      };
      await ingestStripeSubscription({ ...job, payload: { ...p, body } }, tx, true);
    },
    { timeout: 30000, maxWait: 10000 },
  );
}
