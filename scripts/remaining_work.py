"""Count audited work areas without treating route declarations as features."""
from collections import Counter
from pathlib import Path
import json

root = Path(__file__).resolve().parent.parent
text = (root / 'migration/FEATURE_PARITY.md').read_text(encoding='utf-8')
section = text.split('## Remaining parity work by source module', 1)[1].split('## Acceptance gate', 1)[0]
areas = []
for line in section.splitlines():
    if line.startswith('| '):
        cells = [cell.strip() for cell in line.strip('|').split('|')]
        # Markdown formatting may pad headers and separator cells.
        if len(cells) < 2 or cells[0] == 'Module' or not cells[0].strip('-: '):
            continue
        areas.append({'area': cells[0], 'remaining': cells[1]})
audit = json.loads((root / 'migration/backend-audit.json').read_text(encoding='utf-8'))
parity = json.loads((root / 'migration/parity-report.json').read_text(encoding='utf-8'))
counts = Counter(module['status'] for module in audit['modules'])
progress_path = root / 'migration/contract-progress.json'
progress = json.loads(progress_path.read_text(encoding='utf-8')) if progress_path.exists() else {}
adapters = progress.get('partialUrlFieldAdapters', 0)
api_file_contracts = [row for row in progress.get('contracts', []) if row.get('source') == 'routes/api.php']
api_file_adapters = sum(row.get('status') == 'partial-url-field-adapter' for row in api_file_contracts)
report = {
    'remainingWorkAreas': len(areas),
    'sourceModules': audit['sourceModules'],
    'partiallyImplementedModules': counts['partial-native-implementation'],
    'modulesWithoutDedicatedPort': counts['no-dedicated-port'] + counts['generic-data-only'],
    'genericDataOnlyModules': counts['generic-data-only'],
    'partialLegacyUrlFieldAdapters': adapters,
    'originalApiFileDeclarations': len(api_file_contracts),
    'originalApiFilePartialAdapters': api_file_adapters,
    'originalApiFileWithoutRecordedAdapters': len(api_file_contracts) - api_file_adapters,
    'contractsWithoutRecordedAdapter': parity['sourceRouteDeclarations'] - adapters,
    'verifiedLegacyContracts': parity['verifiedLegacyContracts'],
    'pendingLegacyContracts': parity['pendingLegacyContracts'],
    'unmetAcceptanceRequirements': parity['unmetAcceptanceRequirements'],
    'countMeaning': 'Grouped audited work areas, not individual features. Partially implemented modules retain source behavior or verification gaps. Route declarations are counted separately. Missing adapter records can overlap implemented native capabilities and do not establish an absent-feature count.',
    'areas': areas,
}
(root / 'migration/remaining-work.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(json.dumps({key: value for key, value in report.items() if key != 'areas'}))
