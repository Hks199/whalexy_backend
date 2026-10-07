import express from 'express';
import fs from 'node:fs/promises';

// Express 5 stores mount matching in closures. Record mount paths while building
// this isolated app instance; no listener, worker, or request handler is started.
const mounts = new WeakMap();
const originalUse = express.Router.prototype.use;
express.Router.prototype.use = function (...args) {
  const before = this.stack.length;
  const result = originalUse.apply(this, args);
  const path =
    typeof args[0] === 'string' || (Array.isArray(args[0]) && typeof args[0][0] === 'string')
      ? args[0]
      : '/';
  for (const layer of this.stack.slice(before)) mounts.set(layer, path);
  return result;
};

const routes = [];
function joined(prefix, path) {
  return (prefix + '/' + path).replace(/\/+/g, '/').replace(/\/$/, '') || '/';
}
function visit(stack, prefix = '') {
  for (const layer of stack) {
    if (layer.route) {
      for (const path of [layer.route.path].flat())
        for (const [method, enabled] of Object.entries(layer.route.methods))
          if (enabled) routes.push({ method: method.toUpperCase(), path: joined(prefix, path) });
    } else if (layer.handle?.stack) {
      if (!mounts.has(layer)) throw new Error('Unrecorded router mount');
      for (const path of [mounts.get(layer)].flat())
        visit(layer.handle.stack, joined(prefix, path));
    }
  }
}
try {
  const { createApp } = await import('../src/app.ts');
  visit(createApp().router.stack);
} finally {
  express.Router.prototype.use = originalUse;
}
const endpoints = [
  ...new Map(routes.map((route) => [route.method + ' ' + route.path, route])).values(),
].sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
const methods = {};
for (const route of endpoints) methods[route.method] = (methods[route.method] || 0) + 1;
const report = {
  registeredMethodPathPairs: endpoints.length,
  methods,
  note: 'Explicit method/path patterns, including expanded loops and mounted aliases. Middleware, automatic HEAD/OPTIONS handling and provider compatibility verification are excluded.',
  endpoints,
};
await fs.writeFile(
  new URL('../migration/node-route-inventory.json', import.meta.url),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify({ registeredMethodPathPairs: endpoints.length, methods }));
