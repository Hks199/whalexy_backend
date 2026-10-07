import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { digest } from '../../../utils/crypto.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { resolveLegacyContact } from '../../contacts/services/legacy-contact.service.js';
import { present } from '../../contacts/contacts.service.js';
import { baseSubscriptionActive } from '../../billing/services/billing-support.service.js';
import { checkTallyConnection, ingestTallyInvoice } from '../tally.service.js';

export async function pingLegacyTally(input: ServiceContext) {
  const result = await checkTallyConnection(input),
    body = result.body as any;
  return serviceResult(
    {
      ...body,
      message: 'Whalexy Tally API is active and connected!',
      timestamp: new Date(body.timestamp).toISOString().replace('T', ' ').slice(0, 19),
    },
    { status: 200, format: 'json' },
  );
}
export async function sendLegacyTallyInvoice(input: ServiceContext) {
  const body = input.body,
    vendorId = input.identity!.vendorId!;
  if (!(await baseSubscriptionActive(vendorId)))
    throw new ApiError(403, 'SUBSCRIPTION_REQUIRED', 'An active base subscription is required');
  let phone = String(
    body.phone_number ?? body.customer_mobile ?? body.party_mobile ?? body.mobile,
  ).replace(/\D/g, '');
  if (phone.length === 10) phone = '91' + phone;
  if (!/^[1-9]\d{8,14}$/.test(phone))
    throw new ApiError(400, 'INVALID_PHONE', 'Invoice recipient phone is invalid');
  const contact = await resolveLegacyContact({
    ...input,
    body: { phone_number: phone, from_phone_number_id: body.from_phone_number_id },
  });
  const phoneNumberId = body.from_phone_number_id ?? contact.wabPhoneNumberId;
  if (!phoneNumberId)
    throw new ApiError(
      409,
      'PHONE_SCOPE_REQUIRED',
      'Invoice contact must belong to a connected business number',
    );
  const templates = await db.whatsappTemplates.findMany({
    where: {
      vendorId,
      templateName: body.template_name,
      status: 'APPROVED',
      ...(body.template_language ? { languageCode: body.template_language } : {}),
    },
    take: 2,
  });
  if (templates.length !== 1)
    throw new ApiError(
      400,
      'INVALID_TEMPLATE',
      'Choose one owned approved invoice template and language',
    );
  const invoiceNumber = body.invoice_number ?? body.voucher_number ?? body.invoice_no;
  const date = body.invoice_date ?? body.date ?? new Date().toISOString().slice(0, 10);
  const invoiceDate = /^\d{2}-\d{2}-\d{4}$/.test(date) ? date.split('-').reverse().join('-') : date;
  const vendor = await db.vendors.findUniqueOrThrow({
    where: { id: vendorId },
    select: { title: true },
  });
  if (body.company_name && body.company_name !== vendor.title)
    throw new ApiError(
      400,
      'INVALID_COMPANY',
      'Invoice company must match the configured business',
    );
  const sourceId = 'legacy_' + digest(JSON.stringify([phoneNumberId, invoiceDate, invoiceNumber]));
  const result = await ingestTallyInvoice({
    ...input,
    body: {
      sourceId,
      contactId: contact.id,
      phoneNumberId,
      templateId: templates[0].id,
      invoiceNumber,
      invoiceAmount: body.invoice_amount ?? body.amount ?? body.total_amount ?? '0.00',
      currency: body.currency,
      invoiceDate,
      customerName: body.customer_name ?? body.party_name ?? body.party,
      pdfUrl: body.pdf_url,
      headerFields: [],
    },
  });
  return serviceResult(
    {
      result: 'success',
      message: 'WhatsApp invoice message queued using approved template.',
      invoice_number: invoiceNumber,
      recipient: present(input, contact).waId,
      template_used: templates[0].templateName,
      pdf_url: body.pdf_url ?? null,
      data: result.body,
    },
    { status: 202, format: 'json' },
  );
}
