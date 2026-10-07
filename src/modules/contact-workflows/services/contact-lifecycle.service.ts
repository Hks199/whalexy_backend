import { changeContactGroupMemberships } from './contact-group-membership.service.js';
import { assignGroupContacts } from './contact-assignment.service.js';
import {
  changeContactGroups,
  assertContactGroupLinksOwned,
  assertContactGroupsUnreferenced,
} from './contact-groups.service.js';
import {
  authorizeContactAdministration,
  currentContactPermissions,
} from './contact-administration.service.js';
import { Prisma } from '@prisma/client';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import {
  lockedContact,
  serializableTransactionOptions,
  parseContactIdentifier,
  getOwnedContactGroup,
} from './contact-workflows-support.service.js';

export async function deleteContactInTransaction(
  tx: Prisma.TransactionClient,
  requestInput: ServiceContext,
) {
  const contact = await lockedContact(tx, requestInput),
    vendorId = requestInput.identity!.vendorId!,
    at = new Date();
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(610, ${vendorId}::integer)`;
  const permissions = await currentContactPermissions(tx, requestInput);
  const has = (permission: string) => permissions.includes('*') || permissions.includes(permission);
  if (!has('vendor.contacts.delete'))
    throw new ApiError(403, 'FORBIDDEN', 'Contact deletion permission required');
  if (!has('vendor.chats.view_all') && contact.assignedUserId !== requestInput.identity!.userId)
    throw new ApiError(404, 'NOT_FOUND', 'Contact not found');
  const history = await Promise.all([
    tx.aiConversationHandoffs.findFirst({
      where: { contactId: contact.id },
      select: { id: true },
    }),
    tx.conversationAiAnalysis.findFirst({
      where: { conversationId: contact.id },
      select: { id: true },
    }),
    tx.conversationClassifications.findFirst({
      where: { contactId: contact.id },
      select: { id: true },
    }),
    tx.conversationClassificationLogs.findFirst({
      where: { contactId: contact.id },
      select: { id: true },
    }),
    tx.conversationCxScores.findFirst({
      where: { conversationId: contact.id },
      select: { id: true },
    }),
  ]);
  if (history.some(Boolean))
    throw new ApiError(
      409,
      'CONTACT_REFERENCES_PENDING',
      'Reconcile retained conversation history before deletion',
    );
  const testContact = await tx.vendorSettings.findFirst({
    where: { vendorId, name: 'test_recipient_contact' },
  });
  if (testContact?.value === contact.uid)
    throw new ApiError(
      409,
      'CAMPAIGN_TEST_CONTACT',
      'Choose another campaign test contact before deleting this one',
    );
  if (
    await tx.whalexyAppointments.findFirst({
      where: {
        vendorId,
        contactId: contact.id,
        status: { in: ['pending', 'confirmed'] },
        endsAtUtc: { gt: at },
      },
      select: { id: true },
    })
  )
    throw new ApiError(
      409,
      'CONTACT_HAS_BOOKINGS',
      'Cancel future appointments before deleting this contact',
    );
  const messages = await tx.whatsappMessageLogs.findMany({
    where: { vendorId, contactId: contact.id },
    select: { id: true },
  });
  // Queued effects retain their audit trail but must not dispatch after deletion.
  const pendingJobs = await tx.outboxJobs.findMany({
    where: {
      vendorId,
      kind: 'bot-flow-resume',
      status: { in: ['pending', 'blocked'] },
      payload: { path: ['contactId'], equals: contact.id },
    },
  });
  const messageJobs = messages.length
    ? await tx.$queryRaw<
        {
          id: string;
          status: string;
        }[]
      >`SELECT "id","status" FROM "node_outbox_jobs" WHERE "vendorId"=${vendorId} AND "kind"='whatsapp-send' AND "status" IN ('pending','blocked','processing') AND ("payload"->>'messageId')=ANY(${messages.map((row) => String(row.id))}::text[]) FOR UPDATE`
    : [];
  if (messageJobs.some((job) => job.status === 'processing'))
    throw new ApiError(
      409,
      'CONTACT_SEND_IN_PROGRESS',
      'Wait for in-flight delivery to finish before deleting this contact',
    );
  await tx.outboxJobs.updateMany({
    where: {
      id: { in: [...pendingJobs.map((job) => job.id), ...messageJobs.map((job) => job.id)] },
    },
    data: { status: 'cancelled', lockedAt: null, lastError: 'CONTACT_DELETED' },
  });
  await tx.groupContacts.deleteMany({ where: { contactId: contact.id } });
  await tx.contactLabels.deleteMany({ where: { contactId: contact.id } });
  await tx.contactCustomFieldValues.deleteMany({ where: { contactId: contact.id } });
  await tx.whatsappMessageQueue.deleteMany({ where: { vendorId, contactId: contact.id } });
  await tx.whatsappMessageLogs.deleteMany({ where: { vendorId, contactId: contact.id } });
  await tx.shopifyOrderNotifications.updateMany({
    where: { vendorId, contactId: contact.id, status: 'queued' },
    data: { status: 'cancelled', errorMessage: 'CONTACT_DELETED', updatedAt: at },
  });
  await tx.woocommerceOrderNotifications.updateMany({
    where: { vendorId, contactId: contact.id, status: 'queued' },
    data: { status: 'cancelled', errorMessage: 'CONTACT_DELETED', updatedAt: at },
  });
  await tx.nativeChannelMessages.deleteMany({ where: { vendorId, contactId: contact.id } });
  // The legacy attribution contact column has no declared foreign key.
  await tx.adConversationAttributions.deleteMany({
    where: { vendorId, contactId: contact.id },
  });
  await tx.conversions.updateMany({
    where: { vendorId, attribution: { path: ['contactId'], equals: contact.id } },
    data: { contactWaId: null, updatedAt: at },
  });
  await tx.userActiveFlows.deleteMany({
    where: {
      AND: [
        { phoneNumber: { startsWith: `node:whatsapp:${vendorId}:` } },
        { phoneNumber: { endsWith: `:${contact.id}` } },
      ],
    },
  });
  await tx.outOfOfficeDeliveries.updateMany({
    where: { contactId: contact.id, refOutOfOfficeSettingsId: { vendorId } },
    data: { contactId: null },
  });
  await tx.whalexyAppointmentHolds.deleteMany({ where: { vendorId, contactId: contact.id } });
  await tx.whalexyAppointments.updateMany({
    where: { vendorId, contactId: contact.id },
    data: { contactId: null },
  });
  await tx.contacts.delete({ where: { id: contact.id } });
  await tx.auditEvents.create({
    data: {
      vendorId,
      actorId: requestInput.identity!.userId,
      action: 'delete',
      resource: 'contact',
      resourceId: String(contact.id),
    },
  });
}

export async function contactDeletionTransaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(operation, serializableTransactionOptions);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003')
        throw new ApiError(
          409,
          'CONTACT_REFERENCES_PENDING',
          'Reconcile retained contact references before deletion',
        );
      const retry =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2034' ||
          (error.code === 'P2010' && ['40001', '40P01'].includes(String(error.meta?.code))));
      if (!retry || attempt >= 2) throw error;
    }
  }
}
export async function deleteContact(requestInput: ServiceContext) {
  await contactDeletionTransaction((tx) => deleteContactInTransaction(tx, requestInput));
  return serviceResult(undefined, { status: 204, format: 'empty' });
}

export async function removeContactFromGroup(requestInput: ServiceContext) {
  await changeContactGroupMemberships(
    requestInput,
    [Number(requestInput.params.id)],
    [parseContactIdentifier(String(requestInput.params.groupId))],
    'remove',
  );
  return serviceResult(undefined, { status: 204, format: 'end' });
}

export async function assignContact(requestInput: ServiceContext) {
  const result = await assignGroupContacts(
    requestInput,
    Number(requestInput.params.id),
    requestInput.body.userId,
  );
  return serviceResult(
    { assignedContactsCount: result.assignedContactsCount },
    { status: 200, format: 'json' },
  );
}

export async function mergeContacts(requestInput: ServiceContext) {
  const sourceId = Number(requestInput.params.id),
    targetId: number = requestInput.body.targetGroupId,
    vendorId = requestInput.identity!.vendorId!;
  if (sourceId === targetId)
    throw new ApiError(400, 'INVALID_DESTINATION', 'Choose a different destination group');
  const movedContactsCount = await db.$transaction(async (tx) => {
    for (const id of [sourceId, targetId].sort((a, b) => a - b))
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(602, ${id}::integer)`;
    await authorizeContactAdministration(tx, requestInput);
    const source = await getOwnedContactGroup(tx, vendorId, sourceId),
      target = await getOwnedContactGroup(tx, vendorId, targetId);
    if (
      source.status !== 1 ||
      target.status !== 1 ||
      source.wabPhoneNumberId !== target.wabPhoneNumberId
    )
      throw new ApiError(
        409,
        'GROUP_SCOPE_MISMATCH',
        'Groups must be active and share a phone scope',
      );
    await assertContactGroupLinksOwned(tx, vendorId, [sourceId, targetId]);
    await assertContactGroupsUnreferenced(tx, vendorId, [source]);
    const links = await tx.groupContacts.findMany({
      where: { groupId: sourceId, refContactId: { vendorId } },
      select: { contactId: true },
    });
    const created = links.length
      ? await tx.groupContacts.createMany({
          data: links.map((l) => ({ contactId: l.contactId, groupId: targetId })),
          skipDuplicates: true,
        })
      : { count: 0 };
    await tx.groupContacts.deleteMany({ where: { groupId: sourceId } });
    await tx.contactGroups.delete({ where: { id: sourceId } });
    await tx.auditEvents.create({
      data: {
        vendorId,
        actorId: requestInput.identity!.userId,
        action: 'merge',
        resource: 'ContactGroups',
        resourceId: String(sourceId),
        metadata: { targetGroupId: targetId, movedContactsCount: created.count },
      },
    });
    return created.count;
  }, serializableTransactionOptions);
  return serviceResult({ movedContactsCount }, { status: 200, format: 'json' });
}

export async function archiveContact(requestInput: ServiceContext) {
  await changeContactGroups(
    requestInput,
    [Number(requestInput.params.id)],
    requestInput.body.archived ? 'archive' : 'unarchive',
  );
  return serviceResult(undefined, { status: 204, format: 'end' });
}
