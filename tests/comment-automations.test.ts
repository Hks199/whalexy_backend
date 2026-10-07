import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createHmac, randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { config } from '../src/config/environment.js';
import { digest } from '../src/utils/crypto.js';
import {
  matchesComment,
  type CommentEvent,
} from '../src/modules/comment-automations/services/comment-events.js';
import { ingestMeta } from '../src/jobs/handlers/meta-webhook.handler.js';
import { processJob } from '../src/jobs/dispatcher.js';
import { recoverInterruptedJobs } from '../src/jobs/recovery.js';
import { businessFixture } from './fixtures.js';
const app = createApp(),
  appId = '7777712345',
  scopes = [
    'pages_messaging',
    'pages_read_engagement',
    'pages_manage_metadata',
    'pages_manage_engagement',
    'instagram_basic',
    'instagram_manage_comments',
    'instagram_manage_messages',
  ];
let previousSecret = config.META_APP_SECRET;
beforeEach(() => {
  previousSecret = config.META_APP_SECRET;
  config.META_APP_SECRET = 'native-comment-test-secret';
  vi.stubEnv('META_APP_ID', appId);
  vi.stubEnv('META_APP_SECRET', 'native-comment-test-secret');
});
afterEach(() => {
  config.META_APP_SECRET = previousSecret;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
afterAll(() => db.$disconnect());
function verification(account: string, page: string) {
  return vi.fn(async (url: URL) => {
    expect(url.origin).toBe('https://graph.facebook.com');
    if (url.pathname.endsWith('/debug_token'))
      return new Response(
        JSON.stringify({
          data: {
            app_id: appId,
            type: 'PAGE',
            is_valid: true,
            scopes,
            expires_at: Math.floor(Date.now() / 1000) + 3600,
          },
        }),
      );
    if (url.pathname.endsWith('/me'))
      return new Response(
        JSON.stringify({ id: page, instagram_business_account: { id: account } }),
      );
    throw new Error('Unexpected verification path');
  });
}
async function fixture(platform = 'instagram', changes: any = {}) {
  const f = await businessFixture(),
    account = `5566${f.vendorId}`,
    page = platform === 'facebook' ? account : `6655${f.vendorId}`,
    sender = `9911${f.vendorId}`,
    prefix = `/api/v1/vendors/${f.vendorId}`,
    auth = `Bearer ${f.token}`,
    accessToken = `native_social_token_${randomUUID()}`;
  vi.stubGlobal('fetch', verification(account, page));
  const connected = await request(app)
    .post(`${prefix}/integrations/social/connect`)
    .set('Authorization', auth)
    .send({ platform, accountId: account, pageId: page, accessToken });
  expect(connected.status).toBe(201);
  const settings = {
      name: 'Comment download',
      platform,
      externalAccountId: account,
      status: 'active',
      commentMatchType: 'keyword',
      keywords: ['Guide'],
      dmMessage: 'Here is your guide',
      ...changes,
    },
    created = await request(app)
      .post(`${prefix}/comment-automations`)
      .set('Authorization', auth)
      .send(settings);
  expect(created.status).toBe(201);
  return {
    ...f,
    platform,
    account,
    page,
    sender,
    prefix,
    auth,
    accessToken,
    settings,
    rule: created.body,
    credentialId: connected.body.id,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function comment(f: Fixture, text = 'GUIDE', extra: any = {}) {
  const commentId = `${f.account}_${randomUUID()}`,
    value = {
      ...(f.platform === 'instagram'
        ? { id: commentId, text, media: { id: `9988${f.vendorId}` } }
        : {
            comment_id: commentId,
            message: text,
            item: 'comment',
            verb: 'add',
            post_id: `${f.account}_post`,
          }),
      from: { id: f.sender },
      ...extra,
    };
  return {
    object: f.platform === 'instagram' ? 'instagram' : 'page',
    entry: [
      {
        id: f.account,
        time: Math.floor(Date.now() / 1000),
        changes: [{ field: f.platform === 'instagram' ? 'comments' : 'feed', value }],
      },
    ],
  };
}
async function receive(body: any) {
  const raw = JSON.stringify(body),
    sig = createHmac('sha256', config.META_APP_SECRET).update(raw).digest('hex'),
    r = await request(app)
      .post('/webhooks/meta')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', `sha256=${sig}`)
      .send(raw);
  expect(r.status).toBe(200);
  const job = await db.outboxJobs.findUniqueOrThrow({
    where: { dedupeKey: `webhook:meta:${digest(raw)}` },
  });
  await processJob(job);
  return job;
}
const actions = (f: Fixture) =>
  db.outboxJobs.findMany({
    where: { vendorId: f.vendorId, kind: 'comment-action' },
    orderBy: { createdAt: 'asc' },
  });
const checks = (f: Fixture) =>
  db.outboxJobs.findMany({
    where: { vendorId: f.vendorId, kind: 'comment-follow' },
    orderBy: { createdAt: 'asc' },
  });
const executions = (f: Fixture) =>
  db.commentToDmExecutions.findMany({ where: { vendorId: f.vendorId }, orderBy: { id: 'asc' } });
function provider(
  f: Fixture,
  extra?: ((url: URL, init: any) => Promise<Response | undefined>) | null,
) {
  return vi.fn(async (url: URL, init: any) => {
    expect(url.origin).toBe('https://graph.facebook.com');
    const override = extra ? await extra(url, init) : undefined;
    if (override) return override;
    const id = url.pathname.split('/').pop()!;
    if ((init?.method ?? 'GET') === 'GET') {
      if (id === f.sender)
        return new Response(JSON.stringify({ id, is_user_follow_business: true }));
      return new Response(
        JSON.stringify({
          id,
          timestamp: new Date().toISOString(),
          created_time: new Date().toISOString(),
        }),
      );
    }
    if (url.pathname.endsWith('/messages'))
      return new Response(
        JSON.stringify({ message_id: `mid.$${randomUUID()}`, recipient_id: f.sender }),
      );
    return new Response(JSON.stringify({ id: `reply_${randomUUID()}` }));
  });
}
function quickReply(f: Fixture, token: string, sender = f.sender, mid = `mid.$${randomUUID()}`) {
  return {
    object: 'instagram',
    entry: [
      {
        id: f.account,
        messaging: [
          {
            sender: { id: sender },
            recipient: { id: f.account },
            timestamp: Date.now(),
            message: { mid, quick_reply: { payload: `whalexy-follow:${token}` } },
          },
        ],
      },
    ],
  };
}
describe('verified social account connection', () => {
  it.each(['facebook', 'instagram'])(
    'proves %s Page-token identity and stores only encrypted credentials',
    async (platform) => {
      const f = await fixture(platform),
        credential = await db.integrationCredentials.findUniqueOrThrow({
          where: { id: f.credentialId },
        });
      expect(credential.secret).not.toContain(f.accessToken);
      expect((credential.metadata as any).nativeSocial).toMatchObject({
        platform,
        accountId: f.account,
        pageId: f.page,
        appId,
      });
      expect(JSON.stringify(f.rule)).not.toContain(f.accessToken);
    },
  );
  it.each(['app', 'expiry', 'scope', 'identity', 'token-type', 'target'])(
    'rejects invalid %s before retaining or activating a connection',
    async (problem) => {
      const f = await businessFixture(),
        page = '112233445566',
        token = 'invalid_test_token_for_comments';
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: URL) => {
          if (url.pathname.endsWith('/me'))
            return new Response(
              JSON.stringify({ id: problem === 'identity' ? '999999999999' : page }),
            );
          return new Response(
            JSON.stringify({
              data: {
                is_valid: true,
                app_id: problem === 'app' ? '999999999' : appId,
                type: problem === 'token-type' ? 'USER' : 'PAGE',
                expires_at: problem === 'expiry' ? 1 : Math.floor(Date.now() / 1000) + 3600,
                scopes: problem === 'scope' ? [] : scopes,
                ...(problem === 'target'
                  ? {
                      granular_scopes: [{ scope: 'pages_messaging', target_ids: ['999999999999'] }],
                    }
                  : {}),
              },
            }),
          );
        }),
      );
      const r = await request(app)
        .post(`/api/v1/vendors/${f.vendorId}/integrations/social/connect`)
        .set('Authorization', `Bearer ${f.token}`)
        .send({ platform: 'facebook', accountId: page, pageId: page, accessToken: token });
      expect(r.status).toBe(403);
      expect(await db.integrationCredentials.count({ where: { vendorId: f.vendorId } })).toBe(0);
    },
  );
  it('rejects a second business claiming the same account', async () => {
    const f = await fixture(),
      other = await businessFixture();
    vi.stubGlobal('fetch', verification(f.account, f.page));
    expect(
      (
        await request(app)
          .post(`/api/v1/vendors/${other.vendorId}/integrations/social/connect`)
          .set('Authorization', `Bearer ${other.token}`)
          .send({
            platform: 'instagram',
            accountId: f.account,
            pageId: f.page,
            accessToken: f.accessToken,
          })
      ).status,
    ).toBe(409);
  });
});
describe('signed comment-to-DM workflows', () => {
  it.each(['facebook', 'instagram'])(
    'matches and queues %s comments once across duplicate signed receipts',
    async (platform) => {
      const f = await fixture(platform, {
          publicReplyEnabled: true,
          publicReplyMessage: 'Check your inbox',
        }),
        body = comment(f);
      await receive(body);
      await receive(body);
      expect(await executions(f)).toHaveLength(1);
      expect(await actions(f)).toHaveLength(2);
      const fetch = provider(f);
      vi.stubGlobal('fetch', fetch);
      for (const job of await actions(f)) {
        await processJob(job);
        await processJob(job);
      }
      expect(fetch.mock.calls.filter(([, i]) => i.method === 'POST')).toHaveLength(2);
      const result = (await executions(f))[0];
      expect(result.dmStatus).toBe('success');
      expect(result.publicReplyStatus).toBe('success');
      expect(result.status).toBe('success');
      expect(
        fetch.mock.calls.some(([url]) =>
          url.pathname.endsWith(platform === 'instagram' ? '/replies' : '/comments'),
        ),
      ).toBe(true);
    },
  );
  it('requires a signed matching receipt and rejects malformed signatures without enqueuing', async () => {
    const f = await fixture(),
      body = comment(f);
    await expect(ingestMeta(body)).rejects.toMatchObject({
      code: 'SIGNED_SOCIAL_RECEIPT_REQUIRED',
    });
    const response = await request(app)
      .post('/webhooks/meta')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', 'sha256=invalid')
      .send(JSON.stringify(body));
    expect(response.status).toBe(401);
    expect(await actions(f)).toHaveLength(0);
  });
  it('normalizes keywords, enforces content scope and excludes business-authored comments', async () => {
    const f = await fixture('instagram', {
      contentScope: 'specific',
      mediaId: '123456789',
      matchOperator: 'equals',
      keywords: ['get guide'],
    });
    for (const body of [
      comment(f, 'get guide', { media: { id: 'other-media' } }),
      comment(f, 'get guide', { media: { id: '123456789' }, from: { id: f.account } }),
      comment(f, 'get guide now', { media: { id: '123456789' } }),
    ])
      await receive(body);
    expect(await actions(f)).toHaveLength(0);
    await receive(comment(f, '  GET  GUIDE  ', { media: { id: '123456789' } }));
    expect(await actions(f)).toHaveLength(1);
  });
  it('reserves one private reply across overlapping rules and concurrent webhook processing', async () => {
    const f = await fixture('facebook'),
      created = await request(app)
        .post(`${f.prefix}/comment-automations`)
        .set('Authorization', f.auth)
        .send({ ...f.settings, name: 'Another matching rule' });
    expect(created.status).toBe(201);
    const body = comment(f),
      raw = JSON.stringify(body),
      eventKey = `meta:${digest(raw)}`;
    await db.webhookReceipts.create({ data: { provider: 'meta', eventKey, payload: body } });
    await Promise.all([ingestMeta(body, eventKey), ingestMeta(body, eventKey)]);
    expect(await executions(f)).toHaveLength(1);
    expect(await actions(f)).toHaveLength(1);
    expect((await executions(f))[0].automationId).toBe(f.rule.id);
  });
  it.each(['pause', 'delete', 'permission', 'token', 'disconnect'])(
    'cancels prepared effects after %s changes',
    async (change) => {
      const f = await fixture(),
        body = comment(f);
      await receive(body);
      if (change === 'pause')
        await db.commentToDmAutomations.update({
          where: { id: f.rule.id },
          data: { status: 'paused', updatedAt: new Date() },
        });
      if (change === 'delete')
        expect(
          (
            await request(app)
              .delete(`${f.prefix}/comment-automations/${f.rule.id}`)
              .set('Authorization', f.auth)
          ).status,
        ).toBe(204);
      if (change === 'permission')
        await db.nativeMemberships.update({
          where: { vendorId_userId: { vendorId: f.vendorId, userId: f.userId } },
          data: { active: false },
        });
      if (change === 'token')
        await db.integrationCredentials.update({
          where: { id: f.credentialId },
          data: { metadata: {} },
        });
      if (change === 'disconnect')
        await db.integrationCredentials.delete({ where: { id: f.credentialId } });
      vi.stubGlobal('fetch', vi.fn());
      await processJob((await actions(f))[0]);
      expect(fetch).not.toHaveBeenCalled();
      expect((await executions(f))[0].dmStatus).toBe('cancelled');
    },
  );
  it('rejects stale actual comment timestamps and rechecks a rule changed during provider lookup', async () => {
    const f = await fixture();
    await receive(comment(f));
    vi.stubGlobal(
      'fetch',
      provider(f, async (url, init) =>
        init.method === 'GET'
          ? new Response(
              JSON.stringify({
                id: url.pathname.split('/').pop(),
                timestamp: new Date(Date.now() - 8 * 86400000).toISOString(),
              }),
            )
          : undefined,
      ),
    );
    await processJob((await actions(f))[0]);
    expect((await executions(f))[0].error).toBe('COMMENT_WINDOW_EXPIRED');
    expect(fetch).toHaveBeenCalledTimes(1);
    await receive(comment(f));
    vi.stubGlobal(
      'fetch',
      provider(f, async (_url, init) => {
        if (init.method === 'GET')
          await db.commentToDmAutomations.update({
            where: { id: f.rule.id },
            data: { status: 'paused', updatedAt: new Date() },
          });
        return undefined;
      }),
    );
    await processJob((await actions(f))[1]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await executions(f))[1].dmStatus).toBe('cancelled');
  });
  it('preserves accepted IDs after a local commit failure and never repeats the provider mutation', async () => {
    const f = await fixture();
    await receive(comment(f));
    const fetch = provider(f);
    vi.stubGlobal('fetch', fetch);
    const original = db.$transaction.bind(db);
    vi.spyOn(db, '$transaction')
      .mockImplementation(original as any)
      .mockImplementationOnce(original as any)
      .mockImplementationOnce(async () => {
        throw new Error('Simulated local commit failure');
      });
    const job = (await actions(f))[0];
    await expect(processJob(job)).rejects.toMatchObject({ code: 'PROVIDER_UNCERTAIN' });
    const state = await db.nativeIdempotency.findUniqueOrThrow({
      where: {
        vendorId_key: {
          vendorId: f.vendorId,
          key: `comment-effect:${(job.payload as any).executionId}:private`,
        },
      },
    });
    expect(state.response).toMatchObject({
      state: 'uncertain',
      acceptedResult: { id: expect.any(String) },
    });
    await expect(processJob(job)).rejects.toMatchObject({ code: 'COMMENT_RECONCILIATION_PENDING' });
    expect(fetch.mock.calls.filter(([, i]) => i.method === 'POST')).toHaveLength(1);
  });
  it('retains unknown and rejected effects without retrying on later webhooks or new rules', async () => {
    const f = await fixture();
    await receive(comment(f));
    vi.stubGlobal(
      'fetch',
      provider(f, async (_u, init) =>
        init.method === 'POST'
          ? new Response('private provider details', { status: 500 })
          : undefined,
      ),
    );
    const job = (await actions(f))[0];
    await expect(processJob(job)).rejects.toMatchObject({ code: 'PROVIDER_UNCERTAIN' });
    expect((await executions(f))[0].error).toBe('PROVIDER_UNCERTAIN');
    await expect(processJob(job)).rejects.toMatchObject({ code: 'COMMENT_RECONCILIATION_PENDING' });
    expect((fetch as any).mock.calls.filter(([, i]: any) => i.method === 'POST')).toHaveLength(1);
    await receive(comment(f));
    vi.stubGlobal(
      'fetch',
      provider(f, async (_u, init) =>
        init.method === 'POST' ? new Response('{}', { status: 400 }) : undefined,
      ),
    );
    await expect(processJob((await actions(f))[1])).rejects.toMatchObject({
      code: 'COMMENT_PROVIDER_REJECTED',
    });
    expect((await executions(f))[1].dmStatus).toBe('failed');
  });
  it('maps Instagram file links into one reply and supports image cards without a second private send', async () => {
    const f = await fixture('instagram', {
      attachment: { type: 'file', url: 'https://cdn.example.com/guide.pdf' },
    });
    await receive(comment(f));
    const fetch = provider(f);
    vi.stubGlobal('fetch', fetch);
    await processJob((await actions(f))[0]);
    const sent = JSON.parse(fetch.mock.calls.find(([, i]) => i.method === 'POST')![1].body);
    expect(sent.message.text).toBe('Here is your guide\nhttps://cdn.example.com/guide.pdf');
    expect(sent.recipient.comment_id).toBe((await executions(f))[0].commentId);
  });
  it('rejects management bypasses, foreign account rules and unverified imported rules', async () => {
    const f = await fixture(),
      other = await businessFixture();
    expect(
      (
        await request(app)
          .post(`${f.prefix}/resources/comment-automations`)
          .set('Authorization', f.auth)
          .send({ name: 'Bypass' })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post(`/api/v1/vendors/${other.vendorId}/comment-automations`)
          .set('Authorization', `Bearer ${other.token}`)
          .send(f.settings)
      ).status,
    ).toBe(409);
    await db.commentToDmAutomations.update({
      where: { id: f.rule.id },
      data: { status: 'paused' },
    });
    await db.commentToDmAutomations.create({
      data: {
        vendorId: f.vendorId,
        name: 'Imported',
        platform: f.platform,
        externalAccountId: f.account,
        status: 'active',
        dmMessage: 'Do not run',
      },
    });
    await receive(comment(f));
    expect(await actions(f)).toHaveLength(0);
  });
});
describe('Instagram follow gates', () => {
  it('binds a follow prompt to the confirmed recipient and delivers content once after a verified follow', async () => {
    const f = await fixture('instagram', {
      followGateEnabled: true,
      followGateMessage: 'Follow to receive the guide',
    });
    await receive(comment(f));
    const privateJob = (await actions(f))[0],
      token = (privateJob.payload as any).followToken,
      fetch = provider(f);
    vi.stubGlobal('fetch', fetch);
    await processJob(privateJob);
    expect((await executions(f))[0].status).toBe('waiting_follow');
    await receive(quickReply(f, token, 'other-user'));
    expect(await checks(f)).toHaveLength(0);
    const callback = quickReply(f, token);
    await receive(callback);
    await receive(callback);
    expect(await checks(f)).toHaveLength(1);
    await processJob((await checks(f))[0]);
    await processJob((await checks(f))[0]);
    expect(fetch.mock.calls.filter(([, i]) => i.method === 'POST')).toHaveLength(2);
    expect((await executions(f))[0]).toMatchObject({
      dmStatus: 'success',
      followGateStatus: 'verified',
      followGateRecipientId: f.sender,
      followGateChecks: 1,
      contentDeliveredAt: expect.any(Date),
    });
  });
  it('retains an early signed button reply until the private response proves its recipient', async () => {
    const f = await fixture('instagram', {
      followGateEnabled: true,
      followGateMessage: 'Follow first',
    });
    await receive(comment(f));
    const job = (await actions(f))[0],
      token = (job.payload as any).followToken;
    await receive(quickReply(f, token));
    expect(await checks(f)).toHaveLength(0);
    vi.stubGlobal('fetch', provider(f));
    await processJob(job);
    expect(await checks(f)).toHaveLength(1);
    await processJob((await checks(f))[0]);
    expect((await executions(f))[0].followGateStatus).toBe('verified');
  });
  it('sends one retry prompt for a nonfollower and needs another signed click to recheck', async () => {
    const f = await fixture('instagram', {
      followGateEnabled: true,
      followGateMessage: 'Follow first',
    });
    await receive(comment(f));
    const job = (await actions(f))[0],
      token = (job.payload as any).followToken;
    vi.stubGlobal('fetch', provider(f));
    await processJob(job);
    await receive(quickReply(f, token));
    const fetch = provider(f, async (url, init) =>
      init.method === 'GET' && url.pathname.endsWith(`/${f.sender}`)
        ? new Response(JSON.stringify({ id: f.sender, is_user_follow_business: false }))
        : undefined,
    );
    vi.stubGlobal('fetch', fetch);
    await processJob((await checks(f))[0]);
    await processJob((await checks(f))[0]);
    expect((await executions(f))[0].followGateChecks).toBe(1);
    expect((await executions(f))[0].contentDeliveredAt).toBeNull();
    expect(fetch.mock.calls.filter(([, i]) => i.method === 'POST')).toHaveLength(1);
    await receive(quickReply(f, token));
    vi.stubGlobal('fetch', provider(f));
    await processJob((await checks(f))[1]);
    expect((await executions(f))[0].followGateStatus).toBe('verified');
  });
  it('rejects expired, wrong-account and echo button receipts without opening a send window', async () => {
    const f = await fixture('instagram', {
      followGateEnabled: true,
      followGateMessage: 'Follow first',
    });
    await receive(comment(f));
    const job = (await actions(f))[0],
      token = (job.payload as any).followToken;
    vi.stubGlobal('fetch', provider(f));
    await processJob(job);
    const old = quickReply(f, token);
    old.entry[0].messaging[0].timestamp = Date.now() - 2 * 86400000;
    await receive(old);
    const echo = quickReply(f, token);
    (echo.entry[0].messaging[0].message as any).is_echo = true;
    await receive(echo);
    const wrong = quickReply(f, token);
    wrong.entry[0].messaging[0].recipient.id = '999999999';
    await receive(wrong);
    expect(await checks(f)).toHaveLength(0);
  });
});
describe('comment interruption recovery and matching', () => {
  it('allows audited preparation retry but refuses a claimed provider effect', async () => {
    const f = await fixture();
    await receive(comment(f));
    const job = (await actions(f))[0];
    await db.outboxJobs.update({
      where: { id: job.id },
      data: { status: 'blocked', lastError: 'COMMENT_LOOKUP_PENDING' },
    });
    expect(
      (
        await request(app)
          .post(`${f.prefix}/jobs/${job.id}/retry`)
          .set('Authorization', f.auth)
          .send({})
      ).status,
    ).toBe(202);
    await db.nativeIdempotency.create({
      data: {
        vendorId: f.vendorId,
        key: `comment-effect:${(job.payload as any).executionId}:private`,
        requestHash: 'test',
        response: { state: 'processing' },
      },
    });
    await db.outboxJobs.update({
      where: { id: job.id },
      data: { status: 'uncertain', lastError: 'WORKER_INTERRUPTED' },
    });
    expect(
      (
        await request(app)
          .post(`${f.prefix}/jobs/${job.id}/retry`)
          .set('Authorization', f.auth)
          .send({})
      ).status,
    ).toBe(409);
  });
  it('keeps an unknown private send uncertain after the rule is disabled', async () => {
    const f = await fixture();
    await receive(comment(f));
    vi.stubGlobal(
      'fetch',
      provider(f, async (_u, init) =>
        init.method === 'POST' ? new Response('{}', { status: 500 }) : undefined,
      ),
    );
    const job = (await actions(f))[0];
    await expect(processJob(job)).rejects.toMatchObject({ code: 'PROVIDER_UNCERTAIN' });
    await db.commentToDmAutomations.update({
      where: { id: f.rule.id },
      data: { status: 'paused', updatedAt: new Date() },
    });
    await expect(processJob(job)).rejects.toMatchObject({ code: 'COMMENT_RECONCILIATION_PENDING' });
    expect((await executions(f))[0].dmStatus).toBe('uncertain');
    expect((fetch as any).mock.calls.filter(([, i]: any) => i.method === 'POST')).toHaveLength(1);
  });
  it('does not expose raw legacy provider errors or private attachment paths', async () => {
    const f = await fixture();
    await receive(comment(f));
    const row = (await executions(f))[0];
    await db.commentToDmExecutions.update({
      where: { id: row.id },
      data: { error: 'token=private_legacy_credential' },
    });
    await db.commentToDmAutomations.update({
      where: { id: f.rule.id },
      data: { dmAttachmentPath: 'private/internal/file.png' },
    });
    for (const endpoint of [
      '/comment-automations/executions',
      '/resources/comment-executions',
      '/resources/comment-automations',
      `/comment-automations/${f.rule.id}`,
    ]) {
      const response = await request(app)
        .get(`${f.prefix}${endpoint}`)
        .set('Authorization', f.auth);
      expect(response.status).toBe(200);
      expect(JSON.stringify(response.body)).not.toContain('private_legacy_credential');
      expect(JSON.stringify(response.body)).not.toContain('private/internal');
    }
  });
  it('bounds follow checks across separate signed button receipts', async () => {
    const f = await fixture('instagram', {
      followGateEnabled: true,
      followGateMessage: 'Follow first',
    });
    await receive(comment(f));
    const job = (await actions(f))[0],
      token = (job.payload as any).followToken;
    vi.stubGlobal('fetch', provider(f));
    await processJob(job);
    await db.commentToDmExecutions.update({
      where: { id: (await executions(f))[0].id },
      data: { followGateChecks: 10 },
    });
    await receive(quickReply(f, token));
    vi.stubGlobal('fetch', vi.fn());
    await processJob((await checks(f))[0]);
    expect(fetch).not.toHaveBeenCalled();
    expect((await executions(f))[0].followGateChecks).toBe(10);
  });
  it('recovers pre-effect preparation safely and preserves uncertain claimed effects', async () => {
    const f = await fixture();
    await receive(comment(f));
    await receive(comment(f));
    const rows = await actions(f),
      at = new Date();
    for (const row of rows)
      await db.outboxJobs.update({
        where: { id: row.id },
        data: { status: 'processing', lockedAt: new Date(at.getTime() - 11 * 60000) },
      });
    await db.nativeIdempotency.create({
      data: {
        vendorId: f.vendorId,
        key: `comment-effect:${(rows[1].payload as any).executionId}:private`,
        requestHash: 'test',
        response: { state: 'processing' },
      },
    });
    await recoverInterruptedJobs(at);
    expect((await db.outboxJobs.findUniqueOrThrow({ where: { id: rows[0].id } })).status).toBe(
      'pending',
    );
    expect((await db.outboxJobs.findUniqueOrThrow({ where: { id: rows[1].id } })).status).toBe(
      'uncertain',
    );
    expect((await executions(f))[1].dmStatus).toBe('uncertain');
  });
  it('matches the source normalization and operators without regular-expression execution', () => {
    const e: CommentEvent = {
        platform: 'instagram',
        account: '123456',
        commentId: 'c1',
        mediaId: 'm1',
        commenterId: 'u1',
        text: '  GET   guide! ',
        at: Date.now(),
        live: false,
      },
      rule = {
        status: 'active',
        platform: 'instagram',
        externalAccountId: '123456',
        contentScope: 'all',
        commentMatchType: 'keyword',
        keywords: ['get guide'],
        matchOperator: 'starts_with',
      };
    expect(matchesComment(rule, e)).toBe(true);
    expect(matchesComment({ ...rule, matchOperator: 'equals' }, e)).toBe(false);
    expect(matchesComment({ ...rule, keywords: ['.*'] }, e)).toBe(false);
  });
});
