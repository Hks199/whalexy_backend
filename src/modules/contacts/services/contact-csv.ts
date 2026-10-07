import Joi from 'joi';
import { parse } from 'csv-parse/sync';
import type { Prisma } from '@prisma/client';
import { ApiError } from '../../../shared/api-error.js';
import { phoneSchema } from '../../../validation/common.js';
import { contactValue, lockedContactFields, type ContactField } from './contact-values.js';

const aliases: Record<string, string> = {
  'first name': 'firstName',
  first_name: 'firstName',
  firstname: 'firstName',
  name: 'firstName',
  'contact name': 'firstName',
  fullname: 'firstName',
  'full name': 'firstName',
  'last name': 'lastName',
  last_name: 'lastName',
  lastname: 'lastName',
  phone: 'phone',
  'mobile number': 'phone',
  'phone number': 'phone',
  mobile: 'phone',
  wa_id: 'phone',
  email: 'email',
  'email address': 'email',
  'language code': 'languageCode',
  language_code: 'languageCode',
  languagecode: 'languageCode',
  language: 'languageCode',
  lang: 'languageCode',
  country: 'country',
  countryid: 'countryId',
  countries__id: 'countryId',
  groups: 'groups',
  group: 'groups',
};
const reserved = new Set([
  'id',
  'uid',
  'vendorid',
  'vendors__id',
  'assigneduserid',
  'platform',
  'status',
  'phonenumberid',
  'wab_phone_number_id',
  '__proto__',
  'constructor',
  'prototype',
]);
export const csvFieldNameAllowed = (name: string) =>
  /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name) && !reserved.has(name.toLowerCase());
