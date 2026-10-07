import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { encrypt } from '../src/utils/crypto.js';
import { processJob } from '../src/jobs/dispatcher.js';
import { ingestMeta } from '../src/jobs/handlers/meta-webhook.handler.js';
import { recoverInterruptedJobs } from '../src/jobs/recovery.js';
import { runOneJob } from '../src/jobs/runner.js';
import { businessFixture } from './fixtures.js';
const app = createApp();
afterAll(() => db.$disconnect());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
async function fixture() {
  const f = await businessFixture(),
    phone = `7788${f.vendorId}`;
  const contact = await db.contacts.create({
    data: {
      vendorId: f.vendorId,
      waId: '919876543210',
      platform: 'whatsapp',
      wabPhoneNumberId: phone,
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
  return { ...f, contact, phone };
}
const auth = (f: Awaited<ReturnType<typeof fixture>>) => `Bearer ${f.token}`;
const base = (f: Awaited<ReturnType<typeof fixture>>, module = 'classifications') =>
  `/api/v1/vendors/${f.vendorId}/${module}`;
async function resolve(f: Awaited<ReturnType<typeof fixture>>, resolved = true) {
  return request(app)
    .post(`/api/v1/vendors/${f.vendorId}/contacts/${f.contact.id}/resolve`)
    .set('Authorization', auth(f))
    .send({ resolved });
}
async function message(f: Awaited<ReturnType<typeof fixture>>, text = 'Please help') {
  return db.whatsappMessageLogs.create({
    data: {
      vendorId: f.vendorId,
      contactId: f.contact.id,
      contactWaId: f.contact.waId,
      wabPhoneNumberId: f.phone,
      type: 'text',
      message: text,
      isIncomingMessage: true,
      messagedAt: new Date(),
    },
  });
}
async function scoreJob(f: Awaited<ReturnType<typeof fixture>>) {
  return db.outboxJobs.findFirstOrThrow({
    where: { vendorId: f.vendorId, kind: 'cx-score' },
    orderBy: { createdAt: 'desc' },
  });
}
function groq(
  value: any = {
    cx_score: 9.2,
    rating: 'Critical',
    summary: 'The issue was resolved.',
    reason: ['The customer confirmed resolution.'],
    recommended_action: 'No action required',
  },
) {
  vi.stubEnv('GROQ_API_KEY', 'test-groq-api-key');
  const fetch = vi.fn(
    async (_url: URL, _init: RequestInit) =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(value) } }],
          usage: { prompt_tokens: 100, completion_tokens: 25 },
        }),
      ),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
