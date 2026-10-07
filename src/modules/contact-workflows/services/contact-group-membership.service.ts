import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import type { ServiceContext } from '../../../shared/service-context.js';
import { currentContactPermissions } from './contact-administration.service.js';
import { assertContactGroupLinksOwned } from './contact-groups.service.js';

type Identifier = number | string;
const selection = (identifiers: Identifier[]) =>
  identifiers.map((identifier) =>
    typeof identifier === 'number' ? { id: identifier } : { uid: identifier },
  );

/** Additive selection: existing memberships remain intact. All selections must be valid. */
export async function changeContactGroupMemberships(
  input: ServiceContext,
  contactIdentifiers: Identifier[],
  groupIdentifiers: Identifier[],
  operation: 'add' | 'remove',
  bulk = false,
) {
  if (
    !contactIdentifiers.length ||
    !groupIdentifiers.length ||
    contactIdentifiers.length > 100 ||
    groupIdentifiers.length > 50
  )
    throw new ApiError(400, 'INVALID_SELECTION', 'Select up to 100 contacts and 50 groups');
  const vendorId = input.identity!.vendorId!;
  return db.$transaction(
    async (tx) => {
      const groups = await tx.contactGroups.findMany({
        where: { vendorId, OR: selection(groupIdentifiers) },
        orderBy: { id: 'asc' },
      });
      const initialContacts = await tx.contacts.findMany({
        where: { vendorId, OR: selection(contactIdentifiers) },
        orderBy: { id: 'asc' },
        select: { id: true },
      });
      if (
        groups.length !== groupIdentifiers.length ||
        initialContacts.length !== contactIdentifiers.length
      )
        throw new ApiError(404, 'NOT_FOUND', 'Selected contacts or groups are unavailable');
      // Match group lifecycle and assignment lock order; reread after locks.
      for (const group of groups)
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(602, ${group.id}::integer)`;
      for (const contact of initialContacts)
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(601, ${contact.id}::integer)`;
      const permissions = await currentContactPermissions(tx, input);
      const has = (permission: string) =>
        permissions.includes('*') || permissions.includes(permission);
      if (
        !has('vendor.contacts.edit') ||
        !has('vendor.groups.manage') ||
        (bulk && !has('vendor.chats.view_all'))
      )
        throw new ApiError(403, 'FORBIDDEN', 'Contact group mutation permission required');
      const currentGroups = await tx.contactGroups.findMany({
        where: { vendorId, id: { in: groups.map((g) => g.id) } },
        orderBy: { id: 'asc' },
      });
      const contacts = await tx.contacts.findMany({
        where: {
          vendorId,
          id: { in: initialContacts.map((c) => c.id) },
          ...(!has('vendor.chats.view_all') ? { assignedUserId: input.identity!.userId } : {}),
        },
        orderBy: { id: 'asc' },
      });
      if (
        contacts.length !== contactIdentifiers.length ||
        currentGroups.length !== groupIdentifiers.length
      )
        throw new ApiError(404, 'NOT_FOUND', 'Selected contacts or groups are unavailable');
      await assertContactGroupLinksOwned(
        tx,
        vendorId,
        currentGroups.map((g) => g.id),
      );
      if (operation === 'add') {
        if (currentGroups.some((g) => g.status !== 1) || contacts.some((c) => c.status !== 1))
          throw new ApiError(
            409,
            'INACTIVE_SELECTION',
            'Adding memberships requires active contacts and groups',
          );
        if (
          currentGroups.some(
            (g) =>
              g.wabPhoneNumberId && contacts.some((c) => c.wabPhoneNumberId !== g.wabPhoneNumberId),
          )
        )
          throw new ApiError(
            409,
            'PHONE_SCOPE_MISMATCH',
            'Group and contact belong to different phone scopes',
          );
      }
      const where = {
        contactId: { in: contacts.map((c) => c.id) },
        groupId: { in: currentGroups.map((g) => g.id) },
      };
      const count =
        operation === 'add'
          ? (
              await tx.groupContacts.createMany({
                data: contacts.flatMap((c) =>
                  currentGroups.map((g) => ({ contactId: c.id, groupId: g.id })),
                ),
                skipDuplicates: true,
              })
            ).count
          : (await tx.groupContacts.deleteMany({ where })).count;
      if (count)
        await tx.auditEvents.create({
          data: {
            vendorId,
            actorId: input.identity!.userId,
            action: operation === 'add' ? 'assign-groups' : 'remove-group',
            resource: 'contact',
            metadata: {
              contactIds: contacts.map((c) => c.id),
              groupIds: currentGroups.map((g) => g.id),
              affectedMemberships: count,
            },
          },
        });
      return { affectedMemberships: count };
    },
    { timeout: 30000 },
  );
}
