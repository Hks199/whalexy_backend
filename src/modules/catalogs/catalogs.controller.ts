import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import {
  listCatalogs as listCatalogsService,
  connectCatalog as connectCatalogService,
  syncCatalog as syncCatalogService,
  disconnectCatalog as disconnectCatalogService,
} from './services/catalog-connections.service.js';
import {
  listCatalogProducts as listCatalogProductsService,
  createCatalogProduct as createCatalogProductService,
  updateCatalogProduct as updateCatalogProductService,
  publishCatalogProduct as publishCatalogProductService,
} from './services/catalog-products.service.js';

export const listCatalogs: RequestHandler = async (req, res) => {
  sendResult(res, await listCatalogsService(serviceContext(req, res)));
};
export const connectCatalog: RequestHandler = async (req, res) => {
  sendResult(res, await connectCatalogService(serviceContext(req, res)));
};
export const syncCatalog: RequestHandler = async (req, res) => {
  sendResult(res, await syncCatalogService(serviceContext(req, res)));
};
export const listCatalogProducts: RequestHandler = async (req, res) => {
  sendResult(res, await listCatalogProductsService(serviceContext(req, res)));
};
export const createCatalogProduct: RequestHandler = async (req, res) => {
  sendResult(res, await createCatalogProductService(serviceContext(req, res)));
};
export const updateCatalogProduct: RequestHandler = async (req, res) => {
  sendResult(res, await updateCatalogProductService(serviceContext(req, res)));
};
export const publishCatalogProduct: RequestHandler = async (req, res) => {
  sendResult(res, await publishCatalogProductService(serviceContext(req, res)));
};
export const disconnectCatalog: RequestHandler = async (req, res) => {
  sendResult(res, await disconnectCatalogService(serviceContext(req, res)));
};
