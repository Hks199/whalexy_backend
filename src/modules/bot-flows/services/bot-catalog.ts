import type { Contacts, Prisma } from '@prisma/client';
import type { GraphResult } from './graph-types.types.js';
import { ApiError } from '../../../shared/api-error.js';
import { catalogContent } from '../../catalogs/services/catalog-content.js';

export async function graphCatalog(
  tx: Prisma.TransactionClient,
  vendorId: number,
  phoneId: string,
  input: any,
) {
  const catalog = await tx.catalogs.findFirst({
    where: { id: input.catalog_id, vendorId, status: 'active', deletedAt: null },
  });
  const connection = await tx.catalogConnections.findFirst({
    where: {
      catalogId: input.catalog_id,
      vendorId,
      provider: 'meta',
      syncStatus: 'connected',
      deletedAt: null,
    },
  });
  if (
    !catalog ||
    !connection ||
    connection.phoneNumberId !== phoneId ||
    !(connection.meta as any)?.nativeCredentialId ||
    catalog.metaCatalogId !== connection.catalogIdExternal
  )
    throw new ApiError(
      409,
      'GRAPH_CATALOG_UNAVAILABLE',
      'An owned native catalog connected to the sending number is required',
    );
  const credential = await tx.integrationCredentials.findFirst({
    where: {
      id: (connection.meta as any).nativeCredentialId,
      vendorId,
      provider: 'meta-catalog',
      externalId: connection.catalogIdExternal,
    },
  });
  const phone = await tx.integrationCredentials.findUnique({
    where: {
      vendorId_provider_externalId: { vendorId, provider: 'whatsapp', externalId: phoneId },
    },
  });
  if (
    !credential ||
    !phone ||
    (phone.metadata as any)?.wabaId !== connection.whatsappBusinessAccountId
  )
    throw new ApiError(
      409,
      'GRAPH_CATALOG_UNAVAILABLE',
      'Catalog credentials or sending account changed',
    );
  const ids: number[] = input.product_ids ?? [];
  const products = await tx.products.findMany({
    where: {
      id: { in: ids },
      vendorId,
      catalogId: catalog.id,
      status: 'active',
      visibility: 'visible',
      deletedAt: null,
      syncStatus: 'completed',
      metaProductId: { not: null },
    },
  });
  if (products.length !== ids.length || products.some((p) => !p.sku.trim()))
    throw new ApiError(
      409,
      'GRAPH_CATALOG_PRODUCTS_UNAVAILABLE',
      'Selected products must be owned, visible and synchronized',
    );
  const ordered = ids.map((id) => products.find((p) => p.id === id)!);
  return {
    content: catalogContent(connection.catalogIdExternal, input.mode, ordered, input.body),
    guard: {
      catalogId: catalog.id,
      connectionId: connection.id,
      credentialId: credential.id,
      revision: connection.updatedAt.toISOString(),
      credentialRevision: credential.updatedAt.toISOString(),
      phoneCredentialRevision: phone.updatedAt.toISOString(),
      verifyRemoteLink: true,
      products: ordered.map((p) => ({ id: p.id, sku: p.sku, revision: p.updatedAt.toISOString() })),
    },
  };
}
export async function prepareGraphCatalogs(
  tx: Prisma.TransactionClient,
  contact: Contacts,
  phoneId: string,
  result: GraphResult,
): Promise<GraphResult> {
  const messages = [];
  for (const message of result.messages) {
    if (!message.graphCatalog) {
      messages.push(message);
      continue;
    }
    const built = await graphCatalog(tx, contact.vendorId, phoneId, message.graphCatalog);
    messages.push({ nodeId: message.nodeId, nativeCatalog: built.guard, ...built.content });
  }
  return { ...result, messages };
}
