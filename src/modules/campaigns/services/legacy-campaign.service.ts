import { Prisma } from '@prisma/client';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { digest } from '../../../utils/crypto.js';
import { authorizeCampaign } from './campaign-access.service.js';
import { duplicateCampaignTransaction } from './campaign-management.service.js';
import {
  archiveCampaignTransaction,
  restoreCampaignTransaction,
} from './campaign-lifecycle.service.js';
import { deleteCampaignTransaction } from './campaign-deletion.service.js';
const envelope = (data: unknown, message = '') => ({ reaction: 1, message, data });
async function find(tx: Prisma.TransactionClient, input: ServiceContext) {
  const target = String(input.params.campaignUid ?? input.params.campaignIdOrUid);
  const c = await tx.campaigns.findFirst({
    where: {
      vendorId: input.identity!.vendorId!,
      ...(/^\d+$/.test(target) ? { id: Number(target) } : { uid: target }),
    },
  });
  if (!c) throw new ApiError(404, 'NOT_FOUND', 'Campaign not found');
  return c;
}
export async function mutate(
  input: ServiceContext,
  action: 'duplicate' | 'delete' | 'archive' | 'restore',
) {
  const key = input.headers['idempotency-key'],
    vendorId = input.identity!.vendorId!;
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(key))
    throw new ApiError(400, 'IDEMPOTENCY_REQUIRED', 'A valid Idempotency-Key is required');
  const hash = digest(
    JSON.stringify({
      action,
      target: input.params.campaignIdOrUid,
      title: input.body.title ?? null,
      scheduledAt: input.body.scheduledAt ?? null,
    }),
  );
  const result = await db
    .$transaction(
      async (tx) => {
        await authorizeCampaign(
          tx,
          input,
          action === 'duplicate'
            ? 'vendor.campaigns.create'
            : action === 'delete'
              ? 'vendor.campaigns.delete'
              : 'vendor.campaigns.send',
        );
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`legacy-campaign:${vendorId}:${key}`},0))`;
        const replay = await tx.nativeIdempotency.findUnique({
          where: { vendorId_key: { vendorId, key: `legacy-campaign:${key}` } },
        });
        if (replay) {
          if (replay.requestHash !== hash)
            throw new ApiError(
              409,
              'IDEMPOTENCY_CONFLICT',
              'Key was used for another campaign action',
            );
          return replay.response;
        }
        const c = await find(tx, input),
          mapped = {
            ...input,
            params: { id: c.id },
            body: {
              title: input.body.title ?? `${c.title.slice(0, 150)} - clone`,
              scheduledAt: input.body.scheduledAt ?? new Date(Date.now() + 300000),
            },
          };
        let data: unknown = { campaignUid: c.uid };
        if (action === 'duplicate') {
          const copy = await duplicateCampaignTransaction(tx, mapped, true);
          data = { campaignUid: copy.uid, id: copy.id, status: copy.status };
        } else if (action === 'delete') await deleteCampaignTransaction(tx, mapped);
        else if (action === 'archive') await archiveCampaignTransaction(tx, mapped);
        else await restoreCampaignTransaction(tx, mapped);
        const result = envelope(
          data,
          action === 'duplicate'
            ? 'Campaign duplicated successfully'
            : action === 'delete'
              ? 'Campaign deleted successfully'
              : action === 'archive'
                ? 'Campaign Archived successfully'
                : 'Campaign Unarchived successfully',
        );
        await tx.nativeIdempotency.create({
          data: {
            vendorId,
            key: `legacy-campaign:${key}`,
            requestHash: hash,
            response: result as Prisma.InputJsonObject,
          },
        });
        return result;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 },
    )
    .catch((error) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034')
        throw new ApiError(
          409,
          'CAMPAIGN_CONFLICT',
          'Campaign changed; retry the same idempotent request',
        );
      throw error;
    });
  return serviceResult(result, { status: 200, format: 'json' });
}
const campaignSelect = {
  id: true,
  uid: true,
  title: true,
  status: true,
  scheduledAt: true,
  createdAt: true,
  updatedAt: true,
  refTemplateId: { select: { templateName: true, languageCode: true } },
} as const;
function projection(c: any) {
  return {
    _id: c.id,
    _uid: c.uid,
    title: c.title,
    status: c.status,
    scheduled_at: c.scheduledAt,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
    template_name: c.refTemplateId.templateName,
    template_language: c.refTemplateId.languageCode,
  };
}
const escape = (s: string) => s.replace(/[\\%_]/g, '\\$&');
function ordering(q: any, kind: 'campaign' | 'queue' | 'executed', viewPhone = true) {
  if (q.columns?.some((column: any) => column.search?.value))
    throw new ApiError(400, 'UNSUPPORTED_COLUMN_SEARCH', 'Column-specific search is not supported');
  if (!q.order?.length)
    return kind === 'executed'
      ? [{ messagedAt: 'desc' }, { id: 'desc' }]
      : [{ createdAt: 'desc' }, { id: 'desc' }];
  const selected = q.order[0],
    column = q.columns?.[selected.column];
  if (!column || column.orderable === false)
    throw new ApiError(400, 'INVALID_SORT', 'Select one sortable source column');
  const fields: Record<string, string> = {
    _id: 'id',
    _uid: 'uid',
    status: 'status',
    updated_at: 'updatedAt',
    created_at: 'createdAt',
    ...(kind === 'campaign'
      ? { title: 'title', scheduled_at: 'scheduledAt' }
      : kind === 'queue'
        ? { phone_with_country_code: 'phoneWithCountryCode' }
        : { contact_wa_id: 'contactWaId', messaged_at: 'messagedAt' }),
  };
  const field = fields[column.data];
  if (typeof field !== 'string')
    throw new ApiError(400, 'INVALID_SORT', 'Unsupported source sort column');
  if (!viewPhone && ['phoneWithCountryCode', 'contactWaId'].includes(field))
    throw new ApiError(403, 'PHONE_SORT_FORBIDDEN', 'Phone sorting requires phone visibility');
  return [{ [field]: selected.dir }, ...(field === 'id' ? [] : [{ id: selected.dir }])];
}

export async function list(input: ServiceContext) {
  return db.$transaction(
    async (tx) => {
      await authorizeCampaign(tx, input, 'vendor.campaigns.view');
      const vendorId = input.identity!.vendorId!,
        q = input.validatedQuery,
        scope = { vendorId, refTemplateId: { vendorId } };
      const status = input.params.status,
        where: Prisma.CampaignsWhereInput = {
          ...scope,
          ...(status === 'all'
            ? {}
            : status === 'archive' || status === 'archived'
              ? { status: 'archived' }
              : { status: { not: 'archived' } }),
        };
      const total = await tx.campaigns.count({ where });
      const filtered = {
        ...where,
        ...(q.search?.value
          ? { title: { contains: escape(q.search.value), mode: 'insensitive' as const } }
          : {}),
        ...(q.status ? { AND: [{ status: q.status }] } : {}),
      };
      const filteredCount = await tx.campaigns.count({ where: filtered });
      const rows = await tx.campaigns.findMany({
        where: filtered,
        select: campaignSelect,
        skip: q.start,
        take: q.length,
        orderBy: ordering(q, 'campaign') as Prisma.CampaignsOrderByWithRelationInput[],
      });
      return serviceResult(
        {
          draw: q.draw,
          recordsTotal: total,
          recordsFiltered: filteredCount,
          data: rows.map(projection),
        },
        { status: 200, format: 'json' },
      );
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 },
  );
}
function queueScope(vendorId: number, campaignId: number): Prisma.WhatsappMessageQueueWhereInput {
  return { vendorId, campaignId, OR: [{ contactId: null }, { refContactId: { vendorId } }] };
}
function logScope(vendorId: number, campaignId: number): Prisma.WhatsappMessageLogsWhereInput {
  return {
    vendorId,
    campaignId,
    isIncomingMessage: false,
    refContactId: { vendorId },
  };
}
export async function logs(input: ServiceContext, kind: 'queue' | 'executed') {
  return db.$transaction(
    async (tx) => {
      const p = await authorizeCampaign(tx, input, 'vendor.campaigns.view'),
        c = await find(tx, input),
        q = input.validatedQuery,
        viewPhone = p.includes('*') || p.includes('vendor.contacts.view_phone');
      const mask = (phone: string | null) =>
        phone && viewPhone ? phone : phone ? `***${phone.slice(-4)}` : null;
      if (q.search?.value && !viewPhone)
        throw new ApiError(403, 'PHONE_SEARCH_FORBIDDEN', 'Phone search requires phone visibility');
      let total: number, filtered: number, rows: any[];
      if (kind === 'queue') {
        const scope = queueScope(c.vendorId, c.id),
          where = {
            ...scope,
            ...(q.search?.value
              ? { phoneWithCountryCode: { contains: escape(q.search.value) } }
              : {}),
            ...(q.status ? { status: Number(q.status) } : {}),
          };
        if (q.status && !/^[123]$/.test(q.status))
          throw new ApiError(400, 'INVALID_STATUS', 'Queue status must be 1, 2 or 3');
        total = await tx.whatsappMessageQueue.count({ where: scope });
        filtered = await tx.whatsappMessageQueue.count({ where });
        const data = await tx.whatsappMessageQueue.findMany({
          where,
          take: q.length,
          skip: q.start,
          orderBy: ordering(
            q,
            'queue',
            viewPhone,
          ) as Prisma.WhatsappMessageQueueOrderByWithRelationInput[],
          select: {
            id: true,
            uid: true,
            status: true,
            phoneWithCountryCode: true,
            updatedAt: true,
            refContactId: { select: { firstName: true, lastName: true } },
          },
        });
        rows = data.map((r) => ({
          _id: r.id,
          _uid: r.uid,
          status: r.status,
          phone_with_country_code: mask(r.phoneWithCountryCode),
          updated_at: r.updatedAt,
          full_name: [r.refContactId?.firstName, r.refContactId?.lastName]
            .filter(Boolean)
            .join(' '),
        }));
      } else {
        const scope = logScope(c.vendorId, c.id),
          where = {
            ...scope,
            ...(q.search?.value ? { contactWaId: { contains: escape(q.search.value) } } : {}),
            ...(q.status ? { status: q.status } : {}),
          };
        total = await tx.whatsappMessageLogs.count({ where: scope });
        filtered = await tx.whatsappMessageLogs.count({ where });
        const data = await tx.whatsappMessageLogs.findMany({
          where,
          take: q.length,
          skip: q.start,
          orderBy: ordering(
            q,
            'executed',
            viewPhone,
          ) as Prisma.WhatsappMessageLogsOrderByWithRelationInput[],
          select: {
            id: true,
            uid: true,
            status: true,
            contactWaId: true,
            messagedAt: true,
            updatedAt: true,
            refContactId: { select: { firstName: true, lastName: true } },
          },
        });
        rows = data.map((r) => ({
          _id: r.id,
          _uid: r.uid,
          status: r.status,
          contact_wa_id: mask(r.contactWaId),
          messaged_at: r.messagedAt,
          updated_at: r.updatedAt,
          full_name: [r.refContactId?.firstName, r.refContactId?.lastName]
            .filter(Boolean)
            .join(' '),
        }));
      }
      return serviceResult(
        { draw: q.draw, recordsTotal: total, recordsFiltered: filtered, data: rows },
        { status: 200, format: 'json' },
      );
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 },
  );
}
export async function status(input: ServiceContext) {
  return db.$transaction(
    async (tx) => {
      await authorizeCampaign(tx, input, 'vendor.campaigns.view');
      const c = await find(tx, input);
      const counts = await tx.whatsappMessageLogs.groupBy({
          by: ['status'],
          where: logScope(c.vendorId, c.id),
          _count: { _all: true },
        }),
        queueCounts = await tx.whatsappMessageQueue.groupBy({
          by: ['status'],
          where: queueScope(c.vendorId, c.id),
          _count: { _all: true },
        });
      const text: Record<string, string> = {
        awaiting_test: 'Awaiting Test',
        scheduled: 'Upcoming',
        running: 'Processing',
        dispatching: 'Processing',
        completed: 'Executed',
        completed_with_errors: 'Executed with errors',
        cancelled: 'Cancelled',
        paused: 'Paused',
        archived: 'Archived',
        blocked: 'Blocked',
      };
      return serviceResult(
        envelope({
          statusText: text[c.status] ?? c.status,
          campaignStatus: c.status,
          queueFailedCount: queueCounts.find((r) => r.status === 2)?._count._all ?? 0,
          counts,
          queueCounts,
          campaign: {
            _id: c.id,
            _uid: c.uid,
            title: c.title,
            status: c.status,
            scheduled_at: c.scheduledAt,
          },
        }),
        { status: 200, format: 'json' },
      );
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 },
  );
}
