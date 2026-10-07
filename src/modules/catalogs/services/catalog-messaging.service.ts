import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { decrypt } from '../../../utils/crypto.js';
import { catalogContent } from './catalog-content.js';
import { getConnectedCatalog, fetchCatalogGraphPages } from './catalogs-support.service.js';

export async function catalogMessage(vendorId: number, phone: string, input: any) {
  const { catalog, connection, credential } = await getConnectedCatalog(vendorId, input.catalogId);
  if (connection.phoneNumberId !== phone)
    throw new ApiError(409, 'PHONE_SCOPE_MISMATCH', 'Catalog belongs to another sending number');
  const linked = await fetchCatalogGraphPages(
    decrypt(credential.secret),
    `${connection.whatsappBusinessAccountId}/product_catalogs`,
    'id',
    100,
  );
  if (!linked.some((c) => c.id === connection.catalogIdExternal))
    throw new ApiError(
      409,
      'CATALOG_NOT_LINKED',
      'Catalog is no longer linked to this business account',
    );
  const ids = input.productIds ?? [],
    products = await db.products.findMany({
      where: {
        id: { in: ids },
        catalogId: catalog.id,
        vendorId,
        status: 'active',
        visibility: 'visible',
        deletedAt: null,
        syncStatus: 'completed',
        metaProductId: { not: null },
      },
    });
  if (
    products.length !== ids.length ||
    (input.mode === 'single' && products.length !== 1) ||
    (input.mode === 'multiple' && !products.length)
  )
    throw new ApiError(
      400,
      'INVALID_PRODUCTS',
      'Choose synchronized visible products from this catalog',
    );
  const ordered = ids.map((id: number) => products.find((p) => p.id === id)!);
  return {
    content: catalogContent(connection.catalogIdExternal, input.mode, ordered, input.body),
    guard: {
      catalogId: catalog.id,
      connectionId: connection.id,
      credentialId: credential.id,
      revision: connection.updatedAt.toISOString(),
      products: ordered.map((p: any) => ({
        id: p.id,
        sku: p.sku,
        revision: p.updatedAt.toISOString(),
      })),
    },
  };
}

export async function catalogSendAllowed(vendorId: number, phone: string, input: any) {
  if (!input) return true;
  try {
    const { connection, credential } = await getConnectedCatalog(vendorId, input.catalogId);
    if (
      connection.phoneNumberId !== phone ||
      connection.id !== input.connectionId ||
      credential.id !== input.credentialId ||
      connection.updatedAt.toISOString() !== input.revision
    )
      return false;
    if (input.credentialRevision && credential.updatedAt.toISOString() !== input.credentialRevision)
      return false;
    if (input.phoneCredentialRevision) {
      const current = await db.integrationCredentials.findUnique({
        where: {
          vendorId_provider_externalId: { vendorId, provider: 'whatsapp', externalId: phone },
        },
      });
      if (current?.updatedAt.toISOString() !== input.phoneCredentialRevision) return false;
    }
    if (input.verifyRemoteLink) {
      const linked = await fetchCatalogGraphPages(
        decrypt(credential.secret),
        `${connection.whatsappBusinessAccountId}/product_catalogs`,
        'id',
        100,
      );
      if (!linked.some((c) => c.id === connection.catalogIdExternal)) return false;
      return catalogSendAllowed(vendorId, phone, { ...input, verifyRemoteLink: false });
    }
    for (const p of input.products) {
      if (
        !(await db.products.findFirst({
          where: {
            id: p.id,
            vendorId,
            catalogId: input.catalogId,
            sku: p.sku,
            updatedAt: new Date(p.revision),
            status: 'active',
            visibility: 'visible',
            syncStatus: 'completed',
            deletedAt: null,
          },
        }))
      )
        return false;
    }
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) return false;
    throw error;
  }
}
