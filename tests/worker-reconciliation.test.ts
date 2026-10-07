import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { encrypt } from '../src/utils/crypto.js';
import { providerRequest } from '../src/infrastructure/providers/meta.client.js';
import { processJob } from '../src/jobs/dispatcher.js';
import { ingestMeta } from '../src/jobs/handlers/meta-webhook.handler.js';
import { businessFixture } from './fixtures.js';
const app = createApp();
afterAll(() => db.$disconnect());
afterEach(() => vi.unstubAllGlobals());
async function fixture() {
  const f = await businessFixture(),
    phone = `7799${f.vendorId}`;
  await db.integrationCredentials.create({
    data: {
      vendorId: f.vendorId,
      provider: 'whatsapp',
      externalId: phone,
      secret: encrypt('test-token'),
    },
  });
  const contact = await db.contacts.create({
    data: {
      vendorId: f.vendorId,
      waId: '919876543210',
      wabPhoneNumberId: phone,
      platform: 'whatsapp',
    },
  });
  await db.whatsappMessageLogs.create({
    data: {
      vendorId: f.vendorId,
      contactId: contact.id,
      contactWaId: contact.waId,
      wabPhoneNumberId: phone,
      type: 'text',
      message: 'Incoming',
      isIncomingMessage: true,
      messagedAt: new Date(),
    },
  });
  const log = await db.whatsappMessageLogs.create({
    data: {
      vendorId: f.vendorId,
      contactId: contact.id,
      contactWaId: contact.waId,
      wabPhoneNumberId: phone,
      type: 'text',
      message: 'Reply',
      isIncomingMessage: false,
      status: 'queued',
      messagedAt: new Date(),
    },
  });
  const job = await db.outboxJobs.create({
    data: {
      vendorId: f.vendorId,
      kind: 'whatsapp-send',
      status: 'processing',
      lockedAt: new Date(),
      payload: {
        messageId: log.id,
        phoneNumberId: phone,
        payload: {
          messaging_product: 'whatsapp',
          to: contact.waId,
          type: 'text',
          text: { body: 'Reply' },
        },
      },
    },
  });
  return { ...f, phone, contact, log, job };
}
function callback(f: Awaited<ReturnType<typeof fixture>>, id: string, status = 'read', extra = {}) {
  return ingestMeta({
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: f.phone },
              statuses: [
                {
                  id,
                  status,
                  recipient_id: f.contact.waId,
                  biz_opaque_callback_data: f.job.id,
                  ...extra,
                },
              ],
            },
          },
        ],
      },
    ],
  });
}
describe('provider effect certainty', () => {
  for (const response of [
    () => new Response('bad JSON'),
    () => new Response('{}', { status: 500 }),
    () => new Response('x'.repeat(2_000_001)),
  ])
    it('retains ambiguous mutation responses as uncertain', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => response()),
      );
      await expect(
        providerRequest(new URL('https://provider.example'), { method: 'POST', body: '{}' }),
      ).rejects.toMatchObject({ code: 'PROVIDER_UNCERTAIN' });
    });
  it('keeps a client rejection distinct from an ambiguous server effect', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 400 })),
    );
    await expect(
      providerRequest(new URL('https://provider.example'), { method: 'POST' }),
    ).rejects.toMatchObject({ code: 'PROVIDER_REJECTED' });
  });
});
describe('WhatsApp callback correlation', () => {
  it('preserves a read receipt arriving before the send response', async () => {
    const f = await fixture(),
      id = `wamid.${randomUUID()}`;
    const fetch = vi.fn(async (_url: URL, init: RequestInit) => {
      expect(JSON.parse(String(init.body)).biz_opaque_callback_data).toBe(f.job.id);
      await callback(f, id);
      return new Response(JSON.stringify({ messages: [{ id }] }));
    });
    vi.stubGlobal('fetch', fetch);
    await processJob(f.job);
    const log = await db.whatsappMessageLogs.findUniqueOrThrow({ where: { id: f.log.id } });
    expect(log.status).toBe('read');
    expect(log.whatsappMessageId).toBe(id);
    expect((await db.outboxJobs.findUniqueOrThrow({ where: { id: f.job.id } })).status).toBe(
      'completed',
    );
    await processJob(f.job);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('reconciles an uncertain send from a correlated callback without resending', async () => {
    const f = await fixture(),
      id = `wamid.${randomUUID()}`;
    await db.outboxJobs.update({
      where: { id: f.job.id },
      data: { status: 'uncertain', lastError: 'WORKER_INTERRUPTED' },
    });
    await callback(f, id, 'delivered');
    await callback(f, id, 'delivered');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await processJob(f.job);
    expect(fetch).not.toHaveBeenCalled();
    expect(
      (await db.whatsappMessageLogs.findUniqueOrThrow({ where: { id: f.log.id } })).status,
    ).toBe('delivered');
    expect((await db.outboxJobs.findUniqueOrThrow({ where: { id: f.job.id } })).status).toBe(
      'completed',
    );
  });
  it('rejects callback linkage from another recipient or business', async () => {
    const f = await fixture(),
      other = await fixture();
    await callback(f, `wamid.${randomUUID()}`, 'read', { recipient_id: '919876543211' });
    await callback(other, `wamid.${randomUUID()}`, 'read', { biz_opaque_callback_data: f.job.id });
    expect(
      (await db.whatsappMessageLogs.findUniqueOrThrow({ where: { id: f.log.id } }))
        .whatsappMessageId,
    ).toBeNull();
    expect((await db.outboxJobs.findUniqueOrThrow({ where: { id: f.job.id } })).status).toBe(
      'processing',
    );
  });
});
describe('audited job recovery controls', () => {
  it('lists metadata only and allows owner recovery of a blocked internal job', async () => {
    const f = await fixture();
    const job = await db.outboxJobs.create({
      data: {
        vendorId: f.vendorId,
        kind: 'webhook-shopify',
        status: 'blocked',
        lastError: 'STORE_NOT_CONFIGURED',
        payload: { secret: 'do-not-return', body: { phone: 'private' } },
      },
    });
    const path = `/api/v1/vendors/${f.vendorId}/jobs`,
      auth = `Bearer ${f.token}`;
    const list = await request(app).get(path).set('Authorization', auth);
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain('do-not-return');
    expect(JSON.stringify(list.body)).not.toContain('payload');
    expect(
      (await request(app).post(`${path}/${job.id}/retry`).set('Authorization', auth).send({}))
        .status,
    ).toBe(202);
    expect((await db.outboxJobs.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      'pending',
    );
    expect(
      await db.auditEvents.count({
        where: {
          vendorId: f.vendorId,
          resource: 'outbox-job',
          resourceId: job.id,
          action: 'retry',
        },
      }),
    ).toBe(1);
    expect(
      (await request(app).post(`${path}/${job.id}/retry`).set('Authorization', auth).send({}))
        .status,
    ).toBe(409);
  });
  it('refuses uncertain external effects, unknown handlers and foreign job ownership', async () => {
    const f = await fixture(),
      other = await fixture();
    await db.outboxJobs.update({
      where: { id: f.job.id },
      data: { status: 'uncertain', lastError: 'PROVIDER_UNCERTAIN' },
    });
    const path = `/api/v1/vendors/${f.vendorId}/jobs`,
      auth = `Bearer ${f.token}`;
    expect(
      (await request(app).post(`${path}/${f.job.id}/retry`).set('Authorization', auth).send({}))
        .body.error.code,
    ).toBe('PROVIDER_RECONCILIATION_REQUIRED');
    const unknown = await db.outboxJobs.create({
      data: { vendorId: f.vendorId, kind: 'unknown-handler', status: 'blocked', payload: {} },
    });
    expect(
      (await request(app).post(`${path}/${unknown.id}/retry`).set('Authorization', auth).send({}))
        .status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .post(`/api/v1/vendors/${other.vendorId}/jobs/${f.job.id}/retry`)
          .set('Authorization', `Bearer ${other.token}`)
          .send({})
      ).status,
    ).toBe(404);
    expect((await request(app).get('/api/v1/admin/jobs').set('Authorization', auth)).status).toBe(
      403,
    );
  });
});
