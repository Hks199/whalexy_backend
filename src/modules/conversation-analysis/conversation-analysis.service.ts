import type { Prisma } from '@prisma/client';
import sanitizeHtml from 'sanitize-html';
import { db } from '../../database/client.js';
import { ApiError } from '../../shared/api-error.js';
import { serviceResult, type ServiceContext } from '../../shared/service-context.js';
import { contactVisibility } from '../contacts/contacts.service.js';
import { digest } from '../../utils/crypto.js';
import { presentAnalysis } from './services/analysis-result.service.js';
import { conversationIdentifier } from './conversation-analysis.validation.js';

export async function analysisContact(
  input: ServiceContext,
  client: Prisma.TransactionClient = db,
) {
  const checked = conversationIdentifier.validate(
    input.body?.conversation_id ?? input.params.conversationId,
  );
  if (checked.error)
    throw new ApiError(400, 'INVALID_CONVERSATION', 'Use a numeric contact ID or contact UUID');
  const contact = await client.contacts.findFirst({
    where: {
      ...contactVisibility(input),
      ...(typeof checked.value === 'number' ? { id: checked.value } : { uid: checked.value }),
    },
  });
  if (!contact) throw new ApiError(404, 'NOT_FOUND', 'Conversation not found');
  return contact;
}
export async function getConversationAnalysis(input: ServiceContext) {
  const contact = await analysisContact(input),
    vendorId = input.identity!.vendorId!;
  const row = await db.conversationAiAnalysis.findUnique({
    where: { vendorId_conversationId: { vendorId, conversationId: contact.id } },
  });
  const job = await db.outboxJobs.findFirst({
    where: {
      vendorId,
      kind: 'conversation-analysis',
      payload: { path: ['contactId'], equals: contact.id },
    },
    orderBy: { createdAt: 'desc' },
  });
  return serviceResult(
    {
      status: 'ok',
      analysis: presentAnalysis(row),
      warning:
        job && ['failed', 'blocked', 'uncertain'].includes(job.status)
          ? 'AI analysis is temporarily unavailable. Showing the previous result.'
          : null,
    },
    { status: 200, format: 'json' },
  );
}
export async function requestConversationAnalysis(input: ServiceContext) {
  const header = input.headers['idempotency-key'];
  if (typeof header !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(header))
    throw new ApiError(400, 'IDEMPOTENCY_REQUIRED', 'A valid Idempotency-Key header is required');
  return db.$transaction(async (tx) => {
    const contact = await analysisContact(input, tx),
      vendorId = input.identity!.vendorId!;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(601, ${contact.id}::integer)`;
    await analysisContact(input, tx);
    const key = `analysis-request:${header}`,
      hash = digest(JSON.stringify({ operation: 'conversation-analysis', contactId: contact.id }));
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${vendorId}:${key}`},0))`;
    const previous = await tx.nativeIdempotency.findUnique({
      where: { vendorId_key: { vendorId, key } },
    });
    if (previous) {
      if (previous.requestHash !== hash)
        throw new ApiError(
          409,
          'IDEMPOTENCY_CONFLICT',
          'Key was used for a different conversation',
        );
      return serviceResult(previous.response, { status: 202, format: 'json' });
    }
    const active = await tx.outboxJobs.findFirst({
      where: {
        vendorId,
        kind: 'conversation-analysis',
        status: { in: ['pending', 'processing', 'blocked', 'uncertain'] },
        payload: { path: ['contactId'], equals: contact.id },
      },
    });
    if (active && ['blocked', 'uncertain'].includes(active.status))
      throw new ApiError(
        409,
        'ANALYSIS_RECONCILIATION_REQUIRED',
        'An unavailable analysis requires recovery before another provider call',
      );
    const analysis = await tx.conversationAiAnalysis.findUnique({
      where: { vendorId_conversationId: { vendorId, conversationId: contact.id } },
    });
    if (!active) {
      const where = { vendorId, contactId: contact.id, message: { not: null } };
      const [count, rows] = await Promise.all([
        tx.whatsappMessageLogs.count({ where: { ...where, NOT: { message: '' } } }),
        tx.whatsappMessageLogs.findMany({
          where: { ...where, NOT: { message: '' } },
          orderBy: [{ messagedAt: 'desc' }, { id: 'desc' }],
          take: 100,
        }),
      ]);
      const job = await tx.outboxJobs.create({
        data: { vendorId, kind: 'conversation-analysis', payload: { contactId: contact.id } },
      });
      await tx.webhookReceipts.create({
        data: {
          provider: 'conversation-analysis',
          eventKey: `conversation-analysis:${job.id}`,
          payload: {
            status: 'prepared',
            actorId: input.identity!.userId,
            apiKeyId: input.identity!.apiKeyId ?? null,
            contactId: contact.id,
            messageCount: count,
            latestMessageId: rows[0]?.id ?? 0,
            summaryDue:
              count >= 10 &&
              Math.floor(count / 10) > Math.floor((analysis?.messageCount ?? 0) / 10),
            previousSummary: analysis?.conversationSummary ?? null,
            messages: rows.reverse().map((row) => ({
              role: row.isIncomingMessage ? 'Customer' : 'Agent',
              message: sanitizeHtml(row.message ?? '', {
                allowedTags: [],
                allowedAttributes: {},
              }).slice(0, 4000),
              sent_at: row.messagedAt.toISOString(),
            })),
          },
        },
      });
    }
    const response = { status: 'queued', analysis: presentAnalysis(analysis), warning: null };
    // Date values are serialized exactly as they are on HTTP responses before saving a replay.
    const saved = JSON.parse(JSON.stringify(response));
    await tx.nativeIdempotency.create({
      data: { vendorId, key, requestHash: hash, response: saved },
    });
    return serviceResult(saved, { status: 202, format: 'json' });
  });
}
