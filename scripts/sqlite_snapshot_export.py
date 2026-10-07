"""Internal read-only stream for the private PostgreSQL archive; never run to a public log."""
from pathlib import Path
import base64
import hashlib
import json
import sqlite3

path = Path(__file__).resolve().parent.parent.parent / 'whalexy/database/database.sqlite'
digest = hashlib.sha256(path.read_bytes()).hexdigest()
connection = sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)
connection.execute('PRAGMA query_only=ON')
def emit(value): print(json.dumps(value, ensure_ascii=True, separators=(',', ':')))
def cell(value):
    if value is None: return {'type': 'null'}
    if isinstance(value, int): return {'type': 'integer', 'value': str(value)}
    if isinstance(value, float): return {'type': 'real', 'value': value.hex()}
    if isinstance(value, bytes): return {'type': 'blob', 'value': base64.b64encode(value).decode('ascii')}
    return {'type': 'text', 'value': value}
emit({'kind': 'start', 'sha256': digest})
total = 0
quote = lambda value: '"' + value.replace('"', '""') + '"'
for (table,) in connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"):
    cursor = connection.execute(f'SELECT * FROM {quote(table)}')
    columns = [field[0] for field in cursor.description]
    for ordinal, row in enumerate(cursor, 1):
        payload = json.dumps({name: cell(value) for name, value in zip(columns, row)}, sort_keys=True, ensure_ascii=True, separators=(',', ':'))
        emit({'kind': 'row', 'table': table, 'ordinal': ordinal, 'payload': payload, 'rowHash': hashlib.sha256(payload.encode()).hexdigest()})
        total += 1
connection.close()
assert hashlib.sha256(path.read_bytes()).hexdigest() == digest, 'Snapshot changed during export'
emit({'kind': 'end', 'rows': total, 'sha256': digest})
