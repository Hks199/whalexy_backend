import { readFileSync } from 'node:fs';
import request from 'supertest';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import {
  checkedMessages,
  exportPo,
  importPo,
  reviewPo,
  localeId,
} from '../src/modules/translations/services/translations.js';
import { businessFixture } from './fixtures.js';

const app = createApp(),
  root = '/api/v1/admin/translations',
  publicRoot = '/api/v1/public/translations';
let admin: Awaited<ReturnType<typeof businessFixture>>, owner: typeof admin;
let saved: Awaited<ReturnType<typeof db.configurations.findMany>>;
const scope = {
  OR: [{ name: 'translation_languages' }, { name: { startsWith: 'native_translation_catalog:' } }],
};
const headers = () => ({ Authorization: `Bearer ${admin.token}` });
const messages = [
  { id: 'Hello :name', text: 'Bonjour :name' },
  { id: 'Untranslated', text: '' },
];
async function state() {
  return (await request(app).get(root).set(headers())).body;
}
async function create(locale: string, name: string, isRtl = false) {
  const response = await request(app).post(root).set(headers()).send({ locale, name, isRtl });
  expect(response.status).toBe(201);
  return response.body;
}
async function save(locale: string, entries = messages, revision: string | null = null) {
  return request(app)
    .put(`${root}/${locale}/messages`)
    .set(headers())
    .send({ revision, messages: entries });
}
beforeAll(async () => {
  saved = await db.configurations.findMany({ where: scope });
  await db.configurations.deleteMany({ where: scope });
  [admin, owner] = await Promise.all([businessFixture(), businessFixture()]);
  await db.userRoles.upsert({
    where: { id: 1 },
    create: { id: 1, title: 'Translation administrator' },
    update: {},
  });
  await db.users.update({ where: { id: admin.userId }, data: { userRolesId: 1 } });
});
afterAll(async () => {
  await db.configurations.deleteMany({ where: scope });
  if (saved.length) await db.configurations.createMany({ data: saved });
  const userIds = [admin.userId, owner.userId];
  await db.auditEvents.deleteMany({ where: { actorId: { in: userIds } } });
  await db.nativeMemberships.deleteMany({ where: { userId: { in: userIds } } });
  await db.authSessions.deleteMany({ where: { userId: { in: userIds } } });
  await db.vendors.deleteMany({ where: { id: { in: [admin.vendorId, owner.vendorId] } } });
  await db.users.deleteMany({ where: { id: { in: userIds } } });
  await db.$disconnect();
});
describe('native localization', () => {
  it('requires a central administrator, even for a workspace owner', async () => {
    expect((await request(app).post(root).send({ locale: 'fr', name: 'French' })).status).toBe(401);
    expect(
      (
        await request(app)
          .post(root)
          .set('Authorization', `Bearer ${owner.token}`)
          .send({ locale: 'fr', name: 'French' })
      ).status,
    ).toBe(403);
    expect((await request(app).get(root).set('Authorization', 'ApiKey invalid')).status).toBe(401);
  });
  it('always publishes English as the fallback and rejects traversal locales', async () => {
    const response = await request(app).get(publicRoot);
    expect(response.body.items).toEqual([{ id: 'en', name: 'English', isRtl: false }]);
    expect((await request(app).get(`${publicRoot}/en`)).body.messages).toEqual([]);
    expect(() => localeId('../en')).toThrow();
    expect(() => localeId('en-US-x-secret')).toThrow();
    expect(localeId('PT-br')).toBe('pt_BR');
    expect(localeId('zh-hant-tw')).toBe('zh_Hant_TW');
  });
  it('normalizes IDs, prevents duplicate locales and does not advertise empty setup as installed', async () => {
    await create('fr', 'French');
    await create('pt-br', 'Brazilian');
    expect(
      (await request(app).post(root).set(headers()).send({ locale: 'pt_BR', name: 'Other' }))
        .status,
    ).toBe(409);
    expect((await request(app).get(publicRoot)).body.items.map((l: any) => l.id)).toEqual(['en']);
    expect((await request(app).get(`${publicRoot}/fr`)).status).toBe(404);
  });
  it('publishes validated messages, preserves Unicode and falls back for empty translations', async () => {
    const response = await save('fr');
    expect(response.status).toBe(200);
    expect(response.body.revision).toBeTypeOf('string');
    const published = await request(app).get(`${publicRoot}/fr`);
    expect(published.body.messages).toContainEqual({ id: 'Untranslated', text: 'Untranslated' });
    expect((await request(app).get(publicRoot)).body.items.map((l: any) => l.id)).toContain('fr');
    const current = await request(app).get(`${root}/fr/messages`).set(headers());
    expect(current.body.messages).toContainEqual({ id: 'Untranslated', text: '' });
  });
  it('prevents stale catalog replacement and serializes competing editors', async () => {
    const current = (await request(app).get(`${root}/fr/messages`).set(headers())).body;
    const responses = await Promise.all([
      save('fr', messages, current.revision),
      save('fr', messages, current.revision),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await save('fr')).status).toBe(409);
  });
  it('rejects duplicate IDs, missing placeholders, control characters and oversized catalogs atomically', async () => {
    const current = (await request(app).get(`${root}/fr/messages`).set(headers())).body;
    for (const entries of [
      [{ id: 'Hello :name', text: 'Bonjour' }],
      [
        { id: 'x', text: 'a' },
        { id: 'x', text: 'b' },
      ],
      [{ id: 'x', text: '\u0000' }],
    ]) {
      expect((await save('fr', entries, current.revision)).status).toBe(400);
    }
    expect((await request(app).get(`${root}/fr/messages`).set(headers())).body.revision).toBe(
      current.revision,
    );
    expect(() =>
      checkedMessages(
        Array.from({ length: 200 }, (_, i) => ({ id: String(i), text: 'x'.repeat(5000) })),
      ),
    ).toThrow('800 KB');
    expect(() => checkedMessages([{ id: 'Count %d for %s', text: '%s %d' }])).toThrow();
    expect(
      checkedMessages([{ id: 'Save 70% of hours', text: 'Economize 70% das horas' }]),
    ).toHaveLength(1);
  });
  it('supports PO import/export without publishing comments, source paths or translator identities', async () => {
    await create('de', 'German');
    const po = Buffer.from(
      'msgid ""\nmsgstr ""\n"Language: de\\n"\n"Last-Translator: private@example.com\\n"\n\n#: /private/source.php\nmsgid "Hello :name"\nmsgstr "Hallo :name"\n',
    );
    const response = await request(app)
      .post(`${root}/de/import-po`)
      .set(headers())
      .field('revision', '')
      .attach('file', po, 'de.po');
    expect(response.status).toBe(200);
    const exported = await request(app).get(`${root}/de/export-po`).set(headers());
    expect(exported.status).toBe(200);
    expect(exported.text).not.toMatch(/private@example|private\/source/);
    expect(importPo(Buffer.from(exported.text), 'de')).toEqual([
      { id: 'Hello :name', text: 'Hallo :name' },
    ]);
    expect((await request(app).get(`${publicRoot}/de`)).text).not.toContain('private');
  });
  it('rejects mismatched/malformed/fuzzy/plural PO input and enforces upload limits', async () => {
    expect(() => importPo(exportPo(messages, 'fr'), 'de')).toThrow();
    expect(() => importPo(Buffer.from('msgid "unterminated'), 'fr')).toThrow('Invalid gettext');
    for (const data of [
      '#, fuzzy\nmsgid "x"\nmsgstr "y"',
      'msgctxt "context"\nmsgid "x"\nmsgstr "y"',
      'msgid "x"\nmsgid_plural "xs"\nmsgstr[0] "y"\nmsgstr[1] "ys"',
    ]) {
      expect(() =>
        importPo(
          Buffer.from(
            'msgid ""\nmsgstr ""\n"Language: fr\\n"\n"Plural-Forms: nplurals=2; plural=(n != 1);\\n"\n\n' +
              data +
              '\n',
          ),
          'fr',
        ),
      ).toThrow('reconciliation');
    }
    expect(
      (
        await request(app)
          .post(`${root}/de/import-po`)
          .set(headers())
          .field('revision', '')
          .attach('file', Buffer.alloc(3 * 1024 * 1024 + 1), 'huge.po')
      ).status,
    ).toBe(400);
  });
  it('disables published locales, respects RTL and requires a current registry revision', async () => {
    await create('ar', 'Arabic', true);
    expect((await save('ar', [{ id: 'Hello', text: 'مرحبا' }])).status).toBe(200);
    expect((await request(app).get(`${publicRoot}/ar`)).body.isRtl).toBe(true);
    const registry = await state();
    expect(
      (
        await request(app)
          .patch(`${root}/ar`)
          .set(headers())
          .send({ revision: registry.revision, status: false })
      ).status,
    ).toBe(200);
    expect((await request(app).get(`${publicRoot}/ar`)).status).toBe(404);
    expect(
      (
        await request(app)
          .patch(`${root}/ar`)
          .set(headers())
          .send({ revision: registry.revision, status: true })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .patch(`${root}/ar`)
          .set(headers())
          .send({ revision: (await state()).revision, status: 'true' })
      ).status,
    ).toBe(400);
  });
  it('preserves the default locale and removes deleted catalogs', async () => {
    expect(
      (
        await request(app)
          .delete(`${root}/en`)
          .set(headers())
          .send({ revision: (await state()).revision })
      ).body.error.code,
    ).toBe('DEFAULT_LANGUAGE');
    expect(
      (
        await request(app)
          .delete(`${root}/de`)
          .set(headers())
          .send({ revision: (await state()).revision })
      ).status,
    ).toBe(204);
    expect(
      await db.configurations.count({ where: { name: 'native_translation_catalog:de' } }),
    ).toBe(0);
    expect((await request(app).get(`${publicRoot}/de`)).status).toBe(404);
  });
  it('refuses ambiguous legacy registry rows without deleting either row or exposing values', async () => {
    const duplicate = await db.configurations.create({
      data: { name: 'translation_languages', value: 'secret-never-return' },
    });
    const response = await request(app).get(root).set(headers());
    expect(response.status).toBe(409);
    expect(response.text).not.toContain('secret-never-return');
    expect(
      (await request(app).post(root).set(headers()).send({ locale: 'it', name: 'Italian' })).status,
    ).toBe(409);
    await db.configurations.delete({ where: { id: duplicate.id } });
  });
  it('audits changes without recording message text or uploaded PO metadata', async () => {
    const events = await db.auditEvents.findMany({
      where: { actorId: admin.userId, resource: { startsWith: 'translation-' } },
    });
    expect(events.length).toBeGreaterThan(5);
    expect(JSON.stringify(events)).not.toMatch(/Bonjour|private@example/);
  });
  it('reconciles the actual original Portuguese catalog without activating it', () => {
    const buffer = readFileSync(
      new URL('../../whalexy/locale/pt_BR/LC_MESSAGES/messages.po', import.meta.url),
    );
    const result = reviewPo(buffer, 'pt_BR');
    expect(result.messages).toHaveLength(5720);
    expect(result.quarantined).toHaveLength(3);
    expect(result.quarantined.every((item) => item.reason === 'TRANSLATION_PLACEHOLDERS')).toBe(
      true,
    );
    expect(() => importPo(buffer, 'pt_BR')).toThrow('reconciliation');
    const prepared = readFileSync(
      new URL('../migration/translation-import/pt_BR.po', import.meta.url),
    );
    const messages = importPo(prepared, 'pt_BR');
    expect(messages).toHaveLength(5723);
    expect(messages.find((message) => message.id.includes(':seconds seconds.'))?.text).toContain(
      ':seconds',
    );
    expect(prepared.toString()).not.toMatch(/Last-Translator|\/home\/u114400467/);
  });
});
