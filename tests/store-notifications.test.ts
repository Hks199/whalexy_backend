import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { encrypt } from '../src/utils/crypto.js';
import { processJob } from '../src/jobs/dispatcher.js';
import { ingestMeta } from '../src/jobs/handlers/meta-webhook.handler.js';
import { businessFixture } from './fixtures.js';
const app = createApp();
afterAll(() => db.$disconnect());
afterEach(() => vi.unstubAllGlobals());
async function fixture(provider: 'shopify' | 'woocommerce' = 'shopify', category = 'UTILITY') {
  const f = await businessFixture(),
    domain = `${randomUUID()}.example.com`,
    phone = `7766${f.vendorId}`;
  const store =
    provider === 'shopify'
      ? await db.shopifyIntegrations.create({
          data: {
            vendorId: f.vendorId,
            shopDomain: domain,
            accessToken: encrypt('test-token'),
            isActive: true,
          },
        })
      : await db.woocommerceIntegrations.create({
          data: {
            vendorId: f.vendorId,
            siteUrl: `https://${domain}`,
            consumerKey: encrypt('test-key'),
            consumerSecret: encrypt('test-secret'),
            isActive: true,
          },
        });
  const credential = await db.integrationCredentials.create({
    data: {
      vendorId: f.vendorId,
      provider,
      externalId: domain,
      secret: encrypt('test-secret'),
      metadata: { integrationId: store.id },
    },
  });
  await db.integrationCredentials.create({
    data: {
      vendorId: f.vendorId,
      provider: 'whatsapp',
      externalId: phone,
      secret: encrypt('test-token'),
    },
  });
  const template = await db.whatsappTemplates.create({
    data: {
      vendorId: f.vendorId,
      templateName: 'store_order',
      languageCode: 'en_US',
      status: 'APPROVED',
      category,
      data: { components: [{ type: 'BODY', text: 'Order {{1}} total {{2}}' }] },
    },
  });
  const settings = {
    enabled: true,
    phoneNumberId: phone,
    rules: ['order_confirmation', 'payment_confirmation', 'order_cancelled', 'order_completed'].map(
      (type) => ({
        type,
        templateId: template.id,
        bodyParameters: [{ orderField: 'orderNumber' }, { orderField: 'total' }],
        headerParameters: [],
      }),
    ),
  };
  const path = `/api/v1/vendors/${f.vendorId}/integrations/stores/${provider}/${store.id}/notifications`;
  expect(
    (await request(app).put(path).set('Authorization', `Bearer ${f.token}`).send(settings)).status,
  ).toBe(204);
  return { ...f, provider, store, credential, template, settings, path, phone };
}
async function order(f: Awaited<ReturnType<typeof fixture>>, extra = {}, topic?: string) {
  const body =
    f.provider === 'shopify'
      ? {
          id: '123',
          order_number: 123,
          currency: 'INR',
          total_price: '12.25',
          updated_at: '2026-01-01T12:00:00Z',
          financial_status: 'pending',
          phone: '+919876543210',
          line_items: [],
          ...extra,
        }
      : {
          id: 123,
          number: '123',
          currency: 'INR',
          total: '12.25',
          date_modified_gmt: '2026-01-01T12:00:00',
          status: 'pending',
          billing: { phone: '+919876543210', first_name: 'Customer' },
          line_items: [],
          ...extra,
        };
  const eventKey = `test-store:${randomUUID()}`,
    payload = {
      eventKey,
      credentialId: f.credential.id,
      topic: topic ?? (f.provider === 'shopify' ? 'orders/create' : 'order.created'),
      body,
    };
  await db.webhookReceipts.create({ data: { eventKey, provider: f.provider, payload } });
  const job = await db.outboxJobs.create({
    data: { vendorId: f.vendorId, kind: `webhook-${f.provider}`, payload },
  });
  await processJob(job);
  return job;
}
async function prepare(f: Awaited<ReturnType<typeof fixture>>, type = 'order_confirmation') {
  const job = await db.outboxJobs.findFirstOrThrow({
    where: {
      vendorId: f.vendorId,
      kind: 'store-notification',
      payload: { path: ['type'], equals: type },
    },
  });
  await processJob(job);
  await processJob(job);
  return db.outboxJobs.findUniqueOrThrow({ where: { dedupeKey: `store-send:${job.id}` } });
}
function sendRemote() {
  const fetch = vi.fn(
    async (_url: unknown, _init?: RequestInit) =>
      new Response(JSON.stringify({ messages: [{ id: `wamid.${randomUUID()}` }] })),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
async function configureTemplate(
  f: Awaited<ReturnType<typeof fixture>>,
  components: any[],
  extra: Record<string, unknown> = {},
) {
  await db.whatsappTemplates.update({
    where: { id: f.template.id },
    data: { data: { components }, updatedAt: new Date() },
  });
  const rule = { ...f.settings.rules[0], ...extra };
  const settings = { ...f.settings, rules: [rule] };
  return {
    settings,
    response: await request(app)
      .put(f.path)
      .set('Authorization', `Bearer ${f.token}`)
      .send(settings),
  };
}
describe('durable store notifications', () => {
  for (const provider of ['shopify', 'woocommerce'] as const)
    it(`links ${provider} customers, renders templates and sends once`, async () => {
      const f = await fixture(provider);
      const received = await order(f);
      await processJob(received);
      const job = await prepare(f),
        fetch = sendRemote();
      await processJob(job);
      await processJob(job);
      expect(fetch).toHaveBeenCalledTimes(1);
      const payload = (job.payload as any).payload;
      expect(payload.template.components[0].parameters).toEqual([
        { type: 'text', text: '123' },
        { type: 'text', text: '12.25' },
      ]);
      const contact = await db.contacts.findFirstOrThrow({
        where: { vendorId: f.vendorId, waId: '919876543210' },
      });
      expect(contact.wabPhoneNumberId).toBe(f.phone);
      const record =
        provider === 'shopify'
          ? await db.shopifyOrderNotifications.findFirstOrThrow({ where: { vendorId: f.vendorId } })
          : await db.woocommerceOrderNotifications.findFirstOrThrow({
              where: { vendorId: f.vendorId },
            });
      expect(record.status).toBe('sent');
      expect(record.contactId).toBe(contact.id);
    });
  it('does not send a stale confirmation after cancellation and emits the cancellation once', async () => {
    const f = await fixture();
    await order(f);
    const confirmation = await prepare(f);
    await order(
      f,
      { updated_at: '2026-01-01T13:00:00Z', cancelled_at: '2026-01-01T13:00:00Z' },
      'orders/cancelled',
    );
    const cancelled = await prepare(f, 'order_cancelled'),
      fetch = sendRemote();
    await processJob(confirmation);
    expect(fetch).not.toHaveBeenCalled();
    await processJob(cancelled);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      (
        await db.shopifyOrderNotifications.findFirstOrThrow({
          where: { vendorId: f.vendorId, notificationType: 'order_confirmation' },
        })
      ).status,
    ).toBe('cancelled');
  });
  it('cancels sends after notification settings, template or recipient changes', async () => {
    for (const change of ['settings', 'template', 'recipient', 'disconnect']) {
      const f = await fixture();
      await order(f);
      const job = await prepare(f),
        fetch = sendRemote();
      if (change === 'settings')
        await request(app)
          .put(f.path)
          .set('Authorization', `Bearer ${f.token}`)
          .send({ ...f.settings, enabled: false });
      if (change === 'template')
        await db.whatsappTemplates.update({
          where: { id: f.template.id },
          data: { status: 'REJECTED', updatedAt: new Date() },
        });
      if (change === 'recipient')
        await db.contacts.updateMany({
          where: { vendorId: f.vendorId },
          data: { waId: '919876543211' },
        });
      if (change === 'disconnect')
        await db.shopifyIntegrations.update({
          where: { id: f.store.id },
          data: { isActive: false },
        });
      await processJob(job);
      expect(fetch).not.toHaveBeenCalled();
      expect(
        (await db.shopifyOrderNotifications.findFirstOrThrow({ where: { vendorId: f.vendorId } }))
          .status,
      ).toBe('cancelled');
    }
  });
  it('does not let routine store sync timestamps cancel a prepared notification', async () => {
    const f = await fixture();
    await order(f);
    const job = await prepare(f);
    await order(f, { updated_at: '2026-01-01T13:00:00Z' }, 'orders/updated');
    const fetch = sendRemote();
    await processJob(job);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('preserves opt-out across identities and blocks malformed customer phones', async () => {
    const f = await fixture('shopify', 'MARKETING');
    await db.contacts.create({
      data: { vendorId: f.vendorId, waId: '919876543210', whatsappOptOut: 1 },
    });
    await order(f);
    const queued = await db.outboxJobs.findFirstOrThrow({
      where: { vendorId: f.vendorId, kind: 'store-notification' },
    });
    await processJob(queued);
    expect(
      await db.outboxJobs.count({ where: { vendorId: f.vendorId, kind: 'whatsapp-send' } }),
    ).toBe(0);
    const other = await fixture();
    await order(other, { phone: 'invalid' });
    const invalid = await db.outboxJobs.findFirstOrThrow({
      where: { vendorId: other.vendorId, kind: 'store-notification' },
    });
    await expect(processJob(invalid)).rejects.toMatchObject({
      code: 'STORE_CUSTOMER_PHONE_REQUIRED',
    });
    expect(await db.contacts.count({ where: { vendorId: other.vendorId } })).toBe(0);
  });
  it('rejects foreign sender/template/store references and incorrect parameter mappings', async () => {
    const f = await fixture(),
      other = await fixture();
    const put = (body: any) =>
      request(app).put(f.path).set('Authorization', `Bearer ${f.token}`).send(body);
    expect((await put({ ...f.settings, phoneNumberId: other.phone })).status).toBe(400);
    expect(
      (
        await put({
          ...f.settings,
          rules: [{ ...f.settings.rules[0], templateId: other.template.id }],
        })
      ).status,
    ).toBe(400);
    expect(
      (await put({ ...f.settings, rules: [{ ...f.settings.rules[0], bodyParameters: [] }] }))
        .status,
    ).toBe(409);
    expect(
      (await request(app).get(other.path).set('Authorization', `Bearer ${f.token}`)).status,
    ).toBe(403);
  });
  it('reconciles delivered/read status without regressing a read notification', async () => {
    const f = await fixture();
    await order(f);
    const job = await prepare(f);
    sendRemote();
    await processJob(job);
    const sent = await db.shopifyOrderNotifications.findFirstOrThrow({
      where: { vendorId: f.vendorId },
    });
    for (const status of ['read', 'delivered', 'failed'])
      await ingestMeta({
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: f.phone },
                  statuses: [{ id: sent.whatsappMessageId, status }],
                },
              },
            ],
          },
        ],
      });
    const final = await db.shopifyOrderNotifications.findUniqueOrThrow({ where: { id: sent.id } });
    expect(final.status).toBe('read');
    expect(final.readAt).not.toBeNull();
  });
  for (const provider of ['shopify', 'woocommerce'] as const)
    for (const type of ['image', 'video', 'document'] as const)
      it(`sends ${provider} ${type} headers with indexed URL and coupon buttons once`, async () => {
        const f = await fixture(provider),
          media = {
            type,
            url: `https://cdn.whalexy.com/order.${type === 'document' ? 'pdf' : type === 'image' ? 'png' : 'mp4'}`,
            ...(type === 'document' ? { filename: 'Order invoice.pdf' } : {}),
          };
        const components = [
          { type: 'HEADER', format: type.toUpperCase() },
          { type: 'BODY', text: 'Order {{1}} total {{2}}' },
          {
            type: 'BUTTONS',
            buttons: [
              { type: 'QUICK_REPLY', text: 'Thanks' },
              { type: 'URL', text: 'Order', url: 'https://shop.whalexy.com/orders/{{1}}' },
              { type: 'URL', text: 'Help', url: 'https://shop.whalexy.com/help' },
              { type: 'COPY_CODE', text: 'Copy code' },
            ],
          },
        ];
        const { response } = await configureTemplate(f, components, {
          mediaHeader: media,
          buttonParameters: [{ index: 1, value: { orderField: 'orderId' } }],
          copyCode: 'SAVE10',
        });
        expect(response.status).toBe(204);
        await order(f);
        const job = await prepare(f),
          fetch = sendRemote();
        await processJob(job);
        await processJob(job);
        const expected = [
          {
            type: 'header',
            parameters: [
              {
                type,
                [type]: {
                  link: media.url,
                  ...(type === 'document' ? { filename: 'Order invoice.pdf' } : {}),
                },
              },
            ],
          },
          {
            type: 'body',
            parameters: [
              { type: 'text', text: '123' },
              { type: 'text', text: '12.25' },
            ],
          },
          {
            type: 'button',
            sub_type: 'url',
            index: '1',
            parameters: [{ type: 'text', text: '123' }],
          },
          {
            type: 'button',
            sub_type: 'copy_code',
            index: '3',
            parameters: [{ type: 'coupon_code', coupon_code: 'SAVE10' }],
          },
        ];
        expect((job.payload as any).payload.template.components).toEqual(expected);
        expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).template.components).toEqual(
          expected,
        );
        expect(fetch).toHaveBeenCalledTimes(1);
        const notifications =
          provider === 'shopify'
            ? await db.shopifyOrderNotifications.count({ where: { vendorId: f.vendorId } })
            : await db.woocommerceOrderNotifications.count({ where: { vendorId: f.vendorId } });
        expect(notifications).toBe(1);
      });
  for (const provider of ['shopify', 'woocommerce'] as const)
    it(`renders ${provider} text headers and dynamic buttons in approved index order`, async () => {
      const f = await fixture(provider);
      const { response } = await configureTemplate(
        f,
        [
          { type: 'HEADER', format: 'TEXT', text: 'Hello {{1}}' },
          { type: 'BODY', text: 'Order {{1}} total {{2}}' },
          {
            type: 'BUTTONS',
            buttons: [
              { type: 'URL', url: 'https://shop.whalexy.com/{{1}}', text: 'Track' },
              { type: 'QUICK_REPLY', text: 'Help' },
              { type: 'URL', url: 'https://shop.whalexy.com/{{1}}', text: 'Order' },
            ],
          },
        ],
        {
          headerParameters: [{ contactField: 'fullName', fallback: 'Guest' }],
          buttonParameters: [
            { index: 2, value: { orderField: 'orderNumber' } },
            { index: 0, value: { orderField: 'trackingNumber', fallback: 'not-shipped' } },
          ],
        },
      );
      expect(response.status).toBe(204);
      await order(f, provider === 'shopify' ? { customer: { first_name: 'Customer' } } : {});
      const job = await prepare(f);
      const rendered = (job.payload as any).payload.template.components;
      expect(rendered[0]).toEqual({
        type: 'header',
        parameters: [{ type: 'text', text: 'Customer' }],
      });
      expect(rendered.slice(2)).toEqual([
        {
          type: 'button',
          sub_type: 'url',
          index: '0',
          parameters: [{ type: 'text', text: 'not-shipped' }],
        },
        {
          type: 'button',
          sub_type: 'url',
          index: '2',
          parameters: [{ type: 'text', text: '123' }],
        },
      ]);
    });
  it('rejects mismatched rich mappings without replacing saved settings', async () => {
    const f = await fixture(),
      components = [
        { type: 'HEADER', format: 'DOCUMENT' },
        { type: 'BODY', text: 'Order {{1}} total {{2}}' },
        {
          type: 'BUTTONS',
          buttons: [
            { type: 'URL', text: 'Order', url: 'https://shop.whalexy.com/{{1}}' },
            { type: 'COPY_CODE', text: 'Copy' },
          ],
        },
      ];
    const valid = {
      mediaHeader: {
        type: 'document',
        url: 'https://cdn.whalexy.com/order.pdf',
        filename: 'invoice.pdf',
      },
      buttonParameters: [{ index: 0, value: { orderField: 'orderNumber' } }],
      copyCode: 'SAVE10',
    };
    const { settings, response } = await configureTemplate(f, components, valid);
    expect(response.status).toBe(204);
    const before = (await request(app).get(f.path).set('Authorization', `Bearer ${f.token}`)).body;
    const cases = [
      { mediaHeader: undefined },
      { mediaHeader: { ...valid.mediaHeader, type: 'image', filename: undefined } },
      { mediaHeader: { ...valid.mediaHeader, filename: undefined } },
      { mediaHeader: { ...valid.mediaHeader, filename: '../invoice.pdf' } },
      { mediaHeader: { ...valid.mediaHeader, url: 'https://127.0.0.1/invoice.pdf' } },
      { mediaHeader: { ...valid.mediaHeader, url: 'http://cdn.whalexy.com/invoice.pdf' } },
      { mediaHeader: { ...valid.mediaHeader, url: 'https://cdn.whalexy.com/invoice.pdf#secret' } },
      { buttonParameters: [] },
      { buttonParameters: [{ index: 1, value: { literal: '123' } }] },
      { buttonParameters: [valid.buttonParameters[0], valid.buttonParameters[0]] },
      { copyCode: undefined },
      { copyCode: '1234567890123456' },
      { headerParameters: [{ literal: 'Unexpected' }] },
      { bodyParameters: [] },
    ];
    for (const change of cases) {
      const result = await request(app)
        .put(f.path)
        .set('Authorization', `Bearer ${f.token}`)
        .send({ ...settings, rules: [{ ...settings.rules[0], ...change }] });
      expect([400, 409]).toContain(result.status);
    }
    expect((await request(app).get(f.path).set('Authorization', `Bearer ${f.token}`)).body).toEqual(
      before,
    );
  });
  it('rejects unsupported or ambiguous approved components', async () => {
    const f = await fixture();
    for (const components of [
      [{ type: 'HEADER', format: 'LOCATION' }],
      [{ type: 'BODY', text: 'Hi {{2}}' }],
      [
        { type: 'BODY', text: 'Hi' },
        { type: 'BODY', text: 'Again' },
      ],
      [
        { type: 'BODY', text: 'Hi' },
        { type: 'BUTTONS', buttons: [{ type: 'FLOW', text: 'Start' }] },
      ],
      [
        { type: 'BODY', text: 'Hi' },
        {
          type: 'BUTTONS',
          buttons: [{ type: 'URL', url: 'https://shop.whalexy.com/{{1}}/{{2}}' }],
        },
      ],
    ]) {
      const { response } = await configureTemplate(f, components, { bodyParameters: [] });
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('RICH_TEMPLATE_MAPPING');
    }
  });
  it('rolls back contact, notification and receipt writes when a resolved button is invalid', async () => {
    const f = await fixture();
    const { response } = await configureTemplate(
      f,
      [
        { type: 'BODY', text: 'Order {{1}} total {{2}}' },
        {
          type: 'BUTTONS',
          buttons: [{ type: 'URL', text: 'Track', url: 'https://shop.whalexy.com/{{1}}' }],
        },
      ],
      { buttonParameters: [{ index: 0, value: { orderField: 'trackingNumber' } }] },
    );
    expect(response.status).toBe(204);
    await order(f, { fulfillments: [{ tracking_number: 'bad\nvalue' }] });
    const job = await db.outboxJobs.findFirstOrThrow({
      where: { vendorId: f.vendorId, kind: 'store-notification' },
    });
    const fetch = sendRemote();
    await expect(processJob(job)).rejects.toMatchObject({ code: 'TEMPLATE_VALUE_INVALID' });
    expect(fetch).not.toHaveBeenCalled();
    expect(await db.contacts.count({ where: { vendorId: f.vendorId } })).toBe(0);
    expect(await db.shopifyOrderNotifications.count({ where: { vendorId: f.vendorId } })).toBe(0);
    expect(
      await db.outboxJobs.count({ where: { vendorId: f.vendorId, kind: 'whatsapp-send' } }),
    ).toBe(0);
    expect(
      await db.webhookReceipts.count({ where: { eventKey: `store-notification:${job.id}` } }),
    ).toBe(0);
  });
  it('cancels a prepared rich send after its adapter configuration changes', async () => {
    const f = await fixture(),
      components = [
        { type: 'HEADER', format: 'IMAGE' },
        { type: 'BODY', text: 'Order {{1}} total {{2}}' },
      ];
    const { settings, response } = await configureTemplate(f, components, {
      mediaHeader: { type: 'image', url: 'https://cdn.whalexy.com/original.png' },
    });
    expect(response.status).toBe(204);
    await order(f);
    const job = await prepare(f);
    const changed = await request(app)
      .put(f.path)
      .set('Authorization', `Bearer ${f.token}`)
      .send({
        ...settings,
        rules: [
          {
            ...settings.rules[0],
            mediaHeader: { type: 'image', url: 'https://cdn.whalexy.com/changed.png' },
          },
        ],
      });
    expect(changed.status).toBe(204);
    const fetch = sendRemote();
    await processJob(job);
    expect(fetch).not.toHaveBeenCalled();
    expect(
      (await db.shopifyOrderNotifications.findFirstOrThrow({ where: { vendorId: f.vendorId } }))
        .status,
    ).toBe('cancelled');
  });
});
