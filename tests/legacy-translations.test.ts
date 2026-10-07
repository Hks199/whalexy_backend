import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { businessFixture } from './fixtures.js';
const app = createApp(),
  root = '/central-console/translations',
  native = '/api/v1/admin/translations';
const scope = {
  OR: [
    { name: 'translation_languages' },
    { name: { startsWith: 'native_translation_catalog:' } },
    { name: { startsWith: 'legacy-translation:' } },
  ],
};
let saved: Awaited<ReturnType<typeof db.configurations.findMany>>,
  admin: Awaited<ReturnType<typeof businessFixture>>;
beforeAll(async () => {
  saved = await db.configurations.findMany({ where: scope });
  await db.configurations.deleteMany({ where: scope });
  admin = await businessFixture();
  await db.userRoles.upsert({
    where: { id: 1 },
    create: { id: 1, title: 'Translation administrator' },
    update: {},
  });
  await db.users.update({ where: { id: admin.userId }, data: { userRolesId: 1 } });
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await db.configurations.deleteMany({ where: scope });
  if (saved?.length) await db.configurations.createMany({ data: saved });
  await db.$disconnect();
});
const get = (suffix = '', token = admin.token) =>
  request(app)
    .get(root + suffix)
    .set('Authorization', `Bearer ${token}`);
const post = (suffix: string, body: any, key = randomUUID(), token = admin.token) =>
  request(app)
    .post(root + suffix)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', key)
    .send(body);
