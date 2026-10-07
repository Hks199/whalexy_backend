"""Generate a reviewable source inventory and PostgreSQL draft from Laravel source.
The missing legacy schema is never silently treated as verified.
"""
from pathlib import Path
import re, json, hashlib, shutil, argparse
from legacy_route_inventory import inventory as full_route_inventory

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--write-schema', action='store_true', help='Explicitly replace the active Prisma schema with the reconstructed draft')
args = parser.parse_args()

SOURCE = Path(r'D:\mombius bloom\whalexy')
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT/'migration'
OUT.mkdir(exist_ok=True)

def clean(s):
    # Preserve physical line numbers so inventory locations point to the source.
    s = re.sub(r'/\*.*?\*/', lambda m: '\n' * m[0].count('\n'), s, flags=re.S)
    return re.sub(r'^[ \t]*//[^\n]*$', '', s, flags=re.M)

def block(s, start):
    pos=s.find('{',start); depth=0; quote=None; escape=False
    if pos<0: return ''
    for i in range(pos,len(s)):
        c=s[i]
        if quote:
            if escape: escape=False
            elif c=='\\': escape=True
            elif c==quote: quote=None
        elif c in "'\"": quote=c
        elif c=='{': depth+=1
        elif c=='}':
            depth-=1
            if depth==0:return s[pos+1:i]
    return ''

def camel(s):
    aliases={'_id':'id','_uid':'uid','__data':'data','vendors__id':'vendorId','vendor_id':'vendorId',
      'contacts__id':'contactId','users__id':'userId','campaigns__id':'campaignId',
      'whatsapp_templates__id':'templateId','assigned_users__id':'assignedUserId',
      'contact_groups__id':'groupId','countries__id':'countryId','user_id':'userId',
      'vendor_model__id':'vendorId','mobile_number':'phoneNumber','wamid':'whatsappMessageId','language':'languageCode'}
    if s in aliases:return aliases[s]
    parts=s.strip('_').split('_');return parts[0]+''.join(p.capitalize() for p in parts[1:] if p)

def model(s):return ''.join(p.capitalize() for p in s.split('_'))

tables={}; routes=[]; methods=[]; modules=[]
def record(name,source):
    if not re.fullmatch(r'[a-z][a-z0-9_]*',name):return None
    return tables.setdefault(name,{'table':name,'model':model(name),'sources':set(),'fields':{},'verifiedCreation':False,'constraints':[]})

for path in sorted((SOURCE/'app').rglob('*.php')):
    s=clean(path.read_text(encoding='utf-8',errors='replace'));src=path.relative_to(SOURCE).as_posix()
    for m in re.finditer(r"(?:protected\s+\$table\s*=\s*|(?:DB::table|Schema::hasTable)\(\s*)'([a-z][a-z0-9_]*)(?:\s+as\s+\w+)?'",s):
        record(m[1],src)['sources'].add(src)
    if '/Controllers/' in src or src.startswith('app/Http/Controllers/'):
        cls=re.search(r'class\s+(\w+)',s)
        for m in re.finditer(r'public\s+function\s+(\w+)\s*\(',s):
            if m[1]!='__construct':methods.append({'controller':cls[1] if cls else path.stem,'method':m[1],'source':src,'status':'pending-port'})

types={'string':'String','char':'String','text':'String','longText':'String','mediumText':'String',
 'json':'Json','jsonb':'Json','uuid':'String','boolean':'Boolean','integer':'Int','unsignedInteger':'Int',
 'unsignedBigInteger':'Int','bigInteger':'Int','unsignedSmallInteger':'Int','smallInteger':'Int','tinyInteger':'Int',
 'unsignedTinyInteger':'Int','decimal':'Decimal','double':'Float','float':'Float','timestamp':'DateTime',
 'dateTime':'DateTime','date':'DateTime','time':'String','enum':'String','id':'Int','increments':'Int','bigIncrements':'Int'}
