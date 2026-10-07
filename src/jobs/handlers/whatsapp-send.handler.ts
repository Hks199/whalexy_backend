import { replyTarget } from '../../modules/messaging/services/quoted-reply.service.js';
import { reactionTarget } from '../../modules/messaging/services/reactions.js';
import { type OutboxJobs } from '@prisma/client';
import { db } from '../../database/client.js';
import { ApiError } from '../../shared/api-error.js';
import { flowSendAllowed } from '../../modules/meta-flows/services/meta-flow-message.js';
import { catalogSendAllowed } from '../../modules/catalogs/services/catalog-messaging.service.js';
import { metaRequest } from '../../infrastructure/providers/meta.client.js';
import { awayState, graphAwayActive } from '../../modules/out-of-office/out-of-office.service.js';
import { customerWindowOpen } from '../../modules/messaging/services/whatsapp.js';
import {
  campaignTestHash,
  finishCampaign,
} from '../../modules/campaigns/services/campaigns-support.service.js';
import { graphTimingAllowed } from '../../modules/bot-flows/services/bot-timing.js';
import { graphTemplateSendAllowed } from '../../modules/bot-flows/services/bot-template.js';
import {
  storeSendAllowed,
  recordStoreDelivery,
} from '../../modules/store-notifications/services/notification-delivery.service.js';
import { sheetSendAllowed } from '../../modules/sheets/services/sheets-support.service.js';
import { tallySendAllowed } from '../../modules/tally/tally.service.js';
import { acknowledgeSend } from '../services/message-acknowledgement.service.js';

