import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { encrypt } from '../src/utils/crypto.js';
import { advanceGraph } from '../src/modules/bot-flows/services/graph-execution.service.js';
import { validateGraph } from '../src/modules/bot-flows/services/graph-schema.validation.js';
import { ingestMeta } from '../src/jobs/handlers/meta-webhook.handler.js';
import { processJob } from '../src/jobs/dispatcher.js';
import { recoverInterruptedJobs } from '../src/jobs/recovery.js';
import { resumeGraphFlow } from '../src/modules/bot-flows/services/bot-graph-runtime.js';
import { businessFixture } from './fixtures.js';
const app = createApp();
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => db.$disconnect());
function graph() {
  return {
    start_node: 'name',
    nodes: [
      {
        id: 'name',
        type: 'question',
        payload: { text: 'What is your name?', variable_name: 'answer' },
        next_node: 'pick',
      },
      {
        id: 'pick',
        type: 'interactive',
        payload: {
          text: 'Hello {answer}',
          interactive_type: 'button',
          buttons: [
            { id: 'a', title: 'Sales', next_node: 'sales' },
            { id: 'b', title: 'End', next_node: null },
          ],
        },
        next_node: null,
      },
      { id: 'sales', type: 'goto', payload: { redirect_to_node: 'done' }, next_node: null },
      { id: 'done', type: 'message', payload: { text: 'Thanks {answer}' }, next_node: null },
    ],
  };
}
async function fixture(permissions = ['*']) {
  const f = await businessFixture(permissions),
    phone = `6655${f.vendorId}`;
  await db.integrationCredentials.create({
    data: {
      vendorId: f.vendorId,
      provider: 'whatsapp',
      externalId: phone,
      secret: encrypt('test-flow'),
    },
  });
  const contact = await db.contacts.create({
    data: {
      vendorId: f.vendorId,
      waId: `9188${String(f.vendorId).padStart(7, '0')}`,
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
const definition = (f: Awaited<ReturnType<typeof fixture>>, overrides = {}) => ({
  title: 'Flow',
  enabled: true,
  triggerType: 'is',
  startTrigger: 'hello',
  phoneNumberId: f.phone,
  graph: graph(),
  ...overrides,
});
function inbound(
  f: Awaited<ReturnType<typeof fixture>>,
  text: string,
  selection?: string,
  id = randomUUID(),
) {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: f.phone },
              messages: [
                {
                  id,
                  from: f.contact.waId,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  ...(selection
                    ? {
                        type: 'interactive',
                        interactive: { button_reply: { id: selection, title: 'Sales' } },
                      }
                    : { type: 'text', text: { body: text } }),
                },
              ],
            },
          },
        ],
      },
    ],
  };
}
const queue = (f: Awaited<ReturnType<typeof fixture>>) =>
  db.outboxJobs.findMany({
    where: { vendorId: f.vendorId, kind: 'whatsapp-send' },
    orderBy: { createdAt: 'asc' },
  });
