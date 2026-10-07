import { Prisma, type OutboxJobs } from '@prisma/client';
import { db } from '../../../database/client.js';
import { digest } from '../../../utils/crypto.js';
import { ApiError } from '../../../shared/api-error.js';
import { metaRequest } from '../../../infrastructure/providers/meta.client.js';
import { eventTime, socialId, socialMessageId } from './comment-events.js';
import {
  requireSignedCommentReceipt,
  lockCommentAutomation,
  getRecordedCommentEffect,
  validJob,
  executionState,
  recordCommentEffect,
  buildCommentReplyContent,
} from './comment-automations-support.service.js';

export async function queueFollowCheck(
  tx: Prisma.TransactionClient,
  vendorId: number,
  executionId: number,
  token: string,
  event: any,
  p: any,
) {
  const dedupeKey = `comment-follow:${executionId}:${digest(event.mid)}`;
  await tx.outboxJobs.upsert({
    where: { dedupeKey },
    create: {
      vendorId,
      kind: 'comment-follow',
      dedupeKey,
      payload: {
        executionId,
        followToken: token,
        senderId: event.senderId,
        mid: event.mid,
        at: event.at,
        ruleRevision: p.ruleRevision,
        actorId: p.actorId,
        credentialId: p.credentialId,
        tokenHash: p.tokenHash,
      },
    },
    update: {},
  });
}

export async function ingestFollowReply(body: any, entry: any, event: any, eventKey?: string) {
  const raw = event.message?.quick_reply?.payload;
  if (typeof raw !== 'string' || !raw.startsWith('whalexy-follow:')) return false;
  await requireSignedCommentReceipt(eventKey, body);
  const token = raw.slice('whalexy-follow:'.length);
  if (
    !/^[A-Za-z0-9_-]{64}$/.test(token) ||
    body.object !== 'instagram' ||
    event.message?.is_echo ||
    !socialMessageId(event.message?.mid) ||
    !socialId(event.sender?.id)
  )
    return true;
  const account = String(entry.id ?? ''),
    recipient = String(event.recipient?.id ?? '');
  if (recipient !== account) return true;
  const at = eventTime(event.timestamp);
  if (!at || at > Date.now() + 300000 || at < Date.now() - 86400000) return true;
  const credentials = await db.integrationCredentials.findMany({
    where: { provider: 'instagram', externalId: account },
    take: 2,
  });
  if (credentials.length !== 1) return true;
  const vendorId = credentials[0].vendorId;
  await db.$transaction(async (tx) => {
    const key = `comment-follow:${digest(token)}`;
    await lockCommentAutomation(tx, `${vendorId}:${key}`);
    const record = await tx.nativeIdempotency.findUnique({
        where: { vendorId_key: { vendorId, key } },
      }),
      state = record?.response as any;
    if (
      !record ||
      state.expiresAt < Date.now() ||
      state.account !== account ||
      state.credentialId !== credentials[0].id ||
      state.state === 'complete'
    )
      return;
    const initial = await tx.outboxJobs.findUnique({
      where: { dedupeKey: `comment:${state.executionId}:private` },
    });
    if (!initial) return;
    const p = initial.payload as any,
      reply = { senderId: event.sender.id, mid: event.message.mid, at };
    if (state.state === 'queued') {
      if (!state.earlyReply)
        await tx.nativeIdempotency.update({
          where: { id: record.id },
          data: { response: { ...state, earlyReply: reply } },
        });
      return;
    }
    if (state.state !== 'waiting' || state.recipientId !== reply.senderId) return;
    await queueFollowCheck(tx, vendorId, state.executionId, token, reply, p);
  });
  return true;
}

