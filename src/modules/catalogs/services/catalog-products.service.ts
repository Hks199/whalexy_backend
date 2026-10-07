import { randomUUID } from 'node:crypto';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { decrypt } from '../../../utils/crypto.js';
import { metaOperation } from '../../../infrastructure/providers/meta-operations.js';
import { numeric, productSchema } from '../catalogs.validation.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import {
  getConnectedCatalog,
  buildCatalogProductData,
  getCatalogMembership,
  requestCatalogGraphApi,
} from './catalogs-support.service.js';

export async function listCatalogProducts(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!,
    catalogId = Number(requestInput.params.catalogId);
  await getConnectedCatalog(vendorId, catalogId);
  const { page, limit } = requestInput.validatedQuery,
    where = { vendorId, catalogId, deletedAt: null };
  const [items, total] = await Promise.all([
    db.products.findMany({
      where,
      take: limit,
      skip: (page - 1) * limit,
      orderBy: { id: 'asc' },
      select: {
        id: true,
        name: true,
        sku: true,
        price: true,
        currency: true,
        status: true,
        availability: true,
        visibility: true,
        primaryImageUrl: true,
        metaProductId: true,
        syncStatus: true,
      },
    }),
    db.products.count({ where }),
  ]);
  return serviceResult({ items, total, page, limit }, { status: 200, format: 'json' });
}

export async function createCatalogProduct(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!,
    catalogId = Number(requestInput.params.catalogId);
  await getConnectedCatalog(vendorId, catalogId);
  const data = buildCatalogProductData(requestInput.body),
    row = await db.products.create({
      data: {
        ...data,
        vendorId,
        catalogId,
        slug: `product-${randomUUID()}`,
        status: 'draft',
        createdBy: requestInput.identity!.userId,
      },
    });
  return serviceResult(
    { id: row.id, status: row.status, syncStatus: row.syncStatus },
    { status: 201, format: 'json' },
  );
}

export async function updateCatalogProduct(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!,
    catalogId = Number(requestInput.params.catalogId),
    productId = Number(requestInput.params.productId);
  if (!Number.isInteger(productId) || productId < 1)
    throw new ApiError(400, 'INVALID_PRODUCT_ID', 'Invalid product identifier');
  await getConnectedCatalog(vendorId, catalogId);
  const prior = await db.products.findFirst({
    where: { id: productId, vendorId, catalogId, deletedAt: null },
  });
  if (!prior) throw new ApiError(404, 'NOT_FOUND', 'Product not found');
  if (prior.metaProductId && prior.sku !== requestInput.body.sku)
    throw new ApiError(
      409,
      'PRODUCT_SKU_IMMUTABLE',
      'Published retailer identifiers cannot be changed',
    );
  const row = await db.products.update({
    where: { id: prior.id },
    data: {
      ...buildCatalogProductData(requestInput.body),
      updatedBy: requestInput.identity!.userId,
    },
  });
  return serviceResult(
    { id: row.id, status: row.status, syncStatus: row.syncStatus },
    { status: 200, format: 'json' },
  );
}

export async function publishCatalogProduct(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!,
    catalogId = Number(requestInput.params.catalogId),
    productId = Number(requestInput.params.productId);
  if (!Number.isInteger(productId) || productId < 1)
    throw new ApiError(400, 'INVALID_PRODUCT_ID', 'Invalid product identifier');
  const { connection, credential } = await getConnectedCatalog(vendorId, catalogId),
    product = await db.products.findFirst({
      where: { id: productId, vendorId, catalogId, deletedAt: null },
    });
  if (!product) throw new ApiError(404, 'NOT_FOUND', 'Product not found');
  const validated = productSchema.validate(
    {
      name: product.name,
      sku: product.sku,
      description: product.description,
      price: product.price.toFixed(4),
      currency: product.currency,
      availability: product.availability,
      condition: product.condition,
      customUrl: product.customUrl,
      primaryImageUrl: product.primaryImageUrl,
      brand: (product.attributes as any)?.brand,
    },
    { convert: false },
  );
  if (validated.error)
    throw new ApiError(
      409,
      'PRODUCT_NOT_READY',
      'Complete validated product details before publishing',
    );
  const minor = product.price.mul(100);
  if (!minor.isInteger() || minor.greaterThan(2147483647))
    throw new ApiError(
      400,
      'INVALID_PRODUCT_PRICE',
      'Product price must fit whole provider minor units',
    );
  const token = decrypt(credential.secret),
    payload = {
      retailer_id: product.sku,
      name: product.name,
      description: product.description!,
      price: minor.toFixed(0),
      currency: product.currency,
      availability: product.availability.replaceAll('_', ' '),
      condition: product.condition,
      url: product.customUrl!,
      image_url: product.primaryImageUrl!,
      brand: validated.value.brand,
    };
  const result = await metaOperation(
    requestInput,
    `catalog-product:${catalogId}:${productId}`,
    { action: 'publish', productId },
    async (effect) => {
      await getCatalogMembership(
        token,
        connection.businessId,
        connection.whatsappBusinessAccountId!,
        connection.catalogIdExternal,
      );
      if (product.metaProductId) {
        const remote = await requestCatalogGraphApi(token, product.metaProductId, {
          fields: 'id,retailer_id,product_catalog',
        });
        if (
          remote.id !== product.metaProductId ||
          remote.retailer_id !== product.sku ||
          remote.product_catalog?.id !== connection.catalogIdExternal
        )
          throw new ApiError(409, 'CATALOG_PRODUCT_CONFLICT', 'Provider product ownership changed');
      }
      const remote = await effect(() =>
        requestCatalogGraphApi(
          token,
          product.metaProductId ?? `${connection.catalogIdExternal}/products`,
          {},
          payload,
        ),
      );
      if (
        (product.metaProductId && remote.success !== true) ||
        (!product.metaProductId && numeric.validate(remote.id, { convert: false }).error)
      )
        throw new ApiError(502, 'PROVIDER_UNCERTAIN', 'Product publishing needs reconciliation');
      return {
        id: productId,
        metaProductId: product.metaProductId ?? remote.id,
        status: 'active',
        syncStatus: 'completed',
      };
    },
    async (tx, value) => {
      const current = await tx.products.findFirst({
          where: {
            id: productId,
            vendorId,
            catalogId,
            updatedAt: product.updatedAt,
            deletedAt: null,
          },
        }),
        fresh = await tx.catalogConnections.findFirst({
          where: {
            id: connection.id,
            vendorId,
            updatedAt: connection.updatedAt,
            deletedAt: null,
            syncStatus: 'connected',
          },
        });
      if (!current || !fresh)
        throw new ApiError(
          409,
          'CATALOG_PRODUCT_CHANGED',
          'Product or catalog changed during publishing',
        );
      await tx.products.update({
        where: { id: productId },
        data: {
          metaProductId: value.metaProductId,
          status: 'active',
          syncStatus: 'completed',
          lastSyncedAt: new Date(),
          lastSyncError: null,
          updatedAt: new Date(),
        },
      });
    },
  );
  return serviceResult(result, { status: 200, format: 'json' });
}
