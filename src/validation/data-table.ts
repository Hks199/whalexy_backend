import Joi from 'joi';
export const dataTableQuerySchema = (sortColumns: readonly number[]) =>
  Joi.object({
    draw: Joi.number().integer().min(0).max(2147483647).default(0),
    start: Joi.number().integer().min(0).max(1000000).default(0),
    length: Joi.number().integer().min(1).max(100).default(25),
    'search[value]': Joi.string().trim().max(100).allow('').default(''),
    'search[regex]': Joi.boolean().valid(false),
    'order[0][column]': Joi.number()
      .integer()
      .valid(...sortColumns),
    'order[0][dir]': Joi.string().valid('asc', 'desc').default('asc'),
  })
    .pattern(
      /^columns\[[0-9]{1,2}\]\[(data|name|searchable|orderable)\]$/,
      Joi.string().max(100).allow(''),
    )
    .pattern(/^columns\[[0-9]{1,2}\]\[search\]\[value\]$/, Joi.string().valid(''))
    .pattern(/^columns\[[0-9]{1,2}\]\[search\]\[regex\]$/, Joi.boolean().valid(false));
