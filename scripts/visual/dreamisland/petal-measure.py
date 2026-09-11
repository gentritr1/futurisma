"""Measure hinge rotation from the rendered instance matrices, not authored values."""
import json
import sys
from pathlib import Path
import numpy as np

folder = Path(sys.argv[1])
captures = json.loads((folder / 'frames-final/capture.json').read_text())['captures']
shots = {capture['shot']['id']: capture for capture in captures}

def matrices(tick):
    values = shots[f'shield-collected-{tick}ticks']['applied']['petalMatrices']
    return np.array(values).reshape((-1, 4, 4)).transpose(0, 2, 1)

closed = matrices(0)
rows = []
for tick in [0, 15, 30]:
    angles = []
    for base, moved in zip(closed[:4], matrices(tick)[:4]):
        relative = np.linalg.inv(base) @ moved
        angles.append(float(np.arccos(np.clip((np.trace(relative[:3, :3]) - 1) / 2, -1, 1))))
    rows.append(dict(tick=tick, milliseconds=tick / 120 * 1000,
                     firstShieldPetalRotationRadians=angles))
assert all(abs(angle - .7) < 1e-6 for angle in rows[-1]['firstShieldPetalRotationRadians'])
report = dict(script='scripts/visual/dreamisland/petal-measure.py', source='frames-final/capture.json',
              method='Relative rotation of actual float32 instance matrices; matrix trace gives angle.',
              rows=rows, passed=True)
(folder / 'hardware/petal-motion.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
