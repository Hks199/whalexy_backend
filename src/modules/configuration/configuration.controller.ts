import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import {
  listSettingGroups as listSettingGroupsService,
  getSettingGroup as getSettingGroupService,
  updateSettingGroup as updateSettingGroupService,
} from './configuration.service.js';

export const listSettingGroups: RequestHandler = async (req, res) => {
  sendResult(res, await listSettingGroupsService(serviceContext(req, res)));
};
export const getSettingGroup =
  (keys: readonly string[], group: 'user' | 'general' | 'misc_settings'): RequestHandler =>
  async (req, res) => {
    sendResult(res, await getSettingGroupService(serviceContext(req, res), keys, group));
  };
export const updateSettingGroup =
  (keys: readonly string[], group: 'user' | 'general' | 'misc_settings'): RequestHandler =>
  async (req, res) => {
    sendResult(res, await updateSettingGroupService(serviceContext(req, res), keys, group));
  };
