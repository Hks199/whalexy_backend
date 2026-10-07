import { assignGroupContacts } from './contact-assignment.service.js';
import { mergeContacts } from './contact-lifecycle.service.js';
import type { ContactGroups, Prisma } from '@prisma/client';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import {
  groupProjection,
  createContactGroup,
  updateContactGroup,
  changeContactGroups,
} from './contact-groups.service.js';
const present = (row: Omit<ContactGroups, 'vendorId'>) => ({
  _id: row.id,
  _uid: row.uid,
  title: row.title,
  description: row.description,
  status: row.status,
  wab_phone_number_id: row.wabPhoneNumberId,
  created_at: row.createdAt,
  updated_at: row.updatedAt,
});
export async function list(input: ServiceContext) {
  const q = input.validatedQuery,
    vendorId = input.identity!.vendorId!,
    status = input.params.status === 'archived' ? 5 : 1;
  const base = { vendorId, status };
  const search = q['search[value]'];
  const where: Prisma.ContactGroupsWhereInput = {
    ...base,
    ...(search
      ? {
          OR: [
            { title: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const orderBy: Prisma.ContactGroupsOrderByWithRelationInput[] =
    q['order[0][column]'] === undefined
      ? [{ id: 'asc' }]
      : [
          { [q['order[0][column]'] === 2 ? 'title' : 'description']: q['order[0][dir]'] },
          { id: 'asc' },
        ];
  const [rows, recordsTotal, recordsFiltered] = await db.$transaction([
    db.contactGroups.findMany({
      where,
      select: groupProjection,
      skip: q.start,
      take: q.length,
      orderBy,
    }),
    db.contactGroups.count({ where: base }),
    db.contactGroups.count({ where }),
  ]);
  return serviceResult(
    { draw: q.draw, recordsTotal, recordsFiltered, data: rows.map(present) },
    { status: 200, format: 'json' },
  );
}
export async function show(input: ServiceContext) {
  const identifier = input.params.contactGroupIdOrUid;
  const row = await db.contactGroups.findFirst({
    where: {
      vendorId: input.identity!.vendorId!,
      ...(typeof identifier === 'number' ? { id: identifier } : { uid: identifier }),
    },
    select: groupProjection,
  });
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Contact group not found');
  return serviceResult(present(row), { status: 200, format: 'json' });
}
export async function create(input: ServiceContext) {
  const row = await createContactGroup(input, {
    title: input.body.title,
    description: input.body.description,
  });
  return serviceResult(
    { status: 'success', message: 'Group added.', group: present(row) },
    { status: 201, format: 'json' },
  );
}
export async function update(input: ServiceContext) {
  const row = await updateContactGroup(input, input.body.contactGroupIdOrUid, {
    title: input.body.title,
    description: input.body.description,
  });
  return serviceResult(
    { status: 'success', message: 'Group updated.', group: present(row) },
    { status: 200, format: 'json' },
  );
}
export async function change(
  input: ServiceContext,
  operation: 'delete' | 'archive' | 'unarchive',
  bulk = false,
) {
  const result = await changeContactGroups(
    input,
    bulk ? input.body.selected_groups : [input.params.contactGroupIdOrUid],
    operation,
  );
  return serviceResult(
    {
      status: 'success',
      message: `Groups ${operation === 'delete' ? 'deleted' : operation === 'archive' ? 'archived' : 'unarchived'} successfully.`,
      ...result,
      ...(bulk ? { reloadDatatableId: '#lwGroupList' } : {}),
    },
    { status: 200, format: 'json' },
  );
}

export async function merge(input: ServiceContext) {
  const uids = [input.body.source_group_uid, input.body.target_group_uid];
  const rows = await db.contactGroups.findMany({
    where: { vendorId: input.identity!.vendorId!, uid: { in: uids } },
    select: { id: true, uid: true },
  });
  if (rows.length !== 2)
    throw new ApiError(404, 'NOT_FOUND', 'Source or destination group not found');
  const result = await mergeContacts({
    ...input,
    params: { ...input.params, id: rows.find((r) => r.uid === uids[0])!.id },
    body: { targetGroupId: rows.find((r) => r.uid === uids[1])!.id },
  });
  return serviceResult(
    {
      status: 'success',
      message: 'Groups merged.',
      ...(result.body as { movedContactsCount: number }),
      reloadDatatableId: '#lwGroupList',
    },
    { status: 200, format: 'json' },
  );
}

export async function assignAgent(input: ServiceContext) {
  const result = await assignGroupContacts(input, input.body.group_uid, input.body.agent_uid);
  return serviceResult(
    {
      status: 'success',
      message: 'Group contacts assigned.',
      assignedContactsCount: result.assignedContactsCount,
      reloadDatatableId: '#lwGroupList',
    },
    { status: 200, format: 'json' },
  );
}
