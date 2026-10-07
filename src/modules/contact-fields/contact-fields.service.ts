import type { Prisma } from '@prisma/client';
import { db } from '../../database/client.js';
import { ApiError } from '../../shared/api-error.js';
import {
  contactValue,
  lockFieldDefinitions,
  type ContactField,
} from '../contacts/services/contact-values.js';
import { serviceResult, type ServiceContext } from '../../shared/service-context.js';

export const projection = {
  id: true,
  uid: true,
  inputName: true,
  inputType: true,
  name: true,
  createdAt: true,
  updatedAt: true,
};
export async function owned(tx: Prisma.TransactionClient, vendorId: number, id: number) {
  await tx.$queryRaw`SELECT "_id" FROM "contact_custom_fields" WHERE "_id"=${id} AND "vendors__id"=${vendorId} FOR UPDATE`;
  const field = await tx.contactCustomFields.findFirst({ where: { id, vendorId } });
  if (!field) throw new ApiError(404, 'NOT_FOUND', 'Custom field not found');
  return field;
}
export async function nameAvailable(
  tx: Prisma.TransactionClient,
  vendorId: number,
  inputName: string,
  id?: number,
) {
  if (
    await tx.contactCustomFields.findFirst({
      where: { vendorId, inputName, ...(id ? { id: { not: id } } : {}) },
      select: { id: true },
    })
  )
    throw new ApiError(409, 'FIELD_NAME_CONFLICT', 'Custom field name already exists');
}
export async function ownedValues(tx: Prisma.TransactionClient, vendorId: number, fieldId: number) {
  if (
    await tx.contactCustomFieldValues.findFirst({
      where: { contactCustomFieldsId: fieldId, refContactId: { vendorId: { not: vendorId } } },
      select: { id: true },
    })
  )
    throw new ApiError(
      409,
      'FIELD_SCOPE_PENDING',
      'Reconcile cross-business legacy value references before changing this field',
    );
}
export function references(value: unknown, field: ContactField, depth = 0): boolean {
  if (depth > 30)
    throw new ApiError(
      409,
      'FIELD_REFERENCES_PENDING',
      'Nested legacy field references require review',
    );
  if (typeof value === 'string') return value.includes(`{${field.inputName}}`);
  if (Array.isArray(value)) return value.some((v) => references(v, field, depth + 1));
  if (value && typeof value === 'object')
    return Object.entries(value).some(
      ([key, item]) =>
        (['customFieldId', 'custom_field_id', 'contact_custom_fields__id'].includes(key) &&
          (item === field.id || item === String(field.id))) ||
        (['store_in_field', 'custom_field_name'].includes(key) && item === field.inputName) ||
        references(item, field, depth + 1),
    );
  return false;
}
export async function assertUnreferenced(
  tx: Prisma.TransactionClient,
  vendorId: number,
  field: ContactField,
) {
  const [flows, replies, campaigns] = await Promise.all([
    tx.botFlows.findMany({ where: { vendorId }, select: { data: true }, take: 1001 }),
    tx.botReplies.findMany({
      where: { vendorId },
      select: { replyText: true, data: true },
      take: 1001,
    }),
    tx.campaigns.findMany({ where: { vendorId }, select: { data: true }, take: 1001 }),
  ]);
  if ([flows, replies, campaigns].some((rows) => rows.length > 1000))
    throw new ApiError(
      409,
      'FIELD_REFERENCES_PENDING',
      'Large legacy field reference sets require reconciliation',
    );
  if ([...flows, ...replies, ...campaigns].some((row) => references(row, field)))
    throw new ApiError(
      409,
      'FIELD_IN_USE',
      'Remove field references from bot and campaign configurations first',
    );
}
export const definitionLock = lockFieldDefinitions;
export function currentRevision(expected: string, actual: Date) {
  if (new Date(expected).toISOString() !== actual.toISOString())
    throw new ApiError(409, 'FIELD_REVISION_CONFLICT', 'Reload the current field before editing');
}
export async function listContactFields(requestInput: ServiceContext) {
  const q = requestInput.validatedQuery,
    where = { vendorId: requestInput.identity!.vendorId! };
  const [items, total] = await Promise.all([
    db.contactCustomFields.findMany({
      where,
      select: projection,
      take: q.limit,
      skip: (q.page - 1) * q.limit,
      orderBy: { id: 'asc' },
    }),
    db.contactCustomFields.count({ where }),
  ]);
  return serviceResult(
    { items, total, page: q.page, limit: q.limit },
    { status: 200, format: 'json' },
  );
}
export async function getContactField(requestInput: ServiceContext) {
  const field = await db.contactCustomFields.findFirst({
    where: { vendorId: requestInput.identity!.vendorId!, id: Number(requestInput.params.id) },
    select: projection,
  });
  if (!field) throw new ApiError(404, 'NOT_FOUND', 'Custom field not found');
  return serviceResult(field, { status: 200, format: 'json' });
}
export async function createContactField(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!;
  const field = await db.$transaction(async (tx) => {
    await definitionLock(tx, vendorId);
    await nameAvailable(tx, vendorId, requestInput.body.inputName);
    if ((await tx.contactCustomFields.count({ where: { vendorId } })) >= 100)
      throw new ApiError(409, 'FIELD_LIMIT', 'Native custom field limit reached');
    const created = await tx.contactCustomFields.create({
      data: { ...requestInput.body, vendorId },
      select: projection,
    });
    await tx.auditEvents.create({
      data: {
        vendorId,
        actorId: requestInput.identity!.userId,
        action: 'create',
        resource: 'contact-custom-field',
        resourceId: String(created.id),
      },
    });
    return created;
  });
  return serviceResult(field, { status: 201, format: 'json' });
}
export async function updateContactField(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!,
    { revision: expected, ...changes } = requestInput.body;
  const result = await db.$transaction(
    async (tx) => {
      await definitionLock(tx, vendorId);
      const field = await owned(tx, vendorId, Number(requestInput.params.id));
      currentRevision(expected, field.updatedAt);
      await ownedValues(tx, vendorId, field.id);
      if (changes.inputName !== undefined)
        await nameAvailable(tx, vendorId, changes.inputName, field.id);
      if (
        (changes.inputName !== undefined && changes.inputName !== field.inputName) ||
        (changes.inputType !== undefined && changes.inputType !== field.inputType)
      )
        await assertUnreferenced(tx, vendorId, field);
      if (changes.inputType !== undefined && changes.inputType !== field.inputType) {
        const values = await tx.contactCustomFieldValues.findMany({
          where: { contactCustomFieldsId: field.id },
          select: { fieldValue: true },
          take: 5001,
        });
        if (values.length > 5000)
          throw new ApiError(
            409,
            'FIELD_VALUES_PENDING',
            'Large imported value sets require reconciliation before changing type',
          );
        for (const value of values) {
          try {
            contactValue({ ...field, inputType: changes.inputType }, value.fieldValue);
          } catch {
            throw new ApiError(
              409,
              'FIELD_VALUES_INCOMPATIBLE',
              'Existing values do not match the requested field type',
            );
          }
        }
      }
      const updated = await tx.contactCustomFields.update({
        where: { id: field.id },
        data: {
          ...changes,
          updatedAt: new Date(Math.max(Date.now(), field.updatedAt.getTime() + 1)),
        },
        select: projection,
      });
      await tx.auditEvents.create({
        data: {
          vendorId,
          actorId: requestInput.identity!.userId,
          action: 'update',
          resource: 'contact-custom-field',
          resourceId: String(field.id),
          metadata: { changedFields: Object.keys(changes) },
        },
      });
      return updated;
    },
    { timeout: 30000 },
  );
  return serviceResult(result, { status: 200, format: 'json' });
}
export async function deleteContactField(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!;
  await db.$transaction(async (tx) => {
    await definitionLock(tx, vendorId);
    const field = await owned(tx, vendorId, Number(requestInput.params.id));
    currentRevision(requestInput.body.revision, field.updatedAt);
    await ownedValues(tx, vendorId, field.id);
    await assertUnreferenced(tx, vendorId, field);
    if (
      await tx.contactCustomFieldValues.findFirst({
        where: { contactCustomFieldsId: field.id, fieldValue: { not: '' } },
        select: { id: true },
      })
    )
      throw new ApiError(
        409,
        'FIELD_HAS_VALUES',
        'Clear field values before deleting the definition',
      );
    await tx.contactCustomFieldValues.deleteMany({
      where: { contactCustomFieldsId: field.id, OR: [{ fieldValue: null }, { fieldValue: '' }] },
    });
    await tx.contactCustomFields.delete({ where: { id: field.id } });
    await tx.auditEvents.create({
      data: {
        vendorId,
        actorId: requestInput.identity!.userId,
        action: 'delete',
        resource: 'contact-custom-field',
        resourceId: String(field.id),
      },
    });
  });
  return serviceResult(undefined, { status: 204, format: 'empty' });
}
