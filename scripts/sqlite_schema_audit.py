"""Read-only SQLite/Prisma comparison. No row values or credentials are exported."""
from pathlib import Path
import argparse
import hashlib
import json
import re
import sqlite3

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--database', type=Path, default=ROOT.parent / 'whalexy/database/database.sqlite')
args = parser.parse_args()
database = args.database.resolve()
before = hashlib.sha256(database.read_bytes()).hexdigest()
connection = sqlite3.connect(database.as_uri() + '?mode=ro', uri=True)
connection.execute('PRAGMA query_only=ON')
quote = lambda value: '"' + value.replace('"', '""') + '"'
tables = {}
for (name,) in connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"):
    tables[name] = {
        'columns': [{'name': row[1], 'type': row[2], 'notNull': bool(row[3]), 'default': row[4], 'primaryKeyPosition': row[5]} for row in connection.execute(f'PRAGMA table_info({quote(name)})')],
        'foreignKeys': [{'table': row[2], 'from': row[3], 'to': row[4], 'onUpdate': row[5], 'onDelete': row[6]} for row in connection.execute(f'PRAGMA foreign_key_list({quote(name)})')],
        'indexes': [{'name': row[1], 'unique': bool(row[2]), 'columns': [field[2] for field in connection.execute(f'PRAGMA index_info({quote(row[1])})')]} for row in connection.execute(f'PRAGMA index_list({quote(name)})')],
        'rowCount': connection.execute(f'SELECT count(*) FROM {quote(name)}').fetchone()[0],
    }
integrity = [row[0] for row in connection.execute('PRAGMA integrity_check')]
foreign_key_violations = connection.execute('PRAGMA foreign_key_check').fetchall()
schema = (ROOT / 'prisma/schema.prisma').read_text(encoding='utf-8')
models = {}
model_bodies = {}
for name, body in re.findall(r'^model (\w+)\s*\{(.*?)^\}', schema, re.M | re.S):
    mapping = re.search(r'@@map\("([^"]+)"\)', body)
    table = mapping[1] if mapping else name
    fields = {}
    for field, kind, nullable, attrs in re.findall(r'^\s+(\w+)\s+(Int|String|Json|Boolean|DateTime|Decimal|Float|BigInt|Bytes)(\??)([^\n]*)', body, re.M):
        column_map = re.search(r'@map\("([^"]+)"\)', attrs)
        fields[column_map[1] if column_map else field] = {'field': field, 'type': kind, 'nullable': nullable == '?', 'hasDefault': '@default(' in attrs, 'unique': '@unique' in attrs or '@id' in attrs}
    models[table] = {'model': name, 'fields': fields}
    model_bodies[table] = body
model_names = {value['model']: table for table, value in models.items()}
native_foreign_keys = []
for table, body in model_bodies.items():
    for parent, attrs in re.findall(r'^\s+\w+\s+(\w+)\??\s+(@relation\([^\n]+)', body, re.M):
        columns = re.search(r'fields:\s*\[([^]]+)\]', attrs)
        references = re.search(r'references:\s*\[([^]]+)\]', attrs)
        if parent not in model_names or not columns or not references: continue
        parent_table = model_names[parent]
        field_columns = {field['field']: column for column, field in models[table]['fields'].items()}
        parent_columns = {field['field']: column for column, field in models[parent_table]['fields'].items()}
        for field, reference in zip(columns[1].split(','), references[1].split(',')):
            native_foreign_keys.append((table, field_columns[field.strip()], parent_table, parent_columns[reference.strip()]))
source_foreign_keys = [(table, fk['from'], fk['table'], fk['to']) for table, metadata in tables.items() for fk in metadata['foreignKeys']]
missing_foreign_keys = sorted(set(source_foreign_keys) - set(native_foreign_keys))
differences = []
for table in sorted(set(tables) & set(models)):
    columns = {column['name']: column for column in tables[table]['columns']}
    fields = models[table]['fields']
    for column in sorted(set(columns) - set(fields)):
        differences.append({'table': table, 'column': column, 'issue': 'sqlite-column-missing-in-prisma', 'sqlite': columns[column]})
    for column in sorted(set(fields) - set(columns)):
        differences.append({'table': table, 'column': column, 'issue': 'prisma-column-not-in-snapshot', 'prisma': fields[column]})
    for column in sorted(set(columns) & set(fields)):
        source, target = columns[column], fields[column]
        required = source['notNull'] or bool(source['primaryKeyPosition'])
        if required == fields[column]['nullable']:
            differences.append({'table': table, 'column': column, 'issue': 'nullability-differs', 'sqliteRequired': required, 'prisma': target})
