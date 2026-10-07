import { lockContactLabels } from './contact-labels.service.js';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { visibleContact } from '../../contacts/contacts.service.js';
import { contactValue, lockedContactFields } from '../../contacts/services/contact-values.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import {
  lockedContact,
  serializableTransactionOptions,
} from './contact-workflows-support.service.js';

export async function getContactNotes(requestInput: ServiceContext) {
  const contact = await visibleContact(requestInput, Number(requestInput.params.id));
  const data = contact.data as Record<string, unknown> | null;
  return serviceResult(
    { notes: typeof data?.contact_notes === 'string' ? data.contact_notes : '' },
    { status: 200, format: 'json' },
  );
}

export async function updateContactNotes(requestInput: ServiceContext) {
  await db.$transaction(async (tx) => {
    const contact = await lockedContact(tx, requestInput);
    const previous =
      contact.data && !Array.isArray(contact.data) && typeof contact.data === 'object'
        ? contact.data
        : {};
    await tx.contacts.update({
      where: { id: contact.id },
      data: {
        data: { ...previous, contact_notes: requestInput.body.notes },
        updatedAt: new Date(),
      },
    });
  }, serializableTransactionOptions);
  return serviceResult(undefined, { status: 204, format: 'end' });
}

export async function getContactLabels(requestInput: ServiceContext) {
  const contact = await visibleContact(requestInput, Number(requestInput.params.id));
  const links = await db.contactLabels.findMany({
    where: { contactId: contact.id },
    select: { labelsId: true },
  });
  return serviceResult(
    await db.labels.findMany({
      where: {
        vendorId: requestInput.identity!.vendorId!,
        id: { in: links.map((l) => l.labelsId) },
      },
      select: { id: true, uid: true, title: true, textColor: true, bgColor: true },
    }),
    { status: 200, format: 'json' },
  );
}

export async function updateContactLabels(requestInput: ServiceContext) {
  await db.$transaction(async (tx) => {
    const contact = await lockedContact(tx, requestInput);
    await lockContactLabels(tx, requestInput.identity!.vendorId!);
    const labelIds: number[] = requestInput.body.labelIds;
    if (
      (await tx.labels.count({
        where: { vendorId: requestInput.identity!.vendorId!, id: { in: labelIds }, status: 1 },
      })) !== labelIds.length
    )
      throw new ApiError(400, 'INVALID_LABEL', 'Label is unavailable in this business');
    await tx.contactLabels.deleteMany({ where: { contactId: contact.id } });
    if (labelIds.length)
      await tx.contactLabels.createMany({
        data: labelIds.map((labelsId) => ({ contactId: contact.id, labelsId })),
        skipDuplicates: true,
      });
  }, serializableTransactionOptions);
  return serviceResult(undefined, { status: 204, format: 'end' });
}

export async function getContactCustomValues(requestInput: ServiceContext) {
  const contact = await visibleContact(requestInput, Number(requestInput.params.id));
  return serviceResult(
    await db.contactCustomFieldValues.findMany({
      where: {
        contactId: contact.id,
        refContactCustomFieldsId: { vendorId: requestInput.identity!.vendorId! },
      },
      select: { contactCustomFieldsId: true, fieldValue: true },
    }),
    { status: 200, format: 'json' },
  );
}

export async function updateContactCustomValues(requestInput: ServiceContext) {
  await db.$transaction(async (tx) => {
    const contact = await lockedContact(tx, requestInput);
    const values: {
      fieldId: number;
      value: string | null;
    }[] = requestInput.body.values;
    const fields = await lockedContactFields(
      tx,
      requestInput.identity!.vendorId!,
      values.map((v) => v.fieldId),
    );
    const normalized = values.map((v) => ({
      ...v,
      value: contactValue(
        fields.find((f) => f.id === v.fieldId)!,
        v.value,
      ),
    }));
    for (const value of normalized)
      await tx.contactCustomFieldValues.upsert({
        where: {
          contactId_contactCustomFieldsId: {
            contactId: contact.id,
            contactCustomFieldsId: value.fieldId,
          },
        },
        create: {
          contactId: contact.id,
          contactCustomFieldsId: value.fieldId,
          fieldValue: value.value,
        },
        update: { fieldValue: value.value, updatedAt: new Date() },
      });
    if (normalized.length)
      await tx.auditEvents.create({
        data: {
          vendorId: requestInput.identity!.vendorId!,
          actorId: requestInput.identity!.userId,
          action: 'update',
          resource: 'contact-custom-value',
          resourceId: String(contact.id),
          metadata: { fieldIds: normalized.map((v) => v.fieldId) },
        },
      });
  }, serializableTransactionOptions);
  return serviceResult(undefined, { status: 204, format: 'end' });
}
