import Joi from 'joi';

export const addKnowledgeWebsiteBodySchema = Joi.object({
  websiteUrl: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .max(2048)
    .required(),
  title: Joi.string().trim().max(255).allow(null, ''),
}).rename('website_url', 'websiteUrl');
export const knowledgeDocumentParamsSchema = Joi.object({
  vendorId: Joi.number().integer().positive().max(2147483647),
  documentId: Joi.string()
    .pattern(/^[A-Za-z0-9_-]{1,100}$/)
    .required(),
});
export const knowledgeRequestKeySchema = Joi.string()
  .pattern(/^[A-Za-z0-9_-]{8,100}$/)
  .required();
