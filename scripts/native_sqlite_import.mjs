// Import into a separate validation database. Never overwrite active app/test data.
import { spawnSync,execFileSync } from 'node:child_process';
import { readFileSync,writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import dotenv from 'dotenv';
import { Prisma,PrismaClient } from '@prisma/client';
dotenv.config({quiet:true});
async function main(){
const verify=process.argv.includes('--verify'),apply=process.argv.includes('--apply')||verify,strict=process.argv.includes('--strict');
const result=spawnSync('python',['scripts/sqlite_snapshot_export.py'],{encoding:'utf8',maxBuffer:32*1024*1024});
if(result.status!==0)throw Error('Read-only SQLite export failed');
const records=result.stdout.trim().split(/\r?\n/).map(line=>JSON.parse(line)),start=records[0],end=records.at(-1);
if(start.kind!=='start'||end.kind!=='end'||start.sha256!==end.sha256)throw Error('Incomplete snapshot export');
const sourceRows=records.filter(row=>row.kind==='row');if(sourceRows.length!==end.rows)throw Error('Snapshot row count mismatch');
const models=Prisma.dmmf.datamodel.models,byTable=new Map(models.map(model=>[model.dbName??model.name,model])),byName=new Map(models.map(model=>[model.name,model]));
const roles=JSON.parse(readFileSync('migration/source-permissions.json','utf8'));
const rows=[],quarantine=[],policies=new Map();
function policy(name){policies.set(name,(policies.get(name)??0)+1);}
function hexFloat(value){const m=/^(-?)0x([0-9a-f]+)\.([0-9a-f]+)p([+-]?\d+)$/i.exec(value);if(!m)return Number(value);return (m[1]?-1:1)*(parseInt(m[2],16)+parseInt(m[3],16)/16**m[3].length)*2**Number(m[4]);}
function cell(value){if(value.type==='null')return null;if(value.type==='integer')return value.value;if(value.type==='real')return hexFloat(value.value);if(value.type==='blob')return Buffer.from(value.value,'base64');return value.value;}
function convert(value,field){
  if(value==null){if(!field.isRequired)return field.type==='Json'?Prisma.DbNull:null;if(field.hasDefaultValue)return undefined;throw Error(`required-null:${field.name}`);}
  switch(field.type){
    case 'String':return String(value);
    case 'Int':{const n=Number(value);if(!Number.isInteger(n)||n<-2147483648||n>2147483647)throw Error(`integer-range:${field.name}`);return n;}
    case 'BigInt':return BigInt(value);
    case 'Float':{const n=Number(value);if(!Number.isFinite(n))throw Error(`invalid-number:${field.name}`);return n;}
    case 'Decimal':{const n=new Prisma.Decimal(value);if(!n.isFinite()||n.abs().gte('100000000000000'))throw Error(`decimal-range:${field.name}`);return n;}
    case 'Boolean':if(![0,1,'0','1',true,false].includes(value))throw Error(`invalid-boolean:${field.name}`);return value===1||value==='1'||value===true;
    case 'DateTime':{
      const text=String(value),normalized=/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(text)?`${text.replace(' ','T')}Z`:text;
      const date=new Date(normalized);if(!Number.isFinite(date.getTime()))throw Error(`invalid-date:${field.name}`);return date;
    }
    case 'Json':if(typeof value==='string'){try{return JSON.parse(value)??Prisma.JsonNull;}catch{policy('plain-text-json-preserved');return value;}}return value;
    case 'Bytes':return Buffer.isBuffer(value)?value:Buffer.from(value);
    default:throw Error(`unsupported-type:${field.type}`);
  }
}
for(const original of sourceRows){
  if(createHash('sha256').update(original.payload).digest('hex')!==original.rowHash)throw Error('Source row hash mismatch');
  const model=byTable.get(original.table);
  if(!model){quarantine.push({...original,reason:'missing-model'});continue;}
  const raw=Object.fromEntries(Object.entries(JSON.parse(original.payload)).map(([key,value])=>[key,cell(value)]));
  const data={};
  try{
    for(const field of model.fields.filter(field=>field.kind==='scalar')){
      const column=field.dbName??field.name;let value=raw[column];
      if(model.name==='Users'&&field.name==='name'){value=[raw.first_name,raw.last_name].filter(Boolean).join(' ').trim()||raw.username||`Legacy account ${raw._id}`;policy('user-name-from-legacy-fields');}
      if(['Contacts','ContactGroups'].includes(model.name)&&field.name==='status'&&value==null){value=5;policy('null-status-remains-inactive');}
      if(model.name==='BotReplies'&&field.name==='priorityIndex'&&value==null){value=0;policy('null-bot-priority-zero');}
      if(model.name==='Campaigns'&&field.name==='status'){value='paused';policy('legacy-campaign-paused-for-review');}
      if(model.name==='BotFlows'&&field.name==='status'){value='draft';policy('legacy-flow-disabled-for-conversion');}
      if(model.name==='WhatsappMessageLogs'&&field.name==='messagedAt'&&value==null){value=raw.created_at;policy('message-time-from-created-at');}
      if(!(column in raw)&&value===undefined){if(!field.isRequired||field.hasDefaultValue)continue;}
      const mapped=convert(value,field);if(mapped!==undefined)data[field.name]=mapped;
    }
    rows.push({original,model,data});
  }catch(error){quarantine.push({...original,reason:error.message});}
}
// Reject ambiguous unique keys before loading; no skipDuplicates or silent loss.
for(const model of models){
  const definitions=[...model.fields.filter(field=>field.isUnique||field.isId).map(field=>[field.name]),...model.uniqueFields];
  for(const fields of definitions){const seen=new Map();for(const row of rows.filter(row=>row.model===model&&!row.rejected)){
    const values=fields.map(name=>row.data[name]);if(values.some(value=>value==null))continue;
    const key=JSON.stringify(values,(_,value)=>typeof value==='bigint'?String(value):value);
    if(seen.has(key)){row.rejected=`duplicate-key:${fields.join(',')}`;seen.get(key).rejected=row.rejected;}else seen.set(key,row);
  }}
}
let changed;
do{
  changed=false;
  for(const row of rows.filter(row=>!row.rejected))for(const relation of row.model.fields.filter(field=>field.kind==='object'&&field.relationFromFields.length)){
    const values=relation.relationFromFields.map(name=>row.data[name]);if(values.some(value=>value==null))continue;
    const parent=rows.some(other=>!other.rejected&&other.model.name===relation.type&&relation.relationToFields.every((name,i)=>String(other.data[name])===String(values[i])));
    if(!parent){row.rejected=`missing-parent:${relation.name}`;changed=true;break;}
  }
}while(changed);
for(const row of rows.filter(row=>row.rejected))quarantine.push({...row.original,reason:row.rejected});
const valid=rows.filter(row=>!row.rejected),ordered=[],remaining=new Set(valid.map(row=>row.model.name));
while(remaining.size){
  const ready=[...remaining].filter(name=>!byName.get(name).fields.some(field=>field.kind==='object'&&field.relationFromFields.length&&field.type!==name&&remaining.has(field.type)));
  if(!ready.length)throw Error('Populated foreign-key dependency cycle requires explicit mapping');
  for(const name of ready){ordered.push(name);remaining.delete(name);}
}
const summary={sourceHash:start.sha256,sourceRows:sourceRows.length,nativeRows:valid.length,quarantinedRows:quarantine.length,policies:Object.fromEntries(policies),tables:ordered.map(name=>({model:name,sourceRows:sourceRows.filter(row=>byTable.get(row.table)?.name===name).length,nativeRows:valid.filter(row=>row.model.name===name).length})),quarantineReasons:quarantine.reduce((counts,row)=>{counts[row.reason]=(counts[row.reason]??0)+1;return counts;},{}),applicationDatabaseChanged:false,validationDatabase:null,membershipsImported:0,providerCredentialsActivated:false,existingVerificationProofsPreserved:true};
if(strict&&quarantine.length){writeFileSync('migration/native-import-report.json',JSON.stringify(summary,null,2));console.log(JSON.stringify({nativeRows:valid.length,quarantinedRows:quarantine.length,strictImportBlocked:true}));process.exit(1);}
if(apply){
  const sourceUrl=new URL(process.env.DATABASE_URL),targetUrl=new URL(sourceUrl);targetUrl.pathname='/whalexy_import_validation';
  if(!['127.0.0.1','localhost'].includes(sourceUrl.hostname))throw Error('Validation import requires the isolated local PostgreSQL cluster');
  const admin=new PrismaClient();
  try{
    if(!(await admin.$queryRaw`SELECT 1 FROM pg_database WHERE datname='whalexy_import_validation'`).length){
      if(verify)throw Error('Validation database does not exist; verification cannot create it');
      await admin.$executeRawUnsafe('CREATE DATABASE whalexy_import_validation');
    }
  }finally{await admin.$disconnect();}
  if(!verify)execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env:{...process.env,DATABASE_URL:targetUrl.href},stdio:['ignore','pipe','pipe']});
  const target=new PrismaClient({datasources:{db:{url:targetUrl.href}}});
  try{
    if(!verify)await target.$transaction(async tx=>{
      for(const name of ordered)if(await tx[name[0].toLowerCase()+name.slice(1)].count())throw Error('Validation database already contains data; refusing to overwrite');
      await tx.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS legacy_import');await tx.$executeRawUnsafe('REVOKE ALL ON SCHEMA legacy_import FROM PUBLIC');
      await tx.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS legacy_import.quarantine (source_hash TEXT NOT NULL, table_name TEXT NOT NULL, ordinal INT NOT NULL, reason TEXT NOT NULL, payload TEXT NOT NULL, row_hash TEXT NOT NULL, PRIMARY KEY(source_hash,table_name,ordinal))');
      for(const name of ordered){const data=valid.filter(row=>row.model.name===name).map(row=>row.data);for(let i=0;i<data.length;i+=100)await tx[name[0].toLowerCase()+name.slice(1)].createMany({data:data.slice(i,i+100)});}
      for(const row of quarantine)await tx.$executeRaw`INSERT INTO legacy_import.quarantine VALUES (${start.sha256},${row.table},${row.ordinal},${row.reason},${row.payload},${row.rowHash})`;
      const users=valid.filter(row=>row.model.name==='Users'),vendors=valid.filter(row=>row.model.name==='Vendors');
      for(const {data:user} of users){
        if(!vendors.some(row=>row.data.id===user.vendorId)||![2,3].includes(user.userRolesId))continue;
        const owner=user.userRolesId===2,permissions=owner?['*']:roles.roles.vendor_agent.permissions;
        await tx.nativeMemberships.create({data:{vendorId:user.vendorId,userId:user.id,role:owner?'owner':'agent',permissions,active:user.status===1}});summary.membershipsImported++;
      }
      // Explicit source IDs must not leave PostgreSQL sequences pointing at 1.
      for(const name of ordered){const model=byName.get(name),id=model.fields.find(field=>field.isId&&field.type==='Int'&&field.hasDefaultValue);
        if(id){const table=model.dbName??name,column=id.dbName??id.name,quote=s=>'"'+s.replaceAll('"','""')+'"';await tx.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence($1,$2),COALESCE((SELECT MAX(${quote(column)}) FROM ${quote(table)}),1),true)`,table,column);}
      }
    },{timeout:120000});
    const canonical=value=>value===Prisma.DbNull||value===Prisma.JsonNull?null:value instanceof Date?value.toISOString():value instanceof Prisma.Decimal?value.toString():typeof value==='bigint'?String(value):value;
    const stable=value=>{const v=canonical(value);return Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;};
    for(const name of ordered){
      const actual=await target[name[0].toLowerCase()+name.slice(1)].findMany(),expected=valid.filter(row=>row.model.name===name);
      if(actual.length!==expected.length)throw Error('Native read-back row count mismatch');
      const id=byName.get(name).fields.find(field=>field.isId)?.name;if(!id)throw Error('Native verification requires a primary key');
      const indexed=new Map(actual.map(row=>[String(row[id]),row]));
      for(const row of expected){const saved=indexed.get(String(row.data[id]));if(!saved||Object.entries(row.data).some(([key,value])=>JSON.stringify(stable(value))!==JSON.stringify(stable(saved[key]))))throw Error('Native read-back field mismatch');}
    }
    const saved=await target.$queryRaw`SELECT table_name,ordinal,reason,payload,row_hash FROM legacy_import.quarantine WHERE source_hash=${start.sha256}`;
    const expectedQuarantine=new Map(quarantine.map(row=>[`${row.table}:${row.ordinal}`,row]));
    if(saved.length!==quarantine.length||saved.some(row=>{
      const original=expectedQuarantine.get(`${row.table_name}:${row.ordinal}`);
      return !original||row.payload!==original.payload||row.reason!==original.reason||row.row_hash!==original.rowHash||createHash('sha256').update(row.payload).digest('hex')!==row.row_hash;
    }))throw Error('Quarantine read-back verification failed');
    const vendorIds=new Set(valid.filter(row=>row.model.name==='Vendors').map(row=>row.data.id));
    const expectedMembers=valid.filter(row=>row.model.name==='Users'&&vendorIds.has(row.data.vendorId)&&[2,3].includes(row.data.userRolesId));
    const memberships=await target.nativeMemberships.findMany();
    if(memberships.length!==expectedMembers.length||expectedMembers.some(({data:user})=>{
      const member=memberships.find(row=>row.userId===user.id&&row.vendorId===user.vendorId),owner=user.userRolesId===2;
      return !member||member.role!==(owner?'owner':'agent')||member.active!==(user.status===1)||JSON.stringify(stable(member.permissions))!==JSON.stringify(stable(owner?['*']:roles.roles.vendor_agent.permissions));
    }))throw Error('Membership read-back verification failed');
    summary.membershipsImported=memberships.length;summary.membershipsReadBackVerified=true;summary.validationDatabase='whalexy_import_validation';summary.nativeReadBackVerified=true;summary.nativeFieldReadBackVerified=true;summary.quarantineHashVerified=true;
  }finally{await target.$disconnect();}
}
writeFileSync('migration/native-import-report.json',JSON.stringify(summary,null,2));
console.log(JSON.stringify({sourceRows:summary.sourceRows,nativeRows:summary.nativeRows,quarantinedRows:summary.quarantinedRows,membershipsImported:summary.membershipsImported,validationDatabase:summary.validationDatabase,applicationDatabaseChanged:false}));
}
main().catch(error=>{console.error(JSON.stringify({error:'NATIVE_IMPORT_FAILED',code:typeof error.code==='string'?error.code:'IMPORT_VALIDATION'}));process.exitCode=1;});
