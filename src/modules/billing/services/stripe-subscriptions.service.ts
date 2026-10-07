import { Prisma, type OutboxJobs } from '@prisma/client';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { digest } from '../../../utils/crypto.js';
import {
  supportedBillingProviders,
  parseStripeId,
  throwSubscriptionResponseError,
  parseProviderTimestamp,
  subscriptionStatusMap,
} from './billing-support.service.js';

export async function ingestStripeSubscription(
  job: OutboxJobs,
  client?: Prisma.TransactionClient,
  authoritative = false,
) {
  const payload = job.payload as any,
    body = payload.body;
  if (!supportedBillingProviders.includes(body?.type))
    throw new ApiError(
      503,
      'WEBHOOK_HANDLER_PENDING',
      'Stripe event type requires another handler',
    );
  const eventId = parseStripeId(body.id, 'evt'),
    subscription = body.data?.object;
  if (!subscription || subscription.object !== 'subscription')
    throwSubscriptionResponseError('Subscription snapshot is required');
  const subscriptionId = parseStripeId(subscription.id, 'sub');
  const customerId = parseStripeId(
    typeof subscription.customer === 'object' ? subscription.customer?.id : subscription.customer,
    'cus',
  );
  const created = parseProviderTimestamp(body.created, true)!;
  if (created.getTime() > Date.now() + 300000)
    throwSubscriptionResponseError('Event timestamp is in the future');
  const deleted = body.type === 'customer.subscription.deleted';
  if (
    !subscriptionStatusMap.includes(subscription.status) ||
    (deleted && subscription.status !== 'canceled')
  )
    throwSubscriptionResponseError('Invalid subscription status');
  const incomingItems = subscription.items?.data;
  if (
    !deleted &&
    (!Array.isArray(incomingItems) ||
      !incomingItems.length ||
      incomingItems.length > 100 ||
      subscription.items.has_more)
  ) {
    throw new ApiError(
      503,
      'STRIPE_ITEMS_PENDING',
      'A complete subscription item snapshot is required',
    );
  }
  const items = !deleted
    ? incomingItems.map((item: any) => {
        const price = item.price ?? item.plan;
        const quantity = item.quantity ?? null;
        if (
          quantity !== null &&
          (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > 2147483647)
        )
          throwSubscriptionResponseError('Invalid subscription quantity');
        return {
          stripeId: parseStripeId(item.id, 'si'),
          stripePrice: parseStripeId(typeof price === 'string' ? price : price?.id, 'price'),
          stripeProduct: price?.product
            ? parseStripeId(
                typeof price.product === 'string' ? price.product : price.product?.id,
                'prod',
              )
            : null,
          quantity,
          periodEnd: parseProviderTimestamp(item.current_period_end),
        };
      })
    : [];
  if (new Set(items.map((item: any) => item.stripeId)).size !== items.length)
    throwSubscriptionResponseError('Duplicate subscription items');
  const periodEnds: Date[] = items.map((item: any) => item.periodEnd).filter(Boolean);
  const periodEnd =
    parseProviderTimestamp(subscription.current_period_end) ??
    (periodEnds.length ? new Date(Math.min(...periodEnds.map((d) => d.getTime()))) : null);
  const cancellation =
    parseProviderTimestamp(subscription.cancel_at) ??
    (subscription.cancel_at_period_end ? periodEnd : null);
  if (!deleted && subscription.cancel_at_period_end && !cancellation)
    throwSubscriptionResponseError('Cancellation requires a period end');
  const snapshotHash = digest(
    JSON.stringify({
      customerId,
      status: subscription.status,
      deleted,
      cancellation: cancellation?.toISOString() ?? null,
      trialEnd: subscription.trial_end ?? null,
      periodEnd: periodEnd?.toISOString() ?? null,
      type: subscription.metadata?.type ?? null,
      items: items
        .map((item: any) => ({ ...item, periodEnd: item.periodEnd?.toISOString() ?? null }))
        .sort((a: any, b: any) => a.stripeId.localeCompare(b.stripeId)),
    }),
  );
  const apply = async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`stripe-subscription:${subscriptionId}`},0))`;
    const receipt = await tx.webhookReceipts.findUnique({ where: { eventKey: payload.eventKey } });
    if (!receipt || receipt.provider !== 'stripe')
      throwSubscriptionResponseError('Signed Stripe receipt is missing');
    if (receipt.processedAt) return;
    const vendors = await tx.vendors.findMany({
      where: { stripeId: customerId },
      select: { id: true },
      take: 2,
    });
    if (vendors.length !== 1)
      throw new ApiError(
        503,
        'UNROUTABLE_CUSTOMER',
        'Stripe customer must map to exactly one business',
      );
    const vendorId = vendors[0].id;
    const existing = await tx.subscriptions.findMany({
      where: { stripeId: subscriptionId },
      take: 2,
    });
    if (existing.length > 1 || (existing[0] && existing[0].vendorId !== vendorId))
      throw new ApiError(
        409,
        'SUBSCRIPTION_OWNER_MISMATCH',
        'Subscription ownership cannot be reconciled',
      );
    const stateKey = `stripe-state:${subscriptionId}`,
      state = await tx.webhookReceipts.findUnique({ where: { eventKey: stateKey } });
    const previous = state?.payload as any;
    if (
      !authoritative &&
      !previous?.deleted &&
      previous?.created === body.created &&
      !deleted &&
      previous.snapshotHash !== snapshotHash
    )
      throw new ApiError(
        503,
        'STRIPE_REVISION_PENDING',
        'Conflicting events with the same timestamp require an authoritative provider reconciliation',
      );
    if (
      previous?.deleted ||
      (!authoritative &&
        (previous?.created > body.created || (previous?.created === body.created && !deleted)))
    ) {
      await tx.webhookReceipts.update({
        where: { eventKey: payload.eventKey },
        data: { processedAt: new Date() },
      });
      return;
    }
    const name = subscription.metadata?.type ?? existing[0]?.type ?? 'default';
    if (typeof name !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(name))
      throwSubscriptionResponseError('Invalid subscription type');
    const endsAt = deleted
      ? (parseProviderTimestamp(subscription.ended_at) ?? created)
      : cancellation;
    const data = {
      type: name,
      stripeStatus: deleted ? 'canceled' : subscription.status,
      endsAt,
      trialEndsAt: parseProviderTimestamp(subscription.trial_end),
      stripePrice: deleted
        ? (existing[0]?.stripePrice ?? null)
        : items.length === 1
          ? items[0].stripePrice
          : null,
      quantity: deleted
        ? (existing[0]?.quantity ?? null)
        : items.length === 1
          ? items[0].quantity
          : null,
      updatedAt: new Date(),
    };
    const saved = existing[0]
      ? await tx.subscriptions.update({ where: { id: existing[0].id }, data })
      : await tx.subscriptions.create({ data: { ...data, vendorId, stripeId: subscriptionId } });
    if (!deleted) {
      await tx.subscriptionItems.deleteMany({ where: { subscriptionId: saved.id } });
      await tx.subscriptionItems.createMany({
        data: items.map(({ periodEnd: _periodEnd, ...item }: any) => ({
          ...item,
          subscriptionId: saved.id,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
      });
    }
    // Only pre-linked paid records are changed. Metadata cannot grant an entitlement to another business.
    const addons = await tx.subscriptionAddons.findMany({
      where: {
        vendorId,
        source: 'paid',
        paymentProvider: 'stripe',
        providerSubscriptionReference: subscriptionId,
      },
    });
    for (const addon of addons) {
      if (
        deleted ||
        ['canceled', 'unpaid', 'incomplete_expired', 'paused'].includes(subscription.status)
      ) {
        await tx.subscriptionAddons.update({
          where: { id: addon.id },
          data: { status: 'suspended', disabledAt: created, updatedAt: new Date() },
        });
      } else if (subscription.status === 'active' && periodEnd && periodEnd > new Date()) {
        await tx.subscriptionAddons.update({
          where: { id: addon.id },
          data: {
            status: 'active',
            startedAt: addon.startedAt ?? created,
            expiresAt: periodEnd,
            disabledAt: null,
            updatedAt: new Date(),
          },
        });
      }
    }
    await tx.webhookReceipts.upsert({
      where: { eventKey: stateKey },
      create: {
        provider: 'stripe-state',
        eventKey: stateKey,
        payload: { created: body.created, eventId, deleted, snapshotHash },
        processedAt: new Date(),
      },
      update: {
        payload: { created: body.created, eventId, deleted, snapshotHash },
        processedAt: new Date(),
      },
    });
    await tx.webhookReceipts.update({
      where: { eventKey: payload.eventKey },
      data: { processedAt: new Date() },
    });
  };
  if (client) await apply(client);
  else await db.$transaction(apply);
}
