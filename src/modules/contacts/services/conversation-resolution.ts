import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import type { Prisma } from '@prisma/client';
import sanitizeHtml from 'sanitize-html';

export async function resolveConversation(
  vendorId: number,
  id: number,
  actorId: number,
  resolved: boolean,
  scope: Prisma.ContactsWhereInput,
) {
  return db.$transaction(
    (tx) => resolveConversationInTransaction(tx, vendorId, id, actorId, resolved, scope),
    { timeout: 15000 },
  );
}

/** Shared transaction body so local resolution can commit with handoff and operation records. */
export async function resolveConversationInTransaction(
  tx: Prisma.TransactionClient,
  vendorId: number,
  id: number,
  actorId: number,
  resolved: boolean,
  scope: Prisma.ContactsWhereInput,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(601, ${id}::integer)`;
  const c = await tx.contacts.findFirst({ where: { AND: [{ vendorId, id }, scope] } });
  if (!c) throw new ApiError(404, 'NOT_FOUND', 'Contact not found');
  if (!resolved)
    return tx.contacts.update({
      where: { id },
      data: {
        conversationStatus: 'open',
        conversationResolvedAt: null,
        conversationResolvedByUserId: null,
        updatedAt: new Date(),
      },
    });
  if (
    c.conversationStatus === 'resolved' &&
    (await tx.conversationCxScores.findUnique({
      where: {
        vendorId_conversationId_resolutionSequence: {
          vendorId,
          conversationId: id,
          resolutionSequence: c.conversationResolutionSequence,
        },
      },
    }))
  )
    return c;
  const at = new Date(),
    sequence = c.conversationResolutionSequence + 1;
  const contact = await tx.contacts.update({
    where: { id },
    data: {
      conversationStatus: 'resolved',
      conversationResolvedAt: at,
      conversationResolvedByUserId: actorId,
      conversationResolutionSequence: sequence,
      updatedAt: at,
    },
  });
  const score = await tx.conversationCxScores.create({
    data: {
      vendorId,
      conversationId: id,
      agentId: c.assignedUserId ?? actorId,
      resolutionSequence: sequence,
      status: 'pending',
      createdAt: at,
    },
  });
  const where = { vendorId, contactId: id, messagedAt: { lte: at }, createdAt: { lte: at } };
  const [first, last] = await Promise.all([
    tx.whatsappMessageLogs.findMany({
      where,
      orderBy: [{ messagedAt: 'asc' }, { id: 'asc' }],
      take: 10,
    }),
    tx.whatsappMessageLogs.findMany({
      where,
      orderBy: [{ messagedAt: 'desc' }, { id: 'desc' }],
      take: 50,
    }),
  ]);
  const rows = [...new Map([...first, ...last].map((row) => [row.id, row])).values()]
    .sort((a, b) => a.messagedAt.getTime() - b.messagedAt.getTime() || a.id - b.id)
    .map((row) => ({
      id: row.id,
      role: row.isIncomingMessage ? 'customer' : 'agent',
      text: sanitizeHtml(row.message ?? `[${row.type ?? 'message'}]`, {
        allowedTags: [],
        allowedAttributes: {},
      })
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 1200),
      sentAt: row.messagedAt.toISOString(),
    }));
  await tx.webhookReceipts.create({
    data: {
      provider: 'cx-transcript',
      eventKey: `cx-transcript:${score.id}`,
      payload: { messages: rows, resolvedAt: at.toISOString(), resolutionSequence: sequence },
      processedAt: at,
    },
  });
  await tx.outboxJobs.create({
    data: {
      vendorId,
      kind: 'cx-score',
      dedupeKey: `cx-score:${score.id}`,
      payload: { scoreId: score.id },
    },
  });
  await tx.auditEvents.create({
    data: {
      vendorId,
      actorId,
      action: 'resolve',
      resource: 'conversation',
      resourceId: String(id),
    },
  });
  return contact;
}
