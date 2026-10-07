import Joi from 'joi';
import type { Prisma } from '@prisma/client';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { digest } from '../../../utils/crypto.js';
import { prepareArticleContent } from '../../content/services/article-content.js';

const text = (max: number) =>
  Joi.string()
    .max(max)
    .allow('')
    .pattern(/^[^\x00-\x08\x0b\x0c\x0e-\x1f]*$/);
const url = text(2048).custom((value: string, helpers) => {
  if (!value) return value;
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      !parsed.hostname.includes('.')
    )
      return helpers.error('any.invalid');
    return parsed.href;
  } catch {
    return helpers.error('any.invalid');
  }
});
const timeZone = Joi.string()
  .max(100)
  .custom((value: string, helpers) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return value;
    } catch {
      return helpers.error('any.invalid');
    }
  });
type Setting = {
  schema: Joi.Schema;
  type: 1 | 2;
  default: string | boolean;
  html?: boolean;
};
// Exact source names; no unrestricted settings endpoint or hidden credentials.
export const siteSettingDefinitions: Record<string, Setting> = {
  name: {
    schema: Joi.string()
      .min(1)
      .max(160)
      .pattern(/^[^\x00-\x1f]*$/),
    type: 1,
    default: 'Whalexy',
  },
  description: { schema: text(2000), type: 1, default: '' },
  contact_email: { schema: Joi.string().email().max(254).allow(''), type: 1, default: '' },
  contact_details: { schema: text(10000), type: 1, default: '' },
  timezone: { schema: timeZone, type: 1, default: 'UTC' },
  demo_video_link: { schema: url, type: 1, default: '' },
  whatsapp_demo_link: { schema: url, type: 1, default: '' },
  enable_vendor_registration: { schema: Joi.boolean().strict(), type: 2, default: true },
  message_for_disabled_registration: { schema: text(1000), type: 1, default: '' },
  user_terms: { schema: text(200000), type: 1, default: '', html: true },
  vendor_terms: { schema: text(200000), type: 1, default: '', html: true },
  privacy_policy: { schema: text(200000), type: 1, default: '', html: true },
  other_home_page_url: { schema: url, type: 1, default: '' },
};
export const siteSettingGroups = {
  general: [
    'name',
    'description',
    'contact_email',
    'contact_details',
    'timezone',
    'demo_video_link',
    'whatsapp_demo_link',
  ],
  user: [
    'enable_vendor_registration',
    'message_for_disabled_registration',
    'user_terms',
    'vendor_terms',
    'privacy_policy',
  ],
  misc_settings: ['other_home_page_url'],
} as const;
export type SiteSettingGroup = keyof typeof siteSettingGroups;
function review(): never {
  throw new ApiError(409, 'SETTINGS_REVIEW_REQUIRED', 'Site settings require reconciliation');
}
function decode(
  key: string,
  row: {
    value: string | null;
    dataType: number | null;
  },
) {
  const definition = siteSettingDefinitions[key]!;
  if (row.dataType !== definition.type || row.value === null) review();
  let value: string | boolean = row.value;
  if (definition.type === 2) {
    // Laravel's bool settings are strings in the legacy table, not JSON objects.
    if (['1', 'true'].includes(row.value)) value = true;
    else if (['0', 'false', ''].includes(row.value)) value = false;
    else review();
  }
  const result = definition.schema.validate(value, { convert: false, allowUnknown: false });
  if (result.error) review();
  return definition.html
    ? prepareArticleContent(result.value).html
    : (result.value as string | boolean);
}
export async function readSiteSettings(keys: readonly string[], tx: Prisma.TransactionClient = db) {
  if (keys.some((key) => !Object.hasOwn(siteSettingDefinitions, key)))
    throw new Error('Unsupported site setting');
  const rows = await tx.configurations.findMany({
    where: { name: { in: [...keys] } },
    orderBy: { id: 'asc' },
  });
  const found = new Set<string>();
  const settings = Object.fromEntries(
    keys.map((key) => [key, siteSettingDefinitions[key]!.default]),
  ) as Record<string, string | boolean>;
  for (const row of rows) {
    if (found.has(row.name)) review();
    found.add(row.name);
    settings[row.name] = decode(row.name, row);
  }
  const revision = digest(
    JSON.stringify([
      keys,
      rows.map((row) => [row.name, row.uid, row.updatedAt.toISOString(), row.dataType, row.value]),
    ]),
  );
  return { settings, revision, rows };
}
export async function lockSiteSettings(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('whalexy:site-settings',0))`;
}
export async function requireRegistrationOpen(tx: Prisma.TransactionClient = db) {
  const { settings } = await readSiteSettings(
    ['enable_vendor_registration', 'message_for_disabled_registration'],
    tx,
  );
  if (!settings.enable_vendor_registration)
    throw new ApiError(
      403,
      'REGISTRATION_DISABLED',
      'New workspace registration is currently disabled',
    );
}
