"""Measure visible sky only, using a companion black-geometry / white-sky mask."""
from PIL import Image
from pathlib import Path
import json
root=Path('art/evidence/ascension-v1/phase-b/sky-turntable');rows=[]
for path in sorted(root.glob('[0-9][0-9].png')):
 im=Image.open(path).convert('RGB');mask=Image.open(root/('mask-'+path.name)).convert('RGB');w,h=im.size;band=int(h*.22)
 sums=[];counts=[]
 for x in range(w):
  pixels=[im.getpixel((x,y)) for y in range(band) if min(mask.getpixel((x,y)))>250]
  sums.append(sum(.2126*r+.7152*g+.0722*b for r,g,b in pixels));counts.append(len(pixels))
 width=w//10;windows=[]
 for x in range(w-width+1):
  count=sum(counts[x:x+width]);windows.append(sum(sums[x:x+width])/count if count>=width*band*.25 else None)
 ratios=[]
 for x in range(len(windows)-width):
  a,b=windows[x],windows[x+width]
  if a is not None and b is not None:ratios.append(max(a,b)/max(.001,min(a,b)))
 peak=max(ratios) if ratios else None
 rows.append({'file':path.name,'visibleSkyFractionInBand':sum(counts)/(w*band),'testedAdjacentWindowPairs':len(ratios),'adjacentTenPercentWindowLumaRatio':peak,'pass':peak is not None and peak<=2})
result={'script':'scripts/visual/ascension/check-sky-frames.py','maskScript':'scripts/visual/ascension/review.ts?skyMask=1','region':'Top 22% of frame, geometry excluded by companion mask; each tested 10%-width window must contain at least 25% unobscured sky pixels. Occluded sky is not measured.','expectedDiscreteFrames':24,'actualFrames':len(rows),'pass':len(rows)==24 and all(r['pass'] for r in rows),'rows':rows}
(root/'luma-check.json').write_text(json.dumps(result,indent=2));print(json.dumps({k:v for k,v in result.items() if k!='rows'}))
if not result['pass']:raise SystemExit(1)
