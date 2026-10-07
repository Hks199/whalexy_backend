import {
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  publicEncrypt,
  constants,
  createCipheriv,
  createDecipheriv,
  createHmac,
} from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { config } from '../src/config/environment.js';
import { db } from '../src/database/client.js';
import { encrypt, decrypt, digest } from '../src/utils/crypto.js';
import { businessFixture } from './fixtures.js';
import { ingestMeta } from '../src/jobs/handlers/meta-webhook.handler.js';
import { validateEndpoint } from '../src/modules/flow-data/services/endpoint-definition.js';

const app = createApp(),
  pair = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
const originalSecret = config.META_APP_SECRET,
  originalPublic = config.PUBLIC_URL;
beforeEach(() => {
  config.META_APP_SECRET = 'test-flow-app-secret';
  config.PUBLIC_URL = 'https://backend.example.com';
});
afterEach(() => {
  config.META_APP_SECRET = originalSecret;
  config.PUBLIC_URL = originalPublic;
  vi.unstubAllGlobals();
});
afterAll(() => db.$disconnect());
const definition = {
  version: '7.3',
  data_api_version: '3.0',
  routing_model: { START: ['CONFIRM'], CONFIRM: [] },
  screens: [
    {
      id: 'START',
      data: { title: { type: 'string', __example__: 'Enter your name' } },
      layout: { type: 'SingleColumnLayout', children: [] },
    },
    {
      id: 'CONFIRM',
      terminal: true,
      success: true,
      data: { name: { type: 'string', __example__: 'Ada' } },
      layout: { type: 'SingleColumnLayout', children: [] },
    },
  ],
};
const setup = {
  initialScreen: 'START',
  screens: [
    {
      id: 'START',
      data: { title: 'Enter your name' },
      bindings: { name: 'name' },
      nextScreen: 'CONFIRM',
      complete: false,
    },
    { id: 'CONFIRM', data: { name: '' }, bindings: { accepted: 'accepted' }, complete: true },
  ],
};
async function fixture() {
  const f = await businessFixture(),
    phone = `9955${f.vendorId}`,
    waba = `9966${f.vendorId}`,
    flow = `9977${f.vendorId}`,
    token = randomBytes(48).toString('base64url');
  const credential = await db.integrationCredentials.create({
    data: {
      vendorId: f.vendorId,
      provider: 'whatsapp',
      externalId: phone,
      secret: encrypt('test-whatsapp-access-token'),
      metadata: {
        wabaId: waba,
        flowEncryption: {
          active: { publicKey: pair.publicKey, envelope: encrypt(pair.privateKey) },
        },
      },
    },
  });
  const contact = await db.contacts.create({
    data: {
      vendorId: f.vendorId,
      waId: '919876543210',
      platform: 'whatsapp',
      wabPhoneNumberId: phone,
    },
  });
  await db.nativeMetaFlows.create({
    data: {
      id: flow,
      vendorId: f.vendorId,
      wabaId: waba,
      name: 'Secure form',
      categories: ['OTHER'],
      status: 'PUBLISHED',
      flowJson: definition,
      endpointUri: `${config.PUBLIC_URL}/webhooks/flows/${credential.id}`,
    },
  });
  await db.webhookReceipts.create({
    data: {
      provider: 'flow-data-config',
      eventKey: `flow-data-config:${f.vendorId}:${flow}`,
      payload: setup,
    },
  });
  const proof = await db.nativeIdempotency.create({
    data: {
      vendorId: f.vendorId,
      key: `flow-token:${digest(token)}`,
      requestHash: digest(token),
      response: {
        flowId: flow,
        revision: 1,
        contactId: contact.id,
        phoneNumberId: phone,
        expiresAt: Date.now() + 3600000,
      },
    },
  });
  return { ...f, phone, waba, flow, credential, contact, proof, flowToken: token };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function encrypted(body: any, publicKey = pair.publicKey) {
  const key = randomBytes(16),
    iv = randomBytes(16),
    cipher = createCipheriv('aes-128-gcm', key, iv),
    data = Buffer.concat([
      cipher.update(JSON.stringify(body)),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
  return {
    key,
    iv,
    payload: {
      encrypted_aes_key: publicEncrypt(
        { key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
        key,
      ).toString('base64'),
      encrypted_flow_data: data.toString('base64'),
      initial_vector: iv.toString('base64'),
    },
  };
}
function clear(text: string, key: Buffer, iv: Buffer) {
  const data = Buffer.from(text, 'base64'),
    cipher = createDecipheriv('aes-128-gcm', key, Buffer.from(iv.map((b) => b ^ 255)));
  cipher.setAuthTag(data.subarray(-16));
  return JSON.parse(
    Buffer.concat([cipher.update(data.subarray(0, -16)), cipher.final()]).toString(),
  );
}
function transport(f: Fixture, payload: any, signature?: string) {
  const raw = JSON.stringify(payload);
  return request(app)
    .post(`/webhooks/flows/${f.credential.id}`)
    .set('Content-Type', 'application/json')
    .set(
      'X-Hub-Signature-256',
      signature ??
        `sha256=${createHmac('sha256', config.META_APP_SECRET).update(raw).digest('hex')}`,
    )
    .send(raw);
}
async function exchange(f: Fixture, action: string, data: any = {}, screen?: string) {
  const e = encrypted({
      version: '3.0',
      action,
      data,
      flow_token: f.flowToken,
      ...(screen ? { screen } : {}),
    }),
    response = await transport(f, e.payload);
  return {
    status: response.status,
    body:
      response.status === 200 || response.status === 427
        ? clear(response.text, e.key, e.iv)
        : response.body,
  };
}
function base(f: Fixture) {
  return `/api/v1/vendors/${f.vendorId}/meta-flows/${f.phone}`;
}
function provider(f: Fixture) {
  const state = {
    publicKey: '',
    lost: false,
    registrations: 0,
    status: 'DRAFT',
    endpointUpdates: 0,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL, init: RequestInit = {}) => {
      let result: any;
      if (url.pathname.endsWith('/phone_numbers')) result = { data: [{ id: f.phone }] };
      else if (url.pathname.endsWith('/whatsapp_business_encryption')) {
        if (init.method === 'POST') {
          state.registrations++;
          expect(init.body).toBeInstanceOf(FormData);
          state.publicKey = String((init.body as FormData).get('business_public_key'));
          if (state.lost) throw Error('lost');
          result = { success: true };
        } else
          result = {
            data: [
              {
                business_public_key: state.publicKey,
                business_public_key_signature_status: 'VALID',
              },
            ],
          };
      } else if (url.pathname.endsWith(`/${f.flow}`)) {
        if (init.method === 'POST') {
          state.endpointUpdates++;
          expect((init.body as FormData).get('endpoint_uri')).toBe(
            `${config.PUBLIC_URL}/webhooks/flows/${f.credential.id}`,
          );
          result = { success: true };
        } else result = { id: f.flow, status: state.status };
      } else throw Error('Unexpected provider request');
      return new Response(JSON.stringify(result));
    }),
  );
  return state;
}
describe('encrypted Meta Flow transport and sessions', () => {
  it('handles signed encrypted health and error notifications without form tokens', async () => {
    const f = await fixture();
    for (const [body, expected] of [
      [{ action: 'ping' }, { data: { status: 'active' } }],
      [
        { action: 'data_exchange', data: { error: 'screen error' } },
        { data: { acknowledged: true } },
      ],
    ] as any) {
      const e = encrypted(body),
        r = await transport(f, e.payload);
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toContain('text/plain');
      expect(clear(r.text, e.key, e.iv)).toEqual(expected);
    }
  });
  it('rejects signatures before decryption and returns 421 for altered ciphertext or invalid base64', async () => {
    const f = await fixture(),
      e = encrypted({ action: 'ping' });
    expect((await transport(f, { invalid: true }, 'sha256=00')).status).toBe(432);
    e.payload.encrypted_flow_data = Buffer.from('not valid authenticated ciphertext').toString(
      'base64',
    );
    expect((await transport(f, e.payload)).status).toBe(421);
    e.payload.initial_vector = 'garbage';
    expect((await transport(f, e.payload)).status).toBe(421);
    config.META_APP_SECRET = '';
    expect((await transport(f, e.payload, 'sha256=00')).status).toBe(503);
  });
  it('routes INIT, accepts only bound fields, completes and correlates one signed completion', async () => {
    const f = await fixture();
    expect((await exchange(f, 'INIT')).body).toEqual({
      screen: 'START',
      data: { title: 'Enter your name' },
    });
    expect(
      (
        await exchange(
          f,
          'data_exchange',
          { name: 'Ada', flow_id: 'attacker', secret: 'unbound' },
          'START',
        )
      ).body,
    ).toEqual({ screen: 'CONFIRM', data: { name: 'Ada' } });
    const done = await exchange(f, 'data_exchange', { accepted: true }, 'CONFIRM');
    expect(done.body).toEqual({
      screen: 'SUCCESS',
      data: {
        extension_message_response: {
          params: { name: 'Ada', accepted: true, flow_token: f.flowToken },
        },
      },
    });
    expect((await exchange(f, 'data_exchange', { accepted: true }, 'CONFIRM')).body).toEqual(
      done.body,
    );
    const receive = () =>
      ingestMeta({
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: f.phone },
                  messages: [
                    {
                      id: `wamid.${randomUUID()}`,
                      from: f.contact.waId,
                      type: 'interactive',
                      timestamp: String(Math.floor(Date.now() / 1000)),
                      interactive: {
                        nfm_reply: {
                          response_json: JSON.stringify(
                            done.body.data.extension_message_response.params,
                          ),
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
    await receive();
    await receive();
    expect(
      await db.whatsappFlowResponses.count({ where: { vendorId: f.vendorId, flowId: f.flow } }),
    ).toBe(1);
    expect((await exchange(f, 'INIT')).status).toBe(427);
  });
  it('serializes concurrent retries and supports bounded back navigation', async () => {
    const f = await fixture();
    await exchange(f, 'INIT');
    const replies = await Promise.all([
      exchange(f, 'data_exchange', { name: 'Ada' }, 'START'),
      exchange(f, 'data_exchange', { name: 'Ada' }, 'START'),
    ]);
    expect(replies.map((r) => r.status)).toEqual([200, 200]);
    expect(replies[0].body).toEqual(replies[1].body);
    let state = (await db.nativeIdempotency.findUniqueOrThrow({ where: { id: f.proof.id } }))
      .response as any;
    expect(state.endpointState.steps).toBe(2);
    expect((await exchange(f, 'BACK', {}, 'CONFIRM')).body.screen).toBe('START');
    expect((await exchange(f, 'BACK', {}, 'START')).status).toBe(427);
    expect((await exchange(f, 'data_exchange', { name: 'Grace' }, 'START')).body.data.name).toBe(
      'Grace',
    );
  });
  it('rejects expired, consumed, wrong-number, inactive-contact, changed-revision and wrong-account sessions', async () => {
    for (const change of [
      { expiresAt: 0 },
      { consumed: true },
      { phoneNumberId: '999999' },
      { revision: 0 },
      { flowId: '888888' },
    ]) {
      const f = await fixture();
      await db.nativeIdempotency.update({
        where: { id: f.proof.id },
        data: { response: { ...(f.proof.response as any), ...change } },
      });
      const r = await exchange(f, 'INIT');
      expect(r.status).toBe(427);
      expect(r.body.error_msg).toBe('This Flow session is no longer available');
    }
    const f = await fixture();
    await db.contacts.update({ where: { id: f.contact.id }, data: { status: 0 } });
    expect((await exchange(f, 'INIT')).status).toBe(427);
    await db.contacts.update({ where: { id: f.contact.id }, data: { status: 1 } });
    await db.vendors.update({ where: { id: f.vendorId }, data: { status: 0 } });
    expect((await exchange(f, 'INIT')).status).toBe(427);
  });
  it('rejects unsupported actions, skipped screens and non-scalar bound input without advancing', async () => {
    const f = await fixture();
    expect((await exchange(f, 'INIT')).status).toBe(200);
    expect((await exchange(f, 'execute')).status).toBe(427);
    expect((await exchange(f, 'data_exchange', { accepted: true }, 'CONFIRM')).status).toBe(427);
    expect((await exchange(f, 'data_exchange', { name: { script: 'bad' } }, 'START')).status).toBe(
      400,
    );
    expect((await exchange(f, 'data_exchange', {}, 'START')).status).toBe(400);
    expect((await exchange(f, 'data_exchange', { name: 'Safe' }, 'START')).status).toBe(200);
  });
});
describe('Flow encryption and endpoint configuration', () => {
  it('registers one public key, encrypts the retained private key and replays without registration', async () => {
    const f = await fixture();
    await db.integrationCredentials.update({
      where: { id: f.credential.id },
      data: { metadata: { wabaId: f.waba } },
    });
    const state = provider(f),
      key = randomUUID(),
      send = () =>
        request(app)
          .post(`${base(f)}/encryption-key`)
          .set('Authorization', `Bearer ${f.token}`)
          .set('Idempotency-Key', key)
          .send({});
    const r = await send();
    expect(r.status).toBe(201);
    expect((await send()).body).toEqual(r.body);
    expect(state.registrations).toBe(1);
    const row = await db.integrationCredentials.findUniqueOrThrow({
        where: { id: f.credential.id },
      }),
      stored = (row.metadata as any).flowEncryption.active;
    expect(stored.envelope).toMatch(/^v1\./);
    expect(decrypt(stored.envelope)).toContain('BEGIN PRIVATE KEY');
    expect(JSON.stringify(r.body)).not.toContain('PRIVATE KEY');
    expect(
      (
        await request(app)
          .get(`${base(f)}/encryption-key`)
          .set('Authorization', `Bearer ${f.token}`)
      ).body.providerMatched,
    ).toBe(true);
  });
  it('retains the pending private key after a lost provider response and reconciles only matching registration', async () => {
    const f = await fixture();
    await db.integrationCredentials.update({
      where: { id: f.credential.id },
      data: { metadata: { wabaId: f.waba } },
    });
    const state = provider(f);
    state.lost = true;
    const key = randomUUID(),
      send = (k = key) =>
        request(app)
          .post(`${base(f)}/encryption-key`)
          .set('Authorization', `Bearer ${f.token}`)
          .set('Idempotency-Key', k)
          .send({});
    expect((await send()).status).toBe(502);
    expect((await send(randomUUID())).status).toBe(409);
    const row = await db.integrationCredentials.findUniqueOrThrow({
        where: { id: f.credential.id },
      }),
      pending = (row.metadata as any).flowEncryption.pending;
    expect(pending.publicKey).toBe(state.publicKey);
    expect(decrypt(pending.envelope)).toContain('PRIVATE KEY');
    const remotePublic = state.publicKey;
    state.publicKey = pair.publicKey;
    const get = () =>
      request(app)
        .get(`${base(f)}/encryption-key`)
        .set('Authorization', `Bearer ${f.token}`);
    expect((await get()).body.pending).toBe(true);
    state.publicKey = remotePublic;
    expect((await get()).body.providerMatched).toBe(true);
    expect((await get()).body.pending).toBe(false);
    expect((await send()).status).toBe(201);
    expect(state.registrations).toBe(1);
    const e = encrypted({ action: 'ping' }, remotePublic),
      response = await transport(f, e.payload);
    expect(response.status).toBe(200);
    expect(clear(response.text, e.key, e.iv).data.status).toBe('active');
  });
  it('configures an owned draft using fixed HTTPS URI, rejects unsafe routing and invalidates old tokens', async () => {
    const f = await fixture(),
      state = provider(f);
    await db.nativeMetaFlows.update({ where: { id: f.flow }, data: { status: 'DRAFT' } });
    const put = (body: any = setup) =>
      request(app)
        .put(`${base(f)}/${f.flow}/data-endpoint`)
        .set('Authorization', `Bearer ${f.token}`)
        .set('Idempotency-Key', randomUUID())
        .send(body);
    expect((await put({ ...setup, initialScreen: 'MISSING' })).status).toBe(400);
    expect(state.endpointUpdates).toBe(0);
    expect((await put()).status).toBe(200);
    expect(state.endpointUpdates).toBe(1);
    expect((await db.nativeMetaFlows.findUniqueOrThrow({ where: { id: f.flow } })).revision).toBe(
      2,
    );
    await db.nativeMetaFlows.update({ where: { id: f.flow }, data: { status: 'PUBLISHED' } });
    expect((await exchange(f, 'INIT')).status).toBe(427);
    expect(
      (
        await request(app)
          .get(`${base(f)}/${f.flow}/data-endpoint`)
          .set('Authorization', `Bearer ${f.token}`)
      ).body.configuration.initialScreen,
    ).toBe('START');
  });
  it('rejects unsafe config, unowned flows, nonowner configuration, missing keys and non-HTTPS registration', async () => {
    const f = await fixture();
    provider(f);
    expect(() =>
      validateEndpoint(definition, {
        ...setup,
        screens: [{ ...setup.screens[0], nextScreen: 'UNDECLARED' }, setup.screens[1]],
      }),
    ).toThrow();
    expect(() =>
      validateEndpoint(definition, {
        ...setup,
        screens: [{ ...setup.screens[0], bindings: { flow_token: 'token' } }, setup.screens[1]],
      }),
    ).toThrow();
    await db.nativeMetaFlows.update({ where: { id: f.flow }, data: { status: 'DRAFT' } });
    const put = () =>
      request(app)
        .put(`${base(f)}/${f.flow}/data-endpoint`)
        .set('Authorization', `Bearer ${f.token}`)
        .set('Idempotency-Key', randomUUID())
        .send(setup);
    config.PUBLIC_URL = 'http://localhost:3000';
    expect((await put()).status).toBe(503);
    config.PUBLIC_URL = 'https://backend.example.com';
    await db.integrationCredentials.update({
      where: { id: f.credential.id },
      data: { metadata: { wabaId: f.waba } },
    });
    expect((await put()).status).toBe(409);
    const agent = await businessFixture(['vendor.whatsapp_setup.manage']);
    expect(
      (
        await request(app)
          .post(`/api/v1/vendors/${agent.vendorId}/meta-flows/${f.phone}/encryption-key`)
          .set('Authorization', `Bearer ${agent.token}`)
          .set('Idempotency-Key', randomUUID())
          .send({})
      ).status,
    ).toBe(403);
  });
});
