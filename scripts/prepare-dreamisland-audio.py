"""Transcode the supplied kit; no synthesis or generation service is involved."""
import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'art/references/dreamisland/phase-e/audio'
OUT = ROOT / 'public/assets/dreamisland/audio'
EVIDENCE = ROOT / 'art/evidence/dreamisland-v1/polish-3/audio'
OUT.mkdir(parents=True, exist_ok=True)
EVIDENCE.mkdir(parents=True, exist_ok=True)
REFERENCES = {'surf-bed-day', 'night-bed'}
rows = []
for source in sorted(SOURCE.glob('*.mp3')):
    # Transcode the references too, but keep them in evidence: no reference
    # download is needed by the procedural beds at runtime.
    target = (EVIDENCE if source.stem in REFERENCES else OUT) / source.name
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(source), '-map_metadata', '-1',
                    '-ac', '1', '-ar', '24000', '-c:a', 'libmp3lame', '-b:a', '48k', str(target)], check=True)
    probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams',
                                               '-show_format', '-of', 'json', str(target)]))
    stream = probe['streams'][0]
    rows.append(dict(file=source.name, sourceBytes=source.stat().st_size, bytes=target.stat().st_size,
                     served=source.stem not in REFERENCES, sampleRate=int(stream['sample_rate']),
                     channels=stream['channels'], bitRate=int(stream['bit_rate']),
                     durationSeconds=float(probe['format']['duration']),
                     sha256=hashlib.sha256(target.read_bytes()).hexdigest()))
total = sum(r['bytes'] for r in rows if r['served'])
report = dict(script='scripts/prepare-dreamisland-audio.py', files=rows,
              sourceBytes=sum(r['sourceBytes'] for r in rows), transcodedBytes=sum(r['bytes'] for r in rows),
              servedBytes=total, ceilingBytes=(total * 110 + 99) // 100)
(EVIDENCE / 'transcode.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
