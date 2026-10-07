import { db } from '../../database/client.js';
import { digest } from '../../utils/crypto.js';
import { ApiError } from '../../shared/api-error.js';
import { visibleContact, ownedPhone } from '../contacts/contacts.service.js';
import {
  sheetTemplateSchema,
  sheetTemplateComponents,
} from '../../shared/templates/sheet-template.js';
import { fields } from './tally.validation.js';
import { serviceResult, type ServiceContext } from '../../shared/service-context.js';

export async function tallySendAllowed(vendorId: number, p: any) {
  if (!p.nativeTally) return true;
  const t = await db.whatsappTemplates.findFirst({
    where: { id: p.nativeTally.templateId, vendorId, status: 'APPROVED' },
  });
  if (
    !t ||
    t.updatedAt.toISOString() !== p.nativeTally.templateRevision ||
    t.templateName !== p.payload?.template?.name ||
    t.languageCode !== p.payload?.template?.language?.code
  )
    return false;
  return (
    t.category?.toUpperCase() !== 'MARKETING' ||
    !(await db.contacts.findFirst({
      where: {
        vendorId,
        waId: String(p.payload?.to ?? ''),
        whatsappOptOut: { not: null },
        OR: [{ wabPhoneNumberId: null }, { wabPhoneNumberId: p.phoneNumberId }],
      },
      select: { id: true },
    }))
  );
}
export async function checkTallyConnection(requestInput: ServiceContext) {
  const vendor = await db.vendors.findUniqueOrThrow({
    where: { id: requestInput.identity!.vendorId! },
    select: { title: true, uid: true },
  });
  return serviceResult(
    {
      result: 'success',
      vendor: { name: vendor.title, uid: vendor.uid },
      timestamp: new Date().toISOString(),
    },
    { status: 200, format: 'json' },
  );
}
export async function ingestTallyInvoice(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!,
    b = requestInput.body,
    contact = await visibleContact(requestInput, b.contactId);
  if (
    !contact.waId ||
    contact.status !== 1 ||
    (contact.platform && contact.platform !== 'whatsapp') ||
    contact.wabPhoneNumberId !== b.phoneNumberId
  )
    throw new ApiError(
      409,
      'INVALID_RECIPIENT',
      'Choose an active contact in the selected WhatsApp phone scope',
    );
  await ownedPhone(vendorId, b.phoneNumberId);
  if (!Intl.supportedValuesOf('currency').includes(b.currency))
    throw new ApiError(400, 'INVALID_CURRENCY', 'Use a supported invoice currency');
  const date = new Date(`${b.invoiceDate}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== b.invoiceDate)
    throw new ApiError(400, 'INVALID_DATE', 'Invoice date is invalid');
  const result = await db.$transaction(async (tx) => {
    const key = `tally-invoice:${b.sourceId}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${vendorId}:${key}`},0))`;
    const hash = digest(JSON.stringify(b)),
      prior = await tx.nativeIdempotency.findUnique({ where: { vendorId_key: { vendorId, key } } });
    if (prior) {
      if (prior.requestHash !== hash)
        throw new ApiError(
          409,
          'IDEMPOTENCY_CONFLICT',
          'This source invoice was already queued with different details',
        );
      return prior.response;
    }
    const template = await tx.whatsappTemplates.findFirst({
      where: { id: b.templateId, vendorId, status: 'APPROVED' },
    });
    if (!template)
      throw new ApiError(400, 'INVALID_TEMPLATE', 'Choose an owned approved invoice template');
    const schema = sheetTemplateSchema(template.data);
    if (
      schema.buttons.length ||
      schema.copy !== null ||
      (schema.media && schema.media !== 'document')
    )
      throw new ApiError(
        400,
        'TALLY_TEMPLATE_UNSUPPORTED',
        'Invoice templates support text and document headers without dynamic buttons',
      );
    if ((schema.media === 'document' && !b.pdfUrl) || (schema.media !== 'document' && b.pdfUrl))
      throw new ApiError(
        400,
        'TALLY_DOCUMENT_REQUIRED',
        'The attachment must match the approved document header',
      );
    if (
      template.category?.toUpperCase() === 'MARKETING' &&
      (await tx.contacts.findFirst({
        where: {
          vendorId,
          waId: contact.waId,
          whatsappOptOut: { not: null },
          OR: [{ wabPhoneNumberId: null }, { wabPhoneNumberId: b.phoneNumberId }],
        },
        select: { id: true },
      }))
    )
      throw new ApiError(409, 'MARKETING_OPT_OUT', 'Recipient opted out of marketing');
    const vendor = await tx.vendors.findUniqueOrThrow({
        where: { id: vendorId },
        select: { title: true },
      }),
      values: Record<string, string> = {
        customerName:
          b.customerName ??
          ([contact.firstName, contact.lastName].filter(Boolean).join(' ') || 'Customer'),
        invoiceNumber: b.invoiceNumber,
        invoiceTitle: `Invoice #${b.invoiceNumber}`,
        invoiceAmount: b.invoiceAmount,
        invoiceDate: b.invoiceDate,
        companyName: vendor.title,
      };
    const body: string[] = b.bodyFields ?? fields.slice(0, Math.min(schema.body, 4)),
      header: string[] = b.headerFields,
      row = [
        ...body.map((f) => values[f]),
        ...header.map((f) => values[f]),
        ...(b.pdfUrl ? [b.pdfUrl, `Invoice_${b.invoiceNumber}.pdf`] : []),
      ];
    const components = sheetTemplateComponents(
      template.data,
      {
        bodyColumns: body.map((_, i) => i),
        headerColumns: header.map((_, i) => body.length + i),
        buttonColumns: {},
        ...(b.pdfUrl
          ? {
              mediaColumn: body.length + header.length,
              filenameColumn: body.length + header.length + 1,
            }
          : {}),
      },
      row,
    );
    const message = await tx.whatsappMessageLogs.create({
        data: {
          vendorId,
          contactId: contact.id,
          contactWaId: contact.waId,
          type: 'template',
          status: 'queued',
          isIncomingMessage: false,
          messagedAt: new Date(),
          wabPhoneNumberId: b.phoneNumberId,
        },
      }),
      response = {
        id: message.id,
        uid: message.uid,
        status: 'queued',
        sourceId: b.sourceId,
        invoiceNumber: b.invoiceNumber,
        invoiceAmount: b.invoiceAmount,
        currency: b.currency,
        invoiceDate: b.invoiceDate,
      };
    await tx.nativeIdempotency.create({ data: { vendorId, key, requestHash: hash, response } });
    await tx.outboxJobs.create({
      data: {
        vendorId,
        kind: 'whatsapp-send',
        dedupeKey: `${vendorId}:${key}`,
        payload: {
          sentByUserId: requestInput.identity!.userId,
          ...(requestInput.identity!.apiKeyId ? { apiKeyId: requestInput.identity!.apiKeyId } : {}),
          messageId: message.id,
          phoneNumberId: b.phoneNumberId,
          nativeTally: {
            templateId: template.id,
            templateRevision: template.updatedAt.toISOString(),
          },
          payload: {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
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
        action: 'queue-invoice',
        resource: 'tally-invoice',
        resourceId: b.sourceId,
      },
    });
    return response;
  });
  return serviceResult(result, { status: 202, format: 'json' });
}
export async function getTallyInvoiceStatus(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!,
    record = await db.nativeIdempotency.findUnique({
      where: { vendorId_key: { vendorId, key: `tally-invoice:${requestInput.params.sourceId}` } },
    });
  if (!record) throw new ApiError(404, 'NOT_FOUND', 'Invoice not found');
  const snapshot = record.response as any,
    message = await db.whatsappMessageLogs.findFirst({
      where: { id: snapshot.id, vendorId },
      select: { contactId: true, status: true },
    });
  if (!message) throw new ApiError(404, 'NOT_FOUND', 'Invoice message not found');
  await visibleContact(requestInput, message.contactId);
  return serviceResult({ ...snapshot, status: message.status }, { status: 200, format: 'json' });
}
