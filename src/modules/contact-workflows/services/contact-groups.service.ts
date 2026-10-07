import type { Prisma } from '@prisma/client';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import type { ServiceContext } from '../../../shared/service-context.js';
import { authorizeContactAdministration } from './contact-administration.service.js';
export const groupProjection = {
  id: true,
  uid: true,
  title: true,
  description: true,
  status: true,
  wabPhoneNumberId: true,
  createdAt: true,
  updatedAt: true,
};
export type GroupChanges = {
  title?: string;
  description?: string | null;
  status?: number;
  wabPhoneNumberId?: string | null;
};
async function lock(tx: Prisma.TransactionClient, vendorId: number) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`contact-groups:${vendorId}`},0))`;
}
async function owned(tx: Prisma.TransactionClient, vendorId: number, identifier: number | string) {
  const row = await tx.contactGroups.findFirst({
    where: {
      vendorId,
      ...(typeof identifier === 'number' ? { id: identifier } : { uid: identifier }),
    },
  });
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Contact group not found');
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(602, ${row.id}::integer)`;
  const current = await tx.contactGroups.findFirst({ where: { vendorId, id: row.id } });
  if (!current) throw new ApiError(404, 'NOT_FOUND', 'Contact group not found');
  return current;
}
export async function assertContactGroupLinksOwned(
  tx: Prisma.TransactionClient,
  vendorId: number,
  ids: number[],
) {
  if (
    await tx.groupContacts.findFirst({
      where: { groupId: { in: ids }, refContactId: { vendorId: { not: vendorId } } },
      select: { id: true },
    })
  )
    throw new ApiError(
      409,
      'GROUP_SCOPE_PENDING',
      'Reconcile cross-business imported group links first',
    );
}
function referenced(value: unknown, identifiers: Set<string>, depth = 0): boolean {
  if (depth > 30)
    throw new ApiError(
      409,
      'GROUP_REFERENCES_PENDING',
      'Nested imported group references need reconciliation',
    );
  if (Array.isArray(value)) return value.some((item) => referenced(item, identifiers, depth + 1));
  if (value && typeof value === 'object')
    return Object.entries(value).some(([key, item]) => {
      if (
        [
          'groupIds',
          'group_ids',
          'groupId',
          'group_id',
          'contact_groups__id',
          'selected_groups',
          'group_uid',
        ].includes(key)
      ) {
        if ((Array.isArray(item) ? item : [item]).some((id) => identifiers.has(String(id))))
          return true;
      }
      return referenced(item, identifiers, depth + 1);
    });
  return false;
}
export async function assertContactGroupsUnreferenced(
  tx: Prisma.TransactionClient,
  vendorId: number,
  groups: { id: number; uid: string }[],
) {
  const campaigns = await tx.campaigns.findMany({
    where: { vendorId },
    select: { data: true },
    take: 1001,
  });
  if (campaigns.length > 1000)
    throw new ApiError(
      409,
      'GROUP_REFERENCES_PENDING',
      'Large imported campaign reference sets need reconciliation',
    );
  const ids = new Set(groups.flatMap((g) => [String(g.id), g.uid]));
  if (campaigns.some((row) => referenced(row.data, ids)))
    throw new ApiError(
      409,
      'GROUP_IN_USE',
      'Remove group references from campaign configurations first',
    );
}
export async function createContactGroup(
  input: ServiceContext,
  changes: GroupChanges & { title: string },
) {
  const vendorId = input.identity!.vendorId!;
  return db.$transaction(
    async (tx) => {
      await lock(tx, vendorId);
      await authorizeContactAdministration(tx, input);
      const row = await tx.contactGroups.create({
        data: { ...changes, vendorId, status: changes.status ?? 1 },
        select: groupProjection,
      });
      await tx.auditEvents.create({
        data: {
          vendorId,
          actorId: input.identity!.userId,
          action: 'create',
          resource: 'ContactGroups',
          resourceId: String(row.id),
        },
      });
      return row;
    },
    { timeout: 30000 },
  );
}
export async function updateContactGroup(
  input: ServiceContext,
  identifier: number | string,
  changes: GroupChanges,
) {
  const vendorId = input.identity!.vendorId!;
  return db.$transaction(
    async (tx) => {
      await lock(tx, vendorId);
      await authorizeContactAdministration(tx, input);
      const row = await owned(tx, vendorId, identifier);
      await assertContactGroupLinksOwned(tx, vendorId, [row.id]);
      if (
        changes.wabPhoneNumberId !== undefined &&
        changes.wabPhoneNumberId !== row.wabPhoneNumberId
      ) {
        await assertContactGroupsUnreferenced(tx, vendorId, [row]);
        if (await tx.groupContacts.count({ where: { groupId: row.id } }))
          throw new ApiError(
            409,
            'GROUP_HAS_CONTACTS',
            'Remove group memberships before changing phone scope',
          );
      }
      const updated = await tx.contactGroups.update({
        where: { id: row.id },
        data: {
          ...changes,
          updatedAt: new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1)),
        },
        select: groupProjection,
      });
      await tx.auditEvents.create({
        data: {
          vendorId,
          actorId: input.identity!.userId,
          action: 'update',
          resource: 'ContactGroups',
          resourceId: String(row.id),
          metadata: { changedFields: Object.keys(changes) },
        },
      });
      return updated;
    },
    { timeout: 30000 },
  );
}
export async function changeContactGroups(
  input: ServiceContext,
  identifiers: (number | string)[],
  operation: 'delete' | 'archive' | 'unarchive',
) {
  const vendorId = input.identity!.vendorId!;
  return db.$transaction(
    async (tx) => {
      await lock(tx, vendorId);
      await authorizeContactAdministration(tx, input);
      // Resolve every selection before mutating any row. Lock numeric IDs in a stable order.
      const rows = await tx.contactGroups.findMany({
        where: {
          vendorId,
          OR: identifiers.map((id) => (typeof id === 'number' ? { id } : { uid: id })),
        },
        orderBy: { id: 'asc' },
      });
      if (rows.length !== identifiers.length)
        throw new ApiError(404, 'NOT_FOUND', 'One or more selected groups are unavailable');
      for (const row of rows) await owned(tx, vendorId, row.id);
      const ids = rows.map((row) => row.id);
      await assertContactGroupLinksOwned(tx, vendorId, ids);
      let removedMemberships = 0;
      if (operation === 'delete') {
        await assertContactGroupsUnreferenced(tx, vendorId, rows);
        removedMemberships = (
          await tx.groupContacts.deleteMany({ where: { groupId: { in: ids } } })
        ).count;
        await tx.contactGroups.deleteMany({ where: { vendorId, id: { in: ids } } });
      } else
        await tx.contactGroups.updateMany({
          where: { vendorId, id: { in: ids } },
          data: { status: operation === 'archive' ? 5 : 1, updatedAt: new Date() },
        });
      await tx.auditEvents.create({
        data: {
          vendorId,
          actorId: input.identity!.userId,
          action: operation,
          resource: 'ContactGroups',
          metadata: { groupIds: ids, removedMemberships },
        },
      });
      return { affectedGroups: ids.length, removedMemberships };
    },
    { timeout: 30000 },
  );
}
