import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { contactVisibility, present } from '../contacts.service.js';
import { resolveConversation } from './conversation-resolution.js';
import { acceptContactHandoff } from '../../handoffs/services/accept-contact-handoff.service.js';
async function contact(input: ServiceContext) {
  const identifier = input.params.conversationId;
  const row = await db.contacts.findFirst({
    where: {
      ...contactVisibility(input),
      ...(typeof identifier === 'number' ? { id: identifier } : { uid: identifier }),
    },
  });
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Contact not found');
  return row;
}
export async function accept(input: ServiceContext) {
  const row = await contact(input);
  return acceptContactHandoff({ ...input, params: { ...input.params, contactId: row.id } });
}
export async function reopen(input: ServiceContext) {
  const row = await contact(input);
  const current = await resolveConversation(
    input.identity!.vendorId!,
    row.id,
    input.identity!.userId,
    false,
    contactVisibility(input),
  );
  const safe = present(input, current);
  return serviceResult(
    {
      status: 'open',
      message: 'Conversation reopened.',
      conversation: {
        _id: safe.id,
        _uid: safe.uid,
        vendors__id: safe.vendorId,
        first_name: safe.firstName,
        last_name: safe.lastName,
        wa_id: safe.waId,
        email: safe.email,
        conversation_status: safe.conversationStatus,
        conversation_resolution_sequence: safe.conversationResolutionSequence,
        conversation_resolved_at: safe.conversationResolvedAt,
        conversation_resolved_by_user_id: safe.conversationResolvedByUserId,
        disable_ai_bot: safe.disableAiBot,
        assigned_users__id: safe.assignedUserId,
      },
    },
    { status: 200, format: 'json' },
  );
}
