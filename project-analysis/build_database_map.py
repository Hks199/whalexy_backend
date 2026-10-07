"""Read-only source extraction; writes documentation only in this directory."""
from pathlib import Path
import re, json, html

ROOT = Path(r'D:\mombius bloom\whalexy')
OUT = Path(__file__).resolve().parent
tables, edges, models = {}, {}, {}

def clean(s):
    s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)
    return re.sub(r'^\s*//.*$', '', s, flags=re.M)

def table(name, source):
    if not re.fullmatch(r'[a-z][a-z0-9_]*', name):
        return None
    rec = tables.setdefault(name, {'name': name, 'sources': set(), 'columns': set(), 'created': False})
    rec['sources'].add(source)
    return rec

def edge(child, parent, column, target, kind, source):
    if child not in tables or parent not in tables:
        return
    key = (child, parent, column, target)
    rank = {'declared': 3, 'application': 2, 'inferred': 1}
    if key not in edges or rank[kind] > rank[edges[key]['kind']]:
        edges[key] = dict(child=child, parent=parent, column=column, target=target, kind=kind, source=source)

def block(s, start):
    pos = s.find('{', start)
    if pos < 0: return ''
    depth, quote, esc = 0, None, False
    for i in range(pos, len(s)):
        c = s[i]
        if quote:
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == quote: quote = None
        elif c in "'\"": quote = c
        elif c == '{': depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0: return s[pos+1:i]
    return ''

files = sorted(list((ROOT/'app').rglob('*.php')) + list((ROOT/'database/migrations').glob('*.php')))
texts = []
for p in files:
    s = clean(p.read_text(encoding='utf-8', errors='replace'))
    src = p.relative_to(ROOT).as_posix()
    texts.append((src, s))
    for m in re.finditer(r"(?:Schema::(?:create|table|hasTable)|DB::table)\(\s*'([a-z][a-z0-9_]*)(?:\s+as\s+\w+)?'", s):
        table(m[1], src)
    m = re.search(r"protected\s+\$table\s*=\s*'([^']+)'", s)
    cls = re.search(r'class\s+(\w+)\s+extends', s)
    if m:
        table(m[1], src)
        if cls: models[cls[1]] = m[1]

# Only inspect migration up() bodies, excluding rollback definitions.
for src, s in texts:
    if not src.startswith('database/migrations/'): continue
    s = re.split(r'function\s+down\s*\(', s)[0]
    tenant = re.search(r'\$tenantColumns\s*=\s*static\s+function', s)
    common = block(s, tenant.start()) if tenant else ''
    for m in re.finditer(r"Schema::(create|table)\(\s*'([^']+)'", s):
        rec = table(m[2], src)
        body = block(s, m.end())
        if '$tenantColumns($table)' in body: body += '\n' + common
        if m[1] == 'create': rec['created'] = True
        rec['columns'].update(re.findall(r"\$table->\w+\(\s*'([^']+)'", body))
        for fk in re.finditer(r"\$table->foreign\(\s*'([^']+)'[^;]*?->references\(\s*'([^']+)'\s*\)[^;]*?->on\(\s*'([^']+)'\s*\)", body, re.S):
            edge(m[2], fk[3], fk[1], fk[2], 'declared', src)
        for fk in re.finditer(r"\$table->foreignId\(\s*'([^']+)'\s*\)[^;]*?->constrained\(\s*'([^']+)'\s*\)", body, re.S):
            edge(m[2], fk[2], fk[1], 'id', 'declared', src)

# Resolve models using convention only when their inferred table is in the inventory.
for src, s in texts:
    cls = re.search(r'class\s+(\w+)\s+extends', s)
    if cls and cls[1] not in models:
        name = re.sub(r'(?<!^)(?=[A-Z])', '_', cls[1]).lower()
        for candidate in (name+'s', name):
            if candidate in tables: models[cls[1]] = candidate; break
for src, s in texts:
    cls = re.search(r'class\s+(\w+)\s+extends', s)
    own = models.get(cls[1]) if cls else None
    if not own: continue
    for m in re.finditer(r"\$this->(belongsTo|hasMany|hasOne)\(\s*(\w+)::class\s*,\s*'([^']+)'\s*,\s*'([^']+)'", s):
        other = own if m[2] == 'self' else models.get(m[2])
        if not other: continue
        if m[1] == 'belongsTo': edge(own, other, m[3], m[4], 'application', src)
        else: edge(other, own, m[3], m[4], 'application', src)

