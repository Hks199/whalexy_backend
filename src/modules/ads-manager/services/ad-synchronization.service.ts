import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { decrypt } from '../../../utils/crypto.js';
import { adRange, insightRow, badInsight } from './ad-insights.js';
import { validateAdStructure, importAdStructure } from './ad-structure.js';
import { numeric } from '../ads-manager.validation.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import {
  getConnectedAdAccount,
  fetchAdsGraphPages,
  getActiveAdAccountAccess,
} from './ads-manager-support.service.js';

export async function syncAdStructure(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!,
    id = Number(requestInput.params.id),
    before = await getConnectedAdAccount(vendorId, id),
    token = decrypt(before.credential.secret),
    path = `act_${before.account.metaAccountId}`;
  const campaigns = await fetchAdsGraphPages(token, `${path}/campaigns`, {
    fields: 'id,account_id,name,objective,status,effective_status',
  });
  const sets = await fetchAdsGraphPages(token, `${path}/adsets`, {
    fields: 'id,account_id,campaign_id,name,status,effective_status',
  });
  const ads = await fetchAdsGraphPages(token, `${path}/ads`, {
    fields: 'id,account_id,campaign_id,adset_id,name,status,effective_status',
  });
  validateAdStructure(before.account.metaAccountId!, campaigns, sets, ads);
  const result = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`integration:meta-ads:${before.account.metaAccountId}`},0))`;
      await getActiveAdAccountAccess(tx, requestInput);
      const current = await getConnectedAdAccount(vendorId, id, tx);
      if (
        current.credential.updatedAt.getTime() !== before.credential.updatedAt.getTime() ||
        current.account.updatedAt.getTime() !== before.account.updatedAt.getTime()
      )
        throw new ApiError(
          409,
          'AD_CONNECTION_CHANGED',
          'Ad connection changed during synchronization',
        );
      const result = await importAdStructure(
        tx,
        vendorId,
        current.account,
        requestInput.identity!.userId,
        campaigns,
        sets,
        ads,
      );
      await tx.adAccounts.update({ where: { id }, data: { updatedAt: new Date() } });
      await tx.auditEvents.create({
        data: {
          vendorId,
          actorId: requestInput.identity!.userId,
          action: 'sync-structure',
          resource: 'ad-account',
          resourceId: String(id),
          metadata: result,
        },
      });
      return result;
    },
    { timeout: 30000 },
  );
  return serviceResult(result, { status: 200, format: 'json' });
}

export async function syncAdInsights(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!,
    id = Number(requestInput.params.id),
    b = requestInput.body,
    range = adRange(b.from, b.to),
    before = await getConnectedAdAccount(vendorId, id),
    token = decrypt(before.credential.secret);
  const campaigns = await fetchAdsGraphPages(
    token,
    `act_${before.account.metaAccountId}/campaigns`,
    {
      fields: 'id,name,objective,status,effective_status',
    },
  );
  const ids = new Set<string>();
  for (const row of campaigns) {
    if (
      numeric.validate(row?.id, { convert: false }).error ||
      ids.has(row.id) ||
      typeof row.name !== 'string' ||
      !row.name ||
      row.name.length > 255 ||
      typeof row.objective !== 'string' ||
      row.objective.length > 100 ||
      !['ACTIVE', 'PAUSED', 'ARCHIVED', 'DELETED'].includes(row.status) ||
      typeof row.effective_status !== 'string' ||
      row.effective_status.length > 100
    )
      badInsight();
    ids.add(row.id);
  }
  const raw = await fetchAdsGraphPages(token, `act_${before.account.metaAccountId}/insights`, {
    fields:
      'campaign_id,account_currency,date_start,date_stop,spend,reach,impressions,clicks,actions,action_values',
    level: 'campaign',
    time_increment: '1',
    time_range: JSON.stringify({ since: b.from, until: b.to }),
  });
  const seen = new Set<string>(),
    metrics = raw.map((row) => {
      const parsed = insightRow(row, before.account.currency, b.from, b.to),
        key = `${parsed.campaignId}:${row.date_start}`;
      if (!ids.has(parsed.campaignId) || seen.has(key)) badInsight();
      seen.add(key);
      return parsed;
    });
  const result = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`integration:meta-ads:${before.account.metaAccountId}`},0))`;
      await getActiveAdAccountAccess(tx, requestInput);
      const current = await getConnectedAdAccount(vendorId, id, tx);
      if (
        current.credential.updatedAt.getTime() !== before.credential.updatedAt.getTime() ||
        current.account.currency !== before.account.currency ||
        current.account.updatedAt.getTime() !== before.account.updatedAt.getTime()
      )
        throw new ApiError(
          409,
          'AD_CONNECTION_CHANGED',
          'Ad connection changed during synchronization',
        );
      const local = await tx.adCampaigns.findMany({ where: { vendorId, adAccountId: id } });
      for (const row of local)
        if (row.organizationId !== vendorId)
          throw new ApiError(
            409,
            'AD_ACCOUNT_REVIEW_REQUIRED',
            'Campaign ownership requires reconciliation',
          );
      const mapped = new Map<string, number>();
      for (const row of campaigns) {
        const old = await tx.adCampaigns.findUnique({
          where: { vendorId_metaCampaignId: { vendorId, metaCampaignId: row.id } },
        });
        if (old && (old.adAccountId !== id || old.organizationId !== vendorId))
          throw new ApiError(
            409,
            'AD_ACCOUNT_REVIEW_REQUIRED',
            'Campaign belongs to another account',
          );
        const data = {
          name: row.name,
          objective: row.objective,
          status: row.status.toLowerCase(),
          effectiveStatus: row.effective_status.toLowerCase(),
          lastSyncedAt: new Date(),
          updatedAt: new Date(),
          deletedAt: row.status === 'DELETED' ? new Date() : null,
        };
        const saved = old
          ? await tx.adCampaigns.update({ where: { id: old.id }, data })
          : await tx.adCampaigns.create({
              data: {
                ...data,
                vendorId,
                organizationId: vendorId,
                adAccountId: id,
                metaCampaignId: row.id,
                timezone: current.account.timezone,
                configuration: { nativeAdsMirror: 1 },
              },
            });
        mapped.set(row.id, saved.id);
      }
      const campaignIds = [...mapped.values()];
      // Replace only this complete campaign/date snapshot, keeping older ranges and local drafts.
      await tx.campaignDailyMetrics.deleteMany({
        where: {
          vendorId,
          organizationId: vendorId,
          adCampaignId: { in: campaignIds },
          metricDate: { gte: range.from, lte: range.to },
        },
      });
      if (metrics.length)
        await tx.campaignDailyMetrics.createMany({
          data: metrics.map(({ campaignId, ...row }) => ({
            ...row,
            adCampaignId: mapped.get(campaignId)!,
            vendorId,
            organizationId: vendorId,
            updatedBy: requestInput.identity!.userId,
          })),
        });
      await tx.adAccounts.update({
        where: { id },
        data: {
          lastSyncedAt: new Date(),
          connectionHealth: 'healthy',
          consecutiveSyncFailures: 0,
          updatedAt: new Date(),
        },
      });
      await tx.auditEvents.create({
        data: {
          vendorId,
          actorId: requestInput.identity!.userId,
          action: 'sync',
          resource: 'ad-account',
          resourceId: String(id),
          metadata: {
            campaigns: campaigns.length,
            metrics: metrics.length,
            from: b.from,
            to: b.to,
          },
        },
      });
      return { campaigns: campaigns.length, metrics: metrics.length };
    },
    { timeout: 30000 },
  );
  return serviceResult(result, { status: 200, format: 'json' });
}
