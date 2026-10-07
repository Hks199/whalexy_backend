import type { ConversationAiAnalysis } from '@prisma/client';
import { ApiError } from '../../../shared/api-error.js';
import { analysisOutputSchema } from '../conversation-analysis.validation.js';

export const intents = [
  'Inquiry',
  'Support',
  'Complaint',
  'Feedback',
  'Pricing',
  'Sales',
  'Lead',
  'Hot Lead',
  'Cold Lead',
  'Order',
  'Order Confirmation',
  'Order Cancellation',
  'Refund',
  'Payment',
  'Technical Issue',
  'Appointment',
  'Booking',
  'Service Purchased',
  'Upsell Opportunity',
  'Renewal',
  'Spam',
  'Other',
];
export const sentiments = [
  'Very Positive',
  'Positive',
  'Neutral',
  'Negative',
  'Very Negative',
  'Frustrated',
  'Angry',
  'Confused',
  'Satisfied',
  'Excited',
];
export const urgencies = ['Low', 'Medium', 'High', 'Critical'];
export const risks = ['None', 'Low', 'Medium', 'High', 'Critical'];
const text = (value: string, max: number) =>
  Array.from(value.replace(/\s+/gu, ' ').trim()).slice(0, max).join('');
const sentences = (value: string, max: number) =>
  value
    .split(/(?<=[.!?])\s+/u)
    .slice(0, max)
    .join(' ');
const percent = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
const allowed = (value: string, values: string[], fallback: string) =>
  values.includes(value) ? value : fallback;
export function normalizeAnalysis(
  value: unknown,
  summaryDue: boolean,
  previousSummary: string | null,
) {
  const checked = analysisOutputSchema.validate(value, { convert: false, allowUnknown: false });
  if (checked.error)
    throw new ApiError(
      502,
      'ANALYSIS_INVALID_RESPONSE',
      'Analysis provider returned invalid structured data',
    );
  const data = checked.value;
  const replies: string[] = data.suggested_replies
    .map((reply: string) => text(reply, 180))
    .filter(Boolean)
    .slice(0, 3);
  const summary = summaryDue
    ? sentences(text(data.conversation_summary ?? '', 1200), 5)
    : previousSummary;
  if (replies.length !== 3 || (summaryDue && !summary))
    throw new ApiError(
      502,
      'ANALYSIS_INVALID_RESPONSE',
      'Analysis provider omitted replies or a required summary',
    );
  return {
    intent: allowed(data.intent, intents, 'Other'),
    intentConfidence: percent(data.intent_confidence),
    sentiment: allowed(data.sentiment, sentiments, 'Neutral'),
    sentimentConfidence: percent(data.sentiment_confidence),
    urgency: allowed(data.urgency, urgencies, 'Low'),
    riskLevel: allowed(data.risk_level, risks, 'None'),
    leadScore: percent(data.lead_score),
    leadCategory: allowed(
      data.lead_category,
      ['High Intent', 'Medium Intent', 'Low Intent'],
      'Low Intent',
    ),
    aiInsight: sentences(text(data.ai_insight, 500), 2),
    conversationSummary: summary,
    nextBestAction: text(data.next_best_action, 300),
    suggestedReplies: replies,
  };
}
export function presentAnalysis(row: ConversationAiAnalysis | null) {
  if (!row) return null;
  return {
    id: row.id,
    conversation_id: row.conversationId,
    vendors__id: row.vendorId,
    intent: row.intent,
    intent_confidence: row.intentConfidence,
    sentiment: row.sentiment,
    sentiment_confidence: row.sentimentConfidence,
    urgency: row.urgency,
    risk_level: row.riskLevel,
    lead_score: row.leadScore,
    lead_category: row.leadCategory,
    ai_insight: row.aiInsight,
    conversation_summary: row.conversationSummary,
    next_best_action: row.nextBestAction,
    suggested_replies: row.suggestedReplies,
    message_count: row.messageCount,
    last_analyzed_at: row.lastAnalyzedAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}
