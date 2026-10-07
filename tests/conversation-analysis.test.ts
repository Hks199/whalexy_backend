import { beforeAll, afterAll, afterEach, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { processJob } from '../src/jobs/dispatcher.js';
import { recoverInterruptedJobs } from '../src/jobs/recovery.js';
import { businessFixture } from './fixtures.js';
const app = createApp();
let owner: Awaited<ReturnType<typeof businessFixture>>, foreign: typeof owner, agent: typeof owner;
const previousKey = process.env.GROQ_API_KEY;
const output = {
  intent: 'Support',
  intent_confidence: 97,
  sentiment: 'Neutral',
  sentiment_confidence: 90,
  urgency: 'Medium',
  risk_level: 'None',
  lead_score: 23,
  lead_category: 'Low Intent',
  ai_insight: 'Needs help.',
  conversation_summary: 'Customer asked for help. Agent replied. Customer confirmed the answer.',
  next_best_action: 'Confirm resolution.',
  suggested_replies: [
    'Can I help further?',
    'Thank you for contacting us.',
    'Please confirm this resolved the issue.',
  ],
};
const reply = (value: unknown = output) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(value) } }],
      usage: { prompt_tokens: 100, completion_tokens: 70 },
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
const authorize = (token = owner.token) => `Bearer ${token}`;
async function contact(messages = 1) {
  const row = await db.contacts.create({
    data: { vendorId: owner.vendorId, waId: '919788888888', platform: 'whatsapp' },
  });
  if (messages)
    await db.whatsappMessageLogs.createMany({
      data: Array.from({ length: messages }, (_, index) => ({
        vendorId: owner.vendorId,
        contactId: row.id,
        contactWaId: row.waId!,
        message: `<b>Message ${index}</b>`,
        messagedAt: new Date(Date.now() - (messages - index) * 1000),
        isIncomingMessage: index % 2 === 0,
      })),
    });
  return row;
}
async function enqueue(id: string | number, key = randomUUID()) {
  const response = await request(app)
    .post('/api/ai/analyze-conversation')
    .set('Authorization', authorize())
    .set('Idempotency-Key', key)
    .send({ conversation_id: id });
  expect(response.status).toBe(202);
  const resolvedId =
    typeof id === 'number' ? id : (await db.contacts.findUniqueOrThrow({ where: { uid: id } })).id;
  const job = await db.outboxJobs.findFirstOrThrow({
    where: {
      vendorId: owner.vendorId,
      kind: 'conversation-analysis',
      payload: { path: ['contactId'], equals: resolvedId },
    },
    orderBy: { createdAt: 'desc' },
  });
  return { response, job, key };
}
beforeAll(async () => {
  owner = await businessFixture();
  foreign = await businessFixture();
  agent = await businessFixture(['vendor.cx.view']);
  for (const actor of [owner, agent]) {
    await db.manualSubscriptions.create({ data: { vendorId: actor.vendorId, status: 'active' } });
    await db.subscriptionAddons.create({
      data: {
        vendorId: actor.vendorId,
        addonCode: 'ai_replies',
        source: 'admin_override',
        status: 'active',
        price: 0,
        currency: 'USD',
      },
    });
  }
  await db.nativeMemberships.create({
    data: {
      vendorId: owner.vendorId,
      userId: agent.userId,
      role: 'agent',
      permissions: ['vendor.cx.view'],
    },
  });
  process.env.GROQ_API_KEY = 'test-analysis-key';
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  if (previousKey === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = previousKey;
  await db.$disconnect();
});
describe('conversation intelligence API and durable analysis jobs', () => {
  it('supports original and native URLs, UUIDs and IDs, snapshots 100 messages and atomically records analysis/classification/usage', async () => {
    const c = await contact(103),
      { job, key, response } = await enqueue(c.uid);
    const replay = await enqueue(c.id, key);
    expect(replay.response.body).toEqual(response.body);
    await enqueue(c.id);
    expect(
      await db.outboxJobs.count({
        where: {
          vendorId: owner.vendorId,
          kind: 'conversation-analysis',
          payload: { path: ['contactId'], equals: c.id },
        },
      }),
    ).toBe(1);
    const fetch = vi.fn().mockResolvedValue(reply());
    vi.stubGlobal('fetch', fetch);
    await processJob(job);
    await processJob(job);
    expect(fetch).toHaveBeenCalledTimes(1);
    const input = JSON.parse(JSON.parse(fetch.mock.calls[0][1].body).messages[1].content);
    expect(input.conversation).toHaveLength(100);
    expect(input.conversation[0].message).toBe('Message 3');
    expect(input.summary_due).toBe(true);
    const shown = await request(app)
      .get(`/api/ai/conversation-analysis/${c.uid}`)
      .set('Authorization', authorize());
    expect(shown.body.analysis).toMatchObject({
      conversation_id: c.id,
      vendors__id: owner.vendorId,
      intent: 'Support',
      message_count: 103,
      conversation_summary: output.conversation_summary,
      suggested_replies: output.suggested_replies,
    });
    expect(
      (
        await db.conversationClassifications.findUnique({
          where: { vendorId_contactId: { vendorId: owner.vendorId, contactId: c.id } },
        })
      )?.intent,
    ).toBe('Support');
    expect(
      (
        await db.vendorAiUsages.findFirst({
          where: {
            vendorId: owner.vendorId,
            referenceId: String(c.id),
            feature: 'conversation_intelligence',
          },
        })
      )?.totalTokens,
    ).toBe(170);
    const native = await request(app)
      .get(`/api/v1/vendors/${owner.vendorId}/intelligence/conversation-analysis/${c.id}`)
      .set('Authorization', authorize());
    expect(native.body.analysis).toEqual(shown.body.analysis);
  });
  it('denies missing entitlement, foreign/unassigned contacts, invalid identifiers and changed keys', async () => {
    const c = await contact(),
      other = await contact();
    const queued = await enqueue(c.id);
    expect(
      (
        await request(app)
          .post('/api/ai/analyze-conversation')
          .set('Authorization', authorize())
          .set('Idempotency-Key', queued.key)
          .send({ conversation_id: other.id })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .get(`/api/ai/conversation-analysis/${c.id}`)
          .set('Authorization', authorize(foreign.token))
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .get(`/api/ai/conversation-analysis/${c.id}`)
          .set('Authorization', authorize(agent.token))
          .set('X-Vendor-Id', String(owner.vendorId))
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .get('/api/ai/conversation-analysis/not-an-id')
          .set('Authorization', authorize())
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post('/api/ai/analyze-conversation')
          .set('Authorization', authorize())
          .send({ conversation_id: c.id })
      ).status,
    ).toBe(400);
    expect((await request(app).get(`/api/ai/conversation-analysis/${c.id}`)).status).toBe(401);
  });
  it('preserves previous summaries when not due and keeps manual classifications edited during a provider call', async () => {
    const c = await contact(2);
    await db.conversationAiAnalysis.create({
      data: {
        vendorId: owner.vendorId,
        conversationId: c.id,
        conversationSummary: 'Previous summary',
        messageCount: 1,
      },
    });
    const { job } = await enqueue(c.id);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        await db.conversationClassifications.create({
          data: { vendorId: owner.vendorId, contactId: c.id, intent: 'Manually selected' },
        });
        return reply();
      }),
    );
    await processJob(job);
    expect(
      (
        await db.conversationAiAnalysis.findUnique({
          where: { vendorId_conversationId: { vendorId: owner.vendorId, conversationId: c.id } },
        })
      )?.conversationSummary,
    ).toBe('Previous summary');
    expect(
      (
        await db.conversationClassifications.findUnique({
          where: { vendorId_contactId: { vendorId: owner.vendorId, contactId: c.id } },
        })
      )?.intent,
    ).toBe('Manually selected');
  });
  it('retains prior results after invalid responses and never repeats claimed or uncertain provider requests', async () => {
    const c = await contact(),
      { job } = await enqueue(c.id);
    await db.conversationAiAnalysis.create({
      data: { vendorId: owner.vendorId, conversationId: c.id, intent: 'Prior' },
    });
    const fetch = vi.fn().mockResolvedValue(reply({ wrong: 'shape' }));
    vi.stubGlobal('fetch', fetch);
    await expect(processJob(job)).rejects.toMatchObject({ code: 'ANALYSIS_INVALID_RESPONSE' });
    await expect(processJob(job)).rejects.toMatchObject({
      code: 'ANALYSIS_RECONCILIATION_REQUIRED',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      (
        await db.conversationAiAnalysis.findUnique({
          where: { vendorId_conversationId: { vendorId: owner.vendorId, conversationId: c.id } },
        })
      )?.intent,
    ).toBe('Prior');
    const uncertain = await contact(),
      queued = await enqueue(uncertain.id);
    fetch.mockRejectedValue(new Error('network private message'));
    await expect(processJob(queued.job)).rejects.toMatchObject({ code: 'PROVIDER_UNCERTAIN' });
    await expect(processJob(queued.job)).rejects.toMatchObject({
      code: 'ANALYSIS_RECONCILIATION_REQUIRED',
    });
    await db.outboxJobs.update({
      where: { id: queued.job.id },
      data: { status: 'uncertain', lastError: 'PROVIDER_UNCERTAIN' },
    });
    expect(
      (
        await request(app)
          .post('/api/ai/analyze-conversation')
          .set('Authorization', authorize())
          .set('Idempotency-Key', randomUUID())
          .send({ conversation_id: uncertain.id })
      ).status,
    ).toBe(409);
    const shown = await request(app)
      .get(`/api/ai/conversation-analysis/${uncertain.id}`)
      .set('Authorization', authorize());
    expect(shown.body.warning).toContain('temporarily unavailable');
    expect(JSON.stringify(shown.body)).not.toContain('network private message');
  });
  it('checks revoked permissions before effects and handles empty conversations without provider calls', async () => {
    const empty = await contact(0),
      { job: emptyJob } = await enqueue(empty.id);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await processJob(emptyJob);
    expect(fetch).not.toHaveBeenCalled();
    const c = await contact(),
      { job } = await enqueue(c.id);
    await db.subscriptionAddons.updateMany({
      where: { vendorId: owner.vendorId },
      data: { status: 'inactive' },
    });
    await expect(processJob(job)).rejects.toMatchObject({ code: 'ANALYSIS_ACCESS_REVOKED' });
    expect(fetch).not.toHaveBeenCalled();
    await db.subscriptionAddons.updateMany({
      where: { vendorId: owner.vendorId },
      data: { status: 'active' },
    });
  });
  it('retains uncertain provider acknowledgement after a local commit failure without resending', async () => {
    const c = await contact(),
      { job } = await enqueue(c.id);
    const fetch = vi.fn(async () => {
      vi.spyOn(db, '$transaction').mockRejectedValueOnce(new Error('simulated commit failure'));
      return reply();
    });
    vi.stubGlobal('fetch', fetch);
    try {
      await expect(processJob(job)).rejects.toMatchObject({ code: 'PROVIDER_UNCERTAIN' });
      expect(
        (
          await db.webhookReceipts.findUniqueOrThrow({
            where: { eventKey: `conversation-analysis:${job.id}` },
          })
        ).payload,
      ).toMatchObject({ status: 'uncertain' });
      await expect(processJob(job)).rejects.toMatchObject({
        code: 'ANALYSIS_RECONCILIATION_REQUIRED',
      });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(
        await db.conversationAiAnalysis.count({
          where: { vendorId: owner.vendorId, conversationId: c.id },
        }),
      ).toBe(0);
    } finally {
      vi.restoreAllMocks();
    }
  });
  it('recovers prepared interruptions but keeps claimed effects uncertain and completed results completed', async () => {
    const c = await contact(),
      { job } = await enqueue(c.id);
    await db.outboxJobs.update({
      where: { id: job.id },
      data: { status: 'processing', lockedAt: new Date(0) },
    });
    await recoverInterruptedJobs();
    expect((await db.outboxJobs.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      'pending',
    );
    const receipt = await db.webhookReceipts.findUniqueOrThrow({
      where: { eventKey: `conversation-analysis:${job.id}` },
    });
    await db.webhookReceipts.update({
      where: { id: receipt.id },
      data: { payload: { ...(receipt.payload as any), status: 'processing' } },
    });
    await db.outboxJobs.update({
      where: { id: job.id },
      data: { status: 'processing', lockedAt: new Date(0) },
    });
    await recoverInterruptedJobs();
    expect((await db.outboxJobs.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      'uncertain',
    );
    expect(
      (await db.webhookReceipts.findUniqueOrThrow({ where: { id: receipt.id } })).payload,
    ).toMatchObject({ status: 'uncertain' });
  });
});
