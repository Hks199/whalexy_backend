import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { baseSubscriptionActive } from '../../billing/services/billing-support.service.js';
import { resolveLegacyContact } from '../../contacts/services/legacy-contact.service.js';
import { present } from '../../contacts/contacts.service.js';
import { sendMessage } from '../messaging.service.js';

function textTemplateComponents(templateData: unknown, input: Record<string, unknown>) {
  const data = templateData as any;
  const definitions = data?.template?.components ?? data?.components;
  if (!Array.isArray(definitions))
    throw new ApiError(
      409,
      'TEMPLATE_SYNC_REQUIRED',
      'Sync the approved template definition before sending',
    );
  const components: { type: string; parameters: { type: string; text: string }[] }[] = [];
  const used = new Set<string>();
  for (const definition of definitions) {
    if (!definition || typeof definition !== 'object')
      throw new ApiError(409, 'TEMPLATE_SYNC_REQUIRED', 'Template definition is malformed');
    if (definition.type === 'FOOTER') continue;
    if (
      !['HEADER', 'BODY'].includes(definition.type) ||
      (definition.type === 'HEADER' && definition.format !== 'TEXT')
    )
      throw new ApiError(
        409,
        'TEMPLATE_COMPONENT_PENDING',
        'This template component requires additional conversion',
      );
    if (/\{\{[^}]*\}\}/.test(String(definition.text ?? '').replace(/\{\{\d+\}\}/g, '')))
      throw new ApiError(
        409,
        'TEMPLATE_COMPONENT_PENDING',
        'Named template parameters require additional conversion',
      );
    const matches = [...new Set<string>(String(definition.text ?? '').match(/\{\{\d+\}\}/g) ?? [])]
      .map((match) => Number(match.slice(2, -2)))
      .sort((a, b) => a - b);
    if (matches.length > 20 || matches.some((value, index) => value !== index + 1))
      throw new ApiError(
        409,
        'TEMPLATE_COMPONENT_PENDING',
        'Template parameters must use sequential numeric positions',
      );
    const parameters = matches.map((position) => {
      const key = `${definition.type === 'HEADER' ? 'header_' : ''}field_${position}`;
      const value = input[key];
      if (typeof value !== 'string')
        throw new ApiError(400, 'MISSING_TEMPLATE_PARAMETER', `Missing ${key}`);
      used.add(key);
      return { type: 'text', text: value };
    });
    if (parameters.length) components.push({ type: definition.type.toLowerCase(), parameters });
  }
  if (Object.keys(input).some((key) => /^(?:header_)?field_/.test(key) && !used.has(key)))
    throw new ApiError(
      400,
      'UNEXPECTED_TEMPLATE_PARAMETER',
      'Request includes an unused template parameter',
    );
  return components;
}

export async function sendLegacyMessage(
  input: ServiceContext,
  kind: 'text' | 'media' | 'template',
) {
  const vendorId = input.identity!.vendorId!,
    body = input.body;
  if (!(await baseSubscriptionActive(vendorId)))
    throw new ApiError(403, 'SUBSCRIPTION_REQUIRED', 'An active base subscription is required');
  const contact = await resolveLegacyContact(input);
  let phoneNumberId = body.from_phone_number_id ?? contact.wabPhoneNumberId;
  if (!phoneNumberId) {
    const connections = await db.integrationCredentials.findMany({
      where: { vendorId, provider: 'whatsapp' },
      take: 2,
    });
    if (connections.length !== 1)
      throw new ApiError(
        409,
        'PHONE_SCOPE_REQUIRED',
        'Select one connected business number with from_phone_number_id',
      );
    phoneNumberId = connections[0].externalId;
  }
  const native: Record<string, unknown> = { contactId: contact.id, phoneNumberId, kind };
  if (kind === 'text') native.text = body.message_body;
  if (kind === 'media') {
    const caption = body.caption ?? body.message_body,
      filename = body.filename ?? body.file_name;
    if ((body.media_type === 'audio' && caption) || (body.media_type !== 'document' && filename))
      throw new ApiError(
        400,
        'INVALID_MEDIA',
        'Caption or filename is incompatible with this media type',
      );
    native.media = {
      type: body.media_type,
      url: body.media_url,
      ...(caption ? { caption } : {}),
      ...(filename ? { filename } : {}),
    };
  }
  if (kind === 'template') {
    const templates = await db.whatsappTemplates.findMany({
      where: {
        vendorId,
        templateName: body.template_name,
        languageCode: body.template_language,
        status: 'APPROVED',
      },
      take: 2,
    });
    if (templates.length !== 1)
      throw new ApiError(
        400,
        'INVALID_TEMPLATE',
        'One approved template must match the requested name and language',
      );
    native.templateId = templates[0].id;
    native.components = textTemplateComponents(templates[0].data, body);
  }
  const result = await sendMessage({ ...input, body: native });
  const queued = result.body as { uid: string; status: string };
  // The durable queue is asynchronous. Never present queue IDs as provider message IDs.
  return serviceResult(
    {
      result: 'success',
      message: 'Message queued',
      data: {
        log_uid: null,
        contact_uid: contact.uid,
        phone_number: present(input, contact).waId,
        wamid: null,
        status: queued.status,
        message_uid: queued.uid,
      },
    },
    { status: 202, format: 'json' },
  );
}
