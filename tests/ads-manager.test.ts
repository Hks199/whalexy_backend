import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeEach, afterEach, afterAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { decrypt, encrypt } from '../src/utils/crypto.js';
import {
  adAmount,
  insightRow,
  summarizeAds,
} from '../src/modules/ads-manager/services/ad-insights.js';
import { businessFixture } from './fixtures.js';

type Fixture = Awaited<ReturnType<typeof businessFixture>> & {
  account: string;
  tokenValue: string;
};
const app = createApp(),
  fixtures: Fixture[] = [];
const today = new Date().toISOString().slice(0, 10),
  date = new Date(Date.now() - 86400000).toISOString().slice(0, 10),
  from = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
const range = { from, to: date };
async function fixture(permissions = ['*']): Promise<Fixture> {
  const f = {
    ...(await businessFixture(permissions)),
    account: '',
    tokenValue: `ad-token-${randomUUID()}`,
  };
  f.account = `87700${f.vendorId}`;
  fixtures.push(f);
  return f;
}
const base = (f: Fixture) => `/api/v1/vendors/${f.vendorId}/ads-manager`;
const auth = (f: Fixture) => ({ Authorization: `Bearer ${f.token}` });
const campaigns = (f: Fixture) => [
  {
    id: `${f.account}1`,
    name: 'Campaign',
    objective: 'OUTCOME_ENGAGEMENT',
    status: 'ACTIVE',
    effective_status: 'ACTIVE',
  },
];
const metric = (f: Fixture, overrides: any = {}) => ({
  campaign_id: `${f.account}1`,
  account_currency: 'USD',
  date_start: date,
  date_stop: date,
  spend: '12.3456',
  reach: '100',
  impressions: '200',
  clicks: '20',
  actions: [
    { action_type: 'lead', value: '2' },
    { action_type: 'purchase', value: '1' },
    { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '3' },
  ],
  action_values: [{ action_type: 'purchase', value: '40.1250' }],
  ...overrides,
});
function provider(f: Fixture, options: any = {}) {
  const fetch = vi.fn(async (url: URL, init: any) => {
    expect(url.origin).toBe('https://graph.facebook.com');
    if (options.intercept) {
      const result = await options.intercept(url, init);
      if (result) return result;
    }
    expect(init.method ?? 'GET').toBe('GET');
    if (url.pathname.endsWith('/debug_token'))
      return new Response(
        JSON.stringify({
          data: {
            is_valid: true,
            app_id: '991122',
            type: 'USER',
            scopes: ['ads_read'],
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            ...options.debug,
          },
        }),
      );
    expect(init.headers.Authorization).toBe(`Bearer ${f.tokenValue}`);
    if (url.pathname.endsWith(`/act_${f.account}`))
      return new Response(
        JSON.stringify({
          id: `act_${f.account}`,
          account_id: f.account,
          name: 'Verified account',
          currency: options.currency ?? 'USD',
          timezone_name: 'UTC',
          account_status: 1,
          ...options.account,
        }),
      );
    if (url.pathname.endsWith('/campaigns'))
      return new Response(
        JSON.stringify({
          data: options.campaigns ?? campaigns(f),
          ...(options.paging ? { paging: options.paging } : {}),
        }),
      );
    if (url.pathname.endsWith('/insights')) {
      expect(url.searchParams.get('time_increment')).toBe('1');
      expect(url.searchParams.get('level')).toBe('campaign');
      return new Response(JSON.stringify({ data: options.metrics ?? [metric(f)] }));
    }
    throw Error('Unexpected Graph path');
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
async function connect(f: Fixture) {
  const response = await request(app)
    .post(`${base(f)}/accounts/connect`)
    .set(auth(f))
    .send({ accountId: f.account, accessToken: f.tokenValue });
  expect(response.status).toBe(201);
  return response.body;
}
const sync = (f: Fixture, id: number, r = range) =>
  request(app)
    .post(`${base(f)}/accounts/${id}/sync`)
    .set(auth(f))
    .send(r);
const query = (r = range) => `from=${r.from}&to=${r.to}`;
beforeEach(() => {
  vi.stubEnv('META_APP_ID', '991122');
  vi.stubEnv('META_APP_SECRET', 'test-app-secret');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
afterAll(async () => {
  const vendors = fixtures.map((f) => f.vendorId),
    users = fixtures.map((f) => f.userId);
  await db.nativeIdempotency.deleteMany({ where: { vendorId: { in: vendors } } });
  await db.auditEvents.deleteMany({ where: { vendorId: { in: vendors } } });
  await db.integrationCredentials.deleteMany({ where: { vendorId: { in: vendors } } });
  await db.adAccounts.deleteMany({ where: { vendorId: { in: vendors } } });
  await db.contacts.deleteMany({ where: { vendorId: { in: vendors } } });
  await db.nativeMemberships.deleteMany({ where: { vendorId: { in: vendors } } });
  await db.authSessions.deleteMany({ where: { userId: { in: users } } });
  await db.vendors.deleteMany({ where: { id: { in: vendors } } });
  await db.users.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
});
describe('native ad accounts and complete read snapshots', () => {
  it('verifies the token/app and account identity and retains secrets only in the encrypted credential store', async () => {
    const f = await fixture();
    provider(f);
    const account = await connect(f);
    expect(JSON.stringify(account)).not.toContain(f.tokenValue);
    expect(
      (await db.adAccounts.findUniqueOrThrow({ where: { id: account.id } })).accessToken,
    ).toBeNull();
    const credential = await db.integrationCredentials.findUniqueOrThrow({
      where: {
        vendorId_provider_externalId: {
          vendorId: f.vendorId,
          provider: 'meta-ads',
          externalId: f.account,
        },
      },
    });
    expect(decrypt(credential.secret)).toBe(f.tokenValue);
    expect(
      (
        await request(app)
          .get(`${base(f)}/accounts`)
          .set(auth(f))
      ).text,
    ).not.toContain(f.tokenValue);
  });
  it('rejects incorrect apps, revoked/expired tokens, missing permissions and wrong remote identities', async () => {
    const f = await fixture();
    for (const debug of [
      { app_id: 'other' },
      { is_valid: false },
      { scopes: [] },
      { expires_at: 1 },
      { type: 'PAGE' },
    ]) {
      provider(f, { debug });
      expect(
        (
          await request(app)
            .post(`${base(f)}/accounts/connect`)
            .set(auth(f))
            .send({ accountId: f.account, accessToken: f.tokenValue })
        ).status,
      ).toBe(403);
    }
    provider(f, { account: { account_id: 'another-account' } });
    expect(
      (
        await request(app)
          .post(`${base(f)}/accounts/connect`)
          .set(auth(f))
          .send({ accountId: f.account, accessToken: f.tokenValue })
      ).status,
    ).toBe(502);
    expect(await db.adAccounts.count({ where: { vendorId: f.vendorId } })).toBe(0);
  });
  it('requires an owner for connection and prevents two workspaces from claiming one account', async () => {
    const owner = await fixture(),
      other = await fixture(),
      agent = await fixture(['ads.view', 'ads.edit']);
    provider(owner);
    const account = await connect(owner);
    expect(
      (
        await request(app)
          .post(`${base(agent)}/accounts/connect`)
          .set(auth(agent))
          .send({ accountId: owner.account, accessToken: owner.tokenValue })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post(`${base(other)}/accounts/connect`)
          .set(auth(other))
          .send({ accountId: owner.account, accessToken: owner.tokenValue })
      ).status,
    ).toBe(409);
    expect((await sync(other, account.id)).status).toBe(404);
  });
  it('imports owned campaign identities and exact daily amounts atomically and exposes safe paginated lists', async () => {
    const f = await fixture();
    provider(f);
    const account = await connect(f);
    expect((await sync(f, account.id)).body).toEqual({ campaigns: 1, metrics: 1 });
    const row = await db.campaignDailyMetrics.findFirstOrThrow({ where: { vendorId: f.vendorId } });
    expect(row.spend.toFixed(4)).toBe('12.3456');
    expect(row.revenue.toFixed(4)).toBe('40.1250');
    expect(row.conversations).toBe(3);
    const listed = await request(app)
      .get(`${base(f)}/campaigns?search=Campaign&status=active&limit=1`)
      .set(auth(f));
    expect(listed.body.total).toBe(1);
    expect(listed.body.items[0].metaCampaignId).toBe(`${f.account}1`);
  });
  it('reads subsequent pages using a fixed Graph host rather than provider next URLs', async () => {
    const f = await fixture();
    provider(f);
    const account = await connect(f);
    provider(f, {
      intercept: (url: URL) =>
        url.pathname.endsWith('/campaigns')
          ? new Response(
              JSON.stringify(
                url.searchParams.has('after')
                  ? { data: [{ ...campaigns(f)[0], id: `${f.account}2` }] }
                  : {
                      data: campaigns(f),
                      paging: {
                        next: 'https://evil.example/steal-token',
                        cursors: { after: 'next-cursor' },
                      },
                    },
              ),
            )
          : undefined,
    });
    expect((await sync(f, account.id)).body.campaigns).toBe(2);
  });
  it('retains earlier metrics after repeated cursors or malformed complete snapshots', async () => {
    const f = await fixture();
    provider(f);
    const account = await connect(f);
    await sync(f, account.id);
    for (const options of [
      { paging: { next: 'ignored', cursors: { after: 'repeat' } } },
      { metrics: [metric(f, { account_currency: 'INR' })] },
      { metrics: [metric(f), metric(f)] },
      { metrics: [metric(f, { spend: 'NaN' })] },
      { metrics: [metric(f, { date_stop: today })] },
      { metrics: [metric(f, { campaign_id: '9988776655' })] },
    ]) {
      provider(f, options);
      expect((await sync(f, account.id)).status).toBe(502);
      expect(
        (
          await db.campaignDailyMetrics.findFirstOrThrow({ where: { vendorId: f.vendorId } })
        ).spend.toFixed(4),
      ).toBe('12.3456');
    }
  });
  it('rejects invalid counters/actions instead of rounding modeled conversions or inventing zero amounts', () => {
    const f = { account: '88776655' } as Fixture;
    for (const overrides of [
      { date_start: undefined, date_stop: undefined },
      { campaign_id: 887766551 },
      { clicks: '2147483648' },
      { actions: [{ action_type: 'lead', value: '1.5' }] },
      {
        actions: [
          { action_type: 'lead', value: '1' },
          { action_type: 'lead', value: '2' },
        ],
      },
      { spend: undefined },
      { revenue: '-1', action_values: [{ action_type: 'purchase', value: '-1' }] },
    ])
      expect(() => insightRow(metric(f, overrides), 'USD', from, date)).toThrow();
    expect(() => adAmount('999999999999999')).toThrow();
  });
  it('replaces only the requested complete date snapshot and leaves earlier ranges intact', async () => {
    const f = await fixture();
    provider(f);
    const account = await connect(f);
    await sync(f, account.id);
    const campaign = await db.adCampaigns.findFirstOrThrow({ where: { vendorId: f.vendorId } });
    await db.campaignDailyMetrics.create({
      data: {
        adCampaignId: campaign.id,
        vendorId: f.vendorId,
        organizationId: f.vendorId,
        metricDate: new Date('2020-01-01'),
        spend: '2',
      },
    });
    provider(f, { metrics: [] });
    expect((await sync(f, account.id)).status).toBe(200);
    const rows = await db.campaignDailyMetrics.findMany({ where: { vendorId: f.vendorId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].metricDate.toISOString().slice(0, 10)).toBe('2020-01-01');
  });
  it('cancels a prepared snapshot after disconnect, token rotation or account revision changes', async () => {
    for (const change of ['disconnect', 'rotate', 'revision']) {
      const f = await fixture();
      provider(f);
      const account = await connect(f);
      provider(f, {
        intercept: async (url: URL) => {
          if (!url.pathname.endsWith('/insights')) return;
          if (change === 'disconnect')
            await db.adAccounts.update({
              where: { id: account.id },
              data: { status: 'disconnected' },
            });
          else if (change === 'revision')
            await db.adAccounts.update({
              where: { id: account.id },
              data: { updatedAt: new Date(Date.now() + 1000) },
            });
          else
            await db.integrationCredentials.updateMany({
              where: { vendorId: f.vendorId },
              data: { secret: encrypt('replacement-token') },
            });
        },
      });
      expect([404, 409]).toContain((await sync(f, account.id)).status);
      expect(await db.campaignDailyMetrics.count({ where: { vendorId: f.vendorId } })).toBe(0);
    }
  });
  it('disconnects locally and preserves history while denying subsequent synchronization', async () => {
    const f = await fixture();
    provider(f);
    const account = await connect(f);
    await sync(f, account.id);
    expect(
      (
        await request(app)
          .delete(`${base(f)}/accounts/${account.id}`)
          .set(auth(f))
      ).status,
    ).toBe(204);
    expect(
      await db.integrationCredentials.count({
        where: { vendorId: f.vendorId, provider: 'meta-ads' },
      }),
    ).toBe(0);
    expect((await sync(f, account.id)).status).toBe(404);
    expect(
      (
        await request(app)
          .get(`${base(f)}/campaigns`)
          .set(auth(f))
      ).body.total,
    ).toBe(1);
  });
  it('rejects a truncated 50-page snapshot and preserves data before any local import', async () => {
    const f = await fixture();
    provider(f);
    const account = await connect(f);
    provider(f, {
      intercept: (url: URL) =>
        url.pathname.endsWith('/campaigns')
          ? new Response(
              JSON.stringify({
                data: [],
                paging: {
                  next: 'ignored',
                  cursors: { after: String(Number(url.searchParams.get('after') ?? 0) + 1) },
                },
              }),
            )
          : undefined,
    });
    expect((await sync(f, account.id)).body.error.code).toBe('AD_SNAPSHOT_INCOMPLETE');
    expect(await db.adCampaigns.count({ where: { vendorId: f.vendorId } })).toBe(0);
  });
  it('stops import when access is revoked during remote reads and rejects currency changes on reconnect', async () => {
    const f = await fixture();
    provider(f);
    const account = await connect(f);
    provider(f, {
      intercept: async (url: URL) => {
        if (url.pathname.endsWith('/insights'))
          await db.nativeMemberships.updateMany({
            where: { vendorId: f.vendorId },
            data: { active: false },
          });
      },
    });
    expect((await sync(f, account.id)).status).toBe(403);
    expect(await db.adCampaigns.count({ where: { vendorId: f.vendorId } })).toBe(0);
    await db.nativeMemberships.updateMany({
      where: { vendorId: f.vendorId },
      data: { active: true },
    });
    provider(f, { currency: 'INR' });
    expect(
      (
        await request(app)
          .post(`${base(f)}/accounts/connect`)
          .set(auth(f))
          .send({ accountId: f.account, accessToken: f.tokenValue })
      ).body.error.code,
    ).toBe('AD_CURRENCY_REVIEW_REQUIRED');
  });
});
describe('guarded remote campaign delivery status', () => {
  async function setup() {
    const f = await fixture();
    provider(f, { debug: { scopes: ['ads_read', 'ads_management'] } });
    const account = await connect(f);
    await sync(f, account.id);
    const campaign = await db.adCampaigns.findFirstOrThrow({ where: { vendorId: f.vendorId } });
    return { f, campaign };
  }
  const send = (f: Fixture, id: number, key: string, status = 'paused') =>
    request(app)
      .post(`${base(f)}/campaigns/${id}/status`)
      .set(auth(f))
      .set('Idempotency-Key', key)
      .send({ status });
  it('requires verified management permission and a durable idempotency key', async () => {
    const f = await fixture();
    provider(f);
    const account = await connect(f);
    await sync(f, account.id);
    const campaign = await db.adCampaigns.findFirstOrThrow({ where: { vendorId: f.vendorId } });
    expect((await send(f, campaign.id, randomUUID())).status).toBe(403);
    const ready = await setup();
    expect((await send(ready.f, ready.campaign.id, 'short')).body.error.code).toBe(
      'IDEMPOTENCY_REQUIRED',
    );
  });
  it('changes an owned provider campaign once and waits for synchronization to assert effective delivery', async () => {
    const { f, campaign } = await setup();
    let mutations = 0;
    provider(f, {
      intercept: (url: URL, init: any) => {
        if (!url.pathname.endsWith(`/${campaign.metaCampaignId}`)) return;
        if (init.method === 'POST') {
          mutations++;
          expect(init.body).toBe('status=PAUSED');
          return new Response('{"success":true}');
        }
        return new Response(
          JSON.stringify({ id: campaign.metaCampaignId, account_id: f.account, status: 'ACTIVE' }),
        );
      },
    });
    const key = randomUUID();
    expect((await send(f, campaign.id, key)).body).toMatchObject({
      status: 'paused',
      effectiveStatus: 'pending_sync',
      providerAccepted: true,
    });
    expect((await send(f, campaign.id, key)).status).toBe(200);
    expect(mutations).toBe(1);
    expect((await send(f, campaign.id, key, 'active')).body.error.code).toBe(
      'IDEMPOTENCY_CONFLICT',
    );
  });
  it('blocks repeats under new keys after a lost provider status response', async () => {
    const { f, campaign } = await setup();
    let mutations = 0;
    provider(f, {
      intercept: (url: URL, init: any) => {
        if (!url.pathname.endsWith(`/${campaign.metaCampaignId}`)) return;
        if (init.method === 'POST') {
          mutations++;
          throw Error('lost response');
        }
        return new Response(
          JSON.stringify({ id: campaign.metaCampaignId, account_id: f.account, status: 'ACTIVE' }),
        );
      },
    });
    expect((await send(f, campaign.id, randomUUID())).body.error.code).toBe('PROVIDER_UNCERTAIN');
    expect((await send(f, campaign.id, randomUUID())).body.error.code).toBe(
      'PROVIDER_RECONCILIATION_REQUIRED',
    );
    expect(mutations).toBe(1);
  });
  it('verifies remote account ownership before mutations and keeps failures private', async () => {
    const { f, campaign } = await setup();
    let mutations = 0;
    provider(f, {
      intercept: (url: URL, init: any) => {
        if (!url.pathname.endsWith(`/${campaign.metaCampaignId}`)) return;
        if (init.method === 'POST') {
          mutations++;
          return new Response('{"success":true}');
        }
        return new Response(
          JSON.stringify({ id: campaign.metaCampaignId, account_id: 'another-account' }),
        );
      },
    });
    expect((await send(f, campaign.id, randomUUID())).body.error.code).toBe('AD_CAMPAIGN_OWNER');
    expect(mutations).toBe(0);
    expect(
      JSON.stringify(await db.auditEvents.findMany({ where: { vendorId: f.vendorId } })),
    ).not.toContain(f.tokenValue);
  });
});
describe('currency-safe ad analytics and conversion recording', () => {
  it('returns exact ratios with zero-division protection and identifies summed reach explicitly', async () => {
    const f = await fixture();
    provider(f);
    const account = await connect(f);
    await sync(f, account.id);
    const response = await request(app)
      .get(`${base(f)}/dashboard?${query()}`)
      .set(auth(f));
    expect(response.status).toBe(200);
    expect(response.body.currencies[0]).toMatchObject({
      currency: 'USD',
      summary: {
        spend: '12.3456',
        revenue: '40.1250',
        summedReach: 100,
        ctr: '10',
        cpc: '0.6173',
        roas: '3.2501',
      },
    });
    expect(summarizeAds([])).toMatchObject({ ctr: '0', cpc: '0', roas: '0' });
    const high = insightRow(
      metric(f, {
        spend: '99999999999999.9999',
        action_values: [{ action_type: 'purchase', value: '99999999999999.9999' }],
      }),
      'USD',
      from,
      date,
    );
    expect(summarizeAds(Array.from({ length: 9999 }, () => high))).toMatchObject({
      spend: '999899999999999999.0001',
      revenue: '999899999999999999.0001',
      roas: '1',
    });
  });
  it('keeps currency totals separate and denies foreign report filters or excessive date ranges', async () => {
    const f = await fixture();
    provider(f);
    const usd = await connect(f);
    await sync(f, usd.id);
    const inr = { ...f, account: `${f.account}9` };
    provider(inr, { currency: 'INR', metrics: [metric(inr, { account_currency: 'INR' })] });
    const account = await connect(inr);
    await sync(inr, account.id);
    const response = await request(app)
      .get(`${base(f)}/dashboard?${query()}`)
      .set(auth(f));
    expect(response.body.currencies.map((c: any) => c.currency).sort()).toEqual(['INR', 'USD']);
    const other = await fixture();
    expect(
      (
        await request(app)
          .get(`${base(other)}/dashboard?${query()}&accountId=${usd.id}`)
          .set(auth(other))
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .get(`${base(f)}/dashboard?from=2020-01-01&to=${date}`)
          .set(auth(f))
      ).status,
    ).toBe(400);
  });
  it('exports private CSV with currency columns and spreadsheet-formula protection', async () => {
    const f = await fixture();
    provider(f, { campaigns: [{ ...campaigns(f)[0], name: '=HYPERLINK("evil")' }] });
    const account = await connect(f);
    await sync(f, account.id);
    const response = await request(app)
      .get(`${base(f)}/reports/export.csv?${query()}`)
      .set(auth(f));
    expect(response.status).toBe(200);
    expect(response.text).toContain('Currency');
    expect(response.text).toContain("'=HYPERLINK");
    expect(response.text).not.toContain(f.tokenValue);
    const restricted = await fixture(['ads.view']);
    expect(
      (
        await request(app)
          .get(`${base(restricted)}/reports/export.csv?${query()}`)
          .set(auth(restricted))
      ).status,
    ).toBe(403);
  });
  it('records one immutable conversion across concurrent external-ID retries', async () => {
    const f = await fixture();
    provider(f);
    const account = await connect(f);
    await sync(f, account.id);
    const campaign = await db.adCampaigns.findFirstOrThrow({ where: { vendorId: f.vendorId } });
    const body = {
      campaignId: campaign.id,
      externalId: 'order-1',
      type: 'purchase',
      value: '20.10',
      currency: 'USD',
      occurredAt: new Date(Date.now() - 1000).toISOString(),
    };
    const send = (input = body) =>
      request(app)
        .post(`${base(f)}/conversions`)
        .set(auth(f))
        .send(input);
    const responses = await Promise.all([send(), send()]);
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    expect(responses[0].body.id).toBe(responses[1].body.id);
    expect(responses[0].body.value).toBe('20.1000');
    expect((await send({ ...body, value: '30.00' })).body.error.code).toBe(
      'AD_CONVERSION_CONFLICT',
    );
    expect(await db.conversions.count({ where: { vendorId: f.vendorId } })).toBe(1);
  });
  it('validates owned campaigns, currencies, contact visibility and existing legacy external IDs', async () => {
    const f = await fixture(),
      other = await fixture();
    provider(f);
    const account = await connect(f);
    await sync(f, account.id);
    const campaign = await db.adCampaigns.findFirstOrThrow({ where: { vendorId: f.vendorId } });
    const body = {
      campaignId: campaign.id,
      externalId: 'conversion-test',
      type: 'lead',
      currency: 'USD',
      occurredAt: new Date(Date.now() - 1000).toISOString(),
    };
    expect(
      (
        await request(app)
          .post(`${base(other)}/conversions`)
          .set(auth(other))
          .send(body)
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .post(`${base(f)}/conversions`)
          .set(auth(f))
          .send({ ...body, currency: 'INR' })
      ).status,
    ).toBe(400);
    const contact = await db.contacts.create({
      data: { vendorId: other.vendorId, waId: '919876543210' },
    });
    expect(
      (
        await request(app)
          .post(`${base(f)}/conversions`)
          .set(auth(f))
          .send({ ...body, contactId: contact.id })
      ).status,
    ).toBe(404);
    await db.conversions.create({
      data: {
        adCampaignId: campaign.id,
        vendorId: f.vendorId,
        organizationId: f.vendorId,
        externalId: body.externalId,
        type: 'lead',
        occurredAt: new Date(),
      },
    });
    expect(
      (
        await request(app)
          .post(`${base(f)}/conversions`)
          .set(auth(f))
          .send(body)
      ).body.error.code,
    ).toBe('AD_CONVERSION_REVIEW_REQUIRED');
  });
  it('blocks generic campaign/ad-set/creative/ad/budget mutations from bypassing dedicated workflows', async () => {
    const f = await fixture();
    for (const resource of ['ad-campaigns', 'ad-sets', 'ad-creatives', 'ads', 'ad-budgets'])
      expect(
        (
          await request(app)
            .post(`/api/v1/vendors/${f.vendorId}/resources/${resource}`)
            .set(auth(f))
            .send({ name: 'unsafe', status: 'active' })
        ).status,
      ).toBe(403);
  });
});
