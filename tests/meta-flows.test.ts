import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { encrypt } from '../src/utils/crypto.js';
import { businessFixture } from './fixtures.js';
import { processJob } from '../src/jobs/dispatcher.js';
import { ingestMeta } from '../src/jobs/handlers/meta-webhook.handler.js';
const app = createApp();
afterAll(() => db.$disconnect());
afterEach(() => vi.unstubAllGlobals());
const definition = {
  version: '7.3',
  screens: [
    {
      id: 'WELCOME',
      data: {},
      terminal: true,
      success: true,
      layout: { type: 'SingleColumnLayout', children: [{ type: 'TextHeading', text: 'Welcome' }] },
    },
  ],
};
async function fixture() {
  const f = await businessFixture(),
    phone = `8811${f.vendorId}`,
    waba = `8822${f.vendorId}`,
    flow = `8833${f.vendorId}`;
  await db.integrationCredentials.create({
    data: {
      vendorId: f.vendorId,
      provider: 'whatsapp',
      externalId: phone,
      secret: encrypt('test-token'),
      metadata: { wabaId: waba },
    },
  });
  return { ...f, phone, waba, flow };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const base = (f: Fixture) => `/api/v1/vendors/${f.vendorId}/meta-flows/${f.phone}`;
function change(
  f: Fixture,
  path = '',
  body: any = { name: 'Support form', categories: ['CUSTOMER_SUPPORT'] },
  key = randomUUID(),
) {
  return request(app)
    .post(base(f) + path)
    .set('Authorization', `Bearer ${f.token}`)
    .set('Idempotency-Key', key)
    .send(body);
}
function remote(f: Fixture) {
  const state = {
    status: 'DRAFT',
    errors: [] as any[],
    phone: f.phone,
    assetUrl: 'https://lookaside.fbsbx.com/flow.json',
    previewUrl: 'https://business.facebook.com/wa/manage/flows/preview',
    interrupt: false,
    uploads: 0,
    creates: 0,
  };
  const flow = () => ({
    id: f.flow,
    name: 'Support form',
    categories: ['CUSTOMER_SUPPORT'],
    status: state.status,
    validation_errors: state.errors,
  });
  const fetch = vi.fn(async (url: URL, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    let value: any;
    if (url.pathname.endsWith(`/${f.waba}/phone_numbers`)) value = { data: [{ id: state.phone }] };
    else if (url.pathname.endsWith(`/${f.waba}/flows`)) {
      if (method === 'POST') {
        state.creates++;
        if (state.interrupt) throw Error('lost response');
        value = { id: f.flow };
      } else value = { data: [flow()] };
    } else if (url.pathname.endsWith(`/${f.flow}/assets`)) {
      if (method === 'POST') {
        state.uploads++;
        expect(init.body).toBeInstanceOf(FormData);
        const form = init.body as FormData;
        expect(form.get('asset_type')).toBe('FLOW_JSON');
        expect(JSON.parse(await (form.get('file') as Blob).text())).toEqual(definition);
        value = { success: true, validation_errors: state.errors };
      } else value = { data: [{ asset_type: 'FLOW_JSON', download_url: state.assetUrl }] };
    } else if (url.hostname === 'lookaside.fbsbx.com') value = definition;
    else if (url.pathname.endsWith(`/${f.flow}/publish`)) {
      state.status = 'PUBLISHED';
      value = { success: true };
    } else if (url.pathname.endsWith(`/${f.flow}/deprecate`)) {
      state.status = 'DEPRECATED';
      value = { success: true };
    } else if (url.pathname.endsWith(`/${f.phone}/messages`))
      value = { messages: [{ id: `wamid.${randomUUID()}` }] };
    else if (url.pathname.endsWith(`/${f.flow}`)) {
      value =
        method === 'GET'
          ? url.searchParams.get('fields')?.includes('preview')
            ? { id: f.flow, preview: { preview_url: state.previewUrl } }
            : flow()
          : { success: true };
    } else throw Error('Unexpected provider resource');
    return new Response(JSON.stringify(value));
  });
  vi.stubGlobal('fetch', fetch);
  return { state, fetch };
}
async function sync(f: Fixture) {
  return request(app).get(base(f)).set('Authorization', `Bearer ${f.token}`);
}
describe('Meta Flow lifecycle', () => {
  it('creates one owned draft and replays the provider result without another creation', async () => {
    const f = await fixture(),
      r = remote(f),
      key = randomUUID();
    expect((await change(f, '', undefined, key)).status).toBe(201);
    expect((await change(f, '', undefined, key)).status).toBe(201);
    expect(r.state.creates).toBe(1);
    const saved = await db.nativeMetaFlows.findUniqueOrThrow({ where: { id: f.flow } });
    expect(saved.vendorId).toBe(f.vendorId);
    expect(saved.wabaId).toBe(f.waba);
    expect(saved.status).toBe('DRAFT');
    expect((await change(f, '', { name: 'Changed', categories: ['OTHER'] }, key)).status).toBe(409);
  });
  it('uploads multipart JSON, validates publication and deprecates without generic resource bypasses', async () => {
    const f = await fixture(),
      r = remote(f);
    expect((await sync(f)).status).toBe(200);
    expect(
      (
        await request(app)
          .put(`${base(f)}/${f.flow}/json`)
          .set('Authorization', `Bearer ${f.token}`)
          .set('Idempotency-Key', randomUUID())
          .send({ flowJson: definition })
      ).status,
    ).toBe(200);
    expect(r.state.uploads).toBe(1);
    expect(
      (await db.nativeMetaFlows.findUniqueOrThrow({ where: { id: f.flow } })).flowJson,
    ).toEqual(definition);
    r.state.errors = [{ error: 'invalid component' }];
    expect((await change(f, `/${f.flow}/publish`, {})).status).toBe(409);
    r.state.errors = [];
    expect((await change(f, `/${f.flow}/publish`, {})).status).toBe(200);
    expect(
      (
        await request(app)
          .put(`${base(f)}/${f.flow}`)
          .set('Authorization', `Bearer ${f.token}`)
          .set('Idempotency-Key', randomUUID())
          .send({ name: 'Edit', categories: ['OTHER'] })
      ).status,
    ).toBe(409);
    expect((await change(f, `/${f.flow}/delete`, {})).status).toBe(409);
    expect((await change(f, `/${f.flow}/deprecate`, {})).status).toBe(200);
    expect(
      (
        await request(app)
          .post(`/api/v1/vendors/${f.vendorId}/resources/flow-launch-settings`)
          .set('Authorization', `Bearer ${f.token}`)
          .send({ flowId: f.flow })
      ).status,
    ).toBe(403);
  });
  it('retains uncertain creation and rejects a new key instead of creating duplicates', async () => {
    const f = await fixture(),
      r = remote(f),
      key = randomUUID();
    r.state.interrupt = true;
    expect((await change(f, '', undefined, key)).body.error.code).toBe('PROVIDER_UNCERTAIN');
    r.state.interrupt = false;
    expect((await change(f, '', undefined, key)).body.error.code).toBe(
      'PROVIDER_RECONCILIATION_REQUIRED',
    );
    expect((await change(f)).status).toBe(409);
    expect(r.state.creates).toBe(1);
  });
  it('checks actual WABA phone ownership and rejects foreign imported flows', async () => {
    const f = await fixture(),
      other = await fixture(),
      r = remote(f);
    r.state.phone = other.phone;
    expect((await change(f)).status).toBe(403);
    expect(r.state.creates).toBe(0);
    r.state.phone = f.phone;
    await db.nativeMetaFlows.create({
      data: {
        id: f.flow,
        vendorId: other.vendorId,
        wabaId: other.waba,
        name: 'Foreign',
        status: 'DRAFT',
        categories: ['OTHER'],
      },
    });
    expect((await sync(f)).status).toBe(409);
    expect(
      (
        await request(app)
          .get(`${base(f)}/${f.flow}`)
          .set('Authorization', `Bearer ${f.token}`)
      ).status,
    ).toBe(404);
  });
  it('does not follow provider paging URLs and refuses repeated cursors atomically', async () => {
    const f = await fixture();
    const fetch = vi.fn(async (url: URL) => {
      expect(url.hostname).toBe('graph.facebook.com');
      return new Response(
        JSON.stringify(
          url.pathname.endsWith('phone_numbers')
            ? { data: [{ id: f.phone }] }
            : {
                data: [{ id: f.flow, name: 'Form', categories: ['OTHER'], status: 'DRAFT' }],
                paging: { next: 'https://attacker.example/token', cursors: { after: 'repeat' } },
              },
        ),
      );
    });
    vi.stubGlobal('fetch', fetch);
    expect((await sync(f)).body.error.code).toBe('PROVIDER_PAGINATION');
    expect(await db.nativeMetaFlows.count({ where: { vendorId: f.vendorId } })).toBe(0);
  });
  it('returns resumable pages, safe previews and downloaded definitions without leaking tokens', async () => {
    const f = await fixture(),
      r = remote(f);
    await sync(f);
    const preview = () =>
      request(app)
        .get(`${base(f)}/${f.flow}/preview`)
        .set('Authorization', `Bearer ${f.token}`);
    expect((await preview()).body.url).toBe(r.state.previewUrl);
    r.state.previewUrl = 'https://attacker.example/form';
    expect((await preview()).status).toBe(502);
    const download = () =>
      request(app)
        .get(`${base(f)}/${f.flow}/json`)
        .set('Authorization', `Bearer ${f.token}`);
    expect((await download()).body).toEqual(definition);
    r.state.assetUrl = 'https://attacker.example/steal';
    const before = r.fetch.mock.calls.length;
    expect((await download()).status).toBe(502);
    expect(r.fetch.mock.calls.length - before).toBe(2);
  });
  it('validates identifiers, JSON and permissions before provider effects', async () => {
    const f = await fixture(),
      r = remote(f);
    await sync(f);
    const upload = (flowJson: any) =>
      request(app)
        .put(`${base(f)}/${f.flow}/json`)
        .set('Authorization', `Bearer ${f.token}`)
        .set('Idempotency-Key', randomUUID())
        .send({ flowJson });
    expect((await upload({ version: '7.3', screens: [] })).status).toBe(400);
    expect(
      (await upload({ ...definition, screens: [definition.screens[0], definition.screens[0]] }))
        .status,
    ).toBe(400);
    expect(r.state.uploads).toBe(0);
    expect(
      (
        await request(app)
          .get(`${base(f)}/../../bad`)
          .set('Authorization', `Bearer ${f.token}`)
      ).status,
    ).toBe(404);
    const agent = await businessFixture(['vendor.contacts.view']);
    expect(
      (
        await request(app)
          .get(`/api/v1/vendors/${agent.vendorId}/meta-flows/${f.phone}`)
          .set('Authorization', `Bearer ${agent.token}`)
      ).status,
    ).toBe(403);
  });
  it('replays successful deletion without repeating the provider delete', async () => {
    const f = await fixture(),
      r = remote(f);
    await sync(f);
    const key = randomUUID();
    expect((await change(f, `/${f.flow}/delete`, {}, key)).status).toBe(200);
    expect((await change(f, `/${f.flow}/delete`, {}, key)).status).toBe(200);
    expect(r.fetch.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1);
  });
});
describe('published Meta Flow messages and response correlation', () => {
  async function recipient(f: Fixture) {
    const contact = await db.contacts.create({
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
        contactId: contact.id,
        contactWaId: contact.waId,
        wabPhoneNumberId: f.phone,
        type: 'text',
        message: 'Send form',
        isIncomingMessage: true,
        messagedAt: new Date(),
      },
    });
    return contact;
  }
  async function published(f: Fixture) {
    await db.nativeMetaFlows.create({
      data: {
        id: f.flow,
        vendorId: f.vendorId,
        wabaId: f.waba,
        name: 'Support form',
        status: 'PUBLISHED',
        categories: ['CUSTOMER_SUPPORT'],
        flowJson: definition,
      },
    });
  }
  const send = (f: Fixture, contactId: number, key = randomUUID()) =>
    request(app)
      .post(`/api/v1/vendors/${f.vendorId}/messages/send`)
      .set('Authorization', `Bearer ${f.token}`)
      .set('Idempotency-Key', key)
      .send({
        contactId,
        phoneNumberId: f.phone,
        kind: 'flow',
        flow: { id: f.flow, body: 'Please complete this form', cta: 'Open form' },
      });
  async function response(f: Fixture, from: string, token: string) {
    await ingestMeta({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: f.phone },
                messages: [
                  {
                    id: `wamid.${randomUUID()}`,
                    from,
                    type: 'interactive',
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    interactive: {
                      nfm_reply: {
                        response_json: JSON.stringify({
                          flow_token: token,
                          flow_id: '999999',
                          answer: 'Complete',
                        }),
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
  it('queues a published static flow once with a token bound to the exact contact and number', async () => {
    const f = await fixture(),
      r = remote(f);
    r.state.status = 'PUBLISHED';
    await published(f);
    const c = await recipient(f),
      key = randomUUID(),
      queued = await send(f, c.id, key);
    expect(queued.status).toBe(202);
    expect((await send(f, c.id, key)).body).toEqual(queued.body);
    const job = await db.outboxJobs.findFirstOrThrow({
        where: { vendorId: f.vendorId, kind: 'whatsapp-send' },
      }),
      p = job.payload as any,
      parameters = p.payload.interactive.action.parameters;
    expect(parameters.flow_action).toBe('navigate');
    expect(parameters.flow_action_payload.screen).toBe('WELCOME');
    expect(parameters.flow_id).toBe(f.flow);
    await processJob(job);
    await processJob(job);
    expect(r.fetch.mock.calls.filter(([url]) => url.pathname.endsWith('/messages'))).toHaveLength(
      1,
    );
    await response(f, c.waId!, parameters.flow_token);
    await response(f, c.waId!, parameters.flow_token);
    const replies = await db.whatsappFlowResponses.findMany({ where: { vendorId: f.vendorId } });
    expect(replies).toHaveLength(1);
    expect(replies[0].flowId).toBe(f.flow);
    expect(replies[0].contactId).toBe(c.id);
  });
  it('does not assign a submitted form to another contact through forged flow IDs or tokens', async () => {
    const f = await fixture(),
      r = remote(f);
    r.state.status = 'PUBLISHED';
    await published(f);
    const c = await recipient(f);
    await send(f, c.id);
    const job = await db.outboxJobs.findFirstOrThrow({
        where: { vendorId: f.vendorId, kind: 'whatsapp-send' },
      }),
      token = (job.payload as any).payload.interactive.action.parameters.flow_token;
    await response(f, '919876543211', token);
    await response(f, c.waId!, 'forged-token');
    expect(await db.whatsappFlowResponses.count({ where: { vendorId: f.vendorId } })).toBe(0);
    await response(f, c.waId!, token);
    expect(await db.whatsappFlowResponses.count({ where: { vendorId: f.vendorId } })).toBe(1);
  });
  it('cancels an already queued launch after flow revision/status changes without contacting the provider', async () => {
    const f = await fixture(),
      r = remote(f);
    r.state.status = 'PUBLISHED';
    await published(f);
    const c = await recipient(f);
    const queued = await send(f, c.id);
    await db.nativeMetaFlows.update({
      where: { id: f.flow },
      data: { status: 'DEPRECATED', revision: { increment: 1 } },
    });
    const job = await db.outboxJobs.findFirstOrThrow({
      where: { vendorId: f.vendorId, kind: 'whatsapp-send' },
    });
    await processJob(job);
    expect(r.fetch.mock.calls.filter(([url]) => url.pathname.endsWith('/messages'))).toHaveLength(
      0,
    );
    expect(
      (await db.whatsappMessageLogs.findUniqueOrThrow({ where: { id: queued.body.id } })).status,
    ).toBe('cancelled');
  });
});
