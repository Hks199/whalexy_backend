import type { Contacts, Prisma } from '@prisma/client';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { validateCustomFields } from '../../../shared/templates/template-values.js';
import {
  renderRichTemplate,
  validateRichTemplate,
  type RichTemplateValues,
} from '../../../shared/templates/rich-template.js';
import type { GraphResult } from './graph-types.types.js';

export async function graphTemplate(
  tx: Prisma.TransactionClient,
  vendorId: number,
  payload: RichTemplateValues & {
    whatsapp_template_id: number;
  },
) {
  const template = await tx.whatsappTemplates.findFirst({
    where: { id: payload.whatsapp_template_id, vendorId, status: 'APPROVED' },
  });
  if (!template)
    throw new ApiError(409, 'GRAPH_TEMPLATE_UNAVAILABLE', 'An owned approved template is required');
  const data = template.data as any,
    components = data?.components ?? data?.template?.components;
  if (
    !Array.isArray(components) ||
    !components.some(
      (component: any) =>
        typeof component?.type === 'string' &&
        component.type.toUpperCase() === 'BODY' &&
        typeof component.text === 'string' &&
        component.text.length > 0,
    ) ||
    !template.templateName ||
    !template.languageCode
  )
    throw new ApiError(
      409,
      'GRAPH_TEMPLATE_UNAVAILABLE',
      'Synchronize the approved template definition first',
    );
  validateRichTemplate(template.data, payload);
  await validateCustomFields(tx, vendorId, {
    bodyParameters: [
      ...(payload.bodyParameters ?? []),
      ...(payload.buttonParameters ?? []).map((button) => button.value),
    ],
    headerParameters: payload.headerParameters,
  });
  return template;
}
/** Resolve every template before writes, so an invalid node blocks the entire step. */
export async function prepareGraphTemplates(
  tx: Prisma.TransactionClient,
  contact: Contacts,
  phoneId: string,
  result: GraphResult,
  pendingCustomValues?: ReadonlyMap<number, string>,
): Promise<GraphResult> {
  const messages = [];
  for (const message of result.messages) {
    if (!message.graphTemplate) {
      messages.push(message);
      continue;
    }
    const template = await graphTemplate(tx, contact.vendorId, message.graphTemplate);
    if (
      template.category?.toUpperCase() === 'MARKETING' &&
      (await tx.contacts.findFirst({
        where: {
          vendorId: contact.vendorId,
          waId: contact.waId,
          whatsappOptOut: { not: null },
          OR: [{ wabPhoneNumberId: null }, { wabPhoneNumberId: phoneId }],
        },
        select: { id: true },
      }))
    )
      throw new ApiError(409, 'GRAPH_MARKETING_OPT_OUT', 'This recipient opted out of marketing');
    const components = await renderRichTemplate(
      tx,
      contact.vendorId,
      contact,
      template.data,
      message.graphTemplate,
      pendingCustomValues,
    );
    messages.push({
      nodeId: message.nodeId,
      nativeGraphTemplate: { templateId: template.id, revision: template.updatedAt.toISOString() },
      type: 'template',
      template: {
        name: template.templateName,
        language: { code: template.languageCode },
        components,
      },
    });
  }
  return { ...result, messages };
}
export async function graphTemplateSendAllowed(vendorId: number, payload: any) {
  const guard = payload.nativeGraphTemplate;
  if (!guard) return true;
  const template = await db.whatsappTemplates.findFirst({
    where: { id: guard.templateId, vendorId, status: 'APPROVED' },
  });
  if (
    !template ||
    template.updatedAt.toISOString() !== guard.revision ||
    template.templateName !== payload.payload?.template?.name ||
    template.languageCode !== payload.payload?.template?.language?.code
  )
    return false;
  return (
    template.category?.toUpperCase() !== 'MARKETING' ||
    !(await db.contacts.findFirst({
      where: {
        vendorId,
        waId: String(payload.payload?.to ?? ''),
        whatsappOptOut: { not: null },
        OR: [{ wabPhoneNumberId: null }, { wabPhoneNumberId: payload.phoneNumberId }],
      },
      select: { id: true },
    }))
  );
}
