import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { encrypt, digest } from '../src/utils/crypto.js';
import { config } from '../src/config/environment.js';
import { ingestMeta } from '../src/jobs/handlers/meta-webhook.handler.js';
import { processJob } from '../src/jobs/dispatcher.js';
import { routeFlowData } from '../src/modules/flow-data/services/flow-sessions.service.js';
import { resumeGraphFlow } from '../src/modules/bot-flows/services/bot-graph-runtime.js';
import { businessFixture } from './fixtures.js';
const app = createApp(),
  originalPublic = config.PUBLIC_URL;
const pair = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
beforeEach(() => {
  config.PUBLIC_URL = 'https://backend.example.com';
});
afterEach(() => {
  config.PUBLIC_URL = originalPublic;
  vi.unstubAllGlobals();
});
afterAll(async () => db.$disconnect());
const definition = {
  version: '7.3',
  screens: [
    {
      id: 'START',
      terminal: true,
      success: true,
      data: {},
      layout: { type: 'SingleColumnLayout', children: [] },
    },
  ],
};
const setup = {
  initialScreen: 'START',
  screens: [{ id: 'START', data: {}, bindings: { answer: 'answer' }, complete: true }],
};
async function fixture(endpoint = false) {
  const f = await businessFixture(),
    phone = `4455${f.vendorId}`,
    waba = `4466${f.vendorId}`,
    flowId = `4477${f.vendorId}`;
  const credential = await db.integrationCredentials.create({
    data: {
      vendorId: f.vendorId,
      provider: 'whatsapp',
      externalId: phone,
      secret: encrypt('test-graph-flow'),
      metadata: {
        wabaId: waba,
        ...(endpoint
          ? {
              flowEncryption: {
                active: { publicKey: pair.publicKey, envelope: encrypt(pair.privateKey) },
              },
            }
          : {}),
      },
    },
  });
  const uri = endpoint ? `${config.PUBLIC_URL}/webhooks/flows/${credential.id}` : null;
  await db.nativeMetaFlows.create({
    data: {
      id: flowId,
      vendorId: f.vendorId,
      wabaId: waba,
      name: 'Graph form',
      status: 'PUBLISHED',
      categories: ['OTHER'],
      flowJson: endpoint ? { ...definition, data_api_version: '3.0' } : definition,
      endpointUri: uri,
    },
  });
  if (endpoint)
    await db.webhookReceipts.create({
      data: {
        provider: 'flow-data-config',
        eventKey: `flow-data-config:${f.vendorId}:${flowId}`,
        payload: setup,
      },
    });
  const contact = await db.contacts.create({
    data: {
      vendorId: f.vendorId,
      waId: `9166${String(f.vendorId).padStart(7, '0')}`,
      firstName: 'Jane',
      platform: 'whatsapp',
      wabPhoneNumberId: phone,
    },
  });
  const state = {
    published: true,
    healthy: true,
    endpointUri: uri,
    duringRead: undefined as (() => Promise<void>) | undefined,
    sends: 0,
  };
  const fetch = vi.fn(async (url: URL, init: RequestInit = {}) => {
    expect(url.hostname).toBe('graph.facebook.com');
    let value: any;
    if (url.pathname.endsWith(`/${flowId}`)) {
      if (state.duringRead) {
        const run = state.duringRead;
        state.duringRead = undefined;
        await run();
      }
      value = {
        id: flowId,
        status: state.published ? 'PUBLISHED' : 'DEPRECATED',
        endpoint_uri: state.endpointUri,
        ...(endpoint ? { data_api_version: '3.0' } : {}),
        validation_errors: [],
        health_status: { can_send_message: state.healthy ? 'AVAILABLE' : 'BLOCKED' },
      };
    } else if (url.pathname.endsWith(`/${phone}/messages`)) {
      state.sends++;
      expect(JSON.parse(String(init.body)).nativeFlow).toBeUndefined();
      value = { messages: [{ id: `wamid.${randomUUID()}` }] };
    } else throw Error('Unexpected provider path');
    return new Response(JSON.stringify(value));
  });
  vi.stubGlobal('fetch', fetch);
  return {
    ...f,
    phone,
    waba,
    flowId,
    credential,
    contact,
    state,
    fetch,
    prefix: `/api/v1/vendors/${f.vendorId}`,
    auth: `Bearer ${f.token}`,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const graph = (f: Fixture) => ({
  start_node: 'form',
  nodes: [
    {
      id: 'form',
      type: 'whatsapp_flow',
      payload: {
        flow_id: f.flowId,
        body_text: 'Hello {first_name}',
        cta_text: 'Open',
        header_text: 'Form',
        footer_text: 'Thank you',
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
});
const create = (f: Fixture, g: any = graph(f)) =>
  request(app).post(`${f.prefix}/bot-flows`).set('Authorization', f.auth).send({
    title: 'Meta Flow graph',
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
const tokenOf = (job: any) =>
  job.payload.payload.interactive.action.parameters.flow_token as string;
async function completion(f: Fixture, token: string, from = f.contact.waId) {
  await ingestMeta({
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: f.phone },
              messages: [
                {
                  id: randomUUID(),
                  from,
                  type: 'interactive',
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  interactive: {
                    nfm_reply: {
                      response_json: JSON.stringify({ flow_token: token, answer: 'Yes' }),
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  });
}
describe('native bot Meta Flow launches', () => {
  it('queues a static launch once, binds an opaque token and continues without remote reads during intake', async () => {
    const f = await fixture(),
      created = await create(f);
    expect(created.status).toBe(201);
    const event = inbound(f);
    await Promise.all([ingestMeta(event), ingestMeta(event)]);
    expect(f.fetch).not.toHaveBeenCalled();
    const jobs = await queue(f);
    expect(jobs).toHaveLength(2);
    const p = (jobs[0].payload as any).payload.interactive;
    expect(p).toMatchObject({
      body: { text: 'Hello Jane' },
      header: { text: 'Form' },
      footer: { text: 'Thank you' },
      action: {
        parameters: {
          flow_id: f.flowId,
          flow_action: 'navigate',
          flow_action_payload: { screen: 'START' },
        },
      },
    });
    const token = tokenOf(jobs[0]);
    expect(token).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(
      await db.nativeIdempotency.findUnique({
        where: { vendorId_key: { vendorId: f.vendorId, key: `flow-token:${digest(token)}` } },
      }),
    ).toMatchObject({
      response: {
        graphFlowId: created.body.id,
        contactId: f.contact.id,
        phoneNumberId: f.phone,
        messageId: (jobs[0].payload as any).messageId,
      },
    });
    await processJob(jobs[0]);
    await processJob(jobs[0]);
    expect(f.state.sends).toBe(1);
    await completion(f, token);
    await completion(f, token);
    expect(await db.whatsappFlowResponses.count({ where: { vendorId: f.vendorId } })).toBe(1);
  });
  it('uses native encrypted routing with the graph-generated token and consumes the completion once', async () => {
    const f = await fixture(true);
    expect((await create(f)).status).toBe(201);
    await ingestMeta(inbound(f));
    const job = (await queue(f))[0],
      token = tokenOf(job);
    expect((job.payload as any).payload.interactive.action.parameters.flow_action).toBe(
      'data_exchange',
    );
    await processJob(job);
    expect(
      await routeFlowData(f.credential.id, { version: '3.0', action: 'INIT', flow_token: token }),
    ).toEqual({ screen: 'START', data: {} });
    expect(
      await routeFlowData(f.credential.id, {
        version: '3.0',
        action: 'data_exchange',
        screen: 'START',
        data: { answer: 'Yes' },
        flow_token: token,
      }),
    ).toMatchObject({ screen: 'SUCCESS' });
    await completion(f, token);
    await expect(
      routeFlowData(f.credential.id, { version: '3.0', action: 'INIT', flow_token: token }),
    ).rejects.toMatchObject({ code: 'FLOW_SESSION_INVALID' });
  });
  it('rejects foreign/unpublished flows, wrong accounts, missing starting screens and unconfigured endpoints', async () => {
    const f = await fixture(),
      foreign = await fixture();
    const g = graph(f);
    g.nodes[0].payload.flow_id = foreign.flowId;
    expect((await create(f, g)).status).toBe(409);
    await db.nativeMetaFlows.update({ where: { id: f.flowId }, data: { status: 'DRAFT' } });
    expect((await create(f)).status).toBe(409);
    await db.nativeMetaFlows.update({
      where: { id: f.flowId },
      data: { status: 'PUBLISHED', wabaId: foreign.waba },
    });
    expect((await create(f)).status).toBe(409);
    await db.nativeMetaFlows.update({
      where: { id: f.flowId },
      data: { wabaId: f.waba, flowJson: {} },
    });
    expect((await create(f)).status).toBe(409);
    await db.nativeMetaFlows.update({
      where: { id: f.flowId },
      data: { flowJson: { ...definition, data_api_version: '3.0' } },
    });
    expect((await create(f)).status).toBe(409);
  });
  it('previews proposed references without tokens and blocks oversized rendered text without advancing', async () => {
    const f = await fixture(),
      g: any = graph(f);
    g.start_node = 'ask';
    g.nodes[0].payload.cta_text = '{answer}';
    g.nodes.unshift({
      id: 'ask',
      type: 'question',
      payload: { text: 'Name?', variable_name: 'answer' },
      next_node: 'form',
    });
    const created = await create(f);
    expect(created.status).toBe(201);
    const preview = await request(app)
      .post(`${f.prefix}/bot-flows/${created.body.id}/preview`)
      .set('Authorization', f.auth)
      .send({});
    expect(preview.status).toBe(200);
    expect(preview.body.responses[0].messages[0].graphMetaFlow.flow_id).toBe(f.flowId);
    expect(JSON.stringify(preview.body)).not.toContain('flow_token');
    await db.botFlows.update({
      where: { id: created.body.id },
      data: {
        data: { nativeGraphVersion: 1, phoneNumberId: f.phone, graph: g },
        updatedAt: new Date(Date.now() + 1000),
      },
    });
    await ingestMeta(inbound(f));
    await ingestMeta(inbound(f, 'x'.repeat(21)));
    expect(await queue(f)).toHaveLength(1);
    expect(
      await db.nativeIdempotency.count({
        where: { vendorId: f.vendorId, key: { startsWith: 'flow-token:' } },
      }),
    ).toBe(0);
    expect(
      await db.outboxJobs.findFirst({ where: { vendorId: f.vendorId, kind: 'bot-flow-blocked' } }),
    ).toMatchObject({ status: 'blocked' });
    expect(f.fetch).not.toHaveBeenCalled();
  });
  for (const change of ['graph', 'flow', 'credential', 'expiry'] as const)
    it(`cancels stale launches and denies completion after ${change} changes`, async () => {
      const f = await fixture(),
        created = await create(f);
      await ingestMeta(inbound(f));
      const job = (await queue(f))[0],
        token = tokenOf(job);
      if (change === 'graph')
        await db.botFlows.update({
          where: { id: created.body.id },
          data: { updatedAt: new Date(Date.now() + 1000) },
        });
      else if (change === 'flow')
        await db.nativeMetaFlows.update({
          where: { id: f.flowId },
          data: { revision: { increment: 1 } },
        });
      else if (change === 'credential')
        await db.integrationCredentials.update({
          where: { id: f.credential.id },
          data: { updatedAt: new Date(Date.now() + 1000) },
        });
      else {
        const proof = await db.nativeIdempotency.findUniqueOrThrow({
          where: { vendorId_key: { vendorId: f.vendorId, key: `flow-token:${digest(token)}` } },
        });
        await db.nativeIdempotency.update({
          where: { id: proof.id },
          data: { response: { ...(proof.response as any), expiresAt: 0 } },
        });
      }
      await processJob(job);
      expect(f.state.sends).toBe(0);
      await completion(f, token);
      expect(await db.whatsappFlowResponses.count({ where: { vendorId: f.vendorId } })).toBe(0);
    });
  it('rejects another contact using a valid launch token', async () => {
    const f = await fixture();
    await create(f);
    await ingestMeta(inbound(f));
    await completion(f, tokenOf((await queue(f))[0]), '919999999999');
    expect(await db.whatsappFlowResponses.count({ where: { vendorId: f.vendorId } })).toBe(0);
  });
  for (const remote of ['unpublished', 'blocked', 'endpoint'])
    it(`does not dispatch after remote ${remote} changes`, async () => {
      const f = await fixture();
      await create(f);
      await ingestMeta(inbound(f));
      if (remote === 'unpublished') f.state.published = false;
      else if (remote === 'blocked') f.state.healthy = false;
      else f.state.endpointUri = 'https://foreign.example.com/form';
      await processJob((await queue(f))[0]);
      expect(f.state.sends).toBe(0);
    });
  it('rechecks credentials after provider reads and rejects cancelled launch tokens', async () => {
    const f = await fixture(true);
    await create(f);
    await ingestMeta(inbound(f));
    const job = (await queue(f))[0],
      token = tokenOf(job);
    f.state.duringRead = async () => {
      await db.integrationCredentials.update({
        where: { id: f.credential.id },
        data: { updatedAt: new Date(Date.now() + 1000) },
      });
    };
    await processJob(job);
    expect(f.state.sends).toBe(0);
    await expect(
      routeFlowData(f.credential.id, { version: '3.0', action: 'INIT', flow_token: token }),
    ).rejects.toMatchObject({ code: 'FLOW_SESSION_INVALID' });
  });
  it('revalidates a delayed launch and creates one proof only after successful continuation', async () => {
    const f = await fixture(),
      g: any = graph(f);
    g.start_node = 'wait';
    g.nodes.unshift({ id: 'wait', type: 'wait', payload: { wait_time: 5 }, next_node: 'form' });
    await create(f, g);
    await ingestMeta(inbound(f));
    const job = await db.outboxJobs.findFirstOrThrow({
      where: { vendorId: f.vendorId, kind: 'bot-flow-resume' },
    });
    await db.nativeMetaFlows.update({ where: { id: f.flowId }, data: { status: 'DEPRECATED' } });
    await expect(
      resumeGraphFlow(job, new Date(job.availableAt.getTime() + 100)),
    ).rejects.toMatchObject({ code: 'GRAPH_META_FLOW_UNAVAILABLE' });
    await db.nativeMetaFlows.update({ where: { id: f.flowId }, data: { status: 'PUBLISHED' } });
    await resumeGraphFlow(job, new Date(job.availableAt.getTime() + 100));
    await resumeGraphFlow(job, new Date(job.availableAt.getTime() + 100));
    expect(await queue(f)).toHaveLength(3);
    expect(
      await db.nativeIdempotency.count({
        where: { vendorId: f.vendorId, key: { startsWith: 'flow-token:' } },
      }),
    ).toBe(1);
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it('cancels altered endpoint configuration and rejects malformed retained routing at save', async () => {
    const f = await fixture(true);
    await create(f);
    await ingestMeta(inbound(f));
    await db.webhookReceipts.update({
      where: { eventKey: `flow-data-config:${f.vendorId}:${f.flowId}` },
      data: { payload: {} },
    });
    await processJob((await queue(f))[0]);
    expect(f.state.sends).toBe(0);
    expect((await create(f)).status).toBe(409);
  });
  it('invalidates a cancelled launch token after keyword restart without revoking the new token', async () => {
    const f = await fixture();
    await create(f);
    await ingestMeta(inbound(f));
    const old = tokenOf((await queue(f))[0]);
    await ingestMeta(inbound(f));
    const current = tokenOf((await queue(f))[2]);
    expect(current).not.toBe(old);
    await completion(f, old);
    expect(await db.whatsappFlowResponses.count({ where: { vendorId: f.vendorId } })).toBe(0);
    await completion(f, current);
    expect(await db.whatsappFlowResponses.count({ where: { vendorId: f.vendorId } })).toBe(1);
  });
});
