import { Prisma, type OutboxJobs } from '@prisma/client';
import { db } from '../../../database/client.js';
import { digest } from '../../../utils/crypto.js';
import { executionState } from './comment-automations-support.service.js';

export async function recoverCommentJob(tx: Prisma.TransactionClient, job: OutboxJobs, at: Date) {
  const p = job.payload as any,
    key =
      job.kind === 'comment-action'
        ? `comment-effect:${p.executionId}:${p.action}`
        : `comment-effect:${p.executionId}:follow-retry:${digest(p.mid)}`;
  const specific = await tx.nativeIdempotency.findUnique({
      where: { vendorId_key: { vendorId: job.vendorId!, key } },
    }),
    content =
      job.kind === 'comment-follow'
        ? await tx.nativeIdempotency.findUnique({
            where: {
              vendorId_key: {
                vendorId: job.vendorId!,
                key: `comment-effect:${p.executionId}:content`,
              },
            },
          })
        : null;
  const state = (specific?.response as any)?.state ?? (content?.response as any)?.state;
  const status =
    state === 'complete'
      ? 'completed'
      : state === undefined
        ? 'pending'
        : state === 'rejected'
          ? 'failed'
          : 'uncertain';
  await tx.outboxJobs.update({
    where: { id: job.id },
    data: {
      status,
      lockedAt: null,
      lastError: status === 'uncertain' ? 'WORKER_INTERRUPTED' : null,
      availableAt: at,
    },
  });
  if (
    status === 'uncertain' &&
    (await tx.commentToDmExecutions.findFirst({
      where: { id: p.executionId, vendorId: job.vendorId! },
      select: { id: true },
    }))
  )
    await executionState(tx, p.executionId, {
      [p.action === 'public' ? 'publicReplyStatus' : 'dmStatus']: 'uncertain',
      error: 'WORKER_INTERRUPTED',
    });
}

export async function commentJobRetryAllowed(job: OutboxJobs) {
  const p = job.payload as any,
    keys =
      job.kind === 'comment-action'
        ? [`comment-effect:${p.executionId}:${p.action}`]
        : [
            `comment-effect:${p.executionId}:content`,
            `comment-effect:${p.executionId}:follow-retry:${digest(p.mid)}`,
          ];
  const rows = await db.nativeIdempotency.findMany({
    where: { vendorId: job.vendorId!, key: { in: keys } },
    select: { response: true },
  });
  return rows.every((row) => (row.response as any).state === 'complete');
}
