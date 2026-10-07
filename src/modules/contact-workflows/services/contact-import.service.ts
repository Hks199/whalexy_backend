import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { can } from '../../../shared/access-policy.js';
import { ownedPhone } from '../../contacts/contacts.service.js';
import { parseContactCsv, resolveContactCsv } from '../../contacts/services/contact-csv.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import {
  getOwnedContactGroup,
  serializableTransactionOptions,
} from './contact-workflows-support.service.js';

export async function importContacts(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!;
  const result = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(603, ${vendorId}::integer)`;
    const parsed = await parseContactCsv(tx, vendorId, requestInput.body.csv);
    if (
      parsed.hasGroups &&
      (!can(requestInput, 'vendor.groups.manage') || !can(requestInput, 'vendor.chats.view_all'))
    )
      throw new ApiError(
        403,
        'FORBIDDEN',
        'Importing group columns requires group administration and full contact visibility',
      );
    const target = requestInput.body.groupId
      ? await getOwnedContactGroup(tx, vendorId, requestInput.body.groupId)
      : null;
    const phoneNumberId = requestInput.body.phoneNumberId ?? target?.wabPhoneNumberId ?? null;
    if (target?.wabPhoneNumberId && target.wabPhoneNumberId !== phoneNumberId)
      throw new ApiError(
        409,
        'PHONE_SCOPE_MISMATCH',
        'Import and group belong to different business numbers',
      );
    if (target && target.status !== 1)
      throw new ApiError(409, 'GROUP_INACTIVE', 'Import target must be an active group');
    if (phoneNumberId) await ownedPhone(vendorId, phoneNumberId, tx);
    const rows = await resolveContactCsv(tx, vendorId, phoneNumberId, parsed);
    let created = 0,
      skipped = 0;
    for (const entry of rows) {
      const row = entry.base;
      const existing = await tx.contacts.findFirst({
        where: {
          vendorId,
          waId: row.phone.slice(1),
          wabPhoneNumberId: phoneNumberId,
          OR: [{ platform: 'whatsapp' }, { platform: null }],
        },
        select: { id: true },
      });
      // Never expose or update an existing contact through an import-only permission.
      if (existing) {
        skipped++;
        continue;
      }
      const contact = await tx.contacts.create({
        data: {
          vendorId,
          waId: row.phone.slice(1),
          wabPhoneNumberId: phoneNumberId,
          firstName: row.firstName || null,
          lastName: row.lastName || null,
          email: row.email || null,
          languageCode: row.languageCode || null,
          countryId: entry.countryId,
          platform: 'whatsapp',
          assignedUserId: can(requestInput, 'vendor.chats.view_all')
            ? null
            : requestInput.identity!.userId,
        },
      });
      const groupIds = [...new Set([...entry.groupIds, ...(target ? [target.id] : [])])];
      if (groupIds.length)
        await tx.groupContacts.createMany({
          data: groupIds.map((groupId) => ({ contactId: contact.id, groupId })),
        });
      if (entry.values.length)
        await tx.contactCustomFieldValues.createMany({
          data: entry.values.map((v) => ({
            contactId: contact.id,
            contactCustomFieldsId: v.fieldId,
            fieldValue: v.value,
          })),
        });
      created++;
    }
    await tx.auditEvents.create({
      data: {
        vendorId,
        actorId: requestInput.identity!.userId,
        action: 'import',
        resource: 'contact',
        metadata: { created, skipped, fieldIds: parsed.fieldIds },
      },
    });
    return { created, skipped };
  }, serializableTransactionOptions);
  return serviceResult(result, { status: 201, format: 'json' });
}
