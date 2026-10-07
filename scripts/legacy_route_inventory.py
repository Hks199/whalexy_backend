"""Inventory application HTTP declarations with Laravel group prefixes.

This reads source only. Conditional routes and package registrations still need a
Laravel runtime review; URL presence alone never proves behavioral compatibility.
"""
from pathlib import Path
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT.parent / 'whalexy'
TOKEN = re.compile(r"(?P<comment>/\*.*?\*/|//[^\r\n]*|\#[^\r\n]*)|(?P<string>'(?:\\.|[^'\\])*'|\"(?:\\.|[^\"\\])*\")|(?P<word>[A-Za-z_][A-Za-z_0-9]*)|(?P<symbol>::|->|=>|[^\s])", re.S)
METHODS = {'get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'any', 'match'}


def tokens(text):
    return [(m[0], m.start(), m.lastgroup) for m in TOKEN.finditer(text) if m.lastgroup != 'comment']


def pairs(items):
    opened, result = [], {}
    for i, (value, _, _) in enumerate(items):
        if value in ('(', '[', '{'):
            opened.append((value, i))
        elif value in (')', ']', '}'):
            if not opened or opened[-1][0] != {')': '(', ']': '[', '}': '{'}[value]:
                raise ValueError(f'Unbalanced PHP delimiter at token {i}')
            _, start = opened.pop()
            result[start] = i
    if opened:
        raise ValueError('Unclosed PHP delimiters')
    return result


def string(item):
    return item[0][1:-1] if item[2] == 'string' else None


def joined(*paths):
    return '/' + '/'.join(part.strip('/') for part in paths if part.strip('/'))


def inspect_file(path, inherited='', lineage=()):
    if path in lineage:
        raise ValueError(f'Cyclic route include: {path}')
    text = path.read_text(encoding='utf-8-sig')
    items = tokens(text)
    closing = pairs(items)
    groups, declarations = [], []
    for start in range(len(items) - 3):
        if [item[0] for item in items[start:start + 2]] != ['Route', '::']:
            continue
        cursor, prefix = start + 2, ''
        while cursor + 1 < len(items) and items[cursor][2] == 'word' and items[cursor + 1][0] == '(':
            method = items[cursor][0]
            opening, end = cursor + 1, closing[cursor + 1]
            args = items[opening + 1:end]
            if method == 'prefix':
                if not args or string(args[0]) is None:
                    raise ValueError(f'Dynamic prefix in {path}')
                prefix = joined(prefix, string(args[0]))
            if method == 'group':
                # group(['prefix' => '...'], function () {...}) and chained groups.
                function = next((i for i in range(opening + 1, end) if items[i][0] == 'function'), None)
                for index in range(opening + 1, (function or end) - 2):
                    if string(items[index]) == 'prefix' and items[index + 1][0] == '=>':
                        if string(items[index + 2]) is None:
                            raise ValueError(f'Dynamic group prefix in {path}')
                        prefix = joined(prefix, string(items[index + 2]))
                        break
                # The group's closure body, excluding nested route closures.
                if function is not None:
                    brace = next(i for i in range(function + 1, end) if items[i][0] == '{')
                    groups.append((brace, closing[brace], prefix))
                break
            if method in METHODS:
                arg = opening + 1
                methods = [method.upper()]
                if method == 'match':
                    methods = [string(t).upper() for t in items[arg + 1:closing[arg]] if string(t) is not None]
                    arg = closing[arg] + 2
                elif method == 'any':
                    methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']
                local_path = string(items[arg])
                if local_path is None:
                    raise ValueError(f'Dynamic route path in {path}')
                handler_text = text[items[arg][1]:items[end][1]]
                handler = re.search(r"([\w\\]+)::class\s*,\s*'([^']+)'", handler_text)
                declarations.append((start, {
                    'method': method.upper(), 'methods': methods, 'localPath': local_path,
                    'source': path.relative_to(SOURCE).as_posix(),
                    'line': text.count('\n', 0, items[start][1]) + 1,
                    'controller': handler[1] if handler else None,
                    'action': handler[2] if handler else None,
                    'sourceSha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                    'status': 'pending-contract-verification',
                }))
                break
            cursor = end + 1
            if cursor >= len(items) or items[cursor][0] != '->':
                break
            cursor += 1

    def prefix_at(index):
        return joined(inherited, *(prefix for first, last, prefix in sorted(groups) if first < index < last))

    result = []
    for index, declaration in declarations:
        declaration['fullPath'] = joined(prefix_at(index), declaration['localPath'])
        declaration['id'] = f"{declaration['source']}:{declaration['line']}:{declaration['method']}:{declaration['localPath']}"
        result.append(declaration)
    for index, item in enumerate(items):
        if item[0] not in ('require', 'require_once', 'include', 'include_once'):
            continue
        end = next(i for i in range(index + 1, len(items)) if items[i][0] == ';')
        filenames = [string(t) for t in items[index + 1:end] if string(t) and string(t).endswith('.php')]
        for filename in filenames:
            included = path.parent / filename.lstrip('/')
            if not included.is_file():
                raise ValueError(f'Cannot resolve route include: {filename}')
            result.extend(inspect_file(included, prefix_at(index), (*lineage, path)))
    return result


def inventory():
    return inspect_file(SOURCE / 'routes/api.php', '/api') + inspect_file(SOURCE / 'routes/web.php')


def write_progress(declarations):
    adapter_path = ROOT / 'migration/route-adapters.json'
    adapters = json.loads(adapter_path.read_text(encoding='utf-8')) if adapter_path.exists() else {}
    contracts, used = [], set()
    for route in declarations:
        endpoint = route['method'] + ' ' + route['fullPath']
        adapter = adapters.get(endpoint)
        if adapter:
            used.add(endpoint)
        contracts.append({
            'id': route['id'], 'legacyEndpoint': endpoint,
            'source': route['source'], 'line': route['line'],
            'controller': route['controller'], 'action': route['action'],
            'explicitMethods': route['methods'],
            'sourceSha256': route['sourceSha256'],
            'status': 'partial-url-field-adapter' if adapter else 'pending-contract-review',
            'nodeEndpoint': adapter['nodeEndpoint'] if adapter else None,
            'remaining': adapter['remaining'] if adapter else ['Authorization, request, response and side-effect comparison against Node implementation'],
            'testFile': adapter['testFile'] if adapter else None,
        })
    if set(adapters) != used:
        raise ValueError(f'Adapters refer to missing source routes: {sorted(set(adapters) - used)}')
    progress = {
        'sourceRouteDeclarations': len(contracts), 'partialUrlFieldAdapters': len(used),
        'complete': False,
        'note': 'Pending review does not imply native capabilities are absent. See parity-report.json for verified counts. Only reviewed evidence in verified-contracts.json can pass parity.',
        'contracts': contracts,
    }
    (ROOT / 'migration/contract-progress.json').write_text(json.dumps(progress, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    declarations = inventory()
    report = {
        'source': str(SOURCE), 'sourceRouteDeclarations': len(declarations),
        'limitations': ['Source declarations, not a runtime route:list export.',
                       'Conditional routes remain included; duplicate registrations are preserved.',
                       'Framework/package-generated routes are excluded.',
                       'GET automatic HEAD handling is excluded; explicit ANY and MATCH methods are expanded.',
                       'No route is marked compatible by URL similarity.'],
        'routes': declarations,
    }
    (ROOT / 'migration/legacy-route-inventory.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    write_progress(declarations)
    print(json.dumps({'sourceRouteDeclarations': len(declarations), 'output': 'migration/legacy-route-inventory.json'}))
