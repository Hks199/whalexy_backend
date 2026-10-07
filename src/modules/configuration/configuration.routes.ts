import * as middleware from './configuration.middleware.js';
import { Router } from 'express';
import { siteSettingGroups, type SiteSettingGroup } from './services/site-settings.js';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import { updateSettingGroupBodySchema } from './configuration.validation.js';
import * as controllers from './configuration.controller.js';

export const configurationRouter = Router();
configurationRouter.use(authenticate, middleware.requireSiteAdministrator);
configurationRouter.get('/', controllers.listSettingGroups);
for (const [group, keys] of Object.entries(siteSettingGroups) as [
  SiteSettingGroup,
  readonly string[],
][]) {
  configurationRouter.get(`/${group}`, controllers.getSettingGroup(keys, group));
  configurationRouter.patch(
    `/${group}`,
    validate(updateSettingGroupBodySchema(keys)),
    controllers.updateSettingGroup(keys, group),
  );
}
