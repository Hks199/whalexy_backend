"""Fail the parity gate until every source contract has verified evidence."""
from pathlib import Path
import json,sys,hashlib
root=Path(__file__).resolve().parent.parent
inventory=json.loads((root/'migration/source-inventory.json').read_text(encoding='utf-8'))
mapping_path=root/'migration/verified-contracts.json'
mapping=json.loads(mapping_path.read_text()) if mapping_path.exists() else {}
results_path=root/'migration/test-results.json'
results=json.loads(results_path.read_text(encoding='utf-8')) if results_path.exists() else {}
acceptance_path=root/'migration/acceptance.json'
acceptance=json.loads(acceptance_path.read_text()) if acceptance_path.exists() else {}
requirements=['databaseCompatibilityVerified','originalFrontendCompatibilityVerified','providerContractsVerified','allDomainWorkflowsReviewed']
unmet=[name for name in requirements if acceptance.get(name) is not True]
passed={}
if results.get('success'):
    for suite in results.get('testResults',[]):
        if suite.get('status')=='passed':
            passed[Path(suite['name']).resolve()]={a['fullName'] for a in suite.get('assertionResults',[]) if a.get('status')=='passed'}
def evidence_valid(evidence,route):
    if not isinstance(evidence,dict) or not evidence.get('nodeEndpoint') or evidence.get('reviewedLegacyBehavior') is not True:return False
    test=(root/evidence.get('testFile','')).resolve()
    if not test.is_relative_to(root) or not test.is_file():return False
    names=evidence.get('testNames')
    if not isinstance(names,list) or not names or not all(name in passed.get(test,set()) for name in names):return False
    source=(root.parent/'whalexy'/route['source']).resolve()
    if not source.is_file() or evidence.get('sourceSha256')!=hashlib.sha256(source.read_bytes()).hexdigest():return False
    files=evidence.get('nodeFiles')
    if not isinstance(files,list) or not files:return False
    for entry in files:
        if not isinstance(entry,dict):return False
        path=(root/entry.get('path','')).resolve()
        if not path.is_relative_to(root) or not path.is_file() or entry.get('sha256')!=hashlib.sha256(path.read_bytes()).hexdigest():return False
        if results_path.stat().st_mtime<path.stat().st_mtime:return False
    return results_path.stat().st_mtime>=test.stat().st_mtime
verified=[];pending=[]
for r in inventory['routes']:
    key=f"{r['source']}:{r['line']}:{r['method']}:{r['localPath']}"
    evidence=mapping.get(key)
    if evidence_valid(evidence,r):verified.append(r)
    else:pending.append(r)
report={'sourceRouteDeclarations':len(inventory['routes']),'verifiedLegacyContracts':len(verified),'pendingLegacyContracts':len(pending),
 'complete':not pending and not unmet,'unmetAcceptanceRequirements':unmet,'pendingRoutes':pending,
 'nativeTestsPassed':results.get('numPassedTests',0),'limitations':['Source group prefixes/includes are inventoried; conditional/package route behavior still needs runtime review.','Views/closures need separate classification.','Executed native tests and manual mappings do not automatically prove behavioral equivalence.','The supplied SQLite snapshot is covered structurally; native data import and constraints still require reconciliation.']}
(root/'migration/parity-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in report.items() if k not in ['pendingRoutes','limitations']}))
sys.exit(0 if report['complete'] else 1)
