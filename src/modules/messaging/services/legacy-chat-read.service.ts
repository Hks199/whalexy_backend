import { Prisma, type Contacts } from '@prisma/client';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { currentContactPermissions } from '../../contact-workflows/services/contact-administration.service.js';
import { ownedPhone } from '../../contacts/contacts.service.js';
const has = (permissions: Prisma.JsonArray, permission: string) =>
  permissions.includes('*') || permissions.includes(permission);
async function authorize(tx: Prisma.TransactionClient, input: ServiceContext) {
  const permissions = await currentContactPermissions(tx, input);
  if (!has(permissions, 'vendor.contacts.view'))
    throw new ApiError(403, 'FORBIDDEN', 'Contact read permission required');
  return permissions;
}
async function phoneScope(
  tx: Prisma.TransactionClient,
  vendorId: number,
  selected?: string | null,
) {
  if (selected) {
    await ownedPhone(vendorId, selected, tx);
    return selected;
  }
  const connections = await tx.integrationCredentials.findMany({
    where: { vendorId, provider: 'whatsapp' },
    select: { externalId: true },
    take: 2,
  });
  if (connections.length !== 1)
    throw new ApiError(
      409,
      'PHONE_SCOPE_REQUIRED',
      'Select one connected business number with from_phone_number_id',
    );
  return connections[0].externalId;
}
function contactProjection(contact: Contacts, permissions: Prisma.JsonArray) {
  return {
    _id: contact.id,
    _uid: contact.uid,
    first_name: contact.firstName,
    last_name: contact.lastName,
    wa_id: has(permissions, 'vendor.contacts.view_phone')
      ? contact.waId
      : contact.waId
        ? '***' + contact.waId.slice(-4)
        : null,
    email: has(permissions, 'vendor.contacts.view_phone') ? contact.email : null,
    status: contact.status,
    platform: contact.platform,
    assigned_users__id: contact.assignedUserId,
    wab_phone_number_id: contact.wabPhoneNumberId,
    conversation_status: contact.conversationStatus,
    disable_ai_bot: contact.disableAiBot,
  };
}
export async function history(input: ServiceContext) {
  return db.$transaction(
    async (tx) => {
      const vendorId = input.identity!.vendorId!,
        permissions = await authorize(tx, input),
        q = input.validatedQuery;
      const contact = await tx.contacts.findFirst({
        where: {
          vendorId,
          uid: input.params.contactUid,
          ...(!has(permissions, 'vendor.chats.view_all')
            ? { assignedUserId: input.identity!.userId }
            : {}),
        },
      });
      if (!contact) throw new ApiError(404, 'NOT_FOUND', 'Contact not found');
      if (contact.platform && contact.platform !== 'whatsapp')
        throw new ApiError(
          409,
          'INVALID_PLATFORM',
          'WhatsApp chat history requires a WhatsApp contact',
        );
      const phone = await phoneScope(
        tx,
        vendorId,
        q.from_phone_number_id ?? contact.wabPhoneNumberId,
      );
      const rows = await tx.whatsappMessageLogs.findMany({
        where: { vendorId, contactId: contact.id, wabPhoneNumberId: phone },
        orderBy: [{ messagedAt: 'desc' }, { id: 'desc' }],
        take: q.limit + 1,
        skip: (q.page - 1) * q.limit,
        select: {
          id: true,
          uid: true,
          message: true,
          type: true,
          status: true,
          isIncomingMessage: true,
          messagedAt: true,
          createdAt: true,
          repliedToWhatsappMessageLogsUid: true,
        },
      });
      const replyUids = rows
        .slice(0, q.limit)
        .flatMap((row) =>
          row.repliedToWhatsappMessageLogsUid ? [row.repliedToWhatsappMessageLogsUid] : [],
        );
      const replies = replyUids.length
        ? await tx.whatsappMessageLogs.findMany({
            where: {
              vendorId,
              contactId: contact.id,
              wabPhoneNumberId: phone,
              uid: { in: replyUids },
            },
            select: { uid: true },
          })
        : [];
      const visibleReplies = new Set(replies.map((row) => row.uid));
      return serviceResult(
        {
          whatsappMessageLogs: Object.fromEntries(
            rows
              .slice(0, q.limit)
              .reverse()
              .map((row) => [
                row.uid,
                {
                  _id: row.id,
                  _uid: row.uid,
                  message: row.message,
                  type: row.type,
                  status: row.status,
                  is_incoming_message: row.isIncomingMessage,
                  messaged_at: row.messagedAt,
                  created_at: row.createdAt,
                  replied_to_whatsapp_message_logs__uid:
                    row.repliedToWhatsappMessageLogsUid &&
                    visibleReplies.has(row.repliedToWhatsappMessageLogsUid)
                      ? row.repliedToWhatsappMessageLogsUid
                      : null,
                },
              ]),
          ),
          messagePaginatePage: rows.length > q.limit ? q.page + 1 : 0,
          way: input.params.way,
          phone_number_id: phone,
        },
        { status: 200, format: 'json' },
      );
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 },
  );
}
type InboxRow = { id: number; lastAt: Date; unread: number };
export async function inbox(input: ServiceContext) {
  return db.$transaction(
    async (tx) => {
      const vendorId = input.identity!.vendorId!,
        permissions = await authorize(tx, input),
        q = input.validatedQuery;
      const phone = await phoneScope(tx, vendorId, q.from_phone_number_id);
      if (
        q.group_id &&
        !(await tx.contactGroups.findFirst({
          where: { id: q.group_id, vendorId },
          select: { id: true },
        }))
      )
        throw new ApiError(404, 'NOT_FOUND', 'Group not found');
      if (
        q.label_id &&
        !(await tx.labels.findFirst({ where: { id: q.label_id, vendorId }, select: { id: true } }))
      )
        throw new ApiError(404, 'NOT_FOUND', 'Label not found');
      const filters = [
        Prisma.sql`c.vendors__id = ${vendorId}`,
        Prisma.sql`(c.platform IS NULL OR c.platform IN ('', 'whatsapp'))`,
      ];
      if (!has(permissions, 'vendor.chats.view_all') || q.assigned === 'to-me')
        filters.push(Prisma.sql`c.assigned_users__id = ${input.identity!.userId}`);
      if (q.assigned === 'unassigned') filters.push(Prisma.sql`c.assigned_users__id IS NULL`);
      if (q.request_contact) filters.push(Prisma.sql`c._uid = ${q.request_contact}`);
      if (q.unread_only) filters.push(Prisma.sql`stats.unread > 0`);
      if (q.search) {
        // POSITION treats percent, underscore and backslashes as literal search text.
        const term = q.search.toLowerCase();
        filters.push(
          Prisma.sql`(POSITION(${term} IN LOWER(COALESCE(c.first_name, ''))) > 0 OR POSITION(${term} IN LOWER(COALESCE(c.last_name, ''))) > 0 ${has(permissions, 'vendor.contacts.view_phone') ? Prisma.sql`OR POSITION(${term} IN LOWER(COALESCE(c.wa_id, ''))) > 0 OR POSITION(${term} IN LOWER(COALESCE(c.email, ''))) > 0` : Prisma.empty})`,
        );
      }
      if (q.group_id)
        filters.push(
          Prisma.sql`EXISTS (SELECT 1 FROM group_contacts gc JOIN contact_groups cg ON cg._id = gc.contact_groups__id WHERE gc.contacts__id = c._id AND cg._id = ${q.group_id} AND cg.vendors__id = ${vendorId})`,
        );
      if (q.label_id)
        filters.push(
          Prisma.sql`EXISTS (SELECT 1 FROM contact_labels cl JOIN labels l ON l._id = cl.labels__id WHERE cl.contacts__id = c._id AND l._id = ${q.label_id} AND l.vendors__id = ${vendorId})`,
        );
      const from = Prisma.sql`FROM contacts c JOIN (SELECT contacts__id, MAX(messaged_at) AS last_at, COUNT(*) FILTER (WHERE is_incoming_message = true AND status = 'received')::integer AS unread FROM whatsapp_message_logs WHERE vendors__id = ${vendorId} AND wab_phone_number_id = ${phone} GROUP BY contacts__id) stats ON stats.contacts__id = c._id WHERE ${Prisma.join(filters, ' AND ')}`;
      const rows = await tx.$queryRaw<InboxRow[]>(
        Prisma.sql`SELECT c._id AS id, stats.last_at AS "lastAt", stats.unread ${from} ORDER BY stats.last_at DESC, c._id DESC LIMIT ${q.limit + 1} OFFSET ${(q.page - 1) * q.limit}`,
      );
      const selected = input.params.contactUid
        ? await tx.$queryRaw<InboxRow[]>(
            Prisma.sql`SELECT c._id AS id, stats.last_at AS "lastAt", stats.unread ${from} AND c._uid = ${input.params.contactUid} LIMIT 1`,
          )
        : [];
      if (input.params.contactUid && selected.length !== 1)
        throw new ApiError(404, 'NOT_FOUND', 'Selected conversation not found in this scope');
      const page = rows.slice(0, q.limit);
      if (selected.length && !page.some((row) => row.id === selected[0].id)) page.push(selected[0]);
      const contacts = await tx.contacts.findMany({
        where: { vendorId, id: { in: page.map((row) => row.id) } },
      });
      const byId = new Map(contacts.map((contact) => [contact.id, contact]));
      return serviceResult(
        {
          contacts: Object.fromEntries(
            page.map((row) => {
              const contact = byId.get(row.id)!;
              return [
                contact.uid,
                {
                  ...contactProjection(contact, permissions),
                  last_message_at: row.lastAt,
                  unread_messages_count: row.unread,
                },
              ];
            }),
          ),
          contactsPaginatePage: rows.length > q.limit ? q.page + 1 : 0,
          way: q.way,
          phone_number_id: phone,
        },
        { status: 200, format: 'json' },
      );
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 },
  );
}
export function prepare(input: ServiceContext) {
  const type = input.params.mediaType as 'image' | 'video' | 'audio' | 'document';
  const names = { image: 'Image', video: 'Video', audio: 'Audio', document: 'Document' };
  return serviceResult(
    { uploadTitle: `Select ${names[type]}`, mediaType: type },
    { status: 200, format: 'json' },
  );
}

