import { Prisma } from '@prisma/client';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { digest } from '../../../utils/crypto.js';
import { renderRichTemplate } from '../../../shared/templates/rich-template.js';
import { optionsSchema } from '../campaigns.validation.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import {
  lockCampaign,
  parseCampaignConfiguration,
  CampaignOptions,
  validateCampaignOptions,
  campaignTestHash,
  CAMPAIGN_BATCH_SIZE,
  finishCampaign,
} from './campaigns-support.service.js';

export async function dispatchDueCampaigns(vendorId?: number) {
  const campaigns = await db.campaigns.findMany({
    where: {
      ...(vendorId !== undefined ? { vendorId } : {}),
      status: { in: ['scheduled', 'dispatching'] },
      scheduledAt: { lte: new Date() },
    },
    orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
    take: 10,
  });
  for (const snapshot of campaigns) {
    try {
      await db.$transaction(
        async (tx) => {
          const c = await lockCampaign(tx, snapshot.vendorId, snapshot.id);
          if (!['scheduled', 'dispatching'].includes(c.status)) return;
          const saved = c.data as any,
            checked = optionsSchema.validate(parseCampaignConfiguration(c.data));
          if (checked.error)
            throw new ApiError(409, 'CAMPAIGN_CONFIGURATION', 'Campaign configuration is invalid');
          const options: CampaignOptions = checked.value,
            template = await validateCampaignOptions(tx, c.vendorId, c.templateId, options);
          if (
            options.requireTest &&
            (!saved?.testReceipt?.providerMessageId ||
              saved.testReceipt.hash !== campaignTestHash(c.templateId, c.data) ||
              saved.testReceipt.templateRevision !== template.updatedAt.toISOString())
          ) {
            await tx.campaigns.update({
              where: { id: c.id },
              data: { status: 'awaiting_test', updatedAt: new Date() },
            });
            return;
          }
          if (
            (await tx.vendors.findUnique({ where: { id: c.vendorId }, select: { status: true } }))
              ?.status !== 1
          )
            throw new ApiError(403, 'BUSINESS_INACTIVE', 'Business is inactive');
          if (!saved?.audienceInitialized) {
            for (const number of [...options.phoneNumbers].sort()) {
              await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${c.vendorId}:whatsapp:${number}`},0))`;
              // Preserve an existing identity (including archived or opted-out records).
              if (
                !(await tx.contacts.findFirst({
                  where: {
                    vendorId: c.vendorId,
                    waId: number,
                    AND: [
                      { OR: [{ platform: null }, { platform: 'whatsapp' }] },
                      {
                        OR: [
                          { wabPhoneNumberId: null },
                          { wabPhoneNumberId: options.phoneNumberId },
                        ],
                      },
                    ],
                  },
                  select: { id: true },
                }))
              ) {
                await tx.contacts.create({
                  data: {
                    vendorId: c.vendorId,
                    waId: number,
                    platform: 'whatsapp',
                    wabPhoneNumberId: options.phoneNumberId,
                  },
                });
              }
            }
            const selected = options.allContacts
              ? Prisma.sql`true`
              : Prisma.sql`(
            EXISTS (SELECT 1 FROM "group_contacts" gc WHERE gc."contacts__id"=ct."_id" AND gc."contact_groups__id" IN (${Prisma.join(options.groupIds.length ? options.groupIds : [-1])}))
            OR ct."wa_id" IN (${Prisma.join(options.phoneNumbers.length ? options.phoneNumbers : [''])}))`;
            // Snapshot recipient identities in PostgreSQL without loading the audience in memory.
            await tx.$executeRaw`INSERT INTO "whatsapp_message_queue" ("vendors__id","contacts__id","campaigns__id","phone_with_country_code","scheduled_at","_uid")
            SELECT DISTINCT ON (ct."wa_id") ${c.vendorId},ct."_id",${c.id},ct."wa_id",${c.scheduledAt ?? new Date()},gen_random_uuid()::text FROM "contacts" ct
            WHERE ct."vendors__id"=${c.vendorId} AND ct."status"=1 AND ct."wa_id" ~ '^[1-9][0-9]{7,19}$'
              AND (ct."platform" IS NULL OR ct."platform"='whatsapp') AND (ct."wab_phone_number_id" IS NULL OR ct."wab_phone_number_id"=${options.phoneNumberId})
              AND (${template.category?.toUpperCase() === 'MARKETING'}=false OR ct."whatsapp_opt_out" IS NULL)
              AND (${template.category?.toUpperCase() === 'MARKETING'}=false OR NOT EXISTS (SELECT 1 FROM "contacts" blocked WHERE blocked."vendors__id"=ct."vendors__id" AND blocked."wa_id"=ct."wa_id" AND blocked."whatsapp_opt_out" IS NOT NULL AND (blocked."wab_phone_number_id" IS NULL OR blocked."wab_phone_number_id"=${options.phoneNumberId})))
              AND (${options.restrictLanguage}=false OR ct."language_code"=${template.languageCode})
              AND ${selected} ORDER BY ct."wa_id",ct."_id"`;
          }
          const queue = await tx.whatsappMessageQueue.findMany({
            where: { vendorId: c.vendorId, campaignId: c.id, status: 1 },
            orderBy: { id: 'asc' },
            take: CAMPAIGN_BATCH_SIZE,
          });
          for (const item of queue) {
            const contact = await tx.contacts.findFirst({
              where: {
                id: item.contactId ?? -1,
                vendorId: c.vendorId,
                status: 1,
                waId: item.phoneWithCountryCode,
                OR: [{ platform: null }, { platform: 'whatsapp' }],
              },
            });
            if (
              !contact ||
              (contact.wabPhoneNumberId && contact.wabPhoneNumberId !== options.phoneNumberId) ||
              (template.category?.toUpperCase() === 'MARKETING' &&
                contact.whatsappOptOut !== null) ||
              (options.restrictLanguage && contact.languageCode !== template.languageCode)
            ) {
              await tx.whatsappMessageQueue.update({
                where: { id: item.id },
                data: { status: 2, data: { skipped: 'RECIPIENT_UNAVAILABLE' } },
              });
              continue;
            }
            let components: Prisma.InputJsonObject[];
            try {
              components = await renderRichTemplate(
                tx,
                c.vendorId,
                contact,
                template.data,
                options,
              );
            } catch (error) {
              if (!(error instanceof ApiError) || error.code !== 'TEMPLATE_VALUE_INVALID')
                throw error;
              await tx.whatsappMessageQueue.update({
                where: { id: item.id },
                data: { status: 2, data: { skipped: error.code }, updatedAt: new Date() },
              });
              continue;
            }
            const log = await tx.whatsappMessageLogs.create({
              data: {
                vendorId: c.vendorId,
                contactId: contact.id,
                contactWaId: contact.waId,
                campaignId: c.id,
                wabPhoneNumberId: options.phoneNumberId,
                type: 'template',
                isIncomingMessage: false,
                status: 'queued',
                messagedAt: new Date(),
              },
            });
            await tx.outboxJobs.create({
              data: {
                vendorId: c.vendorId,
                kind: 'whatsapp-send',
                dedupeKey: `campaign:${c.id}:${contact.id}`,
                payload: {
                  campaignId: c.id,
                  campaignConfigurationHash: campaignTestHash(c.templateId, {
                    ...saved,
                    ...options,
                  }),
                  templateId: template.id,
                  templateRevision: template.updatedAt.toISOString(),
                  queueId: item.id,
                  messageId: log.id,
                  phoneNumberId: options.phoneNumberId,
                  payload: {
                    messaging_product: 'whatsapp',
                    to: item.phoneWithCountryCode,
                    type: 'template',
                    template: {
                      name: template.templateName,
                      language: { code: template.languageCode },
                      components,
                    },
                  },
                },
              },
            });
            await tx.whatsappMessageQueue.update({
              where: { id: item.id },
              data: { status: 3, updatedAt: new Date() },
            });
          }
          const remaining = await tx.whatsappMessageQueue.count({
            where: { campaignId: c.id, vendorId: c.vendorId, status: 1 },
          });
          await tx.campaigns.update({
            where: { id: c.id },
            data: {
              status: remaining ? 'dispatching' : 'running',
              data: { ...saved, ...options, audienceInitialized: true },
              updatedAt: new Date(),
            },
          });
          await finishCampaign(tx, c.vendorId, c.id);
        },
        { timeout: 30000 },
      );
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      await db.campaigns.updateMany({
        where: {
          id: snapshot.id,
          vendorId: snapshot.vendorId,
          status: { in: ['scheduled', 'dispatching'] },
        },
        data: { status: 'blocked', updatedAt: new Date() },
      });
    }
  }
}

