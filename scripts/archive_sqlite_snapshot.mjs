// Reversible archive in a separate schema. The app never reads this schema.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
dotenv.config({ quiet: true });
const exported = spawnSync('python', ['scripts/sqlite_snapshot_export.py'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
if (exported.status !== 0) throw new Error('Read-only snapshot export failed');
const records = exported.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
const start = records[0], end = records.at(-1), rows = records.filter(record => record.kind === 'row');
if (start.kind !== 'start' || end.kind !== 'end' || start.sha256 !== end.sha256 || rows.length !== end.rows) throw new Error('Incomplete snapshot');
const schema = JSON.parse(readFileSync('migration/sqlite-schema-audit.json', 'utf8'));
if (schema.sha256 !== start.sha256) throw new Error('Reaudit the changed SQLite source first');
const db = new PrismaClient();
const sha = value => createHash('sha256').update(value).digest('hex');
try {
  await db.$transaction(async tx => {
    await tx.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS legacy_archive');
    await tx.$executeRawUnsafe('REVOKE ALL ON SCHEMA legacy_archive FROM PUBLIC');
    await tx.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS legacy_archive.snapshots (source_hash TEXT PRIMARY KEY, schema_metadata JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    await tx.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS legacy_archive.rows (source_hash TEXT NOT NULL REFERENCES legacy_archive.snapshots(source_hash), table_name TEXT NOT NULL, ordinal INTEGER NOT NULL, payload TEXT NOT NULL, row_hash TEXT NOT NULL, PRIMARY KEY (source_hash, table_name, ordinal))');
    await tx.$executeRaw`INSERT INTO legacy_archive.snapshots (source_hash, schema_metadata) VALUES (${start.sha256}, ${JSON.stringify(schema.tables)}::jsonb) ON CONFLICT DO NOTHING`;
    for (const row of rows) {
      if (sha(row.payload) !== row.rowHash) throw new Error('Invalid export row hash');
      await tx.$executeRaw`INSERT INTO legacy_archive.rows (source_hash, table_name, ordinal, payload, row_hash) VALUES (${start.sha256}, ${row.table}, ${row.ordinal}, ${row.payload}, ${row.rowHash}) ON CONFLICT DO NOTHING`;
    }
    const saved = await tx.$queryRaw`SELECT table_name, ordinal, payload, row_hash FROM legacy_archive.rows WHERE source_hash=${start.sha256} ORDER BY table_name, ordinal`;
    const expected = new Map(rows.map(row => [`${row.table}:${row.ordinal}`, row]));
    if (saved.length !== rows.length) throw new Error('Archive row count differs');
    for (const row of saved) {
      const original = expected.get(`${row.table_name}:${row.ordinal}`);
      if (!original || sha(row.payload) !== row.row_hash || row.row_hash !== original.rowHash) throw new Error('Archive verification failed');
    }
  }, { timeout: 60000 });
  const result = { sourceHash: start.sha256, sourcePreserved: true, sqliteTables: Object.keys(schema.tables).length, rowsArchivedAndHashVerified: rows.length, archiveSchema: 'legacy_archive', nativeApplicationDataImported: false, credentialsAndTokensActivated: false };
  writeFileSync('migration/sqlite-archive-verification.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await db.$disconnect(); }
