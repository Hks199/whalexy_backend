import { randomUUID, createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { config } from '../src/config/environment.js';
import { digest, encrypt } from '../src/utils/crypto.js';
import { processJob } from '../src/jobs/dispatcher.js';
import { ingestMeta } from '../src/jobs/handlers/meta-webhook.handler.js';
import { businessFixture } from './fixtures.js';
import type { Contacts } from '@prisma/client';

type Fixture = Awaited<ReturnType<typeof businessFixture>> & {
  account: string;
  phone: string;
  tokenValue: string;
  contact: Contacts;
  campaignId: string;
  setId: string;
  adId: string;
};
const app = createApp(),
  fixtures: Fixture[] = [],
  receiptKeys: string[] = [],
  jobIds: string[] = [];
let priorSecret: string;
beforeEach(() => {
  priorSecret = config.META_APP_SECRET;
  config.META_APP_SECRET = 'ad-referral-test-secret';
  vi.stubEnv('META_APP_ID', '991122');
  vi.stubEnv('META_APP_SECRET', config.META_APP_SECRET);
});
afterEach(() => {
  config.META_APP_SECRET = priorSecret;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
async function fixture(permissions = ['*']): Promise<Fixture> {
  const f = await businessFixture(permissions),
    account = `88660${f.vendorId}`,
    phone = `99190${f.vendorId}`,
    tokenValue = `ad-token-${randomUUID()}`;
  const contact = await db.contacts.create({
    data: {
      vendorId: f.vendorId,
      waId: `91990${f.vendorId}`,
      platform: 'whatsapp',
      wabPhoneNumberId: phone,
      data: { preserved: 'yes' },
    },
  });
  await db.integrationCredentials.create({
    data: {
      vendorId: f.vendorId,
      provider: 'whatsapp',
      externalId: phone,
      secret: encrypt('test-whatsapp-token'),
    },
  });
  const result = {
    ...f,
    account,
    phone,
    tokenValue,
    contact,
    campaignId: `${account}1`,
    setId: `${account}2`,
    adId: `${account}3`,
  };
  fixtures.push(result);
  return result;
}
const base = (f: Fixture) => `/api/v1/vendors/${f.vendorId}/ads-manager`;
const auth = (f: Fixture) => ({ Authorization: `Bearer ${f.token}` });
function rows(f: Fixture) {
  return {
    campaigns: [
      {
        id: f.campaignId,
        account_id: f.account,
        name: 'Campaign',
        objective: 'OUTCOME_ENGAGEMENT',
        status: 'ACTIVE',
        effective_status: 'ACTIVE',
      },
    ],
    sets: [
      {
        id: f.setId,
        account_id: f.account,
        campaign_id: f.campaignId,
        name: 'Ad set',
        status: 'ACTIVE',
        effective_status: 'ACTIVE',
      },
    ],
    ads: [
      {
        id: f.adId,
        account_id: f.account,
        campaign_id: f.campaignId,
        adset_id: f.setId,
        name: 'Ad',
        status: 'ACTIVE',
        effective_status: 'PENDING_REVIEW',
      },
    ],
  };
}
function provider(f: Fixture, options: any = {}) {
  const data = { ...rows(f), ...options };
  const fetch = vi.fn(async (url: URL, init: any) => {
    expect(url.origin).toBe('https://graph.facebook.com');
    expect(init.method ?? 'GET').toBe('GET');
    if (options.intercept) {
      const response = await options.intercept(url, init);
      if (response) return response;
    }
    if (url.pathname.endsWith('/debug_token'))
      return new Response(
        JSON.stringify({
          data: {
            is_valid: true,
            app_id: '991122',
            type: 'USER',
            scopes: ['ads_read'],
            expires_at: Math.floor(Date.now() / 1000) + 3600,
          },
        }),
      );
    expect(init.headers.Authorization).toBe(`Bearer ${f.tokenValue}`);
    if (url.pathname.endsWith(`/act_${f.account}`))
      return new Response(
        JSON.stringify({
          id: `act_${f.account}`,
          account_id: f.account,
          name: 'Account',
          currency: 'USD',
          timezone_name: 'UTC',
          account_status: 1,
        }),
      );
    for (const [edge, key] of [
      ['campaigns', 'campaigns'],
      ['adsets', 'sets'],
      ['ads', 'ads'],
    ])
      if (url.pathname.endsWith(`/${edge}`))
        return new Response(JSON.stringify({ data: data[key] }));
    throw Error('Unexpected provider path');
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
async function connect(f: Fixture) {
  provider(f);
  const response = await request(app)
    .post(`${base(f)}/accounts/connect`)
    .set(auth(f))
    .send({ accountId: f.account, accessToken: f.tokenValue });
  expect(response.status).toBe(201);
  return response.body;
}
const sync = (f: Fixture, id: number) =>
  request(app)
    .post(`${base(f)}/accounts/${id}/structure/sync`)
    .set(auth(f))
    .send({});
async function setup() {
  const f = await fixture(),
    account = await connect(f);
  expect((await sync(f, account.id)).status).toBe(200);
  return { f, account };
}
const attribution = (f: Fixture) =>
  db.adConversationAttributions.findMany({
    where: { vendorId: f.vendorId },
    orderBy: { id: 'asc' },
  });
function body(f: Fixture, extra: any = {}, referral: any = {}) {
  const message = {
    id: `wamid.${randomUUID()}`,
    from: f.contact.waId,
    timestamp: String(Math.floor(Date.now() / 1000) - 60),
    type: 'text',
    text: { body: 'Please help' },
    referral: {
      source_id: f.adId,
      source_type: 'ad',
      ctwa_clid: `click-${randomUUID()}`,
      source_url:
        'https://example.test/ad?utm_source=meta&utm_placement=feed&private=do-not-export',
      ...referral,
    },
    ...extra,
  };
  receiptKeys.push(`meta-message:${message.id}`);
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: `waba-${f.vendorId}`,
        changes: [
          {
            field: 'messages',
            value: { metadata: { phone_number_id: f.phone }, messages: [message] },
          },
        ],
      },
    ],
  };
}
async function receive(payload: any) {
  const raw = JSON.stringify(payload),
    key = `meta:${digest(raw)}`;
  receiptKeys.push(key);
  const response = await request(app)
    .post('/webhooks/meta')
    .set('Content-Type', 'application/json')
    .set(
      'x-hub-signature-256',
      `sha256=${createHmac('sha256', config.META_APP_SECRET).update(raw).digest('hex')}`,
    )
    .send(raw);
  expect(response.status).toBe(200);
  const job = await db.outboxJobs.findUniqueOrThrow({ where: { dedupeKey: `webhook:${key}` } });
  jobIds.push(job.id);
  await processJob(job);
  return job;
}
async function outcome(f: Fixture, overrides: any = {}) {
  const campaign = await db.adCampaigns.findFirst({ where: { vendorId: f.vendorId } });
  const input = {
    campaignId: campaign?.id,
    contactId: f.contact.id,
    externalId: `outcome-${randomUUID()}`,
    type: 'purchase',
    value: '12.3456',
    currency: 'USD',
    occurredAt: new Date().toISOString(),
    ...overrides,
  };
  return request(app)
    .post(`${base(f)}/conversions`)
    .set(auth(f))
    .send(input);
}
afterAll(async () => {
  const vendors = fixtures.map((f) => f.vendorId),
    users = fixtures.map((f) => f.userId);
  await db.outboxJobs.deleteMany({
    where: { OR: [{ id: { in: jobIds } }, { vendorId: { in: vendors } }] },
  });
  await db.webhookReceipts.deleteMany({ where: { eventKey: { in: receiptKeys } } });
  await db.whatsappMessageLogs.deleteMany({ where: { vendorId: { in: vendors } } });
  await db.nativeIdempotency.deleteMany({ where: { vendorId: { in: vendors } } });
  await db.auditEvents.deleteMany({ where: { vendorId: { in: vendors } } });
  await db.adConversationAttributions.deleteMany({ where: { vendorId: { in: vendors } } });
  await db.adAccounts.deleteMany({ where: { vendorId: { in: vendors } } });
  await db.integrationCredentials.deleteMany({ where: { vendorId: { in: vendors } } });
  await db.contacts.deleteMany({ where: { vendorId: { in: vendors } } });
  await db.nativeMemberships.deleteMany({ where: { vendorId: { in: vendors } } });
  await db.authSessions.deleteMany({ where: { userId: { in: users } } });
  await db.vendors.deleteMany({ where: { id: { in: vendors } } });
  await db.users.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
});

describe('complete native ad structure snapshots', () => {
  it('mirrors verified account/campaign/ad-set/ad identities without inventing budgets or changing metrics', async () => {
    const { f, account } = await setup(),
      campaign = await db.adCampaigns.findFirstOrThrow({ where: { vendorId: f.vendorId } });
    await db.adCampaigns.update({ where: { id: campaign.id }, data: { budgetAmount: '500.25' } });
    expect((await sync(f, account.id)).body).toEqual({ campaigns: 1, adSets: 1, ads: 1 });
    const ad = await db.ads.findFirstOrThrow({
      where: { vendorId: f.vendorId },
      include: { refAdSetId: true },
    });
    expect(ad.refAdSetId.adCampaignId).toBe(campaign.id);
    expect(ad.refAdSetId.dailyBudget).toBeNull();
    expect((ad.tracking as any).nativeAdsMirror).toMatchObject({
      version: 1,
      accountId: account.id,
      campaignId: f.campaignId,
      adSetId: f.setId,
      adId: f.adId,
      effectiveStatus: 'pending_review',
    });
    expect(
      (await db.adCampaigns.findUniqueOrThrow({ where: { id: campaign.id } })).budgetAmount.toFixed(
        4,
      ),
    ).toBe('500.2500');
    expect(await db.campaignDailyMetrics.count({ where: { vendorId: f.vendorId } })).toBe(0);
  });
  it('follows bounded cursors on the fixed host and retains omitted local objects', async () => {
    const { f, account } = await setup();
    provider(f, {
      intercept: (url: URL) =>
        url.pathname.endsWith('/ads')
          ? new Response(
              JSON.stringify(
                url.searchParams.has('after')
                  ? { data: [{ ...rows(f).ads[0], id: `${f.adId}9` }] }
                  : {
                      data: rows(f).ads,
                      paging: {
                        next: 'https://evil.test/token',
                        cursors: { after: 'second-page' },
                      },
                    },
              ),
            )
          : undefined,
    });
    expect((await sync(f, account.id)).body.ads).toBe(2);
    provider(f, { ads: [] });
    expect((await sync(f, account.id)).status).toBe(200);
    expect(await db.ads.count({ where: { vendorId: f.vendorId } })).toBe(2);
  });
  it('rejects wrong accounts, duplicate IDs, unknown parents and conflicting campaign/ad-set chains atomically', async () => {
    const { f, account } = await setup();
    const r = rows(f);
    for (const options of [
      { campaigns: [{ ...r.campaigns[0], account_id: '99887766' }] },
      { sets: [...r.sets, ...r.sets] },
      { sets: [{ ...r.sets[0], campaign_id: '99887766' }] },
      { ads: [{ ...r.ads[0], adset_id: '99887766' }] },
      { ads: [{ ...r.ads[0], campaign_id: '99887766' }] },
      { ads: [{ ...r.ads[0], status: 'UNKNOWN' }] },
    ]) {
      provider(f, options);
      expect((await sync(f, account.id)).status).toBe(502);
      expect((await db.ads.findFirstOrThrow({ where: { vendorId: f.vendorId } })).name).toBe('Ad');
    }
  });
  it('retains all earlier objects when the final collection has repeated cursors', async () => {
    const { f, account } = await setup();
    provider(f, {
      campaigns: [{ ...rows(f).campaigns[0], name: 'Must not commit' }],
      intercept: (url: URL) =>
        url.pathname.endsWith('/ads')
          ? new Response(
              JSON.stringify({
                data: rows(f).ads,
                paging: { next: 'ignored', cursors: { after: 'repeat' } },
              }),
            )
          : undefined,
    });
    expect((await sync(f, account.id)).body.error.code).toBe('AD_PAGINATION_INVALID');
    expect((await db.adCampaigns.findFirstOrThrow({ where: { vendorId: f.vendorId } })).name).toBe(
      'Campaign',
    );
  });
  it('requires review for duplicate legacy identities and rolls back earlier campaign updates', async () => {
    const { f, account } = await setup(),
      set = await db.adSets.findFirstOrThrow({ where: { vendorId: f.vendorId } });
    await db.adSets.create({
      data: {
        vendorId: f.vendorId,
        organizationId: f.vendorId,
        adCampaignId: set.adCampaignId,
        metaAdSetId: f.setId,
        name: 'Legacy duplicate',
      },
    });
    provider(f, { campaigns: [{ ...rows(f).campaigns[0], name: 'Must not commit' }] });
    expect((await sync(f, account.id)).body.error.code).toBe('AD_STRUCTURE_REVIEW_REQUIRED');
    expect((await db.adCampaigns.findFirstOrThrow({ where: { vendorId: f.vendorId } })).name).toBe(
      'Campaign',
    );
  });
  it('cancels a snapshot after a disconnect or revoked membership during reads', async () => {
    for (const revoke of [false, true]) {
      const f = await fixture(),
        account = await connect(f);
      provider(f, {
        intercept: async (url: URL) => {
          if (!url.pathname.endsWith('/ads')) return;
          if (revoke)
            await db.nativeMemberships.updateMany({
              where: { vendorId: f.vendorId },
              data: { active: false },
            });
          else
            await db.adAccounts.update({
              where: { id: account.id },
              data: { status: 'disconnected' },
            });
        },
      });
      expect([403, 404]).toContain((await sync(f, account.id)).status);
      expect(await db.adCampaigns.count({ where: { vendorId: f.vendorId } })).toBe(0);
    }
  });
  it('retains provider deletion tombstones and restores explicitly returned active identities', async () => {
    const { f, account } = await setup();
    provider(f, { ads: [{ ...rows(f).ads[0], status: 'DELETED', effective_status: 'DELETED' }] });
    expect((await sync(f, account.id)).status).toBe(200);
    expect(
      (await db.ads.findFirstOrThrow({ where: { vendorId: f.vendorId } })).deletedAt,
    ).not.toBeNull();
    provider(f);
    expect((await sync(f, account.id)).status).toBe(200);
    expect(
      (await db.ads.findFirstOrThrow({ where: { vendorId: f.vendorId } })).deletedAt,
    ).toBeNull();
  });
});

describe('signed WhatsApp ad referrals and immutable outcomes', () => {
  it('captures a signed referral with owned links and bounded UTM data while preserving contact fields', async () => {
    const { f } = await setup(),
      payload = body(f),
      fetch = provider(f);
    await receive(payload);
    expect(fetch).not.toHaveBeenCalled();
    const [row] = await attribution(f),
      ad = await db.ads.findFirstOrThrow({ where: { vendorId: f.vendorId } });
    expect(row.adId).toBe(ad.id);
    expect(row.adSetId).toBe(ad.adSetId);
    expect(row.adCampaignId).not.toBeNull();
    expect(row.utmParameters).toEqual({ utm_source: 'meta', utm_placement: 'feed' });
    expect(
      (await db.contacts.findUniqueOrThrow({ where: { id: f.contact.id } })).data,
    ).toMatchObject({
      preserved: 'yes',
      ad_attribution: { attributionId: row.id, campaign_name: 'Campaign', ad_name: 'Ad' },
    });
  });
  it('rejects unsigned intake without creating attribution or message receipts', async () => {
    const { f } = await setup();
    expect((await request(app).post('/webhooks/meta').send(body(f))).status).toBe(401);
    expect(await attribution(f)).toHaveLength(0);
  });
  it('deduplicates concurrent callbacks and repeated click IDs without resetting outcomes or revenue', async () => {
    const { f } = await setup(),
      payload = body(f);
    await Promise.all([receive(payload), receive(payload)]);
    expect(await attribution(f)).toHaveLength(1);
    const purchase = await outcome(f);
    expect(purchase.status).toBe(201);
    await receive(body(f, {}, payload.entry[0].changes[0].value.messages[0].referral));
    const [row] = await attribution(f);
    expect(row.revenue.toFixed(4)).toBe('12.3456');
    expect(row.conversionStatus).toBe('purchase');
    expect(await attribution(f)).toHaveLength(1);
  });
  it('uses message receipt identity when a referral has no click ID', async () => {
    const { f } = await setup(),
      payload = body(f, {}, { ctwa_clid: undefined });
    await receive(payload);
    await receive(payload);
    await receive(body(f, {}, { ctwa_clid: undefined }));
    expect(await attribution(f)).toHaveLength(2);
    expect((await attribution(f)).every((row) => row.ctwaClickId === null)).toBe(true);
  });
  it('does not overwrite a click record with a conflicting source or an older referral', async () => {
    const { f } = await setup(),
      payload = body(f);
    await receive(payload);
    const click = payload.entry[0].changes[0].value.messages[0].referral.ctwa_clid;
    await receive(body(f, {}, { ctwa_clid: click, source_id: '9988776655' }));
    expect((await attribution(f))[0].sourceId).toBe(f.adId);
    const summary = (await db.contacts.findUniqueOrThrow({ where: { id: f.contact.id } })).data;
    await receive(
      body(
        f,
        { timestamp: String(Math.floor(Date.now() / 1000) - 3600) },
        { source_id: '9988776655' },
      ),
    );
    expect((await db.contacts.findUniqueOrThrow({ where: { id: f.contact.id } })).data).toEqual(
      summary,
    );
  });
  it('ignores unsupported or invalid referrals without blocking the incoming conversation', async () => {
    const { f } = await setup();
    for (const [message, referral] of [
      [{}, { source_type: 'post' }],
      [{ timestamp: 'invalid' }, {}],
      [{ timestamp: String(Math.floor(Date.now() / 1000) + 3600) }, {}],
      [{}, { source_id: '<invalid>' }],
    ] as any[])
      await receive(body(f, message, referral));
    expect(await attribution(f)).toHaveLength(0);
    expect(await db.whatsappMessageLogs.count({ where: { vendorId: f.vendorId } })).toBe(4);
  });
  it('keeps unknown or foreign ad referrals unmatched and does not invent campaign ownership', async () => {
    const { f } = await setup(),
      other = (await setup()).f;
    await receive(body(f, {}, { source_id: other.adId }));
    const [row] = await attribution(f);
    expect(row.adId).toBeNull();
    expect(row.adCampaignId).toBeNull();
    expect((await outcome(f)).body.attributionId).toBeNull();
  });
  it('does not trust legacy ad rows or imported attribution metadata', async () => {
    const { f } = await setup();
    await db.ads.updateMany({ where: { vendorId: f.vendorId }, data: { tracking: {} } });
    await receive(body(f));
    expect((await attribution(f))[0].adId).toBeNull();
    const campaign = await db.adCampaigns.findFirstOrThrow({ where: { vendorId: f.vendorId } });
    await db.adConversationAttributions.create({
      data: {
        vendorId: f.vendorId,
        organizationId: f.vendorId,
        contactId: f.contact.id,
        adCampaignId: campaign.id,
        conversationStartedAt: new Date(),
        referral: { legacy: true },
      },
    });
    expect((await outcome(f)).body.attributionId).toBeNull();
  });
  it('records concurrent payments and refunds exactly once with four-place revenue and immutable events', async () => {
    const { f } = await setup();
    await receive(body(f));
    const externalId = `purchase-${randomUUID()}`;
    const purchase = { externalId, occurredAt: new Date().toISOString() };
    const responses = await Promise.all([outcome(f, purchase), outcome(f, purchase)]);
    expect(responses.every((r) => r.status === 201)).toBe(true);
    expect(responses[0].body.id).toBe(responses[1].body.id);
    const [refund, payment] = await Promise.all([
      outcome(f, { type: 'refund', value: '2.0001' }),
      outcome(f, { type: 'payment', value: '3.0002' }),
    ]);
    expect([refund.status, payment.status]).toEqual([201, 201]);
    expect((await attribution(f))[0].revenue.toFixed(4)).toBe('13.3457');
    expect(await db.conversions.count({ where: { vendorId: f.vendorId } })).toBe(3);
    expect(await db.conversionEvents.count({ where: { vendorId: f.vendorId } })).toBe(3);
  });
  it('does not attach an outcome before a click or replace the newest status with an older outcome', async () => {
    const { f } = await setup();
    await receive(body(f));
    const before = new Date(Date.now() - 3600000).toISOString();
    expect((await outcome(f, { occurredAt: before })).body.attributionId).toBeNull();
    expect((await outcome(f, { type: 'payment' })).status).toBe(201);
    expect(
      (await outcome(f, { type: 'lead', occurredAt: new Date(Date.now() - 10000).toISOString() }))
        .status,
    ).toBe(201);
    expect((await attribution(f))[0].conversionStatus).toBe('payment');
  });
  it('does not fall back to an older matched click when the latest referral is unmatched', async () => {
    const { f } = await setup();
    await receive(body(f, { timestamp: String(Math.floor(Date.now() / 1000) - 120) }));
    await receive(body(f, {}, { source_id: '9988776655' }));
    expect((await outcome(f)).body.attributionId).toBeNull();
    expect((await attribution(f))[0].revenue.toFixed(4)).toBe('0.0000');
  });
  it('selects the latest verified campaign automatically for contact-only outcomes and preserves the original replay', async () => {
    const { f } = await setup();
    await receive(body(f));
    const externalId = `auto-${randomUUID()}`,
      occurredAt = new Date().toISOString();
    const result = await outcome(f, { campaignId: undefined, externalId, occurredAt });
    expect(result.status).toBe(201);
    expect(result.body.campaignId).not.toBeNull();
    expect(result.body.attributionId).not.toBeNull();
    expect((await outcome(f, { campaignId: undefined, currency: 'INR' })).body.error.code).toBe(
      'AD_CURRENCY_MISMATCH',
    );
    await receive(body(f, {}, { source_id: '9988776655' }));
    const replay = await outcome(f, { campaignId: undefined, externalId, occurredAt });
    expect(replay.body).toEqual(result.body);
    expect(await db.conversionEvents.count({ where: { vendorId: f.vendorId } })).toBe(1);
  });
  it('records visible contact-only outcomes as explicitly unattributed when no verified click exists', async () => {
    const { f } = await setup();
    const result = await outcome(f, { campaignId: undefined });
    expect(result.status).toBe(201);
    expect(result.body.campaignId).toBeNull();
    expect(result.body.attributionId).toBeNull();
    const events = await db.conversionEvents.findMany({ where: { vendorId: f.vendorId } });
    expect(events).toHaveLength(1);
    expect(events[0].payload).toEqual({ nativeVersion: 1, attributionId: null });
  });
  it('links a previously unmatched signed referral after its ad is mirrored, without rewriting earlier outcomes', async () => {
    const f = await fixture(),
      account = await connect(f);
    await receive(body(f));
    const earlier = await outcome(f, { campaignId: undefined });
    expect(earlier.status).toBe(201);
    expect(earlier.body.attributionId).toBeNull();
    expect((await sync(f, account.id)).status).toBe(200);
    const later = await outcome(f, { campaignId: undefined });
    expect(later.status).toBe(201);
    expect(later.body.attributionId).not.toBeNull();
    expect(
      (await db.conversions.findUniqueOrThrow({ where: { id: earlier.body.id } })).adCampaignId,
    ).toBeNull();
    expect((await attribution(f))[0].revenue.toFixed(4)).toBe('12.3456');
  });
  it('requires a native signed receipt claim before using metadata that resembles a converted attribution', async () => {
    const { f } = await setup();
    await receive(body(f));
    await db.nativeIdempotency.deleteMany({
      where: { vendorId: f.vendorId, key: { startsWith: 'ad-referral:' } },
    });
    const result = await outcome(f, { campaignId: undefined });
    expect(result.status).toBe(201);
    expect(result.body.attributionId).toBeNull();
    expect(result.body.campaignId).toBeNull();
  });
  it('excludes corrupt foreign organization links from both capture and attribution history', async () => {
    const { f } = await setup(),
      other = await fixture();
    await receive(body(f));
    const set = await db.adSets.findFirstOrThrow({ where: { vendorId: f.vendorId } });
    await db.adSets.update({ where: { id: set.id }, data: { organizationId: other.vendorId } });
    await receive(body(f));
    expect((await attribution(f))[1].adId).toBeNull();
    const response = await request(app)
      .get(`${base(f)}/contacts/${f.contact.id}/attributions`)
      .set(auth(f));
    expect(response.status).toBe(200);
    expect(response.body.total).toBe(1);
    expect(response.body.items[0].adId).toBeNull();
    expect((await outcome(f)).body.attributionId).toBeNull();
  });
  it('never fetches optional referral URLs and rejects unsafe schemes or credentials in stored metadata', async () => {
    const { f } = await setup(),
      fetch = provider(f);
    await receive(
      body(f, {}, { source_url: 'https://user:password@evil.test/steal?utm_source=bad' }),
    );
    await receive(body(f, {}, { source_url: 'javascript:alert(1)' }));
    expect(fetch).not.toHaveBeenCalled();
    expect((await attribution(f)).every((row) => row.sourceUrl === null)).toBe(true);
    expect((await attribution(f)).every((row) => JSON.stringify(row.utmParameters) === '{}')).toBe(
      true,
    );
  });
  it('rolls back conversions, event records and claims when cumulative revenue exceeds the schema range', async () => {
    const { f } = await setup();
    await receive(body(f));
    const [row] = await attribution(f);
    await db.adConversationAttributions.update({
      where: { id: row.id },
      data: { revenue: '99999999999999.9999' },
    });
    expect((await outcome(f)).body.error.code).toBe('AD_REVENUE_LIMIT');
    expect(await db.conversions.count({ where: { vendorId: f.vendorId } })).toBe(0);
    expect(await db.conversionEvents.count({ where: { vendorId: f.vendorId } })).toBe(0);
    expect(
      await db.nativeIdempotency.count({
        where: { vendorId: f.vendorId, key: { startsWith: 'ad-conversion:' } },
      }),
    ).toBe(0);
  });
  it('removes deleted-contact attribution history while retaining accounting outcomes and deduplication claims', async () => {
    const { f } = await setup();
    const payload = body(f);
    await receive(payload);
    const result = await outcome(f);
    expect(result.status).toBe(201);
    expect(
      (
        await request(app)
          .delete(`/api/v1/vendors/${f.vendorId}/contacts/${f.contact.id}`)
          .set(auth(f))
      ).status,
    ).toBe(204);
    expect(await attribution(f)).toHaveLength(0);
    const conversion = await db.conversions.findUniqueOrThrow({ where: { id: result.body.id } });
    expect(conversion.contactWaId).toBeNull();
    expect(conversion.value.toFixed(4)).toBe('12.3456');
    expect(await db.conversionEvents.count({ where: { vendorId: f.vendorId } })).toBe(1);
    expect(
      await db.nativeIdempotency.count({
        where: { vendorId: f.vendorId, key: { startsWith: 'ad-referral:' } },
      }),
    ).toBe(1);
    expect(
      (
        await request(app)
          .get(`${base(f)}/contacts/${f.contact.id}/attributions`)
          .set(auth(f))
      ).status,
    ).toBe(404);
    await receive(payload);
    expect(await attribution(f)).toHaveLength(0);
  });
  it('serializes outcome recording with contact deletion without orphaning history or a phone identifier', async () => {
    const { f } = await setup();
    await receive(body(f));
    const [conversion, deleted] = await Promise.all([
      outcome(f),
      request(app).delete(`/api/v1/vendors/${f.vendorId}/contacts/${f.contact.id}`).set(auth(f)),
    ]);
    expect([201, 404]).toContain(conversion.status);
    expect(deleted.status).toBe(204);
    expect(await attribution(f)).toHaveLength(0);
    expect(
      await db.conversions.count({ where: { vendorId: f.vendorId, contactWaId: { not: null } } }),
    ).toBe(0);
  });
  it('exposes attribution history only for visible contacts and excludes URLs, click IDs and referral payloads', async () => {
    const { f } = await setup();
    await receive(body(f));
    await outcome(f);
    const response = await request(app)
      .get(`${base(f)}/contacts/${f.contact.id}/attributions`)
      .set(auth(f));
    expect(response.status).toBe(200);
    expect(response.body.items[0]).toMatchObject({
      campaignName: 'Campaign',
      currency: 'USD',
      revenue: '12.3456',
    });
    expect(response.text).not.toContain('do-not-export');
    expect(response.text).not.toContain('ctwa');
    expect(response.text).not.toContain('click-');
    expect(response.text).not.toContain(f.contact.waId!);
    const generic = await request(app)
      .get(`/api/v1/vendors/${f.vendorId}/resources/ad-attributions`)
      .set(auth(f));
    expect(generic.status).toBe(200);
    expect(generic.text).not.toContain('do-not-export');
    expect(generic.text).not.toContain('click-');
    expect(generic.body.items[0]).not.toHaveProperty('referral');
    const other = await fixture();
    expect(
      (
        await request(app)
          .get(`${base(other)}/contacts/${f.contact.id}/attributions`)
          .set(auth(other))
      ).status,
    ).toBe(404);
    await db.nativeMemberships.updateMany({
      where: { vendorId: f.vendorId },
      data: { role: 'agent', permissions: ['ads.analytics', 'vendor.contacts.view'] },
    });
    expect(
      (
        await request(app)
          .get(`${base(f)}/contacts/${f.contact.id}/attributions`)
          .set(auth(f))
      ).status,
    ).toBe(404);
    await db.contacts.update({ where: { id: f.contact.id }, data: { assignedUserId: f.userId } });
    expect(
      (
        await request(app)
          .get(`${base(f)}/contacts/${f.contact.id}/attributions`)
          .set(auth(f))
      ).status,
    ).toBe(200);
  });
});
