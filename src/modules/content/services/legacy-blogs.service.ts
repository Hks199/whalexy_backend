import { Prisma } from '@prisma/client';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { digest } from '../../../utils/crypto.js';
import { authorizePages } from './page-access.service.js';
import { prepareArticleContent } from './article-content.js';
import { adminSelect, savePostTransaction, contentTransaction } from './content-support.service.js';
import { deleteBlogPostTransaction, changeBlogPostStateTransaction } from './blog-posts.service.js';
function revision(row: any) {
  return digest(
    JSON.stringify(
      canonical({
        ...row,
        childrenBlogPostTagBlogPostId: [...row.childrenBlogPostTagBlogPostId].sort(
          (a: any, b: any) => a.refBlogTagId.id - b.refBlogTagId.id,
        ),
      }),
    ),
  );
}
function projection(row: any) {
  const prepared = prepareArticleContent(row.content);
  return {
    _id: row.id,
    _uid: row.uid,
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt,
    content: prepared.html,
    content_toc: prepared.toc,
    reading_time: prepared.readingTime,
    locale: row.locale,
    author_name: row.authorName,
    category_id: row.categoryId,
    tag_ids: row.childrenBlogPostTagBlogPostId
      .map((l: any) => l.refBlogTagId.id)
      .sort((a: number, b: number) => a - b),
    status: row.status,
    published_at: row.publishedAt,
    scheduled_at: row.scheduledAt,
    views_count: row.viewsCount,
    seo_title: row.seoTitle,
    meta_description: row.metaDescription,
    meta_keywords: row.metaKeywords,
    canonical_url: row.canonicalUrl,
    og_title: row.ogTitle,
    og_description: row.ogDescription,
    updated_at: row.updatedAt,
    revision: revision(row),
  };
}
async function find(tx: Prisma.TransactionClient, id: number) {
  const row = await tx.blogPosts.findFirst({ where: { id, deletedAt: null }, select: adminSelect });
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Article not found');
  return row;
}
function result(data: any) {
  return serviceResult({ reaction: 1, message: '', data }, { status: 200, format: 'json' });
}
export async function editor(input: ServiceContext, mode: 'create' | 'edit' | 'preview') {
  const data = await db.$transaction(
    async (tx) => {
      await authorizePages(tx, input);
      const post = mode === 'create' ? null : projection(await find(tx, Number(input.params.blog)));
      const [categories, tags] = await Promise.all([
        tx.blogCategories.findMany({
          where: { status: true },
          select: { id: true, name: true, slug: true },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
        }),
        tx.blogTags.findMany({
          select: { id: true, name: true, slug: true },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
        }),
      ]);
      return {
        post,
        categories: categories.map((c) => ({ _id: c.id, name: c.name, slug: c.slug })),
        tags: tags.map((t) => ({ _id: t.id, name: t.name, slug: t.slug })),
        isPreview: mode === 'preview',
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  return result(data);
}
export async function list(input: ServiceContext) {
  const q = input.validatedQuery;
  const data = await db.$transaction(
    async (tx) => {
      await authorizePages(tx, input);
      const term = q.search?.replace(/[\\%_]/g, '\\$&');
      const where: Prisma.BlogPostsWhereInput = {
        deletedAt: null,
        ...(q.status ? { status: q.status } : {}),
        ...(q.category ? { categoryId: q.category } : {}),
        ...(term
          ? {
              OR: [
                ...['title', 'excerpt', 'content'].map((f) => ({
                  [f]: { contains: term, mode: 'insensitive' as const },
                })),
                {
                  childrenBlogPostTagBlogPostId: {
                    some: { refBlogTagId: { name: { contains: term, mode: 'insensitive' } } },
                  },
                },
              ],
            }
          : {}),
      };
      const [rows, total, statistics, categories] = await Promise.all([
        tx.blogPosts.findMany({
          where,
          select: adminSelect,
          orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
          take: q.limit,
          skip: (q.page - 1) * q.limit,
        }),
        tx.blogPosts.count({ where }),
        tx.blogPosts.groupBy({
          by: ['status'],
          where: { deletedAt: null },
          _count: { _all: true },
          _sum: { viewsCount: true },
        }),
        tx.blogCategories.findMany({
          select: { id: true, name: true, slug: true },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
        }),
      ]);
      return {
        posts: { items: rows.map(projection), total, page: q.page, limit: q.limit },
        statistics: {
          total: statistics.reduce((n, r) => n + r._count._all, 0),
          published: statistics.find((r) => r.status === 'published')?._count._all ?? 0,
          draft: statistics.find((r) => r.status === 'draft')?._count._all ?? 0,
          scheduled: statistics.find((r) => r.status === 'scheduled')?._count._all ?? 0,
          views: statistics.reduce((n, r) => n + (r._sum.viewsCount ?? 0), 0),
          categories: categories.length,
        },
        categories: categories.map((c) => ({ _id: c.id, name: c.name, slug: c.slug })),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  return result(data);
}
function canonical(value: any): any {
  return value instanceof Date
    ? value.toISOString()
    : Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((k) => [k, canonical(value[k])]),
          )
        : value;
}
export async function mutate(
  input: ServiceContext,
  action: 'create' | 'update' | 'delete' | 'duplicate' | 'publish' | 'unpublish',
) {
  const raw = input.headers['idempotency-key'];
  if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(raw))
    throw new ApiError(400, 'IDEMPOTENCY_REQUIRED', 'A valid Idempotency-Key is required');
  const id = Number(input.params.blog),
    name = `legacy-blog:${input.identity!.userId}:${raw}`,
    hash = digest(
      JSON.stringify(canonical({ action, id: Number.isNaN(id) ? null : id, body: input.body })),
    );
  const response = await contentTransaction(async (tx) => {
    await authorizePages(tx, input);
    const records = await tx.configurations.findMany({ where: { name }, take: 2 });
    if (records.length > 1)
      throw new ApiError(409, 'REPLAY_REVIEW_REQUIRED', 'Duplicate replay entries');
    if (records.length) {
      let stored: any;
      try {
        stored = JSON.parse(records[0].value ?? '');
      } catch {
        throw new ApiError(409, 'REPLAY_REVIEW_REQUIRED', 'Invalid replay entry');
      }
      if (!stored || stored.nativeVersion !== 1 || stored.response?.reaction !== 1)
        throw new ApiError(409, 'REPLAY_REVIEW_REQUIRED', 'Invalid replay response');
      if (stored.hash !== hash)
        throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Key was used for another request');
      return stored.response;
    }
    if (action !== 'create') {
      const current = await find(tx, id);
      if (input.body.revision !== revision(current))
        throw new ApiError(409, 'ARTICLE_CONFLICT', 'Article changed; reload before saving');
    }
    let data: any;
    if (action === 'create' || action === 'update') {
      const { revision: unused, ...body } = input.body;
      if (
        body.slug &&
        (await tx.blogPosts.findFirst({
          where: { slug: body.slug, ...(action === 'update' ? { id: { not: id } } : {}) },
          select: { id: true },
        }))
      )
        throw new ApiError(409, 'SLUG_CONFLICT', 'Slug already exists');
      const saved = await savePostTransaction(
        tx,
        { ...input, body },
        action === 'update' ? id : undefined,
      );
      data = projection(saved);
    } else if (action === 'delete') {
      await deleteBlogPostTransaction(tx, input, id);
      data = { _id: id, deleted: true };
    } else data = projection(await changeBlogPostStateTransaction(tx, input, id, action));
    const response = { reaction: 1, message: 'Article updated successfully', data };
    await tx.configurations.create({
      data: { name, dataType: 4, value: JSON.stringify({ nativeVersion: 1, hash, response }) },
    });
    return response;
  });
  return serviceResult(response, { status: 200, format: 'json' });
}
