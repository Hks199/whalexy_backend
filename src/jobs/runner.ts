import { type OutboxJobs } from '@prisma/client';
import { db } from '../database/client.js';
import { logger } from '../observability/logger.js';
import { ApiError } from '../shared/api-error.js';
import { finishCampaign } from '../modules/campaigns/services/campaigns-support.service.js';
import { recordStoreDelivery } from '../modules/store-notifications/services/notification-delivery.service.js';
import { processJob } from './dispatcher.js';

export async function runOneJob() {
  const jobs = await db.$queryRaw<
    OutboxJobs[]
  >`UPDATE "node_outbox_jobs" SET "status"='processing', "lockedAt"=NOW(), "attempts"="attempts"+1 WHERE "id"=(SELECT "id" FROM "node_outbox_jobs" WHERE "status"='pending' AND "availableAt"<=NOW() ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`;
  const job = jobs[0];
  if (!job) return false;
  try {
    await processJob(job);
    await db.outboxJobs.update({
      where: { id: job.id },
      data: { status: 'completed', lockedAt: null, lastError: null },
    });
  } catch (e) {
    if (
      job.kind === 'whatsapp-send' &&
      (await db.whatsappMessageLogs.findFirst({
        where: {
          id: (job.payload as any).messageId,
          vendorId: job.vendorId!,
          whatsappMessageId: { not: null },
        },
        select: { id: true },
      }))
    ) {
      await db.outboxJobs.update({
        where: { id: job.id },
        data: { status: 'completed', lockedAt: null, lastError: null },
      });
      return true;
    }
    const code = e instanceof ApiError ? e.code : 'INTERNAL_JOB_ERROR';
    if (code === 'CAMPAIGN_PAUSED') {
      await db.outboxJobs.update({
        where: { id: job.id },
        data: {
          status: 'pending',
          attempts: { decrement: 1 },
          lockedAt: null,
          availableAt: new Date(Date.now() + 30000),
          lastError: code,
        },
      });
      return true;
    }
    if (['GRAPH_TIMING_PAUSED', 'GRAPH_AWAY_PAUSED'].includes(code)) {
      await db.outboxJobs.update({
        where: { id: job.id },
        data: {
          status: 'pending',
          attempts: { decrement: 1 },
          lockedAt: null,
          availableAt: new Date(Date.now() + 30000),
          lastError: code,
        },
      });
      return true;
    }
    const uncertain =
      code === 'PROVIDER_UNCERTAIN' ||
      code === 'COMMENT_RECONCILIATION_PENDING' ||
      (['whatsapp-send', 'email', 'comment-action', 'comment-follow'].includes(job.kind) &&
        !(e instanceof ApiError));
    const pending =
      code.endsWith('_PENDING') ||
      code.endsWith('_NOT_CONFIGURED') ||
      code.startsWith('UNROUTABLE');
    const status = uncertain
      ? 'uncertain'
      : pending
        ? 'blocked'
        : ['cx-score', 'conversation-analysis', 'comment-action', 'comment-follow'].includes(
              job.kind,
            ) || job.attempts >= 5
          ? 'failed'
          : 'pending';
    await db.outboxJobs.update({
      where: { id: job.id },
      data: {
        status,
        lockedAt: null,
        lastError: code,
        availableAt: new Date(Date.now() + Math.min(3600, 2 ** job.attempts) * 1000),
      },
    });
    if (
      (job.payload as any).storeNotification &&
      ['failed', 'blocked', 'uncertain'].includes(status)
    )
      await db.$transaction((tx) =>
        recordStoreDelivery(tx, job.vendorId!, (job.payload as any).storeNotification, status),
      );
    if ((job.payload as any).awayDeliveryId && ['failed', 'blocked', 'uncertain'].includes(status))
      await db.outOfOfficeDeliveries.updateMany({
        where: {
          id: (job.payload as any).awayDeliveryId,
          refOutOfOfficeSettingsId: { vendorId: job.vendorId! },
        },
        data: { status, failureReason: code, updatedAt: new Date() },
      });
    if (
      (job.payload as any).reminderDeliveryId &&
      ['failed', 'blocked', 'uncertain'].includes(status)
    )
      await db.whalexyAppointmentReminderDeliveries.updateMany({
        where: {
          id: (job.payload as any).reminderDeliveryId,
          vendorId: job.vendorId!,
          status: 'processing',
          scheduledFor: new Date((job.payload as any).scheduledFor),
        },
        data: { status, lastError: code, updatedAt: new Date() },
      });
    if (uncertain && job.kind === 'whatsapp-send')
      await db.whatsappMessageLogs.updateMany({
        where: { id: (job.payload as any).messageId, vendorId: job.vendorId! },
        data: { status: 'uncertain' },
      });
    if ((job.payload as any).queueId && ['failed', 'blocked', 'uncertain'].includes(status)) {
      const payload = job.payload as any;
      await db.$transaction(async (tx) => {
        await tx.whatsappMessageQueue.updateMany({
          where: { id: payload.queueId, vendorId: job.vendorId! },
          data: { status: 2, data: { outboxStatus: status, code }, updatedAt: new Date() },
        });
        await tx.whatsappMessageLogs.updateMany({
          where: { id: payload.messageId, vendorId: job.vendorId!, whatsappMessageId: null },
          data: { status, updatedAt: new Date() },
        });
      });
      if (payload.campaignId)
        await db.$transaction((tx) => finishCampaign(tx, job.vendorId!, payload.campaignId));
    }
    logger.warn({ jobId: job.id, kind: job.kind, code, status }, 'job did not complete');
  }
  return true;
}