export async function dispatchFollowCheck(job: OutboxJobs) {
  const p = job.payload as any;
  if (
    (await getRecordedCommentEffect(job.vendorId!, p.executionId, 'content')) ||
    (await getRecordedCommentEffect(job.vendorId!, p.executionId, `follow-retry:${digest(p.mid)}`))
  )
    return;
  const { execution, rule } = await validJob(job);
  if (!rule || !rule.followGateEnabled) {
    await db.$transaction((tx) =>
      executionState(tx, execution.id, { dmStatus: 'cancelled', error: 'AUTOMATION_CHANGED' }),
    );
    return;
  }
  if (execution.contentDeliveredAt) return;
  const key = `comment-follow:${digest(p.followToken)}`,
    record = await db.nativeIdempotency.findUnique({
      where: { vendorId_key: { vendorId: job.vendorId!, key } },
    }),
    state = record?.response as any;
  if (
    !record ||
    state.state !== 'waiting' ||
    state.executionId !== execution.id ||
    state.recipientId !== p.senderId ||
    state.expiresAt < Date.now() ||
    p.at < Date.now() - 86400000
  ) {
    await db.$transaction((tx) =>
      executionState(tx, execution.id, { error: 'FOLLOW_REPLY_EXPIRED' }),
    );
    return;
  }
  const checkKey = `comment-check:${execution.id}:${digest(p.mid)}`;
  const check = await db.$transaction(async (tx) => {
    await lockCommentAutomation(tx, `comment-check-limit:${execution.id}`);
    const prior = await tx.nativeIdempotency.findUnique({
      where: { vendorId_key: { vendorId: job.vendorId!, key: checkKey } },
    });
    if (prior) return prior;
    const current = await tx.commentToDmExecutions.findUniqueOrThrow({
      where: { id: execution.id },
    });
    if (current.followGateChecks >= 10) return null;
    await tx.commentToDmExecutions.update({
      where: { id: execution.id },
      data: { followGateChecks: { increment: 1 }, followGateCheckedAt: new Date() },
    });
    return tx.nativeIdempotency.create({
      data: {
        vendorId: job.vendorId!,
        key: checkKey,
        requestHash: digest(p.senderId),
        response: { state: 'issued' },
      },
    });
  });
  if (!check) return;
  let decision = check.response as any;
  if (decision.state !== 'checked') {
    let profile: any;
    try {
      profile = await metaRequest(
        job.vendorId!,
        rule.platform,
        rule.externalAccountId,
        p.senderId,
        'GET',
        undefined,
        { fields: 'id,is_user_follow_business' },
      );
    } catch {
      await db.$transaction((tx) =>
        executionState(tx, execution.id, { error: 'FOLLOW_LOOKUP_PENDING' }),
      );
      throw new ApiError(503, 'FOLLOW_LOOKUP_PENDING', 'Follow status lookup has not completed');
    }
    if (profile.id !== p.senderId || typeof profile.is_user_follow_business !== 'boolean')
      throw new ApiError(502, 'PROVIDER_RESPONSE', 'Provider did not confirm following status');
    decision = await db.$transaction(async (tx) => {
      await lockCommentAutomation(tx, `comment-check-decision:${execution.id}:${digest(p.mid)}`);
      const existing = await tx.nativeIdempotency.findUniqueOrThrow({ where: { id: check.id } });
      if ((existing.response as any).state === 'checked') return existing.response;
      const response = { state: 'checked', following: profile.is_user_follow_business };
      await tx.nativeIdempotency.update({ where: { id: check.id }, data: { response } });
      return response;
    });
  }
  const following = decision.following === true;
  if (!(await validJob(job)).rule || p.at < Date.now() - 86400000) {
    await db.$transaction((tx) =>
      executionState(tx, execution.id, { dmStatus: 'cancelled', error: 'AUTOMATION_CHANGED' }),
    );
    return;
  }
  await recordCommentEffect(
    job,
    following ? 'content' : `follow-retry:${digest(p.mid)}`,
    async () => {
      const message = following
        ? buildCommentReplyContent(rule)
        : {
            text: rule.followGateRetryMessage,
            quick_replies: [
              {
                content_type: 'text',
                title: "I'm following",
                payload: `whalexy-follow:${p.followToken}`,
              },
            ],
          };
      const result = await metaRequest(
        job.vendorId!,
        rule.platform,
        rule.externalAccountId,
        `${rule.externalAccountId}/messages`,
        'POST',
        { recipient: { id: p.senderId }, message },
      );
      if (!socialMessageId(result.message_id) || result.recipient_id !== p.senderId)
        throw new ApiError(
          502,
          'PROVIDER_UNCERTAIN',
          'Provider did not confirm follow-gate delivery',
        );
      return { id: result.message_id, recipientId: result.recipient_id };
    },
    async (tx) => {
      if (following) {
        await executionState(tx, execution.id, {
          dmStatus: 'success',
          followGateStatus: 'verified',
          contentDeliveredAt: new Date(),
          error: null,
        });
        await tx.nativeIdempotency.update({
          where: { id: record.id },
          data: { response: { ...state, state: 'complete' } },
        });
      } else
        await executionState(tx, execution.id, {
          dmStatus: 'waiting_follow',
          followGateStatus: 'waiting',
          error: null,
        });
    },
  );
}
