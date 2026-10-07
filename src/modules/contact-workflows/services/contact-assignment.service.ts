import type { Contacts, Prisma } from '@prisma/client';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import type { ServiceContext } from '../../../shared/service-context.js';
import {
  currentContactPermissions,
  authorizeContactAdministration,
} from './contact-administration.service.js';
import { assertContactGroupLinksOwned } from './contact-groups.service.js';
const allowed = (permissions: Prisma.JsonArray, permission: string) =>
  permissions.includes('*') || permissions.includes(permission);
async function actor(tx: Prisma.TransactionClient, input: ServiceContext, group = false) {
  const permissions = group
    ? await authorizeContactAdministration(tx, input)
    : await currentContactPermissions(tx, input);
  if (!allowed(permissions, 'vendor.chats.assign'))
    throw new ApiError(403, 'FORBIDDEN', 'Contact assignment permission required');
  return permissions;
}
async function agent(
  tx: Prisma.TransactionClient,
  vendorId: number,
  identifier: number | string | null,
) {
  if (identifier === null) return null;
  const user = await tx.users.findFirst({
    where: {
      status: 1,
      ...(typeof identifier === 'number' ? { id: identifier } : { uid: identifier }),
    },
    select: { id: true, uid: true },
  });
  const membership = user
    ? await tx.nativeMemberships.findUnique({
        where: { vendorId_userId: { vendorId, userId: user.id } },
      })
    : null;
  if (
    !user ||
    !membership?.active ||
    !Array.isArray(membership.permissions) ||
    !allowed(membership.permissions, 'vendor.chats.reply')
  )
    throw new ApiError(400, 'INVALID_AGENT', 'Agent is not an active messaging member');
  return user;
}
async function transfer(
  tx: Prisma.TransactionClient,
  input: ServiceContext,
  contacts: Contacts[],
  userId: number | null,
) {
  const vendorId = input.identity!.vendorId!;
  const handoffs = await tx.aiConversationHandoffs.findMany({
    where: {
      vendorId,
      contactId: { in: contacts.map((c) => c.id) },
      status: { in: ['waiting', 'accepted'] },
    },
  });
  const byContact = new Map<number, number>();
  for (const handoff of handoffs) {
    if (byContact.has(handoff.contactId))
      throw new ApiError(
        409,
        'HANDOFF_STATE',
        'Ambiguous imported open handoffs require reconciliation',
      );
    byContact.set(handoff.contactId, handoff.id);
  }
  const at = new Date();
  for (const contact of contacts) {
    await tx.contacts.update({
      where: { id: contact.id },
      data: {
        assignedUserId: userId,
        ...(byContact.has(contact.id) ? { disableAiBot: 1 } : {}),
        updatedAt: at,
      },
    });
  }
  if (handoffs.length)
    await tx.aiConversationHandoffs.updateMany({
      where: {
        id: { in: handoffs.map((h) => h.id) },
        vendorId,
        status: { in: ['waiting', 'accepted'] },
      },
      data: {
        assignedUserId: userId,
        assignedAt: userId ? at : null,
        status: 'waiting',
        acceptedByUsersId: null,
        acceptedAt: null,
        updatedAt: at,
      },
    });
  return handoffs.length;
}
export async function assignGroupContacts(
  input: ServiceContext,
  identifier: number | string,
  userIdentifier: number | string | null,
) {
  const vendorId = input.identity!.vendorId!;
  return db.$transaction(
    async (tx) => {
      const group = await tx.contactGroups.findFirst({
        where: {
          vendorId,
          ...(typeof identifier === 'number' ? { id: identifier } : { uid: identifier }),
        },
      });
      if (!group) throw new ApiError(404, 'NOT_FOUND', 'Group not found');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(602, ${group.id}::integer)`;
      const current = await tx.contactGroups.findFirst({
        where: { vendorId, id: group.id, status: 1 },
      });
      if (!current)
        throw new ApiError(409, 'GROUP_INACTIVE', 'Assignment requires an active group');
      await assertContactGroupLinksOwned(tx, vendorId, [group.id]);
      const rows = await tx.contacts.findMany({
        where: {
          vendorId,
          status: 1,
          ...(current.wabPhoneNumberId ? { wabPhoneNumberId: current.wabPhoneNumberId } : {}),
          childrenGroupContactsContactId: { some: { groupId: group.id } },
        },
        orderBy: { id: 'asc' },
        take: 501,
      });
      if (rows.length > 500)
        throw new ApiError(
          409,
          'ASSIGNMENT_TOO_LARGE',
          'Assign groups of more than 500 active contacts in reviewed batches',
        );
      for (const row of rows)
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(601, ${row.id}::integer)`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(610, ${vendorId}::integer)`;
      await actor(tx, input, true);
      const assignee = await agent(tx, vendorId, userIdentifier);
      await assertContactGroupLinksOwned(tx, vendorId, [group.id]);
      const contacts = await tx.contacts.findMany({
        where: {
          id: { in: rows.map((c) => c.id) },
          vendorId,
          status: 1,
          ...(current.wabPhoneNumberId ? { wabPhoneNumberId: current.wabPhoneNumberId } : {}),
          childrenGroupContactsContactId: { some: { groupId: group.id } },
        },
        orderBy: { id: 'asc' },
      });
      const transferredHandoffs = await transfer(tx, input, contacts, assignee?.id ?? null);
      await tx.auditEvents.create({
        data: {
          vendorId,
          actorId: input.identity!.userId,
          action: 'assign',
          resource: 'ContactGroups',
          resourceId: String(group.id),
          metadata: {
            userId: assignee?.id ?? null,
            assignedContactsCount: contacts.length,
            transferredHandoffs,
          },
        },
      });
      return { assignedContactsCount: contacts.length, agentUid: assignee?.uid ?? null };
    },
    { timeout: 30000 },
  );
}
export async function assignSingleContact(
  input: ServiceContext,
  identifier: number | string,
  userIdentifier: number | string | null,
) {
  const vendorId = input.identity!.vendorId!;
  return db.$transaction(
    async (tx) => {
      const first = await tx.contacts.findFirst({
        where: {
          vendorId,
          ...(typeof identifier === 'number' ? { id: identifier } : { uid: identifier }),
        },
        select: { id: true },
      });
      if (!first) throw new ApiError(404, 'NOT_FOUND', 'Contact not found');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(601, ${first.id}::integer)`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(610, ${vendorId}::integer)`;
      const permissions = await actor(tx, input);
      const contact = await tx.contacts.findFirst({
        where: {
          vendorId,
          id: first.id,
          ...(!allowed(permissions, 'vendor.chats.view_all')
            ? { assignedUserId: input.identity!.userId }
            : {}),
        },
      });
      if (!contact) throw new ApiError(404, 'NOT_FOUND', 'Contact not found');
      if (contact.status !== 1)
        throw new ApiError(409, 'CONTACT_INACTIVE', 'Assignment requires an active contact');
      const assignee = await agent(tx, vendorId, userIdentifier);
      const transferredHandoffs = await transfer(tx, input, [contact], assignee?.id ?? null);
      await tx.auditEvents.create({
        data: {
          vendorId,
          actorId: input.identity!.userId,
          action: 'assign',
          resource: 'contact',
          resourceId: String(contact.id),
          metadata: { userId: assignee?.id ?? null, transferredHandoffs },
        },
      });
      return { contactUid: contact.uid, currentlyAssignedUserUid: assignee?.uid ?? null };
    },
    { timeout: 30000 },
  );
}
