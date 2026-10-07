import { randomUUID, createHmac } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { processJob } from '../src/jobs/dispatcher.js';
import { baseSubscriptionActive } from '../src/modules/billing/services/billing-support.service.js';
import { businessFixture } from './fixtures.js';

const app = createApp(),
  secret = 'stripe-test-signature-secret-only';
const vendorIds: number[] = [],
  userIds: number[] = [],
  eventKeys: string[] = [],
  stateKeys: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterAll(async () => {
  const subscriptions = await db.subscriptions.findMany({
    where: { vendorId: { in: vendorIds } },
    select: { id: true },
  });
  await db.subscriptionItems.deleteMany({
    where: { subscriptionId: { in: subscriptions.map((row) => row.id) } },
  });
  await db.subscriptions.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.manualSubscriptions.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.subscriptionAddons.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.outboxJobs.deleteMany({
    where: { dedupeKey: { in: eventKeys.map((key) => `webhook:${key}`) } },
  });
  await db.webhookReceipts.deleteMany({
    where: { eventKey: { in: [...eventKeys, ...stateKeys] } },
  });
  await db.nativeMemberships.deleteMany({ where: { userId: { in: userIds } } });
  await db.authSessions.deleteMany({ where: { userId: { in: userIds } } });
  await db.whatsappPayments.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.whatsappOrders.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.vendors.deleteMany({ where: { id: { in: vendorIds } } });
  await db.users.deleteMany({ where: { id: { in: userIds } } });
  await db.$disconnect();
});
async function fixture() {
  const f = await businessFixture();
  vendorIds.push(f.vendorId);
  userIds.push(f.userId);
  const suffix = randomUUID().replaceAll('-', ''),
    customer = `cus_${suffix}`,
    subscription = `sub_${suffix}`;
  await db.vendors.update({ where: { id: f.vendorId }, data: { stripeId: customer } });
  stateKeys.push(`stripe-state:${subscription}`);
  return { ...f, customer, subscription };
}
const now = () => Math.floor(Date.now() / 1000);
function event(f: Awaited<ReturnType<typeof fixture>>, extra: any = {}) {
  return {
    id: `evt_${randomUUID().replaceAll('-', '')}`,
    type: 'customer.subscription.created',
    created: now() - 30,
    data: {
      object: {
        id: f.subscription,
        object: 'subscription',
        customer: f.customer,
        status: 'active',
        metadata: { type: 'default' },
        items: {
          has_more: false,
          data: [
            {
              id: 'si_example',
              price: { id: 'price_example', product: 'prod_example' },
              quantity: 1,
              current_period_end: now() + 3600,
            },
          ],
        },
        ...extra,
      },
    },
  };
}
async function accept(body: any) {
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', secret);
  const raw = JSON.stringify(body),
    timestamp = String(now()),
    signature = createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
  const response = await request(app)
    .post('/webhooks/payments/stripe')
    .set('Content-Type', 'application/json')
    .set('Stripe-Signature', `t=${timestamp},v1=${signature}`)
    .send(raw);
  const key = `stripe:${body.id}`;
  if (!eventKeys.includes(key)) eventKeys.push(key);
  return { response, key };
}
async function process(key: string) {
  return processJob(
    await db.outboxJobs.findUniqueOrThrow({ where: { dedupeKey: `webhook:${key}` } }),
  );
}

