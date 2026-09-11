"""One measured color correction per run; re-render to verify AgX's response."""
import json
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
path=ROOT/'src/game/data/dreamisland/power-colors.json'
colors=json.loads(path.read_text())
reference=json.loads((ROOT/'art/evidence/dreamisland-v1/polish-3/hardware/reference-colors.json').read_text())
rows=json.loads((Path(sys.argv[1])/'pixels.json').read_text())['rows']
corrections=[]
if '--moss' in sys.argv:
    current=colors['moss'].copy()
    measured=next(row for row in rows if row['id']=='shield-moss-day')['linear']
    target=reference['moss']['linear']
    colors['moss']=[old*goal/value for old,goal,value in zip(current,target,measured)]
    corrections.append(dict(key='moss',pose='shield-moss-day',measuredLinear=measured,
        targetLinear=target,before=current,after=colors['moss']))
for kind in ([] if '--moss' in sys.argv else ['surge','shield']):
    colors.setdefault('effect'+kind.title(),reference[kind]['chroma'])
    for plate in [False,True]:
        key=('plate'+kind.title()) if plate else kind
        current=colors.get(key,colors[kind]).copy()
        # Both materials had the original reference chroma in the first trial.
        if plate and key not in colors: current=reference[kind]['chroma']
        shot=kind+('-plate-day' if plate else '-day-8m')
        measured=next(row for row in rows if row['id']==shot)['linear']
        target=reference[kind]['linear']
        result=[old*goal/value for old,goal,value in zip(current,target,measured)]
        colors[key]=result
        corrections.append(dict(key=key,pose=shot,measuredLinear=measured,targetLinear=target,before=current,after=result))
path.write_text(json.dumps(colors,indent=2)+'\n')
(Path(sys.argv[1])/'color-correction.json').write_text(json.dumps(dict(script='scripts/visual/dreamisland/calibrate-power-colors.py',corrections=corrections),indent=2)+'\n')
