import { Prisma, type Contacts } from '@prisma/client';
import { digest } from '../../../utils/crypto.js';
import { ApiError } from '../../../shared/api-error.js';

const decimal = Prisma.Decimal.clone({ precision: 40 });
const object = (v: unknown): Record<string, any> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {};
export const ownedCampaign = (vendorId: number) => ({
  vendorId,
  organizationId: vendorId,
  deletedAt: null,
  refAdAccountId: { vendorId, organizationId: vendorId, deletedAt: null },
});
export const ownedSet = (vendorId: number) => ({
  vendorId,
  organizationId: vendorId,
  deletedAt: null,
  refAdCampaignId: ownedCampaign(vendorId),
});
export const ownedAdWhere = (vendorId: number) => ({
  vendorId,
  organizationId: vendorId,
  deletedAt: null,
  refAdSetId: ownedSet(vendorId),
});
export const ownedAttribution = (vendorId: number) => ({
  vendorId,
  organizationId: vendorId,
  deletedAt: null,
  AND: [
    { OR: [{ adCampaignId: null }, { refAdCampaignId: ownedCampaign(vendorId) }] },
    { OR: [{ adSetId: null }, { refAdSetId: ownedSet(vendorId) }] },
    { OR: [{ adId: null }, { refAdId: ownedAdWhere(vendorId) }] },
  ],
});
export async function mirroredAd(tx: Prisma.TransactionClient, vendorId: number, sourceId: string) {
  const rows = await tx.ads.findMany({
    where: { ...ownedAdWhere(vendorId), metaAdId: sourceId },
    include: { refAdSetId: { include: { refAdCampaignId: true } } },
    take: 2,
  });
  if (rows.length !== 1) return null;
  const ad = rows[0],
    set = ad.refAdSetId,
    campaign = set.refAdCampaignId,
    proof = object(ad.tracking).nativeAdsMirror;
  return proof?.version === 1 &&
    proof.accountId === campaign.adAccountId &&
    proof.adId === ad.metaAdId &&
    proof.adSetId === set.metaAdSetId &&
    proof.campaignId === campaign.metaCampaignId
    ? ad
    : null;
}
function text(v: unknown, max: number) {
  return typeof v === 'string' &&
    v.length > 0 &&
    v.length <= max &&
    !/[\u0000-\u001f\u007f]/.test(v)
    ? v
    : null;
}
function referralData(message: any) {
  const referral = object(message?.referral),
    sourceId = text(referral.source_id, 100);
  if (
    !sourceId ||
    !/^\d{5,100}$/.test(sourceId) ||
    (referral.source_type !== undefined && referral.source_type !== 'ad')
  )
    return null;
  const clickId = text(referral.ctwa_clid, 512) ?? text(message?.context?.id, 512);
  let sourceUrl: string | null = null;
  const utm: Record<string, string> = {};
  const suppliedUrl = text(referral.source_url, 2048);
  if (suppliedUrl)
    try {
      const url = new URL(suppliedUrl);
      if (url.protocol === 'https:' && !url.username && !url.password) {
        sourceUrl = url.toString();
        for (const [key, value] of url.searchParams)
          if (
            /^utm_[a-z0-9_]{1,60}$/.test(key) &&
            text(value, 512) &&
            Object.keys(utm).length < 20 &&
            !(key in utm)
          )
            utm[key] = value;
      }
    } catch {
      /* Optional untrusted URL is never fetched. */
    }
  return { sourceId, clickId, sourceUrl, utm, placement: utm.utm_placement ?? null };
}
// Called inside the signed message receipt transaction, under its contact lock.
export async function captureAdReferral(
  tx: Prisma.TransactionClient,
  vendorId: number,
  contact: Contacts,
  message: any,
  occurredAt: Date,
) {
  const data = referralData(message);
  if (
    !data ||
    contact.vendorId !== vendorId ||
    contact.status !== 1 ||
    !Number.isFinite(occurredAt.getTime()) ||
    occurredAt.getTime() <= 0 ||
    occurredAt.getTime() > Date.now() + 300000
  )
    return;
  const identity = data.clickId ?? text(message?.id, 512);
  if (!identity) return;
  const key = `ad-referral:${contact.id}:${digest(identity)}`;
  if (await tx.nativeIdempotency.findUnique({ where: { vendorId_key: { vendorId, key } } })) return;
  // Legacy click rows have no native receipt proof and are left for review.
  if (
    data.clickId &&
    (await tx.adConversationAttributions.findFirst({
      where: { vendorId, contactId: contact.id, ctwaClickId: data.clickId },
    }))
  )
    return;
  const ad = await mirroredAd(tx, vendorId, data.sourceId),
    set = ad?.refAdSetId,
    campaign = set?.refAdCampaignId;
  const row = await tx.adConversationAttributions.create({
    data: {
      vendorId,
      organizationId: vendorId,
      contactId: contact.id,
      adId: ad?.id,
      adSetId: set?.id,
      adCampaignId: campaign?.id,
      ctwaClickId: data.clickId,
      sourceId: data.sourceId,
      sourceType: 'ad',
      sourceUrl: data.sourceUrl,
      utmParameters: data.utm,
      placement: data.placement,
      conversationStartedAt: occurredAt,
      assignedUserId: contact.assignedUserId,
      referral: {
        nativeVersion: 1,
        messageId: message.id,
        sourceId: data.sourceId,
        phoneNumberId: contact.wabPhoneNumberId,
      },
    },
  });
  await tx.nativeIdempotency.create({
    data: {
      vendorId,
      key,
      requestHash: digest(JSON.stringify({ contactId: contact.id, sourceId: data.sourceId })),
      response: { id: row.id },
    },
  });
  const latest = await tx.adConversationAttributions.findFirst({
    where: { ...ownedAttribution(vendorId), contactId: contact.id },
    orderBy: [{ conversationStartedAt: 'desc' }, { id: 'desc' }],
  });
  if (latest?.id === row.id)
    await tx.contacts.update({
      where: { id: contact.id },
      data: {
        data: {
          ...object(contact.data),
          ad_attribution: {
            nativeVersion: 1,
            attributionId: row.id,
            campaign_id: campaign?.uuid ?? null,
            campaign_name: campaign?.name ?? null,
            ad_set_id: set?.metaAdSetId ?? null,
            ad_set_name: set?.name ?? null,
            ad_id: ad?.metaAdId ?? null,
            ad_name: ad?.name ?? null,
            placement: data.placement,
            source: 'meta_ad',
            utm_parameters: data.utm,
            conversation_started_at: occurredAt.toISOString(),
          },
        },
        updatedAt: new Date(),
      },
    });
}
export async function conversionAttribution(
  tx: Prisma.TransactionClient,
  vendorId: number,
  contactId: number,
  campaignId: number | null,
  occurredAt: Date,
) {
  const row = await tx.adConversationAttributions.findFirst({
    where: { ...ownedAttribution(vendorId), contactId, conversationStartedAt: { lte: occurredAt } },
    orderBy: [{ conversationStartedAt: 'desc' }, { id: 'desc' }],
  });
  if (!row) return null;
  const referral = object(row.referral),
    identity = row.ctwaClickId ?? text(referral.messageId, 512);
  if (referral.nativeVersion !== 1 || referral.sourceId !== row.sourceId || !identity) return null;
  const claim = await tx.nativeIdempotency.findUnique({
    where: { vendorId_key: { vendorId, key: `ad-referral:${contactId}:${digest(identity)}` } },
  });
  if (
    !claim ||
    object(claim.response).id !== row.id ||
    claim.requestHash !== digest(JSON.stringify({ contactId, sourceId: row.sourceId }))
  )
    return null;
  const ad = row.sourceId ? await mirroredAd(tx, vendorId, row.sourceId) : null;
  if (
    !ad ||
    (campaignId !== null && ad.refAdSetId.adCampaignId !== campaignId) ||
    (row.adId !== null && ad.id !== row.adId) ||
    (row.adSetId !== null && ad.refAdSetId.id !== row.adSetId) ||
    (row.adCampaignId !== null && ad.refAdSetId.adCampaignId !== row.adCampaignId)
  )
    return null;
  if (row.adId === null)
    return tx.adConversationAttributions.update({
      where: { id: row.id },
      data: {
        adId: ad.id,
        adSetId: ad.adSetId,
        adCampaignId: ad.refAdSetId.adCampaignId,
        updatedAt: new Date(),
      },
    });
  return row;
}
export async function recordAttributedOutcome(
  tx: Prisma.TransactionClient,
  vendorId: number,
  actorId: number,
  attributionId: number,
  type: string,
  value: Prisma.Decimal,
  occurredAt: Date,
) {
  const row = await tx.adConversationAttributions.findFirstOrThrow({
    where: { id: attributionId, ...ownedAttribution(vendorId) },
  });
  const signed = ['purchase', 'payment'].includes(type)
    ? value
    : type === 'refund'
      ? value.negated()
      : new Prisma.Decimal(0);
  const revenue = new decimal(row.revenue).plus(signed);
  if (revenue.abs().gt('99999999999999.9999'))
    throw new ApiError(409, 'AD_REVENUE_LIMIT', 'Attributed revenue exceeds the supported range');
  // Never let an older submitted outcome overwrite the latest status.
  const latest = await tx.conversionEvents.findFirst({
    where: {
      vendorId,
      organizationId: vendorId,
      deletedAt: null,
      refConversionId: {
        vendorId,
        organizationId: vendorId,
        attribution: { path: ['attributionId'], equals: attributionId },
      },
    },
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
  });
  await tx.adConversationAttributions.update({
    where: { id: row.id },
    data: {
      revenue,
      ...(latest && latest.occurredAt > occurredAt ? {} : { conversionStatus: type }),
      updatedBy: actorId,
      updatedAt: new Date(),
    },
  });
}
