"""Measure only the sky, with foreground excluded by an isolated sky pass.
Top 180 raster rows are above the painted silhouette band at this chase pitch.
Adjacent means 128 pixels (10% of a 1280-wide frame); never smooth over a step.
"""
from pathlib import Path
from PIL import Image
import json
folder=Path('art/evidence/tideline-v4/sky-turntable');result=[]
for file in sorted(folder.glob('sky-*.png')):
 im=Image.open(file).convert('RGB');w,h=im.size;p=im.load()
 values=[sum(.2126*p[x,y][0]+.7152*p[x,y][1]+.0722*p[x,y][2] for y in range(180))/180 for x in range(w)]
 delta=round(w*.1)
 worst=max(max(values[x],values[x+delta])/max(1,min(values[x],values[x+delta])) for x in range(w-delta))
 result.append({'file':str(file),'maximumLumaRatioAcrossTenPercent':worst})
report={'script':'scripts/visual/tideline-v4/turntable-profile.py','skyRows':[0,180],'isolation':'actual sky shader and chase camera; foreground geometry excluded','frames':result,'accepted':len(result)==24 and all(r['maximumLumaRatioAcrossTenPercent']<=2 for r in result)}
(folder/'profile.json').write_text(json.dumps(report,indent=2));print(json.dumps({'frames':len(result),'worst':max((r['maximumLumaRatioAcrossTenPercent'] for r in result),default=0),'accepted':report['accepted']}))
if not report['accepted']:raise SystemExit(1)
