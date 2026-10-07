import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const output = path.resolve(root, 'dist');
if (path.dirname(output) !== root || path.basename(output) !== 'dist') {
  throw new Error('Build output must stay in the project dist directory');
}
// TypeScript does not remove output for deleted or relocated source files.
fs.rmSync(output, { recursive: true, force: true });
const result = spawnSync(
  process.execPath,
  [path.join(root, 'node_modules/typescript/lib/tsc.js'), '-p', path.join(root, 'tsconfig.json')],
  { cwd: root, stdio: 'inherit' },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
