import { randomUUID, createHmac } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { encrypt } from '../src/utils/crypto.js';
import { processJob } from '../src/jobs/dispatcher.js';
import { recoverInterruptedJobs } from '../src/jobs/recovery.js';
import {
  normalizeShopifyOrder,
  normalizeWooOrder,
} from '../src/modules/store-orders/store-orders.service.js';
import { businessFixture } from './fixtures.js';

const app = createApp(),
  secret = 'store-webhook-secret-for-test-only-1234';
const fixtureIds: number[] = [],
  userIds: number[] = [];
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  await db.outboxJobs.deleteMany({ where: { vendorId: { in: fixtureIds } } });
  await db.integrationCredentials.deleteMany({ where: { vendorId: { in: fixtureIds } } });
  await db.shopifyIntegrations.deleteMany({ where: { vendorId: { in: fixtureIds } } });
  await db.woocommerceIntegrations.deleteMany({ where: { vendorId: { in: fixtureIds } } });
  await db.whatsappOnboardingConnections.deleteMany({ where: { vendorId: { in: fixtureIds } } });
  await db.nativeMemberships.deleteMany({ where: { userId: { in: userIds } } });
  await db.authSessions.deleteMany({ where: { userId: { in: userIds } } });
  await db.vendors.deleteMany({ where: { id: { in: fixtureIds } } });
  await db.users.deleteMany({ where: { id: { in: userIds } } });
  await db.$disconnect();
});
async function fixture(provider: 'shopify' | 'woocommerce') {
  const business = await businessFixture();
  fixtureIds.push(business.vendorId);
  userIds.push(business.userId);
  const domain = `${randomUUID()}.${provider === 'shopify' ? 'myshopify.com' : 'example.com'}`;
  const integration =
    provider === 'shopify'
      ? await db.shopifyIntegrations.create({
          data: {
            vendorId: business.vendorId,
            shopDomain: domain,
            accessToken: encrypt('test-token'),
            isActive: true,
          },
        })
      : await db.woocommerceIntegrations.create({
          data: {
            vendorId: business.vendorId,
            siteUrl: `https://${domain}`,
            consumerKey: encrypt('test-key'),
            consumerSecret: encrypt('test-secret'),
            isActive: true,
          },
        });
  const response = await request(app)
    .post(`/api/v1/vendors/${business.vendorId}/integrations/store`)
    .set('Authorization', `Bearer ${business.token}`)
    .send({ provider, externalId: domain, webhookSecret: secret, integrationId: integration.id });
  expect(response.status).toBe(201);
  return {
    ...business,
    domain,
    integrationId: integration.id,
    credentialId: response.body.id,
    provider,
  };
}
function shopifyBody(extra = {}) {
  return {
    id: '9007199254740999',
    order_number: 321,
    name: '#321',
    total_price: '14.2500',
    subtotal_price: '12.25',
    total_tax: '2',
    currency: 'INR',
    financial_status: 'pending',
    fulfillment_status: null,
    updated_at: '2026-01-01T10:00:00Z',
    created_at: '2026-01-01T09:00:00Z',
    line_items: [{ quantity: 2 }],
    email: 'customer@example.com',
    phone: '+919876543210',
    ...extra,
  };
}
function wooBody(extra = {}) {
  return {
    id: 321,
    number: '321',
    total: '14.2500',
    total_tax: '2',
    shipping_total: '1',
    currency: 'INR',
    status: 'pending',
    date_modified_gmt: '2026-01-01T10:00:00',
    date_created_gmt: '2026-01-01T09:00:00',
    line_items: [{ quantity: 2 }],
    billing: { first_name: 'Customer', phone: '+919876543210' },
    ...extra,
  };
}
async function deliver(
  f: Awaited<ReturnType<typeof fixture>>,
  body: any,
  topic: string,
  delivery = randomUUID(),
  headers = {},
) {
  const raw = JSON.stringify(body),
    signature = createHmac('sha256', secret).update(raw).digest('base64');
  let req = request(app)
    .post(`/webhooks/stores/${f.provider}/${f.credentialId}`)
    .set('Content-Type', 'application/json');
  req =
    f.provider === 'shopify'
      ? req
          .set('X-Shopify-Hmac-Sha256', signature)
          .set('X-Shopify-Topic', topic)
          .set('X-Shopify-Webhook-Id', delivery)
          .set('X-Shopify-Shop-Domain', f.domain)
      : req
          .set('X-WC-Webhook-Signature', signature)
          .set('X-WC-Webhook-Topic', topic)
          .set('X-WC-Webhook-Delivery-ID', delivery);
  const response = await req.set(headers).send(raw);
  return { response, key: `${f.provider}:${f.credentialId}:${topic}:${delivery}` };
}
async function process(key: string) {
  const job = await db.outboxJobs.findUniqueOrThrow({ where: { dedupeKey: `webhook:${key}` } });
  await processJob(job);
  return job;
}

