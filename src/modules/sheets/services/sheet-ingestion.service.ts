import { db } from '../../../database/client.js';
import { digest } from '../../../utils/crypto.js';
import { ApiError } from '../../../shared/api-error.js';
import { contactVisibility, ownedPhone } from '../../contacts/contacts.service.js';
import { sheetTemplateComponents } from '../../../shared/templates/sheet-template.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { lockSheetIntegration, readNativeSheetSettings } from './sheets-support.service.js';

export async function ingestSheetRows(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!,
    { rowId, row } = requestInput.body;
  const result = await db.$transaction(async (tx) => {
    const found = await tx.googleSheetAutomations.findFirst({
      where: { uid: String(requestInput.params.uid), vendorId },
    });
    if (!found) throw new ApiError(404, 'NOT_FOUND', 'Automation not found');
    await lockSheetIntegration(tx, found.id);
    const automation = await tx.googleSheetAutomations.findUniqueOrThrow({
        where: { id: found.id },
      }),
      settings = readNativeSheetSettings(automation);
    if (automation.status !== 1)
      throw new ApiError(409, 'SHEET_DISABLED', 'Automation is disabled');
    await ownedPhone(vendorId, settings.phoneNumberId, tx);
    const match =
      settings.triggerType === 'new_row'
        ? settings.rules[0]
        : settings.rules.find(
            (r) =>
              r.triggerValue?.trim().toLowerCase() ===
              row[settings.triggerColumn!]?.trim().toLowerCase(),
          );
    if (!match) return { items: [] };
    const raw = row[settings.phoneColumn]?.trim() ?? '';
    if (!/^\+?[1-9]\d{7,14}$/.test(raw))
      throw new ApiError(
        400,
        'INVALID_PHONE',
        'Use an international phone number in the configured column',
      );
    const phone = raw.replace(/^\+/, '');
    const recipients = await tx.contacts.findMany({
      where: {
        ...contactVisibility(requestInput),
        waId: phone,
        status: 1,
        OR: [{ platform: null }, { platform: 'whatsapp' }],
        wabPhoneNumberId: settings.phoneNumberId,
      },
      take: 2,
    });
    if (recipients.length !== 1)
      throw new ApiError(
        409,
        'SHEET_CONTACT_UNRESOLVED',
        'The row must identify exactly one visible active contact in this phone scope',
      );
    const contact = recipients[0];
    const template = await tx.whatsappTemplates.findFirst({
      where: { id: match.templateId, vendorId, status: 'APPROVED' },
    });
    if (!template || template.updatedAt.toISOString() !== match.revision)
      throw new ApiError(
        409,
        'SHEET_TEMPLATE_CHANGED',
        'Regenerate the automation after template changes',
      );
    if (
      template.category?.toUpperCase() === 'MARKETING' &&
      (await tx.contacts.findFirst({
        where: {
          vendorId,
          waId: phone,
          whatsappOptOut: { not: null },
          OR: [{ wabPhoneNumberId: null }, { wabPhoneNumberId: settings.phoneNumberId }],
        },
        select: { id: true },
      }))
    )
      throw new ApiError(409, 'MARKETING_OPT_OUT', 'Recipient opted out of marketing');
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone,
      type: 'template',
      template: {
        name: template.templateName,
        language: { code: template.languageCode },
        components: sheetTemplateComponents(template.data, match, row),
      },
    };
    const key = `sheet:${automation.uid}:${rowId}:${settings.rules.indexOf(match)}`,
      requestHash = digest(JSON.stringify(payload)),
      prior = await tx.nativeIdempotency.findUnique({ where: { vendorId_key: { vendorId, key } } });
    if (prior) {
      if (prior.requestHash !== requestHash)
        throw new ApiError(
          409,
          'IDEMPOTENCY_CONFLICT',
          'This row and rule were already queued with different values',
        );
      return prior.response;
    }
    const message = await tx.whatsappMessageLogs.create({
        data: {
          vendorId,
          contactId: contact.id,
          contactWaId: phone,
          type: 'template',
          status: 'queued',
          isIncomingMessage: false,
          messagedAt: new Date(),
          wabPhoneNumberId: settings.phoneNumberId,
        },
      }),
      response = { items: [{ id: message.id, uid: message.uid, status: 'queued' }] };
    await tx.nativeIdempotency.create({ data: { vendorId, key, requestHash, response } });
    await tx.outboxJobs.create({
      data: {
        vendorId,
        kind: 'whatsapp-send',
        dedupeKey: key,
        payload: {
          sentByUserId: requestInput.identity!.userId,
          ...(requestInput.identity!.apiKeyId ? { apiKeyId: requestInput.identity!.apiKeyId } : {}),
          messageId: message.id,
          phoneNumberId: settings.phoneNumberId,
          nativeSheet: {
            uid: automation.uid,
            revision: automation.updatedAt.toISOString(),
            templateId: template.id,
            templateRevision: match.revision,
          },
          payload,
        },
      },
    });
    return response;
  });
  return serviceResult(result, { status: 202, format: 'json' });
}
