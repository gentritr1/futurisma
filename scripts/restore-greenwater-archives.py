"""Restore the three validated original downloads without overwriting other bytes.

Usage: python3 scripts/restore-greenwater-archives.py [download-directory]
Then run npm run test:archives with the project's Node environment.
The other seven provenance inputs are outside this recovery's scope.
"""
import hashlib
import json
from pathlib import Path
import shutil
import sys

root = Path(__file__).resolve().parents[1]
source = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / 'Downloads'
report = json.loads((root / 'art/evidence/ascension-v1/post-e-followups/archives/recovery.json').read_text())
selected = [row for row in report['candidates'] if row['selected']]

# Validate every input and existing destination before copying any file.
for row in selected:
    path = source / row['source']
    if hashlib.sha256(path.read_bytes()).hexdigest() != row['sha256']:
        raise SystemExit(f'Unexpected source bytes: {path}')
    destination = root / 'artifacts' / row['destination']
    if destination.exists() and hashlib.sha256(destination.read_bytes()).hexdigest() != row['sha256']:
        raise SystemExit(f'Refusing to overwrite different archive: {destination}')
for row in selected:
    destination = root / 'artifacts' / row['destination']
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source / row['source'], destination)
    if hashlib.sha256(destination.read_bytes()).hexdigest() != row['sha256']:
        raise SystemExit(f'Copy verification failed: {destination}')
    print(f'Restored and hash-verified: {row["destination"]}')