for p in sorted((SOURCE/'database/migrations').glob('*.php')):
    s=clean(p.read_text(encoding='utf-8',errors='replace'));s=re.split(r'function\s+down\s*\(',s)[0];src=p.relative_to(SOURCE).as_posix()
    tenant=re.search(r'\$tenantColumns\s*=\s*static\s+function',s);common=block(s,tenant.start()) if tenant else ''
    for m in re.finditer(r"Schema::(create|table)\(\s*'([^']+)'",s):
        t=record(m[2],src);t['sources'].add(src);t['verifiedCreation']|=m[1]=='create'
        body=block(s,m.end())
        if '$tenantColumns($table)' in body:body+='\n'+common
        for line in re.findall(r'\$table->[^;]+;',body,re.S):
            if re.match(r'\$table->(?:foreign|foreignId|index|unique)\(',line):
                t['constraints'].append(line.strip())
            f=re.match(r"\$table->(\w+)\(\s*(?:'([^']+)'[^)]*)?\)",line)
            if not f:continue
            kind,col=f.groups()
            if kind in ['timestamps','timestampsTz']:
                for col in ['created_at','updated_at']:t['fields'][col]={'type':'DateTime','optional':False,'default':'now()','source':src}
            elif kind=='softDeletes':t['fields']['deleted_at']={'type':'DateTime','optional':True,'source':src}
            elif kind in types:
                col=col or ('id' if kind=='id' else None)
                if not col:continue
                pk=kind in ['id','increments','bigIncrements'] or '->primary(' in line
                spec={'type':types[kind],'optional':'->nullable(' in line,'pk':pk,'source':src}
                if pk and spec['type']=='Int':spec['default']='autoincrement()'
                if '->unique(' in line:spec['unique']=True
                if kind=='uuid' and (spec.get('unique') or pk):spec['default']='uuid()'
                default=re.search(r'->default\(([^)]*)\)',line)
                if default:
                    val=default[1].strip()
                    if val in ['true','false'] or re.fullmatch(r'-?\d+(?:\.\d+)?',val):spec['default']=val
                    elif val.startswith("'") and val.endswith("'"):spec['default']=json.dumps(val[1:-1])
                t['fields'][col]=spec
            elif kind in ['foreign','foreignId','index','unique']:pass
            if kind=='foreignId' and col:t['fields'][col]={'type':'Int','optional':'->nullable(' in line,'source':src}

# Deliberate legacy reconstruction; these fields MUST be reconciled with the original SQL.
legacy={
 'users':{'name':'String','email':'String','password':'String','phone_number':'String?','status':'Int','vendors__id':'Int?', 'user_roles__id':'Int?', 'email_verified_at':'DateTime?','phone_verified_at':'DateTime?'},
 'vendors':{'title':'String','status':'Int','__data':'Json?'},
 'vendor_users':{'users__id':'Int','vendors__id':'Int','status':'Int','__data':'Json?'},
 'vendor_settings':{'vendors__id':'Int','name':'String','value':'String?','data_type':'Int?'},
 'user_roles':{'title':'String','__data':'Json?'},
 'contacts':{'vendors__id':'Int','wa_id':'String?','first_name':'String?','last_name':'String?','email':'String?','language_code':'String?','whatsapp_opt_out':'Int?','status':'Int','assigned_users__id':'Int?','countries__id':'Int?','messaged_at':'DateTime?','unread_messages_count':'Int','disable_ai_bot':'Int','__data':'Json?'},
 'contact_groups':{'vendors__id':'Int','title':'String','status':'Int','description':'String?'},
 'group_contacts':{'contacts__id':'Int','contact_groups__id':'Int'},
 'labels':{'vendors__id':'Int','title':'String','color':'String?','text_color':'String?','bg_color':'String?','status':'Int'},
 'contact_labels':{'contacts__id':'Int','labels__id':'Int'},
 'contact_custom_fields':{'vendors__id':'Int','input_name':'String','input_type':'String','name':'String?'},
 'contact_custom_field_values':{'contacts__id':'Int','contact_custom_fields__id':'Int','field_value':'String?'},
 'whatsapp_templates':{'vendors__id':'Int','template_name':'String','template_id':'String?','language_code':'String','status':'String','category':'String?','__data':'Json?'},
 'campaigns':{'vendors__id':'Int','whatsapp_templates__id':'Int','title':'String','status':'String','scheduled_at':'DateTime?','__data':'Json?'},
 'campaign_groups':{'campaigns__id':'Int?','contact_groups__id':'Int?'},
 'bot_replies':{'vendors__id':'Int','bot_flows__id':'Int?','name':'String?','reply_trigger':'String?','reply_text':'String?','trigger_type':'String','priority_index':'Int','status':'Int','__data':'Json?'},
 'user_active_flows':{'user_id':'Int?','flow_id':'Int?','phone_number':'String?','activated_at':'DateTime?'},
 'whatsapp_message_logs':{'vendors__id':'Int','contacts__id':'Int','contact_wa_id':'String?','campaigns__id':'Int?','whatsapp_message_id':'String?','wab_phone_number_id':'String?','message':'String?','status':'String?','is_incoming_message':'Boolean','messaged_at':'DateTime','replied_to_whatsapp_message_logs__uid':'String?','__data':'Json?'},
 'whatsapp_message_queue':{'vendors__id':'Int','contacts__id':'Int?','campaigns__id':'Int','phone_with_country_code':'String','status':'Int','retries':'Int','scheduled_at':'DateTime','__data':'Json?'},
 'subscriptions':{'vendor_id':'Int','type':'String','stripe_id':'String','stripe_status':'String','stripe_price':'String?','quantity':'Int?','trial_ends_at':'DateTime?','ends_at':'DateTime?'},
 'manual_subscriptions':{'vendors__id':'Int','status':'String','__data':'Json?'},
 'configurations':{'name':'String','value':'String?'},
 'pages':{'title':'String','content':'String?','status':'Int'},
 'countries':{'name':'String','phone_code':'String?'},
 'login_logs':{'users__id':'Int','ip_address':'String?','__data':'Json?'},
 'activity_logs':{'users__id':'Int?','vendors__id':'Int?','activity':'Json?'},
 'token_registry':{'jwt_token':'String?','user_authorities__id':'Int?','expiry_at':'DateTime?','status':'Int'},
}
for name, fields in legacy.items():
    t=record(name,'legacy-reconstruction');t['sources'].add('legacy-reconstruction')
    for col,typ in fields.items():
        t['fields'].setdefault(col,{'type':typ.rstrip('?'),'optional':typ.endswith('?'),'source':'legacy-reconstruction'})
    if not any(f.get('pk') for f in t['fields'].values()):
        key='id' if name=='subscriptions' else '_id';t['fields'][key]={'type':'Int','pk':True,'default':'autoincrement()','source':'legacy-reconstruction'}
    if name != 'user_active_flows':
        t['fields'].setdefault('_uid',{'type':'String','unique':True,'default':'uuid()','source':'legacy-reconstruction'})
        for col in ['created_at','updated_at']:t['fields'].setdefault(col,{'type':'DateTime','default':'now()','source':'legacy-reconstruction'})

