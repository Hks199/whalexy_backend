import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { businessFixture } from './fixtures.js';
import { digest, encrypt } from '../src/utils/crypto.js';
import { processJob } from '../src/jobs/dispatcher.js';
const app = createApp();
afterAll(() => db.$disconnect());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function fixture(provider: 'shopify' | 'woocommerce' = 'shopify', permissions = ['*']) {
  const f = await businessFixture(permissions),
    phone = `7866${f.vendorId}`;
  await db.manualSubscriptions.create({ data: { vendorId: f.vendorId, status: 'active' } });
  await db.integrationCredentials.create({
    data: {
      vendorId: f.vendorId,
      provider: 'whatsapp',
      externalId: phone,
      secret: encrypt('test-retry'),
    },
  });
  const contact = await db.contacts.create({
    data: {
      vendorId: f.vendorId,
      assignedUserId: f.userId,
      platform: 'whatsapp',
      waId: `9199${f.vendorId}`,
      wabPhoneNumberId: phone,
    },
  });
  const template = await db.whatsappTemplates.create({
    data: {
      vendorId: f.vendorId,
      templateName: 'retry_order',
      languageCode: 'en',
      category: 'UTILITY',
      status: 'APPROVED',
      data: { components: [{ type: 'BODY', text: 'Your order' }] },
    },
  });
  const setting = {
    enabled: true,
    phoneNumberId: phone,
    rules: [
      {
        type: 'order_confirmation',
        templateId: template.id,
        bodyParameters: [],
        headerParameters: [],
      },
    ],
  };
  const store =
    provider === 'shopify'
      ? await db.shopifyIntegrations.create({
          data: {
            vendorId: f.vendorId,
            shopDomain: `retry-${f.vendorId}.myshopify.com`,
            accessToken: 'unused',
            isActive: true,
            data: { nodeNotifications: setting },
          },
        })
      : await db.woocommerceIntegrations.create({
          data: {
            vendorId: f.vendorId,
            siteUrl: `https://retry-${f.vendorId}.merchant.com`,
            consumerKey: 'unused',
            consumerSecret: 'unused',
            isActive: true,
            data: { nodeNotifications: setting },
          },
        });
  const stored =
    provider === 'shopify'
      ? await db.shopifyIntegrations.findUniqueOrThrow({ where: { id: store.id } })
      : await db.woocommerceIntegrations.findUniqueOrThrow({ where: { id: store.id } });
  const order =
    provider === 'shopify'
      ? await db.shopifyOrders.create({
          data: {
            vendorId: f.vendorId,
            shopifyIntegrationsId: store.id,
            shopifyOrderId: '1',
            orderNumber: '1',
            name: '#1',
          },
        })
      : await db.woocommerceOrders.create({
          data: {
            vendorId: f.vendorId,
            woocommerceIntegrationsId: store.id,
            woocommerceOrderId: 1,
            orderNumber: '1',
          },
        });
  const notification =
    provider === 'shopify'
      ? await db.shopifyOrderNotifications.create({
          data: {
            vendorId: f.vendorId,
            shopifyOrdersId: order.id,
            contactId: contact.id,
            notificationType: 'order_confirmation',
            status: 'failed',
          },
        })
      : await db.woocommerceOrderNotifications.create({
          data: {
            vendorId: f.vendorId,
            woocommerceOrdersId: order.id,
            contactId: contact.id,
            templateId: template.id,
            notificationType: 'order_confirmation',
            status: 'failed',
          },
        });
  const log = await db.whatsappMessageLogs.create({
    data: {
      vendorId: f.vendorId,
      contactId: contact.id,
      contactWaId: contact.waId,
      wabPhoneNumberId: phone,
      type: 'template',
      status: 'failed',
      isIncomingMessage: false,
      messagedAt: new Date(),
    },
  });
  const job = await db.outboxJobs.create({
    data: {
      vendorId: f.vendorId,
      kind: 'whatsapp-send',
      dedupeKey: `store-send:${randomUUID()}`,
      status: 'failed',
      attempts: 5,
      lastError: 'PROVIDER_REJECTED',
      payload: {
        messageId: log.id,
        phoneNumberId: phone,
        storeNotification: {
          provider,
          notificationId: notification.id,
          integrationId: store.id,
          settingsRevision: digest(JSON.stringify((stored.data as any).nodeNotifications)),
          templateId: template.id,
          templateRevision: template.updatedAt.toISOString(),
        },
        payload: {
          messaging_product: 'whatsapp',
          to: contact.waId,
          type: 'template',
          template: { name: template.templateName, language: { code: 'en' }, components: [] },
        },
      },
    },
  });
  const send = (key = randomUUID(), id = notification.id) =>
    request(app)
      .post(`/vendor-console/integration/${provider}/notifications/${id}/resend`)
      .set('Authorization', `Bearer ${f.token}`)
      .set('Idempotency-Key', key)
      .send({});
  return { ...f, provider, phone, contact, template, store, order, notification, log, job, send };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const notification = (f: Fixture) =>
  f.provider === 'shopify'
    ? db.shopifyOrderNotifications.findUniqueOrThrow({ where: { id: f.notification.id } })
    : db.woocommerceOrderNotifications.findUniqueOrThrow({ where: { id: f.notification.id } });
async function unchanged(f: Fixture) {
  expect((await db.outboxJobs.findUniqueOrThrow({ where: { id: f.job.id } })).status).toBe(
    'failed',
  );
  expect((await notification(f)).status).toBe('failed');
}
describe('guarded original store notification resend APIs', () => {
  for (const provider of ['shopify', 'woocommerce'] as const)
    it(`requeues ${provider} exactly once and acknowledges delivery without replacing history`, async () => {
      const f = await fixture(provider),
        key = randomUUID(),
        first = await f.send(key);
      expect(first.status).toBe(202);
      expect(first.body).toMatchObject({
        success: true,
        status: 'pending',
        job_id: f.job.id,
        notification_id: f.notification.id,
      });
      expect((await f.send(key)).body).toEqual(first.body);
      expect(await db.outboxJobs.count({ where: { vendorId: f.vendorId } })).toBe(1);
      expect((await notification(f)).status).toBe('queued');
      if (provider === 'woocommerce')
        expect((await notification(f)) as any).toMatchObject({ retryCount: 1 });
      const job = await db.outboxJobs.findUniqueOrThrow({ where: { id: f.job.id } });
      expect(job.payload).toMatchObject({ sentByUserId: f.userId });
      expect((await f.send()).status).toBe(409);
      const fetch = vi.fn(
        async () =>
          new Response(JSON.stringify({ messages: [{ id: `wamid.retry.${randomUUID()}` }] })),
      );
      vi.stubGlobal('fetch', fetch);
      await processJob(job);
      await processJob(job);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect((await notification(f)).status).toBe('sent');
      expect((await f.send()).status).toBe(409);
    });
  it('blocks uncertain/unknown failures and sent notification history', async () => {
    for (const error of ['PROVIDER_UNCERTAIN', 'WORKER_INTERRUPTED', 'INTERNAL_JOB_ERROR']) {
      const f = await fixture();
      await db.outboxJobs.update({ where: { id: f.job.id }, data: { lastError: error } });
      expect((await f.send()).status).toBe(409);
      await unchanged(f);
    }
    const f = await fixture();
    await db.shopifyOrderNotifications.update({
      where: { id: f.notification.id },
      data: { sentAt: new Date() },
    });
    expect((await f.send()).status).toBe(409);
    await unchanged(f);
  });
  it('blocks changed settings, templates, orders and opted-out marketing recipients', async () => {
    const mismatched = await fixture();
    const wrongTemplatePayload = mismatched.job.payload as any;
    wrongTemplatePayload.payload.template.name = 'another_template';
    await db.outboxJobs.update({
      where: { id: mismatched.job.id },
      data: { payload: wrongTemplatePayload },
    });
    expect((await mismatched.send()).status).toBe(409);
    await unchanged(mismatched);
    const settings = await fixture();
    await db.shopifyIntegrations.update({
      where: { id: settings.store.id },
      data: { data: { nodeNotifications: { enabled: false } } },
    });
    expect((await settings.send()).status).toBe(409);
    await unchanged(settings);
    const template = await fixture();
    await db.whatsappTemplates.update({
      where: { id: template.template.id },
      data: { updatedAt: new Date(Date.now() + 1000) },
    });
    expect((await template.send()).status).toBe(409);
    await unchanged(template);
    const order = await fixture();
    await db.shopifyOrders.update({
      where: { id: order.order.id },
      data: { updatedAt: new Date(Date.now() + 1000) },
    });
    expect((await order.send()).status).toBe(409);
    await unchanged(order);
    const opted = await fixture();
    await db.whatsappTemplates.update({
      where: { id: opted.template.id },
      data: { category: 'MARKETING' },
    });
    const approvedMarketing = await db.whatsappTemplates.findUniqueOrThrow({
      where: { id: opted.template.id },
    });
    const marketingPayload = opted.job.payload as any;
    marketingPayload.storeNotification.templateRevision = approvedMarketing.updatedAt.toISOString();
    await db.outboxJobs.update({
      where: { id: opted.job.id },
      data: { payload: marketingPayload },
    });
    await db.contacts.update({ where: { id: opted.contact.id }, data: { whatsappOptOut: 1 } });
    const deniedMarketing = await opted.send();
    expect(deniedMarketing.status).toBe(409);
    expect(JSON.stringify(deniedMarketing.body)).toContain('MARKETING_OPT_OUT');
    await unchanged(opted);
  });
  it('enforces ownership, assigned visibility, permissions and active subscription', async () => {
    const f = await fixture(),
      other = await fixture(),
      denied = await fixture('shopify', ['vendor.integrations.manage']);
    expect((await f.send(randomUUID(), other.notification.id)).status).toBe(404);
    expect((await denied.send()).status).toBe(403);
    const assigned = await fixture('shopify', ['vendor.integrations.manage', 'vendor.chats.reply']);
    await db.contacts.update({
      where: { id: assigned.contact.id },
      data: { assignedUserId: null },
    });
    expect((await assigned.send()).status).toBe(404);
    await db.manualSubscriptions.updateMany({
      where: { vendorId: f.vendorId },
      data: { status: 'inactive' },
    });
    expect((await f.send()).status).toBe(403);
    await unchanged(f);
  });
  it('limits WooCommerce retries and rejects missing/ambiguous native jobs', async () => {
    const woo = await fixture('woocommerce');
    await db.woocommerceOrderNotifications.update({
      where: { id: woo.notification.id },
      data: { retryCount: 3 },
    });
    expect((await woo.send()).status).toBe(409);
    await unchanged(woo);
    const missing = await fixture();
    await db.outboxJobs.delete({ where: { id: missing.job.id } });
    const missingResponse = await missing.send();
    expect(missingResponse.status).toBe(409);
    expect(JSON.stringify(missingResponse.body)).toContain('NOTIFICATION_RECONCILIATION_REQUIRED');
    expect((await notification(missing)).status).toBe('failed');
    const f = await fixture();
    await db.outboxJobs.create({
      data: { vendorId: f.vendorId, kind: 'whatsapp-send', payload: f.job.payload as any },
    });
    expect((await f.send()).status).toBe(409);
    await unchanged(f);
  });
  it('rolls back notification, message and queue state if audit fails', async () => {
    const f = await fixture(),
      transaction = db.$transaction.bind(db);
    vi.spyOn(db, '$transaction').mockImplementation((async (fn: any, options: any) =>
      transaction(async (tx) => {
        tx.auditEvents.create = (() => Promise.reject(new Error('audit failed'))) as any;
        return fn(tx);
      }, options)) as any);
    expect((await f.send()).status).toBe(500);
    await unchanged(f);
    expect(
      (await db.whatsappMessageLogs.findUniqueOrThrow({ where: { id: f.log.id } })).status,
    ).toBe('failed');
    expect(
      await db.nativeIdempotency.count({
        where: { vendorId: f.vendorId, key: { startsWith: 'store-retry:' } },
      }),
    ).toBe(0);
  });
  it('rejects invalid inputs and requires an idempotency header and authentication', async () => {
    const f = await fixture(),
      path = `/vendor-console/integration/shopify/notifications/${f.notification.id}/resend`;
    expect(
      (await request(app).post(path).set('Authorization', `Bearer ${f.token}`).send({})).status,
    ).toBe(400);
    expect((await request(app).post(path).send({})).status).toBe(401);
    expect(
      (
        await request(app)
          .post(path)
          .set('Authorization', `Bearer ${f.token}`)
          .set('Idempotency-Key', randomUUID())
          .send({ force: true })
      ).status,
    ).toBe(400);
    expect((await f.send(randomUUID(), 0)).status).toBe(400);
    await unchanged(f);
  });
});
