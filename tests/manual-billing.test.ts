import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { businessFixture } from './fixtures.js';
import { manualPeriod } from '../src/modules/manual-billing/services/manual-billing-support.service.js';
import { baseSubscriptionActive } from '../src/modules/billing/services/billing-support.service.js';
const app = createApp();
const plans = [
  {
    id: 'manual_pro',
    title: 'Manual Pro',
    priceId: 'price_manualpro',
    interval: 'monthly',
    amount: 120000,
    currency: 'INR',
    manualPayments: true,
  },
  {
    id: 'automatic',
    title: 'Automatic',
    priceId: 'price_auto',
    interval: 'yearly',
    amount: 240000,
    currency: 'INR',
  },
];
beforeEach(() => vi.stubEnv('BILLING_PLANS', JSON.stringify(plans)));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterAll(() => db.$disconnect());
type Fixture = Awaited<ReturnType<typeof businessFixture>>;
const base = (f: Fixture) => `/api/v1/vendors/${f.vendorId}/billing/manual`;
const auth = (f: Fixture) => `Bearer ${f.token}`;
const quote = (f: Fixture, key = randomUUID(), planId = 'manual_pro') =>
  request(app)
    .post(`${base(f)}/quote`)
    .set('Authorization', auth(f))
    .set('Idempotency-Key', key)
    .send({ planId, paymentMethod: 'bank_transfer' });
async function admin() {
  const f = await businessFixture();
  await db.userRoles.upsert({
    where: { id: 1 },
    create: { id: 1, title: 'Super administrator' },
    update: {},
  });
  await db.users.update({ where: { id: f.userId }, data: { userRolesId: 1 } });
  return f;
}
async function receipt(f: Fixture) {
  return db.nativeMedia.create({
    data: {
      vendorId: f.vendorId,
      ownerId: f.userId,
      path: `${f.vendorId}/test-receipt.pdf`,
      mimeType: 'application/pdf',
      size: 12,
      originalName: 'receipt.pdf',
    },
  });
}
const submit = (f: Fixture, id: number, receiptId: string, reference = randomUUID()) =>
  request(app)
    .post(`${base(f)}/${id}/submit`)
    .set('Authorization', auth(f))
    .send({ receiptId, transactionReference: reference });
const review = (a: Fixture, f: Fixture, id: number, action = 'approve', body: any = {}) =>
  request(app)
    .post(`/api/v1/admin/vendors/${f.vendorId}/billing/manual/${id}/${action}`)
    .set('Authorization', auth(a))
    .send(body);
