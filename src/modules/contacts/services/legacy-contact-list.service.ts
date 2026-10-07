import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { can } from '../../../shared/access-policy.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { contactVisibility, present, ownedPhone } from '../contacts.service.js';
export async function listLegacyContacts(input: ServiceContext) {
  const query = input.validatedQuery,
    vendorId = input.identity!.vendorId!;
  if (query.from_phone_number_id) await ownedPhone(vendorId, query.from_phone_number_id);
  if (query.assigned === 'unassigned' && !can(input, 'vendor.chats.view_all'))
    throw new ApiError(
      403,
      'FORBIDDEN',
      'Full contact visibility is required to list unassigned contacts',
    );
  const where = {
    ...contactVisibility(input),
    ...(query.assigned === 'mine'
      ? { assignedUserId: input.identity!.userId }
      : query.assigned === 'unassigned'
        ? { assignedUserId: null }
        : {}),
    ...(query.from_phone_number_id ? { wabPhoneNumberId: query.from_phone_number_id } : {}),
    ...(query.search
      ? {
          OR: [
            { firstName: { contains: query.search, mode: 'insensitive' as const } },
            { lastName: { contains: query.search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };
  const [contacts, total] = await Promise.all([
    db.contacts.findMany({
      where,
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      orderBy: [{ messagedAt: 'desc' }, { id: 'desc' }],
    }),
    db.contacts.count({ where }),
  ]);
  let selected = null;
  if (input.params.contactUid) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        input.params.contactUid,
      )
    )
      throw new ApiError(400, 'INVALID_CONTACT', 'Contact UUID is invalid');
    selected = await db.contacts.findFirst({
      where: {
        ...contactVisibility(input),
        ...(query.assigned === 'mine'
          ? { assignedUserId: input.identity!.userId }
          : query.assigned === 'unassigned'
            ? { assignedUserId: null }
            : {}),
        uid: input.params.contactUid,
        ...(query.from_phone_number_id ? { wabPhoneNumberId: query.from_phone_number_id } : {}),
      },
    });
    if (!selected) throw new ApiError(404, 'NOT_FOUND', 'Contact not found');
    if (!contacts.some((contact) => contact.id === selected!.id)) contacts.push(selected);
  }
  const format = (contact: any) => {
    const safe = present(input, contact);
    return {
      _id: safe.id,
      _uid: safe.uid,
      vendors__id: safe.vendorId,
      first_name: safe.firstName,
      last_name: safe.lastName,
      wa_id: safe.waId,
      email: safe.email,
      platform: safe.platform,
      wab_phone_number_id: safe.wabPhoneNumberId,
      assigned_users__id: safe.assignedUserId,
      unread_messages_count: safe.unreadMessagesCount,
      messaged_at: safe.messagedAt,
      conversation_status: safe.conversationStatus,
      status: safe.status,
    };
  };
  const data = {
    contacts: Object.fromEntries(contacts.map((contact) => [contact.uid, format(contact)])),
    ...(query.request_contact
      ? {}
      : { contactsPaginatePage: query.page < Math.ceil(total / query.limit) ? query.page + 1 : 0 }),
    ...(selected ? { contact: format(selected) } : {}),
  };
  return serviceResult({ reaction: 1, data }, { status: 200, format: 'json' });
}
