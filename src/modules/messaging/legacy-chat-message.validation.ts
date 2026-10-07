import Joi from 'joi';
const contact = {
  contact_uid: Joi.string().guid().required(),
  from_phone_number_id: Joi.string().pattern(/^\d{5,100}$/),
};
export const textBody = Joi.object({
  ...contact,
  message_body: Joi.string().min(1).max(4096).required(),
  client_message_uid: Joi.string().trim().max(100).allow('', null),
  reply_to_wamid: Joi.string().max(200),
});
export const locationBody = Joi.object({
  ...contact,
  location_type: Joi.string().valid('static', 'live').required(),
  location_latitude: Joi.number()
    .min(-90)
    .max(90)
    .when('location_type', { is: 'static', then: Joi.required(), otherwise: Joi.optional() }),
  location_longitude: Joi.number()
    .min(-180)
    .max(180)
    .when('location_type', { is: 'static', then: Joi.required(), otherwise: Joi.optional() }),
  location_name: Joi.string().max(100).allow('', null),
  location_address: Joi.string().max(500).allow('', null),
  live_duration: Joi.number().integer().min(1).max(1440),
});
export const reactionBody = Joi.object({ emoji: Joi.string().max(64).allow('', null).default('') });
export const reactionParams = Joi.object({
  messageUid: Joi.string().guid().required(),
  vendorId: Joi.string().pattern(/^[1-9]\d*$/),
});