# Explicit native defaults; source constraints are retained separately for review.
tables['users']['fields']['email']['unique']=True
for name,col,val in [('users','status','1'),('vendors','status','1'),('contacts','status','1'),
 ('contacts','unread_messages_count','0'),('contacts','disable_ai_bot','0'),('vendor_users','status','1'),
 ('contact_groups','status','1'),('labels','status','1'),('whatsapp_message_queue','status','1'),('whatsapp_message_queue','retries','0')]:
    tables[name]['fields'][col]['default']=val
for t in tables.values():
    for col,f in t['fields'].items():
        if col in ['_uid','uuid'] and f.get('unique'):f.setdefault('default','uuid()')

# Legacy logical links are reconstructed from models; reconcile with the base SQL.
legacy_links={'users':{'vendors__id':('vendors','_id'),'user_roles__id':('user_roles','_id')},
 'vendor_users':{'vendors__id':('vendors','_id'),'users__id':('users','_id')},
 'vendor_settings':{'vendors__id':('vendors','_id')},'contacts':{'vendors__id':('vendors','_id'),'assigned_users__id':('users','_id')},
 'contact_groups':{'vendors__id':('vendors','_id')},'group_contacts':{'contacts__id':('contacts','_id'),'contact_groups__id':('contact_groups','_id')},
 'contact_labels':{'contacts__id':('contacts','_id'),'labels__id':('labels','_id')},
 'contact_custom_field_values':{'contacts__id':('contacts','_id'),'contact_custom_fields__id':('contact_custom_fields','_id')},
 'campaigns':{'vendors__id':('vendors','_id'),'whatsapp_templates__id':('whatsapp_templates','_id')},
 'whatsapp_templates':{'vendors__id':('vendors','_id')},
 'whatsapp_message_logs':{'vendors__id':('vendors','_id'),'contacts__id':('contacts','_id'),'campaigns__id':('campaigns','_id')},
 'whatsapp_message_queue':{'vendors__id':('vendors','_id'),'contacts__id':('contacts','_id'),'campaigns__id':('campaigns','_id')},
}
for name,links in legacy_links.items():
    for col,(parent,pk) in links.items():
        tables[name]['constraints'].append(f"$table->foreign('{col}')->references('{pk}')->on('{parent}')->onDelete('restrict');")

