import { deleteCampaign } from './campaigns.controller.js';
import * as middleware from './campaigns.middleware.js';
import { Router } from 'express';
import { permit } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import {
  listCampaignsQuerySchema,
  createCampaignBodySchema,
  duplicateCampaignBodySchema,
  sendCampaignTestBodySchema,
  listCampaignRecipientsQuerySchema,
} from './campaigns.validation.js';
import * as controllers from './campaigns.controller.js';

export const campaignsRouter = Router({ mergeParams: true });
campaignsRouter.param('id', middleware.validateCampaignId);
campaignsRouter.use(middleware.requireFullContactVisibility);
campaignsRouter.get(
  '/',
  permit('vendor.campaigns.view'),
  validate(listCampaignsQuerySchema, 'query'),
  controllers.listCampaigns,
);
campaignsRouter.post(
  '/',
  permit('vendor.campaigns.create'),
  validate(createCampaignBodySchema),
  controllers.createCampaign,
);
campaignsRouter.post('/:id/cancel', permit('vendor.campaigns.send'), controllers.cancelCampaign);
campaignsRouter.post('/:id/pause', permit('vendor.campaigns.send'), controllers.pauseCampaign);
campaignsRouter.post('/:id/resume', permit('vendor.campaigns.send'), controllers.resumeCampaign);
campaignsRouter.post(
  '/:id/duplicate',
  permit('vendor.campaigns.create'),
  validate(duplicateCampaignBodySchema),
  controllers.duplicateCampaign,
);
campaignsRouter.get('/:id/status', permit('vendor.campaigns.view'), controllers.getCampaignStatus);
campaignsRouter.post(
  '/:id/test',
  permit('vendor.campaigns.send'),
  permit('vendor.chats.reply'),
  validate(sendCampaignTestBodySchema),
  controllers.sendCampaignTest,
);
campaignsRouter.post('/:id/archive', permit('vendor.campaigns.send'), controllers.archiveCampaign);
campaignsRouter.post(
  '/:id/unarchive',
  permit('vendor.campaigns.send'),
  controllers.restoreCampaign,
);
campaignsRouter.get('/:id/report', permit('vendor.campaigns.view'), controllers.getCampaignReport);
campaignsRouter.get(
  '/:id/recipients',
  permit('vendor.campaigns.view'),
  validate(listCampaignRecipientsQuerySchema, 'query'),
  controllers.listCampaignRecipients,
);

campaignsRouter.delete('/:id', permit('vendor.campaigns.delete'), deleteCampaign);
