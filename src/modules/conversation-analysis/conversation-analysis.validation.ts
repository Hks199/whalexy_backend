import Joi from 'joi';

export const conversationIdentifier = Joi.alternatives().try(
  Joi.number().integer().min(1).max(2147483647),
  Joi.string().guid(),
);
export const analyzeConversationBodySchema = Joi.object({
  conversation_id: conversationIdentifier.required(),
});
export const analysisOutputSchema = Joi.object({
  intent: Joi.string().max(100).required(),
  intent_confidence: Joi.number().required(),
  sentiment: Joi.string().max(100).required(),
  sentiment_confidence: Joi.number().required(),
  urgency: Joi.string().max(100).required(),
  risk_level: Joi.string().max(100).required(),
  lead_score: Joi.number().required(),
  lead_category: Joi.string().max(100).required(),
  ai_insight: Joi.string().max(10000).allow('').required(),
  conversation_summary: Joi.string().max(20000).allow('', null),
  next_best_action: Joi.string().max(10000).allow('').required(),
  suggested_replies: Joi.array().items(Joi.string().max(10000).allow('')).min(3).max(20).required(),
});