describe('conversation classifications', () => {
  it('retains source presets and atomically audits changed values only', async () => {
    const f = await fixture();
    const presets = await request(app)
      .get(`${base(f)}/presets`)
      .set('Authorization', auth(f));
    expect(presets.status).toBe(200);
    expect(presets.body.presets.intent.Sales['Demo Request'].color).toBe('#8b5cf6');
    const path = `${base(f)}/contacts/${f.contact.id}`,
      patch = (value: string) =>
        request(app)
          .patch(path)
          .set('Authorization', auth(f))
          .send({ attribute: 'risk_level', value });
    expect((await patch('High Risk')).status).toBe(200);
    expect((await patch('High Risk')).status).toBe(200);
    expect(await db.conversationClassificationLogs.count({ where: { vendorId: f.vendorId } })).toBe(
      1,
    );
    const read = await request(app).get(path).set('Authorization', auth(f));
    expect(read.body.classification.riskLevel).toBe('High Risk');
    expect(read.body.logs[0].changedByUsersId).toBe(f.userId);
  });
  it('owns custom tags, rejects invalid values and protects tags that are in use', async () => {
    const f = await fixture();
    const tag = await request(app)
      .post(`${base(f)}/tags`)
      .set('Authorization', auth(f))
      .send({ type: 'intent', name: 'Renewal Review' });
    expect(tag.status).toBe(201);
    const patch = (value: string) =>
      request(app)
        .patch(`${base(f)}/contacts/${f.contact.id}`)
        .set('Authorization', auth(f))
        .send({ attribute: 'intent', value });
    expect((await patch('Unknown value')).status).toBe(400);
    expect((await patch('Renewal Review')).status).toBe(200);
    expect(
      (
        await request(app)
          .delete(`${base(f)}/tags/${tag.body.id}`)
          .set('Authorization', auth(f))
      ).status,
    ).toBe(409);
    await patch('New Inquiry');
    expect(
      (
        await request(app)
          .delete(`${base(f)}/tags/${tag.body.id}`)
          .set('Authorization', auth(f))
      ).status,
    ).toBe(204);
    expect(
      (
        await request(app)
          .post(`${base(f)}/tags`)
          .set('Authorization', auth(f))
          .send({ type: 'urgency', name: 'High', color: '#ffffff' })
      ).status,
    ).toBe(409);
  });
  it('checks contact visibility, foreign tags and write permission without leaking history', async () => {
    const f = await fixture(),
      other = await fixture(),
      agent = await businessFixture(['vendor.cx.view', 'vendor.cx.manage']);
    await db.nativeMemberships.create({
      data: {
        vendorId: f.vendorId,
        userId: agent.userId,
        role: 'agent',
        permissions: ['vendor.cx.view', 'vendor.cx.manage'],
      },
    });
    expect(
      (
        await request(app)
          .get(`${base(f)}/contacts/${f.contact.id}`)
          .set('Authorization', `Bearer ${agent.token}`)
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .patch(`${base(f)}/contacts/${other.contact.id}`)
          .set('Authorization', auth(f))
          .send({ attribute: 'intent', value: 'New Inquiry' })
      ).status,
    ).toBe(404);
    const tag = await db.conversationClassificationTags.create({
      data: { vendorId: other.vendorId, type: 'intent', name: 'Foreign custom' },
    });
    expect(
      (
        await request(app)
          .patch(`${base(f)}/contacts/${f.contact.id}`)
          .set('Authorization', auth(f))
          .send({ attribute: 'intent', value: tag.name })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post(`/api/v1/vendors/${f.vendorId}/resources/classification-tags`)
          .set('Authorization', auth(f))
          .send({ type: 'intent', name: 'Bypass' })
      ).status,
    ).toBe(403);
  });
});
describe('resolution-driven CX analysis', () => {
  it('resolves concurrent requests once, freezes the transcript and generates a validated score once', async () => {
    const f = await fixture();
    await message(f, 'Thank you, resolved.');
    const responses = await Promise.all([resolve(f), resolve(f)]);
    expect(responses.every((r) => r.status === 200)).toBe(true);
    expect(await db.conversationCxScores.count({ where: { vendorId: f.vendorId } })).toBe(1);
    expect(
      (await db.contacts.findUniqueOrThrow({ where: { id: f.contact.id } }))
        .conversationResolutionSequence,
    ).toBe(1);
    await message(f, 'This belongs to a later conversation.');
    const job = await scoreJob(f),
      fetch = groq();
    await processJob(job);
    await processJob(job);
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)),
      transcript = JSON.parse(body.messages[1].content).conversation;
    expect(transcript.map((r: any) => r.text)).toEqual(['Thank you, resolved.']);
    const score = await db.conversationCxScores.findFirstOrThrow({
      where: { vendorId: f.vendorId },
    });
    expect(score.status).toBe('completed');
    expect(score.rating).toBe('Excellent');
    expect(score.followUpRequired).toBe(false);
    expect(
      await db.vendorAiUsages.count({ where: { vendorId: f.vendorId, feature: 'cx_score' } }),
    ).toBe(1);
  });
  it('reopens on a new incoming customer message and creates the next immutable resolution sequence', async () => {
    const f = await fixture();
    await message(f);
    await resolve(f);
    await ingestMeta({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: f.phone },
                messages: [
                  {
                    id: `wamid.${randomUUID()}`,
                    from: f.contact.waId,
                    type: 'text',
                    text: { body: 'New issue' },
                    timestamp: String(Math.floor(Date.now() / 1000)),
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(
      (await db.contacts.findUniqueOrThrow({ where: { id: f.contact.id } })).conversationStatus,
    ).toBe('open');
    await resolve(f);
    expect(
      (
        await db.conversationCxScores.findMany({
          where: { vendorId: f.vendorId },
          orderBy: { resolutionSequence: 'asc' },
        })
      ).map((row) => row.resolutionSequence),
    ).toEqual([1, 2]);
  });
  it('rejects malformed analysis, exposes safe failure codes and permits an audited explicit retry', async () => {
    const f = await fixture();
    await message(f);
    await resolve(f);
    const job = await scoreJob(f),
      fetch = groq({ cx_score: 100, summary: 'Invented', reason: [], recommended_action: 'None' });
    const processing = await db.outboxJobs.update({
      where: { id: job.id },
      data: { status: 'processing', attempts: 1, lockedAt: new Date() },
    });
    const claim = vi.spyOn(db, '$queryRaw').mockResolvedValueOnce([processing]);
    try {
      await runOneJob();
    } finally {
      claim.mockRestore();
    }
    expect((await db.outboxJobs.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      'failed',
    );
    await expect(processJob(job)).rejects.toMatchObject({ code: 'CX_RETRY_REQUIRED' });
    expect(fetch).toHaveBeenCalledTimes(1);
    const score = await db.conversationCxScores.findFirstOrThrow({
      where: { vendorId: f.vendorId },
    });
    expect(score.status).toBe('failed');
    expect(score.cxScore).toBeNull();
    const retry = await request(app)
      .post(`${base(f, 'cx-scores')}/${score.id}/retry`)
      .set('Authorization', auth(f))
      .send({});
    expect(retry.status).toBe(202);
    const next = await scoreJob(f);
    groq();
    await processJob(next);
    expect(
      (await db.conversationCxScores.findUniqueOrThrow({ where: { id: score.id } })).status,
    ).toBe('completed');
    expect(
      (
        await request(app)
          .post(`${base(f, 'cx-scores')}/${score.id}/retry`)
          .set('Authorization', auth(f))
          .send({})
      ).status,
    ).toBe(409);
  });
  it('enforces score visibility and retains interruptions without silently calling the provider twice', async () => {
    const f = await fixture(),
      other = await fixture();
    await message(f);
    await resolve(f);
    const job = await scoreJob(f),
      score = await db.conversationCxScores.findFirstOrThrow({ where: { vendorId: f.vendorId } });
    expect(
      (
        await request(app)
          .get(`${base(other, 'cx-scores')}/${score.id}`)
          .set('Authorization', auth(other))
      ).status,
    ).toBe(404);
    await db.conversationCxScores.update({
      where: { id: score.id },
      data: { status: 'processing' },
    });
    await db.outboxJobs.update({
      where: { id: job.id },
      data: { status: 'processing', lockedAt: new Date(Date.now() - 20 * 60000) },
    });
    await recoverInterruptedJobs();
    expect((await db.outboxJobs.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      'uncertain',
    );
    expect(
      (await db.conversationCxScores.findUniqueOrThrow({ where: { id: score.id } })).status,
    ).toBe('uncertain');
  });
});
