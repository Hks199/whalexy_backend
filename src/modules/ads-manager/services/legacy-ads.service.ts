import { Prisma } from '@prisma/client';
import { DateTime, IANAZone } from 'luxon';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { digest } from '../../../utils/crypto.js';
import { contactVisibility } from '../../contacts/contacts.service.js';
import { can } from '../../../shared/access-policy.js';
import { getActiveAdAccountAccess, requireAdAccountOwner } from './ads-manager-support.service.js';
import {
  getAdDashboard,
  recordAdConversion,
  updateAdCampaignStatus,
} from './ad-reporting.service.js';

const ownership = (input: ServiceContext) => ({
  vendorId: input.identity!.vendorId!,
  organizationId: input.identity!.vendorId!,
  deletedAt: null,
});
const resource = (row: any) => ({
  id: row.uuid,
  name: row.name,
  objective: row.objective,
  goal: row.goal,
  status: row.status,
  effective_status: row.effectiveStatus,
  budget: {
    type: row.budgetType,
    amount: row.budgetAmount.toFixed(4),
    currency: row.refAdAccountId.currency,
  },
  schedule: {
    starts_at: row.startsAt?.toISOString() ?? null,
    ends_at: row.endsAt?.toISOString() ?? null,
    timezone: row.timezone,
  },
  account: { id: row.refAdAccountId.uuid, name: row.refAdAccountId.name },
  created_at: row.createdAt.toISOString(),
  updated_at: row.updatedAt.toISOString(),
});
const accountProjection = { select: { uuid: true, name: true, currency: true } };
async function campaign(input: ServiceContext, includeDeleted = false) {
  if (!/^[0-9a-f-]{36}$/i.test(input.params.campaign))
    throw new ApiError(400, 'INVALID_CAMPAIGN', 'Campaign UUID is invalid');
  const row = await db.adCampaigns.findFirst({
    where: {
      ...ownership(input),
      ...(includeDeleted ? { deletedAt: undefined } : {}),
      uuid: input.params.campaign,
      refAdAccountId: ownership(input),
    },
  });
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Campaign not found');
  return row;
}
export async function campaigns(input: ServiceContext) {
  const q = input.validatedQuery,
    where = {
      ...ownership(input),
      refAdAccountId: ownership(input),
      ...(q.search ? { name: { contains: q.search, mode: 'insensitive' as const } } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.objective ? { objective: q.objective } : {}),
    };
  const [rows, total] = await db.$transaction([
    db.adCampaigns.findMany({
      where,
      include: { refAdAccountId: accountProjection },
      orderBy: { id: 'desc' },
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    }),
    db.adCampaigns.count({ where }),
  ]);
  return serviceResult(
    {
      data: rows.map(resource),
      meta: {
        current_page: q.page,
        per_page: q.limit,
        total,
        last_page: Math.max(1, Math.ceil(total / q.limit)),
      },
    },
    { status: 200, format: 'json' },
  );
}
export async function dashboard(input: ServiceContext) {
  const q = input.validatedQuery,
    today = DateTime.utc().startOf('day');
  const to = q.range === 'yesterday' ? today.minus({ days: 1 }) : today;
  const from =
    q.range === 'today' || q.range === 'yesterday'
      ? to
      : today.minus({ days: q.range === '30d' ? 29 : 6 });
  if (q.range === 'custom' && (!q.from || !q.to))
    throw new ApiError(400, 'INVALID_RANGE', 'Custom range requires from and to');
  // Keep native currency-separated exact amounts; summing currencies would corrupt the report.
  return getAdDashboard({
    ...input,
    validatedQuery: {
      from: q.range === 'custom' ? q.from : from.toISODate(),
      to: q.range === 'custom' ? q.to : to.toISODate(),
    },
  });
}
function checkedDraft(body: any) {
  if (body.publish)
    throw new ApiError(
      409,
      'AD_PUBLISH_REVIEW_REQUIRED',
      'Remote campaign publishing and creative asset upload are not implemented',
    );
  if (!IANAZone.isValidZone(body.timezone))
    throw new ApiError(400, 'INVALID_TIMEZONE', 'Timezone is invalid');
  const amount = new Prisma.Decimal(body.budget_amount);
  if (amount.lt(1) || amount.gt(999999999))
    throw new ApiError(400, 'INVALID_BUDGET', 'Budget must be between 1 and 999999999');
  if (
    (body.budget_type === 'lifetime' && (!body.starts_at || !body.ends_at)) ||
    (body.ends_at && !body.starts_at)
  )
    throw new ApiError(400, 'INVALID_SCHEDULE', 'This schedule requires a start and end time');
  const a = body.audience;
  if (a.locations?.some((l: any) => l.distance_unit === 'mile' && l.radius > 50))
    throw new ApiError(400, 'INVALID_AUDIENCE', 'City radius cannot exceed 50 miles');
  if (
    ['credit', 'employment', 'housing'].includes(body.special_ad_category) &&
    (a.age_min !== 18 ||
      a.age_max !== 65 ||
      a.location_mode !== 'country' ||
      a.genders?.some((g: string) => g !== 'all') ||
      a.interests?.length ||
      a.custom_audiences?.include?.length ||
      a.custom_audiences?.exclude?.length)
  )
    throw new ApiError(400, 'INVALID_SPECIAL_CATEGORY', 'Special category targeting is restricted');
  return JSON.parse(JSON.stringify(body));
}
async function saveDraft(tx: Prisma.TransactionClient, input: ServiceContext, b: any) {
  const vendorId = input.identity!.vendorId!,
    userId = input.identity!.userId;
  const membership = await tx.nativeMemberships.findUnique({
    where: { vendorId_userId: { vendorId, userId } },
  });
  if (
    !membership?.active ||
    !Array.isArray(membership.permissions) ||
    !membership.permissions.some((p) => p === '*' || p === 'ads.create')
  )
    throw new ApiError(403, 'FORBIDDEN', 'Campaign creation access changed');
  const account = await tx.adAccounts.findFirst({
    where: { id: b.ad_account_id, ...ownership(input) },
  });
  if (!account) throw new ApiError(404, 'NOT_FOUND', 'Ad account not found');
  const actor = { organizationId: vendorId, vendorId, createdBy: userId, updatedBy: userId };
  const row = await tx.adCampaigns.create({
    data: {
      ...actor,
      adAccountId: account.id,
      name: b.name,
      objective: b.objective,
      goal: b.goal,
      specialAdCategory: b.special_ad_category,
      budgetType: b.budget_type,
      budgetAmount: b.budget_amount,
      bidStrategy: b.bid_strategy,
      startsAt: b.starts_at ? new Date(b.starts_at) : null,
      endsAt: b.ends_at ? new Date(b.ends_at) : null,
      timezone: b.timezone,
      notes: b.notes,
      configuration: { nativeDraft: true, body: b },
    },
    include: { refAdAccountId: accountProjection },
  });
  const creative = await tx.adCreatives.create({
    data: {
      ...actor,
      name: b.name,
      format: b.creative.format,
      headline: b.creative.headline,
      primaryText: b.creative.primary_text,
      description: b.creative.description,
      callToAction: b.creative.call_to_action,
    },
  });
  const adSet = await tx.adSets.create({
    data: {
      ...actor,
      adCampaignId: row.id,
      name: b.name,
      audienceSnapshot: b.audience,
      placements: { mode: b.placement_mode, items: b.placements },
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      ...(b.budget_type === 'daily'
        ? { dailyBudget: b.budget_amount }
        : { lifetimeBudget: b.budget_amount }),
    },
  });
  await tx.ads.create({
    data: { ...actor, adSetId: adSet.id, adCreativeId: creative.id, name: b.name },
  });
  return { data: resource(row) };
}
async function draftMutation(
  input: ServiceContext,
  operation: string,
  hashInput: unknown,
  fn: (tx: Prisma.TransactionClient) => Promise<any>,
) {
  requireAdAccountOwner(input);
  const key = input.headers['idempotency-key'];
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(key))
    throw new ApiError(400, 'IDEMPOTENCY_REQUIRED', 'Provide a valid Idempotency-Key');
  const vendorId = input.identity!.vendorId!,
    storedKey = `ad-draft:${key}`,
    hash = digest(JSON.stringify({ operation, input: hashInput }));
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${vendorId}:${storedKey}`},0))`;
    await getActiveAdAccountAccess(tx, input, true);
    const prior = await tx.nativeIdempotency.findUnique({
      where: { vendorId_key: { vendorId, key: storedKey } },
    });
    if (prior) {
      if (prior.requestHash !== hash)
        throw new ApiError(
          409,
          'IDEMPOTENCY_CONFLICT',
          'This key was used for another draft operation',
        );
      return prior.response;
    }
    const response = await fn(tx);
    await tx.nativeIdempotency.create({
      data: { vendorId, key: storedKey, requestHash: hash, response },
    });
    return response;
  });
}
export async function createCampaign(input: ServiceContext) {
  const body = checkedDraft(input.body);
  const response = await draftMutation(input, 'create', body, (tx) => saveDraft(tx, input, body));
  return serviceResult(response, { status: 201, format: 'json' });
}
export async function action(input: ServiceContext) {
  const row = await campaign(input, input.body.action === 'delete'),
    verb = input.body.action;
  if (verb === 'pause' || verb === 'resume')
    return updateAdCampaignStatus({
      ...input,
      params: { ...input.params, id: row.id },
      body: { status: verb === 'pause' ? 'paused' : 'active' },
    });
  const configuration = row.configuration as any;
  if (verb === 'publish' || !configuration?.nativeDraft || row.metaCampaignId)
    throw new ApiError(
      409,
      'AD_PUBLISH_REVIEW_REQUIRED',
      'Remote publishing, archive and deletion require a complete provider workflow',
    );
  if (verb === 'duplicate' && !can(input, 'ads.create'))
    throw new ApiError(403, 'FORBIDDEN', 'Campaign creation permission required');
  const response = await draftMutation(input, verb, { uuid: row.uuid }, async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ad-draft-campaign:${row.id}`},0))`;
    const current = await tx.adCampaigns.findFirst({
      where: { id: row.id, ...ownership(input), metaCampaignId: null },
    });
    if (!current || !(current.configuration as any)?.nativeDraft)
      throw new ApiError(409, 'DRAFT_CHANGED', 'Draft changed before mutation');
    if (verb === 'duplicate') {
      const b = checkedDraft({
        ...(current.configuration as any).body,
        name: (current.name + ' (Copy)').slice(0, 150),
        publish: false,
      });
      return saveDraft(tx, input, b);
    }
    await tx.adCampaigns.update({
      where: { id: row.id },
      data: {
        status: 'archived',
        effectiveStatus: 'archived',
        updatedBy: input.identity!.userId,
        updatedAt: new Date(),
        ...(verb === 'delete' ? { deletedAt: new Date() } : {}),
      },
    });
    return { data: { id: row.uuid, status: verb === 'delete' ? 'deleted' : 'archived' } };
  });
  return serviceResult(response, { status: 200, format: 'json' });
}
export async function conversion(input: ServiceContext) {
  const b = input.body;
  const row = b.campaign_uuid
    ? await campaign({ ...input, params: { campaign: b.campaign_uuid } })
    : null;
  if (b.contact_uid && !can(input, 'vendor.contacts.view'))
    throw new ApiError(403, 'FORBIDDEN', 'Contact visibility permission required');
  const contact = b.contact_uid
    ? await db.contacts.findFirst({ where: { ...contactVisibility(input), uid: b.contact_uid } })
    : null;
  if (b.contact_uid && !contact) throw new ApiError(404, 'NOT_FOUND', 'Contact not found');
  return recordAdConversion({
    ...input,
    body: {
      campaignId: row?.id,
      contactId: contact?.id,
      externalId: b.external_id,
      type: b.type,
      value: b.value,
      currency: b.currency,
      occurredAt: b.occurred_at,
    },
  });
}
