"""Frame and row-luma evidence; occluded sky/sea boundaries remain null."""
from pathlib import Path
import json,math
import numpy as np
from PIL import Image,ImageDraw
out=Path('art/evidence/dreamisland-v1/polish');records=[]
for label,directory in [('BEACH','crossfade-baseline'),('POINT','horizon-point'),('BASIN','horizon-basin'),('REEF','reef')]:
 p=out/directory;j=json.loads((p/'crossfade-capture.json').read_text());entry=next(x for x in j['captures'] if x['blend']==0)
 a={k:np.asarray(Image.open(p/entry['frames'][k]).convert('RGB'),dtype=float)/255 for k in ['full','sky','sea','blank']};luma={k:v@np.array([.2126,.7152,.0722]) for k,v in a.items()}
 sky=np.max(abs(a['full']-a['sky']),2)<=2/255;sea=(np.max(abs(a['full']-a['sea']),2)<=2/255)&(np.max(abs(a['sea']-a['blank']),2)>6/255)
 camera=np.array(j['pose']['camera']);target=np.array(j['pose']['lookAt']);d=target-camera;h,w=sky.shape;horizon=h/2+d[1]/np.linalg.norm(d[[0,2]])*(h/2)/math.tan(math.radians(j['pose']['fov']/2))
 rows=[{'row':y,'fullMeanLuma':float(luma['full'][y].mean()),'domeOnlyMeanLuma':float(luma['sky'][y].mean()),'visibleSkyPixels':int(sky[y].sum()),'visibleSeaPixels':int(sea[y].sum())}for y in range(h)]
 step=np.abs(np.diff(luma['sky'].mean(1)));lo=max(0,int(horizon)-220);hi=max(lo+1,int(horizon)-10)
 records.append({'district':label,'capture':str(p/'crossfade-capture.json'),'frame':str(p/entry['frames']['full']),'skyFrame':str(p/entry['frames']['sky']),'geometricHorizonRow':horizon,'maximumDomeRowStepAboveHaze':float(step[lo:hi].max()),'rows':rows})
report={'instrument':__file__,'method':'Display luma .2126/.7152/.0722, full-frame and isolated-dome row means. Exact sky/sea masks report visible pixels per row. Camera pitch derives the geometric horizon; occlusion is never reported as a zero boundary step. All four poses were captured after the final source edit.','profiles':records}
(out/'horizon-row-profiles.json').write_text(json.dumps(report,indent=2)+'\n')
sheet=Image.new('RGB',(1280,4*400),'#121b23');draw=ImageDraw.Draw(sheet)
for i,r in enumerate(records):
 top=i*400;sheet.paste(Image.open(r['frame']).resize((640,360)),(0,top+28));draw.text((10,top+8),r['district']+' | actual frame + isolated-dome row profile',fill='white')
 x0,y0,x1,y1=690,top+36,1240,top+366
 for v in [0,.25,.5,.75,1]:
  x=x0+v*(x1-x0);draw.line((x,y0,x,y1),fill='#314250');draw.text((x-10,y1+5),str(v),fill='#bbcbd4')
 for key,color in [('fullMeanLuma','#8597a1'),('domeOnlyMeanLuma','#67ddea')]:
  points=[(x0+row[key]*(x1-x0),y0+row['row']/len(r['rows'])*(y1-y0))for row in r['rows']];draw.line(points,fill=color,width=2)
 y=y0+r['geometricHorizonRow']/len(r['rows'])*(y1-y0);draw.line((x0,y,x1,y),fill='#e8c17b');draw.text((x0+5,y0+3),'cyan: sky dome | grey: full frame | gold: horizon',fill='white')
sheet.save(out/'horizon-profiles.png');print([(r['district'],r['maximumDomeRowStepAboveHaze'])for r in records])
