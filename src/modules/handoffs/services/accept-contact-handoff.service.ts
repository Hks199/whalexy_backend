import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { acceptHandoff } from './handoffs.js';

export async function acceptContactHandoff(input: ServiceContext) {
  const identity = input.identity!,
    vendorId = identity.vendorId!,
    contactId = Number(input.params.contactId);
  const result = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(601, ${contactId}::integer)`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(610, ${vendorId}::integer)`;
    const [member, user, vendor] = await Promise.all([
      tx.nativeMemberships.findUnique({
        where: { vendorId_userId: { vendorId, userId: identity.userId } },
      }),
      tx.users.findFirst({
        where: { id: identity.userId, status: 1 },
        select: { name: true, firstName: true, lastName: true },
      }),
      tx.vendors.findFirst({ where: { id: vendorId, status: 1 }, select: { id: true } }),
    ]);
    if (!member?.active || !Array.isArray(member.permissions) || !user || !vendor)
      throw new ApiError(403, 'FORBIDDEN', 'Messaging access is unavailable');
    let permissions = member.permissions;
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
        throw new ApiError(403, 'FORBIDDEN', 'API access is unavailable');
      const keyPermissions = key.permissions;
      permissions = permissions.includes('*')
        ? keyPermissions
        : keyPermissions.includes('*')
          ? permissions
          : permissions.filter((p) => keyPermissions.includes(p));
    }
    const permits = (p: string) => permissions.includes('*') || permissions.includes(p);
    if (!permits('vendor.chats.reply'))
      throw new ApiError(403, 'FORBIDDEN', 'Messaging access is unavailable');
    const contact = await tx.contacts.findFirst({
      where: {
        id: contactId,
        vendorId,
        ...(!permits('vendor.chats.view_all') ? { assignedUserId: identity.userId } : {}),
      },
      select: { id: true, status: true, disableAiBot: true },
    });
    if (!contact) throw new ApiError(404, 'NOT_FOUND', 'Contact not found');
    if (contact.status !== 1) throw new ApiError(409, 'CONTACT_INACTIVE', 'Contact is inactive');
    if (contact.disableAiBot !== 1)
      throw new ApiError(
        409,
        'HANDOFF_AUTOMATION_STATE',
        'Pause native AI automation before accepting this handoff',
      );
    const handoffs = await tx.aiConversationHandoffs.findMany({
      where: { vendorId, contactId, status: { in: ['waiting', 'accepted'] } },
      take: 2,
    });
    if (handoffs.length !== 1 || handoffs[0].status !== 'waiting')
      throw new ApiError(
        409,
        'HANDOFF_STATE',
        'This handoff is no longer waiting or requires reconciliation',
      );
    if (!(await acceptHandoff(tx, vendorId, contactId, identity.userId)))
      throw new ApiError(409, 'HANDOFF_STATE', 'This handoff is no longer waiting');
    const handoff = await tx.aiConversationHandoffs.findUniqueOrThrow({
      where: { id: handoffs[0].id },
    });
    await tx.auditEvents.create({
      data: {
        vendorId,
        actorId: identity.userId,
        action: 'accept',
        resource: 'handoff',
        resourceId: String(handoff.id),
      },
    });
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.name || null;
    return {
      status: 'accepted',
      message: 'Conversation accepted. You are now handling it.',
      handoff: {
        uid: handoff.uid,
        status: handoff.status,
        reason: handoff.reason,
        severity: handoff.severity,
        requested_at: handoff.requestedAt,
        assigned_at: handoff.assignedAt,
        accepted_at: handoff.acceptedAt,
        assigned_user_id: handoff.assignedUserId,
        assigned_user_name: name,
        accepted_user_name: name,
      },
    };
  });
  return serviceResult(result, { status: 200, format: 'json' });
}
