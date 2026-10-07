import type { Prisma } from '@prisma/client';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { contactVisibility } from '../contacts.service.js';
import { aiRequest, aiServiceUrl } from '../../../infrastructure/providers/ai.client.js';
import { metaOperation } from '../../../infrastructure/providers/meta-operations.js';
import { resolveHandoff } from '../../handoffs/services/handoffs.js';
import { resolveConversationInTransaction } from './conversation-resolution.js';
import { presentLegacyCxAnalysis } from '../../cx-scores/services/legacy-cx-scores.service.js';

async function currentContact(tx: Prisma.TransactionClient, input: ServiceContext, id: number) {
  const identity = input.identity!,
    vendorId = identity.vendorId!;
  const [membership, user, vendor] = await Promise.all([
    tx.nativeMemberships.findUnique({
      where: { vendorId_userId: { vendorId, userId: identity.userId } },
    }),
    tx.users.findFirst({ where: { id: identity.userId, status: 1 }, select: { id: true } }),
    tx.vendors.findFirst({ where: { id: vendorId, status: 1 }, select: { id: true } }),
  ]);
  if (!membership?.active || !Array.isArray(membership.permissions) || !user || !vendor)
    throw new ApiError(403, 'FORBIDDEN', 'Conversation access changed');
  let permissions = membership.permissions;
  if (identity.apiKeyId) {
    const key = await tx.apiKeys.findFirst({
      where: {
        id: identity.apiKeyId,
        vendorId,
        userId: identity.userId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    if (!key || !Array.isArray(key.permissions))
      throw new ApiError(403, 'FORBIDDEN', 'API access changed');
    const keyPermissions = key.permissions;
    permissions = permissions.includes('*')
      ? keyPermissions
      : keyPermissions.includes('*')
        ? permissions
        : permissions.filter((p) => keyPermissions.includes(p));
  }
  const permits = (p: string) => permissions.includes('*') || permissions.includes(p);
  if (!permits('vendor.chats.reply'))
    throw new ApiError(403, 'FORBIDDEN', 'Conversation reply access required');
  const scope = {
    vendorId,
    ...(!permits('vendor.chats.view_all') ? { assignedUserId: identity.userId } : {}),
  };
  const contact = await tx.contacts.findFirst({ where: { id, ...scope } });
  if (!contact) throw new ApiError(404, 'NOT_FOUND', 'Conversation not found');
  if (contact.status !== 1)
    throw new ApiError(409, 'CONTACT_INACTIVE', 'Conversation contact is inactive');
  if (contact.disableAiBot && !permits('vendor.ai.manage'))
    throw new ApiError(
      403,
      'FORBIDDEN',
      'AI management permission is required to resume automation',
    );
  return { contact, scope };
}

export async function resolveLegacyConversation(input: ServiceContext) {
  const identifier = input.params.conversationId,
    vendorId = input.identity!.vendorId!;
  const contact = await db.contacts.findFirst({
    where: {
      ...contactVisibility(input),
      ...(typeof identifier === 'number' ? { id: identifier } : { uid: identifier }),
    },
    select: { id: true },
  });
  if (!contact) throw new ApiError(404, 'NOT_FOUND', 'Conversation not found');
  // Replays contain a safe response. Scope is checked above even when no effect repeats.
  const result = await metaOperation(
    input,
    `conversation-resolution:${contact.id}`,
    { contactId: contact.id },
    async (effect) => {
      const snapshot = await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(601, ${contact.id}::integer)`;
        return (await currentContact(tx, input, contact.id)).contact;
      });
      const remoteResumed = Boolean(snapshot.disableAiBot);
      if (remoteResumed) {
        if (!snapshot.waId || (snapshot.platform && snapshot.platform !== 'whatsapp'))
          throw new ApiError(
            409,
            'AI_RECIPIENT_REQUIRED',
            'AI resume requires a WhatsApp contact identity',
          );
        aiServiceUrl(vendorId, 'conversations/automation');
        const ack = await effect(() =>
          aiRequest(vendorId, 'conversations/automation', 'POST', {
            customer_phone: snapshot.waId,
            enabled: true,
            state: 'AI_ACTIVE',
          }),
        );
        if (
          !ack ||
          typeof ack !== 'object' ||
          Array.isArray(ack) ||
          ack.success === false ||
          ack.enabled === false ||
          ack.status === 'error'
        )
          throw new ApiError(
            502,
            'PROVIDER_UNCERTAIN',
            'AI resume acknowledgement requires reconciliation',
          );
      }
      return {
        contactId: contact.id,
        version: snapshot.updatedAt.toISOString(),
        remoteResumed,
        response: null as any,
      };
    },
    async (tx, value) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(601, ${contact.id}::integer)`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(610, ${vendorId}::integer)`;
      const current = await currentContact(tx, input, contact.id);
      if (current.contact.updatedAt.toISOString() !== value.version)
        throw new ApiError(
          409,
          'RESOLUTION_STATE_CHANGED',
          'Conversation changed during resolution; reconcile the provider operation',
        );
      if (value.remoteResumed)
        await tx.contacts.update({
          where: { id: contact.id },
          data: { disableAiBot: 0, updatedAt: new Date() },
        });
      await resolveHandoff(tx, vendorId, contact.id);
      const resolved = await resolveConversationInTransaction(
        tx,
        vendorId,
        contact.id,
        input.identity!.userId,
        true,
        current.scope,
      );
      const score = await tx.conversationCxScores.findUniqueOrThrow({
        where: {
          vendorId_conversationId_resolutionSequence: {
            vendorId,
            conversationId: contact.id,
            resolutionSequence: resolved.conversationResolutionSequence,
          },
        },
      });
      value.response = JSON.parse(
        JSON.stringify({
          status: 'resolved',
          message: 'Conversation resolved. Generating CX Score...',
          analysis: presentLegacyCxAnalysis(score),
          ai_enabled: true,
          handoff: null,
        }),
      );
    },
  );
  return serviceResult(result.response, { status: 202, format: 'json' });
}
