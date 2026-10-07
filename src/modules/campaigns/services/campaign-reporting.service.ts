import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { can } from '../../../shared/access-policy.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';

export async function getCampaignStatus(requestInput: ServiceContext) {
  const c = await db.campaigns.findFirst({
    where: { id: Number(requestInput.params.id), vendorId: requestInput.identity!.vendorId! },
  });
  if (!c) throw new ApiError(404, 'NOT_FOUND', 'Campaign not found');
  const [counts, queueCounts] = await Promise.all([
    db.whatsappMessageLogs.groupBy({
      by: ['status'],
      where: { campaignId: c.id, vendorId: c.vendorId },
      _count: { _all: true },
    }),
    db.whatsappMessageQueue.groupBy({
      by: ['status'],
      where: { campaignId: c.id, vendorId: c.vendorId },
      _count: { _all: true },
    }),
  ]);
  return serviceResult(
    { id: c.id, status: c.status, counts, queueCounts },
    { status: 200, format: 'json' },
  );
}

export async function getCampaignReport(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!,
    campaignId = Number(requestInput.params.id);
  const campaign = await db.campaigns.findFirst({
    where: { id: campaignId, vendorId },
    select: { id: true, status: true },
  });
  if (!campaign) throw new ApiError(404, 'NOT_FOUND', 'Campaign not found');
  const totals = await db.$queryRaw<
    {
      total: bigint;
      delivered: bigint;
      read: bigint;
      failed: bigint;
      uncertain: bigint;
      queued: bigint;
    }[]
  >`
    WITH recipients AS (
      SELECT q."phone_with_country_code" AS phone, bool_or(q.status IN (1,3)) AS queued, bool_or(q.status=2 AND coalesce(q."__data"->>'cancelled','false')<>'true' AND q."__data"->>'skipped' IS NULL) AS queue_failed
      FROM whatsapp_message_queue q WHERE q."vendors__id"=${vendorId} AND q."campaigns__id"=${campaignId} GROUP BY q."phone_with_country_code"
    ), messages AS (
      SELECT l."contact_wa_id" AS phone, bool_or(l.status IN ('delivered','read')) AS delivered, bool_or(l.status='read') AS read, bool_or(l.status='failed') AS failed, bool_or(l.status='uncertain') AS uncertain
      FROM whatsapp_message_logs l WHERE l."vendors__id"=${vendorId} AND l."campaigns__id"=${campaignId} AND l."is_incoming_message"=false GROUP BY l."contact_wa_id"
    ) SELECT count(*) AS total, count(*) FILTER (WHERE m.delivered) AS delivered, count(*) FILTER (WHERE m.read) AS read,
      count(*) FILTER (WHERE (r.queue_failed OR m.failed) AND NOT coalesce(m.uncertain,false)) AS failed,
      count(*) FILTER (WHERE m.uncertain) AS uncertain, count(*) FILTER (WHERE r.queued) AS queued
      FROM recipients r LEFT JOIN messages m ON m.phone=r.phone`;
  const counts = Object.fromEntries(
    Object.entries(totals[0]).map(([key, value]) => [key, Number(value)]),
  );
  const percent = (value: number) =>
    counts.total ? Math.round((value / counts.total) * 10000) / 100 : 0;
  return serviceResult(
    {
      ...campaign,
      ...counts,
      deliveredPercent: percent(counts.delivered),
      readPercent: percent(counts.read),
      failedPercent: percent(counts.failed),
    },
    { status: 200, format: 'json' },
  );
}

export async function listCampaignRecipients(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!,
    campaignId = Number(requestInput.params.id),
    q = requestInput.validatedQuery;
  if (
    !(await db.campaigns.findFirst({ where: { id: campaignId, vendorId }, select: { id: true } }))
  )
    throw new ApiError(404, 'NOT_FOUND', 'Campaign not found');
  const where = { vendorId, campaignId };
  const [rows, total] = await Promise.all([
    db.whatsappMessageQueue.findMany({
      where,
      take: q.limit,
      skip: (q.page - 1) * q.limit,
      orderBy: { id: 'asc' },
      select: { id: true, status: true, phoneWithCountryCode: true, updatedAt: true },
    }),
    db.whatsappMessageQueue.count({ where }),
  ]);
  return serviceResult(
    {
      items: rows.map((row) => ({
        ...row,
        phoneWithCountryCode: can(requestInput, 'vendor.contacts.view_phone')
          ? row.phoneWithCountryCode
          : `***${row.phoneWithCountryCode.slice(-4)}`,
      })),
      total,
      page: q.page,
      limit: q.limit,
    },
    { status: 200, format: 'json' },
  );
}
