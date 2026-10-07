import Joi from 'joi';
import { idSchema } from '../../validation/common.js';
const word = Joi.string()
  .max(80)
  .pattern(/^[A-Za-z0-9_-]+$/)
  .allow('');
const date = Joi.string()
  .pattern(/^\d{4}-\d{2}-\d{2}$/)
  .custom((value, helpers) => {
    const parsed = new Date(value + 'T00:00:00.000Z');
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
      ? value
      : helpers.error('any.invalid');
  });
const common = {
  integration_id: idSchema.optional(),
  page: Joi.number().integer().min(1).max(10000).default(1),
  limit: Joi.number().integer().min(1).max(100).default(50),
  status: word,
  search: Joi.string()
    .max(100)
    .allow('')
    .pattern(/^[^\x00-\x1f]+$/),
  date_from: date,
  date_to: date,
};
function dates(value: any, helpers: any) {
  return value.date_from && value.date_to && value.date_from > value.date_to
    ? helpers.error('any.invalid')
    : value;
}
export const shopifyOrdersQuery = Joi.object({
  ...common,
  financial_status: word,
  fulfillment_status: word,
})
  .and('date_from', 'date_to')
  .custom(dates);
export const wooOrdersQuery = Joi.object(common).and('date_from', 'date_to').custom(dates);
export const shopifyNotificationsQuery = Joi.object({ ...common, notification_type: word })
  .and('date_from', 'date_to')
  .custom(dates);
export const wooNotificationsQuery = Joi.object({ ...common, type: word })
  .and('date_from', 'date_to')
  .custom(dates);
export const detailQuery = Joi.object({
  integration_id: idSchema.optional(),
  page: common.page,
  limit: common.limit,
});
export const shopifyParams = Joi.object({
  orderId: Joi.string()
    .pattern(/^[1-9]\d{0,39}$/)
    .required(),
});
export const wooParams = Joi.object({ orderId: idSchema });
