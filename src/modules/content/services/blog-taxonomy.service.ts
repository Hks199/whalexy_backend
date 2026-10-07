import { db } from '../../../database/client.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { contentTransaction, uniqueSlug } from './content-support.service.js';

export async function listBlogTaxonomy(
  requestInput: ServiceContext,
  model: 'blogCategories' | 'blogTags',
) {
  return serviceResult(
    await (db[model] as typeof db.blogTags).findMany({ orderBy: [{ name: 'asc' }, { id: 'asc' }] }),
    { status: 200, format: 'json' },
  );
}

export async function createBlogTaxonomy(
  requestInput: ServiceContext,
  model: 'blogCategories' | 'blogTags',
) {
  return serviceResult(
    await contentTransaction(async (tx) =>
      (tx[model] as typeof tx.blogTags).create({
        data: { ...requestInput.body, slug: await uniqueSlug(tx, model, requestInput.body.name) },
      }),
    ),
    { status: 201, format: 'json' },
  );
}

export async function updateBlogTaxonomy(
  requestInput: ServiceContext,
  model: 'blogCategories' | 'blogTags',
) {
  return serviceResult(
    await contentTransaction(async (tx) =>
      (tx[model] as typeof tx.blogTags).update({
        where: { id: Number(requestInput.params.id) },
        data: {
          ...requestInput.body,
          slug: await uniqueSlug(tx, model, requestInput.body.name, Number(requestInput.params.id)),
          updatedAt: new Date(),
        },
      }),
    ),
    { status: 200, format: 'json' },
  );
}

export async function deleteBlogTaxonomy(
  requestInput: ServiceContext,
  model: 'blogCategories' | 'blogTags',
) {
  await contentTransaction((tx) =>
    (tx[model] as typeof tx.blogTags).delete({ where: { id: Number(requestInput.params.id) } }),
  );
  return serviceResult(undefined, { status: 204, format: 'empty' });
}
