import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { config } from '../src/config/environment.js';
import { siteSettingDefinitions } from '../src/modules/configuration/services/site-settings.js';
import * as passwords from '../src/utils/passwords.js';
import { businessFixture } from './fixtures.js';

const app = createApp(),
  root = '/api/v1/admin/configuration',
  publicRoot = '/api/v1/public';
const keys = [...Object.keys(siteSettingDefinitions), 'smtp_mail_password_or_apikey'];
let saved: Awaited<ReturnType<typeof db.configurations.findMany>>;
let admin: Awaited<ReturnType<typeof businessFixture>>, owner: typeof admin;
const extraUsers: number[] = [],
  extraVendors: number[] = [],
  pageIds: number[] = [],
  postIds: number[] = [];
const headers = () => ({ Authorization: `Bearer ${admin.token}` });
const registration = () => ({
  name: 'Settings user',
  businessName: 'Settings workspace',
  email: `${randomUUID()}@example.com`,
  password: 'Test-password-2026!',
  phoneNumber: '+919876543210',
});
async function group(id: string) {
  const r = await request(app).get(`${root}/${id}`).set(headers());
  expect(r.status).toBe(200);
  return r.body;
}
async function update(id: string, settings: object, revision?: string) {
  return request(app)
    .patch(`${root}/${id}`)
    .set(headers())
    .send({ revision: revision ?? (await group(id)).revision, settings });
}
beforeAll(async () => {
  saved = await db.configurations.findMany({ where: { name: { in: keys } } });
  await db.configurations.deleteMany({ where: { name: { in: keys } } });
  [admin, owner] = await Promise.all([businessFixture(), businessFixture()]);
  await db.userRoles.upsert({
    where: { id: 1 },
    create: { id: 1, title: 'Site administrator' },
    update: {},
  });
  await db.users.update({ where: { id: admin.userId }, data: { userRolesId: 1 } });
  await db.configurations.create({
    data: {
      name: 'smtp_mail_password_or_apikey',
      value: 'private-secret-never-return',
      dataType: 1,
    },
  });
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await db.configurations.deleteMany({ where: { name: { in: keys } } });
  if (saved.length) await db.configurations.createMany({ data: saved });
  await db.pages.deleteMany({ where: { id: { in: pageIds } } });
  await db.blogPosts.deleteMany({ where: { id: { in: postIds } } });
  const users = [admin.userId, owner.userId, ...extraUsers],
    vendors = [admin.vendorId, owner.vendorId, ...extraVendors];
  await db.auditEvents.deleteMany({ where: { actorId: { in: users } } });
  const challenges = await db.verificationChallenges.findMany({
    where: { userId: { in: users } },
    select: { id: true },
  });
  for (const challenge of challenges)
    await db.outboxJobs.deleteMany({
      where: { payload: { path: ['challengeId'], equals: challenge.id } },
    });
  await db.verificationChallenges.deleteMany({ where: { userId: { in: users } } });
  await db.vendorUsers.deleteMany({ where: { vendorId: { in: vendors } } });
  await db.nativeMemberships.deleteMany({ where: { userId: { in: users } } });
  await db.authSessions.deleteMany({ where: { userId: { in: users } } });
  await db.users.updateMany({
    where: { id: { in: users } },
    data: { vendorId: null, currentVendorId: null },
  });
  await db.vendors.deleteMany({ where: { id: { in: vendors } } });
  await db.users.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
});
describe('native typed configuration and public site behavior', () => {
  it('restricts global configuration to the central administrator session', async () => {
    expect((await request(app).get(root)).status).toBe(401);
    expect(
      (await request(app).get(root).set('Authorization', `Bearer ${owner.token}`)).status,
    ).toBe(403);
    expect((await request(app).get(root).set('Authorization', 'ApiKey invalid')).status).toBe(401);
    expect((await request(app).get(root).set(headers())).body.groups.map((g: any) => g.id)).toEqual(
      ['general', 'user', 'misc_settings'],
    );
  });
  it('provides defaults and never enumerates hidden credentials', async () => {
    expect((await group('general')).settings).toMatchObject({
      name: 'Whalexy',
      timezone: 'UTC',
      contact_email: '',
    });
    const response = await request(app).get(`${publicRoot}/home`);
    expect(response.status).toBe(200);
    expect(response.body.site.contactEmail).toBeNull();
    expect(response.text).not.toMatch(/private-secret|smtp_mail/);
    expect((await request(app).get(`${root}/email`).set(headers())).status).toBe(404);
  });
  it('patches selected source settings without replacing omitted values and exposes supported public metadata', async () => {
    expect(
      (
        await update('general', {
          name: 'Whalexy Example',
          description: 'CRM workspace',
          contact_email: 'help@example.com',
          timezone: 'Asia/Kolkata',
        })
      ).status,
    ).toBe(200);
    expect((await update('general', { description: '' })).status).toBe(200);
    const home = await request(app).get(`${publicRoot}/home`);
    expect(home.body.site).toMatchObject({
      name: 'Whalexy Example',
      description: '',
      contactEmail: 'help@example.com',
      timeZone: 'Asia/Kolkata',
    });
    const guide = await request(app)
      .get(`/api/v1/vendors/${owner.vendorId}/guide`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(guide.body.demoContactEmail).toBe('help@example.com');
  });
  it('validates types, URLs, timezones and source group membership atomically', async () => {
    const before = await group('general');
    for (const values of [
      { name: '' },
      { timezone: 'Unknown/Zone' },
      { demo_video_link: 'javascript:alert(1)' },
      { whatsapp_demo_link: 'https://user:password@example.com' },
      { smtp_mail_password_or_apikey: 'overwrite' },
      { name: 'Changed', timezone: 'Invalid/Zone' },
    ]) {
      expect((await update('general', values, before.revision)).status).toBe(400);
    }
    expect((await group('general')).revision).toBe(before.revision);
    expect((await update('user', { enable_vendor_registration: 'false' })).status).toBe(400);
    expect((await update('general', {})).status).toBe(400);
  });
  it('serializes concurrent editors and rejects stale revisions', async () => {
    const before = await group('general');
    const results = await Promise.all([
      update('general', { description: 'A' }, before.revision),
      update('general', { description: 'B' }, before.revision),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      (await update('general', { description: 'stale' }, before.revision)).body.error.code,
    ).toBe('SETTINGS_CONFLICT');
  });
  it('publishes sanitized legal policies and rejects unknown or empty policies', async () => {
    expect((await request(app).get(`${publicRoot}/policies/user_terms`)).status).toBe(404);
    const result = await update('user', {
      user_terms:
        '<h2>Terms</h2><p>Use responsibly.</p><script>secret()</script><a href="javascript:bad()">link</a>',
      privacy_policy: '<p>Privacy details.</p>',
    });
    expect(result.status).toBe(200);
    const policy = await request(app).get(`${publicRoot}/policies/user_terms`);
    expect(policy.status).toBe(200);
    expect(policy.body.content).toContain('Use responsibly');
    expect(policy.body.content).not.toMatch(/script|javascript/);
    expect(
      (await request(app).get(`${publicRoot}/policies/smtp_mail_password_or_apikey`)).status,
    ).toBe(400);
    expect((await request(app).get(`${publicRoot}/policies/vendor_terms`)).status).toBe(404);
  });
  it('refuses ambiguous or invalid legacy values without deleting them or leaking their values', async () => {
    const duplicate = await db.configurations.create({
      data: { name: 'contact_email', value: 'sensitive-invalid-email', dataType: 1 },
    });
    const result = await request(app).get(`${publicRoot}/home`);
    expect(result.status).toBe(409);
    expect(result.text).not.toContain('sensitive-invalid-email');
    expect(
      (
        await request(app)
          .patch(`${root}/general`)
          .set(headers())
          .send({ revision: 'a'.repeat(64), settings: { contact_email: 'a@example.com' } })
      ).body.error.code,
    ).toBe('SETTINGS_REVIEW_REQUIRED');
    await db.configurations.delete({ where: { id: duplicate.id } });
    const invalid = await db.configurations.create({
      data: { name: 'enable_vendor_registration', value: 'unexpected-private-value', dataType: 2 },
    });
    expect((await request(app).get(`${publicRoot}/home`)).status).toBe(409);
    await db.configurations.delete({ where: { id: invalid.id } });
  });
  it('reads Laravel boolean encodings and blocks new registration without creating rows or verification jobs', async () => {
    await db.configurations.create({
      data: { name: 'enable_vendor_registration', value: 'false', dataType: 2 },
    });
    expect((await request(app).get(`${publicRoot}/home`)).body.registration.enabled).toBe(false);
    const input = registration(),
      before = await db.outboxJobs.count();
    const response = await request(app).post('/api/v1/auth/register').send(input);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('REGISTRATION_DISABLED');
    expect(await db.users.findUnique({ where: { email: input.email } })).toBeNull();
    expect(await db.outboxJobs.count()).toBe(before);
    expect(
      (
        await update('user', {
          enable_vendor_registration: false,
          message_for_disabled_registration: 'Contact our support team.',
        })
      ).status,
    ).toBe(200);
    expect((await request(app).get(`${publicRoot}/home`)).body.registration.message).toBe(
      'Contact our support team.',
    );
  });
  it('rechecks registration after password hashing when an administrator disables it', async () => {
    await update('user', { enable_vendor_registration: true });
    const actualHash = passwords.hashPassword;
    vi.spyOn(passwords, 'hashPassword').mockImplementation(async (input) => {
      const hash = await actualHash(input);
      expect((await update('user', { enable_vendor_registration: false })).status).toBe(200);
      return hash;
    });
    const input = registration(),
      response = await request(app).post('/api/v1/auth/register').send(input);
    expect(response.status).toBe(403);
    expect(await db.users.findUnique({ where: { email: input.email } })).toBeNull();
  });
  it('allows registration again with email/phone verification still required', async () => {
    await update('user', { enable_vendor_registration: true });
    const response = await request(app).post('/api/v1/auth/register').send(registration());
    if (response.body.userId) {
      extraUsers.push(response.body.userId);
      extraVendors.push(response.body.vendorId);
    }
    expect(response.status).toBe(201);
    expect(response.body.verificationRequired).toEqual(['email', 'phone']);
  });
  it('returns an alternate home URL while avoiding a self-redirect loop', async () => {
    expect(
      (
        await update('misc_settings', {
          other_home_page_url: 'https://landing.whalexy.com/welcome',
        })
      ).status,
    ).toBe(200);
    expect((await request(app).get(`${publicRoot}/home`)).body.redirectUrl).toBe(
      'https://landing.whalexy.com/welcome',
    );
    const row = await db.configurations.findFirstOrThrow({
      where: { name: 'other_home_page_url' },
    });
    if (new URL(config.PUBLIC_URL).protocol === 'https:') {
      await db.configurations.update({
        where: { id: row.id },
        data: { value: new URL('/', config.PUBLIC_URL).href },
      });
      expect((await request(app).get(`${publicRoot}/home`)).body.redirectUrl).toBeNull();
    }
    await update('misc_settings', { other_home_page_url: '' });
    expect((await request(app).get(`${publicRoot}/home`)).body.redirectUrl).toBeNull();
  });
  it('shows only central published menu pages and the three newest published articles', async () => {
    const marker = randomUUID();
    for (const input of [
      { title: 'Public menu', vendorId: null, status: 1, showInMenu: 1 },
      { title: 'Vendor private', vendorId: owner.vendorId, status: 1, showInMenu: 1 },
      { title: 'Draft', vendorId: null, status: 0, showInMenu: 1 },
    ]) {
      const row = await db.pages.create({
        data: { ...input, slug: `${marker}${pageIds.length}`, type: 1 },
      });
      pageIds.push(row.id);
    }
    for (let i = 0; i < 6; i++) {
      const post = await db.blogPosts.create({
        data: {
          authorId: admin.userId,
          title: `Post ${i}`,
          slug: `${marker}-${i}`,
          excerpt: 'Public summary',
          content: 'Private body omitted from home',
          status: i === 4 ? 'draft' : 'published',
          publishedAt: new Date(Date.now() + (i === 5 ? 3600000 : -1000 - i * 1000)),
        },
      });
      postIds.push(post.id);
    }
    const response = await request(app).get(`${publicRoot}/home`);
    expect(response.status).toBe(200);
    expect(response.body.navigation.some((p: any) => p.uid && p.title === 'Public menu')).toBe(
      true,
    );
    expect(
      response.body.navigation.some((p: any) => ['Vendor private', 'Draft'].includes(p.title)),
    ).toBe(false);
    expect(response.body.latestBlogPosts.map((p: any) => p.title)).toEqual([
      'Post 0',
      'Post 1',
      'Post 2',
    ]);
    expect(response.text).not.toContain('Private body omitted');
  });
  it('records changed setting keys without storing policy text or contact addresses in the audit', async () => {
    const events = await db.auditEvents.findMany({
      where: { actorId: admin.userId, resource: 'site-settings' },
    });
    expect(events.length).toBeGreaterThan(5);
    expect(JSON.stringify(events)).not.toMatch(/help@example.com|Use responsibly/);
  });
});
