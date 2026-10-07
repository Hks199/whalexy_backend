import type { Contacts, Prisma } from '@prisma/client';
import Joi from 'joi';
import { ApiError } from '../api-error.js';
import {
  renderTemplateValues,
  type TemplateValue,
  type TemplateValues,
} from './template-values.js';
import { mediaUrlSchema, publicMediaUrl } from '../../modules/messaging/services/media-message.js';
import {
  sheetTemplateComponents,
  validateSheetMapping,
  type SheetMapping,
} from './sheet-template.js';

export type RichTemplateValues = TemplateValues & {
  mediaHeader?: {
    type: 'image' | 'video' | 'document';
    url: string;
    filename?: string;
  };
  buttonParameters?: {
    index: number;
    value: TemplateValue;
  }[];
  copyCode?: string;
};
export function richTemplateFields(valueSchema: Joi.Schema) {
  return {
    mediaHeader: Joi.object({
      type: Joi.string().valid('image', 'video', 'document').required(),
      url: mediaUrlSchema.required(),
      filename: Joi.string()
        .trim()
        .min(1)
        .max(240)
        .pattern(/^[^\\/\x00-\x1f\x7f]+$/)
        .invalid('.', '..'),
    }).when('.type', {
      is: 'document',
      then: Joi.object({ filename: Joi.required() }),
      otherwise: Joi.object({ filename: Joi.forbidden() }),
    }),
    buttonParameters: Joi.array()
      .items(
        Joi.object({
          index: Joi.number().integer().min(0).max(9).required(),
          value: valueSchema.required(),
        }),
      )
      .max(10)
      .unique('index'),
    copyCode: Joi.string()
      .trim()
      .min(1)
      .max(15)
      .pattern(/^[^\x00-\x1f\x7f]+$/),
  };
}
// Use the same approved-component inspector and renderer as Sheets, with
// synthetic columns for business/contact values rather than spreadsheet columns.
function mapping(data: Prisma.JsonValue | null, values: RichTemplateValues) {
  let column = 0;
  const map: SheetMapping = {
    bodyColumns: (values.bodyParameters ?? []).map(() => column++),
    headerColumns: (values.headerParameters ?? []).map(() => column++),
    buttonColumns: {},
  };
  for (const button of values.buttonParameters ?? []) {
    if (
      !Number.isInteger(button.index) ||
      button.index < 0 ||
      button.index > 9 ||
      map.buttonColumns[String(button.index)] !== undefined
    )
      throw new ApiError(
        409,
        'RICH_TEMPLATE_MAPPING',
        'Map each dynamic URL button once by its template index',
      );
    map.buttonColumns[String(button.index)] = column++;
  }
  if (values.mediaHeader) {
    map.mediaColumn = column++;
    if (values.mediaHeader.filename !== undefined) map.filenameColumn = column++;
  }
  if (values.copyCode !== undefined) map.copyCodeColumn = column++;
  const shape = validateSheetMapping(data, map);
  if (values.mediaHeader) {
    if (shape.media !== values.mediaHeader.type || !publicMediaUrl(values.mediaHeader.url))
      throw new ApiError(
        409,
        'RICH_TEMPLATE_MAPPING',
        'Media must match the approved header and use a public HTTPS URL',
      );
    const filename = values.mediaHeader.filename;
    if (
      filename !== undefined &&
      (!filename.trim() ||
        filename.length > 240 ||
        /[\\/\x00-\x1f\x7f]/.test(filename) ||
        ['.', '..'].includes(filename.trim()))
    )
      throw new ApiError(409, 'RICH_TEMPLATE_MAPPING', 'Invalid document filename');
  }
  if (
    values.copyCode !== undefined &&
    (!values.copyCode.trim() ||
      values.copyCode.length > 15 ||
      /[\x00-\x1f\x7f]/.test(values.copyCode))
  )
    throw new ApiError(
      409,
      'RICH_TEMPLATE_MAPPING',
      'Coupon codes need 1 to 15 characters without controls',
    );
  return map;
}
function translate(error: unknown): never {
  if (error instanceof ApiError && error.code === 'SHEET_TEMPLATE_MAPPING')
    throw new ApiError(409, 'RICH_TEMPLATE_MAPPING', error.message);
  throw error;
}
export function validateRichTemplate(data: Prisma.JsonValue | null, values: RichTemplateValues) {
  try {
    mapping(data, values);
  } catch (error) {
    translate(error);
  }
}
export async function renderRichTemplate(
  tx: Prisma.TransactionClient,
  vendorId: number,
  contact: Contacts,
  data: Prisma.JsonValue | null,
  values: RichTemplateValues,
  pendingCustomValues?: ReadonlyMap<number, string>,
) {
  try {
    const map = mapping(data, values);
    const parameters = [
      ...(values.bodyParameters ?? []),
      ...(values.headerParameters ?? []),
      ...(values.buttonParameters ?? []).map((button) => button.value),
    ];
    const rendered = await renderTemplateValues(
      tx,
      vendorId,
      contact,
      { bodyParameters: parameters },
      pendingCustomValues,
    );
    const row: string[] = parameters.length
      ? (
          rendered[0].parameters as unknown as {
            text: string;
          }[]
        ).map((value) => value.text)
      : [];
    if (values.mediaHeader) {
      row.push(values.mediaHeader.url);
      if (values.mediaHeader.filename !== undefined) row.push(values.mediaHeader.filename);
    }
    if (values.copyCode !== undefined) row.push(values.copyCode);
    try {
      return sheetTemplateComponents(data, map, row) as Prisma.InputJsonObject[];
    } catch (error) {
      if (error instanceof ApiError && error.code === 'SHEET_TEMPLATE_MAPPING')
        throw new ApiError(409, 'TEMPLATE_VALUE_INVALID', error.message);
      throw error;
    }
  } catch (error) {
    translate(error);
  }
}
