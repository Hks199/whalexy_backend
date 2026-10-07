import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const modules = path.join(root, 'src/modules');
const parse = (file) =>
  ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
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
const link = (from, to) => path.relative(from, to).replaceAll('\\', '/');
const features = fs
  .readdirSync(modules, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const tests = walk(path.join(root, 'tests')).filter((file) => file.endsWith('.test.ts'));
const mounts = [];
for (const name of ['index.ts', 'vendor.routes.ts']) {
  const source = parse(path.join(root, 'src/routes', name));
  const imported = new Map();
  for (const node of source.statements) {
    if (!ts.isImportDeclaration(node)) continue;
    const feature = node.moduleSpecifier.text.match(/modules\/([^/]+)\//)?.[1];
    if (
      feature &&
      node.importClause?.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings)
    ) {
      for (const entry of node.importClause.namedBindings.elements)
        imported.set(entry.name.text, feature);
    }
  }
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'use' &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      for (const argument of node.arguments.slice(1)) {
        const symbol = ts.isIdentifier(argument)
          ? argument.text
          : ts.isCallExpression(argument) && ts.isIdentifier(argument.expression)
            ? argument.expression.text
            : null;
        const feature = imported.get(symbol);
        if (feature)
          mounts.push({
            feature,
            router: symbol,
            prefix:
              (name === 'vendor.routes.ts' ? '/api/v1/vendors/:vendorId' : '') +
              node.arguments[0].text,
          });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

const index = [
  '# Feature index',
  '',
  'Start with the feature that owns the URL or background workflow. Each feature guide lists its route prefixes, controllers, service files and related tests.',
  '',
  'See [Reading the code](READING_THE_CODE.md) for the request path and [Architecture](ARCHITECTURE.md) for layer responsibilities.',
  '',
  '| Feature | Route files | Service/workflow files | Guide |',
  '|---|---:|---:|---|',
];
for (const feature of features) {
  const directory = path.join(modules, feature);
  const files = walk(directory);
  const routes = files.filter((file) => file.endsWith('.routes.ts'));
  const controllers = files.filter((file) => file.endsWith('.controller.ts'));
  const services = files.filter(
    (file) =>
      file.endsWith('.service.ts') ||
      (file.includes(`${path.sep}services${path.sep}`) && !/\.(types|validation)\.ts$/.test(file)),
  );
  const schemas = files.filter((file) => file.endsWith('.validation.ts'));
  const middleware = files.filter((file) => file.endsWith('.middleware.ts'));
  const types = files.filter((file) => /\.(types|constants)\.ts$/.test(file));
  const mounted = mounts.filter((mount) => mount.feature === feature);
  const routeSegments = mounted.map((mount) =>
    mount.prefix
      .split('/')
      .filter((segment) => segment && !segment.startsWith(':'))
      .at(-1),
  );
  const related = tests.filter((file) => {
    const text = fs.readFileSync(file, 'utf8');
    const name = path.basename(file);
    return (
      text.includes(`/modules/${feature}/`) ||
      name === `${feature}.test.ts` ||
      name.startsWith(`${feature}-`) ||
      routeSegments.some((segment) => text.includes(`/${segment}`))
    );
  });
  const lines = [
    `# ${feature}`,
    '',
    'This feature folder contains its routes and business workflows. Follow a route to its named controller, then the explicit service import in that controller.',
    '',
  ];
  if (mounted.length) {
    lines.push('## Route prefixes', '', '| Router | Mounted prefix |', '|---|---|');
    for (const mount of mounted) lines.push(`| ${mount.router} | \`${mount.prefix}\` |`);
    lines.push('');
  }
  lines.push('## Files to read', '');
  for (const [label, entries] of [
    ['Routes', routes],
    ['Controllers', controllers],
    ['Validation', schemas],
    ['Middleware', middleware],
    ['Types and constants', types],
    ['Services and domain helpers', services],
  ]) {
    if (!entries.length) continue;
    lines.push(`### ${label}`, '');
    for (const file of entries.sort())
      lines.push(`- [${link(directory, file)}](${link(directory, file)})`);
    lines.push('');
  }
  if (routes.length) {
    lines.push(
      '## Route declarations',
      '',
      'Paths below are relative to the router’s mounted prefix. Templates containing `${...}` are expanded by loops in the route file.',
      '',
      '| Router | Method | Relative path | Controller |',
      '|---|---|---|---|',
    );
    for (const file of routes) {
      const source = parse(file);
      const namespaces = new Set(
        source.statements
          .filter(ts.isImportDeclaration)
          .filter(
            (node) =>
              node.moduleSpecifier.text.endsWith('.controller.js') &&
              node.importClause?.namedBindings &&
              ts.isNamespaceImport(node.importClause.namedBindings),
          )
          .map((node) => node.importClause.namedBindings.name.text),
      );
      const namedControllers = new Set(
        source.statements
          .filter(ts.isImportDeclaration)
          .filter(
            (node) =>
              node.moduleSpecifier.text.endsWith('.controller.js') &&
              node.importClause?.namedBindings &&
              ts.isNamedImports(node.importClause.namedBindings),
          )
          .flatMap((node) =>
            node.importClause.namedBindings.elements.map((entry) => entry.name.text),
          ),
      );
      function visit(node) {
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          /^(get|post|put|patch|delete|all)$/.test(node.expression.name.text) &&
          node.arguments.length > 1
        ) {
          const handlers = node.arguments
            .slice(1)
            .map((argument) => (ts.isCallExpression(argument) ? argument.expression : argument))
            .filter(
              (argument) =>
                (ts.isPropertyAccessExpression(argument) &&
                  namespaces.has(argument.expression.getText(source))) ||
                (ts.isIdentifier(argument) && namedControllers.has(argument.text)),
            );
          if (handlers.length) {
            const routePath = ts.isStringLiteral(node.arguments[0])
              ? node.arguments[0].text
              : node.arguments[0].getText(source).replace(/^`|`$/g, '');
            lines.push(
              `| ${node.expression.expression.getText(source)} | ${node.expression.name.text.toUpperCase()} | \`${routePath.replaceAll('|', '\\|')}\` | ${handlers.map((handler) => (ts.isIdentifier(handler) ? handler.text : handler.name.text)).join(', ')} |`,
            );
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
    lines.push('');
  } else {
    lines.push(
      'This feature exposes application or background operations rather than its own HTTP router. Find its callers through the named exports in the service files.',
      '',
    );
  }
  if (related.length) {
    lines.push('## Behavior tests', '');
    for (const file of related.sort())
      lines.push(`- [${path.basename(file)}](${link(directory, file)})`);
    lines.push('');
  }
  lines.push(
    'Run `npm run docs:structure` after moving feature files or changing route declarations to refresh this guide.',
    '',
  );
  fs.writeFileSync(path.join(directory, 'README.md'), lines.join('\n'));
  index.push(
    `| ${feature} | ${routes.length} | ${services.length} | [Open feature](../src/modules/${feature}/README.md) |`,
  );
}
fs.writeFileSync(path.join(root, 'docs/FEATURE_INDEX.md'), index.join('\n') + '\n');
console.log(`Updated the feature index and ${features.length} feature reading guides.`);
