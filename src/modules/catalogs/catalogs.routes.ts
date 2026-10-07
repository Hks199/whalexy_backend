import { Router } from 'express';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import {
  connectCatalogBodySchema,
  useCatalogIdParamsSchema,
  syncCatalogBodySchema,
  listCatalogProductsQuerySchema,
  createCatalogProductBodySchema,
  updateCatalogProductBodySchema,
  publishCatalogProductBodySchema,
} from './catalogs.validation.js';
import * as controllers from './catalogs.controller.js';

export const catalogsRouter = Router({ mergeParams: true });
catalogsRouter.get('/', permit('catalog.view'), controllers.listCatalogs);
catalogsRouter.post(
  '/connect',
  permit('catalog.settings.manage'),
  validate(connectCatalogBodySchema),
  controllers.connectCatalog,
);
catalogsRouter.use('/:catalogId', validate(useCatalogIdParamsSchema, 'params'));
catalogsRouter.post(
  '/:catalogId/sync',
  permit('catalog.settings.manage'),
  validate(syncCatalogBodySchema),
  controllers.syncCatalog,
);
catalogsRouter.get(
  '/:catalogId/products',
  permit('catalog.view'),
  validate(listCatalogProductsQuerySchema, 'query'),
  controllers.listCatalogProducts,
);
catalogsRouter.post(
  '/:catalogId/products',
  permit('catalog.products.create'),
  validate(createCatalogProductBodySchema),
  controllers.createCatalogProduct,
);
catalogsRouter.put(
  '/:catalogId/products/:productId',
  permit('catalog.products.edit'),
  validate(updateCatalogProductBodySchema),
  controllers.updateCatalogProduct,
);
catalogsRouter.post(
  '/:catalogId/products/:productId/publish',
  permit('catalog.products.edit'),
  validate(publishCatalogProductBodySchema),
  controllers.publishCatalogProduct,
);
catalogsRouter.delete(
  '/:catalogId/connection',
  permit('catalog.settings.manage'),
  controllers.disconnectCatalog,
);
