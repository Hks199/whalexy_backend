import { db } from '../../database/client.js';
import { ApiError } from '../../shared/api-error.js';
import { contactVisibility, visibleContact } from '../contacts/contacts.service.js';
import { classificationPresets } from '../../data/classification-presets.js';
import { attributes } from './classifications.validation.js';
import { serviceResult, type ServiceContext } from '../../shared/service-context.js';

export const defaults = {
  intent: 'New Inquiry',
  sentiment: 'Positive',
  urgency: 'Medium',
  riskLevel: 'Low Risk',
};
export function preset(type: keyof typeof attributes, value: string) {
  return type === 'intent'
    ? Object.values(classificationPresets.intent).some((group) => value in group)
    : value in classificationPresets[type];
}
export async function listClassificationPresets(requestInput: ServiceContext) {
  return serviceResult(
    {
      presets: classificationPresets,
      customTags: await db.conversationClassificationTags.findMany({
        where: { vendorId: requestInput.identity!.vendorId! },
        orderBy: { id: 'asc' },
      }),
    },
    { status: 200, format: 'json' },
  );
}
export async function getContactClassification(requestInput: ServiceContext) {
  const c = await visibleContact(requestInput, Number(requestInput.params.id)),
    vendorId = requestInput.identity!.vendorId!,
    q = requestInput.validatedQuery;
  const [row, logs, total] = await Promise.all([
    db.conversationClassifications.findUnique({
      where: { vendorId_contactId: { vendorId, contactId: c.id } },
    }),
    db.conversationClassificationLogs.findMany({
      where: { vendorId, contactId: c.id },
      orderBy: { id: 'desc' },
      take: q.limit,
      skip: (q.page - 1) * q.limit,
    }),
    db.conversationClassificationLogs.count({ where: { vendorId, contactId: c.id } }),
  ]);
  return serviceResult(
    { classification: row ?? defaults, logs, total, page: q.page, limit: q.limit },
    { status: 200, format: 'json' },
  );
}
export async function updateContactClassification(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!,
    id = Number(requestInput.params.id),
    type = requestInput.body.attribute as keyof typeof attributes,
    field = attributes[type];
  const row = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`classification:${vendorId}`},0))`;
    if (
      !(await tx.contacts.findFirst({
        where: { AND: [{ vendorId, id }, contactVisibility(requestInput)] },
        select: { id: true },
      }))
    )
      throw new ApiError(404, 'NOT_FOUND', 'Contact not found');
    const value = requestInput.body.value;
    if (
      value !== null &&
      !preset(type, value) &&
      !(await tx.conversationClassificationTags.findFirst({
        where: { vendorId, type, name: value },
        select: { id: true },
      }))
    )
      throw new ApiError(
        400,
        'INVALID_CLASSIFICATION',
        'Value is not an owned classification tag or preset',
      );
    const old = await tx.conversationClassifications.findUnique({
      where: { vendorId_contactId: { vendorId, contactId: id } },
    });
    if (old?.[field] === value) return old;
    const saved = await tx.conversationClassifications.upsert({
      where: { vendorId_contactId: { vendorId, contactId: id } },
      create: {
        vendorId,
        contactId: id,
        ...defaults,
        [field]: value,
        updatedByUsersId: requestInput.identity!.userId,
      },
      update: {
        [field]: value,
        updatedByUsersId: requestInput.identity!.userId,
        updatedAt: new Date(),
      },
    });
    await tx.conversationClassificationLogs.create({
      data: {
        vendorId,
        contactId: id,
        type,
        oldValue: old?.[field] ?? null,
        newValue: value,
        changedByUsersId: requestInput.identity!.userId,
      },
    });
    return saved;
  });
  return serviceResult(row, { status: 200, format: 'json' });
}
export async function createClassificationTag(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!;
  const row = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`classification:${vendorId}`},0))`;
    if (
      preset(requestInput.body.type, requestInput.body.name) ||
      (await tx.conversationClassificationTags.findFirst({
        where: { vendorId, type: requestInput.body.type, name: requestInput.body.name },
        select: { id: true },
      }))
    )
      throw new ApiError(409, 'TAG_EXISTS', 'Classification tag already exists');
    const row = await tx.conversationClassificationTags.create({
      data: { vendorId, ...requestInput.body, createdByUsersId: requestInput.identity!.userId },
    });
    await tx.auditEvents.create({
      data: {
        vendorId,
        actorId: requestInput.identity!.userId,
        action: 'create',
        resource: 'classification-tag',
        resourceId: String(row.id),
      },
    });
    return row;
  });
  return serviceResult(row, { status: 201, format: 'json' });
}
export async function deleteClassificationTag(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!,
    id = Number(requestInput.params.id);
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`classification:${vendorId}`},0))`;
    const tag = await tx.conversationClassificationTags.findFirst({ where: { vendorId, id } });
    if (!tag) throw new ApiError(404, 'NOT_FOUND', 'Tag not found');
    const field = attributes[tag.type as keyof typeof attributes];
    if (!field) throw new ApiError(409, 'INVALID_CLASSIFICATION', 'Tag type needs reconciliation');
    if (
      await tx.conversationClassifications.findFirst({
        where: { vendorId, [field]: tag.name },
        select: { id: true },
      })
    )
      throw new ApiError(
        409,
        'TAG_IN_USE',
        'Replace this tag on its conversations before deleting it',
      );
    await tx.conversationClassificationTags.delete({ where: { id } });
    await tx.auditEvents.create({
      data: {
        vendorId,
        actorId: requestInput.identity!.userId,
        action: 'delete',
        resource: 'classification-tag',
        resourceId: String(id),
      },
    });
  });
  return serviceResult(undefined, { status: 204, format: 'empty' });
}
