import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { prepareArticleContent } from '../src/modules/content/services/article-content.js';
import { publishScheduledPosts } from '../src/modules/content/services/blog-posts.service.js';
import { businessFixture } from './fixtures.js';

const app = createApp(),
  suffix = randomUUID();
const adminPath = '/api/v1/admin/content',
  publicPath = '/api/v1/public';
let admin: Awaited<ReturnType<typeof businessFixture>>,
  owner: typeof admin,
  restricted: typeof admin;
const ids: number[] = [],
  categoryIds: number[] = [],
  tagIds: number[] = [],
  pageIds: number[] = [];
const body = (title = `Article ${suffix}`) => ({
  title,
  excerpt: 'An article about backend migrations.',
  content: '<h2>Overview</h2><p>Safe and useful article content.</p>',
});
const auth = (token: string) => `Bearer ${token}`;
beforeAll(async () => {
  [admin, owner, restricted] = await Promise.all([
    businessFixture(),
    businessFixture(),
    businessFixture(),
  ]);
  // Do not change existing role titles or permissions in the reused test database.
  for (const id of [1, 4])
    await db.userRoles.upsert({
      where: { id },
      create: { id, title: `Content test role ${id}` },
      update: {},
    });
  await db.users.update({ where: { id: admin.userId }, data: { userRolesId: 1 } });
  await db.users.update({ where: { id: restricted.userId }, data: { userRolesId: 4 } });
});
afterAll(async () => {
  await db.blogPosts.deleteMany({ where: { id: { in: ids } } });
  await db.blogCategories.deleteMany({ where: { id: { in: categoryIds } } });
  await db.blogTags.deleteMany({ where: { id: { in: tagIds } } });
  await db.pages.deleteMany({ where: { id: { in: pageIds } } });
  await db.nativeMemberships.deleteMany({
    where: { userId: { in: [admin.userId, owner.userId, restricted.userId] } },
  });
  await db.authSessions.deleteMany({
    where: { userId: { in: [admin.userId, owner.userId, restricted.userId] } },
  });
  await db.vendors.deleteMany({
    where: { id: { in: [admin.vendorId, owner.vendorId, restricted.vendorId] } },
  });
  await db.users.deleteMany({
    where: { id: { in: [admin.userId, owner.userId, restricted.userId] } },
  });
  await db.$disconnect();
});
async function post(input = body()) {
  const response = await request(app)
    .post(`${adminPath}/blog`)
    .set('Authorization', auth(admin.token))
    .send(input);
  expect(response.status).toBe(201);
  ids.push(response.body.id);
  return response.body;
}

describe('article content preparation', () => {
  it('removes executable HTML, unsafe URLs and arbitrary iframe hosts', () => {
    const result = prepareArticleContent(
      '<h2>Safe</h2><script>alert(1)</script><img src="javascript:alert(1)" onerror="alert(2)"><a href="jav&#x61;script:alert(1)" target="_blank">link</a><iframe src="https://evil.example/embed"></iframe><iframe src="https://www.youtube.com/embed/test"></iframe>',
    );
    expect(result.html).not.toMatch(/script|onerror|evil\.example/);
    expect(result.html).toContain('noopener noreferrer');
    expect(result.html).toContain('https://www.youtube.com/embed/test');
  });
  it('normalizes headings, keeps Unicode titles and generates unique table-of-contents anchors', () => {
    const result = prepareArticleContent(
      '<h3>Overview &amp; details</h3><h3>Overview &amp; details</h3><h4>Next</h4>',
    );
    expect(result.toc).toEqual([
      { id: 'overview-details', title: 'Overview & details', level: 2 },
      { id: 'overview-details-2', title: 'Overview & details', level: 2 },
      { id: 'next', title: 'Next', level: 3 },
    ]);
    expect(result.html).toContain('<h2 id="overview-details">');
  });
  it('converts legacy Markdown fragments and strips embedded HTML after conversion', () => {
    const result = prepareArticleContent('<p>## Legacy title</p><p>**Strong** text</p>');
    expect(result.html).toContain('<h2 id="legacy-title">Legacy title</h2>');
    expect(result.html).toContain('<strong>Strong</strong>');
  });
});