for p in sorted((SOURCE/'routes').glob('*.php')):
    s=clean(p.read_text(encoding='utf-8',errors='replace'))
    for m in re.finditer(r"(?:Route::|->)(get|post|put|patch|delete|any|match)\(\s*(?:\[[^]]+\]\s*,\s*)?'([^']+)'",s):
        tail=s[m.end():];end=tail.find(';');statement=tail[:end if end>=0 else 0]
        handler=re.search(r"(\w+)::class\s*,\s*'([^']+)'",statement)
        name=re.search(r"->name\(\s*'([^']+)'",statement)
        routes.append({'method':m[1].upper(),'localPath':m[2], 'name':name[1] if name else None,
          'controller':handler[1] if handler else None,'action':handler[2] if handler else None,
          'source':p.relative_to(SOURCE).as_posix(),'line':s[:m.start()].count('\n')+1,
          'status':'pending-contract-verification','note':'localPath excludes enclosing prefix groups; closures are included'})
full_routes = {route['id']: route for route in full_route_inventory()}
for route in routes:
    key = f"{route['source']}:{route['line']}:{route['method']}:{route['localPath']}"
    full = full_routes[key]
    route.update(fullPath=full['fullPath'], methods=full['methods'])
    route['note'] = 'Full path resolves source group prefixes/includes; conditional/package routes need runtime review'
modules=[p.name for p in sorted((SOURCE/'app/Yantrana/Components').iterdir()) if p.is_dir()]
snapshot_path = OUT / 'sqlite-schema-audit.json'
if snapshot_path.exists():
    snapshot = json.loads(snapshot_path.read_text(encoding='utf-8'))
    database = Path(snapshot['database'])
    if hashlib.sha256(database.read_bytes()).hexdigest() != snapshot['sha256']:
        raise RuntimeError('SQLite metadata is stale; run sqlite_schema_audit.py first')
    renames = json.loads((OUT / 'sqlite-reconciliation.json').read_text())['renamedColumns']
    for name, metadata in snapshot['tables'].items():
        t = record(name, 'database/database.sqlite'); t['sources'].add('database/database.sqlite')
        t['verifiedCreation'] = True; t['snapshotMetadata'] = metadata
        for old, new in renames.get(name, {}).items():
            if old in t['fields']: t['fields'][new] = t['fields'].pop(old)
        for col in metadata['columns']:
            sql = col['type'].upper()
            typ = 'Int' if 'INT' in sql else 'DateTime' if any(v in sql for v in ['DATE','TIME']) else 'Decimal' if any(v in sql for v in ['DECIMAL','NUMERIC']) else 'Float' if any(v in sql for v in ['REAL','FLOAT','DOUBLE']) else 'Bytes' if 'BLOB' in sql else 'String'
            field = {'type': typ, 'optional': not col['notNull'], 'source': 'database/database.sqlite'}
            if col['primaryKeyPosition']: field.update(pk=True, optional=False, default='autoincrement()')
            t['fields'].setdefault(col['name'], field)
for t in tables.values():
    t['sources']=sorted(t['sources'])
    for col,f in t['fields'].items():f['name']=camel(col)
(OUT/'source-inventory.json').write_text(json.dumps({'modules':modules,'tables':list(tables.values()),'routes':routes,'controllerMethods':methods},indent=2),encoding='utf-8')

lines=['// Source-derived PostgreSQL draft. Legacy fields are reconstructed, not verified.',
 'generator client {','  provider = "prisma-client-js"','}',
 'datasource db {','  provider = "postgresql"','  url = env("DATABASE_URL")','}','']
