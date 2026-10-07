import { authorizePages } from './page-access.service.js';
import { Prisma } from '@prisma/client';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { prepareArticleContent } from './article-content.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import {
  published,
  summary,
  articleDto,
  adminSelect,
  savePost,
  contentTransaction,
  existingPost,
  uniqueSlug,
  auditPost,
} from './content-support.service.js';

export async function publishScheduledPosts(at = new Date()) {
  return db.blogPosts.updateMany({
    where: { status: 'scheduled', scheduledAt: { lte: at }, deletedAt: null },
    data: { status: 'published', publishedAt: at, scheduledAt: null, updatedAt: at },
  });
}

export async function listPublicBlogCategories(requestInput: ServiceContext) {
  const categories = await db.blogCategories.findMany({
    where: { status: true, childrenBlogPostsCategoryId: { some: published() } },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      _count: { select: { childrenBlogPostsCategoryId: { where: published() } } },
    },
  });
  return serviceResult(
    categories.map(({ _count, ...category }) => ({
      ...category,
      postsCount: _count.childrenBlogPostsCategoryId,
    })),
    { status: 200, format: 'json' },
  );
}

export async function listPublicBlogPosts(requestInput: ServiceContext) {
  const q = requestInput.validatedQuery,
    where: Prisma.BlogPostsWhereInput = { ...published() };
  if (q.category) where.refCategoryId = { slug: q.category };
  if (q.search)
    where.OR = [
      ...['title', 'excerpt', 'content'].map((field) => ({
        [field]: { contains: q.search, mode: 'insensitive' as const },
      })),
      { refCategoryId: { name: { contains: q.search, mode: 'insensitive' } } },
      {
        childrenBlogPostTagBlogPostId: {
          some: { refBlogTagId: { name: { contains: q.search, mode: 'insensitive' } } },
        },
      },
    ];
  const [rows, total] = await db.$transaction([
    db.blogPosts.findMany({
      where,
      select: summary,
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      take: q.limit,
      skip: (q.page - 1) * q.limit,
    }),
    db.blogPosts.count({ where }),
  ]);
  return serviceResult(
    { items: rows.map(articleDto), total, page: q.page, limit: q.limit },
    { status: 200, format: 'json' },
  );
}

export async function getPublicBlogPost(requestInput: ServiceContext) {
  const result = await db.$transaction(async (tx) => {
    const at = new Date(),
      row = await tx.blogPosts.findFirst({
        where: { ...published(at), slug: String(requestInput.params.slug) },
        select: {
          ...summary,
          content: true,
          seoTitle: true,
          metaDescription: true,
          metaKeywords: true,
          canonicalUrl: true,
          ogTitle: true,
          ogDescription: true,
          ogImage: true,
        },
      });
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Article not found');
    // Recheck publication while incrementing so a concurrent unpublish cannot expose a draft.
    const updated = await tx.blogPosts.updateMany({
      where: { ...published(at), id: row.id },
      data: { viewsCount: { increment: 1 } },
    });
    if (!updated.count) throw new ApiError(404, 'NOT_FOUND', 'Article not found');
    const tagIds = row.childrenBlogPostTagBlogPostId.map((link) => link.refBlogTagId.id);
    const alternatives: Prisma.BlogPostsWhereInput[] = [];
    if (row.refCategoryId) alternatives.push({ categoryId: row.refCategoryId.id });
    if (tagIds.length)
      alternatives.push({ childrenBlogPostTagBlogPostId: { some: { blogTagId: { in: tagIds } } } });
    const related = alternatives.length
      ? await tx.blogPosts.findMany({
          where: { ...published(at), id: { not: row.id }, OR: alternatives },
          select: summary,
          orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
          take: 3,
        })
      : [];
    const adjacentSelect = { title: true, slug: true, publishedAt: true };
    const [previous, next] = await Promise.all([
      tx.blogPosts.findFirst({
        where: {
          ...published(at),
          OR: [
            { publishedAt: { lt: row.publishedAt! } },
            { publishedAt: row.publishedAt, id: { lt: row.id } },
          ],
        },
        select: adjacentSelect,
        orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      }),
      tx.blogPosts.findFirst({
        where: {
          ...published(at),
          OR: [
            { publishedAt: { gt: row.publishedAt! } },
            { publishedAt: row.publishedAt, id: { gt: row.id } },
          ],
        },
        select: adjacentSelect,
        orderBy: [{ publishedAt: 'asc' }, { id: 'asc' }],
      }),
    ]);
    const prepared = prepareArticleContent(row.content);
    return {
      post: {
        ...articleDto(row),
        content: prepared.html,
        contentToc: prepared.toc,
        viewsCount: row.viewsCount + 1,
      },
      relatedPosts: related.map(articleDto),
      previousPost: previous,
      nextPost: next,
    };
  });
  return serviceResult(result, { status: 200, format: 'json' });
}

