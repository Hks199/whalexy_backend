import { authorizeTranslations } from './services/translation-access.service.js';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { db } from '../../database/client.js';
import { digest } from '../../utils/crypto.js';
import { ApiError } from '../../shared/api-error.js';
import {
  localeId,
  checkedMessages,
  importPo,
  exportPo,
  type TranslationMessage,
} from './services/translations.js';
import { serviceResult, type ServiceContext } from '../../shared/service-context.js';

export type Language = {
  id: string;
  name: string;
  status: boolean;
  is_rtl: boolean;
  created_at?: string;
  updated_at?: string;
};
export const name = 'translation_languages';
export const prefix = 'native_translation_catalog:';
export const english: Language = { id: 'en', name: 'English', status: true, is_rtl: false };
export async function registry(tx: Prisma.TransactionClient = db) {
  const rows = await tx.configurations.findMany({ where: { name }, take: 2 });
  if (rows.length > 1)
    throw new ApiError(
      409,
      'TRANSLATION_REVIEW_REQUIRED',
      'Duplicate language configurations require reconciliation',
    );
  const row = rows[0],
    languages = new Map<string, Language>();
  if (row?.value) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.value);
    } catch {
      throw new ApiError(
        409,
        'TRANSLATION_REVIEW_REQUIRED',
        'Language configuration requires reconciliation',
      );
    }
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      Object.keys(parsed).length > 100
    )
      throw new ApiError(
        409,
        'TRANSLATION_REVIEW_REQUIRED',
        'Language configuration requires reconciliation',
      );
    for (const [key, item] of Object.entries(parsed)) {
      const value = item as any;
      let id: string;
      try {
        id = localeId(key);
      } catch {
        throw new ApiError(
          409,
          'TRANSLATION_REVIEW_REQUIRED',
          'Language configuration contains an invalid locale',
        );
      }
      if (
        languages.has(id) ||
        !value ||
        typeof value.name !== 'string' ||
        !value.name.trim() ||
        value.name.length > 80 ||
        typeof value.status !== 'boolean' ||
        typeof value.is_rtl !== 'boolean'
      ) {
        throw new ApiError(
          409,
          'TRANSLATION_REVIEW_REQUIRED',
          'Language configuration contains ambiguous or invalid entries',
        );
      }
      languages.set(id, {
        id,
        name: id === 'pt_BR' ? 'Português (Brasil)' : value.name,
        status: value.status,
        is_rtl: value.is_rtl,
        ...(typeof value.created_at === 'string' ? { created_at: value.created_at } : {}),
        ...(typeof value.updated_at === 'string' ? { updated_at: value.updated_at } : {}),
      });
    }
  }
  languages.set('en', english);
  return {
    row,
    languages,
    revision: digest(
      JSON.stringify([row?.uid ?? null, row?.updatedAt.toISOString() ?? null, [...languages]]),
    ),
  };
}
export async function catalog(tx: Prisma.TransactionClient, locale: string) {
  const rows = await tx.configurations.findMany({ where: { name: prefix + locale }, take: 2 });
  if (rows.length > 1)
    throw new ApiError(
      409,
      'TRANSLATION_REVIEW_REQUIRED',
      'Duplicate catalogs require reconciliation',
    );
  const row = rows[0];
  if (!row) return { row, revision: null, messages: [] as TranslationMessage[] };
  try {
    const data = JSON.parse(row.value ?? '');
    if (
      data.nativeVersion !== 1 ||
      typeof data.revision !== 'string' ||
      !/^[0-9a-f-]{36}$/.test(data.revision) ||
      data.locale !== locale
    )
      throw new Error();
    return { row, revision: data.revision as string, messages: checkedMessages(data.messages) };
  } catch {
    throw new ApiError(
      409,
      'TRANSLATION_REVIEW_REQUIRED',
      'Translation catalog requires reconciliation',
    );
  }
}
export async function writeRegistry(
  tx: Prisma.TransactionClient,
  current: Awaited<ReturnType<typeof registry>>,
) {
  const value = JSON.stringify(
    Object.fromEntries([...current.languages].filter(([id]) => id !== 'en')),
  );
  if (current.row)
    await tx.configurations.update({
      where: { id: current.row.id },
      data: { value, dataType: 4, updatedAt: new Date() },
    });
  else await tx.configurations.create({ data: { name, value, dataType: 4 } });
}
export async function locked<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('whalexy:translations',0))`;
      return work(tx);
    },
    { timeout: 15000 },
  );
}
export function languageMissing(): never {
  throw new ApiError(404, 'NOT_FOUND', 'Language not found');
}
export function stale(): never {
  throw new ApiError(409, 'TRANSLATION_CONFLICT', 'Translations changed; reload before saving');
}
export async function saveCatalogTransaction(
  tx: Prisma.TransactionClient,
  locale: string,
  expected: string | null,
  input: unknown,
  actorId: number,
) {
  const messages = checkedMessages(input);

  if (!(await registry(tx)).languages.has(locale)) languageMissing();
  const current = await catalog(tx, locale);
  if (current.revision !== expected) stale();
  const revision = randomUUID(),
    value = JSON.stringify({ nativeVersion: 1, locale, revision, messages });
  if (current.row)
    await tx.configurations.update({
      where: { id: current.row.id },
      data: { value, dataType: 4, updatedAt: new Date() },
    });
  else await tx.configurations.create({ data: { name: prefix + locale, value, dataType: 4 } });
  await tx.auditEvents.create({
    data: {
      actorId,
      action: 'replace',
      resource: 'translation-catalog',
      resourceId: locale,
      metadata: { entries: messages.length },
    },
  });
  return { locale, revision, messages };
}
export async function saveCatalog(
  locale: string,
  expected: string | null,
  input: unknown,
  actorId: number,
  context?: ServiceContext,
) {
  return locked(async (tx) => {
    if (context) await authorizeTranslations(tx, context);
    return saveCatalogTransaction(tx, locale, expected, input, actorId);
  });
}

export async function listPublicLanguages(requestInput: ServiceContext) {
  const current = await registry();
  // Imported registry entries alone never advertise a catalog as ready.
  const items: Language[] = [english];
  for (const lang of current.languages.values())
    if (lang.id !== 'en' && lang.status && (await catalog(db, lang.id)).row) items.push(lang);
  return serviceResult(
    {
      defaultLocale: 'en',
      items: items.map(({ id, name, is_rtl }) => ({ id, name, isRtl: is_rtl })),
    },
    { status: 200, format: 'json' },
  );
}
export async function getPublicLanguage(requestInput: ServiceContext) {
  const locale = localeId(String(requestInput.params.locale)),
    current = await registry(),
    lang = current.languages.get(locale);
  if (!lang?.status) languageMissing();
  const data = await catalog(db, locale);
  if (locale !== 'en' && !data.row) languageMissing();
  return serviceResult(
    {
      locale,
      name: lang.name,
      isRtl: lang.is_rtl,
      fallbackLocale: 'en',
      revision: data.revision,
      messages: data.messages.map((message) => ({
        id: message.id,
        text: message.text || message.id,
      })),
    },
    { status: 200, format: 'json' },
  );
}
export async function listAdminLanguages(requestInput: ServiceContext) {
  const current = await registry();
  return serviceResult(
    {
      revision: current.revision,
      items: [...current.languages.values()].map((lang) => ({
        ...lang,
        editable: lang.id !== 'en',
      })),
    },
    { status: 200, format: 'json' },
  );
}
export async function createLanguageTransaction(
  tx: Prisma.TransactionClient,
  requestInput: ServiceContext,
) {
  const locale = localeId(requestInput.body.locale);
  const languageName = locale === 'pt_BR' ? 'Português (Brasil)' : requestInput.body.name;
  await authorizeTranslations(tx, requestInput);

  const current = await registry(tx);
  if (current.languages.size >= 100)
    throw new ApiError(409, 'LANGUAGE_LIMIT', 'At most 100 languages are supported');
  if (
    current.languages.has(locale) ||
    [...current.languages.values()].some((l) => l.name.toLowerCase() === languageName.toLowerCase())
  )
    throw new ApiError(409, 'LANGUAGE_EXISTS', 'Locale or language name already exists');
  const at = new Date().toISOString();
  current.languages.set(locale, {
    id: locale,
    name: languageName,
    status: true,
    is_rtl: requestInput.body.isRtl,
    created_at: at,
    updated_at: at,
  });
  await writeRegistry(tx, current);
  await tx.auditEvents.create({
    data: {
      actorId: requestInput.identity!.userId,
      action: 'create',
      resource: 'translation-language',
      resourceId: locale,
    },
  });
  const updated = await registry(tx);
  return { language: updated.languages.get(locale), revision: updated.revision };
}
export async function createLanguage(requestInput: ServiceContext) {
  return serviceResult(await locked((tx) => createLanguageTransaction(tx, requestInput)), {
    status: 201,
    format: 'json',
  });
}

export async function updateLanguageTransaction(
  tx: Prisma.TransactionClient,
  requestInput: ServiceContext,
) {
  const locale = localeId(String(requestInput.params.locale));
  await authorizeTranslations(tx, requestInput);

  const current = await registry(tx),
    lang = current.languages.get(locale);
  if (!lang) languageMissing();
  if (locale === 'en')
    throw new ApiError(409, 'DEFAULT_LANGUAGE', 'English remains the default language');
  if (current.revision !== requestInput.body.revision) stale();
  if (
    requestInput.body.name &&
    [...current.languages.values()].some(
      (l) => l.id !== locale && l.name.toLowerCase() === requestInput.body.name.toLowerCase(),
    )
  )
    throw new ApiError(409, 'LANGUAGE_EXISTS', 'Language name already exists');
  current.languages.set(locale, {
    ...lang,
    name: locale === 'pt_BR' ? 'Português (Brasil)' : (requestInput.body.name ?? lang.name),
    status: requestInput.body.status ?? lang.status,
    is_rtl: requestInput.body.isRtl ?? lang.is_rtl,
    updated_at: new Date().toISOString(),
  });
  await writeRegistry(tx, current);
  await tx.auditEvents.create({
    data: {
      actorId: requestInput.identity!.userId,
      action: 'update',
      resource: 'translation-language',
      resourceId: locale,
    },
  });
  const updated = await registry(tx);
  return { language: updated.languages.get(locale), revision: updated.revision };
}
export async function updateLanguage(requestInput: ServiceContext) {
  return serviceResult(await locked((tx) => updateLanguageTransaction(tx, requestInput)), {
    status: 200,
    format: 'json',
  });
}

export async function deleteLanguageTransaction(
  tx: Prisma.TransactionClient,
  requestInput: ServiceContext,
) {
  const locale = localeId(String(requestInput.params.locale));
  await authorizeTranslations(tx, requestInput);

  const current = await registry(tx);
  if (!current.languages.has(locale)) languageMissing();
  if (locale === 'en')
    throw new ApiError(409, 'DEFAULT_LANGUAGE', 'English remains the default language');
  if (current.revision !== requestInput.body.revision) stale();
  current.languages.delete(locale);
  await writeRegistry(tx, current);
  await tx.configurations.deleteMany({ where: { name: prefix + locale } });
  await tx.auditEvents.create({
    data: {
      actorId: requestInput.identity!.userId,
      action: 'delete',
      resource: 'translation-language',
      resourceId: locale,
    },
  });
}
export async function deleteLanguage(requestInput: ServiceContext) {
  await locked((tx) => deleteLanguageTransaction(tx, requestInput));
  return serviceResult(undefined, { status: 204, format: 'empty' });
}

export async function getLanguageMessages(requestInput: ServiceContext) {
  const locale = localeId(String(requestInput.params.locale));
  if (!(await registry()).languages.has(locale)) languageMissing();
  const data = await catalog(db, locale);
  return serviceResult(
    { locale, revision: data.revision, messages: data.messages },
    { status: 200, format: 'json' },
  );
}
export async function updateLanguageMessages(requestInput: ServiceContext) {
  return serviceResult(
    await saveCatalog(
      localeId(String(requestInput.params.locale)),
      requestInput.body.revision,
      requestInput.body.messages,
      requestInput.identity!.userId,
      requestInput,
    ),
    { status: 200, format: 'json' },
  );
}
export async function importLanguagePo(requestInput: ServiceContext) {
  if (!requestInput.file) throw new ApiError(400, 'FILE_REQUIRED', 'Upload a gettext PO file');
  const locale = localeId(String(requestInput.params.locale)),
    messages = importPo(requestInput.file.buffer, locale);
  return serviceResult(
    await saveCatalog(
      locale,
      requestInput.body.revision || null,
      messages,
      requestInput.identity!.userId,
      requestInput,
    ),
    { status: 200, format: 'json' },
  );
}
export async function exportLanguagePo(requestInput: ServiceContext) {
  const locale = localeId(String(requestInput.params.locale));
  if (!(await registry()).languages.has(locale)) languageMissing();
  const data = await catalog(db, locale);
  return serviceResult(exportPo(data.messages, locale), {
    status: 200,
    format: 'send',
    contentType: 'text/plain; charset=utf-8',
    headers: { 'Content-Disposition': `attachment; filename="${locale}.po"` },
  });
}