import_issues = []
for table, column, parent, reference in native_foreign_keys:
    if table not in tables or parent not in tables: continue
    child_columns = {c['name'] for c in tables[table]['columns']}
    parent_columns = {c['name'] for c in tables[parent]['columns']}
    if column not in child_columns or reference not in parent_columns: continue
    orphans = connection.execute(f'SELECT count(*) FROM {quote(table)} c LEFT JOIN {quote(parent)} p ON c.{quote(column)}=p.{quote(reference)} WHERE c.{quote(column)} IS NOT NULL AND p.{quote(reference)} IS NULL').fetchone()[0]
    if orphans: import_issues.append({'table': table, 'column': column, 'issue': 'orphan-under-native-foreign-key', 'rows': orphans, 'parentTable': parent})
for table in sorted(set(tables) & set(models)):
    fields = models[table]['fields']
    source_names = {column['name'] for column in tables[table]['columns']}
    for column, target in fields.items():
        if column not in source_names:
            if not target['nullable'] and not target['hasDefault'] and tables[table]['rowCount']:
                import_issues.append({'table': table, 'column': column, 'issue': 'required-native-field-needs-mapping', 'rows': tables[table]['rowCount']})
            continue
        nulls = connection.execute(f'SELECT count(*) FROM {quote(table)} WHERE {quote(column)} IS NULL').fetchone()[0]
        if nulls and not target['nullable']:
            import_issues.append({'table': table, 'column': column, 'issue': 'source-nulls-need-explicit-policy', 'rows': nulls, 'nativeDefaultAvailable': target['hasDefault']})
        if target['unique']:
            duplicates = connection.execute(f'SELECT count(*) FROM (SELECT {quote(column)} FROM {quote(table)} WHERE {quote(column)} IS NOT NULL GROUP BY {quote(column)} HAVING count(*)>1)').fetchone()[0]
            if duplicates: import_issues.append({'table': table, 'column': column, 'issue': 'duplicate-native-unique-values', 'groups': duplicates})
        invalid = 0
        if target['type'] in ['Json', 'Int', 'Boolean']:
            for (value,) in connection.execute(f'SELECT {quote(column)} FROM {quote(table)} WHERE {quote(column)} IS NOT NULL'):
                try:
                    if target['type'] == 'Json': json.loads(value)
                    elif target['type'] == 'Int':
                        if isinstance(value, float) and not value.is_integer() or not -2147483648 <= int(value) <= 2147483647: raise ValueError()
                    elif value not in [0, 1, '0', '1', 'true', 'false']: raise ValueError()
                except (ValueError, TypeError, OverflowError): invalid += 1
        if invalid: import_issues.append({'table': table, 'column': column, 'issue': 'value-requires-type-reconciliation', 'rows': invalid, 'targetType': target['type']})
connection.close()
after = hashlib.sha256(database.read_bytes()).hexdigest()
assert before == after, 'SQLite file changed during audit'
report = {
    'database': str(database), 'sha256': before, 'sourcePreserved': before == after,
    'integrity': integrity, 'foreignKeyViolationCount': len(foreign_key_violations),
    'sqliteTableCount': len(tables), 'sqliteRowCount': sum(t['rowCount'] for t in tables.values()),
    'prismaModelCount': len(models), 'tablesMissingInPrisma': sorted(set(tables) - set(models)),
    'prismaTablesNotInSnapshot': sorted(set(models) - set(tables)),
    'differences': differences, 'tables': tables, 'nativeImportIssues': import_issues,
    'sqliteDeclaredForeignKeyCount': len(source_foreign_keys), 'nativeForeignKeyCount': len(native_foreign_keys),
    'sqliteForeignKeysMissingInPrisma': missing_foreign_keys,
    'dataImportVerified': False, 'fullyConverted': False,
    'limitations': ['A SQLite snapshot may predate source migrations.', 'PostgreSQL types, constraints and actual data require reconciliation.', 'This report contains schema metadata and counts, never row contents.'],
}
(ROOT / 'migration/sqlite-schema-audit.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps({key: report[key] for key in ['integrity', 'foreignKeyViolationCount', 'sqliteTableCount', 'sqliteRowCount', 'prismaModelCount', 'tablesMissingInPrisma', 'prismaTablesNotInSnapshot', 'sourcePreserved']}))
print(json.dumps({'schemaDifferenceCount': len(differences), 'missingColumnCount': sum(d['issue'] == 'sqlite-column-missing-in-prisma' for d in differences)}))
print(json.dumps({'nativeImportIssueCount': len(import_issues), 'nativeImportIssues': import_issues}))
