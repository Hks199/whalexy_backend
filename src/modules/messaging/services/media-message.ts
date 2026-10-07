import Joi from 'joi';
import { isIP } from 'node:net';

export const mediaTypes = ['image', 'video', 'document', 'audio'];
/** Media is pulled by the provider; the backend never downloads user URLs. */
export function publicMediaUrl(value: string) {
  try {
    const url = new URL(value),
      host = url.hostname.toLowerCase();
    return (
      value.length <= 2048 &&
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.hash &&
      (!url.port || url.port === '443') &&
      !isIP(host.replace(/^\[|\]$/g, '')) &&
      /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host) &&
      !/\.(?:localhost|local|internal|test|invalid|example)$/.test(host) &&
      !host.endsWith('.localhost') &&
      !/[\x00-\x20\x7f]/.test(value)
    );
  } catch {
    return false;
  }
}
export const mediaUrlSchema = Joi.string()
  .max(2048)
  .custom((v, h) => (publicMediaUrl(v) ? v : h.error('any.invalid')));
const caption = Joi.string()
  .max(1024)
  .allow('')
  .pattern(/^[^\x00-\x08\x0b\x0c\x0e-\x1f]*$/);
const filename = Joi.string()
  .min(1)
  .max(240)
  .pattern(/^[^\\/\x00-\x1f\x7f]+$/)
  .invalid('.', '..');
export const mediaMessageSchema = Joi.object({
  type: Joi.string()
    .valid(...mediaTypes)
    .required(),
  url: mediaUrlSchema.required(),
  caption: Joi.when('type', { is: 'audio', then: Joi.forbidden(), otherwise: caption }),
  filename: Joi.when('type', { is: 'document', then: filename, otherwise: Joi.forbidden() }),
});
export const graphMediaSchema = Joi.object({
  media_type: Joi.string()
    .valid(...mediaTypes)
    .required(),
  media_url: mediaUrlSchema.required(),
  caption: Joi.when('media_type', { is: 'audio', then: Joi.forbidden(), otherwise: caption }),
  filename: Joi.when('media_type', { is: 'document', then: filename, otherwise: Joi.forbidden() }),
});
export function mediaContent(input: {
  type: string;
  url: string;
  caption?: string;
  filename?: string;
}) {
  return {
    type: input.type,
    [input.type]: {
      link: input.url,
      ...(input.caption ? { caption: input.caption } : {}),
      ...(input.filename ? { filename: input.filename } : {}),
    },
  };
}
