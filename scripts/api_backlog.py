"""Classify source response hints without equating routes or adapters with verified APIs."""
import json
import re
from collections import Counter
from pathlib import Path
from legacy_route_inventory import tokens, pairs

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT.parent / 'whalexy'


def response_hints(text, action):
    items = tokens(text)
    closing = pairs(items)
    for i, item in enumerate(items[:-2]):
        if item[0] != 'function' or items[i + 1][0] != action:
            continue
        cursor = i + 2
        while cursor < len(items) and items[cursor][0] != '{':
            cursor += 1
        if cursor >= len(items):
            return []
        body = ' '.join('<string>' if token[2] == 'string' else token[0] for token in items[cursor + 1:closing[cursor]])
        hints = []
        if re.search(r'(?:->\s*json\s*\(|\bJsonResponse\b|\bprocessResponse\s*\(|\blwResponse\s*\()', body, re.I):
            hints.append('api-response')
        if re.search(r'\b(?:view|loadView)\s*\(', body, re.I):
            hints.append('page-response')
        if re.search(r'\b(?:redirect|download|streamDownload|stream|file)\s*\(', body, re.I):
            hints.append('redirect-file-or-stream')
        return hints
    return []


def generate():
    inventory = json.loads((ROOT / 'migration/legacy-route-inventory.json').read_text())
    adapters = json.loads((ROOT / 'migration/route-adapters.json').read_text())
    controllers = {}
    for path in SOURCE.glob('app/**/*.php'):
        if 'Controllers' not in path.parts:
            continue
        text = path.read_text(encoding='utf-8-sig', errors='replace')
        cls = re.search(r'\bclass\s+(\w+)', text)
        if cls:
            controllers.setdefault(cls[1], []).append((path, text))
    declarations = []
    for route in inventory['routes']:
        hints = []
        candidates = controllers.get(route['controller'], [])
        method_source = None
        if len(candidates) == 1 and route['action']:
            path, text = candidates[0]
            method_source = path.relative_to(SOURCE).as_posix()
            try:
                hints = response_hints(text, route['action'])
            except ValueError:
                hints = ['manual-parser-review']
        if route['source'] == 'routes/api.php':
            category = 'api-file'
        elif 'api-response' in hints:
            category = 'mixed-api-page' if 'page-response' in hints else 'api-response-hint'
        elif 'page-response' in hints:
            category = 'page-response-hint'
        elif 'redirect-file-or-stream' in hints:
            category = 'redirect-file-or-stream-hint'
        else:
            category = 'manual-response-review'
        endpoint = route['method'] + ' ' + route['fullPath']
        declarations.append({'id': route['id'], 'endpoint': endpoint, 'category': category,
                             'hints': hints, 'controller': route['controller'], 'action': route['action'],
                             'controllerSource': method_source, 'routeSource': route['source'],
                             'line': route['line'], 'partialAdapterRecorded': endpoint in adapters})
    api = [r for r in declarations if r['category'] in ('api-file', 'api-response-hint', 'mixed-api-page')]
    missing = [r for r in api if not r['partialAdapterRecorded']]
    report = {'sourceDeclarations': len(declarations), 'categories': dict(Counter(r['category'] for r in declarations)),
              'apiCapableDeclarationsByStaticHints': len(api), 'apiCapableWithoutAdapterRecords': len(missing),
              'apiCapableWithPartialAdapterRecords': len(api) - len(missing),
              'note': 'Conservative static response hints, not an authoritative runtime API count. Page routes, redirects/files/streams and unresolved responses remain separate; indirect JSON helpers and closures require manual review. An adapter record does not establish behavior parity.',
              'pendingApiByController': dict(Counter(r['controller'] or '(closure/unresolved)' for r in missing).most_common()),
              'declarations': declarations}
    (ROOT / 'migration/api-backlog.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    lines = ['# Source API backlog', '', report['note'], '',
             f"Source declarations: **{len(declarations)}**. API-capable declarations identified by static hints: **{len(api)}**, with **{len(api)-len(missing)}** partial adapter records and **{len(missing)}** without adapter records.", '',
             '| Response category | Declarations |', '|---|---:|']
    lines += [f'| {category} | {count} |' for category, count in report['categories'].items()]
    lines += ['', '| Controller | API-capable declarations without adapters |', '|---|---:|']
    lines += [f'| {controller} | {count} |' for controller, count in report['pendingApiByController'].items()]
    lines += ['', 'Rebuild with `python scripts/api_backlog.py`. Exact endpoints and source locations are in [api-backlog.json](api-backlog.json). No source response bodies or credentials are included.', '']
    (ROOT / 'migration/API_BACKLOG.md').write_text('\n'.join(lines), encoding='utf-8')
    print(json.dumps({key:report[key] for key in ('sourceDeclarations','categories','apiCapableDeclarationsByStaticHints','apiCapableWithoutAdapterRecords','apiCapableWithPartialAdapterRecords')}))


if __name__ == '__main__':
    generate()
