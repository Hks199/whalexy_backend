import { Prisma, type Pages } from '@prisma/client';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { digest } from '../../../utils/crypto.js';
import { authorizePages } from './page-access.service.js';
import { prepareArticleContent } from './article-content.js';
import { savePageTransaction, deletePageTransaction } from './content-support.service.js';
function revision(p: Pages) {
  return digest(
    JSON.stringify([
      p.id,
      p.uid,
      p.updatedAt.toISOString(),
      p.title,
      p.slug,
      p.content,
      p.status,
      p.showInMenu,
      p.type,
      p.imageName,
    ]),
  );
}
function projection(p: Pages) {
  const content = prepareArticleContent(p.content ?? '').html;
  return {
    _id: p.id,
    _uid: p.uid,
    title: p.title,
    slug: p.slug,
    content,
    description: content,
    show_in_menu: p.showInMenu ?? 0,
    status: p.status,
    created_at: p.createdAt.toISOString(),
    updated_at: p.updatedAt.toISOString(),
    revision: revision(p),
  };
}
async function find(tx: Prisma.TransactionClient, input: ServiceContext) {
  const target = input.params.pageIdOrUid ?? input.body.pageIdOrUid;
  const row = await tx.pages.findFirst({
    where: { vendorId: null, ...(/^\d+$/.test(target) ? { id: Number(target) } : { uid: target }) },
  });
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Page not found');
  return row;
}
export async function edit(input: ServiceContext) {
  const result = await db.$transaction(
    async (tx) => {
      await authorizePages(tx, input);
      return projection(await find(tx, input));
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  return serviceResult({ reaction: 1, message: '', data: result }, { status: 200, format: 'json' });
}
export async function list(input: ServiceContext) {
  const q = input.validatedQuery;
  if (q.columns?.some((c: any) => c.search?.value))
    throw new ApiError(
      400,
      'UNSUPPORTED_COLUMN_SEARCH',
      'Column-specific search requires frontend reconciliation',
    );
  let orderBy: Prisma.PagesOrderByWithRelationInput[] = [{ id: 'asc' }];
  if (q.order?.length) {
    const order = q.order[0],
      column = q.columns?.[order.column],
      fields: Record<string, string> = {
        _id: 'id',
        _uid: 'uid',
        title: 'title',
        slug: 'slug',
        content: 'content',
        status: 'status',
        created_at: 'createdAt',
        updated_at: 'updatedAt',
      },
      field = column && fields[column.data];
    if (typeof field !== 'string' || column.orderable === false)
      throw new ApiError(400, 'INVALID_SORT', 'Select a supported sortable source column');
    orderBy = [{ [field]: order.dir }, { id: 'asc' }];
  }
  const result = await db.$transaction(
    async (tx) => {
      await authorizePages(tx, input);
      const base = { vendorId: null },
        term = q.search?.value?.replace(/[\\%_]/g, '\\$&'),
        where: Prisma.PagesWhereInput = {
          ...base,
          ...(term
            ? {
                OR: ['title', 'slug', 'content'].map((field) => ({
                  [field]: { contains: term, mode: 'insensitive' },
                })),
              }
            : {}),
        };
      const [recordsTotal, recordsFiltered, rows] = await Promise.all([
        tx.pages.count({ where: base }),
        tx.pages.count({ where }),
        tx.pages.findMany({ where, orderBy, skip: q.start, take: q.length }),
      ]);
      return { draw: q.draw, recordsTotal, recordsFiltered, data: rows.map(projection) };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  return serviceResult(result, { status: 200, format: 'json' });
}
function canonical(value: any): any {
  return Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
}
export async function mutate(input: ServiceContext, action: 'create' | 'update' | 'delete') {
  const rawKey = input.headers['idempotency-key'],
    body = input.body;
  if (typeof rawKey !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(rawKey))
    throw new ApiError(400, 'IDEMPOTENCY_REQUIRED', 'A valid Idempotency-Key is required');
  const key = `legacy-page:${input.identity!.userId}:${rawKey}`,
    hash = digest(JSON.stringify(canonical({ action, params: input.params, body })));
  const result = await db
    .$transaction(
      async (tx) => {
        await authorizePages(tx, input);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('whalexy:content-management',0))`;
        const replay = await tx.configurations.findMany({ where: { name: key }, take: 2 });
        if (replay.length > 1)
          throw new ApiError(
            409,
            'PAGE_RECONCILIATION_REQUIRED',
            'Duplicate replay entries require reconciliation',
          );
        if (replay.length) {
          let stored: any;
          try {
            stored = JSON.parse(replay[0].value ?? '');
          } catch {
            throw new ApiError(409, 'PAGE_RECONCILIATION_REQUIRED', 'Invalid replay entry');
          }
          if (stored.hash !== hash)
            throw new ApiError(
              409,
              'IDEMPOTENCY_CONFLICT',
              'Key was used for a different page operation',
            );
          if (stored.nativeVersion !== 1 || stored.response?.reaction !== 1)
            throw new ApiError(409, 'PAGE_RECONCILIATION_REQUIRED', 'Invalid replay response');
          return stored.response;
        }
        const existing = action === 'create' ? null : await find(tx, input);
        if (existing && revision(existing) !== body.revision)
          throw new ApiError(409, 'PAGE_CONFLICT', 'Page changed; reload before saving');
        let data: unknown;
        if (action === 'delete') {
          await deletePageTransaction(tx, input, existing!.id);
          data = { pageUid: existing!.uid };
        } else {
          const mapped = {
            ...input,
            body: {
              title: body.title,
              slug: body.slug,
              content: body.description,
              status: body.status === true || body.status === 'on' ? 1 : 0,
              showInMenu: body.show_in_menu === true || body.show_in_menu === 'on' ? 1 : 0,
            },
          };
          data = projection(await savePageTransaction(tx, mapped, existing?.id));
        }
        const response = {
          reaction: 1,
          message:
            action === 'create'
              ? 'Page added.'
              : action === 'update'
                ? 'Page updated.'
                : 'Page deleted successfully',
          data,
        };
        await tx.configurations.create({
          data: {
            name: key,
            dataType: 4,
            value: JSON.stringify({ nativeVersion: 1, hash, response }),
          },
        });
        return response;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 },
    )
    .catch((error) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034')
        throw new ApiError(
          409,
          'PAGE_CONFLICT',
          'Pages changed; retry the same idempotent request',
        );
      throw error;
    });
  return serviceResult(result, { status: 200, format: 'json' });
}
