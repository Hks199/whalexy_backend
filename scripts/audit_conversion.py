"""Audit source preservation and migration coverage without claiming endpoint equivalence."""
from pathlib import Path
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT.parent / 'whalexy'
inventory = json.loads((ROOT / 'migration/source-inventory.json').read_text(encoding='utf-8'))
implementations = {
    'Auth': ['src/modules/auth', 'src/middleware/auth.ts', 'src/utils/passwords.ts'],
    'Vendor': ['src/modules/vendors'], 'User': ['src/modules/vendors'],
    'Contact': ['src/modules/contacts', 'src/modules/contact-workflows', 'src/modules/contact-fields', 'src/modules/contacts/services/contact-values.ts', 'src/modules/contacts/services/contact-csv.ts'],
    'WhatsAppService': ['src/modules/messaging', 'src/modules/messaging/services/reactions.ts', 'src/modules/messaging/services/interactive-message.ts', 'src/modules/messaging/services/media-message.ts', 'src/modules/integrations', 'src/modules/webhooks', 'src/jobs'],
    'Campaign': ['src/modules/campaigns', 'src/shared/templates/template-values.ts', 'src/shared/templates/rich-template.ts', 'src/shared/templates/sheet-template.ts', 'src/modules/messaging/services/media-message.ts', 'src/jobs'], 'Appointment': ['src/modules/appointments', 'src/modules/appointment-reminders'],
    'OutOfOffice': ['src/modules/out-of-office'],
    'Media': ['src/modules/media'], 'Dashboard': ['src/modules/dashboard'],
    'AIIntelligence': ['src/modules/ai', 'src/modules/conversation-analysis', 'src/modules/knowledge', 'src/infrastructure/providers/ai.client.ts', 'src/modules/handoffs', 'src/modules/handoffs/services/handoffs.ts'],
    'BotReply': ['src/modules/bot-replies', 'src/modules/bot-flows', 'src/modules/bot-flows/services/bot-graph.ts', 'src/modules/bot-flows/services/bot-graph-runtime.ts', 'src/modules/bot-flows/services/bot-question.ts', 'src/modules/contacts/services/contact-values.ts', 'src/shared/templates/template-values.ts', 'src/modules/bot-flows/services/bot-template.ts', 'src/shared/templates/rich-template.ts', 'src/shared/templates/sheet-template.ts', 'src/modules/bot-flows/services/bot-catalog.ts', 'src/modules/bot-flows/services/bot-meta-flow.ts', 'src/modules/meta-flows/services/meta-flow-message.ts', 'src/modules/flow-data', 'src/modules/catalogs/services/catalog-content.ts', 'src/modules/bot-flows/services/bot-timing.ts', 'src/modules/messaging/services/media-message.ts', 'src/modules/handoffs/services/handoffs.ts', 'src/jobs'],
    'FacebookService': ['src/modules/social-accounts', 'src/modules/integrations'],
    'FacebookChatService': ['src/modules/social-accounts', 'src/modules/comment-automations', 'src/jobs'], 'InstagramService': ['src/modules/social-accounts', 'src/modules/comment-automations', 'src/jobs'],
    'CommentToDm': ['src/modules/comment-automations', 'src/modules/comment-automations/services/comment-events.ts', 'src/jobs'],
    'Integration': ['src/modules/integrations', 'src/modules/meta-signup', 'src/modules/webhooks', 'src/modules/store-orders', 'src/modules/store-notifications', 'src/shared/templates/rich-template.ts', 'src/shared/templates/sheet-template.ts', 'src/shared/templates/template-values.ts', 'src/modules/messaging/services/media-message.ts'],
    'Flows': ['src/modules/meta-flows', 'src/modules/flow-data', 'src/modules/meta-flows/services/flow-encryption.ts', 'src/infrastructure/providers/meta-operations.ts', 'src/modules/meta-flows/services/meta-flow-message.ts', 'src/modules/messaging', 'src/jobs'],
    'Catalog': ['src/modules/catalogs', 'src/modules/messaging', 'src/infrastructure/providers/meta-operations.ts', 'src/jobs'],
    'MetaChannel': ['src/modules/meta-signup'],
    'Subscription': ['src/modules/billing', 'src/modules/manual-billing', 'src/modules/billing-checkout', 'src/modules/stripe-events', 'src/infrastructure/providers/stripe.client.ts', 'src/jobs'],
    'ConversationClassification': ['src/modules/classifications', 'src/data/classification-presets.ts'],
    'CXScore': ['src/modules/cx-scores', 'src/modules/contacts/services/conversation-resolution.ts', 'src/jobs'],
    'Blog': ['src/modules/content', 'src/modules/content/services/article-content.ts'],
    'Page': ['src/modules/content', 'src/modules/content/services/article-content.ts'],
    'Sheets': ['src/modules/sheets', 'src/modules/sheets/services/sheet-script.ts', 'src/shared/templates/sheet-template.ts', 'src/jobs'],
    'TallyIntegration': ['src/modules/tally', 'src/shared/templates/sheet-template.ts', 'src/jobs'],
    'Translation': ['src/modules/translations', 'src/modules/translations/services/translations.ts'],
    'Guide': ['src/modules/guide'],
    'Configuration': ['src/modules/configuration', 'src/modules/configuration/services/site-settings.ts'],
    'Home': ['src/modules/home', 'src/modules/configuration/services/site-settings.ts'],
    'AdsManager': ['src/modules/ads-manager', 'src/modules/ads-manager/services/ad-insights.ts', 'src/modules/ads-manager/services/ad-structure.ts', 'src/modules/ads-manager/services/ad-attribution.ts', 'src/jobs'],
}
generic_only = {'AdsManager', 'CommentToDm', 'Sheets'}


