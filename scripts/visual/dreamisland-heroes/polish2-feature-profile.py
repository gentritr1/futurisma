"""Measure the named hero feature counterfactuals from polish-focals.mjs."""
from pathlib import Path
from PIL import Image
import numpy as np,json,sys
out=Path(sys.argv[1]);capture=json.loads((out/'focal-capture.json').read_text());rows=[]
for frame in capture['frames']:
 full=np.asarray(Image.open(out/frame['frames']['full']).convert('RGB'),float)/255
 for name,record in frame['featureFrames'].items():
  without=np.asarray(Image.open(out/record['without']).convert('RGB'),float)/255
  mask=np.max(abs(full-without),2)>2/255
  rows.append({'asset':frame['asset'],'blend':frame['blend'],'feature':name,
   'changedPixels':int(mask.sum()),'meanLuma':float((full[mask]@np.array([.2126,.7152,.0722])).mean())if mask.any()else None,
   'maximumChannelDelta':float(np.max(abs(full-without))),
   'full':frame['frames']['full'],'without':record['without']})
report={'instrument':__file__,'capture':str(out/'focal-capture.json'),
 'method':'Difference >2/255 in any channel between identical 40 m full and feature-hidden renders; display luma on changed full-frame pixels. Transparent mist is tested against its actual background, not a blank isolation.',
 'rows':rows}
(out/'feature-profile.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps([{'asset':r['asset'],'blend':r['blend'],'feature':r['feature'],'changedPixels':r['changedPixels'],'meanLuma':r['meanLuma']}for r in rows],indent=2))
