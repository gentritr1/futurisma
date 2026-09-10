import json
from pathlib import Path
import numpy as np
from PIL import Image
out=Path('art/evidence/dreamisland-v1/polish/tint-calibration');capture=json.loads((out/'tint-capture.json').read_text());results=[]
for item in capture['captures']:
 a={k:np.asarray(Image.open(out/v).convert('RGB'),dtype=float)/255 for k,v in item['frames'].items()};metrics={}
 for mode in a.keys()-{'full','blank'}:
  mask=(np.max(abs(a['full']-a[mode]),2)<=2/255)&(np.max(abs(a[mode]-a['blank']),2)>6/255);pixels=a['full'][mask];assert len(pixels)>0
  metrics[mode]={'pixels':len(pixels),'meanLuma':float(np.mean(pixels@np.array([.2126,.7152,.0722]))),'meanChroma':float(np.mean(pixels.max(1)-pixels.min(1)))}
 results.append({'name':item['name'],'pose':item['pose'],'metrics':metrics})
report={'instrument':__file__,'method':'Shared game lighting/fog/AgX, exact visible full/isolated equality and isolated/blank difference; calibrated geometry and pose recorded in tint-capture.json','results':results};(out/'tint-profile.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(results,indent=2))