# Materialize known source relationships as Prisma relations and PostgreSQL FKs.
relations={name:[] for name in tables}; relation_registry=[]
for name,t in tables.items():
    for constraint in t['constraints']:
        single=re.search(r"->unique\(\s*'([^']+)'",constraint)
        if single and single[1] in t['fields']:t['fields'][single[1]]['unique']=True
        explicit=re.search(r"foreign\(\s*'([^']+)'[^;]*?references\(\s*'([^']+)'\s*\)[^;]*?on\(\s*'([^']+)'\s*\)",constraint,re.S)
        shorthand=re.search(r"foreignId\(\s*'([^']+)'\s*\)[^;]*?constrained\(\s*'([^']+)'\s*\)",constraint,re.S)
        if explicit: col,pk,parent=explicit.groups()
        elif shorthand:col,parent=shorthand.groups();pk='id'
        else:continue
        if parent not in tables or col not in t['fields'] or pk not in tables[parent]['fields']:continue
        f=t['fields'][col];pf=tables[parent]['fields'][pk]
        if not(pf.get('pk') or pf.get('unique')):continue
        key=(name,col,parent,pk)
        if key in relation_registry:continue
        relation_registry.append(key)
        rn=f'fk_{name}_{col}';targetfield=camel(pk);field=camel(col)
        action='SetNull' if ('nullOnDelete' in constraint or "onDelete('set null')" in constraint) and f.get('optional') else 'Cascade' if 'cascadeOnDelete' in constraint or "onDelete('cascade')" in constraint else 'Restrict'
        relations[name].append(f'  ref{field[0].upper()+field[1:]} {model(parent)}'+('?' if f.get('optional') else '')+f' @relation("{rn}", fields: [{field}], references: [{targetfield}], onDelete: {action}, map: "'+hashlib.sha256(rn.encode()).hexdigest()[:24]+'")')
        relations[parent].append(f'  children{model(name)}{field[0].upper()+field[1:]} {model(name)}[] @relation("{rn}")')
for name,t in sorted(tables.items()):
    if not t['fields']: # Referenced-only table with no available physical schema.
        t['fields']={'id':{'name':'id','type':'Int','pk':True,'default':'autoincrement()','source':'unverified-reference'}}
    if not any(f.get('pk') for f in t['fields'].values()):
        t['fields']['id']={'name':'id','type':'Int','pk':True,'default':'autoincrement()','source':'reconstructed-key'}
    lines += [f'// {"Migration definitions available" if t["verifiedCreation"] else "LEGACY/REFERENCE ONLY: reconcile before importing data"}',f'model {t["model"]} {{']
    seen=set()
    for col,f in t['fields'].items():
        field=f['name']
        if field in seen:continue
        seen.add(field)
        attrs=[]
        if f.get('pk'):attrs.append('@id')
        if f.get('unique') and not f.get('pk'):attrs.append('@unique')
        if f.get('default'):attrs.append('@default('+f['default']+')')
        if field!=col:attrs.append('@map('+json.dumps(col)+')')
        if f['type']=='Decimal':attrs.append('@db.Decimal(18, 4)')
        lines.append('  '+field+' '+f['type']+('?' if f.get('optional') and not f.get('pk') else '')+' '+' '.join(attrs))
    # Tenant filter indexes. Composite legacy constraints need original SQL confirmation.
    tenant=next((f['name'] for col,f in t['fields'].items() if col in ['vendors__id','vendor_id']),None)
    if tenant:lines.append('  @@index(['+tenant+'])')
    if name=='whatsapp_message_logs':lines.append('  @@index([vendorId, contactId, wabPhoneNumberId, contactWaId, isIncomingMessage, messagedAt], map: "node_whatsapp_customer_window_idx")')
    if name=='whatsapp_message_queue':lines.append('  @@index([campaignId, status, id], map: "node_campaign_dispatch_idx")')
    if name=='bot_replies':lines.append('  @@index([vendorId, status, priorityIndex], map: "node_bot_reply_dispatch_idx")')
    if name=='user_active_flows':lines.append('  @@index([phoneNumber, flowId], map: "node_active_flow_participant_idx")')
    lines += relations[name]
    # Native duplicate prevention introduced by the contact-workflows migration.
    native_unique={'group_contacts':['contactId','groupId'],'contact_labels':['contactId','labelsId'],'contact_custom_field_values':['contactId','contactCustomFieldsId']}
    if name in native_unique:lines.append('  @@unique(['+', '.join(native_unique[name])+'])')
    # Preserve compound uniqueness from source, using only parsed column references.
    compound=set()
    for constraint in t['constraints']:
        match=re.search(r'->unique\(\s*\[([^]]+)\]',constraint)
        if match:
            cols=re.findall(r"'([^']+)'",match[1])
            if cols and tuple(cols) not in compound and all(c in t['fields'] for c in cols):
                compound.add(tuple(cols))
                lines.append('  @@unique(['+', '.join(camel(c) for c in cols)+'], map: "'+hashlib.sha256((name+str(cols)).encode()).hexdigest()[:24]+'")')
    lines += ['  @@map('+json.dumps(name)+')','}','']