# Column-name inference is explicitly separate from declared FK/model evidence.
targets = {'vendors__id': ('vendors','_id'), 'vendor_id': ('vendors','_id'),
 'organization_id': ('vendors','_id'), 'contacts__id': ('contacts','_id'),
 'users__id': ('users','_id'), 'created_by': ('users','_id'), 'updated_by': ('users','_id'),
 'assigned_users__id': ('users','_id'), 'accepted_by_users__id': ('users','_id'),
 'updated_by_users__id': ('users','_id'), 'created_by_users__id': ('users','_id'),
 'appointment_service_id': ('whalexy_appointment_services','_id'),
 'appointment_resource_id': ('whalexy_appointment_resources','_id'),
 'appointment_id': ('whalexy_appointments','_id'), 'agent_id': ('users','_id'),
 'call_id': ('whatsapp_calls','id')}
for name, rec in list(tables.items()):
    for col in rec['columns']:
        if col in targets:
            parent, pk = targets[col]
            edge(name, parent, col, pk, 'inferred', next(iter(sorted(rec['sources']))))

# Older schema relationships evidenced by model methods, campaign creation and joins.
manual = [
 ('vendor_users','users','users__id','_id','app/Yantrana/Components/Auth/Models/AuthModel.php'),
 ('vendor_users','vendors','vendors__id','_id','app/Yantrana/Components/Auth/Models/AuthModel.php'),
 ('group_contacts','contacts','contacts__id','_id','app/Yantrana/Components/Contact/Models/ContactGroupModel.php'),
 ('group_contacts','contact_groups','contact_groups__id','_id','app/Yantrana/Components/Contact/Models/ContactGroupModel.php'),
 ('contact_labels','contacts','contacts__id','_id','app/Yantrana/Components/Contact/Models/ContactModel.php'),
 ('contact_labels','labels','labels__id','_id','app/Yantrana/Components/Contact/Models/ContactModel.php'),
 ('contact_custom_field_values','contacts','contacts__id','_id','app/Yantrana/Components/Contact/Models/ContactModel.php'),
 ('contacts','vendors','vendors__id','_id','app/Yantrana/Components/Contact/Repositories/ContactRepository.php'),
 ('contact_groups','vendors','vendors__id','_id','app/Yantrana/Components/Contact/Repositories/ContactGroupRepository.php'),
 ('campaigns','vendors','vendors__id','_id','app/Yantrana/Components/Campaign/Repositories/CampaignRepository.php'),
 ('vendor_settings','vendors','vendors__id','_id','app/Yantrana/Components/Vendor/Repositories/VendorSettingsRepository.php'),
 ('whatsapp_templates','vendors','vendors__id','_id','app/Yantrana/Components/WhatsAppService/Repositories/WhatsAppTemplateRepository.php'),
 ('whatsapp_message_logs','vendors','vendors__id','_id','app/Yantrana/Components/WhatsAppService/Models/WhatsAppMessageLogModel.php'),
 ('users','vendors','current_vendor_id','_id','app/Yantrana/Support/app-helpers.php'),
 ('whatsapp_calls','contacts','contact_uid','_uid','app/Services/WhatsAppCallingService.php'),
]
for child,parent,col,pk,src in manual: edge(child,parent,col,pk,'application',src)

