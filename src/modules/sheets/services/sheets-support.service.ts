import { Prisma } from '@prisma/client';
import { db } from '../../../database/client.js';
import { config } from '../../../config/environment.js';
import { ApiError } from '../../../shared/api-error.js';
import { ownedPhone } from '../../contacts/contacts.service.js';
import { sheetScript } from './sheet-script.js';
import {
  validateSheetMapping,
  type SheetMapping,
} from '../../../shared/templates/sheet-template.js';

export type Rule = SheetMapping & {
  templateId: number;
  triggerValue?: string;
  revision: string;
};

export type Settings = {
  nativeVersion: 1;
  spreadsheetId: string;
  sheetName: string;
  phoneNumberId: string;
  triggerType: string;
  phoneColumn: number;
  rowIdColumn: number;
  triggerColumn?: number;
  statusColumn?: number;
  rules: Rule[];
};

export function readNativeSheetSettings(row: any): Settings {
  const c = row.config as Settings;
  if (c?.nativeVersion !== 1)
    throw new ApiError(
      409,
      'LEGACY_SHEET_CONFIGURATION',
      'Regenerate this legacy automation before running it',
    );
  return c;
}

export function presentSheetIntegration(row: any) {
  return {
    id: row.id,
    uid: row.uid,
    title: row.title,
    triggerType: row.triggerType,
    enabled: row.status === 1,
    config: row.config?.nativeVersion === 1 ? row.config : null,
    requiresRegeneration: row.config?.nativeVersion !== 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function lockSheetIntegration(tx: Prisma.TransactionClient, id: number) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`sheet-automation:${id}`},0))`;
}

export async function getConfiguredSheetIntegration(vendorId: number, input: any) {
  await ownedPhone(vendorId, input.phoneNumberId);
  if (input.triggerType === 'new_row' && input.rules.length !== 1)
    throw new ApiError(400, 'SHEET_RULES', 'New-row automation requires exactly one template');
  const required = [
    input.phoneColumn,
    input.rowIdColumn,
    ...(input.triggerColumn !== undefined ? [input.triggerColumn] : []),
    ...(input.statusColumn !== undefined ? [input.statusColumn] : []),
  ];
  if (new Set(required).size !== required.length)
    throw new ApiError(
      400,
      'SHEET_COLUMNS',
      'Phone, row ID, trigger and status columns must differ',
    );
  const seen = new Set<string>(),
    rules: Rule[] = [];
  for (const r of input.rules) {
    if (input.triggerType === 'column_value') {
      if (!r.triggerValue)
        throw new ApiError(400, 'SHEET_RULES', 'Each column rule requires a trigger value');
      const value = r.triggerValue.trim().toLowerCase();
      if (seen.has(value)) throw new ApiError(400, 'SHEET_RULES', 'Trigger values must be unique');
      seen.add(value);
    } else if (r.triggerValue !== undefined)
      throw new ApiError(400, 'SHEET_RULES', 'New-row rules do not use trigger values');
    const template = await db.whatsappTemplates.findFirst({
      where: { id: r.templateId, vendorId, status: 'APPROVED' },
    });
    if (!template)
      throw new ApiError(400, 'INVALID_TEMPLATE', 'Approved template not found in this business');
    validateSheetMapping(template.data, r);
    const mapped = [
      ...r.bodyColumns,
      ...r.headerColumns,
      ...Object.values(r.buttonColumns),
      r.mediaColumn,
      r.filenameColumn,
      r.copyCodeColumn,
    ].filter((n) => n !== undefined);
    if (
      mapped.includes(input.rowIdColumn) ||
      (input.statusColumn !== undefined && mapped.includes(input.statusColumn))
    )
      throw new ApiError(
        400,
        'SHEET_COLUMNS',
        'Row ID and status columns cannot overwrite template inputs',
      );
    rules.push({ ...r, revision: template.updatedAt.toISOString() });
  }
  const { title, ...settings } = input;
  return { title, settings: { ...settings, nativeVersion: 1, rules } as Settings };
}

// Scripts intentionally require a separately configured API key in Apps Script.
export function getSheetCredential(vendorId: number, uid: string, c: Settings) {
  const base = new URL(config.PUBLIC_URL);
  if (base.protocol !== 'https:' || base.username || base.password)
    throw new ApiError(503, 'SHEET_PUBLIC_URL', 'Configure a public HTTPS application URL');
  base.pathname = `/api/v1/vendors/${vendorId}/sheets/${uid}/rows`;
  base.search = '';
  base.hash = '';
  return sheetScript({
    uid,
    apiUrl: base.href,
    spreadsheetId: c.spreadsheetId,
    sheetName: c.sheetName,
    triggerType: c.triggerType,
    phoneColumn: c.phoneColumn,
    rowIdColumn: c.rowIdColumn,
    triggerColumn: c.triggerColumn,
    statusColumn: c.statusColumn,
  });
}

export async function sheetSendAllowed(vendorId: number, payload: any) {
  if (!payload.nativeSheet) return true;
  const guard = payload.nativeSheet;
  const [automation, template] = await Promise.all([
    db.googleSheetAutomations.findFirst({ where: { uid: guard.uid, vendorId, status: 1 } }),
    db.whatsappTemplates.findFirst({
      where: { id: guard.templateId, vendorId, status: 'APPROVED' },
    }),
  ]);
  if (
    !automation ||
    automation.updatedAt.toISOString() !== guard.revision ||
    (automation.config as any)?.nativeVersion !== 1 ||
    !template ||
    template.updatedAt.toISOString() !== guard.templateRevision ||
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
