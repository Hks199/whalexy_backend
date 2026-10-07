import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { digest, decrypt } from '../src/utils/crypto.js';
import { businessFixture } from './fixtures.js';
const app = createApp(),
  token = 'provider-verified-test-access-token';
beforeEach(() => {
  vi.stubEnv('META_APP_ID', '123456');
  vi.stubEnv('META_APP_SECRET', 'app-secret-test-only');
  vi.stubEnv('META_SIGNUP_CONFIG_ID', '234567');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
afterAll(() => db.$disconnect());
async function fixture() {
  const f = await businessFixture();
  return { ...f, phone: `9911${f.vendorId}`, waba: `9922${f.vendorId}` };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const base = (f: Fixture) => `/api/v1/vendors/${f.vendorId}/integrations/meta/signup`;
async function start(f: Fixture) {
  return request(app)
    .post(`${base(f)}/start`)
    .set('Authorization', `Bearer ${f.token}`)
    .send({});
}
function complete(f: Fixture, state: string, key = randomUUID()) {
  return request(app)
    .post(`${base(f)}/complete`)
    .set('Authorization', `Bearer ${f.token}`)
    .set('Idempotency-Key', key)
    .send({
      state,
      code: 'test-single-use-provider-code',
      wabaId: f.waba,
      phoneNumberId: f.phone,
      pin: '123456',
    });
}
function remote(f: Fixture) {
  const state = {
    appId: '123456',
    valid: true,
    phone: f.phone,
    scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'],
    interrupt: false,
  };
  const fetch = vi.fn(async (url: URL, init: RequestInit = {}) => {
    let result: any;
    if (url.pathname.endsWith('oauth/access_token')) result = { access_token: token };
    else if (url.pathname.endsWith('debug_token'))
      result = {
        data: {
          app_id: state.appId,
          is_valid: state.valid,
          scopes: state.scopes,
          expires_at: Math.floor(Date.now() / 1000) + 86400,
        },
      };
    else if (url.pathname.endsWith('phone_numbers')) result = { data: [{ id: state.phone }] };
    else if (url.pathname.endsWith('subscribed_apps')) {
      expect(init.method).toBe('POST');
      result = { success: true };
    } else if (url.pathname.endsWith('register')) {
      expect(new URLSearchParams(String(init.body)).get('pin')).toBe('123456');
      if (state.interrupt) throw Error('registration response lost');
      result = { success: true };
    } else throw Error('Unexpected provider resource');
    return new Response(JSON.stringify(result));
  });
  vi.stubGlobal('fetch', fetch);
  return { state, fetch };
}
describe('verified WhatsApp embedded signup', () => {
  it('binds state to a session, verifies and registers assets, stores encrypted credentials only', async () => {
    const f = await fixture(),
      r = remote(f),
      started = await start(f);
    expect(started.status).toBe(201);
    const url = new URL(started.body.authorizationUrl);
    expect(url.hostname).toBe('www.facebook.com');
    expect(url.searchParams.get('state')).toBe(started.body.state);
    expect(url.searchParams.has('client_secret')).toBe(false);
    const response = await complete(f, started.body.state);
    expect(response.status).toBe(201);
    expect(response.text).not.toContain(token);
    expect(response.text).not.toContain('123456');
    const credential = await db.integrationCredentials.findUniqueOrThrow({
      where: {
        vendorId_provider_externalId: {
          vendorId: f.vendorId,
          provider: 'whatsapp',
          externalId: f.phone,
        },
      },
    });
    expect(credential.secret).not.toBe(token);
    expect(decrypt(credential.secret)).toBe(token);
    expect(
      (
        await db.whatsappOnboardingConnections.findUniqueOrThrow({
          where: { phoneNumberId: f.phone },
        })
      ).status,
    ).toBe('CONNECTED');
    expect((await complete(f, started.body.state)).status).toBe(401);
    expect(r.fetch).toHaveBeenCalledTimes(5);
  });
  it('rejects foreign, expired and simultaneously consumed state before code exchange', async () => {
    const f = await fixture(),
      other = await fixture(),
      r = remote(f),
      started = await start(f),
      state = started.body.state;
    expect((await complete(other, state)).status).toBe(401);
    expect(r.fetch).not.toHaveBeenCalled();
    const results = await Promise.all([complete(f, state), complete(f, state)]);
    expect(results.map((v) => v.status).sort()).toEqual([201, 401]);
    expect(
      r.fetch.mock.calls.filter(([url]) => url.pathname.endsWith('oauth/access_token')),
    ).toHaveLength(1);
    const expired = (await start(f)).body.state;
    await db.nativeIdempotency.update({
      where: { vendorId_key: { vendorId: f.vendorId, key: `meta-signup:${digest(expired)}` } },
      data: { response: { stage: 'issued', actorId: f.userId, sessionId: 'wrong', expiresAt: 0 } },
    });
    expect((await complete(f, expired)).status).toBe(401);
  });
  it('does not register tokens from another app or without required scopes', async () => {
    const f = await fixture(),
      r = remote(f);
    r.state.appId = '999999';
    expect((await complete(f, (await start(f)).body.state)).status).toBe(403);
    r.state.appId = '123456';
    r.state.scopes = ['whatsapp_business_management'];
    expect((await complete(f, (await start(f)).body.state)).status).toBe(403);
    expect(r.fetch.mock.calls.some(([url]) => url.pathname.endsWith('register'))).toBe(false);
    expect(await db.integrationCredentials.count({ where: { vendorId: f.vendorId } })).toBe(0);
  });
  it('checks phone ownership and globally reserved onboarding ownership before mutations', async () => {
    const f = await fixture(),
      other = await fixture(),
      r = remote(f);
    r.state.phone = other.phone;
    expect((await complete(f, (await start(f)).body.state)).status).toBe(403);
    r.state.phone = f.phone;
    await db.whatsappOnboardingConnections.create({
      data: {
        onboardingId: randomUUID(),
        vendorId: other.vendorId,
        wabaId: other.waba,
        phoneNumberId: f.phone,
        status: 'CONNECTED',
      },
    });
    expect((await complete(f, (await start(f)).body.state)).status).toBe(409);
    expect(r.fetch.mock.calls.some(([url]) => url.pathname.endsWith('subscribed_apps'))).toBe(
      false,
    );
  });
  it('retains an encrypted token after uncertain registration without activating the number or retrying it', async () => {
    const f = await fixture(),
      r = remote(f),
      started = await start(f);
    r.state.interrupt = true;
    expect((await complete(f, started.body.state)).body.error.code).toBe('PROVIDER_UNCERTAIN');
    expect(await db.integrationCredentials.count({ where: { vendorId: f.vendorId } })).toBe(0);
    expect(
      (
        await db.whatsappOnboardingConnections.findUniqueOrThrow({
          where: { phoneNumberId: f.phone },
        })
      ).status,
    ).toBe('TOKEN_VERIFIED');
    const proof = await db.nativeIdempotency.findUniqueOrThrow({
      where: {
        vendorId_key: { vendorId: f.vendorId, key: `meta-signup:${digest(started.body.state)}` },
      },
    });
    expect(decrypt((proof.response as any).envelope)).toBe(token);
    r.state.interrupt = false;
    expect((await complete(f, (await start(f)).body.state)).body.error.code).toBe(
      'PROVIDER_RECONCILIATION_REQUIRED',
    );
    expect(r.fetch.mock.calls.filter(([url]) => url.pathname.endsWith('register'))).toHaveLength(1);
  });
  it('requires owner permissions, server configuration and idempotency before consuming state', async () => {
    const f = await fixture(),
      r = remote(f),
      agent = await businessFixture(['vendor.whatsapp_setup.manage']);
    expect(
      (
        await request(app)
          .post(`/api/v1/vendors/${agent.vendorId}/integrations/meta/signup/start`)
          .set('Authorization', `Bearer ${agent.token}`)
          .send({})
      ).status,
    ).toBe(403);
    vi.stubEnv('META_SIGNUP_CONFIG_ID', '');
    expect((await start(f)).status).toBe(503);
    vi.stubEnv('META_SIGNUP_CONFIG_ID', '234567');
    const state = (await start(f)).body.state;
    expect(
      (
        await request(app)
          .post(`${base(f)}/complete`)
          .set('Authorization', `Bearer ${f.token}`)
          .send({ state, code: 'x', wabaId: f.waba, phoneNumberId: f.phone, pin: '123456' })
      ).status,
    ).toBe(400);
    expect(r.fetch).not.toHaveBeenCalled();
    expect((await complete(f, state)).status).toBe(201);
  });
});
