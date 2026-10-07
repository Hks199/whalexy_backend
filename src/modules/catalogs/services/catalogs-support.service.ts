import { Prisma } from '@prisma/client';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { providerRequest } from '../../../infrastructure/providers/meta.client.js';
import { config } from '../../../config/environment.js';
import { numeric } from '../catalogs.validation.js';
import { type ServiceContext } from '../../../shared/service-context.js';

export const catalogProviderFields =
  'id,retailer_id,name,description,availability,condition,price,currency,image_url,url,brand';

export function throwCatalogResponseError(): never {
  throw new ApiError(502, 'PROVIDER_RESPONSE', 'Invalid Meta catalog response');
}

export function requireCatalogOwner(req: ServiceContext) {
  if (req.identity!.role !== 'owner' || req.identity!.apiKeyId)
    throw new ApiError(403, 'FORBIDDEN', 'Only the business owner can connect catalogs');
}

export async function requestCatalogGraphApi(
  token: string,
  path: string,
  query: Record<string, string> = {},
  body?: Record<string, string>,
) {
  const url = new URL(`https://graph.facebook.com/${config.META_GRAPH_VERSION}/${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return providerRequest(url, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    ...(body ? { body: new URLSearchParams(body).toString() } : {}),
  });
}

export async function fetchCatalogGraphPages(
  token: string,
  path: string,
  selected: string,
  maxPages = 50,
) {
  const all: any[] = [],
    seen = new Set<string>(),
    ids = new Set<string>();
  let after: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const result = await requestCatalogGraphApi(token, path, {
      fields: selected,
      limit: '100',
      ...(after ? { after } : {}),
    });
    if (!Array.isArray(result.data) || result.data.length > 100 || result.error)
      throwCatalogResponseError();
    for (const item of result.data) {
      if (numeric.validate(item?.id, { convert: false }).error || ids.has(item.id))
        throwCatalogResponseError();
      ids.add(item.id);
      all.push(item);
    }
    if (!result.paging?.next) return all;
    after = result.paging?.cursors?.after;
    if (typeof after !== 'string' || !after || after.length > 4096 || seen.has(after))
      throw new ApiError(502, 'PROVIDER_PAGINATION', 'Invalid or repeated catalog cursor');
    seen.add(after);
  }
  // Never archive absent products from a truncated snapshot.
  throw new ApiError(
    409,
    'CATALOG_SNAPSHOT_INCOMPLETE',
    'Catalog exceeds the bounded complete snapshot; existing products were retained',
  );
}

export async function getCatalogMembership(
  token: string,
  businessId: string,
  waba: string,
  externalId: string,
) {
  const owned = await fetchCatalogGraphPages(
    token,
    `${businessId}/owned_product_catalogs`,
    'id',
    100,
  );
  if (!owned.some((c) => c.id === externalId))
    throw new ApiError(
      403,
      'CATALOG_OWNER_MISMATCH',
      'Catalog is not owned by the configured business',
    );
  const linked = await fetchCatalogGraphPages(token, `${waba}/product_catalogs`, 'id', 100);
  if (!linked.some((c) => c.id === externalId))
    throw new ApiError(
      409,
      'CATALOG_NOT_LINKED',
      'Link this catalog to the connected WhatsApp business account first',
    );
}

export async function getConnectedCatalog(vendorId: number, catalogId: number) {
  const catalog = await db.catalogs.findFirst({
      where: { id: catalogId, vendorId, status: 'active', deletedAt: null },
    }),
    connection = await db.catalogConnections.findFirst({
      where: { catalogId, vendorId, provider: 'meta', deletedAt: null, syncStatus: 'connected' },
    });
  if (
    !catalog ||
    !connection ||
    !(connection.meta as any)?.nativeCredentialId ||
    !connection.phoneNumberId
  )
    throw new ApiError(404, 'CATALOG_NOT_CONNECTED', 'Owned native catalog connection not found');
  const credential = await db.integrationCredentials.findFirst({
    where: {
      id: (connection.meta as any).nativeCredentialId,
      vendorId,
      provider: 'meta-catalog',
      externalId: connection.catalogIdExternal,
    },
  });
  const whatsapp = await db.integrationCredentials.findUnique({
    where: {
      vendorId_provider_externalId: {
        vendorId,
        provider: 'whatsapp',
        externalId: connection.phoneNumberId,
      },
    },
  });
  if (
    !credential ||
    !whatsapp ||
    (whatsapp.metadata as any)?.wabaId !== connection.whatsappBusinessAccountId
  )
    throw new ApiError(409, 'CATALOG_CONNECTION_CHANGED', 'Catalog sending account changed');
  return { catalog, connection, credential };
}

export function parseCatalogPrice(value: any, currency: string) {
  // Graph price formats vary. Accept explicit major-unit decimals only, retaining
  // ambiguous integer/symbol formats for reconciliation rather than guessing.
  if (
    typeof value !== 'string' ||
    !/^\d{1,14}\.\d{1,4}(?: [A-Z]{3})?$/.test(value) ||
    (value.includes(' ') && !value.endsWith(` ${currency}`))
  )
    throwCatalogResponseError();
  return new Prisma.Decimal(value.split(' ')[0]);
}

export function parseCatalogProduct(row: any) {
  if (
    typeof row.retailer_id !== 'string' ||
    !row.retailer_id.trim() ||
    row.retailer_id.length > 100 ||
    typeof row.name !== 'string' ||
    !row.name ||
    row.name.length > 255 ||
    typeof row.currency !== 'string' ||
    !/^[A-Z]{3}$/.test(row.currency) ||
    (row.description != null &&
      (typeof row.description !== 'string' || row.description.length > 10000))
  )
    throwCatalogResponseError();
  const availability: Record<string, string> = {
    'in stock': 'in_stock',
    'out of stock': 'out_of_stock',
    preorder: 'preorder',
    'available for order': 'available_for_order',
    discontinued: 'discontinued',
  };
  if (!availability[row.availability] || !['new', 'used', 'refurbished'].includes(row.condition))
    throwCatalogResponseError();
  for (const value of [row.url, row.image_url])
    if (value != null) {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        throwCatalogResponseError();
      }
      if (url!.protocol !== 'https:' || url!.username || url!.password) throwCatalogResponseError();
    }
  if (row.brand != null && (typeof row.brand !== 'string' || row.brand.length > 255))
    throwCatalogResponseError();
  return {
    name: row.name,
    sku: row.retailer_id,
    description: row.description ?? null,
    price: parseCatalogPrice(row.price, row.currency),
    currency: row.currency,
    availability: availability[row.availability],
    condition: row.condition,
    stockQuantity: row.availability === 'in stock' ? 1 : 0,
    customUrl: row.url ?? null,
    primaryImageUrl: row.image_url ?? null,
    metaProductId: row.id,
    status: 'active',
    visibility: 'visible',
    syncStatus: 'completed',
    deletedAt: null,
    attributes: { source: 'meta', brand: row.brand ?? null },
  };
}

export function buildCatalogProductData(input: any) {
  const { brand, ...data } = input;
  for (const value of [data.customUrl, data.primaryImageUrl]) {
    const url = new URL(value);
    if (url.username || url.password)
      throw new ApiError(400, 'INVALID_PRODUCT_URL', 'Product URLs cannot contain credentials');
  }
  return {
    ...data,
    price: new Prisma.Decimal(data.price),
    attributes: { source: 'native', brand },
    syncStatus: 'pending',
    updatedAt: new Date(),
  };
}
