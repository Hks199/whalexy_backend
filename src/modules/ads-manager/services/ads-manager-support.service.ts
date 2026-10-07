import { Prisma } from '@prisma/client';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { config } from '../../../config/environment.js';
import { decrypt, digest } from '../../../utils/crypto.js';
import { providerRequest } from '../../../infrastructure/providers/meta.client.js';
import { adRange, badInsight } from './ad-insights.js';
import { type ServiceContext } from '../../../shared/service-context.js';

export const accountSelect = {
  id: true,
  uuid: true,
  metaAccountId: true,
  name: true,
  currency: true,
  timezone: true,
  status: true,
  connectionHealth: true,
  lastSyncedAt: true,
  tokenExpiresAt: true,
};

export const campaignSelect = {
  id: true,
  uuid: true,
  adAccountId: true,
  metaCampaignId: true,
  name: true,
  objective: true,
  status: true,
  effectiveStatus: true,
  lastSyncedAt: true,
};

export function requireAdAccountOwner(req: ServiceContext) {
  if (req.identity!.role !== 'owner' || req.identity!.apiKeyId)
    throw new ApiError(403, 'FORBIDDEN', 'Workspace owner session required');
}

export async function getActiveAdAccountAccess(
  tx: Prisma.TransactionClient,
  req: ServiceContext,
  ownerRequired = false,
) {
  const identity = req.identity!,
    vendorId = identity.vendorId!;
  const [membership, user, vendor] = await Promise.all([
    tx.nativeMemberships.findUnique({
      where: { vendorId_userId: { vendorId, userId: identity.userId } },
    }),
    tx.users.findUnique({ where: { id: identity.userId }, select: { status: true } }),
    tx.vendors.findUnique({ where: { id: vendorId }, select: { status: true } }),
  ]);
  const permissions = membership?.permissions;
  if (
    !membership?.active ||
    user?.status !== 1 ||
    vendor?.status !== 1 ||
    !Array.isArray(permissions) ||
    !permissions.some((p) => p === '*' || p === 'ads.edit') ||
    (ownerRequired && (membership.role !== 'owner' || identity.apiKeyId))
  )
    throw new ApiError(403, 'FORBIDDEN', 'Ad management access changed');
  if (identity.apiKeyId) {
    const key = await tx.apiKeys.findFirst({
      where: { id: identity.apiKeyId, vendorId, userId: identity.userId, revokedAt: null },
    });
    if (
      !key ||
      (key.expiresAt && key.expiresAt <= new Date()) ||
      !Array.isArray(key.permissions) ||
      !key.permissions.includes('ads.edit')
    )
      throw new ApiError(403, 'FORBIDDEN', 'Ad API access changed');
  }
}

export async function requestAdsGraphApi(
  token: string,
  path: string,
  query: Record<string, string> = {},
) {
  const url = new URL(`https://graph.facebook.com/${config.META_GRAPH_VERSION}/${path}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const result = await providerRequest(url, { headers: { Authorization: `Bearer ${token}` } });
  if (result.error) badInsight();
  return result;
}

export async function fetchAdsGraphPages(
  token: string,
  path: string,
  query: Record<string, string>,
) {
  const rows: any[] = [],
    seen = new Set<string>();
  let after: string | undefined;
  for (let page = 0; page < 50; page++) {
    const result = await requestAdsGraphApi(token, path, {
      ...query,
      limit: '100',
      ...(after ? { after } : {}),
    });
    if (!Array.isArray(result.data) || result.data.length > 100) badInsight();
    rows.push(...result.data);
    if (!result.paging?.next) return rows;
    after = result.paging?.cursors?.after;
    if (typeof after !== 'string' || !after || after.length > 4096 || seen.has(after))
      throw new ApiError(502, 'AD_PAGINATION_INVALID', 'Invalid or repeated Meta cursor');
    seen.add(after);
  }
  throw new ApiError(
    409,
    'AD_SNAPSHOT_INCOMPLETE',
    'Ad snapshot exceeds 5,000 rows; existing data was retained',
  );
}

export async function getConnectedAdAccount(
  vendorId: number,
  id: number,
  tx: Prisma.TransactionClient = db,
) {
  const account = await tx.adAccounts.findFirst({
    where: { id, vendorId, organizationId: vendorId, deletedAt: null, status: 'connected' },
  });
  if (!account?.metaAccountId)
    throw new ApiError(404, 'AD_ACCOUNT_NOT_CONNECTED', 'Connected ad account not found');
  const credential = await tx.integrationCredentials.findUnique({
      where: {
        vendorId_provider_externalId: {
          vendorId,
          provider: 'meta-ads',
          externalId: account.metaAccountId,
        },
      },
    }),
    proof = (credential?.metadata as any)?.nativeAds;
  if (
    !credential ||
    proof?.version !== 1 ||
    proof.accountId !== account.metaAccountId ||
    proof.appId !== process.env.META_APP_ID ||
    proof.tokenHash !== digest(decrypt(credential.secret)) ||
    (proof.expiresAt && proof.expiresAt <= Date.now())
  )
    throw new ApiError(409, 'AD_RECONNECT_REQUIRED', 'Verify the current ad account token');
  return { account, credential };
}

export async function buildAdReport(
  req: ServiceContext,
  from: string,
  to: string,
  accountId?: number,
) {
  const vendorId = req.identity!.vendorId!,
    range = adRange(from, to);
  return db.$transaction(
    async (tx) => {
      if (
        accountId &&
        !(await tx.adAccounts.findFirst({
          where: { id: accountId, vendorId, organizationId: vendorId, deletedAt: null },
        }))
      )
        throw new ApiError(404, 'NOT_FOUND', 'Ad account not found');
      const rows = await tx.campaignDailyMetrics.findMany({
        where: {
          vendorId,
          organizationId: vendorId,
          deletedAt: null,
          metricDate: { gte: range.from, lte: range.to },
          refAdCampaignId: {
            vendorId,
            organizationId: vendorId,
            deletedAt: null,
            refAdAccountId: { vendorId, organizationId: vendorId, deletedAt: null },
            ...(accountId ? { adAccountId: accountId } : {}),
          },
        },
        include: {
          refAdCampaignId: {
            select: { ...campaignSelect, refAdAccountId: { select: { currency: true } } },
          },
        },
        orderBy: [{ metricDate: 'asc' }, { id: 'asc' }],
        take: 10001,
      });
      if (rows.length > 10000)
        throw new ApiError(409, 'AD_REPORT_TOO_LARGE', 'Select a smaller report range');
      return rows;
    },
    { isolationLevel: 'RepeatableRead' },
  );
}
