import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { businessFixture } from './fixtures.js';
const app = createApp(),
  prefix = '/central-console/pages',
  ids: number[] = [],
  actors: number[] = [];
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await db.pages.deleteMany({ where: { id: { in: ids } } });
  await db.configurations.deleteMany({
    where: { OR: actors.map((id) => ({ name: { startsWith: `legacy-page:${id}:` } })) },
  });
  await db.$disconnect();
});
async function fixture(admin = true) {
  const f = await businessFixture();
  actors.push(f.userId);
  if (admin) {
    await db.userRoles.upsert({
      where: { id: 1 },
      create: { id: 1, title: 'Page administrator' },
      update: {},
    });
    await db.users.update({ where: { id: f.userId }, data: { userRolesId: 1 } });
  }
  const body = {
    title: 'Page title',
    slug: 'page' + randomUUID().replaceAll('-', ''),
    description: '<p>Safe page content</p>',
    show_in_menu: 'on',
    status: 'on',
  };
  const post = (suffix: string, input: any = body, key = randomUUID()) =>
    request(app)
      .post(`${prefix}/${suffix}`)
      .set('Authorization', `Bearer ${f.token}`)
      .set('Idempotency-Key', key)
      .send(input);
  const get = (suffix = '', query = {}) =>
    request(app).get(`${prefix}/${suffix}`).set('Authorization', `Bearer ${f.token}`).query(query);
  const create = async () => {
    const result = await post('add-process');
    expect(result.status).toBe(200);
    ids.push(result.body.data._id);
    return result.body.data;
  };
  return { ...f, body, post, get, create };
}
describe('original central page API adapters', () => {
  it('creates original checkbox/content fields with atomic replay and public visibility', async () => {
    const f = await fixture(),
      key = randomUUID(),
      created = await f.post('add-process', f.body, key);
    expect(created.status).toBe(200);
    const row = created.body.data;
    ids.push(row._id);
    expect(row).toMatchObject({
      status: 1,
      show_in_menu: 1,
      description: '<p>Safe page content</p>',
    });
    expect((await f.post('add-process', f.body, key)).body).toEqual(created.body);
    expect((await f.post('add-process', { ...f.body, title: 'Other title' }, key)).status).toBe(
      409,
    );
    expect(
      await db.auditEvents.count({ where: { actorId: f.userId, resource: 'site-page' } }),
    ).toBe(1);
    const publicPage = await request(app).get(`/api/v1/public/pages/${row.slug}`);
    expect(publicPage.status).toBe(200);
    expect(publicPage.body.content).toBe(row.content);
  });
  it('updates via source UID and revision, rejects stale writes and replays deletion after removal', async () => {
    const f = await fixture(),
      row = await f.create(),
      body = { ...f.body, pageIdOrUid: row._uid, revision: row.revision, status: false };
    const updated = await f.post('update-process', body);
    expect(updated.status).toBe(200);
    expect(updated.body.data.status).toBe(0);
    expect((await f.post('update-process', { ...body, title: 'Stale edit' })).status).toBe(409);
    expect((await request(app).get(`/api/v1/public/pages/${row.slug}`)).status).toBe(404);
    const key = randomUUID(),
      removed = await f.post(
        `${row._id}/delete-process`,
        { revision: updated.body.data.revision },
        key,
      );
    expect(removed.status).toBe(200);
    expect(
      (await f.post(`${row._id}/delete-process`, { revision: updated.body.data.revision }, key))
        .body,
    ).toEqual(removed.body);
    expect(await db.pages.findUnique({ where: { id: row._id } })).toBeNull();
  });
  it('excludes vendor pages and projects sanitized HTML for native and imported pages', async () => {
    const f = await fixture();
    const vendor = await db.pages.create({
      data: {
        vendorId: f.vendorId,
        title: 'Vendor private',
        slug: f.body.slug,
        status: 1,
        showInMenu: 1,
        type: 1,
        content: 'Private',
      },
    });
    ids.push(vendor.id);
    expect((await f.get(`${vendor.uid}/get-update-data`)).status).toBe(404);
    expect((await f.post('add-process')).status).toBe(409);
    const imported = await db.pages.create({
      data: {
        title: 'Imported',
        slug: f.body.slug + 'x',
        status: 0,
        type: 1,
        content:
          '<p>Allowed</p><script>secret script</script><img src="https://example.com/a.png" onerror="bad()">',
      },
    });
    ids.push(imported.id);
    const read = await f.get(`${imported.uid}/get-update-data`);
    expect(read.status).toBe(200);
    expect(read.body.data.content).toContain('<p>Allowed</p>');
    expect(read.body.data.content).not.toMatch(/script|onerror/);
    expect(read.body.data).not.toHaveProperty('vendorId');
    expect(read.body.data).not.toHaveProperty('imageName');
    const typed = await db.pages.update({ where: { id: imported.id }, data: { type: 2 } });
    const current = (await f.get(`${typed.uid}/get-update-data`)).body.data;
    expect(
      (await f.post(`${typed.uid}/delete-process`, { revision: current.revision })).status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .delete(`/api/v1/admin/content/pages/${typed.id}`)
          .set('Authorization', `Bearer ${f.token}`)
      ).status,
    ).toBe(409);
  });
  it('supports bounded literal DataTables search/sort and original list page JSON', async () => {
    const f = await fixture();
    f.body.title = '100% ' + f.body.slug;
    const row = await f.create();
    const query = {
      'search[value]': f.body.title,
      draw: 7,
      length: 1,
      'columns[0][data]': 'title',
      'order[0][column]': 0,
      'order[0][dir]': 'asc',
    };
    const listed = await f.get('list-data', query);
    expect(listed.status).toBe(200);
    expect(listed.body).toMatchObject({ draw: 7, recordsFiltered: 1 });
    expect(listed.body.data[0]._uid).toBe(row._uid);
    expect((await f.get('', query)).body).toEqual(listed.body);
    expect((await f.get('list-data', { length: -1 })).status).toBe(400);
    expect(
      (
        await f.get('list-data', {
          'columns[0][data]': '__proto__',
          'order[0][column]': 0,
          'order[0][dir]': 'asc',
        })
      ).status,
    ).toBe(400);
  });
  it('rejects vendor owners, missing keys, malformed fields and unknown targets', async () => {
    const owner = await fixture(false);
    expect((await owner.get()).status).toBe(403);
    expect((await owner.post('add-process')).status).toBe(403);
    const f = await fixture();
    expect(
      (
        await request(app)
          .post(`${prefix}/add-process`)
          .set('Authorization', `Bearer ${f.token}`)
          .send(f.body)
      ).status,
    ).toBe(400);
    for (const extra of [
      { slug: 'invalid-slug' },
      { unknown: true },
      { description: '' },
      { status: 2 },
    ])
      expect((await f.post('add-process', { ...f.body, ...extra })).status).toBe(400);
    expect((await f.get(`${randomUUID()}/get-update-data`)).status).toBe(404);
  });
  it('rolls back native and legacy writes when audit cannot commit', async () => {
    const f = await fixture(),
      transaction = db.$transaction.bind(db),
      key = randomUUID();
    vi.spyOn(db, '$transaction').mockImplementation(async (fn: any, options: any) =>
      transaction(async (tx) => {
        tx.auditEvents.create = (() => Promise.reject(new Error('audit failed'))) as any;
        return fn(tx);
      }, options),
    );
    expect((await f.post('add-process', f.body, key)).status).toBe(500);
    expect(
      (
        await request(app)
          .post('/api/v1/admin/content/pages')
          .set('Authorization', `Bearer ${f.token}`)
          .send({
            title: 'Native',
            slug: f.body.slug,
            content: 'Native content',
            status: 0,
            showInMenu: 0,
          })
      ).status,
    ).toBe(500);
    expect(await db.pages.count({ where: { slug: f.body.slug } })).toBe(0);
    expect(
      await db.configurations.count({ where: { name: `legacy-page:${f.userId}:${key}` } }),
    ).toBe(0);
  });
  it('rechecks administrator role inside shared transactions after authentication', async () => {
    const f = await fixture(),
      transaction = db.$transaction.bind(db);
    vi.spyOn(db, '$transaction').mockImplementation(async (fn: any, options: any) => {
      await db.users.update({ where: { id: f.userId }, data: { userRolesId: null } });
      return transaction(fn, options);
    });
    expect((await f.post('add-process')).status).toBe(403);
    await db.users.update({ where: { id: f.userId }, data: { userRolesId: 1 } });
    expect(
      (
        await request(app)
          .post('/api/v1/admin/content/pages')
          .set('Authorization', `Bearer ${f.token}`)
          .send({ title: 'Native', slug: f.body.slug, content: 'Native content' })
      ).status,
    ).toBe(403);
    expect(await db.pages.count({ where: { slug: f.body.slug } })).toBe(0);
  });
});
