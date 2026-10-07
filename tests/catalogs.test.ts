import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { encrypt } from '../src/utils/crypto.js';
import { businessFixture } from './fixtures.js';
import { processJob } from '../src/jobs/dispatcher.js';
import { parseCatalogPrice } from '../src/modules/catalogs/services/catalogs-support.service.js';
const app = createApp();
afterAll(() => db.$disconnect());
afterEach(() => vi.unstubAllGlobals());
async function fixture() {
  const f = await businessFixture(),
    phone = `7711${f.vendorId}`,
    waba = `7722${f.vendorId}`,
    business = `7733${f.vendorId}`,
    external = `7744${f.vendorId}`;
  await db.integrationCredentials.create({
    data: {
      vendorId: f.vendorId,
      provider: 'whatsapp',
      externalId: phone,
      secret: encrypt('private-catalog-provider-token'),
      metadata: { wabaId: waba },
    },
  });
  return { ...f, phone, waba, business, external };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const base = (f: Fixture) => `/api/v1/vendors/${f.vendorId}/catalogs`;
const auth = (f: Fixture) => `Bearer ${f.token}`;
function product(f: Fixture, id = '1', sku = 'SKU-1') {
  return {
    id: `7755${f.vendorId}${id}`,
    retailer_id: sku,
    name: `Product ${id}`,
    description: 'A product',
    availability: 'in stock',
    condition: 'new',
    price: '12.99 USD',
    currency: 'USD',
    url: 'https://store.example.com/product',
    image_url: 'https://store.example.com/image.jpg',
    brand: 'Acme',
  };
}
function provider(f: Fixture) {
  const state = {
    owner: true,
    linked: true,
    rows: [product(f)],
    pages: null as any[] | null,
    repeated: false,
    publishCount: 0,
    messageCount: 0,
    lost: false,
    publishedId: `7766${f.vendorId}`,
  };
  const fetch = vi.fn(async (url: URL, init: RequestInit = {}) => {
    expect(url.hostname).toBe('graph.facebook.com');
    expect(String((init.headers as any)?.Authorization)).toBe(
      'Bearer private-catalog-provider-token',
    );
    expect(url.searchParams.has('access_token')).toBe(false);
    let value: any;
    if (url.pathname.endsWith('/phone_numbers')) value = { data: [{ id: f.phone }] };
    else if (url.pathname.endsWith('/owned_product_catalogs'))
      value = { data: state.owner ? [{ id: f.external }] : [] };
    else if (url.pathname.endsWith('/product_catalogs'))
      value = { data: state.linked ? [{ id: f.external }] : [] };
    else if (url.pathname.endsWith(`/${f.external}/products`)) {
      if (init.method === 'POST') {
        state.publishCount++;
        expect(new URLSearchParams(String(init.body)).get('price')).toBe('1299');
        expect(new URLSearchParams(String(init.body)).get('availability')).toBe('in stock');
        if (state.lost) throw Error('lost provider result');
        value = { id: state.publishedId };
      } else {
        if (state.pages) {
          const after = url.searchParams.get('after'),
            index = after ? (after === 'repeat' ? 1 : Number(after)) : 0;
          value = {
            data: state.pages[index],
            ...(index < state.pages.length - 1
              ? {
                  paging: {
                    next: 'https://attacker.example/credentials',
                    cursors: { after: state.repeated ? 'repeat' : String(index + 1) },
                  },
                }
              : {}),
          };
        } else value = { data: state.rows };
      }
    } else if (url.pathname.endsWith(`/${f.phone}/messages`)) {
      state.messageCount++;
      value = { messages: [{ id: `wamid.${randomUUID()}` }] };
    } else if (url.pathname.endsWith(`/${state.publishedId}`)) {
      value =
        init.method === 'POST'
          ? { success: true }
          : { id: state.publishedId, retailer_id: 'SKU-NEW', product_catalog: { id: f.external } };
      if (init.method === 'POST') state.publishCount++;
    } else if (url.pathname.endsWith(`/${f.external}`))
      value = { id: f.external, name: 'Native catalog' };
    else throw Error('Unexpected provider path');
    return new Response(JSON.stringify(value));
  });
  vi.stubGlobal('fetch', fetch);
  return { state, fetch };
}
const connect = (f: Fixture) =>
  request(app)
    .post(`${base(f)}/connect`)
    .set('Authorization', auth(f))
    .send({
      businessId: f.business,
      catalogIdExternal: f.external,
      phoneNumberId: f.phone,
      currency: 'USD',
    });
async function connected(f: Fixture) {
  const r = await connect(f);
  expect(r.status).toBe(201);
  return r.body.id as number;
}
const sync = (f: Fixture, id: number, maxPages = 50) =>
  request(app)
    .post(`${base(f)}/${id}/sync`)
    .set('Authorization', auth(f))
    .send({ maxPages });
async function contact(f: Fixture) {
  const c = await db.contacts.create({
    data: {
      vendorId: f.vendorId,
      waId: '919876543210',
      platform: 'whatsapp',
      wabPhoneNumberId: f.phone,
    },
  });
  await db.whatsappMessageLogs.create({
    data: {
      vendorId: f.vendorId,
      contactId: c.id,
      contactWaId: c.waId,
      wabPhoneNumberId: f.phone,
      type: 'text',
      message: 'Show products',
      isIncomingMessage: true,
      messagedAt: new Date(),
    },
  });
  return c;
}
const send = (
  f: Fixture,
  contactId: number,
  catalogId: number,
  productIds: number[],
  mode = 'single',
  key = randomUUID(),
) =>
  request(app)
    .post(`/api/v1/vendors/${f.vendorId}/messages/send`)
    .set('Authorization', auth(f))
    .set('Idempotency-Key', key)
    .send({
      contactId,
      phoneNumberId: f.phone,
      kind: 'catalog',
      catalog: { catalogId, mode, productIds, body: 'Browse products' },
    });
const input = {
  name: 'Published item',
  sku: 'SKU-NEW',
  description: 'Product description',
  price: '12.99',
  currency: 'USD',
  availability: 'in_stock',
  condition: 'new',
  customUrl: 'https://store.example.com/new',
  primaryImageUrl: 'https://store.example.com/new.jpg',
  brand: 'Acme',
};
describe('native Meta catalogs', () => {
  it('proves business and WABA ownership and stores credentials outside legacy plaintext columns', async () => {
    const f = await fixture(),
      r = provider(f);
    r.state.owner = false;
    expect((await connect(f)).status).toBe(403);
    r.state.owner = true;
    r.state.linked = false;
    expect((await connect(f)).status).toBe(409);
    r.state.linked = true;
    const id = await connected(f);
    expect(await connected(f)).toBe(id);
    const c = await db.catalogConnections.findFirstOrThrow({ where: { catalogId: id } });
    expect(c.accessToken).toBe('');
    const credential = await db.integrationCredentials.findFirstOrThrow({
      where: { vendorId: f.vendorId, provider: 'meta-catalog' },
    });
    expect(credential.secret).toMatch(/^v1\./);
    expect(
      JSON.stringify((await request(app).get(base(f)).set('Authorization', auth(f))).body),
    ).not.toContain('private-catalog-provider-token');
  });
  it('imports complete pages atomically, restores matches, archives absent mirrored items and keeps native drafts', async () => {
    const f = await fixture(),
      r = provider(f),
      id = await connected(f);
    r.state.pages = [[product(f)], [product(f, '2', 'SKU-2')]];
    expect((await sync(f, id)).body).toEqual({ created: 2, updated: 0, archived: 0, products: 2 });
    const products = await db.products.findMany({
      where: { catalogId: id },
      orderBy: { id: 'asc' },
    });
    expect(products[0].price.toString()).toBe('12.99');
    await db.products.update({ where: { id: products[0].id }, data: { deletedAt: new Date() } });
    await db.products.create({
      data: {
        vendorId: f.vendorId,
        catalogId: id,
        name: 'Draft',
        sku: 'DRAFT',
        slug: 'draft',
        price: 1,
      },
    });
    r.state.pages = null;
    expect((await sync(f, id)).body).toEqual({ created: 0, updated: 1, archived: 1, products: 1 });
    expect(
      (await db.products.findUniqueOrThrow({ where: { id: products[0].id } })).deletedAt,
    ).toBeNull();
    expect(
      (await db.products.findUniqueOrThrow({ where: { id: products[1].id } })).visibility,
    ).toBe('hidden');
    expect(
      (await db.products.findFirstOrThrow({ where: { catalogId: id, sku: 'DRAFT' } })).status,
    ).toBe('draft');
  });
  it('retains existing data on truncated pages, ambiguous prices, malformed rows or repeated cursors', async () => {
    const f = await fixture(),
      r = provider(f),
      id = await connected(f);
    await sync(f, id);
    const before = await db.products.findFirstOrThrow({ where: { catalogId: id } });
    r.state.pages = [[product(f, '2', 'SKU-2')], [product(f, '3', 'SKU-3')]];
    expect((await sync(f, id, 1)).body.error.code).toBe('CATALOG_SNAPSHOT_INCOMPLETE');
    expect(await db.products.count({ where: { catalogId: id } })).toBe(1);
    expect((await db.products.findUniqueOrThrow({ where: { id: before.id } })).status).toBe(
      'active',
    );
    r.state.pages = null;
    r.state.rows = [{ ...product(f), price: '1299' }];
    expect((await sync(f, id)).status).toBe(502);
    r.state.rows = [{ ...product(f), retailer_id: '' }];
    expect((await sync(f, id)).status).toBe(502);
    r.state.pages = [[product(f)], [product(f, '2', 'SKU-2')], [product(f, '3', 'SKU-3')]];
    r.state.repeated = true;
    expect((await sync(f, id)).body.error.code).toBe('PROVIDER_PAGINATION');
    expect(
      (await db.products.findUniqueOrThrow({ where: { id: before.id } })).price.toString(),
    ).toBe('12.99');
    expect(() => parseCatalogPrice('12.99 EUR', 'USD')).toThrow();
  });
  it('queues correct single, multiple and catalog formats and replays without duplicate delivery', async () => {
    const f = await fixture(),
      r = provider(f),
      id = await connected(f);
    await sync(f, id);
    const p = await db.products.findFirstOrThrow({ where: { catalogId: id } }),
      c = await contact(f),
      key = randomUUID();
    expect((await send(f, c.id, id, [p.id], 'single', key)).status).toBe(202);
    expect((await send(f, c.id, id, [p.id], 'single', key)).status).toBe(202);
    expect((await send(f, c.id, id, [p.id], 'multiple')).status).toBe(202);
    expect((await send(f, c.id, id, [], 'catalog')).status).toBe(202);
    const jobs = await db.outboxJobs.findMany({
      where: { vendorId: f.vendorId, kind: 'whatsapp-send' },
    });
    expect(jobs).toHaveLength(3);
    expect(jobs.map((j) => (j.payload as any).payload.interactive.type).sort()).toEqual([
      'catalog_message',
      'product',
      'product_list',
    ]);
    for (const job of jobs) {
      await processJob(job);
      await processJob(job);
    }
    expect(r.state.messageCount).toBe(3);
  });
  it('rejects unowned products, incorrect cardinality and sends outside the customer window', async () => {
    const f = await fixture(),
      r = provider(f),
      id = await connected(f);
    await sync(f, id);
    const c = await contact(f),
      p = await db.products.findFirstOrThrow({ where: { catalogId: id } });
    expect((await send(f, c.id, id, [99999999])).status).toBe(400);
    expect((await send(f, c.id, id, [])).status).toBe(400);
    expect((await send(f, c.id, id, [p.id, p.id])).status).toBe(400);
    r.state.linked = false;
    expect((await send(f, c.id, id, [p.id])).status).toBe(409);
    r.state.linked = true;
    await db.whatsappMessageLogs.updateMany({
      where: { vendorId: f.vendorId },
      data: { messagedAt: new Date(0) },
    });
    expect((await send(f, c.id, id, [p.id])).body.error.code).toBe('TEMPLATE_REQUIRED');
  });
  it('cancels stale product messages and disconnected catalogs before dispatch', async () => {
    const f = await fixture(),
      r = provider(f),
      id = await connected(f);
    await sync(f, id);
    const c = await contact(f),
      p = await db.products.findFirstOrThrow({ where: { catalogId: id } });
    await send(f, c.id, id, [p.id]);
    let job = await db.outboxJobs.findFirstOrThrow({
      where: { vendorId: f.vendorId, kind: 'whatsapp-send' },
    });
    await db.products.update({
      where: { id: p.id },
      data: { visibility: 'hidden', updatedAt: new Date() },
    });
    await processJob(job);
    expect(
      (
        await db.whatsappMessageLogs.findUniqueOrThrow({
          where: { id: (job.payload as any).messageId },
        })
      ).status,
    ).toBe('cancelled');
    await send(f, c.id, id, [], 'catalog');
    job = await db.outboxJobs.findFirstOrThrow({
      where: { vendorId: f.vendorId, kind: 'whatsapp-send' },
      orderBy: { createdAt: 'desc' },
    });
    expect(
      (
        await request(app)
          .delete(`${base(f)}/${id}/connection`)
          .set('Authorization', auth(f))
      ).status,
    ).toBe(204);
    await processJob(job);
    expect(
      (
        await db.whatsappMessageLogs.findUniqueOrThrow({
          where: { id: (job.payload as any).messageId },
        })
      ).status,
    ).toBe('cancelled');
    expect(r.state.messageCount).toBe(0);
  });
  it('creates local drafts, publishes a provider product once and validates updates and price precision', async () => {
    const f = await fixture(),
      r = provider(f),
      id = await connected(f);
    const create = await request(app)
      .post(`${base(f)}/${id}/products`)
      .set('Authorization', auth(f))
      .send(input);
    expect(create.status).toBe(201);
    const productId = create.body.id,
      key = randomUUID(),
      publish = (k = key) =>
        request(app)
          .post(`${base(f)}/${id}/products/${productId}/publish`)
          .set('Authorization', auth(f))
          .set('Idempotency-Key', k)
          .send({});
    expect((await publish()).status).toBe(200);
    expect((await publish()).body.metaProductId).toBe(r.state.publishedId);
    expect(r.state.publishCount).toBe(1);
    const update = (value: any) =>
      request(app)
        .put(`${base(f)}/${id}/products/${productId}`)
        .set('Authorization', auth(f))
        .send(value);
    expect((await update({ ...input, sku: 'CHANGED' })).status).toBe(409);
    expect((await update({ ...input, name: 'Edited' })).status).toBe(200);
    expect((await publish(randomUUID())).status).toBe(200);
    expect(r.state.publishCount).toBe(2);
    await update({ ...input, price: '1.001' });
    expect((await publish(randomUUID())).status).toBe(400);
  });
  it('blocks duplicate creation after uncertain product publishing', async () => {
    const f = await fixture(),
      r = provider(f),
      id = await connected(f);
    const created = await request(app)
      .post(`${base(f)}/${id}/products`)
      .set('Authorization', auth(f))
      .send(input);
    r.state.lost = true;
    const publish = () =>
      request(app)
        .post(`${base(f)}/${id}/products/${created.body.id}/publish`)
        .set('Authorization', auth(f))
        .set('Idempotency-Key', randomUUID())
        .send({});
    expect((await publish()).body.error.code).toBe('PROVIDER_UNCERTAIN');
    expect((await publish()).status).toBe(409);
    expect(r.state.publishCount).toBe(1);
    expect(
      (await db.products.findUniqueOrThrow({ where: { id: created.body.id } })).metaProductId,
    ).toBeNull();
  });
  it('blocks another business from claiming an existing catalog and rejects agents without catalog access', async () => {
    const f = await fixture();
    provider(f);
    await connected(f);
    const other = { ...(await fixture()), external: f.external };
    provider(other);
    expect(
      (
        await request(app)
          .post(`${base(other)}/connect`)
          .set('Authorization', auth(other))
          .send({
            businessId: other.business,
            catalogIdExternal: f.external,
            phoneNumberId: other.phone,
          })
      ).status,
    ).toBe(409);
    const agent = await businessFixture(['vendor.chats.reply']);
    expect(
      (
        await request(app)
          .get(`/api/v1/vendors/${agent.vendorId}/catalogs`)
          .set('Authorization', `Bearer ${agent.token}`)
      ).status,
    ).toBe(403);
  });
});
