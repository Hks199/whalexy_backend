import type { Prisma } from '@prisma/client';
import { authorizeConfiguration } from './services/configuration-access.service.js';
import { updateSettingGroupBodySchema } from './configuration.validation.js';
import { db } from '../../database/client.js';
import { ApiError } from '../../shared/api-error.js';
import { prepareArticleContent } from '../content/services/article-content.js';
import {
  siteSettingDefinitions,
  siteSettingGroups,
  readSiteSettings,
  lockSiteSettings,
} from './services/site-settings.js';
import { serviceResult, type ServiceContext } from '../../shared/service-context.js';

export async function listSettingGroups(requestInput: ServiceContext) {
  return serviceResult(
    { groups: Object.entries(siteSettingGroups).map(([id, keys]) => ({ id, keys })) },
    { status: 200, format: 'json' },
  );
}
export async function getSettingGroup(
  requestInput: ServiceContext,
  keys: readonly string[],
  group: 'user' | 'general' | 'misc_settings',
) {
  const current = await db.$transaction(async (tx) => {
    await authorizeConfiguration(tx, requestInput);
    return readSiteSettings(keys, tx);
  });
  return serviceResult(
    { group, revision: current.revision, settings: current.settings },
    { status: 200, format: 'json' },
  );
}
export async function updateSettingGroup(
  requestInput: ServiceContext,
  keys: readonly string[],
  group: 'user' | 'general' | 'misc_settings',
) {
  const result = await db.$transaction((tx) => writeSettingGroup(tx, requestInput, keys, group));
  return serviceResult(result, { status: 200, format: 'json' });
}

export async function writeSettingGroup(
  tx: Prisma.TransactionClient,
  requestInput: ServiceContext,
  keys: readonly string[],
  group: 'user' | 'general' | 'misc_settings',
) {
  await authorizeConfiguration(tx, requestInput);
  if (
    keys.length !== siteSettingGroups[group].length ||
    keys.some((key) => !siteSettingGroups[group].includes(key as never))
  )
    throw new ApiError(400, 'UNSUPPORTED_SETTINGS', 'Unsupported settings group');
  const checked = updateSettingGroupBodySchema(keys).validate(requestInput.body, {
    allowUnknown: false,
  });
  if (checked.error) throw new ApiError(400, 'INVALID_SETTINGS', 'Invalid supported settings');
  requestInput = { ...requestInput, body: checked.value };

  await lockSiteSettings(tx);
  const current = await readSiteSettings(keys, tx);
  if (requestInput.body.revision !== current.revision)
    throw new ApiError(409, 'SETTINGS_CONFLICT', 'Settings changed; reload before saving');
  for (const [key, input] of Object.entries(requestInput.body.settings)) {
    const definition = siteSettingDefinitions[key]!,
      value = definition.html ? prepareArticleContent(input as string).html : input;
    const encoded = definition.type === 2 ? (value ? '1' : '0') : String(value);
    const existing = current.rows.find((row) => row.name === key);
    const data = { value: encoded, dataType: definition.type, updatedAt: new Date() };
    if (existing) await tx.configurations.update({ where: { id: existing.id }, data });
    else await tx.configurations.create({ data: { name: key, ...data } });
  }
  await tx.auditEvents.create({
    data: {
      actorId: requestInput.identity!.userId,
      action: 'update',
      resource: 'site-settings',
      resourceId: group,
      metadata: { keys: Object.keys(requestInput.body.settings) },
    },
  });
  const saved = await readSiteSettings(keys, tx);
  return { group, revision: saved.revision, settings: saved.settings };
}
