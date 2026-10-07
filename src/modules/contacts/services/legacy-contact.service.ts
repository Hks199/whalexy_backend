import type { Prisma } from '@prisma/client';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { can } from '../../../shared/access-policy.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { contactVisibility, ownedPhone, present } from '../contacts.service.js';
import { contactValue, lockedContactFields } from './contact-values.js';

async function countryId(tx: Prisma.TransactionClient, name: string | null | undefined) {
  if (!name) return null;
  const countries = await tx.countries.findMany({
    where: {
      OR: [
        { name: { equals: name, mode: 'insensitive' } },
        { isoCode: { equals: name, mode: 'insensitive' } },
      ],
    },
    take: 2,
  });
  if (countries.length !== 1)
    throw new ApiError(400, 'INVALID_COUNTRY', 'Country must identify one available country');
  return countries[0].id;
}

/** Never choose an arbitrary recipient when the same number has multiple conversations. */
export async function resolveLegacyContact(
  input: ServiceContext,
  tx: Prisma.TransactionClient | typeof db = db,
) {
  const phone = String(input.params.phoneNumber ?? input.body.phone_number);
  if (!/^[1-9]\d{8,14}$/.test(phone))
    throw new ApiError(400, 'INVALID_PHONE', 'Phone must contain country code without a prefix');
  if (input.body.from_phone_number_id)
    await ownedPhone(input.identity!.vendorId!, input.body.from_phone_number_id, tx);
  const contacts = await tx.contacts.findMany({
    where: {
      ...contactVisibility(input),
      waId: phone,
      OR: [{ platform: 'whatsapp' }, { platform: null }],
      ...(input.body.from_phone_number_id
        ? { wabPhoneNumberId: input.body.from_phone_number_id }
        : {}),
    },
    take: 2,
  });
  if (!contacts.length) throw new ApiError(404, 'NOT_FOUND', 'Contact not found');
  if (contacts.length > 1)
    throw new ApiError(
      409,
      'AMBIGUOUS_CONTACT',
      'Select the business number with from_phone_number_id',
    );
  return contacts[0];
}

