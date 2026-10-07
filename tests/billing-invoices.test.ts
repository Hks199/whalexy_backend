import request from 'supertest';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { businessFixture } from './fixtures.js';
const app = createApp();
afterAll(() => db.$disconnect());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
async function fixture() {
  const f = await businessFixture(),
    customer = `cus_invoice${f.vendorId}`;
  await db.vendors.update({ where: { id: f.vendorId }, data: { stripeId: customer } });
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_invoices');
  return { ...f, customer };
}
describe('customer-scoped invoice pagination', () => {
  it('encodes the current customer and cursor on a fixed host and returns resumable pages', async () => {
    const f = await fixture();
    const fetch = vi.fn(async (url: URL) => {
      expect(url.origin).toBe('https://api.stripe.com');
      expect(url.pathname).toBe('/v1/invoices');
      expect(url.searchParams.get('customer')).toBe(f.customer);
      expect(url.searchParams.get('limit')).toBe('1');
      const after = url.searchParams.get('starting_after');
      return new Response(
        JSON.stringify({
          data: [
            {
              id: after ? 'in_second' : 'in_first',
              customer: f.customer,
              status: 'paid',
              total: 100,
              currency: 'inr',
              paid: true,
            },
          ],
          has_more: !after,
        }),
      );
    });
    vi.stubGlobal('fetch', fetch);
    const get = (after?: string) =>
      request(app)
        .get(`/api/v1/vendors/${f.vendorId}/billing/invoices`)
        .set('Authorization', `Bearer ${f.token}`)
        .query({ limit: 1, ...(after ? { startingAfter: after } : {}) });
    const first = await get();
    expect(first.status).toBe(200);
    expect(first.body.nextCursor).toBe('in_first');
    expect(first.body.hasMore).toBe(true);
    const second = await get(first.body.nextCursor);
    expect(second.body.items[0].id).toBe('in_second');
    expect(second.body.nextCursor).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('rejects foreign customers, repeated cursors and malformed provider lists', async () => {
    const f = await fixture();
    let value: any = { data: [{ id: 'in_foreign', customer: 'cus_other' }], has_more: false };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(value))),
    );
    const get = () =>
      request(app)
        .get(`/api/v1/vendors/${f.vendorId}/billing/invoices?startingAfter=in_repeat`)
        .set('Authorization', `Bearer ${f.token}`);
    expect((await get()).status).toBe(502);
    value = { data: [{ id: 'in_repeat', customer: f.customer }], has_more: true };
    expect((await get()).body.error.code).toBe('PROVIDER_PAGINATION');
    value = { data: [], has_more: true };
    expect((await get()).status).toBe(502);
  });
  it('rejects invalid user cursors and limits before calling the provider', async () => {
    const f = await fixture(),
      fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const get = (query: any) =>
      request(app)
        .get(`/api/v1/vendors/${f.vendorId}/billing/invoices`)
        .set('Authorization', `Bearer ${f.token}`)
        .query(query);
    expect((await get({ startingAfter: 'https://attacker.example' })).status).toBe(400);
    expect((await get({ limit: 101 })).status).toBe(400);
    expect((await get({ customer: 'cus_other' })).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
});
