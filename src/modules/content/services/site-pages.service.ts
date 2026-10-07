import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { prepareArticleContent } from './article-content.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { savePage, contentTransaction, deletePageTransaction } from './content-support.service.js';

export async function listPublicPages(requestInput: ServiceContext) {
  return serviceResult(
    await db.pages.findMany({
      where: { status: 1, showInMenu: 1, vendorId: null },
      orderBy: { id: 'asc' },
      select: { uid: true, slug: true, title: true },
    }),
    { status: 200, format: 'json' },
  );
}

export async function getPublicPage(requestInput: ServiceContext) {
  const row = await db.pages.findFirst({
    where: { slug: String(requestInput.params.slug), status: 1, vendorId: null },
    orderBy: { id: 'asc' },
    select: { uid: true, slug: true, title: true, content: true },
  });
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Page not found');
  return serviceResult(
    { ...row, content: prepareArticleContent(row.content ?? '').html },
    { status: 200, format: 'json' },
  );
}

export async function listAdminPages(requestInput: ServiceContext) {
  const q = requestInput.validatedQuery;
  return serviceResult(
    await db.pages.findMany({
      where: { vendorId: null },
      orderBy: { id: 'asc' },
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    }),
    { status: 200, format: 'json' },
  );
}

export async function createPage(requestInput: ServiceContext) {
  return serviceResult(await savePage(requestInput), { status: 201, format: 'json' });
}

export async function updatePage(requestInput: ServiceContext) {
  return serviceResult(await savePage(requestInput, Number(requestInput.params.id)), {
    status: 200,
    format: 'json',
  });
}

export async function deletePage(requestInput: ServiceContext) {
  await contentTransaction((tx) =>
    deletePageTransaction(tx, requestInput, Number(requestInput.params.id)),
  );
  return serviceResult(undefined, { status: 204, format: 'empty' });
}
