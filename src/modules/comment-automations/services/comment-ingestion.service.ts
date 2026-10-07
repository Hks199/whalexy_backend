import { Prisma } from '@prisma/client';
import { db } from '../../../database/client.js';
import { digest, opaqueToken } from '../../../utils/crypto.js';
import { ApiError } from '../../../shared/api-error.js';
import { commentEvent, matchesComment } from './comment-events.js';
import { verifiedSocial } from '../../social-accounts/social-accounts.service.js';
import {
  requireSignedCommentReceipt,
  lockCommentAutomation,
} from './comment-automations-support.service.js';

export async function ingestCommentChange(body: any, entry: any, change: any, eventKey?: string) {
  const relevant =
    (body.object === 'instagram' && ['comments', 'live_comments'].includes(change.field)) ||
    (body.object === 'page' && change.field === 'feed' && change.value?.item === 'comment');
  if (!relevant) return false;
  await requireSignedCommentReceipt(eventKey, body);
  if (body.object === 'page' && (change.value.verb ?? 'add') !== 'add') return true;
  const event = commentEvent(body.object, entry, change);
  if (!event)
    throw new ApiError(
      400,
      'COMMENT_EVENT_INVALID',
      'Comment webhook identity and time are invalid',
    );
  if (event.live)
    throw new ApiError(
      503,
      'COMMENT_LIVE_PENDING',
      'Live comments require broadcast-state verification',
    );
  const credentials = await db.integrationCredentials.findMany({
    where: { provider: event.platform, externalId: event.account },
    take: 2,
  });
  if (credentials.length !== 1)
    throw new ApiError(
      503,
      'UNROUTABLE_SOCIAL_COMMENT',
      'Social account must map to one verified business',
    );
  const vendorId = credentials[0].vendorId,
    account = await verifiedSocial(vendorId, event.platform, event.account);
  if (
    [event.account, account.proof.pageId].includes(event.commenterId) ||
    event.at < Date.now() - 7 * 86400000
  )
    return true;
  const rules = await db.commentToDmAutomations.findMany({
    where: {
      vendorId,
      platform: event.platform,
      externalAccountId: event.account,
      status: 'active',
      deletedAt: null,
    },
    orderBy: { id: 'asc' },
  });
  for (const rule of rules) {
    if (!matchesComment(rule, event)) continue;
    const proof = await db.nativeIdempotency.findUnique({
        where: { vendorId_key: { vendorId, key: `comment-config:${rule.id}` } },
      }),
      p = proof?.response as any;
    if (
      p?.version !== 1 ||
      p.revision !== rule.updatedAt.toISOString() ||
      p.credentialId !== account.credential.id ||
      p.tokenHash !== account.proof.tokenHash
    )
      continue;
    await db.$transaction(async (tx) => {
      const key = `comment-private:${event.platform}:${event.account}:${event.commentId}`;
      await lockCommentAutomation(tx, `${vendorId}:${key}`);
      if (
        await tx.nativeIdempotency.findUnique({
          where: { vendorId_key: { vendorId, key } },
          select: { id: true },
        })
      )
        return;
      await lockCommentAutomation(tx, `comment-rule:${rule.id}`);
      const fresh = await tx.commentToDmAutomations.findFirst({
        where: {
          id: rule.id,
          vendorId,
          status: 'active',
          deletedAt: null,
          updatedAt: rule.updatedAt,
        },
      });
      if (!fresh) return;
      const execution = await tx.commentToDmExecutions.create({
        data: {
          automationId: rule.id,
          vendorId,
          platform: event.platform,
          commentId: event.commentId,
          mediaId: event.mediaId,
          commenterId: event.commenterId,
          matchedAt: new Date(),
          dmStatus: 'pending',
          publicReplyStatus: rule.publicReplyEnabled ? 'pending' : 'skipped',
          followGateStatus: rule.followGateEnabled ? 'pending' : 'disabled',
        },
      });
      await tx.nativeIdempotency.create({
        data: {
          vendorId,
          key,
          requestHash: digest(event.commentId),
          response: { executionId: execution.id },
        },
      });
      const token = rule.followGateEnabled ? opaqueToken() : null;
      if (token)
        await tx.nativeIdempotency.create({
          data: {
            vendorId,
            key: `comment-follow:${digest(token)}`,
            requestHash: digest(`${event.account}:${execution.id}`),
            response: {
              executionId: execution.id,
              account: event.account,
              credentialId: account.credential.id,
              recipientId: null,
              state: 'queued',
              expiresAt: event.at + 7 * 86400000,
            },
          },
        });
      for (const action of ['private', ...(rule.publicReplyEnabled ? ['public'] : [])])
        await tx.outboxJobs.create({
          data: {
            vendorId,
            kind: 'comment-action',
            dedupeKey: `comment:${execution.id}:${action}`,
            payload: {
              executionId: execution.id,
              action,
              ruleRevision: rule.updatedAt.toISOString(),
              actorId: p.actorId,
              credentialId: account.credential.id,
              tokenHash: account.proof.tokenHash,
              event: event as unknown as Prisma.InputJsonObject,
              ...(token ? { followToken: token } : {}),
            },
          },
        });
      await tx.commentToDmAutomations.update({
        where: { id: rule.id },
        data: { lastTriggeredAt: new Date() },
      });
    });
    break; // Private replies permit one opportunity per account/comment.
  }
  return true;
}
