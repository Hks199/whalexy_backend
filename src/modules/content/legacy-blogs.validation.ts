import Joi from 'joi';
import { postSchema } from './content.validation.js';
const id = Joi.number().integer().positive().max(2147483647);
export const params = Joi.object({ blog: id.required() });
export const empty = Joi.object({});
export const listQuery = Joi.object({
  page: id.default(1),
  limit: Joi.number().integer().min(1).max(100).default(15),
  search: Joi.string().trim().max(200),
  status: Joi.string().valid('draft', 'published', 'scheduled'),
  category: id,
});
const mapping: Record<string, string> = {
  author_name: 'authorName',
  category_id: 'categoryId',
  tag_ids: 'tagIds',
  scheduled_at: 'scheduledAt',
  seo_title: 'seoTitle',
  meta_description: 'metaDescription',
  meta_keywords: 'metaKeywords',
  canonical_url: 'canonicalUrl',
  og_title: 'ogTitle',
  og_description: 'ogDescription',
};
const revision = Joi.string().hex().length(64).required();
export const mutation = Joi.object({ revision });
export function postBody(update = false) {
  return Joi.object()
    .unknown(true)
    .custom((value, h) => {
      const { revision: rev, ...source } = value;
      if (update ? revision.validate(rev).error : rev !== undefined) return h.error('any.invalid');
      if (!Object.hasOwn(source, 'intent')) return h.error('any.invalid');
      const native: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(source)) {
        if (Object.values(mapping).includes(key)) return h.error('any.invalid');
        native[mapping[key] ?? key] = val;
      }
      const checked = postSchema.validate(native, { allowUnknown: false });
      if (checked.error) return h.error('any.invalid');
      return { ...checked.value, ...(update ? { revision: rev } : {}) };
    });
}
