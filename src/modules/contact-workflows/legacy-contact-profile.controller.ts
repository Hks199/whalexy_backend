import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import * as services from './services/legacy-contact-profile.service.js';
export const notes: RequestHandler = async (req, res) => {
  sendResult(res, await services.notes(serviceContext(req, res)));
};
export const assignLabels: RequestHandler = async (req, res) => {
  sendResult(res, await services.assignLabels(serviceContext(req, res)));
};
export const labels: RequestHandler = async (req, res) => {
  sendResult(res, await services.labels(serviceContext(req, res)));
};

export const createLabel: RequestHandler = async (req, res) => {
  sendResult(res, await services.createLabel(serviceContext(req, res)));
};

export const editLabel: RequestHandler = async (req, res) => {
  sendResult(res, await services.editLabel(serviceContext(req, res)));
};

export const removeLabel: RequestHandler = async (req, res) => {
  sendResult(res, await services.removeLabel(serviceContext(req, res)));
};

export const assignChat: RequestHandler = async (req, res) => {
  sendResult(res, await services.assignChat(serviceContext(req, res)));
};
