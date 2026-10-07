"""Copy literal PHP preset/permission arrays without executing PHP or touching source."""
from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT.parent / 'whalexy'

def literal_array(text):
    text = re.sub(r'//[^\n]*', '', text)
    tokens = re.findall(r"'(?:\\.|[^'])*'|=>|\[|\]|,|\bnull\b", text)
    remainder = re.sub(r"'(?:\\.|[^'])*'|=>|\[|\]|,|\bnull\b|\s+", '', text)
    if remainder:
        raise ValueError('Only literal string arrays may be extracted')
    position = 0
    def parse():
        nonlocal position
        if tokens[position] != '[':
            if tokens[position] == 'null':
                position += 1
                return None
            value = tokens[position][1:-1].replace("\\'", "'"); position += 1
            return value
        position += 1
        mapping, sequence = {}, []
        while tokens[position] != ']':
            value = parse()
            if tokens[position] == '=>':
                position += 1; mapping[value] = parse()
            else:
                sequence.append(value)
            if tokens[position] == ',':
                position += 1
        position += 1
        if mapping and sequence:
            raise ValueError('Mixed PHP arrays are unsupported')
        return mapping if mapping else sequence
    value = parse()
    if position != len(tokens):
        raise ValueError('Trailing tokens')
    return value

classification = (SOURCE / 'app/Yantrana/Components/ConversationClassification/Services/ConversationClassificationEngine.php').read_text(encoding='utf-8')
presets = literal_array(classification.split('public static function getPresets(): array', 1)[1].split('return ', 1)[1].split(';', 1)[0])
permissions = literal_array((SOURCE / 'config/vendor_permissions.php').read_text(encoding='utf-8').split('return ', 1)[1].rsplit(';', 1)[0])
(ROOT / 'src/data/classification-presets.ts').write_text('export const classificationPresets = '+json.dumps(presets, ensure_ascii=False, indent=2)+' as const;\n', encoding='utf-8')
(ROOT / 'migration/source-permissions.json').write_text(json.dumps(permissions, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print(json.dumps({'classificationGroups': len(presets), 'sourceRoles': len(permissions['roles']), 'legacyAliases': len(permissions['legacy_aliases'])}))