# Native security/outbox tables are separate from the source inventory.
lines += ['model AuthSessions {','  id String @id @default(uuid())','  userId Int','  tokenHash String @unique',
 '  familyId String','  expiresAt DateTime','  revokedAt DateTime?','  createdAt DateTime @default(now())',
 '  @@index([userId])','  @@map("node_auth_sessions")','}',
 'model VerificationChallenges {','  id String @id @default(uuid())','  userId Int',
 '  kind String','  codeHash String','  attempts Int @default(0)','  expiresAt DateTime','  consumedAt DateTime?',
 '  createdAt DateTime @default(now())','  @@index([userId, kind])','  @@map("node_verification_challenges")','}',
 'model OutboxJobs {','  id String @id @default(uuid())','  vendorId Int?','  kind String','  payload Json',
 '  status String @default("pending")','  attempts Int @default(0)','  availableAt DateTime @default(now())',
 '  lockedAt DateTime?','  lastError String?','  dedupeKey String? @unique','  createdAt DateTime @default(now())',
 '  @@index([status, availableAt])','  @@map("node_outbox_jobs")','}',
 'model WebhookReceipts {','  id String @id @default(uuid())','  provider String','  eventKey String @unique',
 '  payload Json','  processedAt DateTime?','  createdAt DateTime @default(now())','  @@map("node_webhook_receipts")','}',
 'model IntegrationCredentials {','  id String @id @default(uuid())','  vendorId Int','  provider String',
 '  externalId String','  secret String','  metadata Json?','  createdAt DateTime @default(now())',
 '  updatedAt DateTime @updatedAt','  @@unique([vendorId, provider, externalId])','  @@unique([provider, externalId])',
 '  @@map("node_integration_credentials")','}',
 'model AuditEvents {','  id String @id @default(uuid())','  vendorId Int?','  actorId Int?',
 '  action String','  resource String','  resourceId String?','  metadata Json?',
 '  createdAt DateTime @default(now())','  @@index([vendorId, createdAt])','  @@map("node_audit_events")','}',
 'model ApiKeys {','  id String @id @default(uuid())','  vendorId Int','  userId Int','  keyHash String @unique',
 '  permissions Json','  expiresAt DateTime?','  revokedAt DateTime?','  createdAt DateTime @default(now())',
 '  @@index([vendorId])','  @@map("node_api_keys")','}',
 'model NativeMemberships {','  id String @id @default(uuid())','  vendorId Int','  userId Int','  role String',
 '  permissions Json','  active Boolean @default(true)','  @@unique([vendorId, userId])',
 '  @@map("node_memberships")','}',
 'model NativeBookingClaims {','  id String @id @default(uuid())','  vendorId Int','  resourceId Int',
 '  appointmentId Int','  slot DateTime','  @@unique([vendorId, resourceId, slot])',
 '  @@map("node_booking_claims")','}',
 'model NativeIdempotency {','  id String @id @default(uuid())','  vendorId Int','  key String',
 '  requestHash String','  response Json?','  createdAt DateTime @default(now())',
 '  @@unique([vendorId, key])','  @@map("node_idempotency")','}',
 'model NativeMedia {','  id String @id @default(uuid())','  vendorId Int','  ownerId Int',
 '  path String','  mimeType String','  size Int','  originalName String','  createdAt DateTime @default(now())',
 '  @@index([vendorId])','  @@map("node_media")','}',
 'model NativeChannelMessages {','  id String @id @default(uuid())','  vendorId Int','  contactId Int',
 '  provider String','  externalAccountId String','  externalMessageId String? @unique','  text String?',
 '  incoming Boolean','  status String','  createdAt DateTime @default(now())',
 '  @@index([vendorId, contactId, createdAt])','  @@map("node_channel_messages")','}']
(ROOT/'prisma').mkdir(exist_ok=True)
schema_output = ROOT/'prisma/schema.prisma' if args.write_schema else OUT/'schema-source.prisma'
schema_output.write_text('\n'.join(lines)+'\n',encoding='utf-8')
# Preserve Python, with hashes proving the original source was copied unchanged.
python_out=ROOT/'python';python_out.mkdir(exist_ok=True);hashes={}
for p in (SOURCE/'whalexy-ai-rag').glob('*'):
    if p.is_file():shutil.copy2(p,python_out/p.name);hashes[p.name]=hashlib.sha256(p.read_bytes()).hexdigest()
(OUT/'python-hashes.json').write_text(json.dumps(hashes,indent=2),encoding='utf-8')
print(json.dumps({'tables':len(tables),'routes':len(routes),'controllerMethods':len(methods),'modules':len(modules),'pythonFiles':list(hashes)}))