groups = {
 'Accounts and platform': 'vendors users user_roles vendor_users vendor_settings configurations countries login_logs activity_logs token_registry user_authorities pending_registrations verifications',
 'Contacts and messages': 'contacts contact_groups group_contacts labels contact_labels contact_custom_fields contact_custom_field_values whatsapp_onboarding_connections whatsapp_templates whatsapp_message_logs whatsapp_message_queue instagram_message_logs whatsapp_blue_tick_applications',
 'Campaigns and automation': 'campaigns campaign_groups bot_flows bot_replies user_active_flows bot_flow_message_receipts whatsapp_flow_launch_settings whatsapp_flow_responses out_of_office_settings out_of_office_schedules out_of_office_deliveries comment_to_dm_automations comment_to_dm_executions google_sheet_automations',
 'Catalog and orders': 'catalogs catalog_connections categories brands collections products product_images product_variants collection_products product_tags catalog_imports catalog_exports catalog_sync_logs catalog_activity_logs catalog_settings whatsapp_orders whatsapp_payments whatsapp_user_states',
 'Store integrations': 'shopify_integrations shopify_orders shopify_order_notifications woocommerce_integrations woocommerce_orders woocommerce_order_notifications',
 'Appointments': 'whalexy_appointment_services whalexy_appointment_resources whalexy_appointment_service_resources whalexy_appointment_schedules whalexy_appointment_schedule_exceptions whalexy_appointments whalexy_appointment_holds whalexy_appointment_slot_claims whalexy_appointment_automation_settings whalexy_appointment_conversation_states whalexy_appointment_reminder_deliveries',
 'AI and subscriptions': 'conversation_ai_analysis conversation_cx_scores conversation_classifications conversation_classification_tags conversation_classification_logs ai_conversation_handoffs vendor_ai_usages vendor_ai_monthly_invoices ai_operation_traces subscriptions subscription_items manual_subscriptions subscription_addons',
 'Advertising': 'ad_accounts ad_campaigns ad_sets ads ad_creatives creative_assets audiences audience_rules campaign_metrics campaign_daily_metrics conversions conversion_events reports budgets ad_notifications campaign_logs campaign_templates ad_labels ad_campaign_label ad_conversation_attributions',
 'Calling': 'whatsapp_calling_settings whatsapp_calls whatsapp_call_events whatsapp_call_artifacts',
 'Content and infrastructure': 'pages blog_posts blog_categories blog_tags blog_post_tag jobs failed_jobs migrations',
}
assigned = {}
for group, names in groups.items():
    for name in names.split(): assigned[name] = group
for name, rec in tables.items():
    rec['group'] = assigned.get(name, 'Other source references')
    rec['sources'] = sorted(rec['sources'])
    rec['columns'] = sorted(rec['columns'])
data = {'root':str(ROOT), 'tables':sorted(tables.values(), key=lambda r:(r['group'],r['name'])),
 'edges':sorted(edges.values(), key=lambda e:(e['child'],e['parent'],e['column']))}
(OUT/'database-map.json').write_text(json.dumps(data,indent=2),encoding='utf-8')

flow = '''flowchart TD
    Login[Login / registration] --> Access[Select business and validate team permissions]
    Access --> Inbox[Contacts and inbox]
    Meta[Meta incoming webhooks] --> Resolve[Resolve business and connected number]
    Resolve --> Inbox
    Inbox --> History[Persist message history and update contact state]
    History --> Auto[Evaluate bots, away responses and comment automation]
    History --> AI[Analyze conversation / generate AI reply / human handoff]
    AI --> Usage[Record AI usage and operation traces]
    Usage --> Invoice[Aggregate monthly AI invoice]
    Auto --> Send[Send through Meta and record result]
    AI --> Send
    Access --> Broadcast[Campaign + template + selected groups]
    Broadcast --> Queue[Create recipient queue records]
    Queue --> Worker[Scheduler / worker]
    Worker --> Send
    Send --> Status[Delivery/read webhooks update message records]
    Access --> Catalog[Catalog and product synchronization]
    Catalog --> Order[Order snapshot and checkout state]
    Stores[Shopify / WooCommerce webhooks] --> StoreOrder[Store orders and notification records]
    StoreOrder --> Send
    Order --> Pay[Payment attempts and payment webhooks]
    Pay --> Confirm[Update order and send confirmation]
    Confirm --> Send
    Inbox --> Booking[Check service, resource, schedule and exceptions]
    Booking --> Hold[Temporary hold]
    Hold --> Appointment[Appointment and unique slot claims]
    Appointment --> Reminder[Scheduled reminder delivery]
    Reminder --> Send
    Access --> Ads[Ad account, campaign, set, creative and ad]
    Ads --> Metrics[Sync metrics / reports / conversions]
    Resolve --> Attribution[Capture ad referral attribution]
    Attribution --> Metrics
    Inbox --> Call[Calling permission and signaling]
    Call --> Events[Call events and artifact records]
'''
lines = ['# Whalexy database relationship map', '',
 f'Source project: `{ROOT}`. Inventory: **{len(tables)} distinct literal table names** discovered in migrations, explicit model table declarations, and literal DB/Schema references under app/.', '',
 'This is a source-derived map, not a live database export. The missing legacy SQL snapshot prevents an exhaustive physical schema audit. Tables referenced by code may be optional, legacy, or not installed. Column lists contain migration-observed names, not complete physical schemas. No source relationships were invented merely to connect isolated tables.', '',
 'Arrows point from the referencing table to its referenced table. Solid arrows: FK declared in migration source. Dashed arrows: Eloquent/application relationship. Dotted arrows: candidate association inferred from a reference-column name; verify against the live schema. Cardinality is deliberately omitted where uniqueness/nullability is not established. Shared audit/business edges are included.', '',
 '## Combined table diagram', '', '```mermaid', 'flowchart LR']
