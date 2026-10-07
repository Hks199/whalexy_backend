import { type OutboxJobs } from '@prisma/client';
import { db } from '../database/client.js';
import { finishCampaign } from '../modules/campaigns/services/campaigns-support.service.js';
import { recordStoreDelivery } from '../modules/store-notifications/services/notification-delivery.service.js';
import { recoverCommentJob } from '../modules/comment-automations/services/automation-recovery.service.js';

export async function recoverInterruptedJobs(at = new Date()) {
  const campaigns = new Map<number, number>();
  const recovered = await db.$transaction(async (tx) => {
    const jobs = await tx.$queryRaw<
      OutboxJobs[]
    >`UPDATE "node_outbox_jobs" SET "status"='uncertain', "lockedAt"=NULL, "lastError"='WORKER_INTERRUPTED' WHERE "status"='processing' AND "lockedAt"<${new Date(at.getTime() - 10 * 60000)} RETURNING *`;
    for (const job of jobs) {
      const payload = job.payload as any;
      if (job.kind === 'conversation-analysis') {
        const eventKey = `conversation-analysis:${job.id}`;
        const receipt = await tx.webhookReceipts.findUnique({ where: { eventKey } });
        const snapshot = receipt?.payload as any;
        const status =
          snapshot?.status === 'completed'
            ? 'completed'
            : snapshot?.status === 'prepared'
              ? 'pending'
              : 'uncertain';
        await tx.outboxJobs.update({
          where: { id: job.id },
          data: {
            status,
            availableAt: at,
            lastError: status === 'uncertain' ? 'WORKER_INTERRUPTED' : null,
          },
        });
        if (snapshot?.status === 'processing')
          await tx.webhookReceipts.update({
            where: { eventKey },
            data: {
              payload: { ...snapshot, status: 'uncertain', failureCode: 'WORKER_INTERRUPTED' },
            },
          });
        continue;
      }
      if (['comment-action', 'comment-follow'].includes(job.kind)) {
        await recoverCommentJob(tx, job, at);
        continue;
      }
      if (job.kind === 'bot-flow-resume') {
        const committed = await tx.webhookReceipts.findUnique({
          where: { eventKey: `graph-resume:${job.id}` },
        });
        await tx.outboxJobs.update({
          where: { id: job.id },
          data: { status: committed ? 'completed' : 'pending', lastError: null, availableAt: at },
        });
        continue;
      }
      if (job.kind === 'store-notification') {
        const receipt = await tx.webhookReceipts.findUnique({
          where: { eventKey: `store-notification:${job.id}` },
        });
        await tx.outboxJobs.update({
          where: { id: job.id },
          data: { status: receipt ? 'completed' : 'pending', lastError: null, availableAt: at },
        });
        continue;
      }
      if (job.kind === 'cx-score') {
        const score = await tx.conversationCxScores.findFirst({
          where: { id: (payload as any).scoreId, vendorId: job.vendorId! },
        });
        await tx.outboxJobs.update({
          where: { id: job.id },
          data: {
            status: score?.status === 'completed' ? 'completed' : 'uncertain',
            lastError: score?.status === 'completed' ? null : 'WORKER_INTERRUPTED',
          },
        });
        if (score?.status === 'processing')
          await tx.conversationCxScores.update({
            where: { id: score.id },
            data: { status: 'uncertain', failureMessage: 'WORKER_INTERRUPTED', updatedAt: at },
          });
        continue;
      }
      if (
        ['webhook-shopify', 'webhook-woocommerce', 'webhook-stripe', 'webhook-razorpay'].includes(
          job.kind,
        )
      ) {
        const receipt = await tx.webhookReceipts.findUnique({
          where: { eventKey: payload.eventKey },
        });
        await tx.outboxJobs.update({
          where: { id: job.id },
          data: {
            status: receipt?.processedAt ? 'completed' : 'pending',
            lastError: null,
            availableAt: at,
          },
        });
        continue;
      }
      if (job.kind === 'whatsapp-send') {
        const message = await tx.whatsappMessageLogs.findFirst({
          where: { id: payload.messageId, vendorId: job.vendorId! },
          select: { whatsappMessageId: true, campaignId: true },
        });
        if (message?.campaignId) campaigns.set(message.campaignId, job.vendorId!);
        if (message?.whatsappMessageId) {
          await tx.outboxJobs.update({
            where: { id: job.id },
            data: { status: 'completed', lastError: null },
          });
          continue;
        }
      }
      if (job.kind === 'whatsapp-send')
        await tx.whatsappMessageLogs.updateMany({
          where: { id: payload.messageId, vendorId: job.vendorId! },
          data: { status: 'uncertain', updatedAt: at },
        });
      if (payload.storeNotification)
        await recordStoreDelivery(tx, job.vendorId!, payload.storeNotification, 'uncertain');
      if (payload.queueId) {
        await tx.whatsappMessageQueue.updateMany({
          where: { id: payload.queueId, vendorId: job.vendorId! },
          data: { status: 2, data: { uncertain: true }, updatedAt: at },
        });
      }
      if (payload.awayDeliveryId)
        await tx.outOfOfficeDeliveries.updateMany({
          where: {
            id: payload.awayDeliveryId,
            refOutOfOfficeSettingsId: { vendorId: job.vendorId! },
            status: 'processing',
          },
          data: { status: 'uncertain', failureReason: 'WORKER_INTERRUPTED', updatedAt: at },
        });
      if (payload.reminderDeliveryId)
        await tx.whalexyAppointmentReminderDeliveries.updateMany({
          where: {
            id: payload.reminderDeliveryId,
            vendorId: job.vendorId!,
            status: 'processing',
            scheduledFor: new Date(payload.scheduledFor),
          },
          data: { status: 'uncertain', lastError: 'WORKER_INTERRUPTED', updatedAt: at },
        });
    }
    return jobs.length;
  });
  for (const [campaignId, vendorId] of campaigns)
    await db.$transaction((tx) => finishCampaign(tx, vendorId, campaignId));
  return recovered;
}
