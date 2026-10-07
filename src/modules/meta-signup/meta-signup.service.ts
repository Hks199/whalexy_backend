import { randomUUID } from 'node:crypto';
import { db } from '../../database/client.js';
import { opaqueToken, digest, encrypt } from '../../utils/crypto.js';
import { ApiError } from '../../shared/api-error.js';
import { providerRequest } from '../../infrastructure/providers/meta.client.js';
import { config } from '../../config/environment.js';
import { metaOperation } from '../../infrastructure/providers/meta-operations.js';
import { numeric } from './meta-signup.validation.js';
import { serviceResult, type ServiceContext } from '../../shared/service-context.js';
import { headerValue } from '../../utils/headers.js';

export function owner(req: ServiceContext) {
  if (req.identity!.role !== 'owner' || req.identity!.apiKeyId)
    throw new ApiError(403, 'FORBIDDEN', 'Only the business owner can complete signup');
}
export function settings() {
  const appId = process.env.META_APP_ID,
    secret = process.env.META_APP_SECRET,
    configId = process.env.META_SIGNUP_CONFIG_ID;
  if (
    !appId ||
    !secret ||
    !configId ||
    numeric.validate(appId).error ||
    numeric.validate(configId).error
  )
    throw new ApiError(
      503,
      'META_SIGNUP_NOT_CONFIGURED',
      'Meta signup needs app and login configuration',
    );
  return {
    appId,
    secret,
    configId,
    redirectUri: `${config.PUBLIC_URL.replace(/\/$/, '')}/integrations/meta/callback`,
  };
}
export async function graph(
  path: string,
  token?: string,
  query?: Record<string, string>,
  body?: Record<string, string>,
) {
  const url = new URL(`https://graph.facebook.com/${config.META_GRAPH_VERSION}/${path}`);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return providerRequest(url, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    ...(body ? { body: new URLSearchParams(body).toString() } : {}),
  });
}
export async function startMetaSignup(requestInput: ServiceContext) {
  owner(requestInput);
  const s = settings(),
    state = opaqueToken(),
    vendorId = requestInput.identity!.vendorId!;
  await db.nativeIdempotency.create({
    data: {
      vendorId,
      key: `meta-signup:${digest(state)}`,
      requestHash: digest(
        `${vendorId}:${requestInput.identity!.userId}:${requestInput.identity!.sessionId}`,
      ),
      response: {
        stage: 'issued',
        actorId: requestInput.identity!.userId,
        sessionId: requestInput.identity!.sessionId,
        expiresAt: Date.now() + 600000,
      },
    },
  });
  const url = new URL(`https://www.facebook.com/${config.META_GRAPH_VERSION}/dialog/oauth`);
  for (const [k, v] of Object.entries({
    client_id: s.appId,
    config_id: s.configId,
    redirect_uri: s.redirectUri,
    response_type: 'code',
    override_default_response_type: 'true',
    state,
    scope: 'whatsapp_business_management,whatsapp_business_messaging',
    extras: JSON.stringify({ setup: {}, featureType: '', sessionInfoVersion: '3' }),
  }))
    url.searchParams.set(k, v);
  return serviceResult(
    {
      state,
      authorizationUrl: url.href,
      appId: s.appId,
      configId: s.configId,
      redirectUri: s.redirectUri,
      expiresIn: 600,
    },
    { status: 201, format: 'json' },
  );
}
export async function completeMetaSignup(requestInput: ServiceContext) {
  owner(requestInput);
  const s = settings(),
    vendorId = requestInput.identity!.vendorId!,
    b = requestInput.body,
    key = `meta-signup:${digest(b.state)}`;
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(headerValue(requestInput.headers, 'Idempotency-Key') ?? ''))
    throw new ApiError(400, 'IDEMPOTENCY_REQUIRED', 'A valid Idempotency-Key is required');
  // Validate/consume state before exchanging the single-use provider code.
  const intent = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`;
    const row = await tx.nativeIdempotency.findUnique({
        where: { vendorId_key: { vendorId, key } },
      }),
      v = row?.response as any;
    if (
      !row ||
      v.stage !== 'issued' ||
      v.expiresAt < Date.now() ||
      v.actorId !== requestInput.identity!.userId ||
      v.sessionId !== requestInput.identity!.sessionId
    )
      throw new ApiError(
        401,
        'INVALID_OAUTH_STATE',
        'Signup state is expired, consumed or belongs to another session',
      );
    await tx.nativeIdempotency.update({
      where: { id: row.id },
      data: { response: { ...v, stage: 'processing' } },
    });
    return row;
  });
  try {
    const exchange = await graph('oauth/access_token', undefined, {
      client_id: s.appId,
      client_secret: s.secret,
      redirect_uri: s.redirectUri,
      code: b.code,
    });
    if (
      typeof exchange.access_token !== 'string' ||
      exchange.access_token.length < 20 ||
      exchange.access_token.length > 4096
    )
      throw new ApiError(502, 'PROVIDER_RESPONSE', 'Meta did not return a valid access token');
    const token = exchange.access_token;
    const debug = (await graph('debug_token', `${s.appId}|${s.secret}`, { input_token: token }))
      .data;
    const scopes = new Set([
      ...(Array.isArray(debug?.scopes) ? debug.scopes : []),
      ...(Array.isArray(debug?.granular_scopes)
        ? debug.granular_scopes.map((v: any) => v.scope)
        : []),
    ]);
    if (
      debug?.is_valid !== true ||
      String(debug.app_id) !== s.appId ||
      !['whatsapp_business_management', 'whatsapp_business_messaging'].every((p) =>
        scopes.has(p),
      ) ||
      (debug.expires_at &&
        (!Number.isSafeInteger(debug.expires_at) || debug.expires_at <= Date.now() / 1000))
    )
      throw new ApiError(
        403,
        'META_TOKEN_PERMISSION',
        'The provider token is invalid or missing required permissions',
      );
    const seen = new Set<string>();
    let after: string | undefined,
      found = false;
    for (let page = 0; page < 100; page++) {
      const result = await graph(`${b.wabaId}/phone_numbers`, token, {
        fields: 'id',
        limit: '100',
        ...(after ? { after } : {}),
      });
      if (!Array.isArray(result.data))
        throw new ApiError(502, 'PROVIDER_RESPONSE', 'Invalid business phone list');
      if (result.data.some((v: any) => v.id === b.phoneNumberId)) {
        found = true;
        break;
      }
      if (!result.paging?.next) break;
      after = result.paging?.cursors?.after;
      if (typeof after !== 'string' || !after || after.length > 4096 || seen.has(after))
        throw new ApiError(502, 'PROVIDER_PAGINATION', 'Invalid business phone pagination');
      seen.add(after);
    }
    if (!found)
      throw new ApiError(
        403,
        'ACCOUNT_OWNER_MISMATCH',
        'The selected number does not belong to this business account',
      );
    // Reserve global phone ownership before any registration/subscription mutation.
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`integration:whatsapp:${b.phoneNumberId}`},0))`;
      const connection = await tx.whatsappOnboardingConnections.findUnique({
        where: { phoneNumberId: b.phoneNumberId },
      });
      if (
        (connection && connection.vendorId !== vendorId) ||
        (await tx.integrationCredentials.findFirst({
          where: { provider: 'whatsapp', externalId: b.phoneNumberId, vendorId: { not: vendorId } },
        }))
      )
        throw new ApiError(409, 'ACCOUNT_IN_USE', 'The number belongs to another business');
      const existingCredential = await tx.integrationCredentials.findUnique({
          where: {
            vendorId_provider_externalId: {
              vendorId,
              provider: 'whatsapp',
              externalId: b.phoneNumberId,
            },
          },
        }),
        existingMetadata = existingCredential?.metadata as any;
      if (existingMetadata?.flowEncryption && existingMetadata.wabaId !== b.wabaId)
        throw new ApiError(
          409,
          'FLOW_ACCOUNT_CHANGED',
          'Reconnect this number with its existing business account',
        );
      if (!connection)
        await tx.whatsappOnboardingConnections.create({
          data: {
            onboardingId: randomUUID(),
            vendorId,
            wabaId: b.wabaId,
            phoneNumberId: b.phoneNumberId,
            status: 'TOKEN_VERIFIED',
          },
        });
      await tx.nativeIdempotency.update({
        where: { id: intent.id },
        data: {
          response: {
            stage: 'token-verified',
            phoneNumberId: b.phoneNumberId,
            wabaId: b.wabaId,
            envelope: encrypt(token),
          },
        },
      });
    });
    const result = await metaOperation(
      requestInput,
      `signup:${b.phoneNumberId}`,
      { action: 'connect', intentId: intent.id, wabaId: b.wabaId, phoneNumberId: b.phoneNumberId },
      async (effect) => {
        const subscribed = await effect(() =>
          graph(`${b.wabaId}/subscribed_apps`, token, undefined, {}),
        );
        if (subscribed.success !== true)
          throw new ApiError(502, 'PROVIDER_RESPONSE', 'Meta did not confirm webhook subscription');
        const registered = await effect(() =>
          graph(`${b.phoneNumberId}/register`, token, undefined, {
            messaging_product: 'whatsapp',
            pin: b.pin,
          }),
        );
        if (registered.success !== true)
          throw new ApiError(502, 'PROVIDER_RESPONSE', 'Meta did not confirm number registration');
        return { phoneNumberId: b.phoneNumberId, wabaId: b.wabaId, status: 'CONNECTED' };
      },
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`integration:whatsapp:${b.phoneNumberId}`},0))`;
        const existingCredential = await tx.integrationCredentials.findUnique({
            where: {
              vendorId_provider_externalId: {
                vendorId,
                provider: 'whatsapp',
                externalId: b.phoneNumberId,
              },
            },
          }),
          metadata = (existingCredential?.metadata as any) ?? {};
        if (metadata.flowEncryption && metadata.wabaId !== b.wabaId)
          throw new ApiError(
            409,
            'FLOW_ACCOUNT_CHANGED',
            'Reconnect this number with its existing business account',
          );
        await tx.integrationCredentials.upsert({
          where: {
            vendorId_provider_externalId: {
              vendorId,
              provider: 'whatsapp',
              externalId: b.phoneNumberId,
            },
          },
          create: {
            vendorId,
            provider: 'whatsapp',
            externalId: b.phoneNumberId,
            secret: encrypt(token),
            metadata: { wabaId: b.wabaId, onboarding: 'embedded' },
          },
          update: {
            secret: encrypt(token),
            metadata: { ...metadata, wabaId: b.wabaId, onboarding: 'embedded' },
            updatedAt: new Date(),
          },
        });
        await tx.whatsappOnboardingConnections.update({
          where: { phoneNumberId: b.phoneNumberId },
          data: {
            wabaId: b.wabaId,
            status: 'CONNECTED',
            connectedAt: new Date(),
            updatedAt: new Date(),
          },
        });
        await tx.nativeIdempotency.update({
          where: { id: intent.id },
          data: {
            response: { stage: 'complete', phoneNumberId: b.phoneNumberId, wabaId: b.wabaId },
          },
        });
      },
    );
    return serviceResult(result, { status: 201, format: 'json' });
  } catch (error) {
    // Preserve a verified encrypted token for reconciliation; never expose it.
    const row = await db.nativeIdempotency.findUniqueOrThrow({ where: { id: intent.id } });
    await db.nativeIdempotency.update({
      where: { id: intent.id },
      data: {
        response: {
          ...(row.response as any),
          stage: 'failed',
          code: error instanceof ApiError ? error.code : 'META_SIGNUP_ERROR',
        },
      },
    });
    throw error;
  }
}
