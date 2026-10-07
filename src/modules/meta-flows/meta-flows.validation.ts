import Joi from 'joi';

export const remoteId = Joi.string()
  .pattern(/^\d{5,100}$/)
  .required();
export const categories = Joi.array()
  .items(
    Joi.string().valid(
      'SIGN_UP',
      'SIGN_IN',
      'APPOINTMENT_BOOKING',
      'LEAD_GENERATION',
      'CONTACT_US',
      'CUSTOMER_SUPPORT',
      'SURVEY',
      'OTHER',
    ),
  )
  .min(1)
  .max(8)
  .unique()
  .required();
export const phoneScopeParamsSchema = Joi.object({
  vendorId: Joi.number().integer().positive().required(),
  phoneNumberId: remoteId,
});
export const listMetaFlowsQuerySchema = Joi.object({
  after: Joi.string().max(4096),
  maxPages: Joi.number().integer().min(1).max(100).default(10),
});
export const createMetaFlowBodySchema = Joi.object({
  name: Joi.string().trim().min(1).max(255).required(),
  categories,
});
export const updateMetaFlowBodySchema = Joi.object({
  name: Joi.string().trim().min(1).max(255).required(),
  categories,
});
export const updateMetaFlowDefinitionBodySchema = Joi.object({
  flowJson: Joi.object().unknown(true).required(),
});
export const changeMetaFlowStateBodySchema = Joi.object({});
