"""Gate-1 digit and background in the pinned frames.mjs-family capture.

Projects the authored plate rectangle into the captured camera. Within it,
full/isolation equality proves visibility; fixed luma > .40 selects the light
ink, < .20 selects dark plate. Thresholds are fixed before the after capture.
"""
import json,sys
from pathlib import Path
import numpy as np
from PIL import Image
out=Path(sys.argv[1]);manifest=Path(sys.argv[2]);signs=json.loads(manifest.read_text())['signs'];sign=next(s for s in signs if s['tile']=='plate-gate-1')
route=json.loads(Path('src/game/data/dreamisland/route.json').read_text());capture=json.loads((out/'pose-capture.json').read_text());reports=[]
for f in capture['frames']:
 p=f['pose'];q=p['quaternion'];x,y,z,w=q
 R=np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])
 t=route['stations'][round(sign['progress']*route['count'])]['t'];yaw=sign.get('yawRadians',np.arctan2(t[2],t[0]));axis=np.array([np.cos(yaw),0,np.sin(yaw)])
 corners=[np.array(sign['position'])+axis*sign['plateWidthMetres']/2*a+np.array([0,sign['plateHeightMetres']/2*b,0]) for a,b in [(-1,-1),(1,-1),(1,1),(-1,1)]]
 screen=[]
 for v in corners:
  c=R.T@(v-np.array(p['position']));scale=360/np.tan(np.radians(p['fov']/2));screen.append([640+c[0]/-c[2]*scale,360-c[1]/-c[2]*scale])
 lo=np.floor(np.min(screen,0)).astype(int)-2;hi=np.ceil(np.max(screen,0)).astype(int)+3
 full,alone,blank=[np.array(Image.open(out/f['frames'][n]).convert('RGB'),float)/255 for n in ['full','signage','blank']]
 visible=(abs(full-alone).max(2)<=2/255)&(abs(alone-blank).max(2)>6/255);roi=np.zeros(visible.shape,bool);roi[max(0,lo[1]):min(720,hi[1]),max(0,lo[0]):min(1280,hi[0])]=True;visible &= roi
 luma=full@np.array([.2126,.7152,.0722]);digit=visible&(luma>.40);plate=visible&(luma<.20);ys,xs=np.where(digit)
 result={'blend':f['blend'],'plateProjection':screen,'cropXYXY':[*lo.tolist(),*hi.tolist()],'visiblePixels':int(visible.sum()),'digitPixels':int(digit.sum()),'platePixels':int(plate.sum()),'digitHeightPixels':int(ys.max()-ys.min()+1)if len(ys)else 0,'digitMeanLuma':float(luma[digit].mean())if digit.any()else None,'plateMeanLuma':float(luma[plate].mean())if plate.any()else None}
 result['contrast']=result['digitMeanLuma']-result['plateMeanLuma'] if digit.any()and plate.any()else None
 reports.append(result)
 Image.fromarray(np.uint8(np.clip(full[lo[1]:hi[1],lo[0]:hi[0]]*255,0,255))).resize(((hi[0]-lo[0])*12,(hi[1]-lo[1])*12),Image.Resampling.NEAREST).save(out/'gate-1-pixel-crop.png')
report={'instrument':__file__,'manifest':str(manifest),'capture':str(out/'pose-capture.json'),'thresholds':{'digitDisplayLumaAbove':.40,'plateDisplayLumaBelow':.20},'results':reports};(out/'gate-profile.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(reports,indent=2))
