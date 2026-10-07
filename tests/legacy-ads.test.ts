import { afterAll, describe, expect, it, vi, afterEach } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { db } from '../src/database/client.js';
import { createApp } from '../src/app.js';
import { businessFixture } from './fixtures.js';
const app = createApp();
afterAll(() => db.$disconnect());
afterEach(() => vi.unstubAllGlobals());
async function fixture() {
  const f = await businessFixture(),
    vendor = await db.vendors.findUniqueOrThrow({ where: { id: f.vendorId } });
  const account = await db.adAccounts.create({
    data: {
      vendorId: f.vendorId,
      organizationId: f.vendorId,
      name: 'Draft account',
      currency: 'INR',
    },
  });
  const body = {
    ad_account_id: account.id,
    name: 'WhatsApp draft',
    objective: 'messages',
    goal: 'whatsapp_messages',
    budget_type: 'daily',
    budget_amount: '120.5000',
    bid_strategy: 'lowest_cost',
    timezone: 'Asia/Kolkata',
    audience: {
      location_mode: 'country',
      countries: ['IN'],
      age_min: 18,
      age_max: 65,
      genders: ['all'],
    },
    placement_mode: 'automatic',
    placements: ['facebook_feed'],
    creative: {
      format: 'single_image',
      headline: 'Headline',
      primary_text: 'Message',
      call_to_action: 'SEND_WHATSAPP_MESSAGE',
    },
    publish: false,
  };
  const base = `/api/${vendor.uid}/ads-manager`;
  const create = (payload: any = body, key = randomUUID()) =>
    request(app)
      .post(base + '/campaigns')
      .set('Authorization', `Bearer ${f.token}`)
      .set('Idempotency-Key', key)
      .send(payload);
  const act = (id: string, action: string, key: string = randomUUID()) =>
    request(app)
      .post(`${base}/campaigns/${id}/action`)
      .set('Authorization', `Bearer ${f.token}`)
      .set('Idempotency-Key', key)
      .send({ action });
  return { ...f, account, body, base, create, act };
}
describe('original AdsManager API adapters', () => {
  it('atomically creates all draft rows and deduplicates concurrent requests', async () => {
    const f = await fixture(),
      key = randomUUID();
    vi.stubGlobal('fetch', vi.fn());
    const results = await Promise.all([f.create(f.body, key), f.create(f.body, key)]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(results[0].body).toEqual(results[1].body);
    expect(results[0].body.data.budget).toEqual({
      type: 'daily',
      amount: '120.5000',
      currency: 'INR',
    });
    for (const table of [db.adCampaigns, db.adSets, db.adCreatives, db.ads] as any[])
      expect(await table.count({ where: { vendorId: f.vendorId } })).toBe(1);
    expect((await f.create({ ...f.body, name: 'Changed' }, key)).status).toBe(409);
    expect(fetch).not.toHaveBeenCalled();
    const list = await request(app)
      .get(f.base + '/campaigns')
      .set('Authorization', `Bearer ${f.token}`)
      .query({ objective: 'messages' });
    expect(list.body.data.map((r: any) => r.id)).toEqual([results[0].body.data.id]);
    expect(JSON.stringify(list.body)).not.toContain('accessToken');
  });
  it('duplicates and deletes local drafts with replay safety and isolates accounts', async () => {
    const f = await fixture(),
      other = await fixture(),
      created = await f.create();
    const id = created.body.data.id,
      key = randomUUID();
    const copies = await Promise.all([f.act(id, 'duplicate', key), f.act(id, 'duplicate', key)]);
    expect(copies.map((r) => r.status)).toEqual([200, 200]);
    expect(copies[0].body).toEqual(copies[1].body);
    expect(await db.adCampaigns.count({ where: { vendorId: f.vendorId } })).toBe(2);
    const deleted = await f.act(id, 'delete', key + 'delete');
    expect(deleted.status).toBe(200);
    expect((await f.act(id, 'delete', key + 'delete')).body).toEqual(deleted.body);
    expect((await f.act(id, 'delete')).status).toBe(409);
    expect((await f.create({ ...f.body, ad_account_id: other.account.id })).status).toBe(404);
    expect((await other.act(copies[0].body.data.id, 'delete')).status).toBe(404);
    const list = await request(app)
      .get(f.base + '/campaigns')
      .set('Authorization', `Bearer ${f.token}`);
    expect(list.body.meta.total).toBe(1);
  });
  it('rejects unsupported publication and invalid targeting before effects', async () => {
    const f = await fixture();
    vi.stubGlobal('fetch', vi.fn());
    for (const body of [
      { ...f.body, publish: true },
      { ...f.body, timezone: 'invalid/timezone' },
      { ...f.body, budget_amount: '0' },
      { ...f.body, budget_type: 'lifetime' },
      { ...f.body, special_ad_category: 'housing', audience: { ...f.body.audience, age_min: 25 } },
    ])
      expect((await f.create(body)).status).toBeGreaterThanOrEqual(400);
    expect(await db.adCampaigns.count({ where: { vendorId: f.vendorId } })).toBe(0);
    const created = await f.create();
    expect((await f.act(created.body.data.id, 'publish')).body.error.code).toBe(
      'AD_PUBLISH_REVIEW_REQUIRED',
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it('maps UUID conversions with immutable retries and validates reporting ranges', async () => {
    const f = await fixture(),
      created = await f.create();
    const body = {
      campaign_uuid: created.body.data.id,
      external_id: randomUUID(),
      type: 'purchase',
      value: '123.4567',
      currency: 'INR',
      occurred_at: new Date().toISOString(),
    };
    const send = (payload = body) =>
      request(app)
        .post(f.base + '/conversions')
        .set('Authorization', `Bearer ${f.token}`)
        .send(payload);
    expect((await send()).status).toBe(201);
    expect((await send()).status).toBe(201);
    expect((await send({ ...body, value: '999' })).status).toBe(409);
    const dashboard = await request(app)
      .get(f.base + '/dashboard')
      .set('Authorization', `Bearer ${f.token}`);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.currencies).toEqual([]);
    expect(
      (
        await request(app)
          .get(f.base + '/dashboard')
          .set('Authorization', `Bearer ${f.token}`)
          .query({ range: 'custom' })
      ).status,
    ).toBe(400);
  });
});
