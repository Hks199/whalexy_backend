import { recordInteractiveChoice } from '../../modules/messaging/services/interactive-message.js';
import { ingestReaction } from '../../modules/messaging/services/reactions.js';
import { type OutboxJobs } from '@prisma/client';
import { db } from '../../database/client.js';
import { ApiError } from '../../shared/api-error.js';
import { digest } from '../../utils/crypto.js';
import { queueAwayReply } from '../../modules/out-of-office/out-of-office.service.js';
import { finishCampaign } from '../../modules/campaigns/services/campaigns-support.service.js';
import { queueBotReplies } from '../../modules/bot-replies/services/reply-runtime.service.js';
import { detectEscalation } from '../../modules/handoffs/services/handoffs.js';
import { graphFlowProofAllowed } from '../../modules/bot-flows/services/bot-meta-flow.js';
import { ingestCommentChange } from '../../modules/comment-automations/services/comment-ingestion.service.js';
import { ingestFollowReply } from '../../modules/comment-automations/services/follow-checks.service.js';
import { captureAdReferral } from '../../modules/ads-manager/services/ad-attribution.js';
import { once } from '../services/webhook-receipts.service.js';
import { acknowledgeSend } from '../services/message-acknowledgement.service.js';

export async function ingestMeta(body: any, eventKey?: string) {
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (await ingestCommentChange(body, entry, change, eventKey)) continue;
      const value = change.value ?? {},
        phone = String(value.metadata?.phone_number_id ?? '');
      if (!phone)
        throw new ApiError(
          503,
          'WEBHOOK_HANDLER_PENDING',
          'Non-message Meta change requires a verified handler',
        );
      const credential = await db.integrationCredentials.findFirst({
        where: { provider: 'whatsapp', externalId: phone },
      });
      if (!credential)
        throw new ApiError(503, 'UNROUTABLE_WEBHOOK', 'WhatsApp number is not connected');
      const vendorId = credential.vendorId;
      for (const message of value.messages ?? []) {
        if (typeof message.id !== 'string' || typeof message.from !== 'string') continue;
        await once(`meta-message:${message.id}`, 'meta-message', message, async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${vendorId}:whatsapp:${message.from}`},0))`;
          if (message.type === 'reaction') {
            await ingestReaction(tx, vendorId, phone, message);
            return;
          }
          let contact = await tx.contacts.findFirst({
            where: {
              vendorId,
              waId: message.from,
              AND: [
                { OR: [{ platform: 'whatsapp' }, { platform: null }] },
                { OR: [{ wabPhoneNumberId: phone }, { wabPhoneNumberId: null }] },
              ],
            },
            orderBy: [{ wabPhoneNumberId: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
          });
          if (!contact)
            contact = await tx.contacts.create({
              data: {
                vendorId,
                waId: message.from,
                platform: 'whatsapp',
                wabPhoneNumberId: phone,
                firstName:
                  value.contacts?.find((c: any) => c.wa_id === message.from)?.profile?.name ?? null,
              },
            });
          else if (!contact.platform || !contact.wabPhoneNumberId)
            contact = await tx.contacts.update({
              where: { id: contact.id },
              data: { platform: 'whatsapp', wabPhoneNumberId: phone },
            });
          const text =
            message.text?.body ??
            (message.type === 'unsupported'
              ? '[Unsupported message]'
              : `[${message.type ?? 'message'}]`);
          if (contact.conversationStatus === 'resolved')
            contact = await tx.contacts.update({
              where: { id: contact.id },
              data: {
                conversationStatus: 'open',
                conversationResolvedAt: null,
                conversationResolvedByUserId: null,
                updatedAt: new Date(),
              },
            });
          const date = new Date(Number(message.timestamp) * 1000);
          const messagedAt =
            Number.isFinite(date.getTime()) && date.getTime() <= Date.now() + 300000
              ? new Date(Math.min(date.getTime(), Date.now()))
              : new Date(0);
          const incomingLog = await tx.whatsappMessageLogs.create({
            data: {
              vendorId,
              contactId: contact.id,
              contactWaId: message.from,
              whatsappMessageId: message.id,
              wabPhoneNumberId: phone,
              message: text,
              type: message.type ?? 'unknown',
              isIncomingMessage: true,
              status: 'received',
              messagedAt,
              data: { incoming: message },
            },
          });
          await captureAdReferral(tx, vendorId, contact, message, messagedAt);
          await tx.contacts.update({
            where: { id: contact.id },
            data: { unreadMessagesCount: { increment: 1 } },
          });
          await tx.contacts.updateMany({
            where: {
              id: contact.id,
              OR: [{ messagedAt: null }, { messagedAt: { lt: messagedAt } }],
            },
            data: { messagedAt },
          });
          const awayOwns =
            message.type === 'text' && detectEscalation(text)
              ? false
              : await queueAwayReply(tx, vendorId, phone, contact, message.id, date);
          if (message.type === 'text')
            await queueBotReplies(
              tx,
              contact,
              phone,
              message.id,
              incomingLog.id,
              text,
              date,
              new Date(),
              awayOwns,
            );
          const selection =
            message.interactive?.button_reply?.id ?? message.interactive?.list_reply?.id;
          if (
            message.type === 'interactive' &&
            typeof selection === 'string' &&
            selection.startsWith('ni_')
          )
            await recordInteractiveChoice(tx, contact, phone, incomingLog.id, message, messagedAt);
          else if (
            message.type === 'interactive' &&
            typeof selection === 'string' &&
            selection.length <= 100
          )
            await queueBotReplies(
              tx,
              contact,
              phone,
              message.id,
              incomingLog.id,
              '[selection]',
              date,
              new Date(),
              awayOwns,
              selection,
            );
          if (message.interactive?.nfm_reply?.response_json) {
            let answers;
            try {
              answers = JSON.parse(message.interactive.nfm_reply.response_json);
            } catch {
              answers = null;
            }
            const token =
              typeof answers?.flow_token === 'string' && answers.flow_token.length <= 128
                ? answers.flow_token
                : null;
            if (token)
              await tx.$queryRaw`SELECT id FROM node_idempotency WHERE "vendorId" = ${vendorId} AND key = ${`flow-token:${digest(token)}`} FOR UPDATE`;
            const proof = token
                ? await tx.nativeIdempotency.findUnique({
                    where: { vendorId_key: { vendorId, key: `flow-token:${digest(token)}` } },
                  })
                : null,
              value = proof?.response as any;
            if (
              value &&
              value.contactId === contact.id &&
              value.phoneNumberId === phone &&
              value.expiresAt > Date.now() &&
              (await graphFlowProofAllowed(tx, vendorId, value)) &&
              (await tx.nativeMetaFlows.findFirst({
                where: { id: value.flowId, vendorId, status: { not: 'DELETED' } },
                select: { id: true },
              }))
            ) {
              await tx.whatsappFlowResponses.create({
                data: {
                  vendorId,
                  contactId: contact.id,
                  flowId: value.flowId,
                  wamid: message.id,
                  responseData: answers,
                  submittedAt: messagedAt,
                },
              });
              await tx.nativeIdempotency.update({
                where: { id: proof!.id },
                data: { response: { ...value, expiresAt: 0, consumed: true } },
              });
            }
          }
        });
      }
      for (const status of value.statuses ?? []) {
        if (
          !['sent', 'delivered', 'read', 'failed'].includes(status.status) ||
          typeof status.id !== 'string'
        )
          continue;
        await once(
          `meta-status:${vendorId}:${phone}:${status.id}:${status.status}`,
          'meta-status',
          { ...status, vendorId, phoneNumberId: phone },
          async (tx) => {
            let row = await tx.whatsappMessageLogs.findFirst({
              where: { vendorId, whatsappMessageId: status.id },
            });
            let linkedJob: OutboxJobs | null = null;
            if (
              typeof status.biz_opaque_callback_data === 'string' &&
              /^[0-9a-f-]{36}$/i.test(status.biz_opaque_callback_data)
            ) {
              linkedJob = await tx.outboxJobs.findFirst({
                where: {
                  id: status.biz_opaque_callback_data,
                  vendorId,
                  kind: 'whatsapp-send',
                  status: { in: ['processing', 'uncertain', 'completed'] },
                },
              });
              const p = linkedJob?.payload as any;
              if (!linkedJob || p.phoneNumberId !== phone || p.payload?.to !== status.recipient_id)
                linkedJob = null;
              if (linkedJob) {
                const candidate = await tx.whatsappMessageLogs.findFirst({
                  where: {
                    id: p.messageId,
                    vendorId,
                    wabPhoneNumberId: phone,
                    contactWaId: status.recipient_id,
                  },
                });
                if (candidate && (!row || row.id === candidate.id)) {
                  await acknowledgeSend(tx, linkedJob, status.id, status.status !== 'failed');
                  row = candidate;
                  await tx.outboxJobs.update({
                    where: { id: linkedJob.id },
                    data: { status: 'completed', lockedAt: null, lastError: null },
                  });
                } else linkedJob = null;
              }
            }
            if (!row) return;
            const order: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3 };
            if (status.status === 'failed' && ['delivered', 'read'].includes(row.status ?? ''))
              return;
            if (
              status.status !== 'failed' &&
              (order[row.status ?? ''] ?? -1) > (order[status.status] ?? 0)
            )
              return;
            await tx.whatsappMessageLogs.update({
              where: { id: row.id },
              data: { status: status.status, updatedAt: new Date() },
            });
            const delivery = {
              status: status.status,
              updatedAt: new Date(),
              ...(['delivered', 'read'].includes(status.status) ? { deliveredAt: new Date() } : {}),
              ...(status.status === 'read' ? { readAt: new Date() } : {}),
              ...(status.status === 'failed' ? { errorMessage: 'PROVIDER_DELIVERY_FAILED' } : {}),
            };
            await tx.shopifyOrderNotifications.updateMany({
              where: { vendorId, whatsappMessageId: status.id },
              data: delivery,
            });
            await tx.woocommerceOrderNotifications.updateMany({
              where: { vendorId, whatsappMessageId: status.id },
              data: delivery,
            });
            if (linkedJob && row.campaignId) await finishCampaign(tx, vendorId, row.campaignId);
          },
        );
      }
    }
    for (const event of entry.messaging ?? []) {
      if (await ingestFollowReply(body, entry, event, eventKey)) continue;
      if (event.message?.is_echo) continue;
      const provider = body.object === 'instagram' ? 'instagram' : 'facebook',
        account = String(event.recipient?.id ?? entry.id);
      const credential = await db.integrationCredentials.findFirst({
        where: { provider, externalId: account },
      });
      if (!credential)
        throw new ApiError(503, 'UNROUTABLE_WEBHOOK', 'Social account is not connected');
      if (!event.message?.mid)
        throw new ApiError(
          503,
          'WEBHOOK_HANDLER_PENDING',
          'Social event requires a verified handler',
        );
      await once(`social:${provider}:${event.message.mid}`, provider, event, async (tx) => {
        const vendorId = credential.vendorId,
          id = String(event.sender?.id ?? '');
        const where = provider === 'instagram' ? { instagramId: id } : { facebookId: id };
        let contact = await tx.contacts.findFirst({
          where: { vendorId, platform: provider, ...where },
        });
        if (!contact)
          contact = await tx.contacts.create({ data: { vendorId, platform: provider, ...where } });
        await tx.nativeChannelMessages.create({
          data: {
            vendorId,
            contactId: contact.id,
            provider,
            externalAccountId: account,
            externalMessageId: event.message.mid,
            text: event.message.text ?? '[Media]',
            incoming: true,
            status: 'received',
          },
        });
        await tx.contacts.update({
          where: { id: contact.id },
          data: { messagedAt: new Date(), unreadMessagesCount: { increment: 1 } },
        });
      });
    }
  }
}
export async function handleMetaWebhook(job: OutboxJobs) {
  const payload = job.payload as any;

  await ingestMeta(payload.body, payload.eventKey);
  await db.webhookReceipts.update({
    where: { eventKey: payload.eventKey },
    data: { processedAt: new Date() },
  });
  return;
}
