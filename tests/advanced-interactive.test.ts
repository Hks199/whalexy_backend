import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { encrypt } from '../src/utils/crypto.js';
import { advanceGraph } from '../src/modules/bot-flows/services/graph-execution.service.js';
import { validateGraph } from '../src/modules/bot-flows/services/graph-schema.validation.js';
import { ingestMeta } from '../src/jobs/handlers/meta-webhook.handler.js';
import { processJob } from '../src/jobs/dispatcher.js';
import { businessFixture } from './fixtures.js';
const app = createApp();
afterAll(() => db.$disconnect());
afterEach(() => vi.unstubAllGlobals());
async function fixture() {
  const f = await businessFixture(),
    phone = `7766${f.vendorId}`;
  await db.integrationCredentials.create({
    data: {
      vendorId: f.vendorId,
      provider: 'whatsapp',
      externalId: phone,
      secret: encrypt('advanced-interactive-test'),
    },
  });
  const contact = await db.contacts.create({
    data: {
      vendorId: f.vendorId,
      waId: `9194${String(f.vendorId).padStart(7, '0')}`,
      platform: 'whatsapp',
      wabPhoneNumberId: phone,
      firstName: 'Customer',
    },
  });
  return {
    ...f,
    phone,
    contact,
    auth: `Bearer ${f.token}`,
    prefix: `/api/v1/vendors/${f.vendorId}`,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const value = (type: string): any =>
  type === 'cta_url'
    ? {
        type,
        body: 'Visit our store',
        cta: { title: 'Visit store', url: 'https://shop.whalexy.com/offers?source=chat#details' },
      }
    : { type, body: 'Please share your location' };
const types = ['cta_url', 'location_request_message'];
const send = (f: Fixture, interactive: any, key = randomUUID()) =>
  request(app)
    .post(`${f.prefix}/messages/send`)
    .set('Authorization', f.auth)
    .set('Idempotency-Key', key)
    .send({ contactId: f.contact.id, phoneNumberId: f.phone, kind: 'interactive', interactive });
const jobs = (f: Fixture) =>
  db.outboxJobs.findMany({
    where: { vendorId: f.vendorId, kind: 'whatsapp-send' },
    orderBy: { createdAt: 'asc' },
  });
const event = (f: Fixture, body: any = { type: 'text', text: { body: 'hello' } }) => ({
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
                ...body,
              },
            ],
          },
        },
      ],
    },
  ],
});
const remote = () => {
  const fetch = vi
    .fn()
    .mockImplementation(
      async () =>
        new Response(JSON.stringify({ messages: [{ id: `wamid.advanced.${randomUUID()}` }] })),
    );
  vi.stubGlobal('fetch', fetch);
  return fetch;
};
const graph = (overrides: any = {}) => ({
  start_node: 'link',
  nodes: [
    {
      id: 'link',
      type: 'interactive',
      payload: {
        text: 'Hello {first_name}',
        interactive_type: 'cta_url',
        button_display_text: 'Visit store',
        button_url: 'https://shop.whalexy.com/catalog#offers',
        ...overrides,
      },
      next_node: 'done',
    },
    { id: 'done', type: 'message', payload: { text: 'Ask us for help' }, next_node: null },
  ],
});
const save = (f: Fixture, g: any) =>
  request(app).post(`${f.prefix}/bot-flows`).set('Authorization', f.auth).send({
    title: 'CTA graph',
    enabled: true,
    triggerType: 'is',
    startTrigger: 'hello',
    phoneNumberId: f.phone,
    graph: g,
  });