async function mutateLegacyContact(input: ServiceContext, create: boolean) {
  const vendorId = input.identity!.vendorId!,
    body = input.body;
  if (
    body.groups !== undefined &&
    (!can(input, 'vendor.groups.manage') || !can(input, 'vendor.chats.view_all'))
  )
    throw new ApiError(
      403,
      'FORBIDDEN',
      'Group management and full contact visibility are required',
    );
  if (body.custom_input_fields !== undefined && !can(input, 'vendor.contacts.edit'))
    throw new ApiError(403, 'FORBIDDEN', 'Contact edit permission is required for custom values');
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`legacy-contacts:${vendorId}`},0))`;
      if (body.from_phone_number_id) await ownedPhone(vendorId, body.from_phone_number_id, tx);
      let previous;
      if (!create) {
        previous = await resolveLegacyContact(input, tx);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(601, ${previous.id}::integer)`;
        // Recheck assignment after acquiring the same lock used by other contact workflows.
        previous = await tx.contacts.findFirst({
          where: { id: previous.id, ...contactVisibility(input) },
        });
        if (!previous) throw new ApiError(404, 'NOT_FOUND', 'Contact not found');
      }
      if (body.phone_number && (create || body.phone_number !== previous!.waId)) {
        if (
          await tx.contacts.count({
            where: {
              vendorId,
              waId: body.phone_number,
              ...(previous ? { id: { not: previous.id } } : {}),
            },
          })
        )
          throw new ApiError(
            409,
            'CONTACT_EXISTS',
            'Contact phone already exists in this business',
          );
      }
      const data: Prisma.ContactsUncheckedUpdateInput = { updatedAt: new Date() };
      const names = {
        first_name: 'firstName',
        last_name: 'lastName',
        email: 'email',
        language_code: 'languageCode',
      } as const;
      for (const [source, target] of Object.entries(names))
        if (body[source] !== undefined) data[target] = body[source];
      if (body.country !== undefined) data.countryId = await countryId(tx, body.country);
      if (body.phone_number !== undefined) data.waId = body.phone_number;
      if (body.whatsapp_opt_out !== undefined)
        data.whatsappOptOut = body.whatsapp_opt_out ? 1 : null;
      if (body.enable_ai_bot !== undefined) data.disableAiBot = body.enable_ai_bot ? 0 : 1;
      const contact = create
        ? await tx.contacts.create({
            data: {
              ...(data as Prisma.ContactsUncheckedCreateInput),
              vendorId,
              platform: 'whatsapp',
              wabPhoneNumberId: body.from_phone_number_id ?? null,
              assignedUserId: can(input, 'vendor.chats.view_all') ? null : input.identity!.userId,
            },
          })
        : await tx.contacts.update({ where: { id: previous!.id }, data });
      if (body.groups !== undefined) {
        const titles: string[] = [
          ...new Set<string>(
            body.groups
              .split(',')
              .map((s: string) => s.trim())
              .filter(Boolean),
          ),
        ];
        const ids: number[] = [];
        for (const title of titles) {
          const groups = await tx.contactGroups.findMany({
            where: { vendorId, title, status: 1, wabPhoneNumberId: contact.wabPhoneNumberId },
            take: 2,
          });
          if (groups.length > 1)
            throw new ApiError(409, 'AMBIGUOUS_GROUP', 'Group title is ambiguous');
          const group =
            groups[0] ??
            (await tx.contactGroups.create({
              data: { vendorId, title, wabPhoneNumberId: contact.wabPhoneNumberId },
            }));
          ids.push(group.id);
        }
        await tx.groupContacts.deleteMany({ where: { contactId: contact.id } });
        if (ids.length)
          await tx.groupContacts.createMany({
            data: ids.map((groupId) => ({ groupId, contactId: contact.id })),
          });
      }
      const values = Object.entries(body.custom_input_fields ?? {}) as [string, string | null][];
      if (values.length) {
        const definitions = await tx.contactCustomFields.findMany({
          where: { vendorId, uid: { in: values.map(([uid]) => uid) } },
        });
        if (definitions.length !== values.length)
          throw new ApiError(400, 'INVALID_FIELD', 'Custom field is unavailable in this business');
        const fields = await lockedContactFields(
          tx,
          vendorId,
          definitions.map((field) => field.id),
        );
        for (const [uid, value] of values) {
          const definition = definitions.find((field) => field.uid === uid)!;
          const normalized = contactValue(
            fields.find((field) => field.id === definition.id)!,
            value,
          );
          await tx.contactCustomFieldValues.upsert({
            where: {
              contactId_contactCustomFieldsId: {
                contactId: contact.id,
                contactCustomFieldsId: definition.id,
              },
            },
            create: {
              contactId: contact.id,
              contactCustomFieldsId: definition.id,
              fieldValue: normalized,
            },
            update: { fieldValue: normalized, updatedAt: new Date() },
          });
        }
      }
      const safe = present(input, contact);
      const country = contact.countryId
        ? await tx.countries.findUnique({ where: { id: contact.countryId } })
        : null;
      return serviceResult(
        {
          result: 'success',
          message: create ? 'Contact created' : 'Contact updated',
          data: create
            ? {
                contact_uid: safe.uid,
                first_name: safe.firstName,
                last_name: safe.lastName,
                phone_number: safe.waId,
                language_code: safe.languageCode,
                country: country?.name ?? null,
              }
            : { contact_uid: safe.uid },
        },
        { status: 200, format: 'json' },
      );
    },
    { timeout: 15000 },
  );
}
export const createLegacyContact = (input: ServiceContext) => mutateLegacyContact(input, true);
export const updateLegacyContact = (input: ServiceContext) => mutateLegacyContact(input, false);
