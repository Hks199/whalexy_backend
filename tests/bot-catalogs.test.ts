import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { encrypt } from '../src/utils/crypto.js';
import { ingestMeta } from '../src/jobs/handlers/meta-webhook.handler.js';
import { processJob } from '../src/jobs/dispatcher.js';
import { resumeGraphFlow } from '../src/modules/bot-flows/services/bot-graph-runtime.js';
import { validateGraph } from '../src/modules/bot-flows/services/graph-schema.validation.js';
import { businessFixture } from './fixtures.js';
const app = createApp();
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => db.$disconnect());
async function fixture() {
  const f = await businessFixture(),
    phone = `8855${f.vendorId}`,
    waba = `8866${f.vendorId}`,
    external = `8877${f.vendorId}`,
    business = `8888${f.vendorId}`;
  await db.integrationCredentials.create({
    data: {
      vendorId: f.vendorId,
      provider: 'whatsapp',
      externalId: phone,
      secret: encrypt('test-catalog-token'),
      metadata: { wabaId: waba },
    },
  });
  const state = {
    linked: true,
    duringRead: undefined as (() => Promise<void>) | undefined,
    malformed: false,
    sends: 0,
  };
  const fetch = vi.fn(async (url: URL, init: RequestInit = {}) => {
    expect(url.hostname).toBe('graph.facebook.com');
    let value: any;
    if (url.pathname.endsWith('/phone_numbers')) value = { data: [{ id: phone }] };
    else if (url.pathname.endsWith('/owned_product_catalogs')) value = { data: [{ id: external }] };
    else if (url.pathname.endsWith('/product_catalogs')) {
      if (state.duringRead) {
        const run = state.duringRead;
        state.duringRead = undefined;
        await run();
      }
      value = state.malformed
        ? { data: 'invalid' }
        : { data: state.linked ? [{ id: external }] : [] };
    } else if (url.pathname.endsWith(`/${external}/products`))
      value = {
        data: [1, 2].map((i) => ({
          id: `8899${f.vendorId}${i}`,
          retailer_id: `SKU-${i}`,
          name: `Product ${i}`,
          currency: 'USD',
          price: '12.99 USD',
          availability: 'in stock',
          condition: 'new',
        })),
      };
    else if (url.pathname.endsWith(`/${phone}/messages`)) {
      state.sends++;
      value = { messages: [{ id: `wamid.${randomUUID()}` }] };
      expect(JSON.parse(String(init.body)).nativeCatalog).toBeUndefined();
    } else if (url.pathname.endsWith(`/${external}`))
      value = { id: external, name: 'Test catalog' };
    else throw Error('Unexpected path');
    return new Response(JSON.stringify(value));
  });
  vi.stubGlobal('fetch', fetch);
  const prefix = `/api/v1/vendors/${f.vendorId}`,
    auth = `Bearer ${f.token}`;
  const connected = await request(app)
    .post(`${prefix}/catalogs/connect`)
    .set('Authorization', auth)
    .send({ phoneNumberId: phone, businessId: business, catalogIdExternal: external });
  expect(connected.status).toBe(201);
  const catalogId = connected.body.id as number;
  expect(
    (
      await request(app)
        .post(`${prefix}/catalogs/${catalogId}/sync`)
        .set('Authorization', auth)
        .send({})
    ).status,
  ).toBe(200);
  const products = await db.products.findMany({ where: { catalogId }, orderBy: { id: 'asc' } });
  const contact = await db.contacts.create({
    data: {
      vendorId: f.vendorId,
      waId: `9177${String(f.vendorId).padStart(7, '0')}`,
      firstName: 'Jane',
      wabPhoneNumberId: phone,
    },
  });
  fetch.mockClear();
  return { ...f, phone, external, waba, state, fetch, prefix, auth, catalogId, products, contact };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function graph(f: Fixture, mode = 'single') {
  return {
    start_node: 'catalog',
    nodes: [
      {
        id: 'catalog',
        type: 'catalog',
        payload: {
          catalog_id: f.catalogId,
          mode,
          product_ids:
            mode === 'catalog'
              ? []
              : mode === 'single'
                ? [f.products[0].id]
                : [f.products[1].id, f.products[0].id],
          body: 'Browse {first_name}',
        },
        next_node: 'question',
      },
      {
        id: 'question',
        type: 'question',
        payload: { text: 'Anything else?', variable_name: 'answer' },
        next_node: null,
      },
    ],
  };
}
const create = (f: Fixture, g: any = graph(f)) =>
  request(app).post(`${f.prefix}/bot-flows`).set('Authorization', f.auth).send({
    title: 'Catalog graph',
    enabled: true,
    triggerType: 'is',
    startTrigger: 'hello',
    phoneNumberId: f.phone,
    graph: g,
  });
const inbound = (f: Fixture, text = 'hello') => ({
  entry: [
    {
      changes: [
        {
          value: {
            metadata: { phone_number_id: f.phone },
            messages: [
              {
                id: randomUUID(),
                from: f.contact.waId,
                timestamp: String(Math.floor(Date.now() / 1000)),
                type: 'text',
                text: { body: text },
              },
            ],
          },
        },
      ],
    },
  ],
});
const queue = (f: Fixture) =>
  db.outboxJobs.findMany({
    where: { vendorId: f.vendorId, kind: 'whatsapp-send' },
    orderBy: { createdAt: 'asc' },
  });
describe('native graph catalog messages', () => {
  for (const mode of ['single', 'multiple', 'catalog'])
    it(`queues and dispatches ${mode} catalog content once without provider reads during intake`, async () => {
      const f = await fixture();
      expect((await create(f, graph(f, mode))).status).toBe(201);
      const event = inbound(f);
      await Promise.all([ingestMeta(event), ingestMeta(event)]);
      expect(f.fetch).not.toHaveBeenCalled();
      const jobs = await queue(f);
      expect(jobs).toHaveLength(2);
      const p = jobs[0].payload as any;
      expect(p.payload.interactive.body.text).toBe('Browse Jane');
      expect(p.nativeCatalog.verifyRemoteLink).toBe(true);
      expect(p.payload.nativeCatalog).toBeUndefined();
      expect(p.payload.interactive.type).toBe(
        mode === 'single' ? 'product' : mode === 'multiple' ? 'product_list' : 'catalog_message',
      );
      if (mode === 'multiple')
        expect(
          p.payload.interactive.action.sections[0].product_items.map(
            (item: any) => item.product_retailer_id,
          ),
        ).toEqual(['SKU-2', 'SKU-1']);
      await processJob(jobs[0]);
      await processJob(jobs[0]);
      expect(f.state.sends).toBe(1);
      expect(
        (await db.userActiveFlows.findFirstOrThrow({ where: { flowId: p.botFlowId } }))
          .currentNodeUid,
      ).toBe('question');
    });
  it('rejects invalid cardinality, duplicate products, oversized sets and automatic cycles', async () => {
    const f = await fixture();
    for (const [mode, ids] of [
      ['single', []],
      ['catalog', [f.products[0].id]],
      ['multiple', []],
      ['multiple', [f.products[0].id, f.products[0].id]],
      ['multiple', Array.from({ length: 31 }, (_, i) => i + 1)],
    ] as [string, number[]][]) {
      const g = graph(f);
      g.nodes[0].payload.mode = mode;
      g.nodes[0].payload.product_ids = ids;
      expect((await create(f, g)).status).toBe(400);
    }
    const g = graph(f);
    g.nodes[0].next_node = 'catalog';
    expect(() => validateGraph(g, true)).toThrow();
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it('rejects foreign catalog/product ownership and another sending number', async () => {
    const f = await fixture(),
      foreign = await fixture();
    const g = graph(f);
    g.nodes[0].payload.catalog_id = foreign.catalogId;
    expect((await create(f, g)).status).toBe(409);
    g.nodes[0].payload.catalog_id = f.catalogId;
    g.nodes[0].payload.product_ids = [foreign.products[0].id];
    expect((await create(f, g)).status).toBe(409);
    await db.catalogConnections.updateMany({
      where: { catalogId: f.catalogId },
      data: { phoneNumberId: foreign.phone },
    });
    expect((await create(f)).status).toBe(409);
  });
  it('keeps previews free of provider effects and blocks a changed product before advancing', async () => {
    const f = await fixture(),
      created = await create(f);
    expect(created.status).toBe(201);
    const preview = await request(app)
      .post(`${f.prefix}/bot-flows/${created.body.id}/preview`)
      .set('Authorization', f.auth)
      .send({});
    expect(preview.status).toBe(200);
    expect(preview.body.responses[0].messages[0].graphCatalog.catalog_id).toBe(f.catalogId);
    expect(await queue(f)).toHaveLength(0);
    expect(f.fetch).not.toHaveBeenCalled();
    await db.products.update({ where: { id: f.products[0].id }, data: { visibility: 'hidden' } });
    await ingestMeta(inbound(f));
    expect(await queue(f)).toHaveLength(0);
    expect(await db.userActiveFlows.count({ where: { flowId: created.body.id } })).toBe(0);
    expect(
      await db.outboxJobs.findFirst({ where: { vendorId: f.vendorId, kind: 'bot-flow-blocked' } }),
    ).toMatchObject({ lastError: 'GRAPH_CATALOG_PRODUCTS_UNAVAILABLE' });
  });
  for (const change of ['product', 'credential', 'phone', 'disconnect'])
    it(`cancels queued content after ${change} changes`, async () => {
      const f = await fixture();
      await create(f);
      await ingestMeta(inbound(f));
      if (change === 'product')
        await db.products.update({
          where: { id: f.products[0].id },
          data: { updatedAt: new Date(Date.now() + 1000) },
        });
      else if (change === 'disconnect')
        await db.catalogConnections.updateMany({
          where: { catalogId: f.catalogId },
          data: { syncStatus: 'disconnected' },
        });
      else
        await db.integrationCredentials.updateMany({
          where: {
            vendorId: f.vendorId,
            provider: change === 'phone' ? 'whatsapp' : 'meta-catalog',
          },
          data: { updatedAt: new Date(Date.now() + 1000) },
        });
      const job = (await queue(f))[0];
      await processJob(job);
      expect(f.state.sends).toBe(0);
      expect(
        (
          await db.whatsappMessageLogs.findUniqueOrThrow({
            where: { id: (job.payload as any).messageId },
          })
        ).status,
      ).toBe('cancelled');
    });
  it('verifies remote WABA linkage before dispatch and cancels after unlinking', async () => {
    const f = await fixture();
    await create(f);
    await ingestMeta(inbound(f));
    f.state.linked = false;
    await processJob((await queue(f))[0]);
    expect(f.state.sends).toBe(0);
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it('rechecks local product state after the remote read', async () => {
    const f = await fixture();
    await create(f);
    await ingestMeta(inbound(f));
    f.state.duringRead = async () => {
      await db.products.update({ where: { id: f.products[0].id }, data: { visibility: 'hidden' } });
    };
    await processJob((await queue(f))[0]);
    expect(f.state.sends).toBe(0);
  });
  it('retains failed remote verification without sending', async () => {
    const f = await fixture();
    await create(f);
    await ingestMeta(inbound(f));
    f.state.malformed = true;
    await expect(processJob((await queue(f))[0])).rejects.toMatchObject({
      code: 'PROVIDER_RESPONSE',
    });
    expect(f.state.sends).toBe(0);
  });
  it('resolves delayed catalog continuation exactly once using current product state', async () => {
    const f = await fixture(),
      g: any = graph(f);
    g.start_node = 'wait';
    g.nodes.unshift({ id: 'wait', type: 'wait', payload: { wait_time: 5 }, next_node: 'catalog' });
    await create(f, g);
    await ingestMeta(inbound(f));
    const job = await db.outboxJobs.findFirstOrThrow({
      where: { vendorId: f.vendorId, kind: 'bot-flow-resume' },
    });
    await db.products.update({ where: { id: f.products[0].id }, data: { visibility: 'hidden' } });
    await expect(
      resumeGraphFlow(job, new Date(job.availableAt.getTime() + 100)),
    ).rejects.toMatchObject({ code: 'GRAPH_CATALOG_PRODUCTS_UNAVAILABLE' });
    expect(await queue(f)).toHaveLength(1);
    await db.products.update({ where: { id: f.products[0].id }, data: { visibility: 'visible' } });
    await resumeGraphFlow(job, new Date(job.availableAt.getTime() + 100));
    await resumeGraphFlow(job, new Date(job.availableAt.getTime() + 100));
    expect(await queue(f)).toHaveLength(3);
    expect(f.fetch).not.toHaveBeenCalled();
  });
});
