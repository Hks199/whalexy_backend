import Joi from 'joi';
const target = Joi.alternatives()
  .try(
    Joi.string().guid(),
    Joi.string()
      .pattern(/^[1-9]\d{0,9}$/)
      .custom((v, h) => (Number(v) <= 2147483647 ? v : h.error('any.invalid'))),
  )
  .required();
const revision = Joi.string().hex().length(64).required();
const flag = Joi.alternatives().try(Joi.boolean(), Joi.string().valid('on', 'off')).default(false);
export const params = Joi.object({ pageIdOrUid: target });
export const emptyQuery = Joi.object({});
export const createBody = Joi.object({
  title: Joi.string().trim().min(2).max(255).required(),
  slug: Joi.string().alphanum().max(255).required(),
  description: Joi.string().min(2).max(500000).required(),
  show_in_menu: flag,
  status: flag,
});
export const updateBody = createBody.keys({ pageIdOrUid: target, revision });
export const deleteBody = Joi.object({ revision });
const searchSchema = Joi.object({
  value: Joi.string()
    .max(100)
    .allow('')
    .pattern(/^[^\x00-\x1f]+$/),
  regex: Joi.boolean().valid(false).default(false),
});
const bracketFields: Record<string, Joi.Schema> = {
  'search[value]': Joi.string()
    .max(100)
    .allow('')
    .pattern(/^[^\x00-\x1f]+$/),
  'search[regex]': Joi.boolean().valid(false),
  'order[0][column]': Joi.number().integer().min(0).max(19),
  'order[0][dir]': Joi.string().valid('asc', 'desc'),
};
for (let index = 0; index < 20; index++) {
  bracketFields[`columns[${index}][data]`] = Joi.string().max(80).allow('');
  bracketFields[`columns[${index}][name]`] = Joi.string().max(80).allow('');
  for (const field of ['searchable', 'orderable'])
    bracketFields[`columns[${index}][${field}]`] = Joi.boolean();
  bracketFields[`columns[${index}][search][value]`] = Joi.string().max(100).allow('');
  bracketFields[`columns[${index}][search][regex]`] = Joi.boolean().valid(false);
}
export const tableQuery = Joi.object({
  ...bracketFields,
  columns: Joi.array()
    .items(
      Joi.object({
        data: Joi.string().max(80).required(),
        name: Joi.string().max(80).allow(''),
        searchable: Joi.boolean(),
        orderable: Joi.boolean(),
        search: searchSchema,
      }),
    )
    .max(20),
  order: Joi.array()
    .items(
      Joi.object({
        column: Joi.number().integer().min(0).max(19).required(),
        dir: Joi.string().valid('asc', 'desc').required(),
      }),
    )
    .max(1),
  draw: Joi.number().integer().min(0).max(2147483647).default(0),
  start: Joi.number().integer().min(0).max(1000000).default(0),
  length: Joi.number().integer().min(1).max(100).default(25),
  search: Joi.object({
    value: Joi.string()
      .max(100)
      .allow('')
      .pattern(/^[^\x00-\x1f]+$/),
    regex: Joi.boolean().valid(false).default(false),
  }),
})
  .and('order[0][column]', 'order[0][dir]')
  .custom((value) => {
    if (value['search[value]'] !== undefined || value['search[regex]'] !== undefined)
      value.search = { value: value['search[value]'], regex: value['search[regex]'] ?? false };
    if (value['order[0][column]'] !== undefined)
      value.order = [{ column: value['order[0][column]'], dir: value['order[0][dir]'] }];
    const columns = [];
    for (let index = 0; index < 20; index++)
      if (value[`columns[${index}][data]`] !== undefined)
        columns[index] = {
          data: value[`columns[${index}][data]`],
          name: value[`columns[${index}][name]`],
          orderable: value[`columns[${index}][orderable]`],
          search: { value: value[`columns[${index}][search][value]`] },
        };
    if (columns.length) value.columns = columns;
    return value;
  });
