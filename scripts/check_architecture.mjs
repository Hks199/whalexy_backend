import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const src = path.join(root, 'src');
const walk = (directory) =>
  fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? walk(path.join(directory, entry.name))
        : entry.name.endsWith('.ts')
          ? [path.join(directory, entry.name)]
          : [],
    );
const files = walk(src);
const failures = [];
const dependencies = new Map();
const relative = (file) => path.relative(root, file).replaceAll('\\', '/');
const shims = new Set(
  files.filter((file) => {
    const name = relative(file);
    return /^src\/(?:lib\/[^/]+|modules\/[^/]+|config|jobs|types)\.ts$/.test(name);
  }),
);

for (const file of files) {
  const name = relative(file);
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  dependencies.set(
    file,
    source.statements
      .filter(
        (node) =>
          ts.isImportDeclaration(node) &&
          node.moduleSpecifier.text.startsWith('.') &&
          !node.importClause?.isTypeOnly,
      )
      .map((node) =>
        path.resolve(path.dirname(file), node.moduleSpecifier.text.replace(/\.js$/, '.ts')),
      ),
  );
  const fail = (message) => failures.push(`${name}: ${message}`);
  if (shims.has(file)) {
    fail('duplicate legacy entry files are not allowed; keep one implementation path per module');
    continue;
  }
  const service = name.endsWith('.service.ts') || /\/services\//.test(name);
  const controller = name.endsWith('.controller.ts');
  const routes = name.endsWith('.routes.ts') || name === 'src/routes/index.ts';
  const validation = name.endsWith('.validation.ts') || name.startsWith('src/validation/');
  function inspect(node) {
    if (
      (controller || service) &&
      ((ts.isFunctionDeclaration(node) && ts.isSourceFile(node.parent)) ||
        (ts.isVariableDeclaration(node) && ts.isSourceFile(node.parent.parent.parent))) &&
      node.name &&
      /^(get|post|put|patch|delete)(?:\d+|Service)?$/.test(node.name.getText(source))
    )
      fail('name operations by their purpose, such as listContacts or createCampaign');
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const specifier = node.moduleSpecifier.text;
      const target = specifier.startsWith('.')
        ? path.resolve(path.dirname(file), specifier.replace(/\.js$/, '.ts'))
        : null;
      if (target && shims.has(target))
        fail(`use the canonical implementation instead of ${specifier}`);
      if (target && !fs.existsSync(target)) fail(`unresolved local implementation: ${specifier}`);
      if ((controller || routes) && /database\/client/.test(specifier))
        fail('database access belongs in a service');
      if (routes && specifier === 'joi') fail('schema construction belongs in a validation file');
      if (
        service &&
        (specifier === 'express' ||
          specifier === 'multer' ||
          /(?:\.routes|\.controller|\.middleware)\.js$|\/middleware\//.test(specifier))
      )
        fail(`services cannot depend on HTTP transport: ${specifier}`);
      if (
        validation &&
        /(?:\.service|\.controller|\.middleware)\.js$|\/database\/|\/middleware\//.test(specifier)
      )
        fail(`validation must stay independent of application and HTTP handlers: ${specifier}`);
    }
    if (
      ts.isNewExpression(node) &&
      node.expression.getText(source) === 'PrismaClient' &&
      name !== 'src/database/client.ts'
    )
      fail('PrismaClient must be created only by database/client.ts');
    if (
      routes &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      /^(get|post|put|patch|delete|all|use)$/.test(node.expression.name.text)
    ) {
      if (
        node.arguments.some(
          (argument) => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument),
        )
      )
        fail('route handlers must be named controllers or middleware');
    }
    if (
      service &&
      ts.isVoidExpression(node) &&
      ts.isCallExpression(node.expression) &&
      node.expression.expression.getText(source) === 'serviceResult'
    )
      fail('do not discard a service response');
    ts.forEachChild(node, inspect);
  }
  inspect(source);
}

const visiting = [];
const visited = new Set();
function checkCycles(file) {
  if (visiting.includes(file)) {
    failures.push(
      `Runtime import cycle: ${visiting.slice(visiting.indexOf(file)).concat(file).map(relative).join(' -> ')}`,
    );
    return;
  }
  if (visited.has(file)) return;
  visiting.push(file);
  for (const dependency of dependencies.get(file) ?? []) checkCycles(dependency);
  visiting.pop();
  visited.add(file);
}
for (const file of files) checkCycles(file);

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(
    `Architecture checks passed for ${files.length} TypeScript files; no duplicate legacy entry files.`,
  );
}
