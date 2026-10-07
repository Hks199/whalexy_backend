import { randomUUID } from 'node:crypto';
import { db } from '../../database/client.js';
import { encrypt } from '../../utils/crypto.js';
import { ApiError } from '../../shared/api-error.js';
import { config } from '../../config/environment.js';
import { providerRequest, metaRequest } from '../../infrastructure/providers/meta.client.js';
import { serviceResult, type ServiceContext } from '../../shared/service-context.js';

export async function syncTemplates(
  vendorId: number,
  phoneNumberId: string,
  wabaId: string,
  maxPages = 10,
  after?: string,
) {
  let count = 0,
    pages = 0;
  const seen = new Set<string>();
  if (after) seen.add(after);
  while (pages < maxPages) {
    // Ignore paging.next URLs: use only a bounded cursor on the fixed Graph host.
    const result = await metaRequest(
      vendorId,
      'whatsapp',
      phoneNumberId,
      `${wabaId}/message_templates`,
      'GET',
      undefined,
      { limit: '100', ...(after ? { after } : {}) },
    );
    if (!Array.isArray(result.data))
      throw new ApiError(502, 'PROVIDER_RESPONSE', 'Invalid template list');
    for (const t of result.data) {
      if (typeof t.id !== 'string' || typeof t.name !== 'string' || typeof t.language !== 'string')
        continue;
      const existing = await db.whatsappTemplates.findFirst({
        where: { vendorId, templateId: t.id },
      });
      const data = {
        templateName: t.name,
        templateId: t.id,
        languageCode: t.language,
        status: t.status ?? 'UNKNOWN',
        category: t.category ?? null,
        data: { components: t.components ?? [] },
      };
      if (existing) await db.whatsappTemplates.update({ where: { id: existing.id }, data });
      else await db.whatsappTemplates.create({ data: { vendorId, ...data } });
      count++;
    }
    pages++;
    if (!result.paging?.next) return { synced: count, pages, hasMore: false, nextCursor: null };
    const cursor = result.paging?.cursors?.after;
    if (typeof cursor !== 'string' || !cursor.length || cursor.length > 4096 || seen.has(cursor))
      throw new ApiError(
        502,
        'PROVIDER_PAGINATION',
        'Template pagination returned an invalid or repeated cursor',
      );
    seen.add(cursor);
    after = cursor;
  }
  return { synced: count, pages, hasMore: true, nextCursor: after };
}
export async function listIntegrations(requestInput: ServiceContext) {
  return serviceResult(
    await db.integrationCredentials.findMany({
      where: { vendorId: requestInput.identity!.vendorId! },
      select: { id: true, provider: true, externalId: true, createdAt: true, updatedAt: true },
    }),
    { status: 200, format: 'json' },
  );
}
export async function connectMetaIntegration(requestInput: ServiceContext) {
  const { provider, externalId, accessToken, wabaId } = requestInput.body,
    vendorId = requestInput.identity!.vendorId!;
  if (requestInput.identity!.role !== 'owner')
    throw new ApiError(403, 'FORBIDDEN', 'Only the owner can connect messaging accounts');
  const remote = await providerRequest(
    new URL(`https://graph.facebook.com/${config.META_GRAPH_VERSION}/${externalId}?fields=id`),
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (remote.id !== externalId)
    throw new ApiError(400, 'INVALID_ACCOUNT', 'Provider account could not be verified');
  const existing = await db.integrationCredentials.findFirst({
    where: { provider, externalId, vendorId: { not: vendorId } },
  });
  if (existing)
    throw new ApiError(409, 'ACCOUNT_IN_USE', 'Account is already connected to another business');
  const row = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`integration:${provider}:${externalId}`},0))`;
    if (
      await tx.integrationCredentials.findFirst({
        where: { provider, externalId, vendorId: { not: vendorId } },
        select: { id: true },
      })
    )
      throw new ApiError(409, 'ACCOUNT_IN_USE', 'Account is already connected to another business');
    const prior =
      provider === 'whatsapp'
        ? await tx.whatsappOnboardingConnections.findUnique({
            where: { phoneNumberId: externalId },
          })
        : null;
    if (prior && prior.vendorId !== vendorId)
      throw new ApiError(409, 'ACCOUNT_IN_USE', 'Onboarding account belongs to another business');
    const existingCredential = await tx.integrationCredentials.findUnique({
      where: { vendorId_provider_externalId: { vendorId, provider, externalId } },
    });
    const existingMetadata = (existingCredential?.metadata as any) ?? {};
    if (existingMetadata.flowEncryption && existingMetadata.wabaId !== (wabaId ?? null))
      throw new ApiError(
        409,
        'FLOW_ACCOUNT_CHANGED',
        'Reconnect this number with its existing business account',
      );
    const row = await tx.integrationCredentials.upsert({
      where: { vendorId_provider_externalId: { vendorId, provider, externalId } },
      create: {
        vendorId,
        provider,
        externalId,
        secret: encrypt(accessToken),
        metadata: { wabaId: wabaId ?? null },
      },
      update: {
        secret: encrypt(accessToken),
        metadata: { ...existingMetadata, wabaId: wabaId ?? null },
        updatedAt: new Date(),
      },
    });
    if (provider === 'whatsapp' && wabaId)
      await tx.whatsappOnboardingConnections.upsert({
        where: { phoneNumberId: externalId },
        create: {
          onboardingId: randomUUID(),
          vendorId,
          wabaId,
          phoneNumberId: externalId,
          status: 'CONNECTED',
          connectedAt: new Date(),
        },
        update: { wabaId, status: 'CONNECTED', connectedAt: new Date(), updatedAt: new Date() },
      });
    await tx.auditEvents.create({
      data: {
        vendorId,
        actorId: requestInput.identity!.userId,
        action: 'connect',
        resource: 'integration',
        resourceId: row.id,
      },
    });
    return row;
  });
  return serviceResult({ id: row.id, provider, externalId }, { status: 201, format: 'json' });
}
export async function disconnectIntegration(requestInput: ServiceContext) {
  if (requestInput.identity!.role !== 'owner')
    throw new ApiError(403, 'FORBIDDEN', 'Only the owner can disconnect an account');
  const row = await db.integrationCredentials.findFirst({
    where: { id: String(requestInput.params.id), vendorId: requestInput.identity!.vendorId! },
  });
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Integration not found');
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`integration:${row.provider}:${row.externalId}`},0))`;
    const fresh = await tx.integrationCredentials.findUnique({ where: { id: row.id } });
    if ((fresh?.metadata as any)?.flowEncryption?.pending)
      throw new ApiError(
        409,
        'FLOW_KEY_PENDING',
        'Reconcile pending Flow key registration before disconnecting',
      );
    await tx.integrationCredentials.delete({ where: { id: row.id } });
    if (row.provider === 'whatsapp')
      await tx.whatsappOnboardingConnections.updateMany({
        where: { vendorId: row.vendorId, phoneNumberId: row.externalId },
        data: { status: 'DISCONNECTED', updatedAt: new Date() },
      });
    const integrationId = (row.metadata as any)?.integrationId;
    if (Number.isSafeInteger(integrationId)) {
      if (row.provider === 'shopify')
        await tx.shopifyIntegrations.updateMany({
          where: { id: integrationId, vendorId: row.vendorId },
          data: { isActive: false, updatedAt: new Date() },
        });
      if (row.provider === 'woocommerce')
        await tx.woocommerceIntegrations.updateMany({
          where: { id: integrationId, vendorId: row.vendorId },
          data: { isActive: false, disconnectedAt: new Date(), updatedAt: new Date() },
        });
    }
    await tx.auditEvents.create({
      data: {
        vendorId: row.vendorId,
        actorId: requestInput.identity!.userId,
        action: 'disconnect',
        resource: 'integration',
        resourceId: row.id,
      },
    });
  });
  return serviceResult(undefined, { status: 204, format: 'end' });
}
export async function connectStoreIntegration(requestInput: ServiceContext) {
  if (requestInput.identity!.role !== 'owner')
    throw new ApiError(403, 'FORBIDDEN', 'Only the owner can connect a store');
  const { provider, externalId, webhookSecret, integrationId } = requestInput.body,
    vendorId = requestInput.identity!.vendorId!;
  const row = await db.$transaction(async (tx) => {
    let metadata: Record<string, number> | undefined;
    if (integrationId) {
      const integration =
        provider === 'shopify'
          ? await tx.shopifyIntegrations.findFirst({
              where: { id: integrationId, vendorId, isActive: true, shopDomain: externalId },
            })
          : await tx.woocommerceIntegrations.findFirst({
              where: { id: integrationId, vendorId, isActive: true },
            });
      if (
        !integration ||
        (provider === 'woocommerce' &&
          new URL((integration as any).siteUrl).hostname !== externalId)
      )
        throw new ApiError(
          400,
          'INVALID_STORE_REFERENCE',
          'Integration does not match this active business store',
        );
      metadata = { integrationId };
    }
    const existing = await tx.integrationCredentials.findUnique({
      where: { vendorId_provider_externalId: { vendorId, provider, externalId } },
    });
    return tx.integrationCredentials.upsert({
      where: { vendorId_provider_externalId: { vendorId, provider, externalId } },
      create: {
        vendorId,
        provider,
        externalId,
        secret: encrypt(webhookSecret),
        ...(metadata ? { metadata } : {}),
      },
      update: {
        secret: encrypt(webhookSecret),
        ...(metadata ? { metadata: { ...((existing?.metadata as any) ?? {}), ...metadata } } : {}),
        updatedAt: new Date(),
      },
    });
  });
  return serviceResult({ id: row.id, provider, externalId }, { status: 201, format: 'json' });
}
export async function syncMessageTemplates(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!,
    { phoneNumberId, wabaId } = requestInput.body;
  const connection = await db.whatsappOnboardingConnections.findFirst({
    where: { vendorId, phoneNumberId, wabaId },
  });
  if (!connection) throw new ApiError(404, 'NOT_FOUND', 'Connected number not found');
  const result = await syncTemplates(
    vendorId,
    phoneNumberId,
    wabaId,
    requestInput.body.maxPages,
    requestInput.body.after,
  );
  return serviceResult(result, { status: result.hasMore ? 206 : 200, format: 'json' });
}
