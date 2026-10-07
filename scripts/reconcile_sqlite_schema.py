"""Apply additive SQLite metadata reconciliation; do not import or rewrite source data."""
from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parent.parent
report = json.loads((ROOT / 'migration/sqlite-schema-audit.json').read_text())
path = ROOT / 'prisma/schema.prisma'
schema = path.read_text(encoding='utf-8')
renames = {
    'activity_logs': {'users__id': 'user_id', 'vendors__id': 'vendor_id'},
    'login_logs': {'users__id': 'user_id'},
    'subscriptions': {'vendor_id': 'vendor_model__id'},
    'users': {'phone_number': 'mobile_number'},
    'whatsapp_message_logs': {'whatsapp_message_id': 'wamid'},
    'whatsapp_templates': {'language_code': 'language'},
}
def camel(column):
    aliases = {'_id': 'id', '_uid': 'uid', '__data': 'data', 'users__id': 'userId', 'vendors__id': 'vendorId'}
    if column in aliases: return aliases[column]
    parts = [p for p in column.strip('_').split('_') if p]
    return parts[0] + ''.join(p.title() for p in parts[1:])
def kind(column):
    sql = column['type'].upper()
    if 'INT' in sql: return 'Int'
    if any(value in sql for value in ['DATE', 'TIME']): return 'DateTime'
    if any(value in sql for value in ['DECIMAL', 'NUMERIC']): return 'Decimal'
    if any(value in sql for value in ['REAL', 'FLOAT', 'DOUBLE']): return 'Float'
    if 'BLOB' in sql: return 'Bytes'
    return 'String'
changes = []
def reconcile(match):
    name, body = match[1], match[2]
    mapping = re.search(r'@@map\("([^"]+)"\)', body)
    table = mapping[1] if mapping else name
    if table not in report['tables']: return match[0]
    for old, new in renames.get(table, {}).items():
        body = body.replace(f'@map("{old}")', f'@map("{new}")')
    mapped = set()
    used = set()
    for field, field_kind, nullable, attrs in re.findall(r'^\s+(\w+)\s+(Int|String|Json|Boolean|DateTime|Decimal|Float|BigInt|Bytes)(\??)([^\n]*)', body, re.M):
        column_map = re.search(r'@map\("([^"]+)"\)', attrs)
        mapped.add(column_map[1] if column_map else field); used.add(field)
    additions = []
    for column in report['tables'][table]['columns']:
        if column['name'] in mapped: continue
        field = camel(column['name'])
        if field in used: field = 'legacy' + field[0].upper() + field[1:]
        used.add(field)
        typ = kind(column)
        # Existing native rows have no value for newly discovered columns. Preserve
        # this honestly with nullable fields; record source constraints in the audit.
        attributes = f' @map("{column["name"]}")' if field != column['name'] else ''
        if typ == 'Decimal': attributes += ' @db.Decimal(13, 4)'
        additions.append(f'  {field} {typ}?{attributes}')
        changes.append({'table': table, 'column': column['name'], 'field': field, 'operation': 'add-nullable'})
    return f'model {name} {{{body}\n' + '\n'.join(additions) + '\n}'
schema = re.sub(r'^model (\w+)\s*\{(.*?)^\}', reconcile, schema, flags=re.M | re.S)
for table in report['tablesMissingInPrisma']:
    name = 'LegacyMigrations' if table == 'migrations' else ''.join(p.title() for p in table.split('_'))
    lines = [f'// SQLite snapshot table; source constraints require import preflight.', f'model {name} {{']
    for column in report['tables'][table]['columns']:
        field, typ = camel(column['name']), kind(column)
        primary = bool(column['primaryKeyPosition'])
        nullable = not column['notNull'] and not primary
        attrs = (' @id @default(autoincrement())' if primary and typ == 'Int' else ' @id' if primary else '')
        if field != column['name']: attrs += f' @map("{column["name"]}")'
        if typ == 'Decimal': attrs += ' @db.Decimal(13, 4)'
        lines.append(f'  {field} {typ}{"?" if nullable else ""}{attrs}')
    lines += [f'  @@map("{table}")', '}']
    schema += '\n' + '\n'.join(lines) + '\n'
    changes.append({'table': table, 'operation': 'add-table'})
schema = schema.replace('// Source-derived PostgreSQL draft. Legacy fields are reconstructed, not verified.', '// PostgreSQL native schema supplemented with read-only SQLite snapshot metadata.\n// See migration/sqlite-schema-audit.json for remaining constraint/type/import differences.')
path.write_text(schema, encoding='utf-8')
(ROOT / 'migration/sqlite-reconciliation.json').write_text(json.dumps({'renamedColumns': renames, 'additions': changes, 'sourceHash': report['sha256'], 'dataImported': False}, indent=2), encoding='utf-8')
print(json.dumps({'addedColumns': sum(c['operation'] == 'add-nullable' for c in changes), 'addedTables': len(report['tablesMissingInPrisma']), 'renamedColumns': sum(len(v) for v in renames.values())}))
