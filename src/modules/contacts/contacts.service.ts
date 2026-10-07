import { changeContactGroupMemberships } from '../contact-workflows/services/contact-group-membership.service.js';
import { assignSingleContact } from '../contact-workflows/services/contact-assignment.service.js';
import { resolveConversation } from './services/conversation-resolution.js';
import { db } from '../../database/client.js';
import { ApiError } from '../../shared/api-error.js';
import { can } from '../../shared/access-policy.js';
import { changeContactAutomation } from './services/contact-automation.service.js';
import { serviceResult, type ServiceContext } from '../../shared/service-context.js';

export function contactVisibility(req: ServiceContext) {
  return {
    vendorId: req.identity!.vendorId!,
    ...(!can(req, 'vendor.chats.view_all') ? { assignedUserId: req.identity!.userId } : {}),
  };
}
export async function visibleContact(req: ServiceContext, id: number) {
  const contact = await db.contacts.findFirst({ where: { id, ...contactVisibility(req) } });
  if (!contact) throw new ApiError(404, 'NOT_FOUND', 'Contact not found');
  return contact;
}
export function present(req: ServiceContext, contact: any) {
  const { data, ...safe } = contact;
  if (!can(req, 'vendor.contacts.view_phone')) {
    safe.waId = safe.waId ? '***' + safe.waId.slice(-4) : null;
    safe.email = null;
    safe.instagramId = null;
    safe.facebookId = null;
  }
  return safe;
}
export async function ownedPhone(
  vendorId: number,
  phoneNumberId: string,
  client: typeof db | import('@prisma/client').Prisma.TransactionClient = db,
) {
  if (
    !(await client.integrationCredentials.findUnique({
      where: {
        vendorId_provider_externalId: { vendorId, provider: 'whatsapp', externalId: phoneNumberId },
      },
      select: { id: true },
    }))
  )
    throw new ApiError(
      400,
      'INVALID_PHONE_SCOPE',
      'WhatsApp number is not connected to this business',
    );
}
export async function validCountry(countryId: number | null | undefined) {
  if (
    countryId != null &&
    !(await db.countries.findUnique({ where: { id: countryId }, select: { id: true } }))
  )
    throw new ApiError(400, 'INVALID_COUNTRY', 'Country is unavailable');
}
export async function listContacts(requestInput: ServiceContext) {
  const q = requestInput.validatedQuery;
  const where = {
    ...contactVisibility(requestInput),
    ...(q.search
      ? {
          OR: [
            { firstName: { contains: q.search, mode: 'insensitive' as const } },
            { lastName: { contains: q.search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    db.contacts.findMany({
      where,
      skip: (q.page - 1) * q.limit,
      take: q.limit,
      orderBy: { id: 'desc' },
    }),
    db.contacts.count({ where }),
  ]);
  return serviceResult(
    { items: items.map((c) => present(requestInput, c)), total, page: q.page, limit: q.limit },
    { status: 200, format: 'json' },
  );
}
export async function createContact(requestInput: ServiceContext) {
  const { phone, phoneNumberId, ...input } = requestInput.body;
  await validCountry(input.countryId);
  if (phoneNumberId) await ownedPhone(requestInput.identity!.vendorId!, phoneNumberId);
  const c = await db.contacts.create({
    data: {
      ...input,
      waId: phone.slice(1),
      wabPhoneNumberId: phoneNumberId ?? null,
      vendorId: requestInput.identity!.vendorId!,
      assignedUserId: can(requestInput, 'vendor.chats.view_all')
        ? null
        : requestInput.identity!.userId,
    },
  });
  return serviceResult(present(requestInput, c), { status: 201, format: 'json' });
}
export async function getContact(requestInput: ServiceContext) {
  return serviceResult(
    present(requestInput, await visibleContact(requestInput, Number(requestInput.params.id))),
    { status: 200, format: 'json' },
  );
}
export async function updateContact(requestInput: ServiceContext) {
  const c = await visibleContact(requestInput, Number(requestInput.params.id));
  const { phone, phoneNumberId, ...input } = requestInput.body;
  await validCountry(input.countryId);
  if (phoneNumberId) {
    await ownedPhone(requestInput.identity!.vendorId!, phoneNumberId);
    if (c.wabPhoneNumberId && c.wabPhoneNumberId !== phoneNumberId)
      throw new ApiError(
        409,
        'PHONE_SCOPE_MISMATCH',
        'An existing contact cannot move to another business number',
      );
  }
  return serviceResult(
    present(
      requestInput,
      await db.contacts.update({
        where: { id: c.id },
        data: {
          ...input,
          ...(phone ? { waId: phone.slice(1) } : {}),
          ...(phoneNumberId ? { wabPhoneNumberId: phoneNumberId } : {}),
          updatedAt: new Date(),
        },
      }),
    ),
    { status: 200, format: 'json' },
  );
}
export async function assignContact(requestInput: ServiceContext) {
  await assignSingleContact(requestInput, Number(requestInput.params.id), requestInput.body.userId);
  return serviceResult(undefined, { status: 204, format: 'end' });
}
export async function resolveContactConversation(requestInput: ServiceContext) {
  const c = await visibleContact(requestInput, Number(requestInput.params.id));
  return serviceResult(
    present(
      requestInput,
      await resolveConversation(
        requestInput.identity!.vendorId!,
        c.id,
        requestInput.identity!.userId,
        requestInput.body.resolved,
        contactVisibility(requestInput),
      ),
    ),
    { status: 200, format: 'json' },
  );
}
export async function updateContactAiSettings(requestInput: ServiceContext) {
  await changeContactAutomation(requestInput);
  return serviceResult(undefined, { status: 204, format: 'end' });
}
export async function updateContactMarketingConsent(requestInput: ServiceContext) {
  const contact = await visibleContact(requestInput, Number(requestInput.params.id));
  await db.$transaction(async (tx) => {
    await tx.contacts.update({
      where: { id: contact.id },
      data: { whatsappOptOut: requestInput.body.optedOut ? 1 : null, updatedAt: new Date() },
    });
    await tx.auditEvents.create({
      data: {
        vendorId: requestInput.identity!.vendorId!,
        actorId: requestInput.identity!.userId,
        action: requestInput.body.optedOut ? 'opt-out' : 'opt-in',
        resource: 'contact-marketing',
        resourceId: String(contact.id),
      },
    });
  });
  return serviceResult(undefined, { status: 204, format: 'end' });
}
export async function listContactMessages(requestInput: ServiceContext) {
  const c = await visibleContact(requestInput, Number(requestInput.params.id));
  const q = requestInput.validatedQuery;
  const rows = await db.whatsappMessageLogs.findMany({
    where: { contactId: c.id, vendorId: requestInput.identity!.vendorId! },
    orderBy: { id: 'desc' },
    take: q.limit,
    skip: (q.page - 1) * q.limit,
    select: {
      id: true,
      uid: true,
      message: true,
      status: true,
      isIncomingMessage: true,
      messagedAt: true,
      type: true,
    },
  });
  return serviceResult(rows, { status: 200, format: 'json' });
}
export async function addContactToGroups(requestInput: ServiceContext) {
  await changeContactGroupMemberships(
    requestInput,
    [Number(requestInput.params.id)],
    [requestInput.body.groupId],
    'add',
  );
  return serviceResult(undefined, { status: 204, format: 'end' });
}
