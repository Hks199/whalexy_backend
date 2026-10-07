// No credential is embedded in the generated source or stored automation.
export function sheetScript(settings: Record<string, unknown>) {
  return (
    'const WHALEXY = ' +
    JSON.stringify(settings) +
    ';\n' +
    String.raw`
function whalexyProperties() { return PropertiesService.getScriptProperties(); }
function whalexySheet() {
  const sheet = SpreadsheetApp.openById(WHALEXY.spreadsheetId).getSheetByName(WHALEXY.sheetName);
  if (!sheet) throw new Error('Configured sheet not found');
  if (!whalexyProperties().getProperty('WHALEXY_API_KEY')) throw new Error('Set WHALEXY_API_KEY in Script Properties');
  return sheet;
}
function createTrigger() {
  const sheet = whalexySheet(), p = whalexyProperties();
  ScriptApp.getProjectTriggers().filter(t => ['checkForNewRows','handleWhalexyEdit'].includes(t.getHandlerFunction())).forEach(t => ScriptApp.deleteTrigger(t));
  if (WHALEXY.triggerType === 'new_row') {
    if (!p.getProperty('whalexyCursor:'+WHALEXY.uid)) p.setProperty('whalexyCursor:'+WHALEXY.uid,String(Math.max(1,sheet.getLastRow())));
    ScriptApp.newTrigger('checkForNewRows').timeBased().everyMinutes(1).create();
  } else ScriptApp.newTrigger('handleWhalexyEdit').forSpreadsheet(WHALEXY.spreadsheetId).onEdit().create();
}
function whalexySendRow(sheet, rowIndex) {
  const width=Math.max(sheet.getLastColumn(),WHALEXY.rowIdColumn+1), row=sheet.getRange(rowIndex,1,1,width).getDisplayValues()[0];
  let rowId=String(row[WHALEXY.rowIdColumn]||'').trim();
  if (!rowId) { rowId=Utilities.getUuid(); sheet.getRange(rowIndex,WHALEXY.rowIdColumn+1).setValue(rowId); SpreadsheetApp.flush(); }
  const response=UrlFetchApp.fetch(WHALEXY.apiUrl,{method:'post',contentType:'application/json',headers:{Authorization:'ApiKey '+whalexyProperties().getProperty('WHALEXY_API_KEY')},payload:JSON.stringify({rowId:rowId,row:row}),muteHttpExceptions:true,followRedirects:false});
  const status=response.getResponseCode(); let body={}; try { body=JSON.parse(response.getContentText()); } catch (_) {}
  if (status<200||status>=300) throw new Error('Whalexy rejected row (HTTP '+status+'): '+(body.error&&body.error.code||'INVALID_RESPONSE'));
  if (!Array.isArray(body.items)) throw new Error('Invalid Whalexy response');
  if (WHALEXY.statusColumn !== undefined) sheet.getRange(rowIndex,WHALEXY.statusColumn+1).setValue(body.items.length?'Queued':'No matching rule');
  sheet.getRange(rowIndex,WHALEXY.phoneColumn+1).setNote(body.items.length?'Queued by Whalexy; delivery is asynchronous':'No matching rule');
}
function checkForNewRows() {
  if (WHALEXY.triggerType!=='new_row') return;
  const lock=LockService.getScriptLock(); lock.waitLock(30000);
  try { const sheet=whalexySheet(),p=whalexyProperties(),key='whalexyCursor:'+WHALEXY.uid,last=sheet.getLastRow();
    let cursor=Number(p.getProperty(key)||1); if(cursor>last) throw new Error('Rows were removed; reconcile the append-only cursor before resuming');
    const deadline=Date.now()+180000;
    for(let i=cursor+1;i<=last&&i<=cursor+50&&Date.now()<deadline;i++){whalexySendRow(sheet,i);p.setProperty(key,String(i));}
  } finally {lock.releaseLock();}
}
function handleWhalexyEdit(event) {
  if (!event||!event.range||WHALEXY.triggerType!=='column_value') return;
  const r=event.range,sheet=r.getSheet(),column=WHALEXY.triggerColumn+1;
  if(sheet.getParent().getId()!==WHALEXY.spreadsheetId||sheet.getName()!==WHALEXY.sheetName||column<r.getColumn()||column>r.getLastColumn())return;
  if(r.getLastRow()-Math.max(2,r.getRow())+1>50)throw new Error('Edit at most 50 data rows per batch');
  const lock=LockService.getScriptLock();lock.waitLock(30000);
  try {whalexySheet();const deadline=Date.now()+180000;for(let i=Math.max(2,r.getRow());i<=r.getLastRow();i++){if(Date.now()>=deadline)throw new Error('Batch time limit reached; edit remaining rows again');whalexySendRow(sheet,i);}}finally{lock.releaseLock();}
}
function resetTracker() { if(WHALEXY.triggerType==='new_row')whalexyProperties().setProperty('whalexyCursor:'+WHALEXY.uid,'1'); }
function onOpen() { SpreadsheetApp.getUi().createMenu('Whalexy WhatsApp').addItem('Activate automation','createTrigger').addItem('Process appended rows','checkForNewRows').addItem('Recheck existing rows','resetTracker').addToUi(); }
`
  );
}