describe('signed Stripe subscription reconciliation', () => {
  it('creates a known customer subscription and its complete items exactly once', async () => {
    const f = await fixture(),
      body = event(f),
      received = await accept(body);
    expect(received.response.status).toBe(200);
    expect((await accept(body)).response.status).toBe(200);
    await Promise.all([process(received.key), process(received.key)]);
    const rows = await db.subscriptions.findMany({ where: { vendorId: f.vendorId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].stripePrice).toBe('price_example');
    expect(await db.subscriptionItems.count({ where: { subscriptionId: rows[0].id } })).toBe(1);
    expect(await baseSubscriptionActive(f.vendorId)).toBe(true);
  });
  it('rejects changed data under the same event ID and leaves the accepted snapshot unchanged', async () => {
    const f = await fixture(),
      body = event(f);
    await accept(body);
    body.data.object.status = 'unpaid';
    expect((await accept(body)).response.status).toBe(409);
  });
  it('handles delayed old events and cancellation without resurrecting deleted subscriptions', async () => {
    const f = await fixture(),
      newer = event(f, { status: 'past_due' });
    newer.type = 'customer.subscription.updated';
    newer.created = now() - 10;
    const accepted = await accept(newer);
    await process(accepted.key);
    const older = await accept(event(f));
    await process(older.key);
    expect(
      (await db.subscriptions.findFirstOrThrow({ where: { vendorId: f.vendorId } })).stripeStatus,
    ).toBe('past_due');
    const deleted = event(f, { status: 'canceled' });
    deleted.type = 'customer.subscription.deleted';
    deleted.created = now() - 5;
    await process((await accept(deleted)).key);
    expect(await baseSubscriptionActive(f.vendorId)).toBe(false);
    const later = event(f);
    later.type = 'customer.subscription.updated';
    later.created = now();
    await process((await accept(later)).key);
    expect(
      (await db.subscriptions.findFirstOrThrow({ where: { vendorId: f.vendorId } })).stripeStatus,
    ).toBe('canceled');
  });
  it('retains conflicting same-second updates for reconciliation instead of guessing their order', async () => {
    const f = await fixture(),
      first = event(f);
    await process((await accept(first)).key);
    const conflict = event(f, { status: 'unpaid' });
    conflict.created = first.created;
    conflict.type = 'customer.subscription.updated';
    const received = await accept(conflict);
    await expect(process(received.key)).rejects.toMatchObject({ code: 'STRIPE_REVISION_PENDING' });
    expect(
      (await db.webhookReceipts.findUniqueOrThrow({ where: { eventKey: received.key } }))
        .processedAt,
    ).toBeNull();
    expect(
      (await db.subscriptions.findFirstOrThrow({ where: { vendorId: f.vendorId } })).stripeStatus,
    ).toBe('active');
  });
  it('rejects unknown and ambiguous customers and conflicting local subscription owners', async () => {
    const f = await fixture(),
      other = await fixture();
    const unknown = await accept(event(f, { customer: 'cus_unknown' }));
    await expect(process(unknown.key)).rejects.toMatchObject({ code: 'UNROUTABLE_CUSTOMER' });
    await db.vendors.update({ where: { id: other.vendorId }, data: { stripeId: f.customer } });
    const ambiguous = await accept(event(f));
    await expect(process(ambiguous.key)).rejects.toMatchObject({ code: 'UNROUTABLE_CUSTOMER' });
    await db.vendors.update({ where: { id: other.vendorId }, data: { stripeId: other.customer } });
    await db.subscriptions.create({
      data: {
        vendorId: other.vendorId,
        stripeId: f.subscription,
        stripeStatus: 'active',
        type: 'default',
      },
    });
    const conflict = await accept(event(f));
    await expect(process(conflict.key)).rejects.toMatchObject({
      code: 'SUBSCRIPTION_OWNER_MISMATCH',
    });
  });
  it('rejects truncated item lists and rolls back invalid items without granting access', async () => {
    const f = await fixture();
    const incomplete = await accept(event(f, { items: { has_more: true, data: [] } }));
    await expect(process(incomplete.key)).rejects.toMatchObject({ code: 'STRIPE_ITEMS_PENDING' });
    const invalid = await accept(
      event(f, { items: { data: [{ id: 'si_bad', price: { id: 'price_bad' }, quantity: -1 }] } }),
    );
    await expect(process(invalid.key)).rejects.toMatchObject({ code: 'INVALID_STRIPE_EVENT' });
    expect(await db.subscriptions.count({ where: { vendorId: f.vendorId } })).toBe(0);
  });
  it('updates only pre-linked paid add-ons and respects admin overrides on cancellation', async () => {
    const f = await fixture();
    const paid = await db.subscriptionAddons.create({
      data: {
        vendorId: f.vendorId,
        addonCode: 'ai_replies',
        price: 999,
        paymentProvider: 'stripe',
        providerSubscriptionReference: f.subscription,
      },
    });
    const override = await db.subscriptionAddons.create({
      data: {
        vendorId: f.vendorId,
        addonCode: 'ai_replies',
        price: 0,
        source: 'admin_override',
        status: 'active',
        providerSubscriptionReference: f.subscription,
      },
    });
    await process((await accept(event(f))).key);
    expect((await db.subscriptionAddons.findUniqueOrThrow({ where: { id: paid.id } })).status).toBe(
      'active',
    );
    const deleted = event(f, { status: 'canceled' });
    deleted.type = 'customer.subscription.deleted';
    deleted.created = now() - 5;
    await process((await accept(deleted)).key);
    expect((await db.subscriptionAddons.findUniqueOrThrow({ where: { id: paid.id } })).status).toBe(
      'suspended',
    );
    expect(
      (await db.subscriptionAddons.findUniqueOrThrow({ where: { id: override.id } })).status,
    ).toBe('active');
  });
  it('exposes billing status only within the authorized business', async () => {
    const f = await fixture(),
      other = await fixture();
    expect(
      (
        await request(app)
          .get(`/api/v1/vendors/${f.vendorId}/billing`)
          .set('Authorization', `Bearer ${f.token}`)
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .get(`/api/v1/vendors/${other.vendorId}/billing`)
          .set('Authorization', `Bearer ${f.token}`)
      ).status,
    ).toBe(403);
  });
});

describe('base plan and AI entitlement', () => {
  it('requires both an active base plan and an active AI add-on', async () => {
    const f = await fixture(),
      url = `/api/v1/vendors/${f.vendorId}/ai/knowledge`;
    await db.subscriptionAddons.create({
      data: { vendorId: f.vendorId, addonCode: 'ai_replies', status: 'active', price: 999 },
    });
    expect((await request(app).get(url).set('Authorization', `Bearer ${f.token}`)).status).toBe(
      403,
    );
    await db.manualSubscriptions.create({
      data: { vendorId: f.vendorId, status: 'active', endsAt: new Date(Date.now() + 3600000) },
    });
    const response = await request(app).get(url).set('Authorization', `Bearer ${f.token}`);
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('AI_NOT_CONFIGURED');
  });
  it('rejects expired manual plans and add-on-only Stripe subscriptions', async () => {
    const f = await fixture();
    await db.manualSubscriptions.create({
      data: { vendorId: f.vendorId, status: 'active', endsAt: new Date(0) },
    });
    await db.subscriptions.create({
      data: {
        vendorId: f.vendorId,
        stripeId: f.subscription,
        stripeStatus: 'active',
        type: 'addon_ai_replies',
      },
    });
    expect(await baseSubscriptionActive(f.vendorId)).toBe(false);
  });
});

describe('central billing review', () => {
  async function administrator() {
    const f = await fixture();
    await db.userRoles.upsert({
      where: { id: 1 },
      create: { id: 1, title: 'Super administrator' },
      update: {},
    });
    await db.users.update({ where: { id: f.userId }, data: { userRolesId: 1 } });
    return f;
  }
  it('requires a current super-admin role rather than business wildcard permissions', async () => {
    const f = await fixture(),
      url = `/api/v1/admin/vendors/${f.vendorId}/billing/addons/ai-replies/override`;
    expect(
      (await request(app).post(url).set('Authorization', `Bearer ${f.token}`).send({})).status,
    ).toBe(403);
    const admin = await administrator();
    await db.users.update({ where: { id: admin.userId }, data: { userRolesId: null } });
    expect(
      (await request(app).post(url).set('Authorization', `Bearer ${admin.token}`).send({})).status,
    ).toBe(403);
  });
  it('approves one pending manual payment and rejects stale and foreign record reviews', async () => {
    const admin = await administrator(),
      f = await fixture(),
      other = await fixture();
    const row = await db.manualSubscriptions.create({
      data: { vendorId: f.vendorId, status: 'pending', planId: 'local-plan', charges: '250.00' },
    });
    const url = `/api/v1/admin/vendors/${f.vendorId}/billing/manual/${row.id}/approve`,
      endsAt = new Date(Date.now() + 3600000).toISOString();
    expect(
      (
        await request(app)
          .post(`/api/v1/admin/vendors/${other.vendorId}/billing/manual/${row.id}/approve`)
          .set('Authorization', `Bearer ${admin.token}`)
          .send({ endsAt })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .post(url)
          .set('Authorization', `Bearer ${admin.token}`)
          .send({ endsAt, charges: '1.00' })
      ).status,
    ).toBe(400);
    expect(
      (await request(app).post(url).set('Authorization', `Bearer ${admin.token}`).send({ endsAt }))
        .status,
    ).toBe(200);
    expect(await baseSubscriptionActive(f.vendorId)).toBe(true);
    expect(
      (await request(app).post(url).set('Authorization', `Bearer ${admin.token}`).send({ endsAt }))
        .status,
    ).toBe(409);
  });
  it('isolates administrator overrides from paid add-ons and preserves base-plan enforcement', async () => {
    const admin = await administrator(),
      f = await fixture(),
      url = `/api/v1/admin/vendors/${f.vendorId}/billing/addons/ai-replies/override`;
    const paid = await db.subscriptionAddons.create({
      data: {
        vendorId: f.vendorId,
        addonCode: 'ai_replies',
        source: 'paid',
        status: 'active',
        price: 999,
      },
    });
    expect(
      (await request(app).post(url).set('Authorization', `Bearer ${admin.token}`).send({})).status,
    ).toBe(201);
    expect(
      (
        await request(app)
          .get(`/api/v1/vendors/${f.vendorId}/ai/knowledge`)
          .set('Authorization', `Bearer ${f.token}`)
      ).status,
    ).toBe(403);
    expect(
      (await request(app).delete(url).set('Authorization', `Bearer ${admin.token}`)).status,
    ).toBe(204);
    expect((await db.subscriptionAddons.findUniqueOrThrow({ where: { id: paid.id } })).status).toBe(
      'active',
    );
    expect(
      await db.subscriptionAddons.count({
        where: { vendorId: f.vendorId, source: 'admin_override', status: 'active' },
      }),
    ).toBe(0);
  });
});

describe('Razorpay payment ordering', () => {
  it('does not let a late failure undo a captured payment or paid order', async () => {
    const f = await fixture(),
      paymentId = `pay_${randomUUID().replaceAll('-', '')}`;
    await db.whatsappPayments.create({
      data: {
        vendorId: f.vendorId,
        orderId: 'test-order',
        paymentId,
        gateway: 'razorpay',
        amount: '25.00',
        currency: 'INR',
        status: 'pending',
      },
    });
    await db.whatsappOrders.create({
      data: {
        vendorId: f.vendorId,
        orderId: 'test-order',
        customerPhone: '+919876543210',
        items: [],
        totalAmount: '25.00',
        currency: 'INR',
      },
    });
    for (const status of ['captured', 'failed']) {
      const key = `razorpay:test:${randomUUID()}`,
        body = {
          event: `payment.${status}`,
          payload: {
            payment: { entity: { id: paymentId, amount: 2500, currency: 'INR', status } },
          },
        };
      eventKeys.push(key);
      await db.webhookReceipts.create({
        data: { provider: 'razorpay', eventKey: key, payload: body },
      });
      const job = await db.outboxJobs.create({
        data: {
          kind: 'webhook-razorpay',
          dedupeKey: `webhook:${key}`,
          payload: { eventKey: key, body },
        },
      });
      await processJob(job);
    }
    expect(
      (await db.whatsappPayments.findFirstOrThrow({ where: { vendorId: f.vendorId } })).status,
    ).toBe('completed');
    expect(
      (await db.whatsappOrders.findFirstOrThrow({ where: { vendorId: f.vendorId } })).status,
    ).toBe('paid');
  });
});
