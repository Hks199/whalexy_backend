import { Prisma } from '@prisma/client';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { digest } from '../../../utils/crypto.js';
import { authorizeTranslations } from './translation-access.service.js';
import {
  registry,
  catalog,
  languageMissing,
  stale,
  createLanguageTransaction,
  updateLanguageTransaction,
  deleteLanguageTransaction,
  saveCatalogTransaction,
} from '../translations.service.js';
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
export async function read(input: ServiceContext, messages: boolean) {
  const result = await db.$transaction(
    async (tx) => {
      await authorizeTranslations(tx, input);
      const current = await registry(tx);
      if (!messages)
        return { revision: current.revision, languages: [...current.languages.values()] };
      const locale = input.params.languageId,
        language = current.languages.get(locale);
      if (!language) languageMissing();
      const data = await catalog(tx, locale);
      return {
        languageId: locale,
        languageInfo: language,
        revision: data.revision,
        translations: data.messages.map((m) => ({ message_id: m.id, message_str: m.text })),
        hasTranslationData: data.messages.some((m) => !!m.text),
        hasNoTranslationData: data.messages.some((m) => !m.text),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  return serviceResult({ reaction: 1, message: '', data: result }, { status: 200, format: 'json' });
}
export async function mutate(
  input: ServiceContext,
  action: 'create' | 'update' | 'delete' | 'message',
) {
  const rawKey = input.headers['idempotency-key'];
  if (typeof rawKey !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(rawKey))
    throw new ApiError(400, 'IDEMPOTENCY_REQUIRED', 'A valid Idempotency-Key is required');
  const key = `legacy-translation:${input.identity!.userId}:${rawKey}`,
    hash = digest(JSON.stringify(canonical({ action, params: input.params, body: input.body }))),
    body = input.body;
  const result = await db
    .$transaction(
      async (tx) => {
        await authorizeTranslations(tx, input);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('whalexy:translations',0))`;
        // Translation writes are global and the replay record is tied to this administrator.
        const replay = await tx.configurations.findMany({ where: { name: key }, take: 2 });
        if (replay.length > 1)
          throw new ApiError(
            409,
            'TRANSLATION_REVIEW_REQUIRED',
            'Duplicate replay records require reconciliation',
          );
        if (replay.length) {
          let stored: any;
          try {
            stored = JSON.parse(replay[0].value ?? '');
          } catch {
            throw new ApiError(409, 'TRANSLATION_REVIEW_REQUIRED', 'Invalid replay record');
          }
          if (stored.hash !== hash)
            throw new ApiError(
              409,
              'IDEMPOTENCY_CONFLICT',
              'Key was used for a different translation action',
            );
          if (stored.nativeVersion !== 1 || !stored.response || stored.response.reaction !== 1)
            throw new ApiError(409, 'TRANSLATION_REVIEW_REQUIRED', 'Invalid replay response');
          return stored.response;
        }
        let data: unknown;
        if (action === 'create')
          data = await createLanguageTransaction(tx, {
            ...input,
            body: { locale: body.language_id, name: body.language_name, isRtl: body.is_rtl },
          });
        else if (action === 'update')
          data = await updateLanguageTransaction(tx, {
            ...input,
            params: { locale: body.locale },
            body,
          });
        else if (action === 'delete') {
          await deleteLanguageTransaction(tx, {
            ...input,
            params: { locale: input.params.languageId },
            body,
          });
          data = { languageId: input.params.languageId };
        } else {
          const current = await registry(tx),
            locale = body.language_id;
          if (!current.languages.has(locale)) languageMissing();
          const existing = await catalog(tx, locale);
          if (existing.revision !== body.revision) stale();
          if (!existing.messages.some((m) => m.id === body.message_id))
            throw new ApiError(
              404,
              'MESSAGE_NOT_FOUND',
              'Import or reconcile this source message before updating it',
            );
          const updated = await saveCatalogTransaction(
            tx,
            locale,
            body.revision,
            existing.messages.map((m) =>
              m.id === body.message_id ? { id: m.id, text: body.message_str ?? '' } : m,
            ),
            input.identity!.userId,
          );
          data = {
            languageId: locale,
            revision: updated.revision,
            message_id: body.message_id,
            message_str: body.message_str ?? '',
          };
        }
        const response = {
          reaction: 1,
          message:
            action === 'message'
              ? body.message_str
                ? 'Translation updated successfully'
                : 'Translation has been cleared'
              : `Language ${action === 'create' ? 'created' : action === 'update' ? 'updated' : 'deleted'}`,
          data,
          show_message: true,
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
          'TRANSLATION_CONFLICT',
          'Translations changed; retry the same idempotent request',
        );
      throw error;
    });
  return serviceResult(result, { status: 200, format: 'json' });
}
