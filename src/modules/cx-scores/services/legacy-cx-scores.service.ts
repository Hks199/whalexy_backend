import type { ConversationCxScores } from '@prisma/client';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { contactVisibility } from '../../contacts/contacts.service.js';
import { retryCustomerExperienceScore } from '../cx-scores.service.js';
export function presentLegacyCxAnalysis(row: ConversationCxScores | null) {
  if (!row) return null;
  return {
    id: row.id,
    conversation_id: row.conversationId,
    vendors__id: row.vendorId,
    agent_id: row.agentId,
    resolution_sequence: row.resolutionSequence,
    cx_score: row.cxScore?.toNumber() ?? null,
    rating: row.rating,
    summary: row.summary,
    reason_json: row.reasonJson,
    recommended_action: row.recommendedAction,
    follow_up_required: row.followUpRequired,
    status: row.status,
    failure_message: row.failureMessage ? 'CX analysis is unavailable' : null,
    generated_at: row.generatedAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}
export async function show(input: ServiceContext) {
  const identifier = input.params.conversationId;
  const contact = await db.contacts.findFirst({
    where: {
      ...contactVisibility(input),
      ...(typeof identifier === 'number' ? { id: identifier } : { uid: identifier }),
    },
    select: { id: true },
  });
  if (!contact) throw new ApiError(404, 'NOT_FOUND', 'Conversation not found');
  const row = await db.conversationCxScores.findFirst({
    where: {
      vendorId: input.identity!.vendorId!,
      conversationId: contact.id,
      ...(input.validatedQuery.score ? { id: input.validatedQuery.score } : {}),
    },
    orderBy: [{ resolutionSequence: 'desc' }, { id: 'desc' }],
  });
  if (input.validatedQuery.score && !row)
    throw new ApiError(404, 'NOT_FOUND', 'CX score not found');
  return serviceResult(
    { status: row?.status ?? 'not_resolved', analysis: presentLegacyCxAnalysis(row) },
    { status: 200, format: 'json' },
  );
}
export async function retry(input: ServiceContext) {
  await retryCustomerExperienceScore(
    { ...input, params: { ...input.params, id: input.params.scoreId } },
    ['failed', 'pending'],
  );
  return serviceResult(
    { status: 'pending', message: 'CX analysis queued for retry.' },
    { status: 202, format: 'json' },
  );
}
