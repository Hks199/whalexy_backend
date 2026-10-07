import Joi from 'joi';
import { siteSettingDefinitions, siteSettingGroups } from './services/site-settings.js';
export const params = Joi.object({
  pageType: Joi.string()
    .valid(...Object.keys(siteSettingGroups))
    .required(),
});
export const emptyQuery = Joi.object({});
export const body = Joi.object()
  .unknown(true)
  .custom((value, h) => {
    const group = value.pageType;
    if (typeof group !== 'string' || !Object.hasOwn(siteSettingGroups, group))
      return h.error('any.invalid');
    const keys = siteSettingGroups[group as keyof typeof siteSettingGroups];
    const settings = Object.fromEntries(
      keys.map((key) => [
        key,
        siteSettingDefinitions[key]!.type === 2
          ? Joi.boolean().truthy('on', '1', 1).falsy('off', '0', 0)
          : siteSettingDefinitions[key]!.schema,
      ]),
    );
    const checked = Joi.object({
      pageType: Joi.string().valid(group).required(),
      revision: Joi.string().hex().length(64).required(),
      ...settings,
    }).validate(value, { allowUnknown: false });
    if (checked.error || !keys.some((key) => Object.hasOwn(value, key)))
      return h.error('any.invalid');
    return {
      pageType: group,
      revision: checked.value.revision,
      settings: Object.fromEntries(
        keys
          .filter((key) => Object.hasOwn(checked.value, key))
          .map((key) => [key, checked.value[key]]),
      ),
    };
  });