export async function sendCampaignTest(requestInput: ServiceContext) {
  const key = requestInput.headers['idempotency-key'];
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(key))
    throw new ApiError(400, 'IDEMPOTENCY_REQUIRED', 'A valid Idempotency-Key header is required');
  const vendorId = requestInput.identity!.vendorId!,
    campaignId = Number(requestInput.params.id);
  const result = await db.$transaction(async (tx) => {
    const c = await lockCampaign(tx, vendorId, campaignId);
    const dedupe = `campaign-test:${c.id}:${key}`,
      requestHash = digest(JSON.stringify({ contactId: requestInput.body.contactId ?? null }));
    const previous = await tx.nativeIdempotency.findUnique({
      where: { vendorId_key: { vendorId, key: dedupe } },
    });
    if (previous) {
      if (previous.requestHash !== requestHash)
        throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Key was used for a different test');
      return previous.response;
    }
    if (c.status !== 'awaiting_test')
      throw new ApiError(409, 'CAMPAIGN_STATE', 'Campaign is not awaiting a test');
    const checked = optionsSchema.validate(parseCampaignConfiguration(c.data));
    if (checked.error)
      throw new ApiError(409, 'CAMPAIGN_CONFIGURATION', 'Campaign configuration is invalid');
    const options: CampaignOptions = checked.value,
      template = await validateCampaignOptions(tx, vendorId, c.templateId, options);
    const setting = requestInput.body.contactId
      ? null
      : await tx.vendorSettings.findFirst({ where: { vendorId, name: 'test_recipient_contact' } });
    const contact = await tx.contacts.findFirst({
      where: {
        vendorId,
        status: 1,
        ...(requestInput.body.contactId
          ? { id: requestInput.body.contactId }
          : { uid: setting?.value ?? '' }),
        AND: [
          { OR: [{ platform: null }, { platform: 'whatsapp' }] },
          { OR: [{ wabPhoneNumberId: null }, { wabPhoneNumberId: options.phoneNumberId }] },
        ],
      },
    });
    if (!contact?.waId || !/^[1-9]\d{7,19}$/.test(contact.waId))
      throw new ApiError(
        400,
        'INVALID_TEST_CONTACT',
        'Choose an active WhatsApp test contact in this business and number scope',
      );
    if (
      template.category?.toUpperCase() === 'MARKETING' &&
      (await tx.contacts.findFirst({
        where: {
          vendorId,
          waId: contact.waId,
          whatsappOptOut: { not: null },
          OR: [{ wabPhoneNumberId: null }, { wabPhoneNumberId: options.phoneNumberId }],
        },
        select: { id: true },
      }))
    )
      throw new ApiError(409, 'CONTACT_OPTED_OUT', 'Test contact opted out of marketing');
    if (
      await tx.outboxJobs.count({
        where: {
          vendorId,
          kind: 'whatsapp-send',
          status: { in: ['pending', 'processing', 'uncertain'] },
          payload: { path: ['campaignTestId'], equals: c.id },
        },
      })
    )
      throw new ApiError(
        409,
        'TEST_PENDING',
        'Wait for or reconcile the previous test before sending another',
      );
    const components = await renderRichTemplate(tx, vendorId, contact, template.data, options),
      hash = campaignTestHash(c.templateId, c.data);
    const log = await tx.whatsappMessageLogs.create({
      data: {
        vendorId,
        contactId: contact.id,
        contactWaId: contact.waId,
        wabPhoneNumberId: options.phoneNumberId,
        type: 'template',
        status: 'queued',
        isIncomingMessage: false,
        messagedAt: new Date(),
        data: { campaignTestId: c.id },
      },
    });
    const response = { id: log.id, uid: log.uid, status: 'queued', campaignId: c.id };
    await tx.nativeIdempotency.create({ data: { vendorId, key: dedupe, requestHash, response } });
    await tx.outboxJobs.create({
      data: {
        vendorId,
        kind: 'whatsapp-send',
        dedupeKey: dedupe,
        payload: {
          campaignTestId: c.id,
          campaignTestHash: hash,
          templateId: template.id,
          templateRevision: template.updatedAt.toISOString(),
          sentByUserId: requestInput.identity!.userId,
          ...(requestInput.identity!.apiKeyId ? { apiKeyId: requestInput.identity!.apiKeyId } : {}),
          messageId: log.id,
          phoneNumberId: options.phoneNumberId,
          payload: {
            messaging_product: 'whatsapp',
            to: contact.waId,
            type: 'template',
            template: {
              name: template.templateName,
              language: { code: template.languageCode },
              components,
            },
          },
        },
      },
    });
    await tx.auditEvents.create({
      data: {
        vendorId,
        actorId: requestInput.identity!.userId,
        action: 'test',
        resource: 'campaign',
        resourceId: String(c.id),
      },
    });
    return response;
  });
  return serviceResult(result, { status: 202, format: 'json' });
}
