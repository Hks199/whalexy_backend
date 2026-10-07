import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';
dotenv.config({ quiet: true });
if (existsSync('prisma/migrations/202610020008_sqlite_schema_reconciliation/migration.sql')) throw new Error('The reconciliation migration already exists; never overwrite an applied migration.');
const reconciliation = JSON.parse(readFileSync('migration/sqlite-reconciliation.json', 'utf8'));
let temporary = readFileSync('prisma/schema.prisma', 'utf8');
for (const [table, columns] of Object.entries(reconciliation.renamedColumns)) {
  temporary = temporary.replace(/^model \w+\s*\{[\s\S]*?^\}/gm, block => {
    if (!block.includes(`@@map("${table}")`)) return block;
    for (const [old, current] of Object.entries(columns)) block = block.replace(`@map("${current}")`, `@map("${old}")`);
    return block;
  });
}
mkdirSync('.local', { recursive: true });
writeFileSync('.local/sqlite-additions.prisma', temporary);
const diff = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'diff', '--from-schema-datasource', 'prisma/schema.prisma', '--to-schema-datamodel', '.local/sqlite-additions.prisma', '--script'], { encoding: 'utf8', env: process.env });
if (diff.status !== 0) { process.stderr.write(diff.stderr); process.exit(diff.status ?? 1); }
if (/DROP TABLE|DROP COLUMN/i.test(diff.stdout)) throw new Error('Unexpected destructive migration; inspect the schema manually');
let sql = '-- SQLite metadata reconciliation: additions plus data-preserving column renames.\n' + diff.stdout;
for (const [table, columns] of Object.entries(reconciliation.renamedColumns)) for (const [old, current] of Object.entries(columns)) sql += `\nALTER TABLE "${table}" RENAME COLUMN "${old}" TO "${current}";\n`;
sql += '\nALTER INDEX "activity_logs_vendors__id_idx" RENAME TO "activity_logs_vendor_id_idx";\nALTER INDEX "subscriptions_vendor_id_idx" RENAME TO "subscriptions_vendor_model__id_idx";\n';
const directory = 'prisma/migrations/202610020008_sqlite_schema_reconciliation';
mkdirSync(directory, { recursive: true });
writeFileSync(`${directory}/migration.sql`, sql);
console.log('Generated additive migration with seven data-preserving column renames.');
