import { beforeEach, afterEach, afterAll, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { db } from '../src/database/client.js';
import { createApp } from '../src/app.js';
import { config } from '../src/config/environment.js';
import { digest } from '../src/utils/crypto.js';
import { isPublicKnowledgeAddress } from '../src/modules/knowledge/services/knowledge-website.service.js';
import { businessFixture } from './fixtures.js';

const dns = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: dns.lookup }));
const app = createApp();
const previous = { url: config.WHALEXY_AI_SERVICE_URL, key: config.WHALEXY_AI_API_KEY };
beforeEach(() => {
  config.WHALEXY_AI_SERVICE_URL = 'https://knowledge-provider.test';
  config.WHALEXY_AI_API_KEY = 'test-internal-knowledge-key';
  dns.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
});
afterEach(() => {
  config.WHALEXY_AI_SERVICE_URL = previous.url;
  config.WHALEXY_AI_API_KEY = previous.key;
  dns.lookup.mockReset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
afterAll(async () => db.$disconnect());
async function fixture() {
  const owner = await businessFixture();
  await db.manualSubscriptions.create({
    data: { vendorId: owner.vendorId, status: 'active', endsAt: new Date(Date.now() + 3600000) },
  });
  await db.subscriptionAddons.create({
    data: {
      vendorId: owner.vendorId,
      addonCode: 'ai_replies',
      source: 'admin_override',
      status: 'active',
      price: 0,
    },
  });
  return owner;
}
const endpoint = (f: { vendorId: number }, path = '') =>
  `/api/v1/vendors/${f.vendorId}/knowledge${path}`;
const auth = (f: { token: string }) => `Bearer ${f.token}`;
const response = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
describe('AI knowledge ingestion HTTP workflows', () => {
  it('checks authentication, business membership and paid AI entitlement before provider calls', async () => {
    const owner = await businessFixture(),
      other = await businessFixture();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect((await request(app).get(endpoint(owner, '/list'))).status).toBe(401);
    expect(
      (await request(app).get(endpoint(owner, '/list')).set('Authorization', auth(other))).status,
    ).toBe(403);
    expect(
      (await request(app).get(endpoint(owner, '/list')).set('Authorization', auth(owner))).status,
    ).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['txt', 'pdf', 'docx'])(
    'uploads verified %s content with multipart metadata and replays its acknowledgement',
    async (extension) => {
      const owner = await fixture(),
        key = randomUUID();
      const bytes =
        extension === 'docx'
          ? await readFile(new URL('./fixtures/knowledge.docx', import.meta.url))
          : Buffer.from(extension === 'pdf' ? '%PDF-1.7\nKnowledge fixture' : 'Knowledge fixture');
      const fetch = vi.fn().mockResolvedValue(response({ document_id: 'doc_123' }));
      vi.stubGlobal('fetch', fetch);
      const upload = () =>
        request(app)
          .post(endpoint(owner, '/upload'))
          .set('Authorization', auth(owner))
          .set('Idempotency-Key', key)
          .attach('file', bytes, `guide.${extension}`);
      const result = await upload();
      expect(result.status).toBe(200);
      expect(result.body).toEqual({ document_id: 'doc_123', success: true, status: 'success' });
      const [url, init] = fetch.mock.calls[0]!;
      expect(String(url)).toBe(
        `https://knowledge-provider.test/v1/vendors/${owner.vendorId}/knowledge/upload`,
      );
      expect(init.headers).toEqual({ 'X-Internal-API-Key': 'test-internal-knowledge-key' });
      expect(init.body).toBeInstanceOf(FormData);
      expect(init.body.get('title')).toBe(`guide.${extension}`);
      expect(init.body.get('category')).toBe('general');
      expect(init.body.get('language')).toBe('en');
      expect(await init.body.get('file').text()).toBe(bytes.toString());
      expect((await upload()).body).toEqual(result.body);
      expect(fetch).toHaveBeenCalledTimes(1);
      const changed = await request(app)
        .post(endpoint(owner, '/upload'))
        .set('Authorization', auth(owner))
        .set('Idempotency-Key', key)
        .attach('file', Buffer.from('Different'), 'changed.txt');
      expect(changed.status).toBe(409);
    },
  );
  it('rejects absent files, spoofed types, binary text, unexpected fields and missing request keys', async () => {
    const owner = await fixture(),
      fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const upload = () =>
      request(app)
        .post(endpoint(owner, '/upload'))
        .set('Authorization', auth(owner))
        .set('Idempotency-Key', randomUUID());
    expect((await upload()).status).toBe(422);
    expect((await upload().attach('file', Buffer.from('not a PDF'), 'fake.pdf')).status).toBe(422);
    expect((await upload().attach('file', Buffer.from([1, 0, 2]), 'binary.txt')).status).toBe(422);
    expect(
      (await upload().attach('file', Buffer.from([0xff, 0xfe, 0xff]), 'invalid.txt')).status,
    ).toBe(422);
    expect(
      (await upload().field('vendorId', 1).attach('file', Buffer.from('hello'), 'text.txt')).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post(endpoint(owner, '/upload'))
          .set('Authorization', auth(owner))
          .attach('file', Buffer.from('hello'), 'text.txt')
      ).status,
    ).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('blocks uploads over 10 MB before contacting the provider', async () => {
    const owner = await fixture(),
      fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(
      (
        await request(app)
          .post(endpoint(owner, '/upload'))
          .set('Authorization', auth(owner))
          .set('Idempotency-Key', randomUUID())
          .attach('file', Buffer.alloc(10 * 1024 * 1024 + 1, 'x'), 'too-large.txt')
      ).status,
    ).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('queues public website ingestion with source field names and preserves acknowledgements', async () => {
    const owner = await fixture(),
      key = randomUUID(),
      fetch = vi.fn().mockResolvedValue(response({ document_id: 'website_1' }));
    vi.stubGlobal('fetch', fetch);
    const ingest = () =>
      request(app)
        .post(endpoint(owner, '/website'))
        .set('Authorization', auth(owner))
        .set('Idempotency-Key', key)
        .send({ website_url: 'https://public-business.com/docs', title: 'Business guide' });
    const result = await ingest();
    expect(result.status).toBe(202);
    expect(result.body.document_id).toBe('website_1');
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toContain(`/v1/vendors/${owner.vendorId}/knowledge/website`);
    expect(JSON.parse(init.body)).toEqual({
      website_url: 'https://public-business.com/docs',
      title: 'Business guide',
      category: 'general',
      language: 'en',
    });
    expect((await ingest()).body).toEqual(result.body);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(dns.lookup).toHaveBeenCalledTimes(1);
  });
  it('rejects private URLs, credentials, nonstandard ports, private/mixed DNS answers and lookup failures', async () => {
    const owner = await fixture(),
      fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const ingest = (url: string) =>
      request(app)
        .post(endpoint(owner, '/website'))
        .set('Authorization', auth(owner))
        .set('Idempotency-Key', randomUUID())
        .send({ websiteUrl: url });
    for (const url of [
      'http://127.0.0.1',
      'http://2130706433',
      'http://[::1]',
      'https://user:pass@business.com',
      'https://business.com:8443/',
      'https://service.internal',
    ])
      expect((await ingest(url)).status).toBe(422);
    dns.lookup.mockResolvedValue([{ address: '10.0.0.1', family: 4 }]);
    expect((await ingest('https://business.com')).status).toBe(422);
    dns.lookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '::ffff:127.0.0.1', family: 6 },
    ]);
    expect((await ingest('https://business.com')).status).toBe(422);
    dns.lookup.mockRejectedValue(new Error('DNS failure'));
    expect((await ingest('https://business.com')).status).toBe(422);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('classifies IPv4 and IPv6 special-use addresses conservatively', () => {
    for (const address of [
      '127.0.0.1',
      '10.0.0.1',
      '100.64.0.1',
      '169.254.169.254',
      '192.168.1.1',
      '198.18.0.1',
      '203.0.113.1',
      '::1',
      'fc00::1',
      'fe80::1',
      '::ffff:10.0.0.1',
      '2002:0a00::1',
      '2001:db8::1',
      '2001:2::1',
      'invalid',
    ])
      expect(isPublicKnowledgeAddress(address)).toBe(false);
    expect(isPublicKnowledgeAddress('93.184.216.34')).toBe(true);
    expect(isPublicKnowledgeAddress('2606:4700:4700::1111')).toBe(true);
  });
  it('never repeats an uncertain ingestion after a timeout or failed local acknowledgement write', async () => {
    const owner = await fixture(),
      fetch = vi.fn().mockRejectedValue(new Error('private provider failure'));
    vi.stubGlobal('fetch', fetch);
    const key = randomUUID();
    const upload = () =>
      request(app)
        .post(endpoint(owner, '/upload'))
        .set('Authorization', auth(owner))
        .set('Idempotency-Key', key)
        .attach('file', Buffer.from('Document'), 'document.txt');
    const failure = await upload();
    expect(failure.status).toBe(502);
    expect(JSON.stringify(failure.body)).not.toContain('private provider failure');
    expect((await upload()).status).toBe(409);
    expect(fetch).toHaveBeenCalledTimes(1);
    const anotherKey = randomUUID();
    fetch.mockResolvedValue(response({ document_id: 'accepted_1' }));
    vi.spyOn(db.nativeIdempotency, 'update').mockRejectedValueOnce(
      new Error('database commit failed'),
    );
    const another = () =>
      request(app)
        .post(endpoint(owner, '/upload'))
        .set('Authorization', auth(owner))
        .set('Idempotency-Key', anotherKey)
        .attach('file', Buffer.from('Another'), 'another.txt');
    expect((await another()).status).toBe(500);
    expect((await another()).status).toBe(409);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('serializes concurrent requests so a file is submitted once', async () => {
    const owner = await fixture(),
      key = randomUUID();
    let release!: () => void, started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetch = vi.fn().mockImplementation(async () => {
      started();
      await gate;
      return response({ document_id: 'one' });
    });
    vi.stubGlobal('fetch', fetch);
    const upload = () =>
      request(app)
        .post(endpoint(owner, '/upload'))
        .set('Authorization', auth(owner))
        .set('Idempotency-Key', key)
        .attach('file', Buffer.from('One file'), 'one.txt');
    const first = upload().then((result) => result);
    try {
      await ready;
      expect((await upload()).status).toBe(409);
    } finally {
      release();
    }
    expect((await first).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('serves original knowledge URLs with explicit workspace selection and scoped native API keys', async () => {
    const owner = await fixture(),
      other = await businessFixture();
    const key = randomUUID();
    await db.apiKeys.create({
      data: {
        vendorId: owner.vendorId,
        userId: owner.userId,
        keyHash: digest(key),
        permissions: ['vendor.ai.manage'],
      },
    });
    const fetch = vi
      .fn()
      .mockImplementation(async (url: URL, init: RequestInit) =>
        response(init.method === 'GET' ? [{ document_id: 'doc_1' }] : { document_id: 'doc_2' }),
      );
    vi.stubGlobal('fetch', fetch);
    const legacy = '/api/v1/vendor/knowledge';
    const listed = await request(app).get(`${legacy}/list`).set('Authorization', auth(owner));
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual({ success: true, documents: [{ document_id: 'doc_1' }] });
    const deleted = await request(app)
      .delete(`${legacy}/doc_1`)
      .set('Authorization', `ApiKey ${key}`)
      .set('X-Vendor-Id', String(owner.vendorId));
    expect(deleted.status).toBe(200);
    expect(deleted.body.success).toBe(true);
    const uploaded = await request(app)
      .post(`${legacy}/upload`)
      .set('Authorization', auth(owner))
      .set('Idempotency-Key', randomUUID())
      .attach('file', Buffer.from('Legacy knowledge'), 'legacy.txt');
    expect(uploaded.status).toBe(200);
    const website = await request(app)
      .post(`${legacy}/website`)
      .set('Authorization', `ApiKey ${key}`)
      .set('X-Vendor-Id', String(owner.vendorId))
      .set('Idempotency-Key', randomUUID())
      .send({ website_url: 'https://public-business.com', title: 'Legacy website' });
    expect(website.status).toBe(202);
    expect(
      (
        await request(app)
          .get(`${legacy}/list`)
          .set('Authorization', auth(owner))
          .set('X-Vendor-Id', String(other.vendorId))
      ).status,
    ).toBe(403);
    await db.nativeMemberships.create({
      data: {
        vendorId: other.vendorId,
        userId: owner.userId,
        role: 'agent',
        permissions: ['vendor.ai.manage'],
      },
    });
    expect(
      (await request(app).get(`${legacy}/list`).set('Authorization', auth(owner))).status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .get(`${legacy}/list`)
          .set('Authorization', auth(owner))
          .set('X-Vendor-Id', String(owner.vendorId))
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .delete(`${legacy}/bad%2Fid`)
          .set('Authorization', auth(owner))
          .set('X-Vendor-Id', String(owner.vendorId))
      ).status,
    ).toBe(400);
  });
  it('preserves rejected and malformed provider outcomes without exposing provider errors', async () => {
    const owner = await fixture();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    for (const providerResponse of [
      response({ success: false, detail: 'private-provider-content' }),
      response('malformed acknowledgement'),
      new Response('private-provider-content', { status: 400 }),
    ]) {
      const key = randomUUID();
      fetch.mockResolvedValueOnce(providerResponse);
      const upload = () =>
        request(app)
          .post(endpoint(owner, '/upload'))
          .set('Authorization', auth(owner))
          .set('Idempotency-Key', key)
          .attach('file', Buffer.from('Rejected'), 'rejected.txt');
      const rejected = await upload();
      expect(rejected.status).toBe(502);
      expect(JSON.stringify(rejected.body)).not.toContain('private-provider-content');
      expect((await upload()).status).toBe(409);
    }
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
