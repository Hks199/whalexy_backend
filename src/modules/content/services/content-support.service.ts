import { authorizePages, ownedSitePage } from './page-access.service.js';
import type { ServiceContext } from '../../../shared/service-context.js';
import { Prisma } from '@prisma/client';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { contentSlug, prepareArticleContent } from './article-content.js';

export const published = (at = new Date()): Prisma.BlogPostsWhereInput => ({
  deletedAt: null,
  status: 'published',
  publishedAt: { lte: at },
});

export const summary = {
  id: true,
  uid: true,
  title: true,
  slug: true,
  excerpt: true,
  locale: true,
  authorName: true,
  featuredImage: true,
  publishedAt: true,
  readingTime: true,
  viewsCount: true,
  refAuthorId: { select: { firstName: true, lastName: true } },
  refCategoryId: { select: { id: true, name: true, slug: true } },
  childrenBlogPostTagBlogPostId: {
    select: { refBlogTagId: { select: { id: true, name: true, slug: true } } },
  },
} satisfies Prisma.BlogPostsSelect;

export function articleDto(row: any) {
  const {
    refAuthorId,
    refCategoryId,
    childrenBlogPostTagBlogPostId,
    authorId,
    deletedAt,
    scheduledAt,
    ...data
  } = row;
  const authorName =
    row.authorName?.trim() ||
    `${refAuthorId?.firstName ?? ''} ${refAuthorId?.lastName ?? ''}`.trim();
  return {
    ...data,
    authorName:
      !authorName || /^super administrator$/i.test(authorName)
        ? 'Whalexy Editorial Team'
        : authorName,
    category: refCategoryId ?? null,
    tags: childrenBlogPostTagBlogPostId?.map((link: any) => link.refBlogTagId) ?? [],
  };
}

export const adminSelect = {
  ...summary,
  authorId: true,
  categoryId: true,
  content: true,
  status: true,
  scheduledAt: true,
  contentToc: true,
  seoTitle: true,
  metaDescription: true,
  metaKeywords: true,
  canonicalUrl: true,
  ogTitle: true,
  ogDescription: true,
  ogImage: true,
  updatedAt: true,
} satisfies Prisma.BlogPostsSelect;

export async function contentTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('whalexy:content-management',0))`;
    return work(tx);
  });
}

export async function uniqueSlug(
  tx: Prisma.TransactionClient,
  model: 'blogPosts' | 'blogCategories' | 'blogTags',
  value: string,
  ignoreId?: number,
) {
  const base = contentSlug(value),
    delegate = tx[model] as typeof tx.blogTags;
  let slug = base,
    suffix = 2;
  while (
    await delegate.findFirst({
      where: { slug, ...(ignoreId ? { id: { not: ignoreId } } : {}) },
      select: { id: true },
    })
  )
    slug = `${base}-${suffix++}`;
  return slug;
}

export async function existingPost(tx: Prisma.TransactionClient, id: number) {
  const row = await tx.blogPosts.findFirst({ where: { id, deletedAt: null } });
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Article not found');
  return row;
}

export async function savePost(input: ServiceContext, id?: number) {
  return contentTransaction((tx) => savePostTransaction(tx, input, id));
}

export async function savePostTransaction(
  tx: Prisma.TransactionClient,
  inputContext: ServiceContext,
  id?: number,
) {
  await authorizePages(tx, inputContext);
  const body = inputContext.body,
    authorId = inputContext.identity!.userId;
  const row = id ? await existingPost(tx, id) : null;
  if (body.categoryId && !(await tx.blogCategories.findUnique({ where: { id: body.categoryId } })))
    throw new ApiError(400, 'INVALID_REFERENCE', 'Category not found');
  if ((await tx.blogTags.count({ where: { id: { in: body.tagIds } } })) !== body.tagIds.length)
    throw new ApiError(400, 'INVALID_REFERENCE', 'Tag not found');
  const prepared = prepareArticleContent(body.content);
  const { tagIds, intent, scheduledAt, ...input } = body;
  const status =
    intent === 'preview'
      ? (row?.status ?? 'draft')
      : intent === 'publish'
        ? 'published'
        : intent === 'schedule'
          ? 'scheduled'
          : 'draft';
  const data = {
    ...input,
    slug: await uniqueSlug(tx, 'blogPosts', input.slug || input.title, id),
    content: prepared.html,
    contentToc: prepared.toc,
    readingTime: prepared.readingTime,
    status,
    publishedAt:
      status === 'published' ? (row?.publishedAt ?? new Date()) : (row?.publishedAt ?? null),
    scheduledAt: status === 'scheduled' ? (scheduledAt ?? row?.scheduledAt) : null,
    updatedAt: new Date(),
  };
  const saved = row
    ? await tx.blogPosts.update({ where: { id }, data })
    : await tx.blogPosts.create({ data: { ...data, authorId } });
  await tx.blogPostTag.deleteMany({ where: { blogPostId: saved.id } });
  await tx.blogPostTag.createMany({
    data: tagIds.map((blogTagId: number) => ({ blogPostId: saved.id, blogTagId })),
  });
  await auditPost(tx, inputContext, row ? 'update' : 'create', saved.id);
  return tx.blogPosts.findUniqueOrThrow({ where: { id: saved.id }, select: adminSelect });
}

export async function auditPost(
  tx: Prisma.TransactionClient,
  input: ServiceContext,
  action: string,
  id: number,
) {
  await tx.auditEvents.create({
    data: {
      actorId: input.identity!.userId,
      action,
      resource: 'blog-post',
      resourceId: String(id),
    },
  });
}

export async function savePageTransaction(
  tx: Prisma.TransactionClient,
  input: ServiceContext,
  id?: number,
) {
  await authorizePages(tx, input);
  if (id) {
    const existing = await ownedSitePage(tx, id);
    if (existing.type !== null && existing.type !== 1)
      throw new ApiError(
        409,
        'PAGE_RECONCILIATION_REQUIRED',
        'Imported page type requires reconciliation',
      );
  }
  const body = input.body;
  if (await tx.pages.findFirst({ where: { slug: body.slug, ...(id ? { id: { not: id } } : {}) } }))
    throw new ApiError(409, 'CONFLICT', 'Page slug already exists');
  const data = {
    title: body.title,
    slug: body.slug,
    content: prepareArticleContent(body.content).html,
    status: body.status,
    showInMenu: body.showInMenu,
    type: 1,
    updatedAt: new Date(),
  };
  const page = id
    ? await tx.pages.update({ where: { id }, data })
    : await tx.pages.create({ data });
  await tx.auditEvents.create({
    data: {
      actorId: input.identity!.userId,
      action: id ? 'update' : 'create',
      resource: 'site-page',
      resourceId: String(page.id),
    },
  });
  return page;
}
export async function savePage(input: ServiceContext, id?: number) {
  return contentTransaction((tx) => savePageTransaction(tx, input, id));
}
export async function deletePageTransaction(
  tx: Prisma.TransactionClient,
  input: ServiceContext,
  id: number,
) {
  await authorizePages(tx, input);
  const page = await ownedSitePage(tx, id);
  if (page.type !== null && page.type !== 1)
    throw new ApiError(
      409,
      'PAGE_RECONCILIATION_REQUIRED',
      'Imported page type requires reconciliation',
    );
  await tx.pages.delete({ where: { id } });
  await tx.auditEvents.create({
    data: {
      actorId: input.identity!.userId,
      action: 'delete',
      resource: 'site-page',
      resourceId: String(id),
    },
  });
}
