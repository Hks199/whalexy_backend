import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { encrypt, decrypt, verifyHmac, digest } from '../src/utils/crypto.js';
import { createHmac } from 'node:crypto';
import { validateEnvironment } from '../src/config/environment.js';
import { providerRequest } from '../src/infrastructure/providers/meta.client.js';
const app = createApp();
afterEach(() => vi.unstubAllGlobals());
describe('provider response safety', () => {
  it('reports an interrupted response as uncertain without exposing provider details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error('sensitive-provider-details'));
            },
          }),
        ),
      ),
    );
    await expect(providerRequest(new URL('https://provider.example'))).rejects.toMatchObject({
      code: 'PROVIDER_UNCERTAIN',
      status: 502,
    });
  });
  it('bounds provider response sizes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('x'.repeat(2_000_001))));
    await expect(providerRequest(new URL('https://provider.example'))).rejects.toMatchObject({
      code: 'PROVIDER_RESPONSE',
      status: 502,
    });
  });
});
describe('HTTP security boundaries', () => {
  it('sets security headers and removes framework identification', async () => {
    const r = await request(app).get('/health/live');
    expect(r.status).toBe(200);
    expect(r.headers['x-powered-by']).toBeUndefined();
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['content-security-policy']).toContain('default-src');
    expect(r.headers['x-request-id']).toBeTruthy();
  });
  it('rejects unapproved origins', async () =>
    expect(
      (await request(app).get('/health/live').set('Origin', 'https://attacker.example')).status,
    ).toBe(403));
  it('requires authentication before business access', async () =>
    expect((await request(app).get('/api/v1/vendors/1/contacts')).status).toBe(401));
  it('rejects invalid bearer tokens', async () =>
    expect(
      (await request(app).get('/api/v1/vendors/1/contacts').set('Authorization', 'Bearer invalid'))
        .status,
    ).toBe(401));
  it('does not expose the Laravel public maintenance endpoints', async () => {
    for (const p of ['/run-migrations', '/view-error-log', '/clear-system-cache'])
      expect((await request(app).get(p)).status).toBe(404);
  });
  it('rejects malformed JSON without returning stack traces', async () => {
    const r = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{bad');
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).not.toContain('SyntaxError');
  });
  it('rejects role and permission mass assignment during registration', async () => {
    const r = await request(app).post('/api/v1/auth/register').send({
      name: 'User',
      email: 'valid@example.com',
      password: 'StrongPasswordForTesting!',
      phoneNumber: '+919876543210',
      businessName: 'Business',
      role: 'admin',
    });
    expect(r.status).toBe(400);
  });
  it('verifies webhooks against exact raw bytes', async () => {
    const r = await request(app)
      .post('/webhooks/meta')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', 'sha256=invalid')
      .send('{"object":"page","entry":[]}');
    expect(r.status).toBe(401);
  });
  it('fails closed when payment provider is unknown', async () =>
    expect((await request(app).post('/webhooks/payments/unknown').send({})).status).toBe(404));
});
describe('cryptographic and configuration controls', () => {
  it('encrypts credentials with authenticated encryption', () => {
    const s = encrypt('private-provider-token');
    expect(s).not.toContain('private-provider-token');
    expect(decrypt(s)).toBe('private-provider-token');
    const parts = s.split('.');
    parts[2] = Buffer.alloc(16).toString('base64url');
    expect(() => decrypt(parts.join('.'))).toThrow();
  });
  it('rejects signatures after payload tampering', () => {
    const raw = Buffer.from('{"id":1}'),
      sig = createHmac('sha256', 'secret').update(raw).digest('hex');
    expect(verifyHmac(raw, sig, 'secret')).toBe(true);
    expect(verifyHmac(Buffer.from('{"id":2}'), sig, 'secret')).toBe(false);
    expect(verifyHmac(raw, sig, '')).toBe(false);
  });
  it('stores deterministic token hashes rather than the tokens', () => {
    expect(digest('private-token')).not.toContain('private-token');
    expect(digest('private-token')).toHaveLength(64);
  });
  it('rejects wildcard CORS and insecure production URLs', () => {
    expect(() => validateEnvironment({ ...process.env, CORS_ORIGINS: '*' })).toThrow();
    expect(() =>
      validateEnvironment({
        ...process.env,
        NODE_ENV: 'production',
        PUBLIC_URL: 'http://example.com',
      }),
    ).toThrow();
    expect(() => validateEnvironment({ ...process.env, JWT_SECRET: 'short' })).toThrow();
  });
});
