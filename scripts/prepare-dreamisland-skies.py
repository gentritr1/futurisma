#!/usr/bin/env python3
"""
Dream Island phase B3 — resample the two reviewed 1344x576 sky sources to the
4096x1024 panorama the still-image gate and the Ascension dome contract expect.

    python3 scripts/prepare-dreamisland-skies.py

Writes `public/assets/dreamisland/sky-day.jpg` and `sky-night.jpg` and prints,
per sky, the seam measurement the brief asks for: the mean absolute difference
between the FIRST and LAST column, which is the discontinuity a viewer would see
where a non-tiling panorama closes. The dome shader blends a narrow azimuth band
over that seam as well, but the number is measured before the blend so the blend
is not what is being trusted.

Both outputs are then handed to `scripts/visual/tideline-v4/sky-profile.py`,
which is the existing still-image gate: 4096x1024, ten-degree warmth step <= .05
and sky-band luma max/min ratio <= 2 over rows 0 .. .75h.

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
EVIDENCE=ROOT/'art/evidence/dreamisland-v1/phase-b/skies'
WIDTH,HEIGHT=4096,1024
QUALITY=92
EDGE_LIMIT=6/255

OUT.mkdir(parents=True,exist_ok=True)
EVIDENCE.mkdir(parents=True,exist_ok=True)
report={'script':'scripts/prepare-dreamisland-skies.py','resample':'PIL Image.LANCZOS',
 'target':[WIDTH,HEIGHT],'edgeLimit':EDGE_LIMIT,'jpegQuality':QUALITY,'skies':{}}
failed=[]
for state in ('day','night'):
 source=Image.open(SOURCES/('sky-'+state+'-gptimage2.png')).convert('RGB')
 native=np.asarray(source,dtype=float)
 resampled=source.resize((WIDTH,HEIGHT),Image.LANCZOS)
 path=OUT/('sky-'+state+'.jpg')
 resampled.save(path,'JPEG',quality=QUALITY,subsampling=0,optimize=True)
 reread=np.asarray(Image.open(path).convert('RGB'),dtype=float)
 entry={'source':str((SOURCES/('sky-'+state+'-gptimage2.png')).relative_to(ROOT)),
  'sourceSize':list(source.size),'file':str(path.relative_to(ROOT)),
  'bytes':path.stat().st_size,
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
