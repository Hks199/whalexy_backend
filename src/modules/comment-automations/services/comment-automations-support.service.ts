import { Prisma, type OutboxJobs, type CommentToDmAutomations } from '@prisma/client';
import { db } from '../../../database/client.js';
import { digest } from '../../../utils/crypto.js';
import { ApiError } from '../../../shared/api-error.js';
import { verifiedSocial } from '../../social-accounts/social-accounts.service.js';

export const safeExecutionErrors = new Set([
  'AUTOMATION_CHANGED',
  'COMMENT_WINDOW_EXPIRED',
  'FOLLOW_REPLY_EXPIRED',
  'PROVIDER_REJECTED',
  'PROVIDER_UNCERTAIN',
  'WORKER_INTERRUPTED',
  'COMMENT_LOOKUP_PENDING',
  'COMMENT_LOOKUP_REJECTED',
  'FOLLOW_LOOKUP_PENDING',
]);

export const presentRule = (row: CommentToDmAutomations) => {
  const { dmAttachmentPath, ...safe } = row;
  return safe;
};

export function buildAutomationData(b: any) {
  const { attachment, ...data } = b;
  return {
    ...data,
    mediaId: b.mediaId ?? null,
    publicReplyMessage: b.publicReplyMessage ?? null,
    dmAttachmentType: attachment?.type ?? null,
    dmAttachmentUrl: attachment?.url ?? null,
    followGateMessage: b.followGateMessage ?? null,
    followGateRetryMessage: b.followGateRetryMessage ?? null,
  };
}

export async function validateAccount(vendorId: number, b: any) {
  if (b.followGateEnabled && b.platform !== 'instagram')
    throw new ApiError(400, 'FOLLOW_GATE_PLATFORM', 'Follow gates require Instagram');
  if (b.attachment?.type === 'audio' && b.platform === 'instagram')
    throw new ApiError(
      400,
      'COMMENT_ATTACHMENT',
      'Instagram audio private replies need a verified adapter',
    );
  if (
    b.platform === 'instagram' &&
    b.attachment?.type === 'file' &&
    b.dmMessage.length + b.attachment.url.length + 1 > 1000
  )
    throw new ApiError(
      400,
      'COMMENT_ATTACHMENT',
      'The combined Instagram file-link reply exceeds 1000 characters',
    );
  return verifiedSocial(vendorId, b.platform, b.externalAccountId);
}

