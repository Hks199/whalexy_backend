import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { businessFixture } from './fixtures.js';
const app = createApp();
afterAll(() => db.$disconnect());
afterEach(() => vi.unstubAllGlobals());
async function fixture(permissions = ['*']) {
  const f = await businessFixture(permissions);
  const shop = await db.shopifyIntegrations.create({
    data: {
      vendorId: f.vendorId,
      shopDomain: `history-${f.vendorId}.myshopify.com`,
      accessToken: 'private-store-token',
    },
  });
  const woo = await db.woocommerceIntegrations.create({
    data: {
      vendorId: f.vendorId,
      siteUrl: `https://history-${f.vendorId}.merchant.example`,
      consumerKey: 'private-key',
      consumerSecret: 'private-secret',
    },
  });
  const shops = [],
    woos = [];
  for (let index = 0; index < 3; index++) {
    const common = {
      vendorId: f.vendorId,
      orderNumber: 'ORDER-' + (index + 1),
      status: index === 0 ? 'completed' : 'pending',
      createdAt: new Date(`2026-09-0${index + 1}T23:59:59Z`),
    };
    shops.push(
      await db.shopifyOrders.create({
        data: {
          ...common,
          shopifyIntegrationsId: shop.id,
          shopifyOrderId: String(index + 100),
          name: '#' + index,
          totalPrice: '123456789.1234',
          financialStatus: index === 0 ? 'paid' : 'pending',
          fulfillmentStatus: index === 0 ? 'fulfilled' : 'unfulfilled',
          data: {
            secret: 'private-snapshot',
            shopify_order_data: {
              line_items: [
                {
                  id: '1',
                  title: 'Product',
                  quantity: 2,
                  price: '12.3456',
                  properties: { secret: 'private-item' },
                },
              ],
            },
          },
        },
      }),
    );
    woos.push(
      await db.woocommerceOrders.create({
        data: {
          ...common,
          woocommerceIntegrationsId: woo.id,
          woocommerceOrderId: index + 100,
          total: '123456789.1234',
          customerData: { secret: 'private-customer' },
          orderData: {
            secret: 'private-order',
            line_items: [
              {
                id: 1,
                name: 'Product',
                quantity: 2,
                total: '24.6912',
                meta_data: [{ secret: 'private-item' }],
              },
            ],
          },
        },
      }),
    );
  }
  const shopNotifications = [],
    wooNotifications = [];
  for (let index = 0; index < 3; index++) {
    const common = {
      vendorId: f.vendorId,
      notificationType: index === 0 ? 'order_confirmation' : 'order_cancelled',
      status: index === 0 ? 'sent' : 'failed',
      createdAt: new Date(`2026-09-0${index + 1}T23:59:59Z`),
      errorMessage: 'private-error-token',
      data: { secret: 'private-notification' },
    };
    shopNotifications.push(
      await db.shopifyOrderNotifications.create({
        data: { ...common, shopifyOrdersId: shops[0].id },
      }),
    );
    wooNotifications.push(
      await db.woocommerceOrderNotifications.create({
        data: {
          ...common,
          woocommerceOrdersId: woos[0].id,
          response: { token: 'private-response' },
          variables: { private: 'private-variables' },
        },
      }),
    );
  }
  const read = (provider: string, suffix: string, query = {}) =>
    request(app)
      .get(`/vendor-console/integration/${provider}/${suffix}`)
      .set('Authorization', `Bearer ${f.token}`)
      .query(query);
  return { ...f, shop, woo, shops, woos, shopNotifications, wooNotifications, read };
}
describe('original commerce order and notification history APIs', () => {
  it('lists both providers in stable bounded pages with exact decimal strings and safe projections', async () => {
    const f = await fixture();
    const remote = vi.fn();
    vi.stubGlobal('fetch', remote);
    for (const provider of ['shopify', 'woocommerce']) {
      const first = await f.read(provider, 'orders', { limit: 2 });
      expect(first.status).toBe(200);
      expect(first.body.orders).toMatchObject({ total: 3, page: 1, limit: 2, has_more: true });
      expect(first.body.orders.data.map((r: any) => r.order_number)).toEqual([
        'ORDER-3',
        'ORDER-2',
      ]);
      expect(first.body.orders.data[0][provider === 'shopify' ? 'total_price' : 'total']).toBe(
        '123456789.1234',
      );
      const second = await f.read(provider, 'orders', { limit: 2, page: 2 });
      expect(second.body.orders.data.map((r: any) => r.order_number)).toEqual(['ORDER-1']);
      expect(second.body.orders.has_more).toBe(false);
      expect(JSON.stringify(first.body)).not.toContain('private-');
      expect(JSON.stringify(first.body)).not.toContain('customer_data');
    }
    expect(remote).not.toHaveBeenCalled();
  });
  it('combines order filters and treats search literally; date ranges include the entire final UTC day', async () => {
    const f = await fixture();
    const shop = await f.read('shopify', 'orders', {
      status: 'completed',
      financial_status: 'paid',
      fulfillment_status: 'fulfilled',
      search: 'order-1',
      date_from: '2026-09-01',
      date_to: '2026-09-01',
    });
    expect(shop.status).toBe(200);
    expect(shop.body.orders.total).toBe(1);
    const woo = await f.read('woocommerce', 'orders', {
      status: 'pending',
      search: 'ORDER-2',
      date_from: '2026-09-02',
      date_to: '2026-09-02',
    });
    expect(woo.status).toBe(200);
    expect(woo.body.orders.total).toBe(1);
    expect((await f.read('shopify', 'orders', { search: '%' })).body.orders.total).toBe(0);
    expect(
      (await f.read('woocommerce', 'orders', { search: '_', status: 'completed' })).body.orders
        .total,
    ).toBe(0);
  });
  it('uses external order IDs and returns scoped notification history without private provider payloads', async () => {
    const f = await fixture();
    for (const provider of ['shopify', 'woocommerce']) {
      const response = await f.read(provider, 'orders/100', { limit: 2 });
      expect(response.status).toBe(200);
      expect(response.body.order.order_number).toBe('ORDER-1');
      expect(response.body.order.line_items).toHaveLength(1);
      expect(response.body.order.line_items[0]).toMatchObject({ id: '1', quantity: 2 });
      expect(response.body.notifications).toMatchObject({ total: 3, limit: 2, has_more: true });
      expect(JSON.stringify(response.body)).not.toContain('private-');
      expect((await f.read(provider, 'orders/999999')).status).toBe(404);
      const filtered = await f.read(provider, 'notifications', {
        status: 'sent',
        ...(provider === 'shopify'
          ? { notification_type: 'order_confirmation' }
          : { type: 'order_confirmation' }),
        date_from: '2026-09-01',
        date_to: '2026-09-01',
      });
      expect(filtered.status).toBe(200);
      expect(filtered.body.notifications.total).toBe(1);
      expect(
        (await f.read(provider, 'notifications', { search: 'ORDER-1', limit: 1 })).body
          .notifications.total,
      ).toBe(3);
    }
  });
  it('requires store selection for ambiguous external IDs and hides foreign selections', async () => {
    const f = await fixture(),
      other = await fixture();
    const extra = await db.shopifyIntegrations.create({
      data: {
        vendorId: f.vendorId,
        shopDomain: `extra-${f.vendorId}.myshopify.com`,
        accessToken: 'unused',
      },
    });
    await db.shopifyOrders.create({
      data: {
        vendorId: f.vendorId,
        shopifyIntegrationsId: extra.id,
        shopifyOrderId: '100',
        orderNumber: 'OTHER',
        name: '#other',
      },
    });
    expect((await f.read('shopify', 'orders/100')).status).toBe(409);
    const selected = await f.read('shopify', 'orders/100', { integration_id: f.shop.id });
    expect(selected.status).toBe(200);
    expect(selected.body.order.order_number).toBe('ORDER-1');
    expect(
      (await f.read('shopify', 'orders', { integration_id: extra.id })).body.orders.total,
    ).toBe(1);
    expect((await f.read('shopify', 'orders/100', { integration_id: other.shop.id })).status).toBe(
      404,
    );
    expect(
      (await f.read('woocommerce', 'notifications', { integration_id: other.woo.id })).status,
    ).toBe(404);
  });
  it('excludes imported foreign integration/order/contact/template relationships from rows and counts', async () => {
    const f = await fixture(),
      other = await fixture();
    const contact = await db.contacts.create({
      data: { vendorId: other.vendorId, waId: '919123456789' },
    });
    const template = await db.whatsappTemplates.create({
      data: {
        vendorId: other.vendorId,
        templateName: 'foreign',
        languageCode: 'en',
        status: 'APPROVED',
      },
    });
    await db.shopifyOrders.update({
      where: { id: other.shops[2].id },
      data: { shopifyOrderId: '9999' },
    });
    await db.shopifyOrders.update({
      where: { id: f.shops[2].id },
      data: { shopifyIntegrationsId: other.shop.id },
    });
    await db.woocommerceOrders.update({
      where: { id: f.woos[2].id },
      data: { contactId: contact.id },
    });
    await db.shopifyOrderNotifications.update({
      where: { id: f.shopNotifications[2].id },
      data: { shopifyOrdersId: other.shops[0].id },
    });
    await db.woocommerceOrderNotifications.update({
      where: { id: f.wooNotifications[2].id },
      data: { templateId: template.id },
    });
    await db.shopifyOrderNotifications.update({
      where: { id: f.shopNotifications[1].id },
      data: { contactId: contact.id },
    });
    expect((await f.read('shopify', 'orders')).body.orders.total).toBe(2);
    expect((await f.read('woocommerce', 'orders')).body.orders.total).toBe(2);
    expect((await f.read('shopify', 'orders/102')).status).toBe(404);
    expect((await f.read('woocommerce', 'orders/102')).status).toBe(404);
    expect((await f.read('shopify', 'notifications')).body.notifications.total).toBe(1);
    expect((await f.read('woocommerce', 'notifications')).body.notifications.total).toBe(2);
  });
  it('supports encoded legacy line items and rejects malformed imported detail snapshots', async () => {
    const f = await fixture();
    await db.shopifyOrders.update({
      where: { id: f.shops[0].id },
      data: {
        data: JSON.stringify({
          shopify_order_data: {
            line_items: [
              { id: '99999999999999999999', title: 'Legacy item', quantity: 1, price: '4.00' },
            ],
          },
        }),
      },
    });
    const legacy = await f.read('shopify', 'orders/100');
    expect(legacy.status).toBe(200);
    expect(legacy.body.order.line_items[0].id).toBe('99999999999999999999');
    await db.woocommerceOrders.update({
      where: { id: f.woos[0].id },
      data: { orderData: { line_items: [{ quantity: -1 }] } },
    });
    expect((await f.read('woocommerce', 'orders/100')).status).toBe(409);
    expect((await f.read('woocommerce', 'orders')).status).toBe(200);
  });
  it('requires current integration permission and validates bounds, dates, IDs and unsupported fields', async () => {
    const f = await fixture(['vendor.chats.view']);
    expect((await f.read('shopify', 'orders')).status).toBe(403);
    const allowed = await fixture();
    for (const query of [
      { limit: 101 },
      { page: 0 },
      { page: 10001 },
      { date_from: '2026-02-30', date_to: '2026-03-01' },
      { date_from: '2026-09-03', date_to: '2026-09-01' },
      { date_from: '2026-09-01' },
      { unknown: 'value' },
    ])
      expect((await allowed.read('shopify', 'orders', query)).status).toBe(400);
    expect((await allowed.read('woocommerce', 'orders/2147483648')).status).toBe(400);
    expect((await allowed.read('shopify', 'orders/invalid')).status).toBe(400);
    expect((await request(app).get('/vendor-console/integration/shopify/orders')).status).toBe(401);
  });
});
