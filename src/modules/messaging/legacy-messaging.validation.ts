import Joi from 'joi';
import { legacyContactPhoneSchema } from '../contacts/legacy-contact.validation.js';
import { graphMediaSchema } from './services/media-message.js';

const recipient = {
  phone_number: legacyContactPhoneSchema.required(),
  from_phone_number_id: Joi.string().pattern(/^\d{5,100}$/),
};
export const legacyTextMessageBodySchema = Joi.object({
  ...recipient,
  message_body: Joi.string().min(1).max(4096).required(),
});
export const legacyMediaMessageBodySchema = graphMediaSchema
  .keys({
    ...recipient,
    message_body: Joi.string().max(1024).allow(''),
    file_name: Joi.string()
      .min(1)
      .max(240)
      .pattern(/^[^\\/\x00-\x1f\x7f]+$/)
      .invalid('.', '..'),
  })
  .oxor('message_body', 'caption')
  .oxor('file_name', 'filename');
export const legacyTemplateMessageBodySchema = Joi.object({
  ...recipient,
  template_name: Joi.string()
    .pattern(/^[a-z0-9_]{1,512}$/)
    .required(),
  template_language: Joi.string()
    .pattern(/^[A-Za-z]{2,3}(?:_[A-Za-z]{2,4})?$/)
    .required(),
}).pattern(/^(?:header_)?field_[1-9]\d?$/, Joi.string().min(1).max(1024));
