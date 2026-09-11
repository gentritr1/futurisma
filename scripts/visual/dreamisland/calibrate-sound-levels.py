"""Convert measured buffer levels into gains; retain the producing evidence.
The existing ambience instrument's Works hum (-27.3 dBFS, audio-ambience.ts)
is the reference bus level. Bells use strongest 100 ms because averaging a
short attack over seconds of decay systematically buries the cue.
"""
import json
import subprocess
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = ROOT/'art/evidence/dreamisland-v1/polish-3/audio'
capture = json.loads((EVIDENCE/'level-baseline/offline-capture.json').read_text())
reference_db = -27.3
gain = lambda measured,target:10**((target-measured)/20)
rows = []
levels = {}
for kind in ['surf','night']:
    measured = capture['files'][kind+'-bed-offline']['rmsDb']
    levels[kind] = gain(measured, reference_db)
    rows.append(dict(id=kind,metric='full-buffer RMS dBFS',measuredDb=measured,targetDb=reference_db,gain=levels[kind]))
for id, target, peak_window in [('clock-quarter-chime',reference_db+9,True),
                               ('clock-strike-three-tolls',reference_db+9,True),
                               ('waterfall-loop',reference_db,False),('fish-rise',reference_db,False),
                               ('tunnel-pass',reference_db,False),('day-birds',reference_db-6,False)]:
    path=ROOT/'public/assets/dreamisland/audio'/ (id+'.mp3')
    data=subprocess.check_output(['ffmpeg','-v','error','-i',str(path),'-ar','24000','-ac','1','-f','f32le','-'])
    x=np.frombuffer(data,dtype='<f4').astype(float)
    if peak_window:
        blocks=np.array([np.mean(x[i:i+2400]**2) for i in range(0,len(x),2400)])
        measured=float(10*np.log10(max(blocks)))
        strongest_start=float(np.argmax(blocks)/10)
    else:
        measured=float(10*np.log10(np.mean(x*x)))
        strongest_start=None
    levels[id]=gain(measured,target)
    rows.append(dict(id=id,metric='strongest 100 ms RMS dBFS' if peak_window else 'full-buffer RMS dBFS',
                     measuredDb=measured,targetDb=target,gain=levels[id],strongestWindowStartSeconds=strongest_start))
(ROOT/'src/game/data/dreamisland/sound-levels.json').write_text(json.dumps(levels,indent=2)+'\n')
(EVIDENCE/'level-calibration.json').write_text(json.dumps(dict(script='scripts/visual/dreamisland/calibrate-sound-levels.py',
 reference='Existing Works hum measured by scripts/visual/audio-probe.mjs; documented in audio-ambience.ts',
 referenceDb=reference_db,rows=rows),indent=2)+'\n')
print(json.dumps(levels,indent=2))
