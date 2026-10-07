import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { businessFixture } from './fixtures.js';
import { siteSettingDefinitions } from '../src/modules/configuration/services/site-settings.js';
const app = createApp(),
  root = '/central-console/configuration',
  native = '/api/v1/admin/configuration';
const names = Object.keys(siteSettingDefinitions);
let saved: Awaited<ReturnType<typeof db.configurations.findMany>>,
  admin: Awaited<ReturnType<typeof businessFixture>>;
beforeAll(async () => {
  saved = await db.configurations.findMany({ where: { name: { in: names } } });
  await db.configurations.deleteMany({ where: { name: { in: names } } });
  admin = await businessFixture();
  await db.userRoles.upsert({
    where: { id: 1 },
    create: { id: 1, title: 'Configuration administrator' },
    update: {},
  });
  await db.users.update({ where: { id: admin.userId }, data: { userRolesId: 1 } });
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await db.configurations.deleteMany({
    where: {
      OR: [
        { name: { in: names } },
        { name: { startsWith: `legacy-site-settings:${admin.userId}:` } },
      ],
    },
  });
  if (saved.length) await db.configurations.createMany({ data: saved });
  await db.$disconnect();
});
const get = (group: string, token = admin.token) =>
  request(app).get(`${root}/${group}`).set('Authorization', `Bearer ${token}`);
const post = (group: string, body: any, key = randomUUID()) =>
  request(app)
    .post(`${root}/${group}/process-configuration-store`)
    .set('Authorization', `Bearer ${admin.token}`)
    .set('Idempotency-Key', key)
    .send(body);
describe('original supported central configuration adapters', () => {
  it('reads safe source fields and writes flattened settings with stable replay', async () => {
    const current = await get('general');
    expect(current.status).toBe(200);
    expect(current.body.data).toHaveProperty('name');
    expect(current.body.data).not.toHaveProperty('rows');
    const key = randomUUID(),
      body = {
        pageType: 'general',
        revision: current.body.data.revision,
        name: 'New site',
        contact_email: 'site@example.com',
      };
    const saved = await post('general', body, key);
    expect(saved.status).toBe(200);
    expect(saved.body.data.settings.name).toBe('New site');
    expect(
      (
        await post(
          'general',
          {
            contact_email: body.contact_email,
            name: body.name,
            revision: body.revision,
            pageType: body.pageType,
          },
          key,
        )
      ).body,
    ).toEqual(saved.body);
    expect((await post('general', { ...body, name: 'Different' }, key)).status).toBe(409);
    expect((await post('general', body)).status).toBe(409);
    expect(
      await db.auditEvents.count({ where: { actorId: admin.userId, resource: 'site-settings' } }),
    ).toBe(1);
  });
  it('normalizes original checkbox flags, sanitizes legal HTML and preserves omitted fields', async () => {
    const current = (await get('user')).body.data;
    const body = {
      pageType: 'user',
      revision: current.revision,
      enable_vendor_registration: 'off',
      user_terms: '<p>Terms</p><script>bad()</script>',
    };
    const saved = await post('user', body);
    expect(saved.status).toBe(200);
    expect(saved.body.data.settings.enable_vendor_registration).toBe(false);
    expect(saved.body.data.settings.user_terms).toBe('<p>Terms</p>');
    expect(saved.body.data.settings.vendor_terms).toBe(current.vendor_terms);
    const row = await db.configurations.findFirstOrThrow({
      where: { name: 'enable_vendor_registration' },
    });
    expect(row.value).toBe('0');
    expect(row.dataType).toBe(2);
    const misc = await get('misc_settings');
    expect(
      (
        await post('misc_settings', {
          pageType: 'misc_settings',
          revision: misc.body.data.revision,
          other_home_page_url: 'https://example.com/home',
        })
      ).status,
    ).toBe(200);
  });
  it('shares native revisions and rejects stale original writes after a native edit', async () => {
    const current = (await get('general')).body.data;
    const nativeEdit = await request(app)
      .patch(`${native}/general`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ revision: current.revision, settings: { description: 'Native change' } });
    expect(nativeEdit.status).toBe(200);
    expect(
      (
        await post('general', {
          pageType: 'general',
          revision: current.revision,
          description: 'Stale source change',
        })
      ).status,
    ).toBe(409);
    expect((await get('general')).body.data.description).toBe('Native change');
  });
  it('rejects unsupported groups, secrets, group mismatches, invalid values and missing keys', async () => {
    const current = (await get('general')).body.data;
    expect((await get('payment')).status).toBe(400);
    for (const extra of [
      { smtp_mail_password_or_apikey: 'test-secret' },
      { contact_email: 'bad-email' },
      { timezone: 'invalid-zone' },
      { pageType: 'user', enable_vendor_registration: true },
    ])
      expect(
        (
          await post('general', {
            pageType: 'general',
            revision: current.revision,
            name: 'Site',
            ...extra,
          })
        ).status,
      ).toBe(400);
    expect(
      (
        await request(app)
          .post(`${root}/general/process-configuration-store`)
          .set('Authorization', `Bearer ${admin.token}`)
          .send({ pageType: 'general', revision: current.revision, name: 'Site' })
      ).status,
    ).toBe(400);
    const owner = await businessFixture();
    expect((await get('general', owner.token)).status).toBe(403);
  });
  it('rolls back settings/audit/replay and fails closed on imported duplicates', async () => {
    const current = (await get('general')).body.data,
      key = randomUUID(),
      transaction = db.$transaction.bind(db);
    vi.spyOn(db, '$transaction').mockImplementation(async (fn: any, options: any) =>
      transaction(async (tx) => {
        tx.auditEvents.create = (() => Promise.reject(new Error('audit failed'))) as any;
        return fn(tx);
      }, options),
    );
    expect(
      (
        await post(
          'general',
          { pageType: 'general', revision: current.revision, name: 'Rolled back' },
          key,
        )
      ).status,
    ).toBe(500);
    expect(
      await db.configurations.count({
        where: { name: `legacy-site-settings:${admin.userId}:${key}` },
      }),
    ).toBe(0);
    vi.restoreAllMocks();
    expect((await get('general')).body.data.name).toBe(current.name);
    const duplicate = await db.configurations.create({
      data: { name: 'name', value: 'Duplicate', dataType: 1 },
    });
    expect((await get('general')).status).toBe(409);
    await db.configurations.delete({ where: { id: duplicate.id } });
  });
  it('rechecks current administrator role after authentication for native and legacy writes', async () => {
    const current = (await get('general')).body.data,
      transaction = db.$transaction.bind(db);
    vi.spyOn(db, '$transaction').mockImplementation(async (fn: any, options: any) => {
      await db.users.update({ where: { id: admin.userId }, data: { userRolesId: null } });
      return transaction(fn, options);
    });
    try {
      expect(
        (await post('general', { pageType: 'general', revision: current.revision, name: 'Denied' }))
          .status,
      ).toBe(403);
      await db.users.update({ where: { id: admin.userId }, data: { userRolesId: 1 } });
      expect(
        (
          await request(app)
            .patch(`${native}/general`)
            .set('Authorization', `Bearer ${admin.token}`)
            .send({ revision: current.revision, settings: { name: 'Denied' } })
        ).status,
      ).toBe(403);
    } finally {
      vi.restoreAllMocks();
      await db.users.update({ where: { id: admin.userId }, data: { userRolesId: 1 } });
    }
    expect((await get('general')).body.data.name).toBe(current.name);
  });
});
