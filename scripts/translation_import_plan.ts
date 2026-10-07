import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { reviewPo, checkedMessages, exportPo, importPo } from '../src/modules/translations/services/translations.js';

// Read-only source inspection; this command never connects to a database or publishes translations.
const source = '../whalexy/locale/pt_BR/LC_MESSAGES/messages.po', buffer = readFileSync(source);
const review = reviewPo(buffer, 'pt_BR');
const sourceSha256 = createHash('sha256').update(buffer).digest('hex');
// These are reviewed source-copy corrections, never edits to the Laravel catalog.
if (sourceSha256 !== '9bb3db36f632fc08d5b409c5b6a340a3f0bcf23f9d2e5e47317ef5423a6f495c') throw new Error('Original PO changed; review corrections before regenerating the import bundle');
const repairs = new Map([
  ['Assign content for {{__messageParameter__}} variable', 'Atribuir conteúdo para a variável {{__messageParameter__}}'],
  ['Assign content for @{{__messageParameter__}} variable', 'Atribuir conteúdo para a variável @{{__messageParameter__}}'],
  ['Too many login attempts. Please try again in :seconds seconds.', 'Muitas tentativas de login. Por favor, tente novamente em :seconds segundos.'],
]);
if (review.quarantined.length !== repairs.size || review.quarantined.some(entry => entry.reason !== 'TRANSLATION_PLACEHOLDERS' || !repairs.has(entry.id))) throw new Error('Unexpected translation issues require reconciliation');
const converted = checkedMessages([...review.messages, ...review.quarantined.map(entry => ({ id: entry.id, text: repairs.get(entry.id)! }))]);
const output = 'migration/translation-import/pt_BR.po', prepared = exportPo(converted, 'pt_BR');
if (importPo(prepared, 'pt_BR').length !== converted.length) throw new Error('Prepared PO roundtrip failed');
mkdirSync('migration/translation-import', { recursive: true }); writeFileSync(output, prepared);
const report = { source, sourceSha256: createHash('sha256').update(buffer).digest('hex'), locale: 'pt_BR',
  sourceEntries: review.messages.length + review.quarantined.length, validEntries: review.messages.length,
  quarantinedEntries: review.quarantined.length, originalReadyForPublication: review.quarantined.length === 0, quarantined: review.quarantined,
  corrections: [...repairs].map(([id, text]) => ({ id, text })), convertedEntries: converted.length, convertedReadyForPublication: true, preparedFile: output,
  preparedSha256: createHash('sha256').update(prepared).digest('hex'), activated: false };
writeFileSync('migration/translation-import-plan.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ sourceEntries: report.sourceEntries, validEntries: report.validEntries, correctedEntries: report.corrections.length, convertedEntries: report.convertedEntries, convertedReadyForPublication: report.convertedReadyForPublication, activated: false }));
