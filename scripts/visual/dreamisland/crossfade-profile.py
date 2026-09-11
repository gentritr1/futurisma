#!/usr/bin/env python3
"""
The pixel half of the Dream Island crossfade instrument.

    node scripts/visual/dreamisland/crossfade-profile.mjs        # writes the frames
    python3 scripts/visual/dreamisland/crossfade-profile.py [DIR]

Reads `crossfade-capture.json` and the four frames per blend that
`crossfade-profile.mjs` wrote, and produces `crossfade-profile.json`:

  * per COLUMN of the frame, the mean luma and warmth of the SKY pixels in that
    column - the same two quantities `scripts/visual/tideline-v4/sky-profile.py`
    reports for a panorama still, so a rendered sky and a source panorama can be
    read in the same units;
  * the mean luma of the ROAD pixels, with the pixel count beside it.

REGIONS ARE DERIVED FROM RENDERS, NOT FROM ROW NUMBERS. A horizon row guessed
from the camera pitch would put palm crowns, sea stacks and the watchtower
inside the "sky" band, and a road window guessed from a projection would take in
kerb and verge at the edges. Instead:

    sky  = |full - skyOnly| <= TOLERANCE                (nothing occluded the dome)
    road = |full - roadOnly| <= TOLERANCE               (nothing occluded the road)
           and |roadOnly - blank| > BACKGROUND_MARGIN   (not the flat clear colour)

The dome is drawn first with no depth test and never fogged (it mixes the haze
itself), and the road is fogged identically in both renders, so equality is the
right test in both cases and the tolerance only absorbs the renderer's own
frame-to-frame dither.

Every region is reported with its pixel count, and the count is reconciled
against the frame area, because a percentile or a mean over an unverified
sample is not a measurement.

This script states NO target. The midpoint target is written afterwards, as a
delta against the numbers here.
"""
import json,sys
from pathlib import Path
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[3]
OUT=Path(sys.argv[1]) if len(sys.argv)>1 else ROOT/'art/evidence/dreamisland-v1/phase-c/crossfade'
if not OUT.is_absolute():OUT=ROOT/OUT
TOLERANCE=2/255           # renderer dither between two renders of the same pixel
BACKGROUND_MARGIN=6/255   # the same 6/255 the sky seam check uses for "visibly different"

capture=json.loads((OUT/'crossfade-capture.json').read_text())

def rgb(name):
 return np.asarray(Image.open(OUT/name).convert('RGB'),dtype=float)/255

def luma(pixels):
 return pixels[...,0]*.2126+pixels[...,1]*.7152+pixels[...,2]*.0722

def warmth(pixels):
 return pixels[...,0]-pixels[...,2]

def pier_edge(full,glow_only,sea_only,blank,frame_luma):
 """The night state's racing argument, in one number.

 Section 2 of the level brief says the map trades long-range reference for
 edge-proximate reference: at night the foam line and the lit shallows ARE the
 track edges, and the sea behind them goes black. So the quantity that decides
 whether the night state works is the CONTRAST between the glowing bands and
 the water beside them, and it is measured with the same exact masks the sky
 and road use - not a rectangle drawn over a screenshot.
 """
 if glow_only is None or sea_only is None:return None
 glow=(np.abs(full-glow_only).max(axis=2)<=TOLERANCE)&(np.abs(glow_only-blank).max(axis=2)>BACKGROUND_MARGIN)
 sea=(np.abs(full-sea_only).max(axis=2)<=TOLERANCE)&(np.abs(sea_only-blank).max(axis=2)>BACKGROUND_MARGIN)
 glow_pixels,sea_pixels=int(glow.sum()),int(sea.sum())
 glow_luma=float(frame_luma[glow].mean()) if glow_pixels else None
 sea_luma=float(frame_luma[sea].mean()) if sea_pixels else None
 return {'glowPixels':glow_pixels,'seaPixels':sea_pixels,
  'glowMeanLuma':glow_luma,'seaMeanLuma':sea_luma,
  'contrast':None if glow_luma is None or sea_luma is None else glow_luma-sea_luma,
  'ratio':None if not glow_luma or not sea_luma else glow_luma/sea_luma,
  'overlap':int((glow&sea).sum()),
  'note':'glow = the foam line and the lit shallows drawn together; sea = the open water. '
   'Both masks are exact frame comparisons, and the two are asserted disjoint.'}

