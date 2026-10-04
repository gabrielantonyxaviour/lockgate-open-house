"""Verify explicitly selected wallet proof receipts, hashes and source provenance."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--run', action='append', required=True)
parser.add_argument('--source-ref', help='Verify retained source against this Git commit instead of the current working tree.')
args = parser.parse_args()
reference = subprocess.check_output(['git', 'rev-parse', '--verify', args.source_ref + '^{commit}'], cwd=ROOT, text=True).strip() if args.source_ref else None
if reference:
    observed = {str(Path(path).relative_to('app')) for path in subprocess.check_output(
        ['git', 'ls-tree', '-r', '--name-only', reference, '--', 'app/src'], cwd=ROOT, text=True).splitlines()}
else:
    observed = {str(path.relative_to(ROOT / 'app')) for path in (ROOT / 'app/src').rglob('*') if path.is_file()}
results = []
for name in args.run:
    if Path(name).name != name:
        raise ValueError('Expected run directory name')
    directory = ROOT / 'docs/proof/wallet' / name
    data = json.loads((directory / 'manifest.json').read_text())
    assert data['completed'], name
    for field in ['runtimeErrors', 'consoleErrors', 'cleanupErrors']:
        assert not data[field], (name, field, data[field])
    for item in data['artifacts']:
        path = directory / item['file']
        assert path.parent == directory, path
        assert hashlib.sha256(path.read_bytes()).hexdigest() == item['sha256'], path
    receipts = data['receipts']
    assert all(item['status'] == 'success' for item in receipts), name
    signed = [item for item in receipts if 'impersonated' not in item['label']]
    assert all(item['chainId'] == 421614 and int(item['r'], 16) and int(item['s'], 16) for item in signed), name
    source = data['source']
    assert observed == {item['path'] for item in source['files']}, name
    serialized = json.dumps(source['files'], separators=(',', ':'), ensure_ascii=False).encode()
    assert hashlib.sha256(serialized).hexdigest() == source['sourceTreeSha256'], name
    for item in source['files']:
        path = ROOT / 'app' / item['path']
        contents = subprocess.check_output(['git', 'show', f'{reference}:app/{item["path"]}'], cwd=ROOT) if reference else path.read_bytes()
        assert hashlib.sha256(contents).hexdigest() == item['sha256'], path
    results.append({'run': name, 'receipts': len(receipts), 'signedReceipts': len(signed),
                    'browserSigned': sum('browser locally signed' in item['label'] for item in receipts),
                    'engineSignatures': len(data['signatures']), 'artifacts': len(data['artifacts']),
                    'sourceGitHead': source['gitHead'], 'capturedDirtySource': source['dirtySource'],
                    'sourceTreeSha256': source['sourceTreeSha256'],
                    'allHashesMatch': True, 'allReceiptsSuccessful': True,
                    'verifiedSourceRef': reference, 'sourceMatchesCurrent': not bool(reference)})
report = {'passed': True, 'scope': 'Local fork proof, independently checked against retained artifacts and ' + (f'pinned Git source {reference}' if reference else 'current source'), 'runs': results}
(ROOT / 'docs/proof/integrity.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
