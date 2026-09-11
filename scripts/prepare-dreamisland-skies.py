#!/usr/bin/env python3
"""
Dream Island B3/C0 — resample the two reviewed 1344x576 sky sources to the
4096x1024 panorama the still-image gate and the Ascension dome contract expect.

    python3 scripts/prepare-dreamisland-skies.py
    python3 scripts/prepare-dreamisland-skies.py --soften=0.4 --out=/tmp/skies

Writes `public/assets/dreamisland/sky-day.jpg` and `sky-night.jpg` and prints,
per sky, the seam measurement the brief asks for: the mean absolute difference
between the FIRST and LAST column, which is the discontinuity a viewer would see
where a non-tiling panorama closes. The dome shader blends a narrow azimuth band
over that seam as well, but the number is measured before the blend so the blend
is not what is being trusted.

Both outputs are then handed to `scripts/visual/tideline-v4/sky-profile.py`,
which is the existing still-image gate: 4096x1024, ten-degree warmth step <= .05
and sky-band luma max/min ratio <= 2 over rows 0 .. .75h (a near-black sky takes
that script's absolute-spread clause instead of the ratio; it prints which).

C0, 2026-09-10 — THE DAY SOURCE CHANGED. `sky-day-gptimage2.png` failed the
warm-step gate on its own uneven cloud field (.1255 resampled, .1260 native) and
was replaced by `sky-day-v2-gptimage2.png`, a regular grid of identical puffs.
v2 measures warm-step .0621 raw, which still fails, so this script now carries
the softening step the reference record names
(`art/references/dreamisland/phase-b/generation.json` -> `sky_day_revision`):

    CLOUD-CONTRAST SOFTENING, amount `--soften=` (default 0.25):
    over the SKY ROWS ONLY (rows 0 .. .75h, the same band the gate measures),
    per row and per channel,
        excess = pixel - median(row)
        pixel  = median(row) + excess * (1 - amount)
    applied AFTER the resample, before the JPEG write.

It flattens the puff-to-sky contrast without moving the sky's own colour: the
row median IS the sky behind the puffs, so the operation cannot shift the hue of
a row, only the amplitude of what sits on it. That is why it lowers the
ten-degree warmth step (a cloud-coverage artefact) and barely moves the luma
ratio. `--soften=0` reproduces the untouched resample.

Two facts worth stating rather than hiding:

  * The sources are 1344x576, aspect 2.33:1, and the target is 4:1, so this is
    not a uniform scale: 3.048x across and 1.778x up. The dome does not map V
    linearly either (`v = clamp(.15 + d.y * .8, 0, .99)`), so a panorama for it
    is not a rectilinear image and 4:1 is the contract, not a photograph.
  * A 3x upscale softens the night starfield. The phase-B kit README calls that
    out in advance and accepts it for the register; it is an eyeball call and
    this script cannot close it.
"""
import json,subprocess,sys
from pathlib import Path
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
SOURCES=ROOT/'art/references/dreamisland/phase-b'
OUT=ROOT/'public/assets/dreamisland'
WIDTH,HEIGHT=4096,1024
QUALITY=92
EDGE_LIMIT=6/255
SKY_ROWS=round(HEIGHT*.75)

def flag(name,fallback):
 for argument in sys.argv[1:]:
  if argument.startswith('--'+name+'='):return argument[len(name)+3:]
 return fallback

EVIDENCE=Path(flag('out',str(ROOT/'art/evidence/dreamisland-v1/phase-c/skies')))
if not EVIDENCE.is_absolute():EVIDENCE=ROOT/EVIDENCE
SOFTEN=float(flag('soften','0.25'))
if not 0<=SOFTEN<1:raise SystemExit('--soften= must be in [0, 1)')
# The day source is a C0 decision recorded in the reference generation.json; the
# night source is unchanged from B3. Both are overridable for a re-test.
STATES={'day':{'source':flag('day-source','sky-day-v2-gptimage2.png'),'soften':SOFTEN},
 'night':{'source':flag('night-source','sky-night-gptimage2.png'),'soften':0.0}}

def soften_cloud_contrast(pixels,amount,rows):
 """Pull each sky row towards its own median by `amount`. See the module docstring."""
 if amount<=0:return pixels
 out=pixels.copy()
 band=out[:rows]
 median=np.median(band,axis=1,keepdims=True)
 out[:rows]=median+(band-median)*(1-amount)
 return out

OUT.mkdir(parents=True,exist_ok=True)
EVIDENCE.mkdir(parents=True,exist_ok=True)
report={'script':'scripts/prepare-dreamisland-skies.py','resample':'PIL Image.LANCZOS',
 'target':[WIDTH,HEIGHT],'edgeLimit':EDGE_LIMIT,'jpegQuality':QUALITY,
 'softening':{'operation':'per sky row and channel, pixel = rowMedian + (pixel - rowMedian) * (1 - amount)',
  'appliedAfter':'resample to 4096x1024','skyRows':[0,SKY_ROWS],
  'reference':'art/references/dreamisland/phase-b/generation.json -> sky_day_revision',
  'amountByState':{state:config['soften'] for state,config in STATES.items()}},
 'skies':{}}
failed=[]
for state,config in STATES.items():
 source_path=SOURCES/config['source']
 source=Image.open(source_path).convert('RGB')
 native=np.asarray(source,dtype=float)
 resampled=np.asarray(source.resize((WIDTH,HEIGHT),Image.LANCZOS),dtype=float)
 softened=soften_cloud_contrast(resampled,config['soften'],SKY_ROWS)
 written=Image.fromarray(np.clip(np.rint(softened),0,255).astype(np.uint8))
 path=OUT/('sky-'+state+'.jpg')
 written.save(path,'JPEG',quality=QUALITY,subsampling=0,optimize=True)
 reread=np.asarray(Image.open(path).convert('RGB'),dtype=float)
 entry={'source':str(source_path.relative_to(ROOT)),
  'sourceSize':list(source.size),'file':str(path.relative_to(ROOT)),
  'bytes':path.stat().st_size,'soften':config['soften'],
  # How far the softening actually moved the picture, so the step is not taken
  # on trust: zero here would mean the parameter did nothing.
  'softeningMeanAbsDelta':float(np.abs(softened-resampled).mean())/255,
  'edgeDeltaNative':float(np.abs(native[:,0]-native[:,-1]).mean())/255,
  'edgeDeltaResampled':float(np.abs(reread[:,0]-reread[:,-1]).mean())/255}
 entry['edgeAccepted']=entry['edgeDeltaResampled']<EDGE_LIMIT
 profile=EVIDENCE/('sky-profile-'+state+'.json')
 finished=subprocess.run([sys.executable,str(ROOT/'scripts/visual/tideline-v4/sky-profile.py'),
  str(path),str(profile)],capture_output=True,text=True)
 entry['skyProfileExit']=finished.returncode
 entry['skyProfile']=json.loads(finished.stdout) if finished.stdout.strip() else {'stderr':finished.stderr}
 if finished.returncode!=0 or not entry['edgeAccepted']:failed.append(state)
 report['skies'][state]=entry
(EVIDENCE/'skies.json').write_text(json.dumps(report,indent=1))
print(json.dumps(report,indent=1))
if failed:raise SystemExit('Sky gate failed for: '+', '.join(failed))