names = sorted(tables)
ids = {n:f't{i}' for i,n in enumerate(names)}
for i, group in enumerate(sorted({r['group'] for r in tables.values()})):
    lines.append(f'    subgraph g{i}["{group}"]')
    for n in names:
        if tables[n]['group'] == group: lines.append(f'        {ids[n]}["{n}"]')
    lines.append('    end')
for e in data['edges']:
    a,b = ids[e['child']],ids[e['parent']]
    if e['kind']=='declared': lines.append(f'    {a} -->|"{e["column"]}"| {b}')
    elif e['kind']=='application': lines.append(f'    {a} -. "APP: {e["column"]}" .-> {b}')
    else: lines.append(f'    {a} -. "INFER: {e["column"]}" .-> {b}')
lines += ['```','','## Operational flow (actions, not foreign keys)','','```mermaid',flow,'```','','## Relationship register','','| Referencing table.column | Referenced table.column | Evidence | Source |','|---|---|---|---|']
for e in data['edges']:
    lines.append(f'| `{e["child"]}.{e["column"]}` | `{e["parent"]}.{e["target"]}` | {e["kind"]} | [{e["source"]}]({ROOT.as_posix()}/{e["source"]}) |')
lines += ['','## Complete discovered table inventory','','| Table | Module | CREATE migration found | Source |','|---|---|---|---|']
for n in names:
    r=tables[n]; src=r['sources'][0]
    lines.append(f'| `{n}` | {r["group"]} | {"Yes" if r["created"] else "No; legacy/reference only"} | [{src}]({ROOT.as_posix()}/{src}) |')
(OUT/'DATABASE_RELATIONSHIPS.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')

