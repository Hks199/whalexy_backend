import Joi from 'joi';
import { idSchema, pageSchema } from '../../validation/common.js';
import { adDate } from './services/ad-insights.js';
const namedId = Joi.object({
  id: Joi.string()
    .pattern(/^\d{1,40}$/)
    .required(),
  name: Joi.string().max(150).required(),
});
const country = Joi.string()
  .uppercase()
  .pattern(/^[A-Z]{2}$/);
const audience = Joi.object({
  location_mode: Joi.string().valid('country', 'region', 'radius').required(),
  countries: Joi.array()
    .items(country)
    .min(1)
    .max(25)
    .when('location_mode', { is: 'country', then: Joi.required() }),
  regions: Joi.array()
    .items(
      Joi.object({
        key: Joi.string().max(40).required(),
        name: Joi.string().max(150).required(),
        country_code: country.required(),
      }),
    )
    .min(1)
    .max(25)
    .when('location_mode', { is: 'region', then: Joi.required() }),
  locations: Joi.array()
    .items(
      Joi.object({
        key: Joi.string().max(40).required(),
        name: Joi.string().max(150).required(),
        type: Joi.valid('city').required(),
        country_code: country.required(),
        radius: Joi.number().integer().min(1).max(80).required(),
        distance_unit: Joi.valid('kilometer', 'mile').required(),
      }),
    )
    .min(1)
    .max(25)
    .when('location_mode', { is: 'radius', then: Joi.required() }),
  age_min: Joi.number().integer().min(18).max(65).required(),
  age_max: Joi.number().integer().min(Joi.ref('age_min')).max(65).required(),
  genders: Joi.array()
    .items(Joi.valid('all', 'male', 'female'))
    .unique(),
  interests: Joi.array().items(namedId).max(50),
  custom_audiences: Joi.object({
    include: Joi.array().items(namedId).max(50),
    exclude: Joi.array().items(namedId).max(50),
  }),
  advantage_audience: Joi.boolean(),
});
export const legacyCampaignBodySchema = Joi.object({
  ad_account_id: idSchema,
  name: Joi.string().trim().max(150).required(),
  objective: Joi.valid('messages').required(),
  goal: Joi.valid('whatsapp_messages').required(),
  special_ad_category: Joi.string()
    .valid('credit', 'employment', 'housing', 'social_issues')
    .allow(null),
  budget_type: Joi.valid('daily', 'lifetime').required(),
  budget_amount: Joi.string()
    .pattern(/^\d{1,9}(?:\.\d{1,4})?$/)
    .required(),
  bid_strategy: Joi.valid('lowest_cost').required(),
  starts_at: Joi.date().iso().allow(null),
  ends_at: Joi.date().iso().greater(Joi.ref('starts_at')).allow(null),
  timezone: Joi.string().max(100).required(),
  audience: audience.required(),
  placement_mode: Joi.valid('automatic', 'manual').required(),
  placements: Joi.array()
    .items(
      Joi.valid(
        'facebook_feed',
        'facebook_stories',
        'facebook_reels',
        'facebook_marketplace',
        'facebook_search',
        'instagram_feed',
        'instagram_stories',
        'instagram_reels',
        'instagram_explore',
      ),
    )
    .min(1)
    .unique()
    .required(),
  creative: Joi.object({
    format: Joi.valid('single_image').required(),
    headline: Joi.string().max(255).required(),
    primary_text: Joi.string().max(2200).required(),
    description: Joi.string().max(500).allow('', null),
    call_to_action: Joi.valid('SEND_WHATSAPP_MESSAGE').required(),
  }).required(),
  notes: Joi.string().max(5000).allow('', null),
  publish: Joi.boolean().default(false),
});
export const legacyCampaignQuerySchema = pageSchema.keys({
  search: Joi.string().max(200),
  status: Joi.valid('active', 'paused', 'archived', 'draft', 'completed'),
  objective: Joi.string().max(100),
});
export const legacyDashboardQuerySchema = Joi.object({
  range: Joi.valid('today', 'yesterday', '7d', '30d', 'custom').default('7d'),
  from: adDate,
  to: adDate,
});
export const legacyCampaignActionSchema = Joi.object({
  action: Joi.valid('pause', 'resume', 'duplicate', 'delete', 'archive', 'publish').required(),
});
export const legacyConversionSchema = Joi.object({
  campaign_uuid: Joi.string().uuid(),
  contact_uid: Joi.string().uuid(),
  external_id: Joi.string().trim().max(191).required(),
  type: Joi.valid(
    'lead',
    'appointment',
    'demo',
    'purchase',
    'payment',
    'signup',
    'refund',
    'cancellation',
  ).required(),
  value: Joi.string()
    .pattern(/^\d{1,14}(?:\.\d{1,4})?$/)
    .default('0'),
  currency: Joi.string()
    .pattern(/^[A-Z]{3}$/)
    .required(),
  occurred_at: Joi.date().iso().max('now').required(),
}).or('campaign_uuid', 'contact_uid');
