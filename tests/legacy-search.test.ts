import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { businessFixture } from './fixtures.js';
const app = createApp(),
  contacts: number[] = [],
  orders: number[] = [],
  pages: number[] = [],
  posts: number[] = [];
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await db.whatsappOrders.deleteMany({ where: { id: { in: orders } } });
  await db.contacts.deleteMany({ where: { id: { in: contacts } } });
  await db.pages.deleteMany({ where: { id: { in: pages } } });
  await db.blogPosts.deleteMany({ where: { id: { in: posts } } });
  await db.$disconnect();
});
async function fixture(permissions = ['*']) {
  const f = await businessFixture(permissions);
  const get = (q = '', central = false, query = {}) =>
    request(app)
      .get((central ? '/central-console' : '/vendor-console') + '/global-search')
      .set('Authorization', `Bearer ${f.token}`)
      .set('X-Vendor-Id', String(f.vendorId))
      .query({ q, ...query });
  const contact = async (extra: any = {}) => {
    const row = await db.contacts.create({
      data: {
        vendorId: f.vendorId,
        firstName: 'Search customer',
        waId: '919876543210',
        data: { secret: 'private contact' },
        ...extra,
      },
    });
    contacts.push(row.id);
    return row;
  };
  const order = async (extra: any = {}) => {
    const row = await db.whatsappOrders.create({
      data: {
        vendorId: f.vendorId,
        orderId: randomUUID(),
        customerName: 'Search customer',
        customerPhone: '919876543210',
        items: [],
        totalAmount: '12.3456',
        data: { secret: 'private order' },
        ...extra,
      },
    });
    orders.push(row.id);
    return row;
  };
  return { ...f, get, contact, order };
}
describe('original central and vendor global search', () => {
  it('returns source result fields with scoped contacts and exact order amounts', async () => {
    const f = await fixture(),
      c = await f.contact(),
      o = await f.order();
    const r = await f.get('search');
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.body).toContainEqual({
      name: 'Search customer',
      path: 'Customer CRM / Contacts / Search customer',
      url: `/api/v1/vendors/${f.vendorId}/contacts/${c.id}`,
      type: 'contact',
      icon: 'fas fa-user',
      subtitle: '919876543210',
    });
    expect(r.body.find((x: any) => x.type === 'order').url).toBe(
      '/vendor-console/whatsapp-orders/' + o.uid,
    );
    expect(JSON.stringify(r.body)).toContain('12.3456');
    expect(JSON.stringify(r.body)).not.toMatch(/private contact|private order/);
    expect((await f.get()).body).toEqual([]);
  });
  it('uses current category permissions, assigned-contact visibility and phone privacy without search leaks', async () => {
    const f = await fixture([
        'vendor.dashboard.view',
        'vendor.contacts.view',
        'vendor.orders.manage',
      ]),
      a = await f.contact({ assignedUserId: f.userId }),
      other = await f.contact();
    await f.order();
    const r = await f.get('Search');
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(1);
    expect(r.body[0]).toMatchObject({
      type: 'contact',
      subtitle: '****3210',
      url: `/api/v1/vendors/${f.vendorId}/contacts/${a.id}`,
    });
    expect(JSON.stringify(r.body)).not.toContain(String(other.id) + '/');
    expect((await f.get('987654')).body).toEqual([]);
    const all = await fixture([
      'vendor.dashboard.view',
      'vendor.contacts.view',
      'vendor.orders.manage',
      'vendor.chats.view_all',
    ]);
    await all.contact();
    await all.order();
    expect((await all.get('Search')).body.map((x: any) => x.type)).toEqual(['contact', 'order']);
    expect((await all.get('987654')).body).toEqual([]);
  });
  it('excludes foreign orders and foreign imported contact references', async () => {
    const f = await fixture(),
      other = await fixture(),
      c = await other.contact();
    await other.order();
    await f.order({ contactId: c.id });
    await f.contact();
    const r = await f.get('Search');
    expect(r.body).toHaveLength(1);
    expect(r.body[0].type).toBe('contact');
  });
  it('bounds literal case-insensitive results and rejects unknown, oversized or control queries', async () => {
    const f = await fixture();
    for (let i = 0; i < 8; i++) await f.contact({ firstName: `Literal %_ marker ${i}` });
    await f.contact({ firstName: 'Unrelated' });
    const r = await f.get('%_');
    expect(r.body).toHaveLength(5);
    expect(r.body.every((x: any) => x.name.includes('%_'))).toBe(true);
    expect((await f.get('LITERAL')).body).toHaveLength(5);
    expect((await f.get('x'.repeat(101))).status).toBe(400);
    expect((await f.get('bad\nquery')).status).toBe(400);
    expect((await f.get('Search', false, { unknown: 'value' })).status).toBe(400);
  });
  it('returns supported central pages, blogs and configuration links without tenant pages or raw content', async () => {
    const f = await fixture();
    await db.userRoles.upsert({
      where: { id: 1 },
      create: { id: 1, title: 'Search administrator' },
      update: {},
    });
    await db.users.update({ where: { id: f.userId }, data: { userRolesId: 1 } });
    for (const extra of [
      { vendorId: null, type: 1 },
      { vendorId: f.vendorId, type: 1 },
      { vendorId: null, type: 2 },
    ]) {
      const p = await db.pages.create({
        data: {
          title: 'Central search marker',
          status: 0,
          slug: randomUUID().replaceAll('-', ''),
          content: 'Private content',
          ...extra,
        },
      });
      pages.push(p.id);
    }
    const p = await db.blogPosts.create({
      data: {
        title: 'Central search marker',
        slug: randomUUID(),
        excerpt: 'Private excerpt',
        content: 'Private content',
        authorId: f.userId,
        status: 'draft',
      },
    });
    posts.push(p.id);
    const r = await f.get('Central search', true);
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(2);
    expect(JSON.stringify(r.body)).not.toMatch(/Private content|Private excerpt/);
    expect((await f.get('General', true)).body).toContainEqual({
      name: 'General Settings',
      path: 'Configuration / General',
      url: '/central-console/configuration/general',
      type: 'page',
      icon: 'fas fa-cogs',
    });
    expect((await f.get('', true)).body).toEqual([]);
    expect((await (await fixture()).get('Central', true)).status).toBe(403);
  });
  it('rechecks current membership and site role inside search transactions', async () => {
    const f = await fixture(),
      original = db.$transaction.bind(db);
    vi.spyOn(db, '$transaction').mockImplementationOnce(((work: any, options: any) =>
      original(async (tx: any) => {
        await tx.nativeMemberships.update({
          where: { vendorId_userId: { vendorId: f.vendorId, userId: f.userId } },
          data: { permissions: [] },
        });
        return work(tx);
      }, options)) as any);
    expect((await f.get('Search')).status).toBe(403);
    vi.restoreAllMocks();
    await db.userRoles.upsert({
      where: { id: 1 },
      create: { id: 1, title: 'Search administrator' },
      update: {},
    });
    await db.users.update({ where: { id: f.userId }, data: { userRolesId: 1 } });
    vi.spyOn(db, '$transaction').mockImplementationOnce(((work: any, options: any) =>
      original(async (tx: any) => {
        await tx.users.update({ where: { id: f.userId }, data: { userRolesId: null } });
        return work(tx);
      }, options)) as any);
    expect((await f.get('General', true)).status).toBe(403);
  });
});
