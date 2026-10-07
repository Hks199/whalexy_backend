import Joi from 'joi';
import { awaySchema } from './out-of-office.validation.js';
export const emptyQuery = Joi.object({});
const flag = (value: unknown) =>
  value === 1 || value === '1' ? true : value === 0 || value === '0' ? false : value;
/** Laravel boolean validation accepts 0/1 in addition to native JSON booleans. */
export const legacyAwayBody = Joi.object()
  .unknown(true)
  .custom((value, helpers) => {
    const mapped = {
      ...value,
      enabled: flag(value.enabled),
      schedule: Array.isArray(value.schedule)
        ? value.schedule.map((day: any) =>
            day && typeof day === 'object' && !Array.isArray(day)
              ? { ...day, enabled: flag(day.enabled) }
              : day,
          )
        : value.schedule,
    };
    const checked = awaySchema.validate(mapped, { abortEarly: false, allowUnknown: false });
    return checked.error ? helpers.error('any.invalid') : checked.value;
  });