describe('central blog CMS and public visibility', () => {
  it('denies anonymous users and business owners even with wildcard business permissions', async () => {
    expect((await request(app).post(`${adminPath}/blog`).send(body())).status).toBe(401);
    expect(
      (
        await request(app)
          .post(`${adminPath}/blog`)
          .set('Authorization', auth(owner.token))
          .send(body())
      ).status,
    ).toBe(403);
  });
  it('allows the source central admin role for blogs and denies that role for page management', async () => {
    expect(
      (await request(app).get(`${adminPath}/blog`).set('Authorization', auth(restricted.token)))
        .status,
    ).toBe(200);
    expect(
      (await request(app).get(`${adminPath}/pages`).set('Authorization', auth(restricted.token)))
        .status,
    ).toBe(403);
  });
  it('rechecks revoked central roles on existing sessions', async () => {
    await db.users.update({ where: { id: restricted.userId }, data: { userRolesId: null } });
    expect(
      (await request(app).get(`${adminPath}/blog`).set('Authorization', auth(restricted.token)))
        .status,
    ).toBe(403);
    await db.users.update({ where: { id: restricted.userId }, data: { userRolesId: 4 } });
  });
  it('keeps drafts, deleted articles and future publications out of public lists and details', async () => {
    const draft = await post(),
      future = await post(body(`Future ${suffix}`)),
      deleted = await post(body(`Deleted ${suffix}`));
    await db.blogPosts.update({
      where: { id: future.id },
      data: { status: 'published', publishedAt: new Date(Date.now() + 3600000) },
    });
    await db.blogPosts.update({
      where: { id: deleted.id },
      data: { status: 'published', publishedAt: new Date(), deletedAt: new Date() },
    });
    for (const row of [draft, future, deleted])
      expect((await request(app).get(`${publicPath}/blog/${row.slug}`)).status).toBe(404);
    const result = await request(app).get(`${publicPath}/blog`).query({ search: suffix });
    expect(result.status).toBe(200);
    expect(result.body.items).toEqual([]);
  });
  it('publishes and unpublishes with safe content, sanitized author names and atomic view counts', async () => {
    const row = await post({
      ...body(`Published ${suffix}`),
      authorName: 'Super Administrator',
      content: '<h2>Details</h2><p>This is useful content.</p><script>alert(1)</script>',
    } as any);
    expect(
      (
        await request(app)
          .post(`${adminPath}/blog/${row.id}/publish`)
          .set('Authorization', auth(admin.token))
          .send({})
      ).status,
    ).toBe(200);
    const responses = await Promise.all([
      request(app).get(`${publicPath}/blog/${row.slug}`),
      request(app).get(`${publicPath}/blog/${row.slug}`),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(response.body.post.authorName).toBe('Whalexy Editorial Team');
      expect(response.body.post.content).not.toContain('script');
      expect(response.body.post.authorId).toBeUndefined();
      expect(response.body.post.refAuthorId).toBeUndefined();
    }
    expect((await db.blogPosts.findUniqueOrThrow({ where: { id: row.id } })).viewsCount).toBe(2);
    expect(
      (
        await request(app)
          .post(`${adminPath}/blog/${row.id}/unpublish`)
          .set('Authorization', auth(admin.token))
          .send({})
      ).status,
    ).toBe(200);
    expect((await request(app).get(`${publicPath}/blog/${row.slug}`)).status).toBe(404);
  });
  it('creates concurrent unique slugs and rejects attempts to inject authors or view counts', async () => {
    const responses = await Promise.all([
      post(body(`Concurrent ${suffix}`)),
      post(body(`Concurrent ${suffix}`)),
    ]);
    expect(new Set(responses.map((row) => row.slug)).size).toBe(2);
    for (const injection of [
      { authorId: owner.userId },
      { viewsCount: 9000 },
      { deletedAt: null },
      { vendorId: owner.vendorId },
    ]) {
      expect(
        (
          await request(app)
            .post(`${adminPath}/blog`)
            .set('Authorization', auth(admin.token))
            .send({ ...body(), ...injection })
        ).status,
      ).toBe(400);
    }
  });
  it('validates categories and tags transactionally and finds publications by taxonomy', async () => {
    const category = await request(app)
      .post(`${adminPath}/blog-taxonomy/categories`)
      .set('Authorization', auth(admin.token))
      .send({ name: `Topic ${suffix}` });
    expect(category.status).toBe(201);
    categoryIds.push(category.body.id);
    const tag = await request(app)
      .post(`${adminPath}/blog-taxonomy/tags`)
      .set('Authorization', auth(admin.token))
      .send({ name: `Keyword ${suffix}` });
    expect(tag.status).toBe(201);
    tagIds.push(tag.body.id);
    const row = await post({
      ...body(`Taxonomy ${suffix}`),
      categoryId: category.body.id,
      tagIds: [tag.body.id],
      intent: 'publish',
    } as any);
    const list = await request(app)
      .get(`${publicPath}/blog`)
      .query({ search: tag.body.name, category: category.body.slug });
    expect(list.status).toBe(200);
    expect(list.body.items.map((item: any) => item.id)).toContain(row.id);
    expect(
      (await request(app).get(`${publicPath}/blog/categories`)).body.find(
        (item: any) => item.id === category.body.id,
      ).postsCount,
    ).toBe(1);
    const duplicate = await request(app)
      .post(`${adminPath}/blog/${row.id}/duplicate`)
      .set('Authorization', auth(admin.token))
      .send({});
    expect(duplicate.status).toBe(201);
    ids.push(duplicate.body.id);
    expect(duplicate.body.status).toBe('draft');
    expect(duplicate.body.publishedAt).toBeNull();
    expect(duplicate.body.childrenBlogPostTagBlogPostId).toHaveLength(1);
    expect(duplicate.body.slug).not.toBe(row.slug);
    const count = await db.blogPosts.count();
    expect(
      (
        await request(app)
          .post(`${adminPath}/blog`)
          .set('Authorization', auth(admin.token))
          .send({ ...body(), tagIds: [2147483647] })
      ).status,
    ).toBe(400);
    expect(await db.blogPosts.count()).toBe(count);
  });
  it('soft-deletes posts and excludes them from both CMS and publication scheduling', async () => {
    const row = await post();
    expect(
      (
        await request(app)
          .delete(`${adminPath}/blog/${row.id}`)
          .set('Authorization', auth(admin.token))
      ).status,
    ).toBe(204);
    expect(
      (
        await request(app)
          .get(`${adminPath}/blog/${row.id}`)
          .set('Authorization', auth(admin.token))
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .post(`${adminPath}/blog/${row.id}/publish`)
          .set('Authorization', auth(admin.token))
          .send({})
      ).status,
    ).toBe(404);
    expect(
      (await db.blogPosts.findUniqueOrThrow({ where: { id: row.id } })).deletedAt,
    ).not.toBeNull();
  });
  it('publishes scheduled posts only after their deadline and never publishes deleted rows', async () => {
    const deadline = new Date(Date.now() + 3600000),
      row = await post({
        ...body(`Scheduled ${suffix}`),
        intent: 'schedule',
        scheduledAt: deadline.toISOString(),
      } as any);
    const deleted = await post({
      ...body(`Scheduled deleted ${suffix}`),
      intent: 'schedule',
      scheduledAt: deadline.toISOString(),
    } as any);
    await db.blogPosts.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
    await publishScheduledPosts(new Date(deadline.getTime() - 1));
    expect((await db.blogPosts.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
      'scheduled',
    );
    await Promise.all([publishScheduledPosts(deadline), publishScheduledPosts(deadline)]);
    expect((await db.blogPosts.findUniqueOrThrow({ where: { id: row.id } })).publishedAt).toEqual(
      deadline,
    );
    expect((await db.blogPosts.findUniqueOrThrow({ where: { id: deleted.id } })).status).toBe(
      'scheduled',
    );
  });
  it('rejects invalid pagination, query injection and expired publication schedules', async () => {
    for (const query of [{ page: 0 }, { limit: 1000 }, { status: 'draft' }, { search: ['a', 'b'] }])
      expect((await request(app).get(`${publicPath}/blog`).query(query)).status).toBe(400);
    expect(
      (
        await request(app)
          .post(`${adminPath}/blog`)
          .set('Authorization', auth(admin.token))
          .send({ ...body(), intent: 'schedule', scheduledAt: new Date(0).toISOString() })
      ).status,
    ).toBe(400);
  });
});

describe('public and central pages', () => {
  it('creates safe pages, hides disabled pages and respects menu visibility independently', async () => {
    const row = await request(app)
      .post(`${adminPath}/pages`)
      .set('Authorization', auth(admin.token))
      .send({
        title: 'Policy',
        slug: `policy${suffix.replaceAll('-', '')}`,
        content: '<p>Policy text</p><script>alert(1)</script>',
        status: 1,
        showInMenu: 0,
      });
    expect(row.status).toBe(201);
    pageIds.push(row.body.id);
    const publicPage = await request(app).get(`${publicPath}/pages/${row.body.slug}`);
    expect(publicPage.status).toBe(200);
    expect(publicPage.body.content).not.toContain('script');
    expect(
      (await request(app).get(`${publicPath}/pages`)).body.some(
        (page: any) => page.uid === row.body.uid,
      ),
    ).toBe(false);
    expect(
      (
        await request(app)
          .put(`${adminPath}/pages/${row.body.id}`)
          .set('Authorization', auth(admin.token))
          .send({
            title: 'Policy',
            slug: row.body.slug,
            content: 'Disabled content',
            status: 0,
            showInMenu: 1,
          })
      ).status,
    ).toBe(200);
    expect((await request(app).get(`${publicPath}/pages/${row.body.slug}`)).status).toBe(404);
  });
  it('isolates vendor pages and rejects duplicate slugs without altering existing content', async () => {
    const slug = `private${suffix.replaceAll('-', '')}`,
      row = await db.pages.create({
        data: { title: 'Private', slug, status: 1, showInMenu: 1, vendorId: owner.vendorId },
      });
    pageIds.push(row.id);
    expect((await request(app).get(`${publicPath}/pages/${slug}`)).status).toBe(404);
    expect(
      (
        await request(app)
          .put(`${adminPath}/pages/${row.id}`)
          .set('Authorization', auth(admin.token))
          .send({ title: 'Override', slug, content: 'Changed' })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .delete(`${adminPath}/pages/${row.id}`)
          .set('Authorization', auth(admin.token))
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .post(`${adminPath}/pages`)
          .set('Authorization', auth(admin.token))
          .send({ title: 'Duplicate', slug, content: 'Text' })
      ).status,
    ).toBe(409);
    expect((await db.pages.findUniqueOrThrow({ where: { id: row.id } })).title).toBe('Private');
  });
});
