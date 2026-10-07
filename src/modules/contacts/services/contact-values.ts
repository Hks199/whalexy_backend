import Joi from 'joi';
import { Prisma } from '@prisma/client';
import { ApiError } from '../../../shared/api-error.js';

export const contactValueTypes = [
  'text',
  'number',
  'email',
  'url',
  'date',
  'time',
  'datetime-local',
];
export const numericValue = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d{1,3})?$/;
export function validTypedValue(type: string, value: string): boolean {
  switch (type) {
    case 'text':
      return true;
    case 'number':
      return numericValue.test(value);
    case 'email':
      return !Joi.string().email({ tlds: false }).validate(value).error;
    case 'url':
      return !Joi.string()
        .uri({ scheme: ['http', 'https'] })
        .validate(value).error;
    case 'date':
      return (
        /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        !Joi.date().iso().validate(value).error &&
        new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
      );
    case 'time':
      return /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value);
    case 'datetime-local': {
      const parts = value.split('T');
      return (
        parts.length === 2 && validTypedValue('date', parts[0]) && validTypedValue('time', parts[1])
      );
    }
    default:
      return false;
  }
}
export interface ContactField {
  id: number;
  inputName: string;
  inputType: string;
}
export async function lockFieldDefinitions(tx: Prisma.TransactionClient, vendorId: number) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`contact-field-definitions:${vendorId}`},0))`;
}
export function contactValue(field: ContactField, input: string | null): string | null {
  if (!contactValueTypes.includes(field.inputType))
    throw new ApiError(409, 'FIELD_TYPE_PENDING', 'Custom field type requires conversion');
  if (input === null) return null;
  const value = input.trim();
  if (
    value.length > 4000 ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value) ||
    (value && !validTypedValue(field.inputType, value))
  )
    throw new ApiError(400, 'INVALID_CUSTOM_VALUE', 'Custom value does not match its field type', {
      fieldId: field.id,
    });
  return value;
}
/** Prevent field edits/deletion while values are validated and committed. */
export async function lockedContactFields(
  tx: Prisma.TransactionClient,
  vendorId: number,
  ids: number[],
): Promise<ContactField[]> {
  if (!ids.length) return [];
  const fields = await tx.$queryRaw<
    ContactField[]
  >`SELECT "_id" AS "id", "input_name" AS "inputName", "input_type" AS "inputType" FROM "contact_custom_fields" WHERE "vendors__id"=${vendorId} AND "_id"=ANY(${ids}::integer[]) ORDER BY "_id" FOR SHARE`;
  if (fields.length !== ids.length)
    throw new ApiError(400, 'INVALID_FIELD', 'Custom field is unavailable in this business');
  return fields;
}
