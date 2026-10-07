import Joi from 'joi';
import type { Contacts, Prisma } from '@prisma/client';
import { ApiError } from '../api-error.js';
import { lockedContactFields } from '../../modules/contacts/services/contact-values.js';

export const parameterSchema = Joi.object({
  literal: Joi.string().min(1).max(1024),
  contactField: Joi.string().valid(
    'firstName',
    'lastName',
    'fullName',
    'phone',
    'email',
    'languageCode',
    'country',
  ),
  customFieldId: Joi.number().integer().min(1).max(2147483647),
  fallback: Joi.string().min(1).max(1024).default('-'),
}).xor('literal', 'contactField', 'customFieldId');
export type TemplateValue = {
  literal?: string;
  contactField?: string;
  customFieldId?: number;
  fallback?: string;
};
export type TemplateValues = {
  bodyParameters?: TemplateValue[];
  headerParameters?: TemplateValue[];
};
function count(text: unknown) {
  const content = String(text ?? ''),
    matches = [...content.matchAll(/\{\{([^{}]+)\}\}/g)];
  const slots = [...new Set(matches.map((m) => Number(m[1])))].sort((a, b) => a - b);
  if (slots.length > 20 || slots.some((slot, i) => slot !== i + 1))
    throw new ApiError(
      409,
      'TEMPLATE_PARAMETERS',
      'Template needs contiguous numbered text parameters',
    );
  return slots.length;
}
export function validateTemplateValues(data: Prisma.JsonValue | null, values: TemplateValues) {
  const stored = data as any,
    components = stored?.components ?? stored?.template?.components ?? [];
  if (!Array.isArray(components))
    throw new ApiError(409, 'TEMPLATE_PARAMETERS', 'Template components are invalid');
  let body = 0,
    header = 0;
  const seen = new Set<string>();
  for (const component of components) {
    if (!component || typeof component.type !== 'string')
      throw new ApiError(409, 'TEMPLATE_PARAMETERS', 'Template components are invalid');
    const type = component.type.toUpperCase();
    if (seen.has(type))
      throw new ApiError(
        409,
        'TEMPLATE_PARAMETERS',
        'Duplicate template components are unsupported',
      );
    seen.add(type);
    if (type === 'BODY') body = count(component.text);
    else if (type === 'HEADER') {
      if (String(component.format ?? 'TEXT').toUpperCase() !== 'TEXT')
        throw new ApiError(
          409,
          'TEMPLATE_MEDIA_REQUIRED',
          'Campaign media headers require a media adapter',
        );
      header = count(component.text);
      if (header > 1)
        throw new ApiError(409, 'TEMPLATE_PARAMETERS', 'Text headers support one parameter');
    } else if (!['FOOTER', 'BUTTONS'].includes(type) || JSON.stringify(component).includes('{{'))
      throw new ApiError(
        409,
        'TEMPLATE_PARAMETERS',
        'Template component requires a dedicated parameter adapter',
      );
  }
  if (
    body !== (values.bodyParameters?.length ?? 0) ||
    header !== (values.headerParameters?.length ?? 0)
  )
    throw new ApiError(
      409,
      'TEMPLATE_PARAMETERS_REQUIRED',
      'Parameter counts must match the approved template',
    );
}
export async function validateCustomFields(
  tx: Prisma.TransactionClient,
  vendorId: number,
  values: TemplateValues,
) {
  const ids = [
    ...new Set(
      [...(values.bodyParameters ?? []), ...(values.headerParameters ?? [])].flatMap((p) =>
        p.customFieldId ? [p.customFieldId] : [],
      ),
    ),
  ];
  await lockedContactFields(tx, vendorId, ids);
}
export async function renderTemplateValues(
  tx: Prisma.TransactionClient,
  vendorId: number,
  contact: Contacts,
  values: TemplateValues,
  pendingCustomValues?: ReadonlyMap<number, string>,
): Promise<Prisma.InputJsonObject[]> {
  const all = [...(values.bodyParameters ?? []), ...(values.headerParameters ?? [])];
  const ids = [...new Set(all.flatMap((p) => (p.customFieldId ? [p.customFieldId] : [])))];
  const custom = ids.length
    ? await tx.contactCustomFieldValues.findMany({
        where: {
          contactId: contact.id,
          contactCustomFieldsId: { in: ids },
          refContactCustomFieldsId: { vendorId },
        },
      })
    : [];
  const country =
    all.some((p) => p.contactField === 'country') && contact.countryId
      ? await tx.countries.findUnique({ where: { id: contact.countryId }, select: { name: true } })
      : null;
  const fields: Record<string, string | null> = {
    firstName: contact.firstName,
    lastName: contact.lastName,
    fullName: [contact.firstName, contact.lastName].filter(Boolean).join(' '),
    phone: contact.waId,
    email: contact.email,
    languageCode: contact.languageCode,
    country: country?.name ?? null,
  };
  const render = (parameter: TemplateValue) => {
    const value =
      parameter.literal ??
      (parameter.contactField
        ? fields[parameter.contactField]
        : parameter.customFieldId !== undefined && pendingCustomValues?.has(parameter.customFieldId)
          ? pendingCustomValues.get(parameter.customFieldId)
          : custom.find((c) => c.contactCustomFieldsId === parameter.customFieldId)?.fieldValue);
    const text = value || parameter.fallback || '-';
    if (text.length > 1024 || /[\r\n\t\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text))
      throw new ApiError(
        409,
        'TEMPLATE_VALUE_INVALID',
        'Contact template value is too long or contains unsupported controls',
      );
    return { type: 'text', text };
  };
  return ['header', 'body'].flatMap((type) => {
    const parameters = type === 'body' ? values.bodyParameters : values.headerParameters;
    return parameters?.length ? [{ type, parameters: parameters.map(render) }] : [];
  });
}
