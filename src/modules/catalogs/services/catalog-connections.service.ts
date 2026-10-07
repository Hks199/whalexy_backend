import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { encrypt, decrypt } from '../../../utils/crypto.js';
import { getFlowAccountContext } from '../../meta-flows/services/meta-flows-support.service.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import {
  requireCatalogOwner,
  getCatalogMembership,
  requestCatalogGraphApi,
  throwCatalogResponseError,
  getConnectedCatalog,
  fetchCatalogGraphPages,
  catalogProviderFields,
  parseCatalogProduct,
} from './catalogs-support.service.js';

export async function listCatalogs(requestInput: ServiceContext) {
  return serviceResult(
    await db.catalogs.findMany({
      where: { vendorId: requestInput.identity!.vendorId!, deletedAt: null },
      select: {
        id: true,
        name: true,
        currency: true,
        status: true,
        metaCatalogId: true,
        syncStatus: true,
        lastSyncedAt: true,
      },
      orderBy: { id: 'asc' },
    }),
    { status: 200, format: 'json' },
  );
}

export async function connectCatalog(requestInput: ServiceContext) {
  requireCatalogOwner(requestInput);
  const vendorId = requestInput.identity!.vendorId!,
    b = requestInput.body,
    { credential: whatsapp, waba } = await getFlowAccountContext(vendorId, b.phoneNumberId),
    token = decrypt(whatsapp.secret);
  await getCatalogMembership(token, b.businessId, waba, b.catalogIdExternal);
  const remote = await requestCatalogGraphApi(token, b.catalogIdExternal, { fields: 'id,name' });
  if (
    remote.id !== b.catalogIdExternal ||
    typeof remote.name !== 'string' ||
    !remote.name ||
    remote.name.length > 255
  )
    throwCatalogResponseError();
  const result = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`catalog-connect:${b.catalogIdExternal}`},0))`;
    if (
      (await tx.catalogConnections.findFirst({
        where: { catalogIdExternal: b.catalogIdExternal, vendorId: { not: vendorId } },
        select: { id: true },
      })) ||
      (await tx.integrationCredentials.findFirst({
        where: {
          provider: 'meta-catalog',
          externalId: b.catalogIdExternal,
          vendorId: { not: vendorId },
        },
        select: { id: true },
      }))
    )
      throw new ApiError(409, 'CATALOG_IN_USE', 'Catalog belongs to another business');
    const fresh = await tx.integrationCredentials.findUnique({ where: { id: whatsapp.id } });
    if (!fresh || fresh.updatedAt.getTime() !== whatsapp.updatedAt.getTime())
      throw new ApiError(
        409,
        'CATALOG_CONNECTION_CHANGED',
        'Sending account changed during catalog verification',
      );
    const prior = await tx.catalogs.findUnique({
      where: { vendorId_metaCatalogId: { vendorId, metaCatalogId: b.catalogIdExternal } },
    });
    if (prior)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`catalog-sync:${prior.id}`},0))`;
    const catalog = await tx.catalogs.upsert({
      where: { vendorId_metaCatalogId: { vendorId, metaCatalogId: b.catalogIdExternal } },
      create: {
        vendorId,
        name: remote.name,
        slug: `meta-${b.catalogIdExternal}`,
        currency: b.currency,
        metaCatalogId: b.catalogIdExternal,
        status: 'active',
        syncStatus: 'connected',
        createdBy: requestInput.identity!.userId,
      },
      update: {
        name: remote.name,
        currency: b.currency,
        status: 'active',
        syncStatus: 'connected',
        deletedAt: null,
        updatedAt: new Date(),
      },
    });
    const credential = await tx.integrationCredentials.upsert({
      where: {
        vendorId_provider_externalId: {
          vendorId,
          provider: 'meta-catalog',
          externalId: b.catalogIdExternal,
        },
      },
      create: {
        vendorId,
        provider: 'meta-catalog',
        externalId: b.catalogIdExternal,
        secret: encrypt(token),
        metadata: { businessId: b.businessId, wabaId: waba, phoneNumberId: b.phoneNumberId },
      },
      update: {
        secret: encrypt(token),
        metadata: { businessId: b.businessId, wabaId: waba, phoneNumberId: b.phoneNumberId },
        updatedAt: new Date(),
      },
    });
    await tx.catalogConnections.upsert({
      where: { catalogId_provider: { catalogId: catalog.id, provider: 'meta' } },
      create: {
        catalogId: catalog.id,
        vendorId,
        businessId: b.businessId,
        catalogIdExternal: b.catalogIdExternal,
        whatsappBusinessAccountId: waba,
        phoneNumberId: b.phoneNumberId,
        accessToken: '',
        meta: { nativeCredentialId: credential.id },
      },
      update: {
        businessId: b.businessId,
        whatsappBusinessAccountId: waba,
        phoneNumberId: b.phoneNumberId,
        accessToken: '',
        meta: { nativeCredentialId: credential.id },
        syncStatus: 'connected',
        connectionHealth: 'healthy',
        deletedAt: null,
        updatedAt: new Date(),
      },
    });
    await tx.auditEvents.create({
      data: {
        vendorId,
        actorId: requestInput.identity!.userId,
        action: 'connect',
        resource: 'catalog',
        resourceId: String(catalog.id),
      },
    });
    return { id: catalog.id, name: catalog.name, externalId: b.catalogIdExternal };
  });
  return serviceResult(result, { status: 201, format: 'json' });
}

