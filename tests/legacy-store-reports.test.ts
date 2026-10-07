import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { businessFixture } from './fixtures.js';
const app = createApp();
afterAll(() => db.$disconnect());
async function fixture(permissions = ['*']) {
  const f = await businessFixture(permissions);
  const shop = await db.shopifyIntegrations.create({
    data: {
      vendorId: f.vendorId,
      shopDomain: `store-${f.vendorId}.myshopify.com`,
      accessToken: 'private-store-token',
      isActive: true,
      connectedAt: new Date(),
      webhookId: 'private-webhook-id',
      notificationTypes: 'order_created,order_paid',
      data: { secret: 'private-store-data' },
    },
  });
  const woo = await db.woocommerceIntegrations.create({
    data: {
      vendorId: f.vendorId,
      siteUrl: `https://store-${f.vendorId}.merchant.com`,
      consumerKey: 'private-consumer-key',
      consumerSecret: 'private-consumer-secret',
      isActive: true,
      connectedAt: new Date(),
      settings: { secret: 'private-settings' },
    },
  });
  const read = (provider: string, kind: string, query: Record<string, unknown> = {}) =>
    request(app)
      .get(`/vendor-console/integration/${provider}/${kind}`)
      .set('Authorization', `Bearer ${f.token}`)
      .query(query);
  return { ...f, shop, woo, read };
}
async function orders(f: Awaited<ReturnType<typeof fixture>>) {
  const shop = [],
    woo = [];
  for (let index = 0; index < 3; index++) {
    shop.push(
      await db.shopifyOrders.create({
        data: {
          vendorId: f.vendorId,
          shopifyIntegrationsId: f.shop.id,
          shopifyOrderId: String(index + 1),
          orderNumber: String(index + 1),
          name: `#${index + 1}`,
          financialStatus: ['paid', 'partially_paid', 'pending'][index],
          fulfillmentStatus: ['fulfilled', 'partial', 'unfulfilled'][index],
          status: index === 2 ? 'cancelled' : 'open',
        },
      }),
    );
    woo.push(
      await db.woocommerceOrders.create({
        data: {
          vendorId: f.vendorId,
          woocommerceIntegrationsId: f.woo.id,
          woocommerceOrderId: index + 1,
          orderNumber: String(index + 1),
          status: ['completed', 'processing', 'pending'][index],
        },
      }),
    );
  }
  for (const status of ['sent', 'delivered', 'read', 'failed', 'pending']) {
    await db.shopifyOrderNotifications.create({
      data: {
        vendorId: f.vendorId,
        shopifyOrdersId: shop[0].id,
        notificationType: 'order_created',
        status,
      },
    });
    await db.woocommerceOrderNotifications.create({
      data: {
        vendorId: f.vendorId,
        woocommerceOrdersId: woo[0].id,
        notificationType: 'order_created',
        status,
      },
    });
  }
  await db.woocommerceOrderNotifications.create({
    data: {
      vendorId: f.vendorId,
      woocommerceOrdersId: woo[0].id,
      notificationType: 'order_created',
      status: 'sent',
      createdAt: new Date(Date.now() - 40 * 86400000),
    },
  });
  return { shop, woo };
}
describe('original commerce status and statistics APIs', () => {
  it('returns safe source status projections without credentials or settings', async () => {
    const f = await fixture();
    const shop = await f.read('shopify', 'status'),
      woo = await f.read('woocommerce', 'status');
    expect(shop.status).toBe(200);
    expect(shop.body).toMatchObject({
      connected: true,
      shop_domain: f.shop.shopDomain,
      webhook_configured: true,
      notification_types: ['order_created', 'order_paid'],
    });
    expect(woo.status).toBe(200);
    expect(woo.body).toMatchObject({
      connected: true,
      site_url: f.woo.siteUrl,
      connected_at: f.woo.connectedAt!.toISOString(),
    });
    expect(JSON.stringify([shop.body, woo.body])).not.toContain('private-');
    await db.shopifyIntegrations.update({ where: { id: f.shop.id }, data: { connectedAt: null } });
    expect((await f.read('shopify', 'status')).body.connected).toBe(false);
    await db.woocommerceIntegrations.update({ where: { id: f.woo.id }, data: { isActive: false } });
    expect((await f.read('woocommerce', 'status')).body.connected).toBe(false);
  });
  it('matches Shopify status counts and rounded delivery/payment rates', async () => {
    const f = await fixture();
    await orders(f);
    const result = await f.read('shopify', 'statistics');
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      orders: {
        total_orders: 3,
        paid_orders: 2,
        fulfilled_orders: 2,
        cancelled_orders: 1,
        payment_rate: 66.67,
        fulfillment_rate: 66.67,
      },
      notifications: {
        total_notifications: 5,
        sent_notifications: 3,
        delivered_notifications: 2,
        read_notifications: 1,
        failed_notifications: 1,
        delivery_rate: 40,
        read_rate: 20,
      },
    });
  });
  it('matches WooCommerce statistics and limits success rate to the last 30 days', async () => {
    const f = await fixture();
    await orders(f);
    const result = await f.read('woocommerce', 'statistics');
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      success: true,
      data: {
        orders: { total_orders: 3, paid_orders: 2, fulfilled_orders: 1, pending_orders: 1 },
        notifications: {
          total_notifications: 6,
          sent_notifications: 4,
          failed_notifications: 1,
          pending_notifications: 1,
        },
        success_rate: 60,
      },
    });
  });
  it('returns disconnected and zero states without an integration or order history', async () => {
    const f = await businessFixture();
    const read = (p: string, k: string) =>
      request(app)
        .get(`/vendor-console/integration/${p}/${k}`)
        .set('Authorization', `Bearer ${f.token}`);
    expect((await read('shopify', 'status')).body).toEqual({
      connected: false,
      shop_domain: null,
      last_sync: null,
      webhook_configured: false,
    });
    expect((await read('woocommerce', 'status')).body).toEqual({
      connected: false,
      message: 'No WooCommerce integration found',
    });
    expect((await read('shopify', 'statistics')).body.orders.total_orders).toBe(0);
    expect((await read('shopify', 'statistics')).body.notifications.delivery_rate).toBe(0);
    expect((await read('woocommerce', 'statistics')).body.data.success_rate).toBe(0);
  });
  it('supports explicit owned store selection, rejects ambiguous status and ignores imported foreign links', async () => {
    const f = await fixture(),
      foreign = await fixture(),
      own = await orders(f),
      other = await orders(foreign);
    const second = await db.shopifyIntegrations.create({
      data: {
        vendorId: f.vendorId,
        shopDomain: `second-${f.vendorId}.myshopify.com`,
        accessToken: 'unused',
      },
    });
    expect((await f.read('shopify', 'status')).status).toBe(409);
    expect((await f.read('shopify', 'status', { integration_id: second.id })).body.connected).toBe(
      false,
    );
    expect(
      (await f.read('shopify', 'statistics', { integration_id: second.id })).body.orders
        .total_orders,
    ).toBe(0);
    await db.shopifyOrders.create({
      data: {
        vendorId: f.vendorId,
        shopifyIntegrationsId: foreign.shop.id,
        shopifyOrderId: '999',
        orderNumber: '999',
        name: '#999',
      },
    });
    await db.shopifyOrderNotifications.create({
      data: {
        vendorId: f.vendorId,
        shopifyOrdersId: other.shop[0].id,
        notificationType: 'order_created',
        status: 'sent',
      },
    });
    const foreignContact = await db.contacts.create({ data: { vendorId: foreign.vendorId } });
    await db.shopifyOrderNotifications.create({
      data: {
        vendorId: f.vendorId,
        shopifyOrdersId: own.shop[0].id,
        contactId: foreignContact.id,
        notificationType: 'order_created',
        status: 'sent',
      },
    });
    expect((await f.read('shopify', 'statistics')).body.orders.total_orders).toBe(3);
    expect((await f.read('shopify', 'statistics')).body.notifications.total_notifications).toBe(5);
    for (const kind of ['status', 'statistics'])
      expect((await f.read('shopify', kind, { integration_id: foreign.shop.id })).status).toBe(404);
  });
  it('rejects unsafe stored URLs, unauthorized access and unsupported queries without remote calls', async () => {
    const f = await fixture(),
      denied = await fixture(['vendor.contacts.view']);
    for (const provider of ['shopify', 'woocommerce'])
      for (const kind of ['status', 'statistics']) {
        expect((await denied.read(provider, kind)).status).toBe(403);
        expect((await f.read(provider, kind, { integration_id: 0 })).status).toBe(400);
        expect((await f.read(provider, kind, { unknown: true })).status).toBe(400);
      }
    await db.woocommerceIntegrations.update({
      where: { id: f.woo.id },
      data: {
        siteUrl: `https://private-user:private-password@store-${f.vendorId}.merchant.com/?secret=private`,
      },
    });
    const response = await f.read('woocommerce', 'status');
    expect(response.status).toBe(409);
    expect(JSON.stringify(response.body)).not.toContain('private-password');
    expect((await request(app).get('/vendor-console/integration/shopify/status')).status).toBe(401);
  });
});