describe('standalone CTA and location request adapters', () => {
  for (const type of types)
    it(`queues ${type} without choice proofs and delivers once`, async () => {
      const f = await fixture();
      await ingestMeta(event(f));
      const input = value(type),
        response = await send(f, input);
      expect(response.status).toBe(202);
      const job = (await jobs(f))[0],
        payload = (job.payload as any).payload;
      expect(payload).toMatchObject({
        to: f.contact.waId,
        type: 'interactive',
        interactive: {
          type,
          body: { text: input.body },
          action:
            type === 'cta_url'
              ? {
                  name: 'cta_url',
                  parameters: { display_text: input.cta.title, url: input.cta.url },
                }
              : { name: 'send_location' },
        },
      });
      expect(
        await db.nativeIdempotency.count({
          where: { vendorId: f.vendorId, key: { startsWith: 'interactive-choice:' } },
        }),
      ).toBe(0);
      const fetch = remote();
      await processJob(job);
      await processJob(job);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(JSON.parse(fetch.mock.calls[0][1].body).interactive).toEqual(payload.interactive);
      expect(
        (await db.whatsappMessageLogs.findUniqueOrThrow({ where: { id: response.body.id } }))
          .status,
      ).toBe('sent');
    });
  for (const type of types)
    it(`preserves ${type} idempotency and rejects changed requests`, async () => {
      const f = await fixture();
      await ingestMeta(event(f));
      const key = randomUUID(),
        input = value(type),
        first = await send(f, input, key);
      expect((await send(f, input, key)).body).toEqual(first.body);
      expect((await send(f, { ...input, body: 'Different body' }, key)).status).toBe(409);
      expect(await jobs(f)).toHaveLength(1);
    });
  for (const type of ['text', 'image', 'video', 'document'])
    it(`supports a ${type} CTA header and footer`, async () => {
      const f = await fixture();
      await ingestMeta(event(f));
      const header: any =
        type === 'text'
          ? { type, text: 'Our offer' }
          : {
              type,
              url: `https://cdn.whalexy.com/offer.${type}`,
              ...(type === 'document' ? { filename: 'Offer.pdf' } : {}),
            };
      expect((await send(f, { ...value('cta_url'), header, footer: 'Offer details' })).status).toBe(
        202,
      );
      expect((await jobs(f))[0].payload).toMatchObject({
        payload: {
          interactive: {
            header:
              type === 'text'
                ? { type, text: 'Our offer' }
                : {
                    type,
                    [type]: {
                      link: header.url,
                      ...(type === 'document' ? { filename: 'Offer.pdf' } : {}),
                    },
                  },
            footer: { text: 'Offer details' },
          },
        },
      });
    });
  it('rejects unsafe destinations, ambiguous labels and incompatible fields before writes', async () => {
    const f = await fixture();
    await ingestMeta(event(f));
    const base = value('cta_url');
    for (const url of [
      'http://shop.whalexy.com',
      'https:shop.whalexy.com',
      'https://shop.whalexy.com\\path',
      'javascript:alert(1)',
      'https://user:pass@shop.whalexy.com',
      'https://127.0.0.1',
      'https://[::1]',
      'https://localhost',
      'https://service.internal/path',
      'https://shop.whalexy.com:444/path',
      'https://shop.whalexy.com/{answer}',
      'https://shop.whalexy.com/a b',
      'https://shop.whalexy.com/\npath',
      `https://shop.whalexy.com/${'x'.repeat(2048)}`,
    ])
      expect((await send(f, { ...base, cta: { ...base.cta, url } })).status).toBe(400);
    for (const title of ['', 'x'.repeat(21), 'Bad\nlabel', 'Bad\u0000label'])
      expect((await send(f, { ...base, cta: { ...base.cta, title } })).status).toBe(400);
    for (const input of [
      { ...base, cta: undefined },
      { ...base, cta: { ...base.cta, id: 'choice' } },
      { ...base, buttons: [{ id: 'x', title: 'X' }] },
      { ...base, sections: [] },
      { ...base, action: { name: 'other' } },
      { ...base, body: 'Bad\u007fbody' },
    ])
      expect((await send(f, input)).status).toBe(400);
    expect(await jobs(f)).toHaveLength(0);
    expect(await db.nativeIdempotency.count({ where: { vendorId: f.vendorId } })).toBe(0);
  });
  it('rejects unsupported location-request headers, footers, choices and action overrides', async () => {
    const f = await fixture();
    await ingestMeta(event(f));
    const base = value('location_request_message');
    for (const input of [
      { ...base, header: { type: 'text', text: 'Location' } },
      { ...base, footer: 'Footer' },
      { ...base, cta: value('cta_url').cta },
      { ...base, buttons: [] },
      { ...base, action: { name: 'send_location' } },
      { ...base, body: 'x'.repeat(1025) },
      { ...base, body: ' ' },
    ])
      expect((await send(f, input)).status).toBe(400);
    expect(await jobs(f)).toHaveLength(0);
  });
  for (const type of types)
    it(`requires an incoming service window and rechecks ${type} expiry`, async () => {
      const f = await fixture();
      expect((await send(f, value(type))).status).toBe(409);
      await ingestMeta(event(f));
      expect((await send(f, value(type))).status).toBe(202);
      await db.whatsappMessageLogs.updateMany({
        where: { vendorId: f.vendorId, isIncomingMessage: true },
        data: { messagedAt: new Date(Date.now() - 25 * 3600000) },
      });
      const fetch = remote();
      await expect(processJob((await jobs(f))[0])).rejects.toMatchObject({
        code: 'TEMPLATE_REQUIRED',
      });
      expect(fetch).not.toHaveBeenCalled();
    });
  for (const type of types)
    for (const change of ['recipient', 'expired', 'revoked', 'disconnected'])
      it(`prevents ${type} dispatch after ${change} changes`, async () => {
        const f = await fixture();
        await ingestMeta(event(f));
        await send(f, value(type));
        const job = (await jobs(f))[0];
        if (change === 'recipient')
          await db.contacts.update({ where: { id: f.contact.id }, data: { waId: '919000000111' } });
        if (change === 'expired')
          await db.outboxJobs.update({
            where: { id: job.id },
            data: {
              payload: {
                ...(job.payload as any),
                nativeInteractive: { expiresAt: Date.now() - 1000 },
              },
            },
          });
        if (change === 'revoked')
          await db.nativeMemberships.update({
            where: { vendorId_userId: { vendorId: f.vendorId, userId: f.userId } },
            data: { active: false },
          });
        if (change === 'disconnected')
          await db.integrationCredentials.deleteMany({
            where: { vendorId: f.vendorId, provider: 'whatsapp' },
          });
        const fetch = remote(),
          current = await db.outboxJobs.findUniqueOrThrow({ where: { id: job.id } });
        if (['revoked', 'disconnected'].includes(change))
          await expect(processJob(current)).rejects.toBeTruthy();
        else await processJob(current);
        expect(fetch).not.toHaveBeenCalled();
      });
  it('denies foreign, mismatched-number and unassigned recipients', async () => {
    const f = await fixture(),
      other = await fixture();
    await ingestMeta(event(f));
    expect((await send({ ...f, contact: other.contact }, value('cta_url'))).status).toBe(404);
    expect(
      (await send({ ...f, phone: `${f.phone}9` }, value('location_request_message'))).status,
    ).toBe(409);
    await db.nativeMemberships.update({
      where: { vendorId_userId: { vendorId: f.vendorId, userId: f.userId } },
      data: { permissions: ['vendor.chats.reply', 'vendor.chats.view_assigned'] },
    });
    expect((await send(f, value('cta_url'))).status).toBe(404);
    expect(await jobs(f)).toHaveLength(0);
  });
  it('retains signed locations once without inventing request proof or overwriting contact fields', async () => {
    const f = await fixture();
    await ingestMeta(event(f));
    await send(f, value('location_request_message'));
    const before = await db.contacts.findUniqueOrThrow({ where: { id: f.contact.id } });
    const location = {
        latitude: 0,
        longitude: 0,
        name: 'Shared location',
        address: 'Optional address',
      },
      incoming = event(f, { type: 'location', location });
    await Promise.all([ingestMeta(incoming), ingestMeta(incoming)]);
    const rows = await db.whatsappMessageLogs.findMany({
      where: { vendorId: f.vendorId, type: 'location', isIncomingMessage: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].data).toMatchObject({ incoming: { type: 'location', location } });
    expect(rows[0].data).not.toHaveProperty('nativeInteractiveSelection');
    expect((await db.contacts.findUniqueOrThrow({ where: { id: f.contact.id } })).firstName).toBe(
      before.firstName,
    );
    expect(await jobs(f)).toHaveLength(1);
  });
});

describe('CTA bot graph execution', () => {
  it('renders CTA bodies and labels, retains fixed destinations and continues without a selection menu', () => {
    const g = validateGraph(graph({ button_display_text: 'Shop {name}' }), true),
      result = advanceGraph(g, null, {}, { first_name: 'Ada', name: 'Ada' });
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toMatchObject({
      interactive: {
        type: 'cta_url',
        body: { text: 'Hello Ada' },
        action: {
          name: 'cta_url',
          parameters: { display_text: 'Shop Ada', url: 'https://shop.whalexy.com/catalog#offers' },
        },
      },
    });
    expect(result.state).toMatchObject({ nodeId: null, waiting: false });
  });
  it('rejects unsafe/variable URLs, incompatible choices and automatic cycles', () => {
    for (const changes of [
      { button_url: 'http://shop.whalexy.com' },
      { button_url: 'https://shop.whalexy.com/{answer}' },
      { button_display_text: 'x'.repeat(21) },
      { buttons: [{ id: 'x', title: 'X', next_node: null }] },
    ])
      expect(() => validateGraph(graph(changes), true)).toThrow();
    const cyclic = graph();
    cyclic.nodes[1].next_node = 'link';
    expect(() => validateGraph(cyclic, true)).toThrow('Automatic connections contain a cycle');
  });
  it('rejects invalid captured labels and body controls before rendering a graph step', () => {
    const g = validateGraph(graph({ button_display_text: '{answer}' }), true);
    for (const answer of ['', 'x'.repeat(21), 'bad\nlabel', 'bad\u007flabel'])
      expect(() => advanceGraph(g, null, {}, { answer })).toThrow();
    expect(() =>
      advanceGraph(validateGraph(graph()), null, {}, { first_name: 'bad\u007fvalue' }),
    ).toThrow();
  });
  it('queues and sends a native CTA graph once, retaining no fabricated menu selection state', async () => {
    const f = await fixture(),
      created = await save(f, graph());
    expect(created.status).toBe(201);
    const incoming = event(f);
    await Promise.all([ingestMeta(incoming), ingestMeta(incoming)]);
    const queued = await jobs(f);
    expect(queued).toHaveLength(2);
    expect(queued[0].payload).toMatchObject({
      payload: { interactive: { type: 'cta_url', body: { text: 'Hello Customer' } } },
    });
    const fetch = remote();
    await processJob(queued[0]);
    await processJob(queued[0]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      await db.nativeIdempotency.count({
        where: { vendorId: f.vendorId, key: { startsWith: 'interactive-choice:' } },
      }),
    ).toBe(0);
    expect(await db.userActiveFlows.count({ where: { flowId: created.body.id } })).toBe(0);
  });
  it('cancels queued CTA graph messages after the graph revision changes', async () => {
    const f = await fixture(),
      created = await save(f, graph());
    await ingestMeta(event(f));
    const job = (await jobs(f))[0];
    await db.botFlows.update({
      where: { id: created.body.id },
      data: { updatedAt: new Date(Date.now() + 1000) },
    });
    const fetch = remote();
    await processJob(job);
    expect(fetch).not.toHaveBeenCalled();
    expect(
      (
        await db.whatsappMessageLogs.findUniqueOrThrow({
          where: { id: (job.payload as any).messageId },
        })
      ).status,
    ).toBe('cancelled');
  });
  it('previews CTA continuation without creating delivery or session records', async () => {
    const f = await fixture(),
      created = await save(f, graph({ text: 'Visit our store' }));
    expect(created.status).toBe(201);
    const fetch = remote(),
      preview = await request(app)
        .post(`${f.prefix}/bot-flows/${created.body.id}/preview`)
        .set('Authorization', f.auth)
        .send({ inputs: [] });
    expect(preview.status).toBe(200);
    expect(preview.body.completed).toBe(true);
    expect(preview.body.responses[0].messages[0]).toMatchObject({
      interactive: { type: 'cta_url' },
    });
    expect(await jobs(f)).toHaveLength(0);
    expect(await db.userActiveFlows.count({ where: { flowId: created.body.id } })).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps a following reply menu as the only selectable graph node', async () => {
    const f = await fixture(),
      g: any = graph();
    g.nodes[1] = {
      id: 'done',
      type: 'interactive',
      payload: {
        text: 'Choose',
        interactive_type: 'button',
        buttons: [{ id: 'finish', title: 'Done', next_node: null }],
      },
      next_node: null,
    };
    const created = await save(f, g);
    expect(created.status).toBe(201);
    await ingestMeta(event(f));
    const queued = await jobs(f),
      session = await db.userActiveFlows.findFirstOrThrow({ where: { flowId: created.body.id } });
    expect(session.currentNodeUid).toBe('done');
    expect((session.data as any).state.activeMenus).toEqual(['done']);
    expect(Object.values((session.data as any).selections)).toEqual([
      { choiceId: 'finish', nodeId: 'done' },
    ]);
    await ingestMeta(
      event(f, {
        type: 'interactive',
        interactive: { button_reply: { id: 'cta_url', title: 'Visit store' } },
      }),
    );
    expect(await jobs(f)).toHaveLength(2);
    expect(await db.userActiveFlows.count({ where: { flowId: created.body.id } })).toBe(1);
    const token = (queued[1].payload as any).payload.interactive.action.buttons[0].reply.id;
    await ingestMeta(
      event(f, {
        type: 'interactive',
        interactive: { button_reply: { id: token, title: 'Done' } },
      }),
    );
    expect(await db.userActiveFlows.count({ where: { flowId: created.body.id } })).toBe(0);
  });
  it('preserves question progress and queues a blocked job when a captured CTA label is invalid', async () => {
    const f = await fixture(),
      g = graph({ button_display_text: '{answer}' });
    g.start_node = 'question';
    g.nodes.unshift({
      id: 'question',
      type: 'question',
      payload: { text: 'Your answer?', variable_name: 'answer' } as any,
      next_node: 'link',
    });
    const created = await save(f, g);
    expect(created.status).toBe(201);
    await ingestMeta(event(f));
    const before = await db.userActiveFlows.findFirstOrThrow({
      where: { flowId: created.body.id },
    });
    await ingestMeta(event(f, { type: 'text', text: { body: 'x'.repeat(21) } }));
    expect(await jobs(f)).toHaveLength(1);
    expect((await db.userActiveFlows.findUniqueOrThrow({ where: { id: before.id } })).data).toEqual(
      before.data,
    );
    expect(
      await db.outboxJobs.findFirstOrThrow({
        where: { vendorId: f.vendorId, kind: 'bot-flow-blocked' },
      }),
    ).toMatchObject({ status: 'blocked', lastError: 'GRAPH_RENDER_INVALID' });
  });
});
