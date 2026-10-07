import { assignSingleContact } from './contact-assignment.service.js';
import {
  createContactLabel,
  updateContactLabel,
  deleteContactLabel,
} from './contact-labels.service.js';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { contactVisibility } from '../../contacts/contacts.service.js';
import { updateContactNotes, updateContactLabels } from './contact-profile.service.js';
async function contact(input: ServiceContext, uid: string) {
  const row = await db.contacts.findFirst({
    where: { ...contactVisibility(input), uid },
    select: { id: true },
  });
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Contact not found');
  return row;
}
export async function notes(input: ServiceContext) {
  const row = await contact(input, input.body.contactIdOrUid);
  await updateContactNotes({
    ...input,
    params: { ...input.params, id: row.id },
    body: { notes: input.body.contact_notes ?? '' },
  });
  return serviceResult(
    { status: 'success', message: 'Notes updated' },
    { status: 200, format: 'json' },
  );
}
export async function assignLabels(input: ServiceContext) {
  const row = await contact(input, input.body.contactUid);
  await updateContactLabels({
    ...input,
    params: { ...input.params, id: row.id },
    body: { labelIds: input.body.contact_labels ?? [] },
  });
  return serviceResult(
    { status: 'success', message: 'Labels updated' },
    { status: 200, format: 'json' },
  );
}
export async function labels(input: ServiceContext) {
  await contact(input, input.params.contactUid);
  const q = input.validatedQuery,
    vendorId = input.identity!.vendorId!;
  const [rows, total] = await db.$transaction([
    db.labels.findMany({
      where: { vendorId },
      orderBy: { id: 'asc' },
      take: q.limit,
      skip: (q.page - 1) * q.limit,
      select: { id: true, uid: true, title: true, textColor: true, bgColor: true, status: true },
    }),
    db.labels.count({ where: { vendorId } }),
  ]);
  return serviceResult(
    {
      contact_uid: input.params.contactUid,
      listOfAllLabels: rows.map((row) => ({
        _id: row.id,
        _uid: row.uid,
        title: row.title,
        text_color: row.textColor,
        bg_color: row.bgColor,
        status: row.status,
      })),
      total,
      page: q.page,
      limit: q.limit,
      has_more: q.page * q.limit < total,
    },
    { status: 200, format: 'json' },
  );
}

export async function createLabel(input: ServiceContext) {
  const row = await createContactLabel(input, {
    title: input.body.title,
    textColor: input.body.text_color,
    bgColor: input.body.bg_color,
  });
  return serviceResult(
    {
      status: 'success',
      message: 'Label created',
      createdLabel: {
        _id: row.id,
        _uid: row.uid,
        title: row.title,
        text_color: row.textColor,
        bg_color: row.bgColor,
        status: row.status,
      },
    },
    { status: 201, format: 'json' },
  );
}
export async function editLabel(input: ServiceContext) {
  const row = await updateContactLabel(input, input.body.labelUid, {
    title: input.body.title,
    textColor: input.body.text_color,
    bgColor: input.body.bg_color,
  });
  return serviceResult(
    { status: 'success', message: 'Label updated', labelUid: row.uid },
    { status: 200, format: 'json' },
  );
}
export async function removeLabel(input: ServiceContext) {
  if (input.body.labelUid && input.body.labelUid !== input.params.labelUid)
    throw new ApiError(400, 'LABEL_ID_CONFLICT', 'Body label must match URL');
  const uid = await deleteContactLabel(input, input.params.labelUid);
  return serviceResult(
    { status: 'success', message: 'Label deleted', labelUid: uid },
    { status: 200, format: 'json' },
  );
}

export async function assignChat(input: ServiceContext) {
  const uid = input.body.assigned_users_uid;
  const result = await assignSingleContact(
    input,
    input.body.contactIdOrUid,
    !uid || uid === 'no_one' ? null : uid,
  );
  return serviceResult(
    {
      status: 'success',
      message: result.currentlyAssignedUserUid ? 'User assigned' : 'Unassigned user',
      ...result,
    },
    { status: 200, format: 'json' },
  );
}
