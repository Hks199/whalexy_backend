import Joi from 'joi';
export const statuses = [
  'pending',
  'awaiting_address',
  'awaiting_payment',
  'paid',
  'confirmed',
  'shipped',
  'delivered',
  'cancelled',
  'refunded',
];
const day = Joi.string()
  .pattern(/^\d{4}-\d{2}-\d{2}$/)
  .custom((v, h) => {
    const d = new Date(v + 'T00:00:00Z');
    return Number.isNaN(d.valueOf()) || d.toISOString().slice(0, 10) !== v
      ? h.error('any.invalid')
      : v;
  });
export const query = Joi.object({
  page: Joi.number().integer().min(1).max(1000000).default(1),
  per_page: Joi.number().integer().min(1).max(100).default(20),
  status: Joi.string().valid(...statuses),
  customer_phone: Joi.string().pattern(/^\+?\d{1,20}$/),
  order_id: Joi.string()
    .max(100)
    .pattern(/^[^\x00-\x1f]*$/),
  date_from: day,
  date_to: day,
}).custom((v, h) =>
  v.date_from && v.date_to && v.date_from > v.date_to ? h.error('any.invalid') : v,
);
export const empty = Joi.object({});
export const params = Joi.object({
  orderUid: Joi.string().guid().required(),
  vendorId: Joi.string().pattern(/^[1-9]\d*$/),
});

export const exportQuery = query.fork(['page', 'per_page'], (s) => s.forbidden());
export const updateBody = Joi.object({
  status: Joi.string()
    .valid(...statuses)
    .required(),
  revision: Joi.string().hex().length(64).required(),
});
