import type { Prisma } from '@prisma/client';
import { ApiError } from '../../../shared/api-error.js';
import { badInsight } from './ad-insights.js';

const numeric = (v: unknown): v is string => typeof v === 'string' && /^\d{5,100}$/.test(v);
const name = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 255;
const status = (v: unknown) => ['ACTIVE', 'PAUSED', 'ARCHIVED', 'DELETED'].includes(v as string);
const effective = (v: unknown) => typeof v === 'string' && /^[A-Z_]{1,100}$/.test(v);
const object = (v: unknown): Record<string, any> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {};
function review(): never {
  throw new ApiError(
    409,
    'AD_STRUCTURE_REVIEW_REQUIRED',
    'Existing ad identities or ownership require reconciliation',
  );
}
export function validateAdStructure(accountId: string, campaigns: any[], sets: any[], ads: any[]) {
  const campaignIds = new Set<string>(),
    setIds = new Map<string, string>(),
    adIds = new Set<string>();
  for (const row of campaigns) {
    if (
      !row ||
      !numeric(row.id) ||
      campaignIds.has(row.id) ||
      row.account_id !== accountId ||
      !name(row.name) ||
      typeof row.objective !== 'string' ||
      row.objective.length > 100 ||
      !status(row.status) ||
      !effective(row.effective_status)
    )
      badInsight();
    campaignIds.add(row.id);
  }
  for (const row of sets) {
    if (
      !row ||
      !numeric(row.id) ||
      setIds.has(row.id) ||
      row.account_id !== accountId ||
      !campaignIds.has(row.campaign_id) ||
      !name(row.name) ||
      !status(row.status) ||
      !effective(row.effective_status)
    )
      badInsight();
    setIds.set(row.id, row.campaign_id);
  }
  for (const row of ads) {
    if (
      !row ||
      !numeric(row.id) ||
      adIds.has(row.id) ||
      row.account_id !== accountId ||
      !setIds.has(row.adset_id) ||
      setIds.get(row.adset_id) !== row.campaign_id ||
      !name(row.name) ||
      !status(row.status) ||
      !effective(row.effective_status)
    )
      badInsight();
    adIds.add(row.id);
  }
}
export async function importAdStructure(
  tx: Prisma.TransactionClient,
  vendorId: number,
  account: {
    id: number;
    timezone: string;
  },
  actorId: number,
  campaigns: any[],
  sets: any[],
  ads: any[],
) {
  const campaignMap = new Map<string, number>(),
    setMap = new Map<string, number>();
  for (const remote of campaigns) {
    const old = await tx.adCampaigns.findUnique({
      where: { vendorId_metaCampaignId: { vendorId, metaCampaignId: remote.id } },
    });
    if (old && (old.organizationId !== vendorId || old.adAccountId !== account.id)) review();
    const data = {
      name: remote.name,
      objective: remote.objective,
      status: remote.status.toLowerCase(),
      effectiveStatus: remote.effective_status.toLowerCase(),
      deletedAt: remote.status === 'DELETED' ? new Date() : null,
      updatedAt: new Date(),
      lastSyncedAt: new Date(),
      updatedBy: actorId,
    };
    const saved = old
      ? await tx.adCampaigns.update({ where: { id: old.id }, data })
      : await tx.adCampaigns.create({
          data: {
            ...data,
            vendorId,
            organizationId: vendorId,
            adAccountId: account.id,
            metaCampaignId: remote.id,
            timezone: account.timezone,
            configuration: { nativeAdsMirror: 1 },
            createdBy: actorId,
          },
        });
    campaignMap.set(remote.id, saved.id);
  }
  for (const remote of sets) {
    const found = await tx.adSets.findMany({
      where: { vendorId, metaAdSetId: remote.id },
      take: 2,
    });
    const old = found[0],
      campaignId = campaignMap.get(remote.campaign_id)!;
    if (
      found.length > 1 ||
      (old && (old.organizationId !== vendorId || old.adCampaignId !== campaignId))
    )
      review();
    const data = {
      name: remote.name,
      status: remote.status.toLowerCase(),
      deletedAt: remote.status === 'DELETED' ? new Date() : null,
      updatedAt: new Date(),
      updatedBy: actorId,
      audienceSnapshot: {
        ...object(old?.audienceSnapshot),
        nativeAdsMirror: {
          version: 1,
          accountId: account.id,
          campaignId: remote.campaign_id,
          effectiveStatus: remote.effective_status.toLowerCase(),
        },
      },
    };
    const saved = old
      ? await tx.adSets.update({ where: { id: old.id }, data })
      : await tx.adSets.create({
          data: {
            ...data,
            vendorId,
            organizationId: vendorId,
            adCampaignId: campaignId,
            metaAdSetId: remote.id,
            createdBy: actorId,
          },
        });
    setMap.set(remote.id, saved.id);
  }
  for (const remote of ads) {
    const found = await tx.ads.findMany({ where: { vendorId, metaAdId: remote.id }, take: 2 });
    const old = found[0],
      setId = setMap.get(remote.adset_id)!;
    if (found.length > 1 || (old && (old.organizationId !== vendorId || old.adSetId !== setId)))
      review();
    const data = {
      name: remote.name,
      status: remote.status.toLowerCase(),
      deletedAt: remote.status === 'DELETED' ? new Date() : null,
      updatedAt: new Date(),
      updatedBy: actorId,
      tracking: {
        ...object(old?.tracking),
        nativeAdsMirror: {
          version: 1,
          accountId: account.id,
          campaignId: remote.campaign_id,
          adSetId: remote.adset_id,
          adId: remote.id,
          effectiveStatus: remote.effective_status.toLowerCase(),
          syncedAt: new Date().toISOString(),
        },
      },
    };
    if (old) await tx.ads.update({ where: { id: old.id }, data });
    else
      await tx.ads.create({
        data: {
          ...data,
          vendorId,
          organizationId: vendorId,
          adSetId: setId,
          metaAdId: remote.id,
          createdBy: actorId,
        },
      });
  }
  return { campaigns: campaigns.length, adSets: sets.length, ads: ads.length };
}
