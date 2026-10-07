import Joi from 'joi';
import { siteSettingDefinitions } from './services/site-settings.js';

export function updateSettingGroupBodySchema(keys: readonly string[]) {
  const values = Joi.object(
    Object.fromEntries(keys.map((key) => [key, siteSettingDefinitions[key]!.schema])),
  )
    .min(1)
    .required();
  return Joi.object({ revision: Joi.string().hex().length(64).required(), settings: values });
}
