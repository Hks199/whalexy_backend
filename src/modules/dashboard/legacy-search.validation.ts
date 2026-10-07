import Joi from 'joi';
export const query = Joi.object({
  q: Joi.string()
    .trim()
    .max(100)
    .allow('')
    .pattern(/^[^\x00-\x1f]*$/)
    .default(''),
});