export async function unread(input: ServiceContext) {
  return db.$transaction(
    async (tx) => {
      const vendorId = input.identity!.vendorId!,
        permissions = await authorize(tx, input);
      const phone = await phoneScope(tx, vendorId, input.validatedQuery.from_phone_number_id);
      const rows = await tx.$queryRaw<
        { assigned: number | null; count: number }[]
      >`SELECT c.assigned_users__id AS assigned, COUNT(*)::integer AS count FROM whatsapp_message_logs m JOIN contacts c ON c._id = m.contacts__id AND c.vendors__id = m.vendors__id WHERE m.vendors__id = ${vendorId} AND m.wab_phone_number_id = ${phone} AND m.is_incoming_message = true AND m.status = 'received' AND (c.platform IS NULL OR c.platform IN ('', 'whatsapp')) GROUP BY c.assigned_users__id`;
      const mine = rows.find((row) => row.assigned === input.identity!.userId)?.count ?? 0;
      const all = has(permissions, 'vendor.chats.view_all');
      return serviceResult(
        {
          unreadMessagesCount: all ? rows.reduce((sum, row) => sum + row.count, 0) : mine,
          myAssignedUnreadMessagesCount: mine,
          myUnassignedUnreadMessagesCount: all
            ? (rows.find((row) => row.assigned === null)?.count ?? 0)
            : 0,
          phone_number_id: phone,
        },
        { status: 200, format: 'json' },
      );
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 },
  );
}