rows=[]
for entry in capture['captures']:
 frames=entry['frames']
 full,sky_only,road_only,blank=(rgb(frames[k]) for k in ('full','sky','road','blank'))
 glow_only=rgb(frames['glow']) if 'glow' in frames else None
 sea_only=rgb(frames['sea']) if 'sea' in frames else None
 height,width,_=full.shape
 sky_mask=np.abs(full-sky_only).max(axis=2)<=TOLERANCE
 road_mask=(np.abs(full-road_only).max(axis=2)<=TOLERANCE)&(np.abs(road_only-blank).max(axis=2)>BACKGROUND_MARGIN)
 # A pixel cannot be both; if the two masks ever overlap the isolation is wrong
 # and the numbers below would be measuring the same pixels twice.
 overlap=int((sky_mask&road_mask).sum())
 frame_luma,frame_warmth=luma(full),warmth(full)
 columns=[]
 for x in range(width):
  column=sky_mask[:,x]
  count=int(column.sum())
  columns.append({'x':x,'skyPixels':count,
   'luma':float(frame_luma[column,x].mean()) if count else None,
   'warmth':float(frame_warmth[column,x].mean()) if count else None})
 lit=[c for c in columns if c['skyPixels']>0]
 sky_luma=[c['luma'] for c in lit]
 sky_warmth=[c['warmth'] for c in lit]
 sky_pixels=int(sky_mask.sum());road_pixels=int(road_mask.sum())
 # The highest and lowest rows the road mask occupies, so the road window is
 # described rather than assumed, and a swing in it between blends is visible.
 road_rows=np.where(road_mask.any(axis=1))[0]
 rows.append({'blend':entry['blend'],'label':entry['label'],'frame':frames['full'],
  'frameSize':[width,height],'framePixels':width*height,
  'sky':{'pixels':sky_pixels,'shareOfFrame':sky_pixels/(width*height),
   'columnsWithSky':len(lit),'columnsTotal':width,'maskOverlapWithRoad':overlap,
   'meanLuma':float(np.mean(sky_luma)) if lit else None,
   'minimumColumnLuma':float(np.min(sky_luma)) if lit else None,
   'maximumColumnLuma':float(np.max(sky_luma)) if lit else None,
   'meanWarmth':float(np.mean(sky_warmth)) if lit else None,
   'minimumColumnWarmth':float(np.min(sky_warmth)) if lit else None,
   'maximumColumnWarmth':float(np.max(sky_warmth)) if lit else None,
   'columns':columns},
  'road':{'pixels':road_pixels,'shareOfFrame':road_pixels/(width*height),
   'rowSpan':[int(road_rows.min()),int(road_rows.max())] if road_rows.size else None,
   'meanLuma':float(frame_luma[road_mask].mean()) if road_pixels else None,
   'meanWarmth':float(frame_warmth[road_mask].mean()) if road_pixels else None},
  'pierEdge':pier_edge(full,glow_only,sea_only,blank,frame_luma)})

def linear(first,last,at):
 return first+(last-first)*at

# The endpoints are the two states the map ships; everything between them is the
# crossfade. Stating the midpoint as a distance from the straight line between
# the endpoints is what makes a target expressible as a delta rather than as an
# invented absolute.
endpoints={'first':rows[0],'last':rows[-1]}
deviations=[]
for row in rows:
 entry={'blend':row['blend']}
 for region,field in (('sky','meanLuma'),('sky','meanWarmth'),('road','meanLuma')):
  first,last,value=endpoints['first'][region][field],endpoints['last'][region][field],row[region][field]
  if first is None or last is None or value is None:continue
  expected=linear(first,last,row['blend'])
  entry[region+'.'+field]={'measured':value,'linearInterpolation':expected,
   'deviation':value-expected,'endpointSpan':last-first,
   'deviationAsShareOfSpan':(value-expected)/(last-first) if last!=first else None}
 deviations.append(entry)

report={'script':'scripts/visual/dreamisland/crossfade-profile.py',
 'capture':'crossfade-capture.json','pose':capture['pose'],
 'tolerance':TOLERANCE,'backgroundMargin':BACKGROUND_MARGIN,
 'regions':{'sky':'|full - skyOnly| <= tolerance, per channel',
  'road':'|full - roadOnly| <= tolerance AND |roadOnly - blank| > backgroundMargin, per channel'},
 'reconciliation':'Every mean is quoted with the pixel count it was taken over and that count as a share of the 1280x720 frame; the sky and road masks are asserted disjoint (maskOverlapWithRoad).',
 'blends':rows,
 'linearity':{'note':'Deviation of each capture from the straight line between the blend 0 and blend 1 captures of the same quantity. No target is stated here; the target is written afterwards from these numbers.',
  'rows':deviations},
 'target':'NONE. This script measures.'}
(OUT/'crossfade-profile.json').write_text(json.dumps(report,indent=1))
summary=[{'blend':r['blend'],'skyPixels':r['sky']['pixels'],'skyMeanLuma':round(r['sky']['meanLuma'],5) if r['sky']['meanLuma'] is not None else None,
 'skyMeanWarmth':round(r['sky']['meanWarmth'],5) if r['sky']['meanWarmth'] is not None else None,
 'roadPixels':r['road']['pixels'],'roadMeanLuma':round(r['road']['meanLuma'],5) if r['road']['meanLuma'] is not None else None,
 'maskOverlap':r['sky']['maskOverlapWithRoad']} for r in rows]
print(json.dumps({'frames':len(rows),'summary':summary,
 'deviationFromLinear':[{k:(round(v['deviation'],5) if isinstance(v,dict) else v) for k,v in d.items()} for d in deviations]},indent=1))
