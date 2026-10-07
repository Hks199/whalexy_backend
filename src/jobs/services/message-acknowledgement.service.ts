import { acknowledgeReaction } from '../../modules/messaging/services/reactions.js';
import { Prisma, type OutboxJobs } from '@prisma/client';
import { ApiError } from '../../shared/api-error.js';
import { campaignTestHash } from '../../modules/campaigns/services/campaigns-support.service.js';
import { acceptHandoff } from '../../modules/handoffs/services/handoffs.js';
import { recordStoreDelivery } from '../../modules/store-notifications/services/notification-delivery.service.js';

export async function acknowledgeSend(
  tx: Prisma.TransactionClient,
  job: OutboxJobs,
  id: string,
  accepted = true,
) {
  const p = job.payload as any;
  if (p.campaignTestId)
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(606, ${p.campaignTestId}::integer)`;
  const row = await tx.whatsappMessageLogs.findFirst({
    where: { id: p.messageId, vendorId: job.vendorId! },
  });
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Message not found');
  if (row.whatsappMessageId && row.whatsappMessageId !== id)
    throw new ApiError(
      502,
      'PROVIDER_UNCERTAIN',
      'Provider identifiers conflict; reconcile this message',
    );
  accepted = accepted && row.status !== 'failed';
  await tx.whatsappMessageLogs.update({
    where: { id: row.id },
    data: {
      whatsappMessageId: id,
      ...(!['delivered', 'read', 'failed'].includes(row.status ?? '')
        ? { status: accepted ? 'sent' : 'failed' }
        : {}),
      updatedAt: new Date(),
    },
  });
  await recordStoreDelivery(
    tx,
    job.vendorId!,
    p.storeNotification,
    accepted ? 'sent' : 'failed',
    id,
  );
  if (accepted && p.nativeReaction)
    await acknowledgeReaction(
      tx,
      job.vendorId!,
      p.nativeReaction,
      row.id,
      p.payload?.reaction?.emoji,
    );
  if (accepted && p.sentByUserId && !p.campaignTestId && !p.nativeReaction)
    await acceptHandoff(tx, job.vendorId!, row.contactId, p.sentByUserId);
  if (accepted && p.campaignTestId) {
    const campaign = await tx.campaigns.findFirst({
      where: { id: p.campaignTestId, vendorId: job.vendorId!, status: 'awaiting_test' },
    });
    if (campaign && campaignTestHash(campaign.templateId, campaign.data) === p.campaignTestHash)
      await tx.campaigns.update({
        where: { id: campaign.id },
        data: {
          status: 'scheduled',
          data: {
            ...(campaign.data as Prisma.InputJsonObject),
            testReceipt: {
              hash: p.campaignTestHash,
              providerMessageId: id,
              templateRevision: p.templateRevision,
              messageId: row.id,
            },
          },
          updatedAt: new Date(),
        },
      });
  }
  if (p.awayDeliveryId)
    await tx.outOfOfficeDeliveries.updateMany({
      where: { id: p.awayDeliveryId, refOutOfOfficeSettingsId: { vendorId: job.vendorId! } },
      data: {
        status: accepted ? 'sent' : 'failed',
        outboundMessageId: id,
        sentAt: new Date(),
        failureReason: accepted ? null : 'PROVIDER_DELIVERY_FAILED',
        updatedAt: new Date(),
      },
    });
  if (p.reminderDeliveryId)
    await tx.whalexyAppointmentReminderDeliveries.updateMany({
      where: {
        id: p.reminderDeliveryId,
        vendorId: job.vendorId!,
        status: { in: ['processing', 'uncertain'] },
        scheduledFor: new Date(p.scheduledFor),
      },
      data: {
        status: accepted ? 'sent' : 'failed',
        sentAt: new Date(),
        lastError: accepted ? null : 'PROVIDER_DELIVERY_FAILED',
        updatedAt: new Date(),
      },
    });
  if (p.queueId)
    await tx.whatsappMessageQueue.updateMany({
      where: { id: p.queueId, vendorId: job.vendorId! },
      data: { status: accepted ? 4 : 2, updatedAt: new Date() },
    });
}
