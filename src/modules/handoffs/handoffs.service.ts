import { db } from '../../database/client.js';
import { ApiError } from '../../shared/api-error.js';
import { resolveHandoff as closeHandoffRecords } from './services/handoffs.js';
import { contactVisibility } from '../contacts/contacts.service.js';
import { serviceResult, type ServiceContext } from '../../shared/service-context.js';

export async function listHandoffs(requestInput: ServiceContext) {
  const q = requestInput.validatedQuery;
  return serviceResult(
    await db.aiConversationHandoffs.findMany({
      where: {
        vendorId: requestInput.identity!.vendorId!,
        ...(q.status ? { status: q.status } : {}),
        refContactId: contactVisibility(requestInput),
      },
      take: q.limit,
      skip: (q.page - 1) * q.limit,
      orderBy: { requestedAt: 'desc' },
    }),
    { status: 200, format: 'json' },
  );
}
export async function transferHandoff(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!;
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(610, ${vendorId}::integer)`;
    const handoff = await tx.aiConversationHandoffs.findFirst({
      where: {
        id: Number(requestInput.params.id),
        vendorId,
        refContactId: contactVisibility(requestInput),
      },
    });
    if (!handoff) throw new ApiError(404, 'NOT_FOUND', 'Handoff not found');
    if (requestInput.body.userId) {
      const member = await tx.nativeMemberships.findUnique({
        where: { vendorId_userId: { vendorId, userId: requestInput.body.userId } },
      });
      if (
        !member?.active ||
        !Array.isArray(member.permissions) ||
        !member.permissions.some((p) => p === '*' || p === 'vendor.chats.reply') ||
        !(await tx.users.findFirst({ where: { id: requestInput.body.userId, status: 1 } }))
      )
        throw new ApiError(400, 'INVALID_AGENT', 'Agent is not an active messaging member');
    }
    const changed = await tx.aiConversationHandoffs.updateMany({
      where: { id: handoff.id, vendorId, status: { in: ['waiting', 'accepted'] } },
      data: {
        assignedUserId: requestInput.body.userId,
        assignedAt: requestInput.body.userId ? new Date() : null,
        status: 'waiting',
        acceptedByUsersId: null,
        acceptedAt: null,
        updatedAt: new Date(),
      },
    });
    if (!changed.count)
      throw new ApiError(409, 'HANDOFF_STATE', 'Only open handoffs can be transferred');
    await tx.contacts.update({
      where: { id: handoff.contactId },
      data: { assignedUserId: requestInput.body.userId, disableAiBot: 1, updatedAt: new Date() },
    });
    await tx.auditEvents.create({
      data: {
        vendorId,
        actorId: requestInput.identity!.userId,
        action: 'transfer',
        resource: 'handoff',
        resourceId: String(handoff.id),
      },
    });
  });
  return serviceResult(undefined, { status: 204, format: 'end' });
}
export async function resolveHandoff(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!;
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(610, ${vendorId}::integer)`;
    const handoff = await tx.aiConversationHandoffs.findFirst({
      where: {
        id: Number(requestInput.params.id),
        vendorId,
        refContactId: contactVisibility(requestInput),
      },
    });
    if (!handoff) throw new ApiError(404, 'NOT_FOUND', 'Handoff not found');
    if (!['waiting', 'accepted'].includes(handoff.status))
      throw new ApiError(409, 'HANDOFF_STATE', 'Handoff is already closed');
    const changed = await closeHandoffRecords(tx, vendorId, handoff.contactId);
    if (!changed.count) throw new ApiError(409, 'HANDOFF_STATE', 'Handoff is already closed');
    if (requestInput.body.resumeAi)
      await tx.contacts.update({
        where: { id: handoff.contactId },
        data: { disableAiBot: 0, updatedAt: new Date() },
      });
    await tx.auditEvents.create({
      data: {
        vendorId,
        actorId: requestInput.identity!.userId,
        action: 'resolve',
        resource: 'handoff',
        resourceId: String(handoff.id),
      },
    });
  });
  return serviceResult(undefined, { status: 204, format: 'end' });
}
