import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { processJob } from '../src/jobs/dispatcher.js';
import { businessFixture } from './fixtures.js';

const app = createApp(),
  secret = 'test-stripe-checkout-webhook-secret';
const plans = [
  {
    id: 'pro_monthly',
    title: 'Pro',
    priceId: 'price_pro',
    interval: 'monthly',
    amount: 129900,
    currency: 'INR',
  },
  {
    id: 'pro_yearly',
    title: 'Pro yearly',
    priceId: 'price_year',
    interval: 'yearly',
    amount: 1299000,
    currency: 'INR',
  },
];
beforeEach(() => {
  vi.stubEnv('BILLING_PLANS', JSON.stringify(plans));
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_checkout_only');
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', secret);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterAll(() => db.$disconnect());
function path(f: Awaited<ReturnType<typeof businessFixture>>, suffix = 'checkout') {
  return `/api/v1/vendors/${f.vendorId}/billing/${suffix}`;
}
function checkout(
  f: Awaited<ReturnType<typeof businessFixture>>,
  key = 'checkout_request_123',
  body = { planId: 'pro_monthly' },
) {
  return request(app)
    .post(path(f))
    .set('Authorization', `Bearer ${f.token}`)
    .set('Idempotency-Key', key)
    .send(body);
}
function remote(
  f: Awaited<ReturnType<typeof businessFixture>>,
  options: { failOnce?: boolean; badUrl?: boolean } = {},
) {
  const customer = `cus_test${f.vendorId}`,
    session = `cs_test_${f.vendorId}`,
    subscription = `sub_test${f.vendorId}`;
  let failed = false;
  const snapshot = {
    id: subscription,
    object: 'subscription',
    customer,
    status: 'active',
    metadata: { type: 'pro_monthly' },
    current_period_end: Math.floor(Date.now() / 1000) + 86400,
    items: {
      has_more: false,
      data: [
        {
          id: `si_test${f.vendorId}`,
          price: { id: 'price_pro', product: 'prod_pro' },
          quantity: 1,
        },
      ],
    },
  };
  const fetch = vi.fn(async (url: URL, init: RequestInit) => {
    const parameters = new URLSearchParams(String(init.body ?? ''));
    let result: any;
    if (url.pathname === '/v1/customers') result = { id: customer, object: 'customer' };
    else if (url.pathname === '/v1/checkout/sessions') {
      if (options.failOnce && !failed) {
        failed = true;
        throw Error('interrupted');
      }
      expect(parameters.get('customer')).toBe(customer);
      expect(parameters.get('line_items[0][price]')).toBe('price_pro');
      result = {
        id: session,
        customer,
        mode: 'subscription',
        status: 'open',
        url: options.badUrl
          ? 'https://attacker.example/checkout'
          : `https://checkout.stripe.com/c/pay/${session}`,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      };
    } else if (url.pathname === `/v1/checkout/sessions/${session}`)
      result = { id: session, customer, mode: 'subscription', status: 'complete', subscription };
    else if (url.pathname === `/v1/subscriptions/${subscription}`) result = snapshot;
    else if (url.pathname === '/v1/billing_portal/sessions')
      result = { id: `bps_test${f.vendorId}`, url: 'https://billing.stripe.com/p/session/test' };
    else if (url.pathname === '/v1/invoices') {
      expect(url.searchParams.get('customer')).toBe(customer);
      result = {
        data: [
          { id: 'in_test', customer, status: 'paid', total: 129900, paid: true, currency: 'inr' },
        ],
        has_more: false,
      };
    } else throw Error('Unexpected provider URL');
    return new Response(JSON.stringify(result), {
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetch);
  return { fetch, customer, session, subscription, snapshot };
}
async function event(f: Awaited<ReturnType<typeof businessFixture>>, body: any) {
  const raw = JSON.stringify(body),
    timestamp = Math.floor(Date.now() / 1000),
    signature = createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
  const response = await request(app)
    .post('/webhooks/payments/stripe')
    .set('Content-Type', 'application/json')
    .set('Stripe-Signature', `t=${timestamp},v1=${signature}`)
    .send(raw);
  expect(response.status).toBe(200);
  const key = `stripe:${body.id}`;
  return db.outboxJobs.findUniqueOrThrow({ where: { dedupeKey: `webhook:${key}` } });
}
describe('server-owned Stripe checkout', () => {
  it('creates and maps the customer once, replays checkout without granting access', async () => {
    const f = await businessFixture(),
      r = remote(f);
    const first = await checkout(f);
    expect(first.status).toBe(201);
    expect((await checkout(f)).body).toEqual(first.body);
    expect(r.fetch).toHaveBeenCalledTimes(2);
    expect((await db.vendors.findUniqueOrThrow({ where: { id: f.vendorId } })).stripeId).toBe(
      r.customer,
    );
    expect(await db.subscriptions.count({ where: { vendorId: f.vendorId } })).toBe(0);
    expect((await checkout(f, 'another_checkout_123')).status).toBe(409);
    expect(r.fetch).toHaveBeenCalledTimes(2);
  });
  it('rejects client prices, unavailable plans, changed requests and arbitrary provider redirects', async () => {
    const f = await businessFixture(),
      r = remote(f);
    expect(
      (
        await checkout(f, 'checkout_request_123', {
          planId: 'pro_monthly',
          priceId: 'price_cheap',
        } as any)
      ).status,
    ).toBe(400);
    expect((await checkout(f, 'checkout_request_123', { planId: 'missing' })).status).toBe(400);
    expect(r.fetch).not.toHaveBeenCalled();
    expect((await checkout(f)).status).toBe(201);
    expect((await checkout(f, 'checkout_request_123', { planId: 'pro_yearly' })).status).toBe(409);
    const other = await businessFixture();
    remote(other, { badUrl: true });
    expect((await checkout(other)).status).toBe(502);
  });
  it('reuses the provider key after interruption and blocks retries beyond retention', async () => {
    const f = await businessFixture(),
      r = remote(f, { failOnce: true });
    expect((await checkout(f)).status).toBe(502);
    expect((await checkout(f)).status).toBe(201);
    const calls = r.fetch.mock.calls.filter(([url]) => url.pathname === '/v1/checkout/sessions');
    expect(calls).toHaveLength(2);
    expect((calls[0][1].headers as any)['Idempotency-Key']).toBe(
      (calls[1][1].headers as any)['Idempotency-Key'],
    );
    const other = await businessFixture();
    remote(other, { failOnce: true });
    expect((await checkout(other)).status).toBe(502);
    await db.nativeIdempotency.updateMany({
      where: { vendorId: other.vendorId, key: 'stripe:checkout:checkout_request_123' },
      data: { createdAt: new Date(Date.now() - 86400000) },
    });
    expect((await checkout(other)).body.error.code).toBe('BILLING_RECONCILIATION_REQUIRED');
  });
  it('isolates business billing and requires the owner for checkout/portal', async () => {
    const f = await businessFixture(),
      agent = await businessFixture(['administrative']);
    const r = remote(f);
    expect((await checkout(agent)).status).toBe(403);
    expect(
      (
        await request(app)
          .post(path(f))
          .set('Authorization', `Bearer ${agent.token}`)
          .set('Idempotency-Key', 'request_owner_123')
          .send({ planId: 'pro_monthly' })
      ).status,
    ).toBe(403);
    expect(r.fetch).not.toHaveBeenCalled();
    expect((await checkout(f)).status).toBe(201);
    expect(
      (
        await request(app)
          .post(path(f, 'portal'))
          .set('Authorization', `Bearer ${f.token}`)
          .set('Idempotency-Key', 'portal_request_123')
          .send({})
      ).status,
    ).toBe(201);
    expect(
      (await request(app).get(path(f, 'invoices')).set('Authorization', `Bearer ${f.token}`)).body
        .items[0].id,
    ).toBe('in_test');
  });
  it('rejects a new checkout for an existing base subscription', async () => {
    const f = await businessFixture(),
      r = remote(f);
    await db.subscriptions.create({
      data: {
        vendorId: f.vendorId,
        type: 'pro',
        stripeId: `sub_existing${f.vendorId}`,
        stripeStatus: 'active',
      },
    });
    expect((await checkout(f)).status).toBe(409);
    expect(r.fetch).not.toHaveBeenCalled();
  });
});
describe('authoritative Stripe event processing', () => {
  it('fulfills a tracked checkout from a provider subscription rather than browser payment claims', async () => {
    const f = await businessFixture(),
      r = remote(f);
    expect((await checkout(f)).status).toBe(201);
    const job = await event(f, {
      id: `evt_${randomUUID().replaceAll('-', '')}`,
      created: Math.floor(Date.now() / 1000),
      type: 'checkout.session.completed',
      data: {
        object: {
          id: r.session,
          customer: r.customer,
          mode: 'subscription',
          payment_status: 'unpaid',
        },
      },
    });
    await processJob(job);
    await processJob(job);
    expect(
      (await db.subscriptions.findFirstOrThrow({ where: { vendorId: f.vendorId } })).stripeStatus,
    ).toBe('active');
    expect(
      await db.subscriptionItems.count({
        where: {
          subscriptionId: (
            await db.subscriptions.findFirstOrThrow({ where: { vendorId: f.vendorId } })
          ).id,
        },
      }),
    ).toBe(1);
  });
  it('reconciles an old subscription/invoice event against current provider state', async () => {
    const f = await businessFixture(),
      r = remote(f);
    await checkout(f);
    const job = await event(f, {
      id: `evt_${randomUUID().replaceAll('-', '')}`,
      created: 100,
      type: 'customer.subscription.updated',
      data: { object: { ...r.snapshot, status: 'unpaid' } },
    });
    await processJob(job);
    expect(
      (await db.subscriptions.findFirstOrThrow({ where: { vendorId: f.vendorId } })).stripeStatus,
    ).toBe('active');
    r.snapshot.status = 'past_due';
    const invoice = await event(f, {
      id: `evt_${randomUUID().replaceAll('-', '')}`,
      created: 101,
      type: 'invoice.payment_failed',
      data: {
        object: {
          id: 'in_example',
          customer: r.customer,
          parent: { subscription_details: { subscription: r.subscription } },
        },
      },
    });
    await processJob(invoice);
    expect(
      (await db.subscriptions.findFirstOrThrow({ where: { vendorId: f.vendorId } })).stripeStatus,
    ).toBe('past_due');
  });
  it('blocks untracked checkout identities and mismatched remote customer ownership', async () => {
    const f = await businessFixture(),
      r = remote(f);
    await checkout(f);
    const unknown = await event(f, {
      id: `evt_${randomUUID().replaceAll('-', '')}`,
      created: 100,
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_unknown', customer: r.customer } },
    });
    await expect(processJob(unknown)).rejects.toMatchObject({ code: 'UNROUTABLE_CHECKOUT' });
    r.snapshot.customer = 'cus_other';
    const mismatch = await event(f, {
      id: `evt_${randomUUID().replaceAll('-', '')}`,
      created: 100,
      type: 'customer.subscription.updated',
      data: { object: { ...r.snapshot, customer: r.customer } },
    });
    await expect(processJob(mismatch)).rejects.toMatchObject({
      code: 'SUBSCRIPTION_OWNER_MISMATCH',
    });
    expect(await db.subscriptions.count({ where: { vendorId: f.vendorId } })).toBe(0);
  });
});