export async function syncCatalog(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!,
    catalogId = Number(requestInput.params.catalogId),
    { catalog, connection, credential } = await getConnectedCatalog(vendorId, catalogId),
    token = decrypt(credential.secret);
  const log = await db.catalogSyncLogs.create({
    data: {
      catalogId,
      vendorId,
      operation: 'import-products',
      status: 'processing',
      attempt: 1,
      startedAt: new Date(),
      createdBy: requestInput.identity!.userId,
    },
  });
  try {
    await getCatalogMembership(
      token,
      connection.businessId,
      connection.whatsappBusinessAccountId!,
      connection.catalogIdExternal,
    );
    const rows = await fetchCatalogGraphPages(
        token,
        `${connection.catalogIdExternal}/products`,
        catalogProviderFields,
        requestInput.body.maxPages,
      ),
      items = rows.map(parseCatalogProduct),
      skus = new Set<string>();
    for (const item of items) {
      if (skus.has(item.sku)) throwCatalogResponseError();
      skus.add(item.sku);
    }
    const result = await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`catalog-sync:${catalogId}`},0))`;
        const fresh = await tx.catalogConnections.findUniqueOrThrow({
          where: { id: connection.id },
        });
        if (
          fresh.deletedAt ||
          fresh.syncStatus !== 'connected' ||
          fresh.updatedAt.getTime() !== connection.updatedAt.getTime()
        )
          throw new ApiError(
            409,
            'CATALOG_CONNECTION_CHANGED',
            'Catalog connection changed during synchronization',
          );
        let created = 0,
          updated = 0;
        const at = new Date();
        for (const item of items) {
          const byRemote = await tx.products.findFirst({
              where: { vendorId, metaProductId: item.metaProductId },
            }),
            bySku = await tx.products.findUnique({
              where: { catalogId_sku: { catalogId, sku: item.sku } },
            });
          if (
            (byRemote && (byRemote.catalogId !== catalogId || byRemote.vendorId !== vendorId)) ||
            (bySku &&
              (bySku.vendorId !== vendorId ||
                (bySku.metaProductId && bySku.metaProductId !== item.metaProductId))) ||
            (byRemote && bySku && byRemote.id !== bySku.id)
          )
            throw new ApiError(
              409,
              'CATALOG_PRODUCT_CONFLICT',
              'Product identity needs reconciliation',
            );
          const prior = byRemote ?? bySku,
            data = { ...item, lastSyncedAt: at, updatedAt: at, lastSyncError: null };
          if (prior) {
            await tx.products.update({ where: { id: prior.id }, data });
            updated++;
          } else {
            await tx.products.create({
              data: { ...data, vendorId, catalogId, slug: `meta-${item.metaProductId}` },
            });
            created++;
          }
        }
        const removed = await tx.products.updateMany({
          where: {
            catalogId,
            vendorId,
            metaProductId: { not: null, notIn: items.map((i) => i.metaProductId) },
            status: { not: 'archived' },
          },
          data: {
            status: 'archived',
            visibility: 'hidden',
            availability: 'out_of_stock',
            stockQuantity: 0,
            lastSyncedAt: at,
            updatedAt: at,
          },
        });
        await tx.catalogConnections.update({
          where: { id: connection.id },
          data: {
            lastSyncedAt: at,
            lastHealthCheckAt: at,
            connectionHealth: 'healthy',
            lastError: null,
            updatedAt: at,
          },
        });
        await tx.catalogs.update({
          where: { id: catalog.id },
          data: { lastSyncedAt: at, updatedAt: at },
        });
        const summary = { created, updated, archived: removed.count, products: items.length };
        await tx.catalogSyncLogs.update({
          where: { id: log.id },
          data: { status: 'completed', completedAt: at, responsePayload: summary, updatedAt: at },
        });
        return summary;
      },
      { timeout: 120000 },
    );
    return serviceResult(result, { status: 200, format: 'json' });
  } catch (error) {
    await db.catalogSyncLogs.update({
      where: { id: log.id },
      data: {
        status: 'failed',
        errorCode: error instanceof ApiError ? error.code : 'CATALOG_SYNC_ERROR',
        completedAt: new Date(),
      },
    });
    throw error;
  }
}

export async function disconnectCatalog(requestInput: ServiceContext) {
  requireCatalogOwner(requestInput);
  const vendorId = requestInput.identity!.vendorId!,
    catalogId = Number(requestInput.params.catalogId),
    { connection, credential } = await getConnectedCatalog(vendorId, catalogId);
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`catalog-sync:${catalogId}`},0))`;
    await tx.catalogConnections.update({
      where: { id: connection.id },
      data: {
        syncStatus: 'disconnected',
        connectionHealth: 'disconnected',
        accessToken: '',
        deletedAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await tx.integrationCredentials.delete({ where: { id: credential.id } });
    await tx.catalogs.update({
      where: { id: catalogId },
      data: { syncStatus: 'not_connected', updatedAt: new Date() },
    });
    await tx.auditEvents.create({
      data: {
        vendorId,
        actorId: requestInput.identity!.userId,
        action: 'disconnect',
        resource: 'catalog',
        resourceId: String(catalogId),
      },
    });
  });
  return serviceResult(undefined, { status: 204, format: 'end' });
}