describe('store normalization and receipt safety', () => {
  it('retains exact Shopify IDs, decimal amounts and WooCommerce UTC timestamps', () => {
    const shop = normalizeShopifyOrder(shopifyBody(), 'orders/create'),
      woo = normalizeWooOrder(wooBody());
    expect(shop.orderId).toBe('9007199254740999');
    expect(shop.data.totalPrice.toFixed(4)).toBe('14.2500');
    expect(woo.modified.toISOString()).toBe('2026-01-01T10:00:00.000Z');
    expect(woo.data.totalItems).toBe(2);
  });
  it('rejects lossy IDs, invalid money, ambiguous dates, future revisions and topic/status mismatch', () => {
    for (const extra of [
      { id: 9007199254740999 },
      { total_price: '-1' },
      { total_price: 'NaN' },
      { total_price: '1.12345' },
      { updated_at: '2026-01-01T10:00:00' },
      { currency: 'bad-currency' },
      { updated_at: '2099-01-01T10:00:00Z' },
      { line_items: [{ quantity: -1 }] },
    ])
      expect(() => normalizeShopifyOrder(shopifyBody(extra), 'orders/create')).toThrow();
    expect(() => normalizeShopifyOrder(shopifyBody(), 'orders/paid')).toThrow();
    expect(() => normalizeShopifyOrder(shopifyBody(), 'orders/cancelled')).toThrow();
    expect(() => normalizeWooOrder(wooBody({ id: 2147483648 }))).toThrow();
  });
  it('rejects unsigned payloads, foreign shop headers and missing topics before queuing', async () => {
    const f = await fixture('shopify');
    const unsigned = await request(app)
      .post(`/webhooks/stores/shopify/${f.credentialId}`)
      .set('Content-Type', 'application/json')
      .send(shopifyBody());
    expect(unsigned.status).toBe(401);
    expect(
      (
        await deliver(f, shopifyBody(), 'orders/create', randomUUID(), {
          'X-Shopify-Shop-Domain': 'foreign.myshopify.com',
        })
      ).response.status,
    ).toBe(400);
    expect((await deliver(f, shopifyBody(), '', randomUUID())).response.status).toBe(400);
    expect(await db.outboxJobs.count({ where: { vendorId: f.vendorId } })).toBe(0);
  });
});

