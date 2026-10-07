import { Prisma } from '@prisma/client';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { config } from '../../../config/environment.js';
import { decrypt, digest } from '../../../utils/crypto.js';
import { providerRequest } from '../../../infrastructure/providers/meta.client.js';
import { metaOperation } from '../../../infrastructure/providers/meta-operations.js';
import { can } from '../../../shared/access-policy.js';
import { contactVisibility } from '../../contacts/contacts.service.js';
import { summarizeAds, adCsvCell } from './ad-insights.js';
import {
  ownedCampaign,
  ownedAttribution,
  conversionAttribution,
  recordAttributedOutcome,
} from './ad-attribution.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import {
  campaignSelect,
  requireAdAccountOwner,
  getConnectedAdAccount,
  getActiveAdAccountAccess,
  requestAdsGraphApi,
  buildAdReport,
} from './ads-manager-support.service.js';

export async function listAdCampaigns(requestInput: ServiceContext) {
  const q = requestInput.validatedQuery,
    vendorId = requestInput.identity!.vendorId!,
    where: Prisma.AdCampaignsWhereInput = {
      vendorId,
      organizationId: vendorId,
      deletedAt: null,
      refAdAccountId: { vendorId, organizationId: vendorId, deletedAt: null },
      ...(q.accountId ? { adAccountId: q.accountId } : {}),
      ...(q.search ? { name: { contains: q.search, mode: 'insensitive' } } : {}),
      ...(q.status ? { status: q.status } : {}),
    };
  const [items, total] = await db.$transaction([
    db.adCampaigns.findMany({
      where,
      select: campaignSelect,
      orderBy: { id: 'desc' },
      take: q.limit,
      skip: (q.page - 1) * q.limit,
    }),
    db.adCampaigns.count({ where }),
  ]);
  return serviceResult(
    { items, total, page: q.page, limit: q.limit },
    { status: 200, format: 'json' },
  );
}

