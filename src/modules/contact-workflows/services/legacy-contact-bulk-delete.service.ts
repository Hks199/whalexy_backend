import type { Prisma } from '@prisma/client';
import { ApiError } from '../../../shared/api-error.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { currentContactPermissions } from './contact-administration.service.js';
import {
  contactDeletionTransaction,
  deleteContactInTransaction,
} from './contact-lifecycle.service.js';

async function remove(input: ServiceContext, filtered: boolean) {
  const vendorId = input.identity!.vendorId!,
    body = { platform: 'whatsapp', search: '', ...input.body };
  const count = await contactDeletionTransaction(async (tx) => {
    const initialPermissions = await currentContactPermissions(tx, input);
    const has = (permissions: Prisma.JsonArray, permission: string) =>
      permissions.includes('*') || permissions.includes(permission);
    if (
      !has(initialPermissions, 'vendor.contacts.delete') ||
      (filtered && !has(initialPermissions, 'vendor.chats.view_all'))
    )
      throw new ApiError(
        403,
        'FORBIDDEN',
        'Filtered deletion requires full contact visibility and deletion permission',
      );
    const group =
      filtered && input.params.groupUid
        ? await tx.contactGroups.findFirst({
            where: { vendorId, uid: input.params.groupUid },
            select: { id: true },
          })
        : null;
    if (input.params.groupUid && !group)
      throw new ApiError(404, 'NOT_FOUND', 'Contact group not found');
    if (group) await tx.$executeRaw`SELECT pg_advisory_xact_lock(602, ${group.id}::integer)`;
    if (
      filtered &&
      body.from_phone_number_id &&
      !(await tx.integrationCredentials.findUnique({
        where: {
          vendorId_provider_externalId: {
            vendorId,
            provider: 'whatsapp',
            externalId: body.from_phone_number_id,
          },
        },
        select: { id: true },
      }))
    )
      throw new ApiError(
        400,
        'INVALID_PHONE_SCOPE',
        'WhatsApp number is not connected to this business',
      );
    const where: Prisma.ContactsWhereInput = {
      vendorId,
      ...(!has(initialPermissions, 'vendor.chats.view_all')
        ? { assignedUserId: input.identity!.userId }
        : {}),
      ...(!filtered
        ? { uid: { in: body.selected_contacts } }
        : {
            ...(group ? { childrenGroupContactsContactId: { some: { groupId: group.id } } } : {}),
            ...(!group && body.platform === 'whatsapp' && body.from_phone_number_id
              ? { wabPhoneNumberId: body.from_phone_number_id }
              : {}),
            ...(body.platform === 'whatsapp'
              ? { OR: [{ platform: null }, { platform: '' }, { platform: 'whatsapp' }] }
              : {
                  platform:
                    body.platform === 'facebook' ? { in: ['facebook', 'messenger'] } : 'instagram',
                }),
          }),
    };
    const searchFields = [
      'firstName',
      'lastName',
      ...(has(initialPermissions, 'vendor.contacts.view_phone')
        ? ['waId', 'email', 'instagramUsername', 'instagramId', 'facebookId']
        : []),
    ];
    const selection: Prisma.ContactsWhereInput =
      filtered && body.search
        ? {
            AND: [
              where,
              {
                OR: searchFields.map((field) => ({
                  [field]: { contains: body.search, mode: 'insensitive' },
                })),
              },
            ],
          }
        : where;
    const contacts = await tx.contacts.findMany({
      where: selection,
      orderBy: { id: 'asc' },
      take: 101,
      select: { id: true },
    });
    if (contacts.length > 100)
      throw new ApiError(
        409,
        'DELETE_BATCH_TOO_LARGE',
        'Select at most 100 contacts per reviewed deletion batch',
      );
    if (!filtered && contacts.length !== body.selected_contacts.length)
      throw new ApiError(404, 'NOT_FOUND', 'One or more selected contacts are unavailable');
    for (const contact of contacts)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(601, ${contact.id}::integer)`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(610, ${vendorId}::integer)`;
    const permissions = await currentContactPermissions(tx, input);
    if (
      !has(permissions, 'vendor.contacts.delete') ||
      (filtered && !has(permissions, 'vendor.chats.view_all')) ||
      (filtered &&
        body.search &&
        has(initialPermissions, 'vendor.contacts.view_phone') &&
        !has(permissions, 'vendor.contacts.view_phone'))
    )
      throw new ApiError(403, 'FORBIDDEN', 'Deletion access changed; reload the selection');
    // Keep the helper's visibility check aligned with the fresh permission snapshot.
    const context = {
      ...input,
      identity: { ...input.identity!, permissions: permissions as string[] },
    };
    for (const contact of contacts)
      await deleteContactInTransaction(tx, {
        ...context,
        params: { ...input.params, id: contact.id },
      });
    return contacts.length;
  });
  return serviceResult(
    {
      status: 'success',
      message: count ? 'Contacts deleted successfully.' : 'No matching contacts',
      deletedContactsCount: count,
      reloadDatatableId: '#lwContactList',
    },
    { status: 200, format: 'json' },
  );
}
export const selected = (input: ServiceContext) => remove(input, false);
export const filtered = (input: ServiceContext) => remove(input, true);
