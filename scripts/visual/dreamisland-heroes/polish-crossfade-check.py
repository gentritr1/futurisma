"""T1/T2 on new endpoints; T3 on an independent repeat of the new baseline.

No Phase C capture or target is changed. All ten means come from the original
crossfade-profile.py instrument, using its existing exact masks and assertions.
"""
import json,sys,hashlib
from pathlib import Path
baseline,repeat=map(Path,sys.argv[1:3]);before=Path(sys.argv[3]) if len(sys.argv)>3 else Path('art/evidence/dreamisland-v1/phase-c/crossfade-shipped')
def read(folder):return json.loads((folder/'crossfade-profile.json').read_text())
a,b,c=read(before),read(baseline),read(repeat)
assert a['pose']['camera']==b['pose']['camera']==c['pose']['camera']
assert a['pose']['lookAt']==b['pose']['lookAt']==c['pose']['lookAt']
assert all([x['blend'] for x in p['blends']]==[0,.25,.5,.75,1] for p in [a,b,c])
rows=[];checks={}
for region in ['sky','road']:
 new=[x[region]['meanLuma'] for x in b['blends']]
 steps=[new[i]-new[i+1] for i in range(4)]
 midpoint=abs(new[2]-(new[0]+new[-1])/2)
 deltas=[abs(b['blends'][i][region]['meanLuma']-c['blends'][i][region]['meanLuma']) for i in range(5)]
 checks[region]={'T1midpointDeviation':midpoint,'T1pass':midpoint<=.030 if region=='road' else None,'steps':steps,'T2pass':all(s>.02 for s in steps),'T3repeatDeltas':deltas,'T3pass':all(d<=.004 for d in deltas)}
 if region=='sky':checks[region]['stepRatio']=max(steps)/min(steps);checks[region]['withinTwoTimes']=max(steps)/min(steps)<=2
 for i in range(5):rows.append({'region':region,'blend':b['blends'][i]['blend'],'phaseCBefore':a['blends'][i][region]['meanLuma'],'polishBaseline':new[i],'polishRepeat':c['blends'][i][region]['meanLuma'],'repeatDelta':deltas[i]})
report={'instrument':__file__,'before':str(before),'baseline':str(baseline),'repeat':str(repeat),'checks':checks,'tenMeans':rows,'profileSha256':{str(p):hashlib.sha256((p/'crossfade-profile.json').read_bytes()).hexdigest() for p in [before,baseline,repeat]}}
(baseline/'crossfade-acceptance.json').write_text(json.dumps(report,indent=2)+'\n')
lines=['| Region | Blend | BEFORE | New baseline | New repeat | Repeat delta |','|---|---:|---:|---:|---:|---:|']
for r in rows:lines.append('| '+r['region']+' | '+' | '.join(f"{r[k]:.6f}" for k in ['blend','phaseCBefore','polishBaseline','polishRepeat','repeatDelta'])+' |')
(baseline/'ten-means.md').write_text('\n'.join(lines)+'\n');print(json.dumps(checks,indent=2))
assert checks['road']['T1pass']  # Original T1_midpointRoadLumaAgainstLinear.
assert all(x[k] for x in checks.values() for k in ['T2pass','T3pass'])
assert checks['sky']['withinTwoTimes']
