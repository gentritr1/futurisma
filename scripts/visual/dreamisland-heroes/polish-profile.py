"""Additional polish measurements from the existing crossfade isolation frames.

python3 scripts/visual/dreamisland-heroes/polish-profile.py CAPTURE_DIRECTORY
Uses the same display-luma coefficients and 2/255 equality mask as the named
crossfade instrument. It does not modify any source, frame, or target.
"""
import json
import sys
from pathlib import Path
import numpy as np
from PIL import Image

out=Path(sys.argv[1])
capture=json.loads((out/'crossfade-capture.json').read_text())
def rgb(file):
    return np.asarray(Image.open(out/file).convert('RGB'),dtype=float)/255

def luma(a):
    return a[...,0]*.2126+a[...,1]*.7152+a[...,2]*.0722

rows=[]
for item in capture['captures']:
    frames=item['frames']
    full,sea,sky,blank=[rgb(frames[k]) for k in ['full','sea','sky','blank']]
    sea_mask=(np.max(abs(full-sea),axis=2)<=2/255)&(np.max(abs(sea-blank),axis=2)>6/255)
    sky_mask=np.max(abs(full-sky),axis=2)<=2/255
    y=luma(full)
    # A horizon column must show actual unoccluded sea with actual sky just
    # above it. The isolation masks determine its row; no screenshot ROI is
    # chosen to make a particular statistic pass.
    transitions=[]
    for x in range(full.shape[1]):
        sea_rows=np.where(sea_mask[:,x])[0]
        if not len(sea_rows):continue
        row=int(sea_rows[0])
        if row<4 or row>full.shape[0]-5:continue
        # Skip the single antialiased boundary row, whose background changes
        # between sky and blank isolation renders and cannot satisfy equality.
        if sky_mask[row-4:row-1,x].all() and sea_mask[row:row+3,x].all():
            transitions.append({'x':x,'row':row,'step':float(abs(y[row-4:row-1,x].mean()-y[row:row+3,x].mean()))})
    assert sea_mask.sum()>0,'Sea not visible'
    offsets=list(range(-60,61))
    profile=[]
    for offset in offsets:
        values=[]
        for t in transitions:
            row=t['row']+offset;x=t['x']
            if 0<=row<full.shape[0] and (sea_mask[row,x] or sky_mask[row,x]):
                values.append(y[row,x])
        profile.append({'offsetPixels':offset,'pixels':len(values),'meanLuma':float(np.mean(values)) if values else None})
    rows.append({'blend':item['blend'],'frame':frames['full'],
       'seaPixels':int(sea_mask.sum()),'seaMeanLuma':float(y[sea_mask].mean()),'seaLumaStd':float(y[sea_mask].std()),
       'horizonColumns':len(transitions),'horizonMeanStep':float(np.mean([p['step'] for p in transitions])) if transitions else None,
       'horizonMaximumStep':max((p['step'] for p in transitions),default=None),
       'horizonMedianRow':float(np.median([p['row'] for p in transitions])) if transitions else None,
       'horizonAlignedRowProfile':profile,'horizonTransitions':transitions})
report={'status':'VERIFIED','script':'scripts/visual/dreamisland-heroes/polish-profile.py','pose':capture['pose'],
        'method':'Display luma on exact sea/sky isolation masks. Horizon step compares three rows of sky with three rows of sea, skipping the antialiased boundary row, per unobstructed column. Profile is aligned to each column boundary.',
        'blends':rows}
(out/'polish-profile.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps([{k:v for k,v in row.items() if k not in ['horizonAlignedRowProfile','horizonTransitions']} for row in rows],indent=2))
