import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
if (fs.existsSync('src/modules/auth/auth.service.ts')) throw new Error('Historical one-time extraction tool: this workspace is already refactored. See docs/ARCHITECTURE.md.');

const root = process.cwd(), src = path.join(root, 'src'), printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
const f = ts.factory;
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const list = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? list(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []);
const movedGuards = new Map();
for (const file of list(path.join(src, 'modules')).filter(p => p.endsWith('.controller.ts'))) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true), guards = [], keep = [], names = new Set();
  for (const node of source.statements) {
    if (ts.isVariableStatement(node) && node.declarationList.declarations.length === 1) {
      const decl = node.declarationList.declarations[0];
      if (ts.isArrowFunction(decl.initializer) && decl.initializer.parameters.length >= 3) { guards.push(node); names.add(decl.name.getText(source)); continue; }
    }
    keep.push(node);
  }
  if (!guards.length) continue;
  const middleware = file.replace('.controller.ts', '.middleware.ts'); movedGuards.set(file, { middleware, names });
  const imports = source.statements.filter(ts.isImportDeclaration);
  write(middleware, [...imports, ...guards].map(n => printer.printNode(ts.EmitHint.Unspecified, n, source)).join('\n') + '\n');
  write(file, keep.map(n => printer.printNode(ts.EmitHint.Unspecified, n, source)).join('\n') + '\n');
}
const mappings = new Map();
const add = (old, target) => mappings.set(path.join(src, old), path.join(src, target));
add('config.ts', 'config/environment.ts'); add('types.ts', 'types/http.ts'); add('jobs.ts', 'jobs/dispatcher.ts');
add('lib/db.ts', 'database/client.ts'); add('lib/logger.ts', 'observability/logger.ts');
add('lib/crypto.ts', 'utils/crypto.ts'); add('lib/passwords.ts', 'utils/passwords.ts');
add('lib/providers.ts', 'infrastructure/providers/meta.client.ts'); add('lib/stripe.ts', 'infrastructure/providers/stripe.client.ts');
const libraries = {
  'ads-manager': ['ad-attribution', 'ad-insights', 'ad-structure'],
  'bot-flows': ['bot-catalog', 'bot-graph', 'bot-graph-runtime', 'bot-meta-flow', 'bot-question', 'bot-template', 'bot-timing'],
  'contacts': ['contact-values', 'contact-csv', 'conversation-resolution'],
  'comment-automations': ['comment-events'], 'catalogs': ['catalog-content'],
  'content': ['article-content'], 'configuration': ['site-settings'],
  'meta-flows': ['flow-encryption', 'meta-flow-message'], 'handoffs': ['handoffs'],
  'messaging': ['interactive-message', 'media-message', 'reactions', 'whatsapp'],
  'sheets': ['sheet-script'], 'translations': ['translations'],
};
for (const [domain, files] of Object.entries(libraries)) for (const name of files) add(`lib/${name}.ts`, `modules/${domain}/services/${name}.ts`);
for (const name of ['rich-template', 'sheet-template', 'template-values']) add(`lib/${name}.ts`, `shared/templates/${name}.ts`);
add('lib/meta-operations.ts', 'infrastructure/providers/meta-operations.ts');
const records = list(src).map(file => ({ original: file, target: mappings.get(file) ?? file, text: fs.readFileSync(file, 'utf8') }));
const oldErrors = path.join(src, 'lib/errors.ts'), source = ts.createSourceFile(oldErrors, fs.readFileSync(oldErrors, 'utf8'), ts.ScriptTarget.Latest, true);
const errorClass = source.statements.find(ts.isClassDeclaration);
write(path.join(src, 'shared/api-error.ts'), printer.printNode(ts.EmitHint.Unspecified, errorClass, source) + '\n');
records.push({ original: oldErrors, target: path.join(src, 'middleware/error-handler.ts'), text: `import { ApiError } from '../shared/api-error.js';\n` + source.statements.filter(n => n !== errorClass).map(n => printer.printNode(ts.EmitHint.Unspecified, n, source)).join('\n') });
mappings.set(oldErrors, path.join(src, 'shared/api-error.ts'));
function relative(from, target) { let result = path.relative(path.dirname(from), target).replaceAll('\\', '/').replace(/\.ts$/, '.js'); return result.startsWith('.') ? result : './' + result; }
for (const record of records) {
  if (record.original === oldErrors && record.target === oldErrors) continue;
  const source = ts.createSourceFile(record.original, record.text, ts.ScriptTarget.Latest, true);
  const transform = ts.transform(source, [context => {
    const visit = node => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.startsWith('.')) {
        const original = path.resolve(path.dirname(record.original), node.moduleSpecifier.text.replace(/\.js$/, '.ts'));
        const named = ts.isImportDeclaration(node) ? node.importClause?.namedBindings : node.exportClause;
        if (named && (ts.isNamedImports(named) || ts.isNamedExports(named))) {
          const groups = new Map();
          for (const specifier of named.elements) {
            const name = (specifier.propertyName ?? specifier.name).text;
            let target = mappings.get(original) ?? original;
            if (original === oldErrors && name === 'errorHandler') target = path.join(src, 'middleware/error-handler.ts');
            if (original === path.join(src, 'middleware/auth.ts') && name === 'can') target = path.join(src, 'shared/access-policy.ts');
            if (movedGuards.get(original)?.names.has(name)) target = movedGuards.get(original).middleware;
            const entries = groups.get(target) ?? []; entries.push(specifier); groups.set(target, entries);
          }
          return [...groups].map(([target, elements]) => ts.isImportDeclaration(node)
            ? f.updateImportDeclaration(node, node.modifiers, f.updateImportClause(node.importClause, node.importClause.isTypeOnly, node.importClause.name, f.updateNamedImports(named, elements)), f.createStringLiteral(relative(record.target, target)), node.attributes)
            : f.updateExportDeclaration(node, node.modifiers, node.isTypeOnly, f.updateNamedExports(named, elements), f.createStringLiteral(relative(record.target, target)), node.attributes));
        }
        const target = mappings.get(original) ?? original;
        const value = f.createStringLiteral(relative(record.target, target));
        return ts.isImportDeclaration(node) ? f.updateImportDeclaration(node, node.modifiers, node.importClause, value, node.attributes) : f.updateExportDeclaration(node, node.modifiers, node.isTypeOnly, node.exportClause, value, node.attributes);
      }
      if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'controllers') {
        const importNode = source.statements.find(n => ts.isImportDeclaration(n) && n.importClause?.namedBindings && ts.isNamespaceImport(n.importClause.namedBindings) && n.importClause.namedBindings.name.text === 'controllers');
        if (importNode) { const target = path.resolve(path.dirname(record.original), importNode.moduleSpecifier.text.replace(/\.js$/, '.ts')); if (movedGuards.get(target)?.names.has(node.name.text)) return f.updatePropertyAccessExpression(node, f.createIdentifier('middleware'), node.name); }
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text.startsWith('.')) {
        const original = path.resolve(path.dirname(record.original), node.arguments[0].text.replace(/\.js$/, '.ts'));
        return f.updateCallExpression(node, node.expression, node.typeArguments, [f.createStringLiteral(relative(record.target, mappings.get(original) ?? original))]);
      }
      return ts.visitEachChild(node, visit, context);
    }; return root => ts.visitNode(root, visit);
  }]);
  let text = printer.printFile(transform.transformed[0]); transform.dispose();
  if (text.includes('middleware.')) {
    const guardEntry = [...movedGuards].find(([file]) => path.dirname(file) === path.dirname(record.original));
    if (guardEntry) text = `import * as middleware from '${relative(record.target, guardEntry[1].middleware)}';\n` + text;
  }
  const sf = ts.createSourceFile(record.target, text, ts.ScriptTarget.Latest, true), used = new Set();
  const walk = n => { if (ts.isIdentifier(n) && !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n)) used.add(n.text); ts.forEachChild(n, walk); };
  for (const node of sf.statements) if (!ts.isImportDeclaration(node)) walk(node);
  text = sf.statements.map(node => {
    if (!ts.isImportDeclaration(node) || !node.importClause) return printer.printNode(ts.EmitHint.Unspecified, node, sf);
    const clause = node.importClause, name = clause.name && used.has(clause.name.text) ? clause.name : undefined; let bindings = clause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) { const elements = bindings.elements.filter(e => used.has(e.name.text)); bindings = elements.length ? f.updateNamedImports(bindings, elements) : undefined; }
    else if (bindings && !used.has(bindings.name.text)) bindings = undefined;
    if (!name && !bindings) return '';
    return printer.printNode(ts.EmitHint.Unspecified, f.updateImportDeclaration(node, node.modifiers, f.updateImportClause(clause, clause.isTypeOnly, name, bindings), node.moduleSpecifier, node.attributes), sf);
  }).filter(Boolean).join('\n');
  write(record.target, text + '\n');
}
for (const [old, target] of mappings) write(old, old === oldErrors ? `// Compatibility exports.\nexport { ApiError } from '../shared/api-error.js';\nexport { errorHandler } from '../middleware/error-handler.js';\n` : `// Compatibility export; use the canonical module in new code.\nexport * from '${relative(old, target)}';\n`);
console.log(JSON.stringify({ relocatedFiles: mappings.size, featureMiddlewareFiles: movedGuards.size }));