export async function updateAdCampaignStatus(requestInput: ServiceContext) {
  requireAdAccountOwner(requestInput);
  const vendorId = requestInput.identity!.vendorId!,
    id = Number(requestInput.params.id),
    status = requestInput.body.status;
  const campaign = await db.adCampaigns.findFirst({
    where: { id, vendorId, organizationId: vendorId, deletedAt: null },
  });
  if (!campaign?.metaCampaignId)
    throw new ApiError(404, 'NOT_FOUND', 'Mirrored campaign not found');
  const connection = await getConnectedAdAccount(vendorId, campaign.adAccountId);
  if ((connection.credential.metadata as any)?.nativeAds?.canManage !== true)
    throw new ApiError(
      403,
      'AD_MANAGEMENT_PERMISSION',
      'Verify a token with ads_management before changing delivery',
    );
  const result = await metaOperation(
    requestInput,
    `ad-campaign:${id}`,
    { id, status, externalId: campaign.metaCampaignId },
    async (effect) => {
      await db.$transaction((tx) => getActiveAdAccountAccess(tx, requestInput, true));
      const token = decrypt(connection.credential.secret),
        remote = await requestAdsGraphApi(token, campaign.metaCampaignId!, {
          fields: 'id,account_id,status',
        });
      if (
        remote.id !== campaign.metaCampaignId ||
        remote.account_id !== connection.account.metaAccountId
      )
        throw new ApiError(403, 'AD_CAMPAIGN_OWNER', 'Meta campaign belongs to another ad account');
      const current = await getConnectedAdAccount(vendorId, campaign.adAccountId);
      if (current.credential.updatedAt.getTime() !== connection.credential.updatedAt.getTime())
        throw new ApiError(409, 'AD_CONNECTION_CHANGED', 'Ad token changed before status update');
      await db.$transaction((tx) => getActiveAdAccountAccess(tx, requestInput, true));
      const accepted = await effect(() =>
        providerRequest(
          new URL(
            `https://graph.facebook.com/${config.META_GRAPH_VERSION}/${campaign.metaCampaignId}`,
          ),
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({ status: status.toUpperCase() }).toString(),
          },
        ),
      );
      if ((accepted as any)?.success !== true)
        throw new ApiError(
          502,
          'PROVIDER_UNCERTAIN',
          'Meta status acceptance requires reconciliation',
        );
      return { id, status, effectiveStatus: 'pending_sync', providerAccepted: true };
    },
    async (tx, value) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`integration:meta-ads:${connection.account.metaAccountId}`},0))`;
      const changed = await tx.adCampaigns.updateMany({
        where: {
          id,
          vendorId,
          organizationId: vendorId,
          adAccountId: campaign.adAccountId,
          metaCampaignId: campaign.metaCampaignId,
        },
        data: {
          status: value.status,
          effectiveStatus: 'pending_sync',
          updatedBy: requestInput.identity!.userId,
          updatedAt: new Date(),
        },
      });
      if (!changed.count)
        throw new ApiError(
          409,
          'AD_CAMPAIGN_REVIEW_REQUIRED',
          'Accepted campaign update requires local reconciliation',
        );
      await tx.adAccounts.update({
        where: { id: campaign.adAccountId },
        data: { updatedAt: new Date() },
      });
    },
  );
  return serviceResult(result, { status: 200, format: 'json' });
}

export async function getAdDashboard(requestInput: ServiceContext) {
  const q = requestInput.validatedQuery,
    rows = await buildAdReport(requestInput, q.from, q.to, q.accountId),
    grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const currency = row.refAdCampaignId.refAdAccountId.currency;
    grouped.set(currency, [...(grouped.get(currency) ?? []), row]);
  }
  return serviceResult(
    {
      from: q.from,
      to: q.to,
      currencies: [...grouped].map(([currency, items]) => ({
        currency,
        summary: summarizeAds(items),
        trend: [...new Set(items.map((row) => row.metricDate.toISOString().slice(0, 10)))].map(
          (date) => ({
            date,
            ...summarizeAds(items.filter((row) => row.metricDate.toISOString().startsWith(date))),
          }),
        ),
      })),
    },
    { status: 200, format: 'json' },
  );
}

export async function exportAdReport(requestInput: ServiceContext) {
  const q = requestInput.validatedQuery,
    rows = await buildAdReport(requestInput, q.from, q.to, q.accountId);
  const header = [
    'Date',
    'Campaign',
    'Status',
    'Currency',
    'Spend',
    'Summed reach',
    'Impressions',
    'Clicks',
    'Conversations',
    'Leads',
    'Purchases',
    'Revenue',
  ];
  const lines = rows.map((r) => [
    r.metricDate.toISOString().slice(0, 10),
    r.refAdCampaignId.name,
    r.refAdCampaignId.status,
    r.refAdCampaignId.refAdAccountId.currency,
    r.spend.toFixed(4),
    r.reach,
    r.impressions,
    r.clicks,
    r.conversations,
    r.leads,
    r.purchases,
    r.revenue.toFixed(4),
  ]);
  return serviceResult(
    [header, ...lines].map((row) => row.map(adCsvCell).join(',')).join('\r\n') + '\r\n',
    {
      status: 200,
      format: 'send',
      contentType: 'text/csv',
      headers: { 'Content-Disposition': 'attachment; filename="ad-metrics.csv"' },
    },
  );
}

export async function recordAdConversion(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!,
    b = requestInput.body;
  const value = new Prisma.Decimal(b.value),
    input = {
      campaignId: b.campaignId ?? null,
      contactId: b.contactId ?? null,
      externalId: b.externalId,
      type: b.type,
      value: value.toFixed(4),
      currency: b.currency,
      occurredAt: b.occurredAt.toISOString(),
    };
  const hash = digest(JSON.stringify(input)),
    key = `ad-conversion:${b.externalId}`;
  const result = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ad-conversion:${vendorId}:${b.externalId}`},0))`;
    await getActiveAdAccountAccess(tx, requestInput);
    let contact: {
      waId: string | null;
    } | null = null;
    if (b.contactId) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ad-outcomes:${vendorId}:${b.contactId}`},0))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(601, ${b.contactId}::integer)`;
      await tx.$queryRaw`SELECT _id FROM contacts WHERE vendors__id=${vendorId} AND _id=${b.contactId} FOR UPDATE`;
      if (!can(requestInput, 'vendor.contacts.view'))
        throw new ApiError(403, 'FORBIDDEN', 'Contact visibility permission required');
      contact = await tx.contacts.findFirst({
        where: { id: b.contactId, ...contactVisibility(requestInput), status: 1 },
        select: { waId: true },
      });
      if (!contact) throw new ApiError(404, 'NOT_FOUND', 'Contact not found');
    }
    const old = await tx.nativeIdempotency.findUnique({
      where: { vendorId_key: { vendorId, key } },
    });
    if (old) {
      if (old.requestHash !== hash)
        throw new ApiError(
          409,
          'AD_CONVERSION_CONFLICT',
          'External ID was used for another conversion',
        );
      const row = await tx.conversions.findFirst({
        where: {
          id: Number((old.response as any)?.id),
          vendorId,
          organizationId: vendorId,
          deletedAt: null,
          OR: [{ adCampaignId: null }, { refAdCampaignId: ownedCampaign(vendorId) }],
        },
      });
      if (!row)
        throw new ApiError(
          409,
          'AD_CONVERSION_REVIEW_REQUIRED',
          'Conversion replay requires reconciliation',
        );
      return row;
    }
    if (await tx.conversions.findFirst({ where: { vendorId, externalId: b.externalId } }))
      throw new ApiError(
        409,
        'AD_CONVERSION_REVIEW_REQUIRED',
        'A legacy conversion already uses this external ID',
      );
    const attribution = b.contactId
      ? await conversionAttribution(tx, vendorId, b.contactId, b.campaignId ?? null, b.occurredAt)
      : null;
    const campaignId = b.campaignId ?? attribution?.adCampaignId ?? null;
    const campaign = campaignId
      ? await tx.adCampaigns.findFirst({
          where: { id: campaignId, ...ownedCampaign(vendorId) },
          include: { refAdAccountId: { select: { currency: true } } },
        })
      : null;
    if (campaignId && !campaign) throw new ApiError(404, 'NOT_FOUND', 'Owned campaign not found');
    if (campaign && campaign.refAdAccountId.currency !== b.currency)
      throw new ApiError(
        400,
        'AD_CURRENCY_MISMATCH',
        'Conversion currency must match its campaign account',
      );
    const row = await tx.conversions.create({
      data: {
        vendorId,
        organizationId: vendorId,
        adCampaignId: campaignId,
        externalId: b.externalId,
        type: b.type,
        value,
        currency: b.currency,
        adId: attribution?.adId ?? null,
        occurredAt: b.occurredAt,
        contactWaId: contact?.waId ?? null,
        attribution: {
          nativeVersion: 1,
          contactId: b.contactId ?? null,
          attributionId: attribution?.id ?? null,
        },
        createdBy: requestInput.identity!.userId,
      },
    });
    await tx.conversionEvents.create({
      data: {
        vendorId,
        organizationId: vendorId,
        conversionId: row.id,
        eventName: row.type,
        source: 'native-api',
        occurredAt: row.occurredAt,
        payload: { nativeVersion: 1, attributionId: attribution?.id ?? null },
        createdBy: requestInput.identity!.userId,
      },
    });
    if (attribution)
      await recordAttributedOutcome(
        tx,
        vendorId,
        requestInput.identity!.userId,
        attribution.id,
        row.type,
        row.value,
        row.occurredAt,
      );
    await tx.nativeIdempotency.create({
      data: { vendorId, key, requestHash: hash, response: { id: row.id } },
    });
    await tx.auditEvents.create({
      data: {
        vendorId,
        actorId: requestInput.identity!.userId,
        action: 'create',
        resource: 'ad-conversion',
        resourceId: String(row.id),
      },
    });
    return row;
  });
  return serviceResult(
    {
      id: result.id,
      uuid: result.uuid,
      campaignId: result.adCampaignId,
      type: result.type,
      value: result.value.toFixed(4),
      currency: result.currency,
      occurredAt: result.occurredAt,
      attributionId: (result.attribution as any)?.attributionId ?? null,
    },
    { status: 201, format: 'json' },
  );
}

export async function getContactAdAttributions(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!,
    contactId = Number(requestInput.params.id),
    q = requestInput.validatedQuery;
  const result = await db.$transaction(
    async (tx) => {
      if (
        !(await tx.contacts.findFirst({
          where: { id: contactId, ...contactVisibility(requestInput), status: 1 },
          select: { id: true },
        }))
      )
        throw new ApiError(404, 'NOT_FOUND', 'Contact not found');
      const where = { ...ownedAttribution(vendorId), contactId };
      const [items, total] = await Promise.all([
        tx.adConversationAttributions.findMany({
          where,
          orderBy: [{ conversationStartedAt: 'desc' }, { id: 'desc' }],
          skip: (q.page - 1) * q.limit,
          take: q.limit,
          select: {
            id: true,
            adCampaignId: true,
            adSetId: true,
            adId: true,
            sourceId: true,
            sourceType: true,
            placement: true,
            conversationStartedAt: true,
            conversionStatus: true,
            revenue: true,
            refAdCampaignId: {
              select: { name: true, refAdAccountId: { select: { currency: true } } },
            },
          },
        }),
        tx.adConversationAttributions.count({ where }),
      ]);
      return {
        items: items.map(({ refAdCampaignId, revenue, ...row }) => ({
          ...row,
          campaignName: refAdCampaignId?.name ?? null,
          currency: refAdCampaignId?.refAdAccountId.currency ?? null,
          revenue: revenue.toFixed(4),
        })),
        total,
        page: q.page,
        limit: q.limit,
      };
    },
    { isolationLevel: 'RepeatableRead' },
  );
  return serviceResult(result, { status: 200, format: 'json' });
}