const delayedGraph = () => ({
  start_node: 'delay',
  nodes: [
    {
      id: 'delay',
      type: 'wait',
      payload: { wait_time: 5, wait_message: 'A moment, {first_name}' },
      next_node: 'done',
    },
    { id: 'done', type: 'message', payload: { text: 'Done {first_name}' }, next_node: null },
  ],
});
async function startDelay() {
  const f = await fixture();
  expect(
    (
      await request(app)
        .post(`${f.prefix}/bot-flows`)
        .set('Authorization', f.auth)
        .send(definition(f, { graph: delayedGraph() }))
    ).status,
  ).toBe(201);
  await ingestMeta(inbound(f, 'hello'));
  const job = await db.outboxJobs.findFirstOrThrow({
    where: { vendorId: f.vendorId, kind: 'bot-flow-resume' },
  });
  return { f, job, at: new Date(job.availableAt.getTime() + 100) };
}
describe('graph execution and validation', () => {
  it('keeps session menus active with scoped choice IDs and honors reset and exit commands', () => {
    const g = validateGraph(
      {
        start_node: 'menu',
        nodes: [
          {
            id: 'menu',
            type: 'interactive',
            payload: {
              text: 'Choose',
              interactive_type: 'button',
              buttons: [
                { id: 'stay', title: 'Stay', next_node: 'stay' },
                { id: 'done', title: 'Done', next_node: 'done' },
              ],
            },
            next_node: null,
          },
          {
            id: 'stay',
            type: 'stay_in_session',
            payload: { text: 'Welcome {first_name}' },
            next_node: null,
          },
          { id: 'done', type: 'message', payload: { text: 'Finished' }, next_node: null },
        ],
      },
      true,
    );
    const menu = advanceGraph(g, null, {}, { first_name: 'Jane' });
    const stay = advanceGraph(g, menu.state, { selection: 'stay', selectionNodeId: 'menu' });
    expect(stay.messages[0].text.body).toBe('Welcome Jane');
    expect(advanceGraph(g, stay.state, { text: 'Anything' }).messages).toEqual([]);
    expect(
      advanceGraph(g, stay.state, { selection: 'done', selectionNodeId: 'foreign' }).state,
    ).toEqual(stay.state);
    expect(
      advanceGraph(g, stay.state, { selection: 'done', selectionNodeId: 'menu' }).messages[0].text
        .body,
    ).toBe('Finished');
    const reset = advanceGraph(g, stay.state, { text: ' RESET ' }, { first_name: 'Current' });
    expect(reset.state).toMatchObject({
      nodeId: 'stay',
      activeMenus: [],
      variables: { first_name: 'Current' },
    });
    expect(reset.resetSelections).toBe(true);
    expect(advanceGraph(g, stay.state, { text: 'GoodBye' }).state.nodeId).toBeNull();
    expect(() =>
      validateGraph(
        {
          start_node: 's',
          nodes: [{ id: 's', type: 'stay_in_session', payload: {}, next_node: 's' }],
        },
        true,
      ),
    ).toThrow();
  });
  it('pauses at questions, captures variables and routes selections through goto', () => {
    const g = validateGraph(graph(), true),
      first = advanceGraph(g, null, {}),
      second = advanceGraph(g, first.state, { text: 'Jane' }),
      third = advanceGraph(g, second.state, { selection: 'a' });
    expect(first.state.nodeId).toBe('name');
    expect(second.messages[0].interactive.body.text).toBe('Hello Jane');
    expect(third.messages[0].text.body).toBe('Thanks Jane');
    expect(third.state.nodeId).toBeNull();
  });
  it('ignores text and unknown selections while waiting for a button', () => {
    const g = validateGraph(graph(), true),
      state = advanceGraph(g, advanceGraph(g, null, {}).state, { text: 'Jane' }).state;
    expect(advanceGraph(g, state, { text: 'Sales' }).messages).toEqual([]);
    expect(advanceGraph(g, state, { selection: 'foreign' }).state).toEqual(state);
  });
  it('rejects dangling references, duplicates, unsafe variables and automatic loops', () => {
    const bad = graph();
    bad.nodes[3].next_node = 'missing';
    expect(() => validateGraph(bad)).toThrow();
    const duplicate = graph();
    duplicate.nodes[3].id = 'name';
    expect(() => validateGraph(duplicate)).toThrow();
    const unsafe = graph();
    unsafe.nodes[0].payload.variable_name = '__proto__';
    expect(() => validateGraph(unsafe)).toThrow();
    const loop = graph();
    loop.nodes[3].next_node = 'sales';
    expect(() => validateGraph(loop)).toThrow();
  });
  it('supports ten list branches without truncating them to buttons', () => {
    const g = {
      start_node: 'list',
      nodes: [
        {
          id: 'list',
          type: 'interactive',
          next_node: null,
          payload: {
            text: 'Pick',
            interactive_type: 'list',
            button_text: 'Choose',
            sections: [
              {
                title: 'Options',
                rows: Array.from({ length: 10 }, (_, i) => ({
                  id: `row-${i}`,
                  title: `Option ${i}`,
                  next_node: null,
                })),
              },
            ],
          },
        },
      ],
    };
    const valid = validateGraph(g, true),
      result = advanceGraph(valid, null, {});
    expect(result.messages[0].interactive.action.sections[0].rows).toHaveLength(10);
    expect(advanceGraph(valid, result.state, { selection: 'row-9' }).state.nodeId).toBeNull();
  });
  it('allows drafts with pending handlers but refuses activation', () => {
    const draft = {
      start_node: 'hook',
      nodes: [
        { id: 'hook', type: 'webhook', payload: { url: 'https://example.com' }, next_node: null },
      ],
    };
    expect(validateGraph(draft).nodes).toHaveLength(1);
    expect(() => validateGraph(draft, true)).toThrow();
  });
});
describe('tenant-scoped durable graph flows', () => {
  it('persists session menus, deduplicates selections, and cancels queued responses on exit', async () => {
    const f = await fixture();
    const g = {
      start_node: 'menu',
      nodes: [
        {
          id: 'menu',
          type: 'interactive',
          payload: {
            text: 'Choose',
            interactive_type: 'button',
            buttons: [
              { id: 'stay', title: 'Stay', next_node: 'stay' },
              { id: 'done', title: 'Done', next_node: 'done' },
            ],
          },
          next_node: null,
        },
        {
          id: 'stay',
          type: 'stay_in_session',
          payload: { text: 'Still here {first_name}' },
          next_node: null,
        },
        { id: 'done', type: 'message', payload: { text: 'Finished' }, next_node: null },
      ],
    };
    expect(
      (
        await request(app)
          .post(`${f.prefix}/bot-flows`)
          .set('Authorization', f.auth)
          .send(definition(f, { graph: g }))
      ).status,
    ).toBe(201);
    await ingestMeta(inbound(f, 'hello'));
    const buttons = ((await queue(f))[0].payload as any).payload.interactive.action.buttons;
    const event = inbound(f, '', buttons[0].reply.id);
    await ingestMeta(event);
    await ingestMeta(event);
    expect(await queue(f)).toHaveLength(2);
    await ingestMeta(inbound(f, 'random'));
    expect(await queue(f)).toHaveLength(2);
    await ingestMeta(inbound(f, '', buttons[1].reply.id));
    expect((await queue(f))[2].payload).toMatchObject({ payload: { text: { body: 'Finished' } } });
    await ingestMeta(inbound(f, 'hello'));
    const fresh = ((await queue(f))[3].payload as any).payload.interactive.action.buttons[0].reply
      .id;
    await ingestMeta(inbound(f, '', fresh));
    await ingestMeta(inbound(f, 'bye'));
    expect(
      await db.userActiveFlows.count({
        where: { phoneNumber: { startsWith: `node:whatsapp:${f.vendorId}:` } },
      }),
    ).toBe(0);
    vi.stubGlobal('fetch', vi.fn());
    await processJob((await queue(f))[4]);
    expect(fetch).not.toHaveBeenCalled();
    await ingestMeta(inbound(f, '', fresh));
    expect(await queue(f)).toHaveLength(5);
  });
  it('resets session variables and invalidates earlier menu tokens without replaying messages', async () => {
    const f = await fixture(),
      g = graph();
    g.nodes[3] = {
      id: 'done',
      type: 'stay_in_session',
      payload: { text: 'Here {answer}' },
      next_node: null,
    } as any;
    await request(app)
      .post(`${f.prefix}/bot-flows`)
      .set('Authorization', f.auth)
      .send(definition(f, { graph: g }));
    await ingestMeta(inbound(f, 'hello'));
    await ingestMeta(inbound(f, 'Jane'));
    const token = ((await queue(f))[1].payload as any).payload.interactive.action.buttons[0].reply
      .id;
    await ingestMeta(inbound(f, '', token));
    await ingestMeta(inbound(f, 'reset'));
    await ingestMeta(inbound(f, '', token));
    expect(await queue(f)).toHaveLength(3);
    const session = await db.userActiveFlows.findFirstOrThrow({
      where: { phoneNumber: { startsWith: `node:whatsapp:${f.vendorId}:` } },
    });
    expect(session.data).toMatchObject({
      state: { nodeId: 'done', activeMenus: [] },
      selections: {},
    });
    expect((session.data as any).state.variables.answer).toBeUndefined();
  });
  it('creates, previews, exports, imports and clones inactive copies', async () => {
    const f = await fixture(),
      created = await request(app)
        .post(`${f.prefix}/bot-flows`)
        .set('Authorization', f.auth)
        .send(definition(f));
    expect(created.status).toBe(201);
    const preview = await request(app)
      .post(`${f.prefix}/bot-flows/${created.body.id}/preview`)
      .set('Authorization', f.auth)
      .send({ inputs: [{ text: 'Jane' }, { selection: 'a' }] });
    expect(preview.status).toBe(200);
    expect(preview.body.completed).toBe(true);
    expect(await queue(f)).toHaveLength(0);
    const exported = await request(app)
      .get(`${f.prefix}/bot-flows/${created.body.id}/export`)
      .set('Authorization', f.auth);
    expect(exported.body.enabled).toBe(false);
    expect(exported.body.vendorId).toBeUndefined();
    expect(
      (
        await request(app)
          .post(`${f.prefix}/bot-flows/import`)
          .set('Authorization', f.auth)
          .send(exported.body)
      ).status,
    ).toBe(201);
    const cloned = await request(app)
      .post(`${f.prefix}/bot-flows/${created.body.id}/clone`)
      .set('Authorization', f.auth)
      .send({ title: 'Copy' });
    expect(cloned.status).toBe(201);
    expect(cloned.body.status).toBe('inactive');
    expect(
      await db.auditEvents.count({ where: { vendorId: f.vendorId, resource: 'bot-flow' } }),
    ).toBe(3);
  });
  it('deduplicates inbound events, resumes questions and persists selected branches', async () => {
    const f = await fixture();
    expect(
      (
        await request(app)
          .post(`${f.prefix}/bot-flows`)
          .set('Authorization', f.auth)
          .send(definition(f))
      ).status,
    ).toBe(201);
    const event = inbound(f, 'hello');
    await Promise.all([ingestMeta(event), ingestMeta(event)]);
    expect(await queue(f)).toHaveLength(1);
    await ingestMeta(inbound(f, 'Jane'));
    expect((await queue(f))[1].payload).toMatchObject({
      payload: { interactive: { body: { text: 'Hello Jane' } } },
    });
    await ingestMeta(inbound(f, '', 'wrong'));
    expect(await queue(f)).toHaveLength(2);
    const selected = ((await queue(f))[1].payload as any).payload.interactive.action.buttons[0]
      .reply.id;
    await ingestMeta(inbound(f, '', selected));
    expect((await queue(f))[2].payload).toMatchObject({
      payload: { text: { body: 'Thanks Jane' } },
    });
    expect(
      await db.userActiveFlows.count({
        where: { phoneNumber: { startsWith: `node:whatsapp:${f.vendorId}:` } },
      }),
    ).toBe(0);
    const jobs = await queue(f);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ messages: [{ id: `wamid.graph.${randomUUID()}` }] })),
        ),
    );
    await processJob(jobs[1]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('cancels stale queued messages and resets sessions after editing', async () => {
    const f = await fixture(),
      created = await request(app)
        .post(`${f.prefix}/bot-flows`)
        .set('Authorization', f.auth)
        .send(definition(f));
    await ingestMeta(inbound(f, 'hello'));
    const job = (await queue(f))[0];
    const changed = await request(app)
      .put(`${f.prefix}/bot-flows/${created.body.id}`)
      .set('Authorization', f.auth)
      .send(definition(f, { enabled: false }));
    expect(changed.status).toBe(200);
    vi.stubGlobal('fetch', vi.fn());
    await processJob(job);
    expect(fetch).not.toHaveBeenCalled();
    expect(
      (
        await db.whatsappMessageLogs.findUniqueOrThrow({
          where: { id: (job.payload as any).messageId },
        })
      ).status,
    ).toBe('cancelled');
    expect(await db.userActiveFlows.count({ where: { flowId: created.body.id } })).toBe(0);
  });
  it('denies foreign ownership, revoked permission, foreign numbers and generic writes', async () => {
    const f = await fixture(),
      foreign = await fixture(),
      restricted = await fixture(['vendor.contacts.view']);
    const created = await request(app)
      .post(`${f.prefix}/bot-flows`)
      .set('Authorization', f.auth)
      .send(definition(f));
    expect(
      (
        await request(app)
          .get(`${foreign.prefix}/bot-flows/${created.body.id}`)
          .set('Authorization', foreign.auth)
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .post(`${restricted.prefix}/bot-flows`)
          .set('Authorization', restricted.auth)
          .send(definition(restricted))
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post(`${f.prefix}/bot-flows`)
          .set('Authorization', f.auth)
          .send(definition(f, { phoneNumberId: foreign.phone }))
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post(`${f.prefix}/resources/bot-flows`)
          .set('Authorization', f.auth)
          .send({ title: 'Bypass' })
      ).status,
    ).toBe(403);
  });
  it('blocks automation and queued graph replies during human handoff', async () => {
    const f = await fixture();
    await request(app)
      .post(`${f.prefix}/bot-flows`)
      .set('Authorization', f.auth)
      .send(definition(f));
    await ingestMeta(inbound(f, 'hello'));
    await ingestMeta(inbound(f, 'talk to a human'));
    await ingestMeta(inbound(f, 'Jane'));
    expect(await queue(f)).toHaveLength(2);
    const job = (await queue(f))[0];
    vi.stubGlobal('fetch', vi.fn());
    await processJob(job);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('restarts on a repeated keyword and rejects stale button tokens', async () => {
    const f = await fixture();
    await request(app)
      .post(`${f.prefix}/bot-flows`)
      .set('Authorization', f.auth)
      .send(definition(f));
    await ingestMeta(inbound(f, 'hello'));
    await ingestMeta(inbound(f, 'Jane'));
    const stale = ((await queue(f))[1].payload as any).payload.interactive.action.buttons[0].reply
      .id;
    await ingestMeta(inbound(f, 'hello'));
    expect((await queue(f))[2].payload).toMatchObject({
      payload: { text: { body: 'What is your name?' } },
    });
    const old = (await queue(f))[1];
    vi.stubGlobal('fetch', vi.fn());
    await processJob(old);
    expect(fetch).not.toHaveBeenCalled();
    expect(
      (
        await db.whatsappMessageLogs.findUniqueOrThrow({
          where: { id: (old.payload as any).messageId },
        })
      ).status,
    ).toBe('cancelled');
    await ingestMeta(inbound(f, 'John'));
    await ingestMeta(inbound(f, '', stale));
    expect(await queue(f)).toHaveLength(4);
    const fresh = ((await queue(f))[3].payload as any).payload.interactive.action.buttons[0].reply
      .id;
    await ingestMeta(inbound(f, '', fresh));
    expect((await queue(f))[4].payload).toMatchObject({
      payload: { text: { body: 'Thanks John' } },
    });
  });
  it('stores custom-field answers atomically and rejects foreign field definitions', async () => {
    const f = await fixture(),
      foreign = await fixture();
    const field = await db.contactCustomFields.create({
      data: { vendorId: f.vendorId, inputName: 'reference', inputType: 'text', name: 'Reference' },
    });
    const g = {
      start_node_id: 'ask',
      nodes: [
        {
          id: 'ask',
          type: 'custom_field',
          payload: {
            question_text: 'Reference?',
            custom_field_id: field.id,
            custom_field_name: 'reference',
            next_node: 'end',
          },
        },
        { id: 'end', type: 'message', payload: { text: 'Saved {reference}' }, next_node: null },
      ],
    };
    expect(
      (
        await request(app)
          .post(`${foreign.prefix}/bot-flows`)
          .set('Authorization', foreign.auth)
          .send(definition(foreign, { graph: g }))
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post(`${f.prefix}/bot-flows`)
          .set('Authorization', f.auth)
          .send(definition(f, { graph: g }))
      ).status,
    ).toBe(201);
    await ingestMeta(inbound(f, 'hello'));
    const answer = inbound(f, 'REF-42');
    await ingestMeta(answer);
    await ingestMeta(answer);
    expect((await queue(f))[1].payload).toMatchObject({
      payload: { text: { body: 'Saved REF-42' } },
    });
    expect(
      await db.contactCustomFieldValues.count({
        where: { contactId: f.contact.id, contactCustomFieldsId: field.id, fieldValue: 'REF-42' },
      }),
    ).toBe(1);
  });
  it('keeps graph sessions isolated by business number and expires old sessions', async () => {
    const f = await fixture();
    await request(app)
      .post(`${f.prefix}/bot-flows`)
      .set('Authorization', f.auth)
      .send(definition(f));
    await ingestMeta(inbound(f, 'hello'));
    const second = `9977${f.vendorId}`;
    await db.integrationCredentials.create({
      data: {
        vendorId: f.vendorId,
        provider: 'whatsapp',
        externalId: second,
        secret: encrypt('second-flow'),
      },
    });
    await ingestMeta(inbound({ ...f, phone: second }, 'Jane'));
    expect(await queue(f)).toHaveLength(1);
    await db.userActiveFlows.updateMany({
      where: { phoneNumber: { startsWith: `node:whatsapp:${f.vendorId}:` } },
      data: { activatedAt: new Date(Date.now() - 25 * 3600000) },
    });
    await ingestMeta(inbound(f, 'Jane'));
    expect(await queue(f)).toHaveLength(1);
    expect(
      await db.userActiveFlows.count({
        where: { phoneNumber: { startsWith: `node:whatsapp:${f.vendorId}:` } },
      }),
    ).toBe(0);
  });
  it('refuses enabling pending node handlers and persists drafts without sending', async () => {
    const f = await fixture(),
      draft = {
        start_node: 'hook',
        nodes: [
          { id: 'hook', type: 'webhook', payload: { url: 'https://example.com' }, next_node: null },
        ],
      };
    const rejected = await request(app)
      .post(`${f.prefix}/bot-flows`)
      .set('Authorization', f.auth)
      .send(definition(f, { graph: draft }));
    expect(rejected.status).toBe(409);
    expect(rejected.body.error.code).toBe('GRAPH_HANDLER_PENDING');
    expect(
      (
        await request(app)
          .post(`${f.prefix}/bot-flows`)
          .set('Authorization', f.auth)
          .send(definition(f, { graph: draft, enabled: false }))
      ).status,
    ).toBe(201);
    await ingestMeta(inbound(f, 'hello'));
    expect(await queue(f)).toHaveLength(0);
  });
  it('does not start graph sessions or modify fields for archived contacts', async () => {
    const f = await fixture();
    await request(app)
      .post(`${f.prefix}/bot-flows`)
      .set('Authorization', f.auth)
      .send(definition(f));
    await db.contacts.update({ where: { id: f.contact.id }, data: { status: 5 } });
    await ingestMeta(inbound(f, 'hello'));
    expect(await queue(f)).toHaveLength(0);
    expect(
      await db.userActiveFlows.count({
        where: { phoneNumber: { startsWith: `node:whatsapp:${f.vendorId}:` } },
      }),
    ).toBe(0);
  });
});

describe('durable wait nodes', () => {
  it('stops preview at the proposed delay without consuming inputs or creating jobs', async () => {
    const f = await fixture(),
      created = await request(app)
        .post(`${f.prefix}/bot-flows`)
        .set('Authorization', f.auth)
        .send(definition(f, { graph: delayedGraph() }));
    expect(created.status).toBe(201);
    const preview = await request(app)
      .post(`${f.prefix}/bot-flows/${created.body.id}/preview`)
      .set('Authorization', f.auth)
      .send({ inputs: [{ text: 'go now' }] });
    expect(preview.status).toBe(200);
    expect(preview.body.responses).toHaveLength(1);
    expect(preview.body.responses[0].delay).toEqual({ seconds: 5, nextNodeId: 'done' });
    expect(preview.body.completed).toBe(false);
    expect(await db.outboxJobs.count({ where: { vendorId: f.vendorId } })).toBe(0);
  });
  it('emits the wait message, rejects premature execution and resumes exactly once', async () => {
    const { f, job, at } = await startDelay();
    expect((await queue(f))[0].payload).toMatchObject({
      payload: { text: { body: 'A moment, Customer' } },
    });
    await expect(processJob(job)).rejects.toMatchObject({ code: 'GRAPH_DELAY_NOT_DUE' });
    await ingestMeta(inbound(f, 'random text'));
    expect(await queue(f)).toHaveLength(1);
    await Promise.all([resumeGraphFlow(job, at), resumeGraphFlow(job, at)]);
    expect(await queue(f)).toHaveLength(2);
    expect((await queue(f))[1].payload).toMatchObject({
      payload: { text: { body: 'Done Customer' } },
    });
    expect(await db.userActiveFlows.count({ where: { flowId: (job.payload as any).flowId } })).toBe(
      0,
    );
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ messages: [{ id: `wamid.wait.${randomUUID()}` }] })),
        ),
    );
    await processJob((await queue(f))[1]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('invalidates a timer after a restart and keeps the newer timer active', async () => {
    const { f, job, at } = await startDelay();
    await ingestMeta(inbound(f, 'hello'));
    await resumeGraphFlow(job, at);
    expect(await queue(f)).toHaveLength(2);
    const fresh = await db.outboxJobs.findFirstOrThrow({
      where: { vendorId: f.vendorId, kind: 'bot-flow-resume', id: { not: job.id } },
    });
    await resumeGraphFlow(fresh, new Date(fresh.availableAt.getTime() + 100));
    expect(await queue(f)).toHaveLength(3);
  });
  it.each(['edit', 'archive', 'handoff', 'identity'] as const)(
    'cancels delayed continuation after %s',
    async (reason) => {
      const { f, job, at } = await startDelay();
      if (reason === 'edit')
        await request(app)
          .put(`${f.prefix}/bot-flows/${(job.payload as any).flowId}`)
          .set('Authorization', f.auth)
          .send(definition(f, { graph: delayedGraph(), enabled: false }));
      if (reason === 'archive')
        await db.contacts.update({ where: { id: f.contact.id }, data: { status: 5 } });
      if (reason === 'handoff') await ingestMeta(inbound(f, 'talk to a human'));
      if (reason === 'identity')
        await db.contacts.update({ where: { id: f.contact.id }, data: { waId: '919999999999' } });
      const before = (await queue(f)).length;
      await resumeGraphFlow(job, at);
      expect(await queue(f)).toHaveLength(before);
      expect(
        await db.userActiveFlows.count({ where: { flowId: (job.payload as any).flowId } }),
      ).toBe(0);
    },
  );
  it('recovers internal timer jobs safely before and after a committed continuation', async () => {
    const { f, job, at } = await startDelay(),
      old = new Date(Date.now() - 15 * 60000);
    await db.outboxJobs.update({
      where: { id: job.id },
      data: { status: 'processing', lockedAt: old },
    });
    await recoverInterruptedJobs();
    expect((await db.outboxJobs.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      'pending',
    );
    await resumeGraphFlow(job, at);
    await db.outboxJobs.update({
      where: { id: job.id },
      data: { status: 'processing', lockedAt: old },
    });
    await recoverInterruptedJobs();
    expect((await db.outboxJobs.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      'completed',
    );
    await resumeGraphFlow(job, at);
    expect(await queue(f)).toHaveLength(2);
  });
  it('honors current timing restrictions and resumes after they are disabled', async () => {
    const { f, job, at } = await startDelay(),
      hour = String((at.getUTCHours() + 12) % 24).padStart(2, '0');
    for (const [name, value] of Object.entries({
      enable_bot_timing_restrictions: '1',
      bot_timing_timezone: 'UTC',
      bot_start_timing: `${hour}:00`,
      bot_end_timing: `${hour}:01`,
      enable_selected_other_bot_timing_restrictions: JSON.stringify({ is: true }),
    }))
      await db.vendorSettings.create({ data: { vendorId: f.vendorId, name, value } });
    await expect(resumeGraphFlow(job, at)).rejects.toMatchObject({ code: 'GRAPH_TIMING_PAUSED' });
    expect(await queue(f)).toHaveLength(1);
    await db.vendorSettings.updateMany({
      where: { vendorId: f.vendorId, name: 'enable_bot_timing_restrictions' },
      data: { value: '0' },
    });
    await resumeGraphFlow(job, at);
    expect(await queue(f)).toHaveLength(2);
  });
  it('rejects automatic cycles through waits and delay values outside source bounds', () => {
    const cycle = delayedGraph();
    cycle.nodes[1].next_node = 'delay';
    expect(() => validateGraph(cycle, true)).toThrow();
    for (const wait_time of [0, -1, 604801, 1.5]) {
      const invalid = delayedGraph();
      invalid.nodes[0].payload.wait_time = wait_time;
      expect(() => validateGraph(invalid, true)).toThrow();
    }
  });
  it('pauses both delayed continuation and queued graph sends while away', async () => {
    const { f, job, at } = await startDelay();
    const setting = await db.outOfOfficeSettings.create({
      data: {
        vendorId: f.vendorId,
        whatsappPhoneNumberId: f.phone,
        enabled: true,
        message: 'Away',
        mode: 'out_of_office_now',
        manualStartedAt: new Date(),
      },
    });
    await expect(resumeGraphFlow(job, at)).rejects.toMatchObject({ code: 'GRAPH_AWAY_PAUSED' });
    vi.stubGlobal('fetch', vi.fn());
    await expect(processJob((await queue(f))[0])).rejects.toMatchObject({
      code: 'GRAPH_AWAY_PAUSED',
    });
    expect(fetch).not.toHaveBeenCalled();
    await db.outOfOfficeSettings.update({ where: { id: setting.id }, data: { enabled: false } });
    await resumeGraphFlow(job, at);
    expect(await queue(f)).toHaveLength(2);
  });
});

describe('graph team handoff', () => {
  const assignmentGraph = (uid: string) => ({
    start_node: 'assign',
    nodes: [
      {
        id: 'assign',
        type: 'team_assignment',
        payload: { assigned_team_member: uid, assignment_message: 'A teammate will reply here.' },
        next_node: null,
      },
    ],
  });
  it('assigns the configured eligible teammate, pauses automation and delivers one acknowledgement', async () => {
    const f = await fixture(),
      agent = await businessFixture();
    await db.nativeMemberships.create({
      data: {
        vendorId: f.vendorId,
        userId: agent.userId,
        role: 'agent',
        permissions: ['vendor.chats.reply'],
      },
    });
    const user = await db.users.findUniqueOrThrow({ where: { id: agent.userId } });
    expect(
      (
        await request(app)
          .post(`${f.prefix}/bot-flows`)
          .set('Authorization', f.auth)
          .send(definition(f, { graph: assignmentGraph(user.uid) }))
      ).status,
    ).toBe(201);
    const event = inbound(f, 'hello');
    await ingestMeta(event);
    await ingestMeta(event);
    const contact = await db.contacts.findUniqueOrThrow({ where: { id: f.contact.id } });
    expect(contact.assignedUserId).toBe(agent.userId);
    expect(contact.disableAiBot).toBe(1);
    const handoff = await db.aiConversationHandoffs.findFirstOrThrow({
      where: { vendorId: f.vendorId, contactId: contact.id, status: 'waiting' },
    });
    expect(handoff.reason).toBe('bot_flow_team_assignment');
    expect(await queue(f)).toHaveLength(1);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ messages: [{ id: `wamid.assignment.${randomUUID()}` }] })),
        ),
    );
    await processJob((await queue(f))[0]);
    expect(fetch).toHaveBeenCalledTimes(1);
    await ingestMeta(inbound(f, 'hello'));
    expect(await queue(f)).toHaveLength(1);
  });
  it('rejects a foreign/non-replying agent and blocks a newly revoked assignment', async () => {
    const f = await fixture(),
      foreign = await businessFixture(),
      user = await db.users.findUniqueOrThrow({ where: { id: foreign.userId } });
    expect(
      (
        await request(app)
          .post(`${f.prefix}/bot-flows`)
          .set('Authorization', f.auth)
          .send(definition(f, { graph: assignmentGraph(user.uid) }))
      ).status,
    ).toBe(409);
    await db.nativeMemberships.create({
      data: {
        vendorId: f.vendorId,
        userId: user.id,
        role: 'agent',
        permissions: ['vendor.contacts.view'],
      },
    });
    expect(
      (
        await request(app)
          .post(`${f.prefix}/bot-flows`)
          .set('Authorization', f.auth)
          .send(definition(f, { graph: assignmentGraph(user.uid) }))
      ).status,
    ).toBe(409);
    await db.nativeMemberships.update({
      where: { vendorId_userId: { vendorId: f.vendorId, userId: user.id } },
      data: { permissions: ['vendor.chats.reply'] },
    });
    expect(
      (
        await request(app)
          .post(`${f.prefix}/bot-flows`)
          .set('Authorization', f.auth)
          .send(definition(f, { graph: assignmentGraph(user.uid) }))
      ).status,
    ).toBe(201);
    await db.nativeMemberships.update({
      where: { vendorId_userId: { vendorId: f.vendorId, userId: user.id } },
      data: { active: false },
    });
    await ingestMeta(inbound(f, 'hello'));
    expect(await queue(f)).toHaveLength(0);
    expect(
      await db.outboxJobs.findFirst({
        where: {
          vendorId: f.vendorId,
          kind: 'bot-flow-blocked',
          lastError: 'GRAPH_AGENT_UNAVAILABLE',
        },
      }),
    ).toBeTruthy();
  });
  it('cancels a queued assignment acknowledgement after agent access is revoked', async () => {
    const f = await fixture(),
      owner = await db.users.findUniqueOrThrow({ where: { id: f.userId } });
    await request(app)
      .post(`${f.prefix}/bot-flows`)
      .set('Authorization', f.auth)
      .send(definition(f, { graph: assignmentGraph(owner.uid) }));
    await ingestMeta(inbound(f, 'hello'));
    await db.nativeMemberships.update({
      where: { vendorId_userId: { vendorId: f.vendorId, userId: f.userId } },
      data: { active: false },
    });
    vi.stubGlobal('fetch', vi.fn());
    await processJob((await queue(f))[0]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
