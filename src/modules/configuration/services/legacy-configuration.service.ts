import { Prisma } from '@prisma/client';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { digest } from '../../../utils/crypto.js';
import {
  siteSettingGroups,
  readSiteSettings,
  lockSiteSettings,
  type SiteSettingGroup,
} from './site-settings.js';
import { authorizeConfiguration } from './configuration-access.service.js';
import { writeSettingGroup } from '../configuration.service.js';
export async function read(input: ServiceContext) {
  const pageType = input.params.pageType as SiteSettingGroup;
  const data = await db.$transaction(
    async (tx) => {
      await authorizeConfiguration(tx, input);
      const current = await readSiteSettings(siteSettingGroups[pageType], tx);
      return { pageType, revision: current.revision, ...current.settings };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  return serviceResult({ reaction: 1, message: '', data }, { status: 200, format: 'json' });
}
function canonical(value: any): any {
  return Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
}
export async function write(input: ServiceContext) {
  const pageType = input.params.pageType as SiteSettingGroup,
    body = input.body,
    raw = input.headers['idempotency-key'];
  if (body.pageType !== pageType)
    throw new ApiError(400, 'GROUP_MISMATCH', 'Body and URL settings groups must match');
  if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(raw))
    throw new ApiError(400, 'IDEMPOTENCY_REQUIRED', 'A valid Idempotency-Key is required');
  const key = `legacy-site-settings:${input.identity!.userId}:${raw}`,
    hash = digest(JSON.stringify(canonical({ pageType, body })));
  const result = await db
    .$transaction(
      async (tx) => {
        await authorizeConfiguration(tx, input);
        await lockSiteSettings(tx);
        const replay = await tx.configurations.findMany({ where: { name: key }, take: 2 });
        if (replay.length > 1)
          throw new ApiError(
            409,
            'SETTINGS_REVIEW_REQUIRED',
            'Duplicate replay entries require reconciliation',
          );
        if (replay.length) {
          let stored: any;
          try {
            stored = JSON.parse(replay[0].value ?? '');
          } catch {
            throw new ApiError(409, 'SETTINGS_REVIEW_REQUIRED', 'Invalid replay entry');
          }
          if (stored.hash !== hash)
            throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Key was used for different settings');
          if (stored.nativeVersion !== 1 || stored.response?.reaction !== 1)
            throw new ApiError(409, 'SETTINGS_REVIEW_REQUIRED', 'Invalid replay response');
          return stored.response;
        }
        const saved = await writeSettingGroup(
          tx,
          { ...input, body: { revision: body.revision, settings: body.settings } },
          siteSettingGroups[pageType],
          pageType,
        );
        const response = {
          reaction: 1,
          message: 'Configuration updated successfully',
          data: saved,
        };
        await tx.configurations.create({
          data: {
            name: key,
            value: JSON.stringify({ nativeVersion: 1, hash, response }),
            dataType: 4,
          },
        });
        return response;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 },
    )
    .catch((error) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034')
        throw new ApiError(
          409,
          'SETTINGS_CONFLICT',
          'Settings changed; retry the same idempotent request',
        );
      throw error;
    });
  return serviceResult(result, { status: 200, format: 'json' });
}