describe('durable store orders', () => {
  it('processes signed Shopify orders once across duplicate and concurrent deliveries', async () => {
    const f = await fixture('shopify'),
      delivery = randomUUID();
    const first = await deliver(f, shopifyBody(), 'orders/create', delivery),
      duplicate = await deliver(f, shopifyBody(), 'orders/create', delivery);
    expect(first.response.status).toBe(200);
    expect(duplicate.response.status).toBe(200);
    expect(await db.outboxJobs.count({ where: { vendorId: f.vendorId } })).toBe(1);
    await Promise.all([process(first.key), process(first.key)]);
    const rows = await db.shopifyOrders.findMany({ where: { vendorId: f.vendorId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].shopifyOrderId).toBe('9007199254740999');
    expect(rows[0].totalPrice.toFixed(4)).toBe('14.2500');
    expect(
      (await db.webhookReceipts.findUniqueOrThrow({ where: { eventKey: first.key } })).processedAt,
    ).not.toBeNull();
  });
  it('rejects a reused delivery ID with a different payload', async () => {
    const f = await fixture('woocommerce'),
      delivery = randomUUID();
    expect((await deliver(f, wooBody(), 'order.created', delivery)).response.status).toBe(200);
    expect(
      (await deliver(f, wooBody({ total: '20.00' }), 'order.created', delivery)).response.status,
    ).toBe(409);
    expect(await db.outboxJobs.count({ where: { vendorId: f.vendorId } })).toBe(1);
  });
  it('allows identical WooCommerce order IDs in different stores without crossing tenants', async () => {
    const a = await fixture('woocommerce'),
      b = await fixture('woocommerce');
    const aa = await deliver(a, wooBody(), 'order.created'),
      bb = await deliver(b, wooBody({ total: '25.50' }), 'order.created');
    await Promise.all([process(aa.key), process(bb.key)]);
    const ar = await db.woocommerceOrders.findFirstOrThrow({ where: { vendorId: a.vendorId } }),
      br = await db.woocommerceOrders.findFirstOrThrow({ where: { vendorId: b.vendorId } });
    expect(ar.woocommerceOrderId).toBe(br.woocommerceOrderId);
    expect(ar.id).not.toBe(br.id);
    expect(ar.total.toString()).toBe('14.25');
    expect(br.total.toString()).toBe('25.5');
    expect(
      (
        await request(app)
          .get(`/api/v1/vendors/${a.vendorId}/resources/woocommerce-orders/${br.id}`)
          .set('Authorization', `Bearer ${a.token}`)
      ).status,
    ).toBe(404);
  });
  it('does not let late WooCommerce events revert a newer order snapshot', async () => {
    const f = await fixture('woocommerce');
    const newer = await deliver(
      f,
      wooBody({ status: 'completed', date_modified_gmt: '2026-01-02T10:00:00' }),
      'order.updated',
    );
    await process(newer.key);
    const older = await deliver(f, wooBody(), 'order.created');
    await process(older.key);
    expect(
      (await db.woocommerceOrders.findFirstOrThrow({ where: { vendorId: f.vendorId } })).status,
    ).toBe('completed');
    expect(
      (await db.webhookReceipts.findUniqueOrThrow({ where: { eventKey: older.key } })).processedAt,
    ).not.toBeNull();
  });
  it('keeps paid Shopify state across equal-revision updates and handles later cancellation', async () => {
    const f = await fixture('shopify');
    const paid = await deliver(f, shopifyBody({ financial_status: 'paid' }), 'orders/paid');
    await process(paid.key);
    const update = await deliver(f, shopifyBody(), 'orders/updated');
    await process(update.key);
    expect(
      (await db.shopifyOrders.findFirstOrThrow({ where: { vendorId: f.vendorId } }))
        .financialStatus,
    ).toBe('paid');
    const cancelled = await deliver(
      f,
      shopifyBody({
        financial_status: 'paid',
        updated_at: '2026-01-02T10:00:00Z',
        cancelled_at: '2026-01-02T10:00:00Z',
      }),
      'orders/cancelled',
    );
    await process(cancelled.key);
    expect(
      (await db.shopifyOrders.findFirstOrThrow({ where: { vendorId: f.vendorId } })).status,
    ).toBe('cancelled');
  });
  it('rolls back invalid order processing and retains unsupported topics as unprocessed', async () => {
    const f = await fixture('woocommerce'),
      invalid = await deliver(f, wooBody({ total: 'invalid' }), 'order.created');
    await expect(process(invalid.key)).rejects.toMatchObject({ code: 'INVALID_STORE_ORDER' });
    expect(await db.woocommerceOrders.count({ where: { vendorId: f.vendorId } })).toBe(0);
    expect(
      (await db.webhookReceipts.findUniqueOrThrow({ where: { eventKey: invalid.key } }))
        .processedAt,
    ).toBeNull();
    const unknown = await deliver(f, wooBody(), 'order.custom');
    await expect(process(unknown.key)).rejects.toMatchObject({ code: 'WEBHOOK_HANDLER_PENDING' });
  });
  it('rejects foreign integration mappings and stops queued processing after disconnect', async () => {
    const f = await fixture('woocommerce'),
      other = await fixture('woocommerce');
    const foreign = await request(app)
      .post(`/api/v1/vendors/${f.vendorId}/integrations/store`)
      .set('Authorization', `Bearer ${f.token}`)
      .send({
        provider: 'woocommerce',
        externalId: f.domain,
        webhookSecret: secret,
        integrationId: other.integrationId,
      });
    expect(foreign.status).toBe(400);
    const queued = await deliver(f, wooBody(), 'order.created');
    expect(
      (
        await request(app)
          .delete(`/api/v1/vendors/${f.vendorId}/integrations/${f.credentialId}`)
          .set('Authorization', `Bearer ${f.token}`)
      ).status,
    ).toBe(204);
    expect(
      (await db.woocommerceIntegrations.findUniqueOrThrow({ where: { id: f.integrationId } }))
        .isActive,
    ).toBe(false);
    await expect(process(queued.key)).rejects.toMatchObject({ code: 'STORE_NOT_CONFIGURED' });
  });
  it('safely recovers interrupted internal store jobs before and after transaction commit', async () => {
    const f = await fixture('shopify'),
      accepted = await deliver(f, shopifyBody(), 'orders/create');
    const job = await db.outboxJobs.findUniqueOrThrow({
      where: { dedupeKey: `webhook:${accepted.key}` },
    });
    await db.outboxJobs.update({
      where: { id: job.id },
      data: { status: 'processing', lockedAt: new Date(Date.now() - 11 * 60000) },
    });
    await recoverInterruptedJobs();
    expect((await db.outboxJobs.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      'pending',
    );
    await process(accepted.key);
    await db.outboxJobs.update({
      where: { id: job.id },
      data: { status: 'processing', lockedAt: new Date(Date.now() - 11 * 60000) },
    });
    await recoverInterruptedJobs();
    expect((await db.outboxJobs.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      'completed',
    );
    expect(await db.shopifyOrders.count({ where: { vendorId: f.vendorId } })).toBe(1);
  });
});