async function pending(f: Fixture) {
  const q = await quote(f);
  expect(q.status).toBe(201);
  const r = await receipt(f);
  expect((await submit(f, q.body.id, r.id)).status).toBe(200);
  return q.body.id as number;
}
describe('manual subscription payments and invoices', () => {
  it('calculates immutable prices from opted-in server plans and replays the quote key', async () => {
    const f = await businessFixture(),
      key = randomUUID(),
      q = await quote(f, key);
    expect(q.status).toBe(201);
    expect(q.body.amountMinor).toBe(120000);
    expect(q.body.status).toBe('initiated');
    expect(q.body.currency).toBe('INR');
    expect((await quote(f, key)).body).toEqual(q.body);
    expect(
      (
        await db.manualSubscriptions.findUniqueOrThrow({ where: { id: q.body.id } })
      ).charges?.toString(),
    ).toBe('1200');
    expect((await quote(f, randomUUID(), 'automatic')).status).toBe(400);
    expect((await quote(f, key, 'automatic')).status).toBe(409);
    expect(await baseSubscriptionActive(f.vendorId)).toBe(false);
  });
  it('requires owner access and rejects client amounts and unsupported plans', async () => {
    const f = await businessFixture(),
      agent = await businessFixture(['administrative']);
    expect((await quote(agent)).status).toBe(403);
    expect(
      (
        await request(app)
          .post(`${base(f)}/quote`)
          .set('Authorization', auth(f))
          .send({ planId: 'manual_pro', paymentMethod: 'bank_transfer' })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post(`${base(f)}/quote`)
          .set('Authorization', auth(f))
          .set('Idempotency-Key', randomUUID())
          .send({ planId: 'manual_pro', paymentMethod: 'bank_transfer', amountMinor: 1 })
      ).status,
    ).toBe(400);
    expect((await quote(f, randomUUID(), 'unknown')).status).toBe(400);
  });
  it('validates own receipts, quote freshness and prevents transaction-reference reuse', async () => {
    const f = await businessFixture(),
      other = await businessFixture(),
      q = await quote(f),
      own = await receipt(f),
      foreign = await receipt(other);
    expect((await submit(f, q.body.id, foreign.id)).status).toBe(400);
    const reference = randomUUID();
    expect((await submit(f, q.body.id, own.id, reference)).status).toBe(200);
    expect((await submit(f, q.body.id, own.id, reference)).status).toBe(200);
    expect((await submit(f, q.body.id, own.id, randomUUID())).status).toBe(409);
    expect((await quote(f)).status).toBe(409);
    const otherQuote = await quote(other);
    expect((await submit(other, otherQuote.body.id, foreign.id, reference)).status).toBe(409);
    expect(await baseSubscriptionActive(f.vendorId)).toBe(false);
  });
  it('rejects expired quotes and foreign rows and serializes simultaneous submissions', async () => {
    const f = await businessFixture(),
      other = await businessFixture(),
      q = await quote(f),
      r = await receipt(f);
    expect((await submit(other, q.body.id, r.id)).status).toBe(404);
    const responses = await Promise.all([submit(f, q.body.id, r.id), submit(f, q.body.id, r.id)]);
    expect(responses.map((x) => x.status).sort()).toEqual([200, 409]);
    const expired = await quote(other),
      row = await db.manualSubscriptions.findUniqueOrThrow({ where: { id: expired.body.id } });
    await db.manualSubscriptions.update({
      where: { id: row.id },
      data: {
        data: {
          ...(row.data as any),
          nativeManual: { ...(row.data as any).nativeManual, expiresAt: 0 },
        },
      },
    });
    expect((await submit(other, row.id, (await receipt(other)).id)).status).toBe(409);
  });
  it('approves once with server dates, creates a private immutable invoice and produces PDF', async () => {
    const f = await businessFixture(),
      a = await admin(),
      id = await pending(f);
    expect((await review(f, f, id)).status).toBe(403);
    expect(
      (await review(a, f, id, 'approve', { endsAt: new Date(Date.now() + 3600000).toISOString() }))
        .status,
    ).toBe(400);
    const results = await Promise.all([review(a, f, id), review(a, f, id)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await baseSubscriptionActive(f.vendorId)).toBe(true);
    const row = await db.manualSubscriptions.findUniqueOrThrow({ where: { id } }),
      snapshot = (row.data as any).invoice;
    expect(snapshot.amountMinor).toBe(120000);
    expect(snapshot.paid).toBe(true);
    expect(new Date(snapshot.periodEndsAt).getTime()).toBeGreaterThan(Date.now() + 27 * 86400000);
    expect(
      (
        await request(app)
          .get(`${base(f)}/${id}/invoice`)
          .set('Authorization', auth(f))
      ).body,
    ).toEqual(snapshot);
    await db.vendors.update({ where: { id: f.vendorId }, data: { title: 'Changed business' } });
    expect(
      (
        await request(app)
          .get(`${base(f)}/${id}/invoice`)
          .set('Authorization', auth(f))
      ).body.businessName,
    ).toBe(snapshot.businessName);
    const pdf = await request(app)
      .get(`${base(f)}/${id}/invoice.pdf`)
      .set('Authorization', auth(f));
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(Buffer.from(pdf.body).subarray(0, 5).toString()).toBe('%PDF-');
    const other = await businessFixture();
    expect(
      (
        await request(app)
          .get(`${base(other)}/${id}/invoice`)
          .set('Authorization', auth(other))
      ).status,
    ).toBe(404);
  });
  it('carries native same-currency remaining value, supersedes the previous plan and retains invoices', async () => {
    const f = await businessFixture(),
      a = await admin(),
      first = await pending(f);
    expect((await review(a, f, first)).status).toBe(200);
    const second = await quote(f);
    expect(second.body.creditSubscriptionId).toBeUndefined();
    expect(second.body.creditMinor).toBeGreaterThan(119000);
    expect(second.body.creditDays).toBeGreaterThanOrEqual(29);
    expect((await submit(f, second.body.id, (await receipt(f)).id)).status).toBe(200);
    expect((await review(a, f, second.body.id)).status).toBe(200);
    expect((await db.manualSubscriptions.findUniqueOrThrow({ where: { id: first } })).status).toBe(
      'superseded',
    );
    expect(
      await db.manualSubscriptions.count({ where: { vendorId: f.vendorId, status: 'active' } }),
    ).toBe(1);
    expect(
      (
        await request(app)
          .get(`${base(f)}/${first}/invoice`)
          .set('Authorization', auth(f))
      ).status,
    ).toBe(200);
  });
  it('rejects unverified legacy balances, changed active plans and provider checkout conflicts', async () => {
    const f = await businessFixture();
    await db.manualSubscriptions.create({
      data: {
        vendorId: f.vendorId,
        status: 'active',
        charges: '100',
        endsAt: new Date(Date.now() + 86400000),
      },
    });
    expect((await quote(f)).body.error.code).toBe('MANUAL_BALANCE_UNVERIFIED');
    const other = await businessFixture();
    await db.nativeIdempotency.create({
      data: {
        vendorId: other.vendorId,
        key: `stripe:checkout:${randomUUID()}`,
        requestHash: 'test',
        response: { state: 'uncertain' },
      },
    });
    expect((await quote(other)).body.error.code).toBe('CHECKOUT_EXISTS');
    const a = await admin(),
      changed = await businessFixture(),
      id = await pending(changed);
    await db.manualSubscriptions.create({
      data: {
        vendorId: changed.vendorId,
        status: 'active',
        endsAt: new Date(Date.now() + 86400000),
      },
    });
    expect((await review(a, changed, id)).body.error.code).toBe('MANUAL_BALANCE_CHANGED');
  });
  it('rejects or cancels pending requests without granting entitlement or releasing used reference', async () => {
    const f = await businessFixture(),
      a = await admin(),
      id = await pending(f);
    expect((await review(a, f, id, 'reject', { reason: 'Payment not received' })).status).toBe(200);
    expect(await baseSubscriptionActive(f.vendorId)).toBe(false);
    expect(
      (
        await request(app)
          .get(`${base(f)}/${id}/invoice`)
          .set('Authorization', auth(f))
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .get(`${base(f)}/${id}`)
          .set('Authorization', auth(f))
      ).body.rejectionReason,
    ).toBe('Payment not received');
    const q = await quote(f);
    expect(
      (
        await request(app)
          .post(`${base(f)}/${q.body.id}/cancel`)
          .set('Authorization', auth(f))
          .send({})
      ).status,
    ).toBe(200);
    expect((await submit(f, q.body.id, (await receipt(f)).id)).status).toBe(409);
  });
  it('uses calendar month and leap-year boundaries', () => {
    expect(manualPeriod(new Date('2026-01-31T12:00:00Z'), 1).toISOString()).toBe(
      '2026-02-28T12:00:00.000Z',
    );
    expect(manualPeriod(new Date('2024-02-29T12:00:00Z'), 12).toISOString()).toBe(
      '2025-02-28T12:00:00.000Z',
    );
    expect(manualPeriod(new Date('2026-01-01T12:00:00Z'), 6, 2).toISOString()).toBe(
      '2026-07-03T12:00:00.000Z',
    );
  });
  it('blocks competing Stripe checkout before provider effects while a manual quote is open', async () => {
    const f = await businessFixture();
    await quote(f);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_manual_isolation');
    const r = await request(app)
      .post(`/api/v1/vendors/${f.vendorId}/billing/checkout`)
      .set('Authorization', auth(f))
      .set('Idempotency-Key', randomUUID())
      .send({ planId: 'automatic' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('MANUAL_SUBSCRIPTION_EXISTS');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('restricts receipt review to central administration and handles missing files without exposing paths', async () => {
    const f = await businessFixture(),
      a = await admin(),
      other = await businessFixture(),
      id = await pending(f);
    const get = (who: Fixture, vendorId = f.vendorId) =>
      request(app)
        .get(`/api/v1/admin/vendors/${vendorId}/billing/manual/${id}/receipt`)
        .set('Authorization', auth(who));
    expect((await get(f)).status).toBe(403);
    expect((await get(a, other.vendorId)).status).toBe(404);
    const missing = await get(a);
    expect(missing.status).toBe(404);
    expect(JSON.stringify(missing.body)).not.toContain('test-receipt.pdf');
  });
});
