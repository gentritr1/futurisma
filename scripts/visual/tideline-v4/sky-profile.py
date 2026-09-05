"""D1 acceptance on display RGB: sky band excludes the lower silhouette quarter."""
import json,sys,math
from pathlib import Path
from PIL import Image
image=Image.open(sys.argv[1]).convert('RGB');w,h=image.size
rows=range(0,round(h*.75));p=image.load()
luma=[];warmth=[]
for x in range(w):
 pixels=[p[x,y] for y in rows]
 luma.append(sum(.2126*r+.7152*g+.0722*b for r,g,b in pixels)/len(pixels)/255)
 warmth.append(sum(r-b for r,g,b in pixels)/len(pixels)/255)
window=round(w*10/360)
warm_step=max(abs(warmth[x]-warmth[(x+window)%w]) for x in range(w))
ratio=max(luma)/min(luma)
result={'script':'scripts/visual/tideline-v4/sky-profile.py','image':sys.argv[1],'size':[w,h],'skyRows':[0,len(rows)],'tenDegreeColumns':window,'maximumTenDegreeWarmthDelta':warm_step,'skyLumaMaxMinRatio':ratio,'accepted':w==4096 and h==1024 and warm_step<=.05 and ratio<=2,'columns':[{'degrees':x/w*360,'luma':luma[x],'warmth':warmth[x]} for x in range(w)]}
Path(sys.argv[2]).write_text(json.dumps(result));print(json.dumps({k:v for k,v in result.items() if k!='columns'}))
if not result['accepted']:sys.exit(1)
