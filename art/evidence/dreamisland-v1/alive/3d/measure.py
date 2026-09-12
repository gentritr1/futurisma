"""Run the required instrument on full world bands and explicit derived masks."""
import sys,json,importlib.util
from pathlib import Path
from PIL import Image
import numpy as np
root=Path.cwd();base=root/'art/evidence/dreamisland-v1/alive/3d'
spec=importlib.util.spec_from_file_location('grade',root/'scripts/visual/grade/measure-frames.py');grade=importlib.util.module_from_spec(spec);spec.loader.exec_module(grade)
step=base/sys.argv[1];rows=[]
for pose in ['court','reef']:
 for blend in ['000','100']:
  folder=step/pose;p=folder/f'blend-{blend}.png'
  row=grade.measure(str(p));row.update(pose=pose,blend=blend)
  im=Image.open(p);w,h=im.size
  crop=folder/f'blend-{blend}-no-sky.png';im.crop((int(.30*w),int(.30*h),int(.97*w),int(.62*h))).save(crop)
  row['noSky']=grade.measure(str(crop),False)
  row['sky']=grade.measure(str(folder/f'blend-{blend}-sky.png'),False)
  # Road mask from isolated render; central road band excludes kerbs/paint.
  a=np.asarray(im);isolated=np.asarray(Image.open(folder/f'blend-{blend}-road.png'));blank=np.asarray(Image.open(folder/f'blend-{blend}-blank.png'))
  mask=np.any(isolated!=blank,axis=2)&np.all(a==isolated,axis=2)
  region=np.zeros_like(mask);region[int(.48*h):int(.85*h),int(.4*w):int(.75*w)]=True;mask &=region
  pixels=a[mask,:3]
  row['roadPixels']=len(pixels);row['roadP50']=float(np.median(pixels@np.array([.2126,.7152,.0722]))) if len(pixels) else None
  rows.append(row)
(step/'measurements.json').write_text(json.dumps(rows,indent=2))
for r in rows:print(r['pose'],r['blend'],{k:r[k] for k in ['lumaMean','lumaStd','p99','range','whitePct','blackPct','roadP50']},'noSkyWhite',r['noSky']['whitePct'])
