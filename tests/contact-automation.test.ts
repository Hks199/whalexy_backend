import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { config } from '../src/config/environment.js';
import { db } from '../src/database/client.js';
import { businessFixture } from './fixtures.js';
const app = createApp(),
  previous = { url: config.WHALEXY_AI_SERVICE_URL, key: config.WHALEXY_AI_API_KEY };
beforeEach(() => {
  config.WHALEXY_AI_SERVICE_URL = 'https://automation-provider.test';
  config.WHALEXY_AI_API_KEY = 'test-automation-key';
});
afterEach(() => {
  config.WHALEXY_AI_SERVICE_URL = previous.url;
  config.WHALEXY_AI_API_KEY = previous.key;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
afterAll(() => db.$disconnect());
async function fixture(paused = true, permissions = ['*'], entitled = true) {
  const f = await businessFixture(permissions);
  const contact = await db.contacts.create({
    data: {
      vendorId: f.vendorId,
      assignedUserId: f.userId,
      waId: `9198${f.vendorId}`,
      platform: 'whatsapp',
      disableAiBot: paused ? 1 : 0,
      conversationStatus: 'open',
      conversationResolutionSequence: 4,
    },
  });
  const handoff = await db.aiConversationHandoffs.create({
    data: {
      vendorId: f.vendorId,
      contactId: contact.id,
      assignedUserId: f.userId,
      openKey: `${f.vendorId}:${contact.id}`,
      requestedAt: new Date(),
    },
  });
  if (entitled) {
    await db.manualSubscriptions.create({ data: { vendorId: f.vendorId, status: 'active' } });
    await db.subscriptionAddons.create({
      data: {
        vendorId: f.vendorId,
        addonCode: 'ai_replies',
        price: 0,
        source: 'admin_override',
        status: 'active',
      },
    });
  }
  const send = (key = randomUUID(), uid = contact.uid) =>
    request(app)
      .post(`/vendor-console/contacts/${uid}/toggle-ai-bot`)
      .set('Authorization', `Bearer ${f.token}`)
      .set('Idempotency-Key', key)
      .send({});
  const native = (enabled: boolean, key = randomUUID()) =>
    request(app)
      .post(`/api/v1/vendors/${f.vendorId}/contacts/${contact.id}/ai`)
      .set('Authorization', `Bearer ${f.token}`)
      .set('Idempotency-Key', key)
      .send({ enabled });
  return { ...f, contact, handoff, send, native };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const contact = (f: Fixture) => db.contacts.findUniqueOrThrow({ where: { id: f.contact.id } });
const handoff = (f: Fixture) =>
  db.aiConversationHandoffs.findUniqueOrThrow({ where: { id: f.handoff.id } });
const ack = () => new Response(JSON.stringify({ success: true }));
describe('provider-aware contact automation settings', () => {
  it('resumes before changing local AI and closing the handoff, then replays a toggle once', async () => {
    const f = await fixture(),
      key = randomUUID();
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect((await contact(f)).disableAiBot).toBe(1);
      expect((await handoff(f)).status).toBe('waiting');
      expect(JSON.parse(String(init?.body))).toEqual({
        customer_phone: f.contact.waId,
        enabled: true,
        state: 'AI_ACTIVE',
      });
      return ack();
    });
    vi.stubGlobal('fetch', fetch);
    const result = await f.send(key);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      contact_uid: f.contact.uid,
      isAiChatBotEnabled: true,
      contact: { disable_ai_bot: 0 },
    });
    expect((await f.send(key)).body).toEqual(result.body);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await contact(f)).toMatchObject({
      disableAiBot: 0,
      conversationStatus: 'open',
      conversationResolutionSequence: 4,
    });
    expect((await handoff(f)).status).toBe('resolved');
    expect(await db.conversationCxScores.count({ where: { vendorId: f.vendorId } })).toBe(0);
  });
  it('pauses locally before synchronizing, preserves handoffs and allows pause without entitlement', async () => {
    const f = await fixture(false, ['*'], false);
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect((await contact(f)).disableAiBot).toBe(1);
      expect(JSON.parse(String(init?.body))).toEqual({
        customer_phone: f.contact.waId,
        enabled: false,
      });
      return ack();
    });
    vi.stubGlobal('fetch', fetch);
    expect((await f.send()).status).toBe(200);
    expect((await handoff(f)).status).toBe('waiting');
    expect(
      await db.auditEvents.count({ where: { vendorId: f.vendorId, action: 'ai-pause-local' } }),
    ).toBe(1);
  });
  it('keeps AI paused after transport or malformed acknowledgements and blocks repeated uncertain effects', async () => {
    for (const pause of [true, false]) {
      const f = await fixture(pause),
        key = randomUUID();
      const fetch = vi.fn(async () => {
        throw new Error('connection lost');
      });
      vi.stubGlobal('fetch', fetch);
      expect((await f.send(key)).status).toBeGreaterThanOrEqual(500);
      expect((await contact(f)).disableAiBot).toBe(1);
      expect((await handoff(f)).status).toBe('waiting');
      expect((await f.send(key)).status).toBe(409);
      expect((await f.send()).status).toBe(409);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(
        (
          await request(app)
            .post(`/vendor-console/conversations/${f.contact.uid}/resolve`)
            .set('Authorization', `Bearer ${f.token}`)
            .set('Idempotency-Key', randomUUID())
            .send({})
        ).status,
      ).toBe(409);
    }
    const f = await fixture();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ success: true, enabled: false }))),
    );
    expect((await f.send()).status).toBe(502);
    expect((await contact(f)).disableAiBot).toBe(1);
  });
  it('requires entitlement for resume, fresh permission and assigned visibility', async () => {
    const f = await fixture(true, ['*'], false),
      foreign = await fixture(),
      denied = await fixture(true, ['vendor.chats.reply']);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect((await f.send()).status).toBe(403);
    expect((await foreign.send(randomUUID(), f.contact.uid)).status).toBe(404);
    expect((await denied.send()).status).toBe(403);
    const assigned = await fixture(true, ['vendor.ai.manage']);
    await db.contacts.update({
      where: { id: assigned.contact.id },
      data: { assignedUserId: null },
    });
    expect((await assigned.send()).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('retains local pause and acknowledged intent when the contact changes during resume', async () => {
    const f = await fixture(),
      key = randomUUID();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        await db.contacts.update({
          where: { id: f.contact.id },
          data: { firstName: 'Changed', updatedAt: new Date(Date.now() + 1000) },
        });
        return ack();
      }),
    );
    expect((await f.send(key)).status).toBe(409);
    expect((await contact(f)).disableAiBot).toBe(1);
    expect((await handoff(f)).status).toBe('waiting');
    const operation = await db.nativeIdempotency.findUniqueOrThrow({
      where: { vendorId_key: { vendorId: f.vendorId, key: `meta-operation:${key}` } },
    });
    expect(operation.response).toMatchObject({
      state: 'uncertain',
      acceptedResult: { enabled: true },
    });
    expect((await f.send()).status).toBe(409);
  });
  it('rolls back handoff closure and local enablement after final audit failure', async () => {
    const f = await fixture();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ack()),
    );
    const transaction = db.$transaction.bind(db);
    vi.spyOn(db, '$transaction').mockImplementation((async (fn: any, options: any) =>
      transaction(async (tx) => {
        const original = tx.auditEvents.create.bind(tx.auditEvents);
        tx.auditEvents.create = ((args: any) =>
          args.data.action === 'provider-operation'
            ? Promise.reject(new Error('audit failed'))
            : original(args)) as any;
        return fn(tx);
      }, options)) as any);
    expect((await f.send()).status).toBe(500);
    expect((await contact(f)).disableAiBot).toBe(1);
    expect((await handoff(f)).status).toBe('waiting');
  });
  it('shares native explicit settings with source toggles and retains native 204 semantics', async () => {
    const f = await fixture();
    const fetch = vi.fn(async () => ack());
    vi.stubGlobal('fetch', fetch);
    const key = randomUUID();
    expect((await f.native(true, key)).status).toBe(204);
    expect((await f.native(true, key)).status).toBe(204);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await f.native(false, key)).status).toBe(409);
    expect((await f.native(false)).status).toBe(204);
    expect((await contact(f)).disableAiBot).toBe(1);
  });
  it('rejects missing headers, invalid bodies, inactive contacts and unavailable configuration', async () => {
    const f = await fixture();
    expect(
      (
        await request(app)
          .post(`/vendor-console/contacts/${f.contact.uid}/toggle-ai-bot`)
          .set('Authorization', `Bearer ${f.token}`)
          .send({})
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post(`/vendor-console/contacts/${f.contact.uid}/toggle-ai-bot`)
          .set('Authorization', `Bearer ${f.token}`)
          .set('Idempotency-Key', randomUUID())
          .send({ enabled: true })
      ).status,
    ).toBe(400);
    expect(
      (await request(app).post(`/vendor-console/contacts/${f.contact.uid}/toggle-ai-bot`).send({}))
        .status,
    ).toBe(401);
    config.WHALEXY_AI_SERVICE_URL = undefined as any;
    expect((await f.send()).status).toBe(503);
    expect((await contact(f)).disableAiBot).toBe(1);
    await db.contacts.update({ where: { id: f.contact.id }, data: { status: 0 } });
    expect((await f.send()).status).toBe(409);
  });
});
