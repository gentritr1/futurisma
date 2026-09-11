"""Fit the runtime's parametric EQ to measured reference band energies.
Each iteration renders the actual JS synthesizer, then measures its output.
"""
import json
import os
import subprocess
from pathlib import Path
import numpy as np
from importlib.util import spec_from_file_location, module_from_spec

spec = spec_from_file_location('match', Path(__file__).with_name('bed-match.py'))
match = module_from_spec(spec)
spec.loader.exec_module(match)
ROOT = Path(__file__).resolve().parents[3]
PROFILE = ROOT / 'src/game/data/dreamisland/bed-profile.json'
EVIDENCE = ROOT / 'art/evidence/dreamisland-v1/polish-3/audio'
centers = match.CENTERS
q = 4.3
targets = {kind:match.bands(match.samples(ROOT / ('art/references/dreamisland/phase-e/audio/'+name+'.mp3')))
           for kind, name in [('surf','surf-bed-day'),('night','night-bed')]}
profile = {kind:[[float(c),0,q] for c in centers] for kind in targets}

def response(frequency, db):
    a = 10**(db/40)
    omega = 2*np.pi*frequency/match.RATE
    alpha = np.sin(omega)/(2*q)
    z = np.exp(-2j*np.pi*centers/match.RATE)
    h = ((1+alpha*a)-2*np.cos(omega)*z+(1-alpha*a)*z*z) / ((1+alpha/a)-2*np.cos(omega)*z+(1-alpha/a)*z*z)
    return 20*np.log10(abs(h))

jacobian = np.stack([response(c,1) for c in centers], axis=1)
iterations = []
for iteration in range(16):
    PROFILE.write_text(json.dumps(profile, indent=2)+'\n')
    subprocess.run(['node','scripts/visual/dreamisland/render-bed.mjs'], cwd=ROOT, check=True)
    error = {kind:targets[kind]-match.bands(np.fromfile('/tmp/di-'+kind+'.f32', dtype='<f4')) for kind in targets}
    worst = {kind:float(max(abs(delta))) for kind,delta in error.items()}
    iterations.append(dict(iteration=iteration, worstBandErrorDb=worst))
    print(iterations[-1], flush=True)
    if max(worst.values()) < 2:
        break
    for kind in targets:
        correction = np.linalg.lstsq(jacobian, error[kind], rcond=None)[0]
        for row, delta in zip(profile[kind], correction):
            row[1] += float(np.clip(delta*.75, -12, 12))
else:
    raise RuntimeError('Fit did not converge; do not silently use unmeasured last coefficients')
EVIDENCE.mkdir(parents=True, exist_ok=True)
(EVIDENCE/'bed-fit.json').write_text(json.dumps(dict(script='scripts/visual/dreamisland/calibrate-beds.py', iterations=iterations, profile=profile), indent=2)+'\n')
