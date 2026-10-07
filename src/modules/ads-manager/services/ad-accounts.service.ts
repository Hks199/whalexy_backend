import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { encrypt, digest } from '../../../utils/crypto.js';
import { badInsight } from './ad-insights.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import {
  accountSelect,
  requireAdAccountOwner,
  requestAdsGraphApi,
  getActiveAdAccountAccess,
} from './ads-manager-support.service.js';

export async function listAdAccounts(requestInput: ServiceContext) {
  return serviceResult(
    await db.adAccounts.findMany({
      where: {
        vendorId: requestInput.identity!.vendorId!,
        organizationId: requestInput.identity!.vendorId!,
        deletedAt: null,
      },
      select: accountSelect,
      orderBy: { id: 'asc' },
    }),
    { status: 200, format: 'json' },
  );
}

export async function connectAdAccount(requestInput: ServiceContext) {
  requireAdAccountOwner(requestInput);
  const appId = process.env.META_APP_ID,
    secret = process.env.META_APP_SECRET;
  if (!appId || !/^\d{5,100}$/.test(appId) || !secret)
    throw new ApiError(503, 'AD_APP_NOT_CONFIGURED', 'Configure the Meta app ID and secret');
  const b = requestInput.body,
    vendorId = requestInput.identity!.vendorId!,
    debug = (
      await requestAdsGraphApi(`${appId}|${secret}`, 'debug_token', { input_token: b.accessToken })
    ).data;
  const scopes = new Set([
    ...(Array.isArray(debug?.scopes) ? debug.scopes : []),
    ...(Array.isArray(debug?.granular_scopes)
      ? debug.granular_scopes.map((g: any) => g.scope)
      : []),
  ]);
  const expiry = [debug?.expires_at, debug?.data_access_expires_at].filter(
    (v: any) => v !== undefined && v !== 0,
  );
  if (
    debug?.is_valid !== true ||
    String(debug.app_id) !== appId ||
    !Number.isSafeInteger(debug.expires_at) ||
    debug.expires_at < 0 ||
    !['USER', 'SYSTEM_USER'].includes(debug.type) ||
    !['ads_read', 'ads_management'].some((s) => scopes.has(s)) ||
    expiry.some((v: any) => !Number.isSafeInteger(v) || v <= Date.now() / 1000 + 30)
  )
    throw new ApiError(
      403,
      'AD_TOKEN_PERMISSION',
      'A current ad-read token for this app is required',
    );
  const remote = await requestAdsGraphApi(b.accessToken, `act_${b.accountId}`, {
    fields: 'id,account_id,name,currency,timezone_name,account_status',
  });
  if (
    remote.id !== `act_${b.accountId}` ||
    remote.account_id !== b.accountId ||
    remote.account_status !== 1 ||
    typeof remote.name !== 'string' ||
    !remote.name ||
    remote.name.length > 255 ||
    !/^[A-Z]{3}$/.test(remote.currency ?? '')
  )
    badInsight();
  try {
    new Intl.DateTimeFormat('en', { timeZone: remote.timezone_name });
    if (!remote.timezone_name) throw new Error();
  } catch {
    badInsight();
  }
  const proof = {
    version: 1,
    appId,
    accountId: b.accountId,
    tokenHash: digest(b.accessToken),
    canManage: scopes.has('ads_management'),
    expiresAt: expiry.length ? Math.min(...expiry) * 1000 : null,
  };
  const row = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`integration:meta-ads:${b.accountId}`},0))`;
    await getActiveAdAccountAccess(tx, requestInput, true);
    if (
      (await tx.integrationCredentials.findFirst({
        where: { provider: 'meta-ads', externalId: b.accountId, vendorId: { not: vendorId } },
      })) ||
      (await tx.adAccounts.findFirst({
        where: { metaAccountId: b.accountId, vendorId: { not: vendorId }, deletedAt: null },
      }))
    )
      throw new ApiError(409, 'AD_ACCOUNT_IN_USE', 'Account belongs to another workspace');
    const old = await tx.adAccounts.findUnique({
      where: { vendorId_metaAccountId: { vendorId, metaAccountId: b.accountId } },
    });
    if (old && old.organizationId !== vendorId)
      throw new ApiError(
        409,
        'AD_ACCOUNT_REVIEW_REQUIRED',
        'Account ownership requires reconciliation',
      );
    if (old && old.currency !== remote.currency)
      throw new ApiError(
        409,
        'AD_CURRENCY_REVIEW_REQUIRED',
        'Reconnection cannot change the currency of existing ad history',
      );
    const data = {
      name: remote.name,
      currency: remote.currency,
      timezone: remote.timezone_name,
      status: 'connected',
      connectionHealth: 'verified',
      accessToken: null,
      tokenExpiresAt: proof.expiresAt ? new Date(proof.expiresAt) : null,
      lastSyncError: null,
      reconnectRequiredAt: null,
      deletedAt: null,
      updatedBy: requestInput.identity!.userId,
      updatedAt: new Date(),
    };
    const row = old
      ? await tx.adAccounts.update({ where: { id: old.id }, data, select: accountSelect })
      : await tx.adAccounts.create({
          data: {
            ...data,
            vendorId,
            organizationId: vendorId,
            metaAccountId: b.accountId,
            createdBy: requestInput.identity!.userId,
          },
          select: accountSelect,
        });
    await tx.integrationCredentials.upsert({
      where: {
        vendorId_provider_externalId: { vendorId, provider: 'meta-ads', externalId: b.accountId },
      },
      create: {
        vendorId,
        provider: 'meta-ads',
        externalId: b.accountId,
        secret: encrypt(b.accessToken),
        metadata: { nativeAds: proof },
      },
      update: {
        secret: encrypt(b.accessToken),
        metadata: { nativeAds: proof },
        updatedAt: new Date(),
      },
    });
    await tx.auditEvents.create({
      data: {
        vendorId,
        actorId: requestInput.identity!.userId,
        action: 'connect',
        resource: 'ad-account',
        resourceId: String(row.id),
      },
    });
    return row;
  });
  return serviceResult(row, { status: 201, format: 'json' });
}

export async function disconnectAdAccount(requestInput: ServiceContext) {
  requireAdAccountOwner(requestInput);
  const vendorId = requestInput.identity!.vendorId!,
    id = Number(requestInput.params.id);
  await db.$transaction(async (tx) => {
    const row = await tx.adAccounts.findFirst({
      where: { id, vendorId, organizationId: vendorId, deletedAt: null },
    });
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Ad account not found');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`integration:meta-ads:${row.metaAccountId}`},0))`;
    await getActiveAdAccountAccess(tx, requestInput, true);
    await tx.adAccounts.update({
      where: { id },
      data: {
        status: 'disconnected',
        connectionHealth: 'disconnected',
        accessToken: null,
        tokenExpiresAt: null,
        updatedAt: new Date(),
      },
    });
    if (row.metaAccountId)
      await tx.integrationCredentials.deleteMany({
        where: { vendorId, provider: 'meta-ads', externalId: row.metaAccountId },
      });
    await tx.auditEvents.create({
      data: {
        vendorId,
        actorId: requestInput.identity!.userId,
        action: 'disconnect',
        resource: 'ad-account',
        resourceId: String(id),
      },
    });
  });
  return serviceResult(undefined, { status: 204, format: 'empty' });
}