describe('original translation API adapters', () => {
  it('creates original language fields, exposes safe registry and replays once', async () => {
    const key = randomUUID(),
      body = { language_id: 'fr', language_name: 'French', is_rtl: 'false' };
    const response = await post('/process-language-store', body, key);
    expect(response.status).toBe(200);
    expect(response.body.reaction).toBe(1);
    expect(response.body.data.language).toMatchObject({ id: 'fr', name: 'French', is_rtl: false });
    expect((await post('/process-language-store', { ...body, is_rtl: false }, key)).body).toEqual(
      response.body,
    );
    expect(
      (await post('/process-language-store', { ...body, language_name: 'Changed' }, key)).status,
    ).toBe(409);
    const list = await get();
    expect(list.status).toBe(200);
    expect(list.body.data.languages.some((l: any) => l.id === 'fr')).toBe(true);
    expect(list.body.data).not.toHaveProperty('row');
  });
  it('maps dynamic original form fields and preserves native revision conflicts', async () => {
    const current = (await get()).body.data,
      key = randomUUID();
    const body = {
      form_key: 'fr',
      revision: current.revision,
      language_name_fr: 'Français',
      is_rtl_fr: 'true',
      status_fr: 'false',
    };
    const updated = await post('/process-language-update', body, key);
    expect(updated.status).toBe(200);
    expect(updated.body.data.language).toMatchObject({
      name: 'Français',
      is_rtl: true,
      status: false,
    });
    expect((await post('/process-language-update', body, key)).body).toEqual(updated.body);
    expect((await post('/process-language-update', body)).status).toBe(409);
    expect(
      (await post('/process-language-update', { ...body, form_key: '__proto__' })).status,
    ).toBe(400);
    expect((await post('/process-language-update', { ...body, unrelated: true })).status).toBe(400);
  });
  it('updates only an existing singular catalog entry and preserves placeholders and other entries', async () => {
    const seed = await request(app)
      .put(`${native}/fr/messages`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        revision: null,
        messages: [
          { id: 'Hello :name', text: 'Bonjour :name' },
          { id: 'Other', text: 'Autre' },
        ],
      });
    expect(seed.status).toBe(200);
    const body = {
        language_id: 'fr',
        message_id: 'Hello :name',
        message_str: 'Salut :name',
        revision: seed.body.revision,
      },
      key = randomUUID();
    expect((await post('/update', { ...body, message_str: 'Lost placeholder' })).status).toBe(400);
    expect((await post('/update', { ...body, message_id: 'Missing' })).status).toBe(404);
    expect((await post('/update', { ...body, is_plural: true })).status).toBe(400);
    const updated = await post('/update', body, key);
    expect(updated.status).toBe(200);
    expect((await post('/update', body, key)).body).toEqual(updated.body);
    const list = await get('/language/fr');
    expect(list.body.data.translations).toEqual([
      { message_id: 'Hello :name', message_str: 'Salut :name' },
      { message_id: 'Other', message_str: 'Autre' },
    ]);
    const cleared = await post('/update', {
      ...body,
      message_str: '',
      revision: updated.body.data.revision,
    });
    expect(cleared.status).toBe(200);
    expect(cleared.body.message).toContain('cleared');
    expect((await get('/language/fr')).body.data.hasNoTranslationData).toBe(true);
  });
  it('protects English, deletes the owned catalog and replays after deletion', async () => {
    const revision = (await get()).body.data.revision,
      key = randomUUID();
    expect((await post('/en/process-language-delete', { revision })).status).toBe(409);
    const removed = await post('/fr/process-language-delete', { revision }, key);
    expect(removed.status).toBe(200);
    expect((await post('/fr/process-language-delete', { revision }, key)).body).toEqual(
      removed.body,
    );
    expect((await get('/language/fr')).status).toBe(404);
    expect(
      await db.configurations.count({ where: { name: 'native_translation_catalog:fr' } }),
    ).toBe(0);
  });
  it('requires current site administrator access, including on replay, and excludes vendor owners', async () => {
    const owner = await businessFixture();
    expect((await get('', owner.token)).status).toBe(403);
    const other = await businessFixture();
    await db.users.update({ where: { id: other.userId }, data: { userRolesId: 1 } });
    const body = { language_id: 'de', language_name: 'German', is_rtl: false },
      key = randomUUID();
    expect((await post('/process-language-store', body, key, other.token)).status).toBe(200);
    await db.users.update({ where: { id: other.userId }, data: { userRolesId: null } });
    expect((await post('/process-language-store', body, key, other.token)).status).toBe(403);
  });
  it('rejects unsupported scan/provider fields, invalid locale and missing keys', async () => {
    for (const body of [
      { language_id: '../../bad', language_name: 'Bad' },
      { language_id: 'es', language_name: 'Spanish', auto_translate: 'microsoft' },
      { language_id: 'es', language_name: 'Spanish', unknown: true },
    ])
      expect((await post('/process-language-store', body)).status).toBe(400);
    expect(
      (
        await request(app)
          .post(`${root}/process-language-store`)
          .set('Authorization', `Bearer ${admin.token}`)
          .send({ language_id: 'es', language_name: 'Spanish' })
      ).status,
    ).toBe(400);
  });
  it('rolls back registry changes and replay records if audit fails', async () => {
    const transaction = db.$transaction.bind(db),
      key = randomUUID();
    vi.spyOn(db, '$transaction').mockImplementation(async (fn: any, options: any) =>
      transaction(async (tx) => {
        tx.auditEvents.create = (() => Promise.reject(new Error('audit failed'))) as any;
        return fn(tx);
      }, options),
    );
    expect(
      (await post('/process-language-store', { language_id: 'it', language_name: 'Italian' }, key))
        .status,
    ).toBe(500);
    expect(
      await db.configurations.count({
        where: { name: `legacy-translation:${admin.userId}:${key}` },
      }),
    ).toBe(0);
    vi.restoreAllMocks();
    expect((await get()).body.data.languages.some((l: any) => l.id === 'it')).toBe(false);
  });
  it('rechecks administrator access after middleware for both native and legacy writes', async () => {
    const transaction = db.$transaction.bind(db);
    vi.spyOn(db, '$transaction').mockImplementation(async (fn: any, options: any) => {
      await db.users.update({ where: { id: admin.userId }, data: { userRolesId: null } });
      return transaction(fn, options);
    });
    try {
      expect(
        (await post('/process-language-store', { language_id: 'es', language_name: 'Spanish' }))
          .status,
      ).toBe(403);
      await db.users.update({ where: { id: admin.userId }, data: { userRolesId: 1 } });
      expect(
        (
          await request(app)
            .post(native)
            .set('Authorization', `Bearer ${admin.token}`)
            .send({ locale: 'it', name: 'Italian', isRtl: false })
        ).status,
      ).toBe(403);
    } finally {
      vi.restoreAllMocks();
      await db.users.update({ where: { id: admin.userId }, data: { userRolesId: 1 } });
    }
    const languages = (await get()).body.data.languages;
    expect(languages.some((language: any) => ['es', 'it'].includes(language.id))).toBe(false);
  });
});
