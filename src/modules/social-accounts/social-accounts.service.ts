import { db } from '../../database/client.js';
import { config } from '../../config/environment.js';
import { digest, encrypt, decrypt } from '../../utils/crypto.js';
import { ApiError } from '../../shared/api-error.js';
import { providerRequest } from '../../infrastructure/providers/meta.client.js';
import { serviceResult, type ServiceContext } from '../../shared/service-context.js';

export async function verifiedSocial(vendorId: number, platform: string, account: string) {
  const rows = await db.integrationCredentials.findMany({
    where: { provider: platform, externalId: account },
    take: 2,
  });
  if (rows.length !== 1 || rows[0].vendorId !== vendorId)
    throw new ApiError(
      409,
      'SOCIAL_ACCOUNT_AMBIGUOUS',
      'Social account must have one verified business owner',
    );
  const credential = rows[0],
    proof = (credential.metadata as any)?.nativeSocial;
  if (
    proof?.version !== 1 ||
    proof.platform !== platform ||
    proof.accountId !== account ||
    proof.appId !== process.env.META_APP_ID ||
    proof.tokenHash !== digest(decrypt(credential.secret)) ||
    (proof.expiresAt && proof.expiresAt <= Date.now())
  )
    throw new ApiError(
      503,
      'SOCIAL_ACCOUNT_NOT_CONFIGURED',
      'Verify the current social account token and permissions',
    );
  return { credential, proof };
}
export async function connectSocialAccount(requestInput: ServiceContext) {
  if (requestInput.identity!.role !== 'owner' || requestInput.identity!.apiKeyId)
    throw new ApiError(403, 'FORBIDDEN', 'Only the business owner can verify social accounts');
  const appId = process.env.META_APP_ID,
    secret = process.env.META_APP_SECRET;
  if (!appId || !/^\d{5,100}$/.test(appId) || !secret)
    throw new ApiError(503, 'SOCIAL_APP_NOT_CONFIGURED', 'Configure the Meta app ID and secret');
  const b = requestInput.body,
    vendorId = requestInput.identity!.vendorId!,
    url = new URL(`https://graph.facebook.com/${config.META_GRAPH_VERSION}/debug_token`);
  url.searchParams.set('input_token', b.accessToken);
  const debug = (
    await providerRequest(url, { headers: { Authorization: `Bearer ${appId}|${secret}` } })
  ).data;
  const required =
    b.platform === 'facebook'
      ? [
          'pages_messaging',
          'pages_read_engagement',
          'pages_manage_metadata',
          'pages_manage_engagement',
        ]
      : [
          'instagram_basic',
          'instagram_manage_comments',
          'instagram_manage_messages',
          'pages_messaging',
          'pages_read_engagement',
          'pages_manage_metadata',
        ];
  const scopes = new Set([
      ...(Array.isArray(debug?.scopes) ? debug.scopes : []),
      ...(Array.isArray(debug?.granular_scopes)
        ? debug.granular_scopes.map((v: any) => v.scope)
        : []),
    ]),
    expiry = [debug?.expires_at, debug?.data_access_expires_at].filter(
      (v: any) => v !== undefined && v !== 0,
    );
  if (
    debug?.is_valid !== true ||
    String(debug.app_id) !== appId ||
    debug.type !== 'PAGE' ||
    !required.every((s) => scopes.has(s)) ||
    expiry.some((v: any) => !Number.isSafeInteger(v) || v <= Date.now() / 1000 + 30)
  )
    throw new ApiError(
      403,
      'SOCIAL_TOKEN_PERMISSION',
      'A current Page token for this app with required social permissions is needed',
    );
  for (const grant of Array.isArray(debug.granular_scopes) ? debug.granular_scopes : [])
    if (
      required.includes(grant.scope) &&
      Array.isArray(grant.target_ids) &&
      !grant.target_ids.some((id: any) => String(id) === b.pageId || String(id) === b.accountId)
    )
      throw new ApiError(
        403,
        'SOCIAL_TOKEN_PERMISSION',
        'Required permissions are granted to another account',
      );
  const meUrl = new URL(`https://graph.facebook.com/${config.META_GRAPH_VERSION}/me`);
  meUrl.searchParams.set(
    'fields',
    b.platform === 'instagram' ? 'id,instagram_business_account' : 'id',
  );
  const me = await providerRequest(meUrl, {
    headers: { Authorization: `Bearer ${b.accessToken}` },
  });
  if (
    me.id !== b.pageId ||
    (b.platform === 'facebook' && b.accountId !== b.pageId) ||
    (b.platform === 'instagram' && me.instagram_business_account?.id !== b.accountId)
  )
    throw new ApiError(
      403,
      'SOCIAL_ACCOUNT_OWNER',
      'The token does not act for the selected Page and Instagram account',
    );
  const proof = {
    version: 1,
    platform: b.platform,
    accountId: b.accountId,
    pageId: b.pageId,
    appId,
    tokenHash: digest(b.accessToken),
    expiresAt: expiry.length ? Math.min(...expiry) * 1000 : null,
    verifiedAt: new Date().toISOString(),
    actorId: requestInput.identity!.userId,
  };
  const row = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`integration:${b.platform}:${b.accountId}`},0))`;
    if (
      await tx.integrationCredentials.findFirst({
        where: { provider: b.platform, externalId: b.accountId, vendorId: { not: vendorId } },
        select: { id: true },
      })
    )
      throw new ApiError(409, 'ACCOUNT_IN_USE', 'Account is connected to another business');
    const row = await tx.integrationCredentials.upsert({
      where: {
        vendorId_provider_externalId: { vendorId, provider: b.platform, externalId: b.accountId },
      },
      create: {
        vendorId,
        provider: b.platform,
        externalId: b.accountId,
        secret: encrypt(b.accessToken),
        metadata: { nativeSocial: proof },
      },
      update: {
        secret: encrypt(b.accessToken),
        metadata: { nativeSocial: proof },
        updatedAt: new Date(),
      },
    });
    await tx.auditEvents.create({
      data: {
        vendorId,
        actorId: requestInput.identity!.userId,
        action: 'verify-social-account',
        resource: 'integration',
        resourceId: row.id,
      },
    });
    return row;
  });
  return serviceResult(
    {
      id: row.id,
      platform: b.platform,
      accountId: b.accountId,
      pageId: b.pageId,
      verified: true,
      expiresAt: proof.expiresAt,
    },
    { status: 201, format: 'json' },
  );
}
