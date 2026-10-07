import { Router } from 'express';
import { authenticateLegacyWorkspace } from '../../middleware/legacy-workspace.js';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import * as schemas from './legacy-campaign.validation.js';
import * as controllers from './legacy-campaign.controller.js';
export const legacyCampaignRouter = Router();
legacyCampaignRouter.use(authenticateLegacyWorkspace, permit('vendor.chats.view_all'));
legacyCampaignRouter.get(
  '/status/:campaignUid/data',
  permit('vendor.campaigns.view'),
  validate(schemas.uidParams, 'params'),
  validate(schemas.emptyQuery, 'query'),
  controllers.status,
);
legacyCampaignRouter.get(
  '/:status/list-data',
  permit('vendor.campaigns.view'),
  validate(schemas.listParams, 'params'),
  validate(schemas.tableQuery, 'query'),
  controllers.list,
);
legacyCampaignRouter.get(
  '/queue/:campaignUid',
  permit('vendor.campaigns.view'),
  validate(schemas.uidParams, 'params'),
  validate(schemas.tableQuery, 'query'),
  controllers.queue,
);
legacyCampaignRouter.get(
  '/executed/:campaignUid',
  permit('vendor.campaigns.view'),
  validate(schemas.uidParams, 'params'),
  validate(schemas.tableQuery, 'query'),
  controllers.executed,
);
legacyCampaignRouter.post(
  '/:campaignIdOrUid/duplicate',
  permit('vendor.campaigns.create'),
  validate(schemas.actionParams, 'params'),
  validate(schemas.emptyQuery, 'query'),
  validate(schemas.duplicateBody),
  controllers.duplicate,
);
legacyCampaignRouter.post(
  '/:campaignIdOrUid/delete-process',
  permit('vendor.campaigns.delete'),
  validate(schemas.actionParams, 'params'),
  validate(schemas.emptyQuery, 'query'),
  validate(schemas.emptyBody),
  controllers.remove,
);
legacyCampaignRouter.post(
  '/:campaignIdOrUid/archive-process',
  permit('vendor.campaigns.send'),
  validate(schemas.actionParams, 'params'),
  validate(schemas.emptyQuery, 'query'),
  validate(schemas.emptyBody),
  controllers.archive,
);
legacyCampaignRouter.post(
  '/:campaignIdOrUid/unarchive-process',
  permit('vendor.campaigns.send'),
  validate(schemas.actionParams, 'params'),
  validate(schemas.emptyQuery, 'query'),
  validate(schemas.emptyBody),
  controllers.restore,
);