const baseSchema = Joi.object({
  firstName: Joi.string().trim().max(100).allow(''),
  lastName: Joi.string().trim().max(100).allow(''),
  phone: phoneSchema.required(),
  email: Joi.string().email().max(254).allow(''),
  languageCode: Joi.string()
    .pattern(/^[a-z]{2,3}([_-][A-Za-z]{2,4})?$/)
    .allow(''),
});
export interface CsvColumn {
  key: string;
  field?: ContactField;
}
export interface ParsedContacts {
  columns: CsvColumn[];
  rows: string[][];
  fieldIds: number[];
  hasGroups: boolean;
}
export async function parseContactCsv(
  tx: Prisma.TransactionClient,
  vendorId: number,
  csv: string,
): Promise<ParsedContacts> {
  let records: string[][];
  try {
    records = parse(csv, {
      bom: true,
      skip_empty_lines: true,
      max_record_size: 65536,
      columns: false,
    });
  } catch {
    throw new ApiError(400, 'INVALID_CSV', 'CSV headers or records are invalid');
  }
  const headers = records.shift();
  if (!headers?.length || headers.length > 108 || !records.length || records.length > 5000)
    throw new ApiError(
      400,
      'IMPORT_LIMIT',
      'Import between 1 and 5000 contacts with at most 108 columns',
    );
  const fields = await tx.contactCustomFields.findMany({ where: { vendorId } });
  const columns = headers.map((header): CsvColumn => {
    const name = header.trim(),
      normalized = name.toLowerCase(),
      explicit = normalized.startsWith('custom:');
    const fieldName = explicit ? name.slice(7) : name;
    if (!explicit && Object.hasOwn(aliases, normalized)) return { key: aliases[normalized] };
    if (reserved.has(normalized) || !csvFieldNameAllowed(fieldName))
      throw new ApiError(400, 'INVALID_CSV', 'CSV includes an unsupported header');
    const matches = fields.filter((f) => f.inputName === fieldName);
    if (matches.length !== 1)
      throw new ApiError(
        400,
        'INVALID_FIELD',
        'CSV custom fields must resolve uniquely in this business',
      );
    return { key: `custom:${matches[0].id}`, field: matches[0] };
  });
  const keys = columns.map((c) => c.key);
  if (
    new Set(keys).size !== keys.length ||
    !keys.includes('phone') ||
    (keys.includes('country') && keys.includes('countryId'))
  )
    throw new ApiError(400, 'INVALID_CSV', 'CSV headers must be unique and include phone');
  const fieldIds = columns.flatMap((c) => (c.field ? [c.field.id] : [])),
    locked = await lockedContactFields(tx, vendorId, fieldIds);
  // A concurrent rename must not silently reinterpret a selected column.
  for (const column of columns)
    if (column.field) {
      const current = locked.find((f) => f.id === column.field!.id)!;
      if (current.inputName !== column.field.inputName)
        throw new ApiError(409, 'FIELD_CHANGED', 'Custom field changed during import');
      column.field = current;
    }
  return { columns, rows: records, fieldIds, hasGroups: keys.includes('groups') };
}
function groupTitles(value: string) {
  if (!value.trim()) return [];
  let titles: unknown;
  try {
    titles = value.trim().startsWith('[') ? JSON.parse(value) : value.split(',');
  } catch {
    throw new ApiError(
      400,
      'INVALID_CSV_GROUPS',
      'Group names must be a comma-separated list or JSON array',
    );
  }
  if (
    !Array.isArray(titles) ||
    titles.length > 20 ||
    titles.some((t) => typeof t !== 'string' || !t.trim() || t.trim().length > 200)
  )
    throw new ApiError(
      400,
      'INVALID_CSV_GROUPS',
      'Use at most twenty nonempty group names per contact',
    );
  return [...new Set((titles as string[]).map((t) => t.trim()))];
}
export interface ImportContactRow {
  base: {
    phone: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    languageCode?: string;
  };
  countryId: number | null;
  groupIds: number[];
  values: {
    fieldId: number;
    value: string | null;
  }[];
}
export async function resolveContactCsv(
  tx: Prisma.TransactionClient,
  vendorId: number,
  phoneNumberId: string | null,
  parsed: ParsedContacts,
): Promise<ImportContactRow[]> {
  const countries = new Map<string, number>(),
    groups = new Map<string, number>(),
    phones = new Set<string>();
  const resolved: ImportContactRow[] = [];
  for (const [index, cells] of parsed.rows.entries()) {
    const base: Record<string, string> = Object.create(null),
      values: ImportContactRow['values'] = [];
    let countryId: number | null = null,
      groupIds: number[] = [];
    for (const [i, column] of parsed.columns.entries()) {
      const value = cells[i];
      if (column.field) {
        const input =
          column.field.inputType === 'number' && /^\s*'[+-]/.test(value)
            ? value.replace(/^(\s*)'/, '$1')
            : value;
        values.push({ fieldId: column.field.id, value: contactValue(column.field, input) });
        continue;
      }
      if (column.key === 'country' || column.key === 'countryId') {
        const key = `${column.key}:${value.trim().toLowerCase()}`;
        if (!value.trim()) continue;
        if (!countries.has(key)) {
          if (countries.size >= 250)
            throw new ApiError(
              400,
              'IMPORT_REFERENCE_LIMIT',
              'Import at most 250 distinct country references',
            );
          const id = Number(value.trim());
          const candidates =
            column.key === 'countryId'
              ? /^\d+$/.test(value.trim()) && Number.isInteger(id) && id > 0 && id <= 2147483647
                ? await tx.countries.findMany({ where: { id }, take: 2 })
                : []
              : await tx.countries.findMany({
                  where: {
                    OR: ['name', 'isoCode', 'iso3Code'].map((field) => ({
                      [field]: { equals: value.trim(), mode: 'insensitive' },
                    })),
                  },
                  take: 2,
                });
          if (candidates.length !== 1)
            throw new ApiError(
              400,
              'INVALID_COUNTRY',
              `Country is unavailable or ambiguous at row ${index + 2}`,
            );
          countries.set(key, candidates[0].id);
        }
        countryId = countries.get(key)!;
        continue;
      }
      if (column.key === 'groups') {
        for (const title of groupTitles(value)) {
          if (!groups.has(title)) {
            if (groups.size >= 500)
              throw new ApiError(
                400,
                'IMPORT_REFERENCE_LIMIT',
                'Import at most 500 distinct group references',
              );
            const candidates = await tx.contactGroups.findMany({
              where: {
                vendorId,
                title,
                status: 1,
                OR: [{ wabPhoneNumberId: phoneNumberId }, { wabPhoneNumberId: null }],
              },
              take: 2,
            });
            if (candidates.length !== 1)
              throw new ApiError(
                400,
                'INVALID_GROUP',
                `Group is unavailable or ambiguous in this phone scope at row ${index + 2}`,
              );
            groups.set(title, candidates[0].id);
          }
          groupIds.push(groups.get(title)!);
        }
        continue;
      }
      base[column.key] = value;
    }
    const phone = base.phone.replace(/^'/, '');
    base.phone = phone.startsWith('+') ? phone : `+${phone}`;
    const validated = baseSchema.validate(base, { abortEarly: false });
    if (validated.error)
      throw new ApiError(400, 'INVALID_CSV_ROW', `Contact data is invalid at row ${index + 2}`);
    if (phones.has(validated.value.phone))
      throw new ApiError(400, 'DUPLICATE_PHONE', 'The CSV contains duplicate phone numbers');
    phones.add(validated.value.phone);
    resolved.push({ base: validated.value, countryId, groupIds, values });
  }
  return resolved;
}
export function csvCell(value: unknown) {
  let text = value == null ? '' : String(value);
  if (/^[\s]*[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