export async function handleWhatsAppSend(job: OutboxJobs) {
  const payload = job.payload as any;

  const vendor = await db.vendors.findUnique({
    where: { id: job.vendorId! },
    select: { status: true },
  });
  if (vendor?.status !== 1) throw new ApiError(403, 'BUSINESS_INACTIVE', 'Business is inactive');
  const row = await db.whatsappMessageLogs.findFirst({
    where: { id: payload.messageId, vendorId: job.vendorId! },
  });
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Message not found');
  if (row.whatsappMessageId || row.status === 'cancelled') return;
  if (
    !(await graphTemplateSendAllowed(job.vendorId!, payload)) ||
    !(await flowSendAllowed(job.vendorId!, payload.phoneNumberId, payload.nativeFlow)) ||
    !(await catalogSendAllowed(job.vendorId!, payload.phoneNumberId, payload.nativeCatalog)) ||
    !(await sheetSendAllowed(job.vendorId!, payload)) ||
    !(await tallySendAllowed(job.vendorId!, payload))
  ) {
    await db.whatsappMessageLogs.update({
      where: { id: row.id },
      data: { status: 'cancelled', updatedAt: new Date() },
    });
    return;
  }
  if (!(await storeSendAllowed(job.vendorId!, payload))) {
    await db.$transaction(async (tx) => {
      await tx.whatsappMessageLogs.update({
        where: { id: row.id },
        data: { status: 'cancelled', updatedAt: new Date() },
      });
      await recordStoreDelivery(tx, job.vendorId!, payload.storeNotification, 'cancelled');
    });
    return;
  }
  if (payload.sentByUserId) {
    const [member, user, contact] = await Promise.all([
      db.nativeMemberships.findUnique({
        where: { vendorId_userId: { vendorId: job.vendorId!, userId: payload.sentByUserId } },
      }),
      db.users.findUnique({ where: { id: payload.sentByUserId }, select: { status: true } }),
      db.contacts.findFirst({
        where: { id: row.contactId, vendorId: job.vendorId! },
        select: { assignedUserId: true },
      }),
    ]);
    let allowed =
      member?.active &&
      user?.status === 1 &&
      Array.isArray(member.permissions) &&
      (member.permissions.includes('*') || member.permissions.includes('vendor.chats.reply')) &&
      (member.permissions.includes('*') ||
        member.permissions.includes('vendor.chats.view_all') ||
        contact?.assignedUserId === payload.sentByUserId);
    if (payload.nativeCatalog)
      allowed =
        allowed &&
        Boolean(
          Array.isArray(member?.permissions) &&
          (member.permissions.includes('*') || member.permissions.includes('catalog.view')),
        );
    if (payload.nativeSheet || payload.nativeTally)
      allowed =
        allowed &&
        Boolean(
          Array.isArray(member?.permissions) &&
          (member.permissions.includes('*') ||
            member.permissions.includes('vendor.integrations.manage')),
        );
    if (payload.apiKeyId) {
      const key = await db.apiKeys.findFirst({
        where: {
          id: payload.apiKeyId,
          vendorId: job.vendorId!,
          userId: payload.sentByUserId,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      });
      allowed =
        allowed &&
        Boolean(
          key &&
          Array.isArray(key.permissions) &&
          (key.permissions.includes('*') || key.permissions.includes('vendor.chats.reply')) &&
          (!payload.nativeCatalog ||
            key.permissions.includes('*') ||
            key.permissions.includes('catalog.view')),
        );
    }
    if ((payload.nativeSheet || payload.nativeTally) && payload.apiKeyId) {
      const key = await db.apiKeys.findUnique({
        where: { id: payload.apiKeyId },
        select: { permissions: true },
      });
      allowed =
        allowed &&
        Boolean(
          Array.isArray(key?.permissions) &&
          (key.permissions.includes('*') ||
            key.permissions.includes('vendor.integrations.manage')) &&
          (key.permissions.includes('*') ||
            key.permissions.includes('vendor.chats.view_all') ||
            contact?.assignedUserId === payload.sentByUserId),
        );
    }
    if (!allowed)
      throw new ApiError(403, 'SENDER_ACCESS_REVOKED', 'Sender access changed before dispatch');
  }
  if (payload.botReplyId) {
    const [bot, handoff, contact] = await Promise.all([
      db.botReplies.findFirst({
        where: { id: payload.botReplyId, vendorId: job.vendorId!, status: 1, botFlowsId: null },
      }),
      db.aiConversationHandoffs.findFirst({
        where: {
          vendorId: job.vendorId!,
          contactId: row.contactId,
          status: { in: ['waiting', 'accepted'] },
        },
        select: { id: true },
      }),
      db.contacts.findFirst({ where: { id: row.contactId, vendorId: job.vendorId! } }),
    ]);
    if (
      !bot ||
      bot.updatedAt.toISOString() !== payload.botRevision ||
      handoff ||
      !contact ||
      contact.status !== 1 ||
      (contact.platform && contact.platform !== 'whatsapp') ||
      contact.waId !== payload.payload?.to ||
      (contact.wabPhoneNumberId && contact.wabPhoneNumberId !== payload.phoneNumberId)
    ) {
      await db.whatsappMessageLogs.update({
        where: { id: row.id },
        data: { status: 'cancelled', updatedAt: new Date() },
      });
      return;
    }
  }
  if (payload.botFlowId) {
    const [flow, handoff] = await Promise.all([
      db.botFlows.findFirst({
        where: { id: payload.botFlowId, vendorId: job.vendorId!, status: 'active' },
      }),
      db.aiConversationHandoffs.findFirst({
        where: {
          vendorId: job.vendorId!,
          contactId: row.contactId,
          status: { in: ['waiting', 'accepted'] },
        },
        select: { id: true, assignedUserId: true },
      }),
    ]);
    let assignedAllowed = true;
    if (payload.graphAssignedUserId) {
      const member = await db.nativeMemberships.findUnique({
        where: {
          vendorId_userId: { vendorId: job.vendorId!, userId: payload.graphAssignedUserId },
        },
      });
      assignedAllowed = Boolean(
        member?.active &&
        Array.isArray(member.permissions) &&
        member.permissions.some((p) => p === '*' || p === 'vendor.chats.reply') &&
        (await db.users.findFirst({ where: { id: payload.graphAssignedUserId, status: 1 } })) &&
        handoff?.assignedUserId === payload.graphAssignedUserId,
      );
    }
    if (
      !flow ||
      flow.updatedAt.toISOString() !== payload.botFlowRevision ||
      (handoff && handoff.id !== payload.handoffAckId) ||
      !assignedAllowed ||
      (flow.data as any)?.phoneNumberId !== payload.phoneNumberId
    ) {
      await db.whatsappMessageLogs.update({
        where: { id: row.id },
        data: { status: 'cancelled', updatedAt: new Date() },
      });
      return;
    }
    if (!payload.handoffAckId) {
      const state = await db.$transaction(async (tx) => ({
        timing: await graphTimingAllowed(tx, job.vendorId!, flow.triggerType, new Date()),
        away: await graphAwayActive(tx, job.vendorId!, payload.phoneNumberId),
      }));
      if (!state.timing)
        throw new ApiError(409, 'GRAPH_TIMING_PAUSED', 'Bot timing currently prevents dispatch');
      if (state.away)
        throw new ApiError(
          409,
          'GRAPH_AWAY_PAUSED',
          'Out-of-office mode currently prevents dispatch',
        );
    }
  }
  if (
    payload.handoffAckId &&
    !(await db.aiConversationHandoffs.findFirst({
      where: {
        id: payload.handoffAckId,
        vendorId: job.vendorId!,
        contactId: row.contactId,
        status: { in: ['waiting', 'accepted'] },
      },
    }))
  ) {
    await db.whatsappMessageLogs.update({
      where: { id: row.id },
      data: { status: 'cancelled', updatedAt: new Date() },
    });
    return;
  }
  if (payload.campaignTestId) {
    const [campaign, template, contact] = await Promise.all([
      db.campaigns.findFirst({ where: { id: payload.campaignTestId, vendorId: job.vendorId! } }),
      db.whatsappTemplates.findFirst({
        where: { id: payload.templateId, vendorId: job.vendorId!, status: 'APPROVED' },
      }),
      db.contacts.findFirst({ where: { id: row.contactId, vendorId: job.vendorId! } }),
    ]);
    const optedOut =
      template?.category?.toUpperCase() === 'MARKETING' &&
      Boolean(
        await db.contacts.findFirst({
          where: {
            vendorId: job.vendorId!,
            waId: String(payload.payload?.to ?? ''),
            whatsappOptOut: { not: null },
            OR: [{ wabPhoneNumberId: null }, { wabPhoneNumberId: payload.phoneNumberId }],
          },
          select: { id: true },
        }),
      );
    if (
      !campaign ||
      campaign.status !== 'awaiting_test' ||
      campaignTestHash(campaign.templateId, campaign.data) !== payload.campaignTestHash ||
      !template ||
      template.updatedAt.toISOString() !== payload.templateRevision ||
      template.templateName !== payload.payload?.template?.name ||
      template.languageCode !== payload.payload?.template?.language?.code ||
      !contact ||
      contact.status !== 1 ||
      (contact.platform && contact.platform !== 'whatsapp') ||
      contact.waId !== payload.payload?.to ||
      (contact.wabPhoneNumberId && contact.wabPhoneNumberId !== payload.phoneNumberId) ||
      optedOut
    ) {
      await db.whatsappMessageLogs.update({
        where: { id: row.id },
        data: { status: 'cancelled', updatedAt: new Date() },
      });
      return;
    }
  }
  if (row.campaignId) {
    const campaign = await db.campaigns.findFirst({
      where: { id: row.campaignId, vendorId: job.vendorId! },
    });
    if (campaign?.status === 'paused')
      throw new ApiError(409, 'CAMPAIGN_PAUSED', 'Campaign is paused');
    const [contact, template] = await Promise.all([
      db.contacts.findFirst({ where: { id: row.contactId, vendorId: job.vendorId! } }),
      campaign
        ? db.whatsappTemplates.findFirst({
            where: { id: campaign.templateId, vendorId: job.vendorId! },
          })
        : null,
    ]);
    const data = campaign?.data as any;
    const optedOut =
      template?.category?.toUpperCase() === 'MARKETING' &&
      Boolean(
        await db.contacts.findFirst({
          where: {
            vendorId: job.vendorId!,
            waId: String(payload.payload?.to ?? ''),
            whatsappOptOut: { not: null },
            OR: [{ wabPhoneNumberId: null }, { wabPhoneNumberId: payload.phoneNumberId }],
          },
          select: { id: true },
        }),
      );
    if (
      !campaign ||
      (payload.campaignConfigurationHash &&
        campaignTestHash(campaign.templateId, campaign.data) !==
          payload.campaignConfigurationHash) ||
      (payload.templateRevision &&
        (!template ||
          template.id !== payload.templateId ||
          template.updatedAt.toISOString() !== payload.templateRevision)) ||
      !['running', 'dispatching'].includes(campaign.status) ||
      !contact ||
      contact.status !== 1 ||
      contact.waId !== payload.payload?.to ||
      (contact.platform && contact.platform !== 'whatsapp') ||
      (contact.wabPhoneNumberId && contact.wabPhoneNumberId !== payload.phoneNumberId) ||
      optedOut ||
      (data?.restrictLanguage && contact.languageCode !== template?.languageCode) ||
      template?.status !== 'APPROVED' ||
      template.templateName !== payload.payload?.template?.name ||
      template.languageCode !== payload.payload?.template?.language?.code
    ) {
      await db.$transaction(async (tx) => {
        await tx.whatsappMessageLogs.update({
          where: { id: row.id },
          data: { status: 'cancelled', updatedAt: new Date() },
        });
        if (payload.queueId)
          await tx.whatsappMessageQueue.updateMany({
            where: { id: payload.queueId, vendorId: job.vendorId!, campaignId: row.campaignId! },
            data: {
              status: 2,
              data: { skipped: 'CAMPAIGN_OR_RECIPIENT_UNAVAILABLE' },
              updatedAt: new Date(),
            },
          });
      });
      await db.$transaction((tx) => finishCampaign(tx, job.vendorId!, row.campaignId!));
      return;
    }
  }
  if (payload.awayDeliveryId) {
    const [delivery, contact, handoff] = await Promise.all([
      db.outOfOfficeDeliveries.findFirst({
        where: {
          id: payload.awayDeliveryId,
          refOutOfOfficeSettingsId: { vendorId: job.vendorId! },
        },
        include: { refOutOfOfficeSettingsId: true },
      }),
      db.contacts.findFirst({ where: { id: row.contactId, vendorId: job.vendorId! } }),
      db.aiConversationHandoffs.findFirst({
        where: {
          vendorId: job.vendorId!,
          contactId: row.contactId,
          status: { in: ['waiting', 'accepted'] },
        },
        select: { id: true },
      }),
    ]);
    const setting = delivery?.refOutOfOfficeSettingsId;
    const schedules = setting
      ? await db.outOfOfficeSchedules.findMany({ where: { outOfOfficeSettingsId: setting.id } })
      : [];
    const state = setting ? awayState(setting, schedules) : null;
    if (
      !delivery ||
      delivery.status !== 'processing' ||
      !setting?.enabled ||
      !state?.ooo_active ||
      state.period_key !== delivery.oooPeriodKey ||
      setting.message !== payload.payload?.text?.body ||
      handoff ||
      !contact ||
      contact.status !== 1 ||
      (contact.platform && contact.platform !== 'whatsapp') ||
      contact.waId !== payload.payload?.to ||
      (contact.wabPhoneNumberId && contact.wabPhoneNumberId !== payload.phoneNumberId)
    ) {
      await db.$transaction(async (tx) => {
        await tx.whatsappMessageLogs.update({
          where: { id: row.id },
          data: { status: 'cancelled', updatedAt: new Date() },
        });
        await tx.outOfOfficeDeliveries.updateMany({
          where: {
            id: payload.awayDeliveryId,
            refOutOfOfficeSettingsId: { vendorId: job.vendorId! },
            status: 'processing',
          },
          data: { status: 'failed', failureReason: 'AUTOMATION_CHANGED', updatedAt: new Date() },
        });
      });
      return;
    }
  }
  if (payload.reminderDeliveryId) {
    const [appointment, setting] = await Promise.all([
      db.whalexyAppointments.findFirst({
        where: { id: payload.appointmentId, vendorId: job.vendorId! },
      }),
      db.whalexyAppointmentAutomationSettings.findUnique({ where: { vendorId: job.vendorId! } }),
    ]);
    if (
      !appointment ||
      appointment.status !== 'confirmed' ||
      appointment.updatedAt.toISOString() !== payload.appointmentRevision ||
      appointment.startsAtUtc <= new Date() ||
      !setting?.enabled ||
      !setting.systemEnabled
    ) {
      await db.$transaction(async (tx) => {
        await tx.whatsappMessageLogs.update({
          where: { id: row.id },
          data: { status: 'cancelled', updatedAt: new Date() },
        });
        await tx.whalexyAppointmentReminderDeliveries.updateMany({
          where: {
            id: payload.reminderDeliveryId,
            vendorId: job.vendorId!,
            status: 'processing',
            scheduledFor: new Date(payload.scheduledFor),
          },
          data: { status: 'cancelled', updatedAt: new Date() },
        });
      });
      return;
    }
  }
  const recipient = await db.contacts.findFirst({
    where: { id: row.contactId, vendorId: job.vendorId! },
    select: { waId: true, status: true, platform: true, wabPhoneNumberId: true },
  });
  if (
    !recipient ||
    recipient.status !== 1 ||
    (recipient.platform && recipient.platform !== 'whatsapp') ||
    recipient.waId !== payload.payload?.to ||
    (recipient.wabPhoneNumberId && recipient.wabPhoneNumberId !== payload.phoneNumberId)
  ) {
    await db.$transaction(async (tx) => {
      await tx.whatsappMessageLogs.update({
        where: { id: row.id },
        data: { status: 'cancelled', updatedAt: new Date() },
      });
      if (payload.queueId)
        await tx.whatsappMessageQueue.updateMany({
          where: { id: payload.queueId, vendorId: job.vendorId! },
          data: { status: 2, data: { skipped: 'RECIPIENT_CHANGED' }, updatedAt: new Date() },
        });
      if (payload.reminderDeliveryId)
        await tx.whalexyAppointmentReminderDeliveries.updateMany({
          where: {
            id: payload.reminderDeliveryId,
            vendorId: job.vendorId!,
            status: 'processing',
          },
          data: { status: 'cancelled', updatedAt: new Date() },
        });
      if (payload.awayDeliveryId)
        await tx.outOfOfficeDeliveries.updateMany({
          where: {
            id: payload.awayDeliveryId,
            refOutOfOfficeSettingsId: { vendorId: job.vendorId! },
            status: 'processing',
          },
          data: { status: 'failed', failureReason: 'RECIPIENT_CHANGED', updatedAt: new Date() },
        });
      await recordStoreDelivery(tx, job.vendorId!, payload.storeNotification, 'cancelled');
    });
    if (row.campaignId)
      await db.$transaction((tx) => finishCampaign(tx, job.vendorId!, row.campaignId!));
    return;
  }
  if (payload.nativeInteractive?.expiresAt <= Date.now()) {
    await db.whatsappMessageLogs.update({
      where: { id: row.id },
      data: { status: 'cancelled', updatedAt: new Date() },
    });
    return;
  }
  if (payload.nativeReply && !(await replyTarget(db, job.vendorId!, payload.nativeReply))) {
    await db.whatsappMessageLogs.update({
      where: { id: row.id },
      data: { status: 'cancelled', updatedAt: new Date() },
    });
    return;
  }
  if (
    payload.nativeReaction &&
    !(await reactionTarget(db, job.vendorId!, payload.nativeReaction))
  ) {
    await db.whatsappMessageLogs.update({
      where: { id: row.id },
      data: { status: 'cancelled', updatedAt: new Date() },
    });
    return;
  }
  if (
    payload.payload?.type !== 'template' &&
    !(await customerWindowOpen(
      job.vendorId!,
      row.contactId,
      payload.phoneNumberId,
      String(payload.payload?.to ?? ''),
    ))
  )
    throw new ApiError(
      409,
      'TEMPLATE_REQUIRED',
      'The customer service window expired before dispatch',
    );
  const response = await metaRequest(
    job.vendorId!,
    'whatsapp',
    payload.phoneNumberId,
    `${payload.phoneNumberId}/messages`,
    'POST',
    { ...payload.payload, biz_opaque_callback_data: job.id },
  );
  const id = response.messages?.[0]?.id;
  if (typeof id !== 'string')
    throw new ApiError(502, 'PROVIDER_UNCERTAIN', 'Provider did not return a message identifier');
  await db.$transaction((tx) => acknowledgeSend(tx, job, id));
  if (row.campaignId)
    await db.$transaction((tx) => finishCampaign(tx, job.vendorId!, row.campaignId!));
  return;
}
