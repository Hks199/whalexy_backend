import Joi from 'joi';

export const numeric = Joi.string()
  .pattern(/^\d{5,100}$/)
  .required();
export const identifier = Joi.string().pattern(/^[A-Za-z_][A-Za-z0-9_]{0,79}$/);
export const endpointSchema = Joi.object({
  initialScreen: identifier.required(),
  screens: Joi.array()
    .items(
      Joi.object({
        id: identifier.required(),
        data: Joi.object().unknown(true).default({}),
        bindings: Joi.object().pattern(identifier, identifier.required()).default({}),
        nextScreen: identifier,
        complete: Joi.boolean().default(false),
      }),
    )
    .min(1)
    .max(100)
    .required(),
});
export const phoneScopeParamsSchema = Joi.object({
  vendorId: Joi.number().integer().positive().required(),
  phoneNumberId: numeric,
});
export const registerFlowEncryptionKeyBodySchema = Joi.object({});
export const configureFlowDataEndpointBodySchema = endpointSchema;