template = r'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Whalexy database map</title>
<style>*{box-sizing:border-box}body{margin:0;font:14px system-ui;background:#0d1424;color:#e6edf9}header{padding:20px 24px;background:#131f35;border-bottom:1px solid #32415c}h1{font-size:23px;margin:0 0 8px}p{line-height:1.55;max-width:1100px}button,input,select{font:inherit;padding:8px;border:1px solid #536781;border-radius:6px;background:#172840;color:white}button{cursor:pointer}nav{display:flex;gap:12px;flex-wrap:wrap;align-items:center}main{display:grid;grid-template-columns:minmax(0,1fr) 370px;height:calc(100vh - 220px)}#canvas{overflow:auto;padding:12px}aside{overflow:auto;background:#131f35;padding:16px;border-left:1px solid #32415c}svg text{fill:#e6edf9}svg .node{cursor:pointer}svg .node:hover rect{stroke:#fff;stroke-width:2}.muted{color:#acbcd4}#details{overflow-wrap:anywhere}li{margin:7px 0}a{color:#8cbeff}#flows{display:none;padding:24px}.flow{border:1px solid #52627b;border-radius:8px;padding:16px;margin-bottom:12px;line-height:1.8}.small{font-size:12px}#tableList button{display:block;text-align:left;width:100%;margin:5px 0;font-size:12px}@media(max-width:800px){main{grid-template-columns:1fr;height:auto}aside{height:450px}#canvas{height:650px}}</style>
<header><h1>Whalexy — combined database relationship map</h1><p class="muted">Source-derived inventory; the legacy SQL snapshot is missing. Solid blue = migration-declared FK; dashed green = application/model link; dotted amber = inferred candidate. Arrows point from child/reference to parent/target. Select a table to inspect its links and sources.</p><nav><button id="mapBtn">Relationships</button><button id="flowBtn">Business flows</button><input id="search" placeholder="Search tables" aria-label="Search tables"><select id="group" aria-label="Module"><option value="">All modules</option></select><label><input id="ownership" type="checkbox"> Business/user links</label><label><input id="inferred" type="checkbox" checked> Inferred links</label><label>Zoom <input id="zoom" type="range" min="40" max="160" value="80"></label><button id="reset">Reset selection</button><span id="stats"></span></nav></header>
<main id="map"><div id="canvas"><svg id="svg" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Database table relationships"></svg></div><aside><div id="details">Select a table. Ownership edges are hidden initially for readability; enable Business/user links to see them.</div><h3>Tables</h3><div id="tableList"></div></aside></main>
<section id="flows"><h2>Operational flow design</h2><p>These arrows show processing order, not database constraints.</p>
<div class="flow"><b>Access:</b> users / user_roles → vendor_users → select vendors → vendor_settings → authorized business operations.</div>
<div class="flow"><b>Messaging:</b> Meta webhook → resolve whatsapp_onboarding_connections → find/create contacts → whatsapp_message_logs or instagram_message_logs → update inbox → bots / away responses / AI → send reply → delivery webhook updates.</div>
<div class="flow"><b>Broadcast:</b> whatsapp_templates + campaigns + selected contact_groups → group_contacts → resolve contacts → whatsapp_message_queue → worker → whatsapp_message_logs → delivery status and campaign reporting. campaign_groups is a legacy model table with no confirmed direct links extracted.</div>
<div class="flow"><b>Automation:</b> message / comment → bot_flows + bot_replies + user_active_flows OR comment_to_dm_automations + comment_to_dm_executions OR out_of_office_settings + schedules + deliveries → send response. WhatsApp forms persist submissions separately in whatsapp_flow_responses.</div>
<div class="flow"><b>Commerce:</b> catalogs + catalog_connections → products → incoming order → whatsapp_orders (JSON item snapshot) + whatsapp_user_states → whatsapp_payments → payment webhook → update order → confirmation.</div>
<div class="flow"><b>Store integration:</b> Shopify/WooCommerce webhook → corresponding integration → store order → order notification record → WhatsApp send and status tracking.</div>
<div class="flow"><b>Appointment:</b> service + resource → schedules / exceptions / existing claims → hold → appointment + unique slot claims → reminder delivery → WhatsApp notification.</div>
<div class="flow"><b>AI:</b> contact messages → conversation_ai_analysis / classification / CX score → optional ai_conversation_handoffs → vendor_ai_usages + ai_operation_traces → aggregate vendor_ai_monthly_invoices.</div>
<div class="flow"><b>Advertising:</b> ad_accounts → ad_campaigns → ad_sets + ad_creatives → ads → metrics / conversions / reports. Incoming referral → ad_conversation_attributions → attribution reporting.</div>
<div class="flow"><b>Calling:</b> whatsapp_calling_settings → agent authorization + browser signaling → whatsapp_calls → whatsapp_call_events → whatsapp_call_artifacts → retention cleanup.</div>
</section><script>
const data=__DATA__, NS='http://www.w3.org/2000/svg', svg=document.querySelector('#svg');let selected=null;
const $=id=>document.getElementById(id), esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const groups=[...new Set(data.tables.map(t=>t.group))];for(const g of groups){const o=document.createElement('option');o.value=g;o.textContent=g;$('group').append(o)}
function el(tag,attrs={},text){const n=document.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;return n}
function show(name){selected=name;const t=data.tables.find(t=>t.name===name),links=data.edges.filter(e=>e.child===name||e.parent===name);$('details').innerHTML='<h2>'+esc(name)+'</h2><p>'+esc(t.group)+'</p><p>'+ (t.created?'CREATE migration found.':'Legacy/reference only; full schema unavailable.')+'</p><h3>Relationships ('+links.length+')</h3><ul>'+links.map(e=>'<li><b>'+esc(e.kind)+'</b>: '+esc(e.child+'.'+e.column)+' → '+esc(e.parent+'.'+e.target)+'</li>').join('')+'</ul><h3>Migration-observed names</h3><p class="small">'+esc(t.columns.join(', ')||'No column definitions extracted.')+'</p><h3>Sources</h3><ul>'+t.sources.map(s=>'<li class="small">'+esc(s)+'</li>').join('')+'</ul>';draw()}
function draw(){svg.replaceChildren();const query=$('search').value.toLowerCase(),filter=$('group').value;const visible=data.tables.filter(t=>(!filter||t.group===filter)&&t.name.includes(query));const pos=new Map(), activeGroups=groups.filter(g=>visible.some(t=>t.group===g));const colW=630,nodeW=540,rowH=40,gap=32;let y=20,maxH=0;
 const defs=el('defs');for(const[k,c]of Object.entries({declared:'#78aaff',application:'#69d8ba',inferred:'#e9b65f'})){const m=el('marker',{id:k,viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:7,markerHeight:7,orient:'auto-start-reverse'});m.append(el('path',{d:'M 0 0 L 10 5 L 0 10 z',fill:c}));defs.append(m)}svg.append(defs);
 for(let r=0;r<activeGroups.length;r+=3){let h=0;for(let c=0;c<3;c++){const g=activeGroups[r+c];if(!g)continue;const ts=visible.filter(t=>t.group===g),x=20+c*colW,gh=60+ts.length*rowH;h=Math.max(h,gh);svg.append(el('rect',{x,y,width:colW-gap,height:gh,rx:12,fill:'#111e33',stroke:'#34465f'}));svg.append(el('text',{x:x+16,y:y+28,'font-weight':700},g));ts.forEach((t,i)=>pos.set(t.name,{x:x+18,y:y+44+i*rowH,w:nodeW,h:30}))}y+=h+gap}maxH=y;const edgeLayer=el('g');svg.append(edgeLayer);
 for(const e of data.edges){const a=pos.get(e.child),b=pos.get(e.parent);if(!a||!b)continue;if(!$('ownership').checked&&['vendors','users'].includes(e.parent))continue;if(!$('inferred').checked&&e.kind==='inferred')continue;const hit=!selected||e.child===selected||e.parent===selected;const color={declared:'#78aaff',application:'#69d8ba',inferred:'#e9b65f'}[e.kind];let d;if(e.child===e.parent){d=`M ${a.x+a.w} ${a.y+8} C ${a.x+a.w+35} ${a.y-20}, ${a.x+a.w+35} ${a.y+50}, ${a.x+a.w} ${a.y+22}`}else{const sx=a.x+a.w,sy=a.y+15,tx=b.x+b.w,ty=b.y+15;d=`M ${sx} ${sy} C ${sx+35} ${sy}, ${tx+35} ${ty}, ${tx} ${ty}`}const p=el('path',{d,fill:'none',stroke:color,'stroke-width':hit&&selected?2.5:1,'stroke-opacity':hit?.7:.07,'marker-end':`url(#${e.kind})`,'stroke-dasharray':e.kind==='application'?'7 5':e.kind==='inferred'?'2 5':''});p.append(el('title',{},`${e.kind}: ${e.child}.${e.column} → ${e.parent}.${e.target}`));edgeLayer.append(p)}
 for(const t of visible){const p=pos.get(t.name),g=el('g',{class:'node',tabindex:0,role:'button','aria-label':t.name});const related=!selected||selected===t.name||data.edges.some(e=>(e.child===selected&&e.parent===t.name)||(e.parent===selected&&e.child===t.name));g.setAttribute('opacity',related?1:.35);g.append(el('rect',{x:p.x,y:p.y,width:p.w,height:p.h,rx:5,fill:selected===t.name?'#28496e':'#1b2c46',stroke:selected===t.name?'#fff':'#4a5b72'}));g.append(el('text',{x:p.x+10,y:p.y+20,'font-size':12},t.name));g.addEventListener('click',()=>show(t.name));g.addEventListener('keydown',e=>{if(e.key==='Enter')show(t.name)});svg.append(g)}
 svg.setAttribute('viewBox',`0 0 1900 ${maxH}`);svg.style.width=1900*Number($('zoom').value)/100+'px';svg.style.height=maxH*Number($('zoom').value)/100+'px';$('stats').textContent=`${visible.length}/${data.tables.length} tables · ${data.edges.length} source relationships`;$('tableList').replaceChildren();for(const t of visible){const b=document.createElement('button');b.textContent=t.name;b.onclick=()=>show(t.name);$('tableList').append(b)}}
for(const id of ['search','group','ownership','inferred','zoom'])$(id).addEventListener('input',draw);$('reset').onclick=()=>{selected=null;$('details').textContent='Select a table to inspect relationships and sources.';draw()};$('mapBtn').onclick=()=>{$('map').style.display='grid';$('flows').style.display='none'};$('flowBtn').onclick=()=>{$('map').style.display='none';$('flows').style.display='block'};draw();
</script></html>'''
(OUT/'database-map.html').write_text(template.replace('__DATA__',json.dumps(data).replace('<','\\u003c')),encoding='utf-8')
print(json.dumps({'tables':len(tables),'relationships':len(edges),'evidence':{k:sum(e['kind']==k for e in edges.values()) for k in ['declared','application','inferred']},'files':['database-map.html','DATABASE_RELATIONSHIPS.md','database-map.json']}))
