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
  config.WHALEXY_AI_API_KEY = 'test-resolution-key';
});
afterEach(() => {
  config.WHALEXY_AI_SERVICE_URL = previous.url;
  config.WHALEXY_AI_API_KEY = previous.key;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
afterAll(() => db.$disconnect());
async function fixture(paused = true, permissions = ['*']) {
  const f = await businessFixture(permissions);
  const contact = await db.contacts.create({
    data: {
      vendorId: f.vendorId,
      assignedUserId: f.userId,
      waId: '919876543210',
      platform: 'whatsapp',
      disableAiBot: paused ? 1 : 0,
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
  await db.whatsappMessageLogs.create({
    data: {
      vendorId: f.vendorId,
      contactId: contact.id,
      message: '<b>Help</b>',
      isIncomingMessage: true,
      messagedAt: new Date(),
    },
  });
  const send = (key: string = randomUUID(), identifier: string | number = contact.uid) =>
    request(app)
      .post(`/vendor-console/conversations/${identifier}/resolve`)
      .set('Authorization', `Bearer ${f.token}`)
      .set('Idempotency-Key', key)
      .send({});
  return { ...f, contact, handoff, send };
}
const ack = () =>
  new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
async function unchanged(f: Awaited<ReturnType<typeof fixture>>) {
  expect(await db.contacts.findUniqueOrThrow({ where: { id: f.contact.id } })).toMatchObject({
    disableAiBot: 1,
    conversationStatus: 'open',
  });
  expect(
    (await db.aiConversationHandoffs.findUniqueOrThrow({ where: { id: f.handoff.id } })).status,
  ).toBe('waiting');
  expect(await db.conversationCxScores.count({ where: { vendorId: f.vendorId } })).toBe(0);
}
describe('original provider-aware conversation resolution', () => {
  it('resumes AI before committing handoff closure, transcript and one CX job, then replays without another effect', async () => {
    const f = await fixture(),
      key = randomUUID();
    const fetch = vi.fn(async (url: URL, init: any) => {
      expect(url.toString()).toBe(
        `https://automation-provider.test/v1/vendors/${f.vendorId}/conversations/automation`,
      );
      expect(JSON.parse(init.body)).toEqual({
        customer_phone: f.contact.waId,
        enabled: true,
        state: 'AI_ACTIVE',
      });
      await unchanged(f);
      return ack();
    });
    vi.stubGlobal('fetch', fetch);
    const result = await f.send(key);
    expect(result.status).toBe(202);
    expect(result.body).toMatchObject({
      status: 'resolved',
      ai_enabled: true,
      handoff: null,
      analysis: { conversation_id: f.contact.id, resolution_sequence: 1, status: 'pending' },
    });
    expect((await f.send(key, f.contact.id)).body).toEqual(result.body);
    expect((await f.send()).status).toBe(202);
    const other = await db.contacts.create({ data: { vendorId: f.vendorId } });
    expect((await f.send(key, other.uid)).status).toBe(409);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await db.contacts.findUniqueOrThrow({ where: { id: f.contact.id } })).toMatchObject({
      disableAiBot: 0,
      conversationStatus: 'resolved',
      conversationResolutionSequence: 1,
    });
    expect(
      await db.aiConversationHandoffs.findUniqueOrThrow({ where: { id: f.handoff.id } }),
    ).toMatchObject({ status: 'resolved', openKey: null });
    expect(await db.outboxJobs.count({ where: { vendorId: f.vendorId, kind: 'cx-score' } })).toBe(
      1,
    );
    expect(
      (
        await db.webhookReceipts.findUniqueOrThrow({
          where: { eventKey: `cx-transcript:${result.body.analysis.id}` },
        })
      ).payload,
    ).toMatchObject({ messages: [{ text: 'Help' }] });
    expect(JSON.stringify(result.body)).not.toContain('test-resolution-key');
  });
  it('resolves locally when AI is already enabled and does not require provider configuration', async () => {
    const f = await fixture(false);
    config.WHALEXY_AI_API_KEY = '';
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect((await f.send()).status).toBe(202);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('checks visibility, permissions, configuration and idempotency before any provider effect', async () => {
    const f = await fixture(),
      agent = await fixture(true, ['vendor.chats.reply']);
    vi.stubGlobal('fetch', vi.fn());
    expect((await agent.send()).status).toBe(403);
    expect((await f.send('bad')).status).toBe(400);
    expect(
      (await request(app).post(`/vendor-console/conversations/${f.contact.uid}/resolve`).send({}))
        .status,
    ).toBe(401);
    expect((await agent.send(randomUUID(), f.contact.uid)).status).toBe(404);
    config.WHALEXY_AI_API_KEY = '';
    expect((await f.send()).status).toBe(503);
    await unchanged(f);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('retains local state after a timeout and blocks both the original key and a new key', async () => {
    const f = await fixture(),
      key = randomUUID();
    const fetch = vi.fn().mockRejectedValue(new Error('network timeout'));
    vi.stubGlobal('fetch', fetch);
    expect((await f.send(key)).status).toBe(502);
    expect((await f.send(key)).status).toBe(409);
    expect((await f.send()).status).toBe(409);
    await unchanged(f);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('retains claimed uncertainty when provider acknowledgement is invalid', async () => {
    const f = await fixture();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: false }))),
    );
    expect((await f.send()).status).toBe(502);
    expect((await f.send()).status).toBe(409);
    await unchanged(f);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects stale conversation state after provider acceptance and cannot send again', async () => {
    const f = await fixture();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        await db.contacts.update({
          where: { id: f.contact.id },
          data: { updatedAt: new Date(Date.now() + 10000) },
        });
        return ack();
      }),
    );
    expect((await f.send()).status).toBe(409);
    await unchanged(f);
    expect((await f.send()).status).toBe(409);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rechecks revoked access after provider acceptance before writing local outcomes', async () => {
    const f = await fixture();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        await db.nativeMemberships.update({
          where: { vendorId_userId: { vendorId: f.vendorId, userId: f.userId } },
          data: { permissions: ['vendor.contacts.view'] },
        });
        return ack();
      }),
    );
    expect((await f.send()).status).toBe(403);
    await unchanged(f);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rolls back every local write after an acknowledged provider operation if the commit fails', async () => {
    const f = await fixture();
    const transaction = db.$transaction.bind(db);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        vi.spyOn(db, '$transaction').mockImplementationOnce(((callback: any) =>
          transaction(async (tx) => {
            await callback(tx);
            throw new Error('simulated commit failure');
          })) as any);
        return ack();
      }),
    );
    expect((await f.send()).status).toBe(500);
    await unchanged(f);
    expect(await db.outboxJobs.count({ where: { vendorId: f.vendorId, kind: 'cx-score' } })).toBe(
      0,
    );
    const claim = await db.nativeIdempotency.findFirstOrThrow({
      where: { vendorId: f.vendorId, key: { startsWith: 'meta-operation:' } },
    });
    expect(claim.response).toMatchObject({
      state: 'uncertain',
      acceptedResult: { remoteResumed: true },
    });
    expect((await f.send()).status).toBe(409);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('blocks competing resolution keys while the provider operation is in progress', async () => {
    const f = await fixture();
    let started!: () => void, release!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const finish = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        started();
        await finish;
        return ack();
      }),
    );
    const first = f.send().then((result) => result);
    await ready;
    try {
      expect((await f.send()).status).toBe(409);
    } finally {
      release();
    }
    expect((await first).status).toBe(202);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await db.conversationCxScores.count({ where: { vendorId: f.vendorId } })).toBe(1);
  });
});
