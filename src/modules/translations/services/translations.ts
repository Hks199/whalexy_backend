import Joi from 'joi';
import * as gettext from 'gettext-parser';
import { ApiError } from '../../../shared/api-error.js';

export type TranslationMessage = {
  id: string;
  text: string;
};
export const messagesSchema = Joi.array()
  .items(
    Joi.object({
      id: Joi.string().min(1).max(4000).required(),
      text: Joi.string().max(8000).allow('').required(),
    }),
  )
  .unique('id')
  .max(10000)
  .required();
export function localeId(input: string) {
  if (!/^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8}){0,3}$/.test(input))
    throw new ApiError(400, 'INVALID_LOCALE', 'Invalid locale');
  try {
    return Intl.getCanonicalLocales(input.replaceAll('_', '-'))[0]!.replaceAll('-', '_');
  } catch {
    throw new ApiError(400, 'INVALID_LOCALE', 'Invalid locale');
  }
}
function placeholders(text: string) {
  const named = [...text.matchAll(/(?<![\w:]):[A-Za-z_]\w*|\{[A-Za-z_]\w*\}/g)]
    .map((m) => m[0])
    .sort();
  // Literal %% is ignored. Unnumbered printf parameters must retain their order and type.
  const printf = [
    ...text
      .replaceAll('%%', '')
      .matchAll(/%(?:\d+\$)?[-+0#]*(?:\d+|\*)?(?:\.(?:\d+|\*))?[bcdeEfFgGosuxX]/g),
  ].map((m) => m[0]);
  const positional = printf.filter((p) => /^%\d+\$/.test(p)).sort();
  return JSON.stringify([named, printf.filter((p) => !/^%\d+\$/.test(p)), positional]);
}
export function checkedMessages(input: unknown): TranslationMessage[] {
  const { value, error } = messagesSchema.validate(input, { convert: false, allowUnknown: false });
  if (error)
    throw new ApiError(400, 'INVALID_TRANSLATIONS', 'Invalid or duplicate translation entries');
  const messages = value as TranslationMessage[];
  if (Buffer.byteLength(JSON.stringify(messages), 'utf8') > 800000)
    throw new ApiError(400, 'CATALOG_TOO_LARGE', 'Translation catalog exceeds 800 KB');
  for (const message of messages) {
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(message.id + message.text))
      throw new ApiError(400, 'INVALID_TRANSLATIONS', 'Translation contains control characters');
    if (message.text && placeholders(message.id) !== placeholders(message.text))
      throw new ApiError(
        400,
        'TRANSLATION_PLACEHOLDERS',
        'Translation must preserve source placeholders',
      );
  }
  return messages.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
export function reviewPo(buffer: Buffer, locale: string) {
  let parsed: ReturnType<typeof gettext.po.parse>;
  try {
    parsed = gettext.po.parse(buffer, { validation: true });
  } catch {
    throw new ApiError(400, 'INVALID_PO', 'Invalid gettext PO file');
  }
  const header = Object.entries(parsed.headers).find(
    ([key]) => key.toLowerCase() === 'language',
  )?.[1];
  if (!header || localeId(header) !== locale)
    throw new ApiError(400, 'PO_LANGUAGE_MISMATCH', 'PO language must match the selected locale');
  const messages: TranslationMessage[] = [];
  const quarantined: {
    id: string;
    text: string;
    context: string;
    reason: string;
  }[] = [];
  for (const [context, entries] of Object.entries(parsed.translations)) {
    for (const entry of Object.values(entries)) {
      if (!entry.msgid) continue; // Headers are never published, including paths and translator identities.
      if (
        context ||
        entry.msgid_plural ||
        entry.msgstr.length !== 1 ||
        entry.comments?.flag?.split(',').some((f) => f.trim() === 'fuzzy')
      ) {
        quarantined.push({
          id: entry.msgid,
          text: entry.msgstr.join('\n'),
          context,
          reason: 'PO_REVIEW_REQUIRED',
        });
        continue;
      }
      try {
        messages.push(...checkedMessages([{ id: entry.msgid, text: entry.msgstr[0]! }]));
      } catch (error) {
        quarantined.push({
          id: entry.msgid,
          text: entry.msgstr[0]!,
          context,
          reason: error instanceof ApiError ? error.code : 'INVALID_TRANSLATIONS',
        });
      }
    }
  }
  if (
    parsed.obsolete &&
    Object.values(parsed.obsolete).some((entries) => Object.keys(entries).length)
  )
    throw new ApiError(400, 'PO_REVIEW_REQUIRED', 'Obsolete entries require reconciliation');
  return { messages: checkedMessages(messages), quarantined };
}
export function importPo(buffer: Buffer, locale: string) {
  const reviewed = reviewPo(buffer, locale);
  if (reviewed.quarantined.length)
    throw new ApiError(
      400,
      'PO_REVIEW_REQUIRED',
      'PO entries require reconciliation before publication',
      { quarantinedEntries: reviewed.quarantined.length },
    );
  return reviewed.messages;
}
export function exportPo(messages: TranslationMessage[], locale: string) {
  const entries = Object.fromEntries(
    messages.map((message) => [message.id, { msgid: message.id, msgstr: [message.text] }]),
  );
  return gettext.po.compile(
    {
      charset: 'UTF-8',
      headers: { Language: locale, 'Content-Type': 'text/plain; charset=UTF-8' },
      translations: { '': { '': { msgid: '', msgstr: [''] }, ...entries } },
    },
    { sort: true },
  );
}
