import type { ContactCustomFields, Prisma } from '@prisma/client';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import {
  projection,
  createContactField,
  updateContactField,
  deleteContactField,
} from '../contact-fields.service.js';

type Field = Pick<
  ContactCustomFields,
  'id' | 'uid' | 'inputName' | 'inputType' | 'createdAt' | 'updatedAt'
>;
const present = (field: Field) => ({
  _id: field.id,
  _uid: field.uid,
  input_name: field.inputName,
  input_type: field.inputType,
  created_at: field.createdAt,
  updated_at: field.updatedAt,
});
async function owned(input: ServiceContext, identifier: number | string) {
  const row = await db.contactCustomFields.findFirst({
    where: {
      vendorId: input.identity!.vendorId!,
      ...(typeof identifier === 'number' ? { id: identifier } : { uid: identifier }),
    },
    select: projection,
  });
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Contact custom field not found');
  return row;
}
export async function list(input: ServiceContext) {
  const q = input.validatedQuery,
    vendorId = input.identity!.vendorId!;
  const search = q['search[value]'];
  const where: Prisma.ContactCustomFieldsWhereInput = {
    vendorId,
    ...(search
      ? {
          OR: [
            { inputName: { contains: search, mode: 'insensitive' } },
            { inputType: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const orderBy: Prisma.ContactCustomFieldsOrderByWithRelationInput[] =
    q['order[0][column]'] === undefined
      ? [{ id: 'asc' }]
      : [
          { [q['order[0][column]'] === 0 ? 'inputName' : 'inputType']: q['order[0][dir]'] },
          { id: 'asc' },
        ];
  const [rows, recordsTotal, recordsFiltered] = await db.$transaction([
    db.contactCustomFields.findMany({
      where,
      select: projection,
      skip: q.start,
      take: q.length,
      orderBy,
    }),
    db.contactCustomFields.count({ where: { vendorId } }),
    db.contactCustomFields.count({ where }),
  ]);
  return serviceResult(
    { draw: q.draw, recordsTotal, recordsFiltered, data: rows.map(present) },
    { status: 200, format: 'json' },
  );
}
export async function show(input: ServiceContext) {
  return serviceResult(present(await owned(input, input.params.contactCustomFieldIdOrUid)), {
    status: 200,
    format: 'json',
  });
}
export async function create(input: ServiceContext) {
  const result = await createContactField({
    ...input,
    body: { inputName: input.body.input_name, inputType: input.body.input_type },
  });
  return serviceResult(
    {
      status: 'success',
      message: 'Contact Custom Field added.',
      field: present(result.body as Field),
    },
    { status: 201, format: 'json' },
  );
}
export async function update(input: ServiceContext) {
  const field = await owned(input, input.body.contactCustomFieldIdOrUid);
  const result = await updateContactField({
    ...input,
    params: { ...input.params, id: field.id },
    body: {
      inputName: input.body.input_name,
      inputType: input.body.input_type,
      revision: input.body.revision,
    },
  });
  return serviceResult(
    {
      status: 'success',
      message: 'Contact Custom Field updated.',
      field: present(result.body as Field),
    },
    { status: 200, format: 'json' },
  );
}
export async function remove(input: ServiceContext) {
  const field = await owned(input, input.params.contactCustomFieldIdOrUid);
  await deleteContactField({ ...input, params: { ...input.params, id: field.id } });
  return serviceResult(
    { status: 'success', message: 'Contact Custom Field deleted successfully' },
    { status: 200, format: 'json' },
  );
}
