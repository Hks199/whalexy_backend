// One-time, AST-based extraction. Kept for reviewing how source behavior was preserved.
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
if (fs.existsSync('src/modules/auth/auth.service.ts')) throw new Error('Historical one-time extraction tool: this workspace is already refactored. See docs/ARCHITECTURE.md.');

const root = process.cwd(), sourceRoot = path.join(root, 'src');
const backup = path.join(root, '.architecture-backup');
if (fs.existsSync(backup) && !process.argv.includes('--retry')) throw new Error('Backup exists; do not run this migration twice');
if (!fs.existsSync(backup)) { fs.mkdirSync(backup); fs.cpSync(sourceRoot, path.join(backup, 'src'), { recursive: true }); }
const inputRoot = path.join(backup, 'src');
const files = fs.readdirSync(path.join(sourceRoot, 'modules')).filter(f => f.endsWith('.ts'));
const program = ts.createProgram(files.map(f => path.join(inputRoot, 'modules', f)), { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true, esModuleInterop: true, skipLibCheck: true });
const checker = program.getTypeChecker(), printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }), f = ts.factory;
const report = [];
const write = (p, value) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, value, 'utf8'); };
const inside = (node, parent) => node.pos >= parent.pos && node.end <= parent.end;
const walk = (node, fn) => { fn(node); ts.forEachChild(node, n => walk(n, fn)); };
function references(node) { const names = new Set(); walk(node, n => { if (ts.isIdentifier(n) && !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n) && !(ts.isPropertyAssignment(n.parent) && n.parent.name === n) && !(ts.isPropertySignature(n.parent) && n.parent.name === n)) names.add(n.text); }); return names; }
function exported(node) { return node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword); }
function exportNode(node) {
  if (exported(node)) return node;
  return f.replaceModifiers(node, [f.createModifier(ts.SyntaxKind.ExportKeyword), ...(node.modifiers ?? [])]);
}
function captures(node, source) {
  const found = new Map();
  walk(node, n => {
    if (!ts.isIdentifier(n)) return;
    const symbol = ts.isShorthandPropertyAssignment(n.parent) ? checker.getShorthandAssignmentValueSymbol(n.parent) : checker.getSymbolAtLocation(n); let decl = symbol?.valueDeclaration;
    if (decl && ts.isBindingElement(decl)) { let parent = decl.parent; while (parent && !ts.isVariableDeclaration(parent)) parent = parent.parent; decl = parent; }
    if (!decl || decl.getSourceFile() !== source || inside(decl, node) || ts.isPropertyAssignment(decl) || ts.isPropertySignature(decl) || ts.isPropertyDeclaration(decl)) return;
    const statement = decl.parent?.parent;
    if (ts.isParameter(decl) || ts.isVariableDeclaration(decl) && !(ts.isVariableStatement(statement) && statement.parent === source)) found.set(n.text, checker.typeToString(checker.getTypeAtLocation(n)));
  });
  return [...found].filter(([name]) => !['req', 'res', '_req', '_res', 'next'].includes(name));
}
const camel = text => text.replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => c ? c.toUpperCase() : '').replace(/^([A-Z])/, c => c.toLowerCase());
function responseChain(node, responseName) {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return null;
  const name = node.expression.name.text;
  if (!['json', 'send', 'sendStatus', 'end'].includes(name)) return null;
  let cursor = node.expression.expression, status = name === 'sendStatus' ? node.arguments[0] : f.createNumericLiteral(200), contentType, headers = [];
  while (ts.isCallExpression(cursor) && ts.isPropertyAccessExpression(cursor.expression)) {
    const method = cursor.expression.name.text;
    if (method === 'status') status = cursor.arguments[0];
    else if (method === 'type') contentType = cursor.arguments[0];
    else if (method === 'set') headers.push(f.createPropertyAssignment(cursor.arguments[0], cursor.arguments[1]));
    else return null;
    cursor = cursor.expression.expression;
  }
  if (!ts.isIdentifier(cursor) || cursor.text !== responseName) return null;
  const options = [f.createPropertyAssignment('status', status), f.createPropertyAssignment('format', f.createStringLiteral(name === 'sendStatus' ? 'empty' : name)), ...(contentType ? [f.createPropertyAssignment('contentType', contentType)] : []), ...(headers.length ? [f.createPropertyAssignment('headers', f.createObjectLiteralExpression(headers))] : [])];
  return f.createCallExpression(f.createIdentifier('serviceResult'), undefined, [name === 'sendStatus' ? f.createIdentifier('undefined') : node.arguments[0] ?? f.createIdentifier('undefined'), f.createObjectLiteralExpression(options)]);
}
for (const file of files) {
  const source = program.getSourceFile(path.join(inputRoot, 'modules', file)), domain = file.slice(0, -3), directory = path.join(sourceRoot, 'modules', domain);
  const declarations = new Map(), publicNames = [], routeNames = new Set(), groups = { routes: [], controller: [], service: [], validation: [] }, originalImports = [];
  for (const node of source.statements) {
    if (ts.isImportDeclaration(node)) { originalImports.push(node); continue; }
    const parts = ts.isVariableStatement(node) ? node.declarationList.declarations.map(d => f.updateVariableStatement(node, node.modifiers, f.updateVariableDeclarationList(node.declarationList, [d]))) : [node];
    for (const part of parts) {
      const declaration = ts.isVariableStatement(part) ? part.declarationList.declarations[0] : part;
      const name = declaration.name && ts.isIdentifier(declaration.name) ? declaration.name.text : null;
      if (name) { declarations.set(name, part); if (exported(part)) publicNames.push(name); }
      if (name && ts.isVariableDeclaration(declaration) && declaration.initializer && references(declaration.initializer).has('Router')) routeNames.add(name);
      if (name && ts.isFunctionDeclaration(part) && /Router$/.test(name)) routeNames.add(name);
    }
  }
  walk(source, node => { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer) && ts.isIdentifier(node.initializer.expression) && node.initializer.expression.text === 'Router') routeNames.add(node.name.text); });
  const schemaNames = new Set([...declarations].filter(([name, node]) => !routeNames.has(name) && ts.isVariableStatement(node) && references(node).has('Joi')).map(([name]) => name));
  // Include local schema dependencies to prevent an initialization cycle.
  let changed = true;
  while (changed) { changed = false; for (const name of [...schemaNames]) for (const ref of references(declarations.get(name))) if (declarations.has(ref) && !schemaNames.has(ref) && !routeNames.has(ref)) { schemaNames.add(ref); changed = true; } }
  const allocations = new Map([...declarations].map(([name, node]) => [name, routeNames.has(name) ? 'routes' : schemaNames.has(name) ? 'validation' : ts.isFunctionDeclaration(node) && node.parameters.some(p => p.name.getText(source) === 'res') || references(node).has('RequestHandler') ? 'controller' : 'service']));
  let controllerCount = 0, serviceCount = 0, schemaCount = 0;
  const names = new Set(declarations.keys());
  const unique = base => { let name = base || 'handleRequest'; for (let i = 2; names.has(name); i++) name = `${base}${i}`; names.add(name); return name; };
  function params(captured) { return captured.map(([name, type]) => `${name}: ${type.includes('import(') ? 'any' : type}`).join(', '); }
  function plainRequest(text) { return text.replace(/:\s*(?:Express\.)?Request\b/g, ': ServiceContext').replace(/\b(req|requestInput|_req)\.get\(([^)]+)\)/g, 'headerValue($1.headers, $2)'); }
  const transformResult = ts.transform(source, [context => {
    const visit = node => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && routeNames.has(node.expression.expression.text) && ['get', 'post', 'patch', 'put', 'delete', 'use', 'param'].includes(node.expression.name.text)) {
        const method = node.expression.name.text, route = node.arguments[0]?.getText(source) ?? 'middleware';
        const base = camel(`${method} ${route.replace(/["'`]/g, '').replace(/\$/g, '')}`) || `${method}Root`;
        const args = node.arguments.map((arg, index) => {
          if (ts.isCallExpression(arg) && ts.isIdentifier(arg.expression) && arg.expression.text === 'validate' && arg.arguments[0]) {
            const location = camel(arg.arguments[1]?.getText(source) ?? 'body');
            const schemaName = unique(`${base}${location.charAt(0).toUpperCase() + location.slice(1)}Schema`), captured = captures(arg.arguments[0], source);
            const expression = printer.printNode(ts.EmitHint.Expression, arg.arguments[0], source);
            groups.validation.push(captured.length ? `export const ${schemaName} = (${params(captured)}) => (${expression});` : `export const ${schemaName} = ${expression};`);
            allocations.set(schemaName, 'validation'); schemaCount++;
            return f.updateCallExpression(arg, arg.expression, arg.typeArguments, [captured.length ? f.createCallExpression(f.createIdentifier(schemaName), undefined, captured.map(([n]) => f.createIdentifier(n))) : f.createIdentifier(schemaName), ...arg.arguments.slice(1)]);
          }
          if (!ts.isArrowFunction(arg) && !ts.isFunctionExpression(arg)) return arg;
          const handlerName = unique(base + (method === 'use' ? 'Middleware' : '')), captured = captures(arg, source), reqName = arg.parameters[0]?.name.getText(source), resName = arg.parameters[1]?.name.getText(source);
          const bodyText = arg.body.getText(source);
          let canSeparate = arg.parameters.length === 2 && !!reqName && !!resName, sawReply = false;
          walk(arg.body, n => { if (ts.isIdentifier(n) && n.text === resName) {
            let parent = n.parent;
            if (ts.isPropertyAccessExpression(parent) && parent.name.text === 'locals') return;
            while (parent && (ts.isPropertyAccessExpression(parent) || ts.isCallExpression(parent))) { if (responseChain(parent, resName)) { sawReply = true; return; } parent = parent.parent; }
            canSeparate = false;
          } });
          if (canSeparate && sawReply) {
            const serviceName = unique(`${handlerName}Service`);
            const transformed = ts.transform(arg.body, [ctx => {
              const visitor = n => {
                if (ts.isExpressionStatement(n)) { const reply = responseChain(n.expression, resName); if (reply) return f.createReturnStatement(ts.visitNode(reply, visitor)); }
                if (ts.isReturnStatement(n) && n.expression) { const reply = responseChain(n.expression, resName); if (reply) return f.updateReturnStatement(n, ts.visitNode(reply, visitor)); }
                const reply = responseChain(n, resName); if (reply) return ts.visitNode(reply, visitor);
                if (ts.isPropertyAccessExpression(n) && n.name.text === 'query' && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'locals' && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === resName) return f.createPropertyAccessExpression(f.createIdentifier('requestInput'), 'validatedQuery');
                if (ts.isPropertyAccessExpression(n) && n.name.text === 'locals' && ts.isIdentifier(n.expression) && n.expression.text === resName) return f.createPropertyAccessExpression(f.createIdentifier('requestInput'), 'metadata');
                if (ts.isShorthandPropertyAssignment(n) && n.name.text === reqName) return f.createPropertyAssignment(reqName, f.createIdentifier('requestInput'));
                if (ts.isIdentifier(n) && n.text === reqName) return f.createIdentifier('requestInput');
                return ts.visitEachChild(n, visitor, ctx);
              }; return root => ts.visitNode(root, visitor);
            }]);
            let body = printer.printNode(ts.isBlock(arg.body) ? ts.EmitHint.Unspecified : ts.EmitHint.Expression, transformed.transformed[0], source); transformed.dispose();
            if (!ts.isBlock(arg.body)) body = `{ return ${body}; }`;
            groups.service.push(`export async function ${serviceName}(requestInput: ServiceContext${captured.length ? ', ' + params(captured) : ''}) ${plainRequest(body)}`);
            allocations.set(serviceName, 'service'); serviceCount++;
            const call = `sendResult(res, await services.${serviceName}(serviceContext(req, res)${captured.length ? ', ' + captured.map(([n]) => n).join(', ') : ''}));`;
            groups.controller.push(`export const ${handlerName}${captured.length ? ` = (${params(captured)}): RequestHandler =>` : ': RequestHandler ='} async (req, res) => { ${call} };`);
          } else {
            const arrow = printer.printNode(ts.EmitHint.Expression, arg, source);
            groups.controller.push(`export const ${handlerName}${captured.length ? ` = (${params(captured)}): ${method === 'param' ? 'RequestParamHandler' : 'RequestHandler'} =>` : `: ${method === 'param' ? 'RequestParamHandler' : 'RequestHandler'} =`} ${arrow};`);
          }
          allocations.set(handlerName, 'controller'); controllerCount++;
          return captured.length ? f.createCallExpression(f.createPropertyAccessExpression(f.createIdentifier('controllers'), handlerName), undefined, captured.map(([n]) => f.createIdentifier(n))) : f.createPropertyAccessExpression(f.createIdentifier('controllers'), handlerName);
        });
        return f.updateCallExpression(node, node.expression, node.typeArguments, args);
      }
      return ts.visitEachChild(node, visit, context);
    }; return node => ts.visitNode(node, visit);
  }]);
  const transformedSource = transformResult.transformed[0], originalGroups = { routes: [], controller: [], service: [], validation: [] };
  for (const node of transformedSource.statements) {
    if (ts.isImportDeclaration(node)) continue;
    const parts = ts.isVariableStatement(node) ? node.declarationList.declarations.map(d => f.updateVariableStatement(node, node.modifiers, f.updateVariableDeclarationList(node.declarationList, [d]))) : [node];
    for (const part of parts) {
      const declaration = ts.isVariableStatement(part) ? part.declarationList.declarations[0] : part, name = declaration.name && ts.isIdentifier(declaration.name) ? declaration.name.text : null;
      const category = name ? allocations.get(name) : 'routes';
      let text = printer.printNode(ts.EmitHint.Unspecified, name ? exportNode(part) : part, source);
      if (category === 'service' || category === 'validation') text = plainRequest(text);
      text = text.replace(/(import\(['"]|from\s+['"])(\.[^'"]+)(['"])/g, (_, a, p, b) => a + '../' + p + b);
      originalGroups[category ?? 'service'].push(text);
    }
  }
  transformResult.dispose();
  for (const category of Object.keys(groups)) groups[category] = [...originalGroups[category], ...groups[category].map(text => text.replace(/import\((['"])(\.[^'"]+)\1\)/g, (_, q, p) => `import(${q}../${p}${q})`))];
  const originalImportText = originalImports.map(node => printer.printNode(ts.EmitHint.Unspecified, node, source).replace(/(from\s+['"])(\.[^'"]+)(['"])/, (_, a, p, b) => a + '../' + p + b));
  for (const [category, parts] of Object.entries(groups)) {
    if (!parts.length && category !== 'validation') continue;
    const content = parts.join('\n\n'), used = references(ts.createSourceFile('part.ts', content, ts.ScriptTarget.Latest, true)), imports = [...originalImportText];
    for (const other of Object.keys(groups)) {
      if (other === category) continue;
      const needed = [...allocations].filter(([name, allocated]) => allocated === other && used.has(name)).map(([name]) => name);
      if (needed.length) imports.push(`import { ${needed.join(', ')} } from './${domain}.${other}.js';`);
    }
    if (category === 'routes') imports.push(`import * as controllers from './${domain}.controller.js';`);
    if (category === 'controller') imports.push(`import type { ${originalImportText.some(i => /\bRequestHandler\b/.test(i)) ? 'RequestParamHandler' : 'RequestHandler, RequestParamHandler'} } from 'express';`, `import { serviceContext, sendResult } from '../../http/service-adapter.js';`, `import * as services from './${domain}.service.js';`);
    if (category === 'service' || category === 'validation') imports.push(`import { serviceResult, type ServiceContext } from '../../shared/service-context.js';`, `import { headerValue } from '../../utils/headers.js';`);
    let text = imports.join('\n') + '\n\n' + content + '\n';
    // Remove unused imported bindings. This also prevents route/service import cycles.
    const sf = ts.createSourceFile('part.ts', text, ts.ScriptTarget.Latest, true), actualUses = new Set();
    for (const statement of sf.statements) if (!ts.isImportDeclaration(statement)) for (const name of references(statement)) actualUses.add(name);
    const kept = sf.statements.map(node => {
      if (!ts.isImportDeclaration(node) || !node.importClause) return printer.printNode(ts.EmitHint.Unspecified, node, sf);
      const clause = node.importClause, defaultName = clause.name && actualUses.has(clause.name.text) ? clause.name : undefined;
      let bindings = clause.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) { const elements = bindings.elements.filter(e => actualUses.has(e.name.text)); bindings = elements.length ? f.updateNamedImports(bindings, elements) : undefined; }
      else if (bindings && !actualUses.has(bindings.name.text)) bindings = undefined;
      if (!defaultName && !bindings) return '';
      return printer.printNode(ts.EmitHint.Unspecified, f.updateImportDeclaration(node, node.modifiers, f.updateImportClause(clause, clause.isTypeOnly, defaultName, bindings), node.moduleSpecifier, node.attributes), sf);
    }).filter(Boolean).join('\n');
    write(path.join(directory, `${domain}.${category}.ts`), kept + '\n');
  }
  const forwarding = [];
  for (const node of source.statements) if (ts.isExportDeclaration(node) && node.moduleSpecifier) forwarding.push(printer.printNode(ts.EmitHint.Unspecified, node, source));
  for (const category of Object.keys(groups)) { const exportedNames = publicNames.filter(name => allocations.get(name) === category); if (exportedNames.length) forwarding.push(`export { ${exportedNames.join(', ')} } from './${domain}/${domain}.${category}.js';`); }
  write(path.join(sourceRoot, 'modules', file), `// Compatibility entry point; implementation lives in the feature directory.\n${forwarding.join('\n')}\n`);
  report.push({ domain, controllers: controllerCount, applicationServices: serviceCount, inlineSchemas: schemaCount, symbols: Object.fromEntries(allocations) });
}
// Internal imports bypass compatibility entry points to keep routes out of workers/services.
const sourceFiles = [];
function collect(directory) { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) { const p = path.join(directory, entry.name); if (entry.isDirectory()) collect(p); else if (entry.name.endsWith('.ts')) sourceFiles.push(p); } }
collect(sourceRoot);
for (const file of sourceFiles) {
  if (path.dirname(file) === path.join(sourceRoot, 'modules')) continue;
  const text = fs.readFileSync(file, 'utf8'), source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true), replacements = [];
  for (const node of source.statements) {
    if (!ts.isImportDeclaration(node) || !node.importClause?.namedBindings || !ts.isNamedImports(node.importClause.namedBindings) || !ts.isStringLiteral(node.moduleSpecifier)) continue;
    const target = path.resolve(path.dirname(file), node.moduleSpecifier.text.replace(/\.js$/, '.ts'));
    if (path.dirname(target) !== path.join(sourceRoot, 'modules')) continue;
    const entry = report.find(r => r.domain === path.basename(target, '.ts')); if (!entry) continue;
    const groups = new Map();
    for (const binding of node.importClause.namedBindings.elements) {
      const name = (binding.propertyName ?? binding.name).text, kind = entry.symbols[name]; if (!kind) throw new Error(`Unknown exported symbol ${name} in ${target}`);
      const values = groups.get(kind) ?? []; values.push(binding.getText(source)); groups.set(kind, values);
    }
    const imports = [...groups].map(([kind, names]) => { let relative = path.relative(path.dirname(file), path.join(sourceRoot, 'modules', entry.domain, `${entry.domain}.${kind}.js`)).replaceAll('\\', '/'); if (!relative.startsWith('.')) relative = './' + relative; return `import ${node.importClause.isTypeOnly ? 'type ' : ''}{ ${names.join(', ')} } from '${relative}';`; });
    replacements.push({ start: node.getStart(source), end: node.end, text: imports.join('\n') });
  }
  let updated = text; for (const edit of replacements.reverse()) updated = updated.slice(0, edit.start) + edit.text + updated.slice(edit.end); write(file, updated);
}
write(path.join(root, 'migration/architecture-extraction.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ features: report.length, controllers: report.reduce((n, r) => n + r.controllers, 0), applicationServices: report.reduce((n, r) => n + r.applicationServices, 0) }));