def canonical_files(entry):
    """Expand feature directories to their concrete implementation files."""
    target = ROOT / entry
    if target.is_dir():
        return [file.relative_to(ROOT).as_posix() for file in sorted(target.rglob('*.ts'))]
    return [entry] if target.is_file() else []


methods = Counter()
for method in inventory['controllerMethods']:
    match = re.search(r'app/Yantrana/Components/([^/]+)/', method['source'])
    if match:
        methods[match[1]] += 1
modules = []
for name in inventory['modules']:
    files = sorted({path for entry in implementations.get(name, []) for path in canonical_files(entry)})
    modules.append({'module': name, 'publicControllerMethods': methods[name], 'nodeFiles': files,
                    'status': 'partial-native-implementation' if files else 'generic-data-only' if name in generic_only else 'no-dedicated-port',
                    'verifiedFullParity': False})

hashes = {}
for folder in ['app', 'routes', 'database', 'config', 'bootstrap', 'tests', 'whalexy-ai-rag']:
    for path in sorted((SOURCE / folder).rglob('*')):
        if path.is_file() and path.suffix in {'.php', '.py', '.txt', '.cjs'}:
            hashes[path.relative_to(SOURCE).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
snapshot_path = ROOT / 'migration/original-backend-hashes.json'
old = json.loads(snapshot_path.read_text(encoding='utf-8')) if snapshot_path.exists() else None
changed = [] if old is None else sorted(key for key in set(old) | set(hashes) if old.get(key) != hashes.get(key))
if old is None:
    snapshot_path.write_text(json.dumps(hashes, indent=2), encoding='utf-8')
sql_files = [path.relative_to(SOURCE).as_posix() for path in SOURCE.rglob('*')
             if path.is_file() and '.git' not in path.parts and path.suffix.lower() in {'.sql', '.sqlite', '.sqlite3', '.db'}]
prisma = (ROOT / 'prisma/schema.prisma').read_text(encoding='utf-8')
models = re.findall(r'^model (\w+)\s*\{(.*?)^\}', prisma, re.M | re.S)
reference_only = [table['table'] for table in inventory['tables'] if not table['verifiedCreation']]
minimal_models = [name for name, body in models if len(re.findall(r'^\s+\w+\s+(?:Int|String|Json|Boolean|DateTime|Decimal|Float)\??\b', body, re.M)) <= 2]
report = {'generatedAt': datetime.now(timezone.utc).isoformat(), 'originalProject': str(SOURCE),
          'fullyConverted': False, 'sourceRouteDeclarations': len(inventory['routes']),
          'sourcePublicControllerMethods': len(inventory['controllerMethods']), 'sourceModules': len(modules),
          'sourceTablesDiscovered': len(inventory['tables']), 'prismaModels': len(models),
          'referenceOnlyTables': reference_only, 'minimalReconstructedModels': minimal_models,
          'originalDatabaseFilesFound': sql_files, 'legacyAutoloadAvailable': (SOURCE / 'vendor/autoload.php').is_file(),
          'originalBackendFilesHashed': len(hashes), 'originalSourceChangesSinceSnapshot': changed,
          'modules': modules, 'limitations': ['Static source audit does not execute Laravel behavior.',
                                             'Native feature tests do not verify original URLs, responses or complete workflows.',
                                             'Database models include reconstructed definitions; table presence is not data compatibility.']}
(ROOT / 'migration/backend-audit.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
lines = ['# Backend conversion audit', '', '**Fully converted: no.**', '',
         f"Source: `{SOURCE}`. Found {report['sourceModules']} modules, {report['sourceRouteDeclarations']} route declarations, "
         f"{report['sourcePublicControllerMethods']} public controller methods and {report['sourceTablesDiscovered']} table names.", '',
         f"Prisma has {len(models)} models, including native operational models. {len(reference_only)} source tables lack an available creation migration or SQLite snapshot definition. "
         f"{len(minimal_models)} models have at most two scalar fields and require schema reconciliation.", '',
         f"Original database files found: {len(sql_files)}. Laravel vendor/autoload.php available: {report['legacyAutoloadAvailable']}.", '',
         '## Module coverage', '', '| Source module | Public controller methods | Node status | Full parity verified |', '|---|---:|---|---|']
for module in modules:
    lines.append(f"| {module['module']} | {module['publicControllerMethods']} | {module['status']} | No |")
lines += ['', '## Source preservation', '', f"Hashed {len(hashes)} original backend/test files. Changes since the audit snapshot: {len(changed)}.", '',
          '## Database review required', '', 'Creation definitions missing for: ' + ', '.join(reference_only) + '.', '',
          'Minimal reconstructed models: ' + (', '.join(minimal_models) if minimal_models else 'none detected by the scalar-count heuristic; this does not validate their definitions') + '.', '',
          'This report is conservative. A generic data endpoint is not a converted provider workflow. See FEATURE_PARITY.md for the remaining work.']
(ROOT / 'migration/BACKEND_AUDIT.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
print(json.dumps({key: report[key] for key in ['fullyConverted', 'sourceModules', 'sourceRouteDeclarations', 'sourcePublicControllerMethods', 'sourceTablesDiscovered', 'prismaModels', 'originalBackendFilesHashed', 'originalSourceChangesSinceSnapshot']}))