export async function listAdminBlogPosts(requestInput: ServiceContext) {
  const q = requestInput.validatedQuery,
    where: Prisma.BlogPostsWhereInput = {
      deletedAt: null,
      ...(q.status ? { status: q.status } : {}),
      ...(q.search ? { title: { contains: q.search, mode: 'insensitive' } } : {}),
    };
  const [items, total] = await db.$transaction([
    db.blogPosts.findMany({
      where,
      select: adminSelect,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    }),
    db.blogPosts.count({ where }),
  ]);
  return serviceResult(
    { items, total, page: q.page, limit: q.limit },
    { status: 200, format: 'json' },
  );
}

export async function createBlogPost(requestInput: ServiceContext) {
  return serviceResult(await savePost(requestInput), {
    status: 201,
    format: 'json',
  });
}

export async function updateBlogPost(requestInput: ServiceContext) {
  return serviceResult(await savePost(requestInput, Number(requestInput.params.id)), {
    status: 200,
    format: 'json',
  });
}

export async function getAdminBlogPost(requestInput: ServiceContext) {
  const row = await db.blogPosts.findFirst({
    where: { id: Number(requestInput.params.id), deletedAt: null },
    select: adminSelect,
  });
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Article not found');
  return serviceResult(row, { status: 200, format: 'json' });
}

export async function deleteBlogPost(requestInput: ServiceContext) {
  await contentTransaction((tx) =>
    deleteBlogPostTransaction(tx, requestInput, Number(requestInput.params.id)),
  );
  return serviceResult(undefined, { status: 204, format: 'empty' });
}
export async function deleteBlogPostTransaction(
  tx: Prisma.TransactionClient,
  input: ServiceContext,
  id: number,
) {
  await authorizePages(tx, input);
  const row = await existingPost(tx, id);
  await tx.blogPosts.update({
    where: { id: row.id },
    data: { deletedAt: new Date(), updatedAt: new Date() },
  });
  await auditPost(tx, input, 'delete', id);
}
export async function changeBlogPostState(
  requestInput: ServiceContext,
  action: 'publish' | 'unpublish' | 'duplicate',
) {
  const saved = await contentTransaction((tx) =>
    changeBlogPostStateTransaction(tx, requestInput, Number(requestInput.params.id), action),
  );
  return serviceResult(saved, { status: action === 'duplicate' ? 201 : 200, format: 'json' });
}
export async function changeBlogPostStateTransaction(
  tx: Prisma.TransactionClient,
  input: ServiceContext,
  id: number,
  action: 'publish' | 'unpublish' | 'duplicate',
) {
  await authorizePages(tx, input);
  const row = await existingPost(tx, id);
  if (action !== 'duplicate') {
    const saved = await tx.blogPosts.update({
      where: { id },
      data: {
        status: action === 'publish' ? 'published' : 'draft',
        publishedAt: action === 'publish' ? (row.publishedAt ?? new Date()) : row.publishedAt,
        scheduledAt: null,
        updatedAt: new Date(),
      },
      select: adminSelect,
    });
    await auditPost(tx, input, action, id);
    return saved;
  }
  const { id: oldId, uid, createdAt, updatedAt, ...copy } = row;
  const title = `${row.title} (Copy)`;
  const prepared = prepareArticleContent(row.content);
  const saved = await tx.blogPosts.create({
    data: {
      ...copy,
      content: prepared.html,
      contentToc: prepared.toc,
      readingTime: prepared.readingTime,
      title,
      slug: await uniqueSlug(tx, 'blogPosts', title),
      status: 'draft',
      publishedAt: null,
      scheduledAt: null,
      viewsCount: 0,
    },
  });
  const links = await tx.blogPostTag.findMany({ where: { blogPostId: oldId } });
  await tx.blogPostTag.createMany({
    data: [...new Set(links.map((l) => l.blogTagId))].map((blogTagId) => ({
      blogPostId: saved.id,
      blogTagId,
    })),
  });
  await auditPost(tx, input, 'duplicate', saved.id);
  return tx.blogPosts.findUniqueOrThrow({ where: { id: saved.id }, select: adminSelect });
}