export async function lockCommentAutomation(tx: Prisma.TransactionClient, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`;
}

export async function retainAutomationProof(
  tx: Prisma.TransactionClient,
  row: CommentToDmAutomations,
  credential: any,
  actorId: number,
) {
  await tx.nativeIdempotency.upsert({
    where: { vendorId_key: { vendorId: row.vendorId, key: `comment-config:${row.id}` } },
    create: {
      vendorId: row.vendorId,
      key: `comment-config:${row.id}`,
      requestHash: digest(row.uuid),
      response: {
        version: 1,
        actorId,
        revision: row.updatedAt.toISOString(),
        credentialId: credential.credential.id,
        tokenHash: credential.proof.tokenHash,
      },
    },
    update: {
      response: {
        version: 1,
        actorId,
        revision: row.updatedAt.toISOString(),
        credentialId: credential.credential.id,
        tokenHash: credential.proof.tokenHash,
      },
    },
  });
}

export async function requireSignedCommentReceipt(eventKey: string | undefined, body: any) {
  if (
    !eventKey ||
    !(await db.webhookReceipts.findFirst({
      where: { eventKey, provider: 'meta', payload: { equals: body } },
      select: { id: true },
    }))
  )
    throw new ApiError(
      403,
      'SIGNED_SOCIAL_RECEIPT_REQUIRED',
      'A verified Meta receipt is required',
    );
}

export function buildCommentReplyContent(rule: CommentToDmAutomations) {
  const type = rule.dmAttachmentType,
    url = rule.dmAttachmentUrl,
    message = rule.dmMessage;
  if (!url) return { text: message };
  if (rule.platform === 'instagram' && type === 'file') return { text: `${message}\n${url}` };
  if (type === 'image')
    return {
      attachment: {
        type: 'template',
        payload: {
          template_type: 'generic',
          elements: [
            {
              title: [...message].slice(0, 80).join(''),
              image_url: url,
              ...([...message].length > 80
                ? { subtitle: [...message].slice(80, 160).join('') }
                : {}),
            },
          ],
        },
      },
    };
  return { attachment: { type, payload: { url } } };
}

export async function executionState(tx: Prisma.TransactionClient, id: number, data: any) {
  const row = await tx.commentToDmExecutions.update({
    where: { id },
    data: { ...data, updatedAt: new Date() },
  });
  const dm = row.dmStatus,
    reply = row.publicReplyStatus,
    status = [dm, reply].includes('uncertain')
      ? 'uncertain'
      : dm === 'waiting_follow'
        ? 'waiting_follow'
        : ['pending', 'processing'].includes(dm) || ['pending', 'processing'].includes(reply)
          ? 'pending'
          : dm === 'success'
            ? reply === 'failed' || reply === 'cancelled'
              ? 'partial'
              : 'success'
            : dm === 'cancelled'
              ? 'cancelled'
              : 'failed';
  await tx.commentToDmExecutions.update({ where: { id }, data: { status } });
}

export async function validJob(job: OutboxJobs) {
  const p = job.payload as any,
    execution = await db.commentToDmExecutions.findFirst({
      where: { id: p.executionId, vendorId: job.vendorId! },
    });
  if (!execution) throw new ApiError(404, 'NOT_FOUND', 'Comment execution not found');
  const rule = await db.commentToDmAutomations.findFirst({
    where: {
      id: execution.automationId,
      vendorId: job.vendorId!,
      status: 'active',
      deletedAt: null,
    },
  });
  const [vendor, user, member] = await Promise.all([
    db.vendors.findUnique({ where: { id: job.vendorId! }, select: { status: true } }),
    db.users.findUnique({ where: { id: p.actorId }, select: { status: true } }),
    db.nativeMemberships.findUnique({
      where: { vendorId_userId: { vendorId: job.vendorId!, userId: p.actorId } },
    }),
  ]);
  const permissions = Array.isArray(member?.permissions) ? member.permissions : [];
  if (
    !rule ||
    rule.updatedAt.toISOString() !== p.ruleRevision ||
    vendor?.status !== 1 ||
    user?.status !== 1 ||
    !member?.active ||
    member.role !== 'owner' ||
    !['vendor.bot.manage', 'vendor.integrations.manage'].every(
      (v) => permissions.includes('*') || permissions.includes(v),
    )
  )
    return { execution, rule: null };
  let account;
  try {
    account = await verifiedSocial(job.vendorId!, rule.platform, rule.externalAccountId);
  } catch (error) {
    if (error instanceof ApiError) return { execution, rule: null };
    throw error;
  }
  if (account.credential.id !== p.credentialId || account.proof.tokenHash !== p.tokenHash)
    return { execution, rule: null };
  return { execution, rule, account };
}

// Claim each irreversible effect before Graph. Success/unknown/rejection all retain
// the claim; neither another worker nor webhook replay can issue it a second time.
export async function recordCommentEffect(
  job: OutboxJobs,
  name: string,
  perform: () => Promise<any>,
  commit: (tx: Prisma.TransactionClient, value: any) => Promise<void>,
) {
  const vendorId = job.vendorId!,
    p = job.payload as any,
    key = `comment-effect:${p.executionId}:${name}`;
  const claimed = await db.$transaction(async (tx) => {
    await lockCommentAutomation(tx, `${vendorId}:${key}`);
    const old = await tx.nativeIdempotency.findUnique({
      where: { vendorId_key: { vendorId, key } },
    });
    if (old) {
      const s = old.response as any;
      if (s.state === 'complete') return false;
      throw new ApiError(
        409,
        'COMMENT_RECONCILIATION_PENDING',
        'An existing comment effect needs provider reconciliation',
      );
    }
    await tx.nativeIdempotency.create({
      data: {
        vendorId,
        key,
        requestHash: digest(JSON.stringify(p)),
        response: { state: 'processing' },
      },
    });
    return true;
  });
  if (!claimed) return;
  let accepted: any;
  try {
    accepted = await perform();
    await db.$transaction(async (tx) => {
      await commit(tx, accepted);
      await tx.nativeIdempotency.update({
        where: { vendorId_key: { vendorId, key } },
        data: { response: { state: 'complete', result: accepted } },
      });
    });
  } catch (error) {
    const rejected = error instanceof ApiError && error.code === 'PROVIDER_REJECTED';
    await db.$transaction(async (tx) => {
      await tx.nativeIdempotency.update({
        where: { vendorId_key: { vendorId, key } },
        data: {
          response: {
            state: rejected ? 'rejected' : 'uncertain',
            ...(accepted ? { acceptedResult: accepted } : {}),
            code: error instanceof ApiError ? error.code : 'COMMENT_EFFECT_ERROR',
          },
        },
      });
      await executionState(tx, p.executionId, {
        [name === 'public' ? 'publicReplyStatus' : 'dmStatus']: rejected ? 'failed' : 'uncertain',
        error: rejected ? 'PROVIDER_REJECTED' : 'PROVIDER_UNCERTAIN',
      });
    });
    throw new ApiError(
      502,
      rejected ? 'COMMENT_PROVIDER_REJECTED' : 'PROVIDER_UNCERTAIN',
      'Comment provider effect needs review',
    );
  }
}

export async function getRecordedCommentEffect(vendorId: number, id: number, name: string) {
  const row = await db.nativeIdempotency.findUnique({
    where: { vendorId_key: { vendorId, key: `comment-effect:${id}:${name}` } },
  });
  if (!row) return false;
  if ((row.response as any).state === 'complete') return true;
  throw new ApiError(
    409,
    'COMMENT_RECONCILIATION_PENDING',
    'An existing comment effect needs provider reconciliation',
  );
}
