import Joi from 'joi';
import { IANAZone } from 'luxon';

export const phone = Joi.string()
  .pattern(/^\d{5,100}$/)
  .required();
export const time = Joi.string()
  .pattern(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
  .required();
export const awaySchema = Joi.object({
  enabled: Joi.boolean().required(),
  message: Joi.when('enabled', {
    is: true,
    then: Joi.string().trim().min(1).max(4096).required(),
    otherwise: Joi.string().trim().max(4096).allow('', null).default(''),
  }),
  timezone: Joi.string()
    .max(100)
    .custom((value, helpers) =>
      IANAZone.isValidZone(value) ? value : helpers.error('any.invalid'),
    )
    .required(),
  mode: Joi.string().valid('business_hours', 'always_available', 'out_of_office_now').required(),
  manual_until: Joi.string().isoDate().strict().allow(null).optional(),
  whatsapp_phone_number_id: phone,
  schedule: Joi.array()
    .items(
      Joi.object({
        day_of_week: Joi.number().integer().min(1).max(7).required(),
        enabled: Joi.boolean().required(),
        intervals: Joi.array()
          .items(Joi.object({ start: time, end: time }))
          .max(12)
          .required(),
      }),
    )
    .length(7)
    .unique('day_of_week')
    .required(),
}).custom((value, helpers) => {
  for (const day of value.schedule) {
    if (day.enabled && !day.intervals.length) return helpers.error('any.invalid');
    let previous = '';
    for (const interval of [...day.intervals].sort((a: any, b: any) =>
      a.start.localeCompare(b.start),
    )) {
      if (interval.start >= interval.end || interval.start < previous)
        return helpers.error('any.invalid');
      previous = interval.end;
    }
  }
  return value;
});
export const getAwaySettingsQuerySchema = Joi.object({ phone_number_id: phone.optional() });
export const updateAwaySettingsBodySchema = awaySchema;
