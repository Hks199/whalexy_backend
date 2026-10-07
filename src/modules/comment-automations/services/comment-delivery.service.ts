import { type OutboxJobs } from '@prisma/client';
import { db } from '../../../database/client.js';
import { digest } from '../../../utils/crypto.js';
import { ApiError } from '../../../shared/api-error.js';
import { metaRequest } from '../../../infrastructure/providers/meta.client.js';
import { eventTime, socialId, socialMessageId, type CommentEvent } from './comment-events.js';
import {
  getRecordedCommentEffect,
  validJob,
  executionState,
  recordCommentEffect,
  buildCommentReplyContent,
  lockCommentAutomation,
} from './comment-automations-support.service.js';
import { queueFollowCheck } from './follow-checks.service.js';

export async function dispatchCommentAction(job: OutboxJobs) {
  const p = job.payload as any;
  if (await getRecordedCommentEffect(job.vendorId!, p.executionId, p.action)) return;
  const { execution, rule } = await validJob(job);
  if (!rule) {
    await db.$transaction((tx) =>
      executionState(tx, execution.id, {
        [p.action === 'public' ? 'publicReplyStatus' : 'dmStatus']: 'cancelled',
        error: 'AUTOMATION_CHANGED',
      }),
    );
    return;
  }
  if (
    (p.action === 'private' && ['success', 'waiting_follow'].includes(execution.dmStatus)) ||
    (p.action === 'public' && execution.publicReplyStatus === 'success')
  )
    return;
  const event = p.event as CommentEvent;
  let remote: any;
  try {
    remote = await metaRequest(
      job.vendorId!,
      rule.platform,
      rule.externalAccountId,
      event.commentId,
      'GET',
      undefined,
      { fields: rule.platform === 'instagram' ? 'id,timestamp' : 'id,created_time' },
    );
  } catch (error) {
    const rejected = error instanceof ApiError && error.code === 'PROVIDER_REJECTED';
    await db.$transaction((tx) =>
      executionState(tx, execution.id, {
        ...(rejected
          ? { [p.action === 'public' ? 'publicReplyStatus' : 'dmStatus']: 'failed' }
          : {}),
        error: rejected ? 'COMMENT_LOOKUP_REJECTED' : 'COMMENT_LOOKUP_PENDING',
      }),
    );
    throw new ApiError(
      503,
      rejected ? 'COMMENT_LOOKUP_REJECTED' : 'COMMENT_LOOKUP_PENDING',
      'Comment lookup requires review before a reply can be prepared',
    );
  }
  const created = eventTime(remote.timestamp ?? remote.created_time);
  if (remote.id !== event.commentId || !created || created > Date.now() + 300000)
    throw new ApiError(
      503,
      'COMMENT_TIME_NOT_CONFIGURED',
      'Verify the actual comment creation time before replying',
    );
  if (Math.min(created, event.at) < Date.now() - 7 * 86400000) {
    await db.$transaction((tx) =>
      executionState(tx, execution.id, {
        [p.action === 'public' ? 'publicReplyStatus' : 'dmStatus']: 'cancelled',
        error: 'COMMENT_WINDOW_EXPIRED',
      }),
    );
    return;
  }
  if (!(await validJob(job)).rule) {
    await db.$transaction((tx) =>
      executionState(tx, execution.id, {
        [p.action === 'public' ? 'publicReplyStatus' : 'dmStatus']: 'cancelled',
        error: 'AUTOMATION_CHANGED',
      }),
    );
    return;
  }
  await recordCommentEffect(
    job,
    p.action,
    async () => {
      const path =
        p.action === 'public'
          ? `${event.commentId}/${rule.platform === 'instagram' ? 'replies' : 'comments'}`
          : `${rule.externalAccountId}/messages`;
      const message = rule.followGateEnabled
        ? {
            text: rule.followGateMessage,
            quick_replies: [
              {
                content_type: 'text',
                title: "I'm following",
                payload: `whalexy-follow:${p.followToken}`,
              },
            ],
          }
        : buildCommentReplyContent(rule);
      const result = await metaRequest(
        job.vendorId!,
        rule.platform,
        rule.externalAccountId,
        path,
        'POST',
        p.action === 'public'
          ? { message: rule.publicReplyMessage }
          : { recipient: { comment_id: event.commentId }, message },
      );
      const id = p.action === 'public' ? result.id : result.message_id;
      if (
        !(p.action === 'public' ? socialId(id) : socialMessageId(id)) ||
        (p.action === 'private' && rule.followGateEnabled && !socialId(result.recipient_id))
      )
        throw new ApiError(
          502,
          'PROVIDER_UNCERTAIN',
          'Provider did not confirm comment delivery identity',
        );
      return { id, ...(socialId(result.recipient_id) ? { recipientId: result.recipient_id } : {}) };
    },
    async (tx, result) => {
      await executionState(
        tx,
        execution.id,
        p.action === 'public'
          ? { publicReplyStatus: 'success' }
          : rule.followGateEnabled
            ? {
                dmStatus: 'waiting_follow',
                followGateStatus: 'waiting',
                followGateRecipientId: result.recipientId,
              }
            : { dmStatus: 'success', contentDeliveredAt: new Date() },
      );
      if (p.action === 'private' && rule.followGateEnabled) {
        const key = `comment-follow:${digest(p.followToken)}`;
        await lockCommentAutomation(tx, `${job.vendorId}:${key}`);
        const token = await tx.nativeIdempotency.findUniqueOrThrow({
            where: { vendorId_key: { vendorId: job.vendorId!, key } },
          }),
          state = token.response as any;
        await tx.nativeIdempotency.update({
          where: { id: token.id },
          data: { response: { ...state, state: 'waiting', recipientId: result.recipientId } },
        });
        if (state.earlyReply?.senderId === result.recipientId)
          await queueFollowCheck(
            tx,
            job.vendorId!,
            state.executionId,
            p.followToken,
            state.earlyReply,
            p,
          );
      }
    },
  );
}
