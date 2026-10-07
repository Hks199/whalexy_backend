import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import * as services from './services/appointment-management.service.js';

export const listResources: RequestHandler = async (req, res) => {
  sendResult(res, await services.listResources(serviceContext(req, res)));
};
export const createResource: RequestHandler = async (req, res) => {
  sendResult(res, await services.createResource(serviceContext(req, res)));
};
export const updateResource: RequestHandler = async (req, res) => {
  sendResult(res, await services.updateResource(serviceContext(req, res)));
};
export const deleteResource: RequestHandler = async (req, res) => {
  sendResult(res, await services.deleteResource(serviceContext(req, res)));
};
export const listServices: RequestHandler = async (req, res) => {
  sendResult(res, await services.listServices(serviceContext(req, res)));
};
export const createService: RequestHandler = async (req, res) => {
  sendResult(res, await services.createService(serviceContext(req, res)));
};
export const updateService: RequestHandler = async (req, res) => {
  sendResult(res, await services.updateService(serviceContext(req, res)));
};
export const deleteAppointmentService: RequestHandler = async (req, res) => {
  sendResult(res, await services.deleteAppointmentService(serviceContext(req, res)));
};
export const getResourceSchedule: RequestHandler = async (req, res) => {
  sendResult(res, await services.getResourceSchedule(serviceContext(req, res)));
};
export const replaceResourceSchedule: RequestHandler = async (req, res) => {
  sendResult(res, await services.replaceResourceSchedule(serviceContext(req, res)));
};
export const listOffDuty: RequestHandler = async (req, res) => {
  sendResult(res, await services.listOffDuty(serviceContext(req, res)));
};
export const createOffDuty: RequestHandler = async (req, res) => {
  sendResult(res, await services.createOffDuty(serviceContext(req, res)));
};
export const deleteOffDuty: RequestHandler = async (req, res) => {
  sendResult(res, await services.deleteOffDuty(serviceContext(req, res)));
};
