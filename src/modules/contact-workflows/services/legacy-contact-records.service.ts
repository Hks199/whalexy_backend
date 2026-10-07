import { Prisma } from '@prisma/client';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { currentContactPermissions } from './contact-administration.service.js';
import { deleteContact } from './contact-lifecycle.service.js';

function identifier(input: ServiceContext) {
  const value: number | string = input.params.contactIdOrUid;
  return typeof value === 'number' ? { id: value } : { uid: value };
}
export async function editData(input: ServiceContext) {
  const vendorId = input.identity!.vendorId!;
  return db.$transaction(
    async (tx) => {
      const permissions = await currentContactPermissions(tx, input);
      const has = (permission: string) =>
        permissions.includes('*') || permissions.includes(permission);
      if (!has('vendor.contacts.view'))
        throw new ApiError(403, 'FORBIDDEN', 'Contact read permission required');
      const contact = await tx.contacts.findFirst({
        where: {
          vendorId,
          ...identifier(input),
          ...(!has('vendor.chats.view_all') ? { assignedUserId: input.identity!.userId } : {}),
        },
      });
      if (!contact) throw new ApiError(404, 'NOT_FOUND', 'Contact not found');
      const groups = await tx.contactGroups.findMany({
        where: { vendorId, childrenGroupContactsGroupId: { some: { contactId: contact.id } } },
        orderBy: { id: 'asc' },
        take: 501,
      });
      const values = await tx.contactCustomFieldValues.findMany({
        where: { contactId: contact.id, refContactCustomFieldsId: { vendorId } },
        orderBy: { id: 'asc' },
        take: 501,
      });
      if (groups.length > 500 || values.length > 500)
        throw new ApiError(
          409,
          'CONTACT_PROFILE_TOO_LARGE',
          'Large imported profiles require reconciliation',
        );
      const country = contact.countryId
        ? await tx.countries.findUnique({
            where: { id: contact.countryId },
            select: { id: true, name: true },
          })
        : null;
      const viewPhone = has('vendor.contacts.view_phone');
      return serviceResult(
        {
          _id: contact.id,
          _uid: contact.uid,
          first_name: contact.firstName,
          last_name: contact.lastName,
          wa_id: viewPhone ? contact.waId : contact.waId ? '***' + contact.waId.slice(-4) : null,
          email: viewPhone ? contact.email : null,
          language_code: contact.languageCode,
          countries__id: contact.countryId,
          status: contact.status,
          platform: contact.platform,
          assigned_users__id: contact.assignedUserId,
          wab_phone_number_id: contact.wabPhoneNumberId,
          whatsapp_opt_out: contact.whatsappOptOut,
          disable_ai_bot: contact.disableAiBot,
          created_at: contact.createdAt,
          updated_at: contact.updatedAt,
          country: country ? { _id: country.id, name: country.name } : null,
          groups: groups.map((g) => ({ _id: g.id, _uid: g.uid, title: g.title, status: g.status })),
          existingGroupIds: JSON.stringify(groups.map((g) => g.id)),
          custom_field_values: values.map((v) => ({
            _id: v.id,
            _uid: v.uid,
            contact_custom_fields__id: v.contactCustomFieldsId,
            field_value: v.fieldValue,
          })),
        },
        { status: 200, format: 'json' },
      );
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 },
  );
}
export async function remove(input: ServiceContext) {
  const contact = await db.contacts.findFirst({
    where: { vendorId: input.identity!.vendorId!, ...identifier(input) },
    select: { id: true },
  });
  if (!contact) throw new ApiError(404, 'NOT_FOUND', 'Contact not found');
  await deleteContact({ ...input, params: { ...input.params, id: contact.id } });
  return serviceResult(
    { status: 'success', message: 'Contact deleted successfully.' },
    { status: 200, format: 'json' },
  );
}
