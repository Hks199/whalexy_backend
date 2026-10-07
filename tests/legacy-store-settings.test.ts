import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { businessFixture } from './fixtures.js';
import { encrypt } from '../src/utils/crypto.js';
const app = createApp();
afterAll(() => db.$disconnect());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function fixture(provider: 'shopify' | 'woocommerce' = 'shopify', permissions = ['*']) {
  const f = await businessFixture(permissions),
    phone = `8855${f.vendorId}`;
  await db.integrationCredentials.create({
    data: {
      vendorId: f.vendorId,
      provider: 'whatsapp',
      externalId: phone,
      secret: encrypt('test'),
    },
  });
  const store =
    provider === 'shopify'
      ? await db.shopifyIntegrations.create({
          data: {
            vendorId: f.vendorId,
            shopDomain: `settings-${f.vendorId}.myshopify.com`,
            accessToken: 'unused',
            data: { preserved: 'private-state' },
          },
        })
      : await db.woocommerceIntegrations.create({
          data: {
            vendorId: f.vendorId,
            siteUrl: `https://settings-${f.vendorId}.merchant.example`,
            consumerKey: 'unused',
            consumerSecret: 'unused',
            data: { preserved: 'private-state' },
          },
        });
  const template = await db.whatsappTemplates.create({
    data: {
      vendorId: f.vendorId,
      templateName: 'order_notice',
      languageCode: 'en',
      status: 'APPROVED',
      data: {
        components: [
          { type: 'HEADER', format: 'TEXT', text: 'Order {{1}}' },
          { type: 'BODY', text: 'Order {{1}} total {{2}}' },
        ],
      },
    },
  });
  const mappings = { order_confirmation: { '1': 'order_number', '2': 'order_total' } };
  const body = {
    notification_types: ['order_confirmation'],
    template_uid: { order_confirmation: template.uid },
    ...(provider === 'shopify'
      ? { variable_mappings: JSON.stringify(mappings) }
      : { variable_mapping: mappings }),
  };
  const send = (value: any = body, key = randomUUID(), query = {}) =>
    request(app)
      .post(`/vendor-console/integration/${provider}/update-notification-settings`)
      .set('Authorization', `Bearer ${f.token}`)
      .set('Idempotency-Key', key)
      .query(query)
      .send(value);
  const state = () =>
    provider === 'shopify'
      ? db.shopifyIntegrations.findUniqueOrThrow({ where: { id: store.id } })
      : db.woocommerceIntegrations.findUniqueOrThrow({ where: { id: store.id } });
  return { ...f, phone, store, template, body, send, state, provider };
}
describe('original commerce notification settings translation', () => {
  for (const provider of ['shopify', 'woocommerce'] as const)
    it(`translates ${provider} UUID/body/header mappings atomically and replays without extra audits`, async () => {
      const f = await fixture(provider),
        key = randomUUID();
      const remote = vi.fn();
      vi.stubGlobal('fetch', remote);
      const result = await f.send(f.body, key);
      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        success: true,
        message: 'Notification settings updated successfully',
      });
      const stored = await f.state();
      expect(stored.notificationTypes).toBe('order_confirmation');
      expect(stored.data).toMatchObject({
        preserved: 'private-state',
        nodeNotifications: {
          enabled: true,
          phoneNumberId: f.phone,
          rules: [
            {
              type: 'order_confirmation',
              templateId: f.template.id,
              bodyParameters: [
                { orderField: 'orderNumber', fallback: '-' },
                { orderField: 'total', fallback: '-' },
              ],
              headerParameters: [{ orderField: 'orderNumber', fallback: '-' }],
            },
          ],
        },
      });
      expect((await f.send(f.body, key)).body).toEqual(result.body);
      expect(
        await db.auditEvents.count({
          where: { vendorId: f.vendorId, resource: 'store-notifications' },
        }),
      ).toBe(1);
      expect(
        (
          await f.send(
            {
              ...f.body,
              notification_types: [],
              template_uid: {},
              ...(provider === 'shopify' ? { variable_mappings: '{}' } : { variable_mapping: {} }),
            },
            key,
          )
        ).status,
      ).toBe(409);
      expect(remote).not.toHaveBeenCalled();
    });
  it('selects an owned store and sender explicitly when scopes are ambiguous', async () => {
    const f = await fixture(),
      other = await fixture();
    const extra = await db.shopifyIntegrations.create({
      data: {
        vendorId: f.vendorId,
        shopDomain: `extra-settings-${f.vendorId}.myshopify.com`,
        accessToken: 'unused',
      },
    });
    expect((await f.send()).status).toBe(409);
    await db.integrationCredentials.create({
      data: {
        vendorId: f.vendorId,
        provider: 'whatsapp',
        externalId: `9988${f.vendorId}`,
        secret: encrypt('test'),
      },
    });
    expect((await f.send(f.body, randomUUID(), { integration_id: extra.id })).status).toBe(409);
    expect(
      (
        await f.send({ ...f.body, phone_number_id: f.phone }, randomUUID(), {
          integration_id: extra.id,
        })
      ).status,
    ).toBe(200);
    expect((await f.send(f.body, randomUUID(), { integration_id: other.store.id })).status).toBe(
      404,
    );
    expect((await f.state()).data).not.toHaveProperty('nodeNotifications');
  });
  it('rejects foreign templates/senders, inactive templates, missing and unsupported mappings without writes', async () => {
    const f = await fixture(),
      other = await fixture();
    expect(
      (await f.send({ ...f.body, template_uid: { order_confirmation: other.template.uid } }))
        .status,
    ).toBe(400);
    expect((await f.send({ ...f.body, phone_number_id: other.phone })).status).toBe(400);
    expect(
      (
        await f.send({
          ...f.body,
          variable_mappings: '{"order_confirmation":{"1":"order_number"}}',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await f.send({
          ...f.body,
          variable_mappings: '{"order_confirmation":{"1":"shipping_address","2":"order_total"}}',
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await f.send({
          ...f.body,
          notification_types: ['delivery_confirmation'],
          template_uid: { delivery_confirmation: f.template.uid },
          variable_mappings: '{}',
        })
      ).status,
    ).toBe(409);
    await db.whatsappTemplates.update({
      where: { id: f.template.id },
      data: { status: 'REJECTED' },
    });
    expect((await f.send()).status).toBe(400);
    expect((await f.state()).data).toEqual({ preserved: 'private-state' });
    expect(
      await db.auditEvents.count({
        where: { vendorId: f.vendorId, resource: 'store-notifications' },
      }),
    ).toBe(0);
  });
  it('disables rules and refuses unsupported media templates without overwriting saved settings', async () => {
    const f = await fixture();
    expect((await f.send()).status).toBe(200);
    await db.whatsappTemplates.update({
      where: { id: f.template.id },
      data: {
        data: {
          components: [
            { type: 'HEADER', format: 'IMAGE' },
            { type: 'BODY', text: 'Notice' },
          ],
        },
      },
    });
    expect((await f.send()).status).toBe(409);
    expect((await f.state()).notificationTypes).toBe('order_confirmation');
    await db.integrationCredentials.deleteMany({
      where: { vendorId: f.vendorId, provider: 'whatsapp' },
    });
    const disabled = await f.send({
      notification_types: [],
      template_uid: {},
      variable_mappings: '{}',
    });
    expect(disabled.status).toBe(200);
    expect((await f.state()).data).toMatchObject({
      nodeNotifications: { enabled: false, rules: [] },
    });
  });
  it('rolls back translated rules and idempotency when the final audit fails', async () => {
    const f = await fixture(),
      transaction = db.$transaction.bind(db);
    vi.spyOn(db, '$transaction').mockImplementation((async (fn: any, options: any) =>
      transaction(async (tx) => {
        tx.auditEvents.create = (() => Promise.reject(new Error('audit failed'))) as any;
        return fn(tx);
      }, options)) as any);
    expect((await f.send()).status).toBe(500);
    expect((await f.state()).data).toEqual({ preserved: 'private-state' });
    expect(await db.nativeIdempotency.count({ where: { vendorId: f.vendorId } })).toBe(0);
  });
  it('enforces permission, authentication, idempotency and strict input including legacy mapping JSON', async () => {
    const f = await fixture(),
      denied = await fixture('shopify', ['vendor.chats.reply']);
    expect((await denied.send()).status).toBe(403);
    expect((await f.send({ ...f.body, variable_mappings: 'bad JSON' })).status).toBe(400);
    expect((await f.send({ ...f.body, variable_mappings: '[]' })).status).toBe(400);
    expect((await f.send({ ...f.body, unknown: 'x' })).status).toBe(400);
    expect(
      (
        await f.send({
          ...f.body,
          notification_types: ['order_confirmation', 'order_confirmation'],
        })
      ).status,
    ).toBe(400);
    const path = '/vendor-console/integration/shopify/update-notification-settings';
    expect((await request(app).post(path).send(f.body)).status).toBe(401);
    expect(
      (await request(app).post(path).set('Authorization', `Bearer ${f.token}`).send(f.body)).status,
    ).toBe(400);
  });
});
