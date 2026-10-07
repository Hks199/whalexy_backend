import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { businessFixture } from './fixtures.js';
const app = createApp(),
  prefix = '/central-console/blogs',
  ids: number[] = [],
  actors: number[] = [],
  categories: number[] = [],
  tags: number[] = [];
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await db.blogPosts.deleteMany({ where: { id: { in: ids } } });
  await db.blogCategories.deleteMany({ where: { id: { in: categories } } });
  await db.blogTags.deleteMany({ where: { id: { in: tags } } });
  await db.configurations.deleteMany({
    where: { OR: actors.map((id) => ({ name: { startsWith: `legacy-blog:${id}:` } })) },
  });
  await db.$disconnect();
});
async function fixture(admin = true) {
  const f = await businessFixture();
  actors.push(f.userId);
  if (admin) {
    await db.userRoles.upsert({
      where: { id: 1 },
      create: { id: 1, title: 'Blog administrator' },
      update: {},
    });
    await db.users.update({ where: { id: f.userId }, data: { userRolesId: 1 } });
  }
  const body = {
    title: `Blog ${randomUUID()}`,
    excerpt: 'Useful source article description.',
    content: '<h2>Article</h2><p>Useful content for readers.</p>',
    intent: 'draft',
  };
  const get = (suffix = '', query = {}) =>
    request(app)
      .get(prefix + suffix)
      .set('Authorization', `Bearer ${f.token}`)
      .query(query);
  const send = (
    method: 'post' | 'put' | 'delete',
    suffix = '',
    input: any = body,
    key = randomUUID(),
  ) =>
    request(app)
      [method](prefix + suffix)
      .set('Authorization', `Bearer ${f.token}`)
      .set('Idempotency-Key', key)
      .send(input);
  const create = async (input: any = body) => {
    const r = await send('post', '', input);
    expect(r.status).toBe(200);
    ids.push(r.body.data._id);
    return r.body.data;
  };
  return { ...f, body, get, send, create };
}
describe('original central blog adapters', () => {
  it('translates source fields, sanitizes content and atomically replays create and update', async () => {
    const f = await fixture(),
      key = randomUUID(),
      body = {
        ...f.body,
        author_name: 'Editor',
        seo_title: 'Source SEO',
        content: f.body.content + '<script>window.evil=true</script>',
      };
    const r = await f.send('post', '', body, key);
    expect(r.status).toBe(200);
    const row = r.body.data;
    ids.push(row._id);
    expect(row).toMatchObject({ author_name: 'Editor', seo_title: 'Source SEO', status: 'draft' });
    expect(row.content).not.toContain('<script');
    expect(row).not.toHaveProperty('authorId');
    expect(row).not.toHaveProperty('featured_image');
    expect((await f.send('post', '', body, key)).body).toEqual(r.body);
    expect((await f.send('post', '', { ...body, title: 'Changed' }, key)).status).toBe(409);
    const updated = await f.send('put', `/${row._id}`, {
      ...body,
      title: 'Updated title',
      revision: row.revision,
    });
    expect(updated.status).toBe(200);
    expect((await f.send('put', `/${row._id}`, { ...body, revision: row.revision })).status).toBe(
      409,
    );
    expect(
      await db.auditEvents.count({ where: { actorId: f.userId, resource: 'blog-post' } }),
    ).toBe(2);
  });
  it('publishes, unpublishes, duplicates as draft and replays deletion after soft delete', async () => {
    const f = await fixture();
    let row = await f.create();
    expect((await request(app).get(`/api/v1/public/blog/${row.slug}`)).status).toBe(404);
    let r = await f.send('post', `/${row._id}/publish`, { revision: row.revision });
    expect(r.status).toBe(200);
    row = r.body.data;
    expect(row.status).toBe('published');
    expect((await request(app).get(`/api/v1/public/blog/${row.slug}`)).status).toBe(200);
    row = (await f.get(`/${row._id}/edit`)).body.data.post;
    r = await f.send('post', `/${row._id}/duplicate`, { revision: row.revision });
    expect(r.status).toBe(200);
    ids.push(r.body.data._id);
    expect(r.body.data).toMatchObject({
      status: 'draft',
      published_at: null,
      scheduled_at: null,
      views_count: 0,
    });
    expect(r.body.data.slug).not.toBe(row.slug);
    r = await f.send('post', `/${row._id}/unpublish`, { revision: row.revision });
    expect(r.status).toBe(200);
    row = r.body.data;
    expect(row.status).toBe('draft');
    const key = randomUUID(),
      removed = await f.send('delete', `/${row._id}`, { revision: row.revision }, key);
    expect(removed.status).toBe(200);
    expect((await f.send('delete', `/${row._id}`, { revision: row.revision }, key)).body).toEqual(
      removed.body,
    );
    expect((await f.get(`/${row._id}/edit`)).status).toBe(404);
    expect((await request(app).get(`/api/v1/public/blog/${row.slug}`)).status).toBe(404);
  });
  it('supports category/tag filters, bounded literal search and safe editor and preview data', async () => {
    const f = await fixture(),
      suffix = randomUUID();
    const c = await db.blogCategories.create({
      data: { name: `Category ${suffix}`, slug: `category-${suffix}`, status: true },
    });
    categories.push(c.id);
    const t = await db.blogTags.create({ data: { name: `Tag ${suffix}`, slug: `tag-${suffix}` } });
    tags.push(t.id);
    const row = await f.create({
      ...f.body,
      title: `Literal %_${suffix}`,
      category_id: c.id,
      tag_ids: [t.id],
    });
    const list = await f.get('', { category: c.id, status: 'draft', search: '%_', limit: 1 });
    expect(list.status).toBe(200);
    expect(list.body.data.posts.total).toBe(1);
    expect(list.body.data.posts.items[0]._id).toBe(row._id);
    expect((await f.get('', { category: c.id, search: t.name })).body.data.posts.total).toBe(1);
    const editor = await f.get(`/${row._id}/edit`);
    expect(editor.body.data.post.tag_ids).toEqual([t.id]);
    expect(editor.body.data.categories).toContainEqual({ _id: c.id, name: c.name, slug: c.slug });
    expect((await f.get('/create')).body.data.post).toBeNull();
    expect((await f.get(`/${row._id}/preview`)).body.data).toMatchObject({
      isPreview: true,
      post: { _id: row._id, status: 'draft' },
    });
    expect((await f.get('', { limit: 101 })).status).toBe(400);
    expect((await f.get('', { page: 2147483647, limit: 100 })).status).toBe(200);
  });
  it('handles scheduled and preview intents without publishing drafts or clearing preserved media', async () => {
    const f = await fixture(),
      row = await f.create({
        ...f.body,
        intent: 'schedule',
        scheduled_at: new Date(Date.now() + 86400000).toISOString(),
      });
    expect(row.status).toBe('scheduled');
    await db.blogPosts.update({
      where: { id: row._id },
      data: { featuredImage: 'legacy/private-image.webp', ogImage: 'legacy/private-social.webp' },
    });
    const current = (await f.get(`/${row._id}/edit`)).body.data.post;
    const r = await f.send('put', `/${row._id}`, {
      ...f.body,
      intent: 'preview',
      revision: current.revision,
    });
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe('scheduled');
    expect(r.body.data.scheduled_at).toBe(row.scheduled_at);
    expect(
      await db.blogPosts.findUnique({
        where: { id: row._id },
        select: { featuredImage: true, ogImage: true },
      }),
    ).toEqual({
      featuredImage: 'legacy/private-image.webp',
      ogImage: 'legacy/private-social.webp',
    });
  });
  it('rejects unsupported source image/new-tag fields, collisions, invalid references and missing retry keys', async () => {
    const f = await fixture(),
      row = await f.create();
    for (const extra of [
      { new_tags: 'Inline tag' },
      { featured_image: '/private/file' },
      { remove_featured_image: true },
      { authorId: f.userId },
      { authorName: 'Native field' },
      { revision: 'unexpected' },
    ])
      expect((await f.send('post', '', { ...f.body, ...extra })).status).toBe(400);
    expect((await f.send('post', '', { ...f.body, slug: row.slug })).status).toBe(409);
    expect((await f.send('post', '', { ...f.body, category_id: 2147483647 })).status).toBe(400);
    expect((await f.send('post', '', { ...f.body, tag_ids: [2147483647] })).status).toBe(400);
    expect((await f.send('post', '', { ...f.body, intent: 'schedule' })).status).toBe(400);
    expect(
      (await request(app).post(prefix).set('Authorization', `Bearer ${f.token}`).send(f.body))
        .status,
    ).toBe(400);
    expect((await f.send('post', `/${row._id}/publish`, {})).status).toBe(400);
  });
  it('rolls back article, audit and replay together on audit failure', async () => {
    const f = await fixture(),
      spy = vi.spyOn(db, '$transaction'),
      original = db.$transaction.bind(db);
    spy.mockImplementationOnce(((work: any) =>
      original(async (tx: any) =>
        work({
          ...tx,
          auditEvents: {
            ...tx.auditEvents,
            create: async () => {
              throw new Error('Audit unavailable');
            },
          },
        }),
      )) as any);
    expect((await f.send('post')).status).toBe(500);
    expect(await db.blogPosts.count({ where: { title: f.body.title } })).toBe(0);
    expect(
      await db.configurations.count({
        where: { name: { startsWith: `legacy-blog:${f.userId}:` } },
      }),
    ).toBe(0);
  });
  it('rejects non-administrators and revoked current roles in native and legacy transactions', async () => {
    const owner = await fixture(false);
    expect((await owner.get()).status).toBe(403);
    expect((await owner.send('post')).status).toBe(403);
    const f = await fixture(),
      original = db.$transaction.bind(db);
    for (const legacy of [true, false]) {
      vi.spyOn(db, '$transaction').mockImplementationOnce(((work: any) =>
        original(async (tx: any) => {
          await tx.users.update({ where: { id: f.userId }, data: { userRolesId: null } });
          return work(tx);
        })) as any);
      const r = legacy
        ? await f.send('post')
        : await request(app)
            .post('/api/v1/admin/content/blog')
            .set('Authorization', `Bearer ${f.token}`)
            .send({ title: f.body.title, excerpt: f.body.excerpt, content: f.body.content });
      expect(r.status).toBe(403);
      vi.restoreAllMocks();
    }
    expect(await db.blogPosts.count({ where: { title: f.body.title } })).toBe(0);
  });
  it('detects native edits before a legacy update', async () => {
    const f = await fixture(),
      row = await f.create();
    const r = await request(app)
      .put(`/api/v1/admin/content/blog/${row._id}`)
      .set('Authorization', `Bearer ${f.token}`)
      .send({ title: 'Native change', excerpt: f.body.excerpt, content: f.body.content });
    expect(r.status).toBe(200);
    expect((await f.send('put', `/${row._id}`, { ...f.body, revision: row.revision })).status).toBe(
      409,
    );
  });
});
