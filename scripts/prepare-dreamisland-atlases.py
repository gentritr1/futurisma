#!/usr/bin/env python3
"""
Dream Island phase B1 — turn the reviewed phase-B sources into the six painted
atlas roles the GLB samples, plus the magenta-key card sheet.

    python3 scripts/prepare-dreamisland-atlases.py

Sources are `art/references/dreamisland/phase-b/*.png` and are NEVER written.
Outputs are `public/assets/dreamisland/textures/{role}.jpg`, `jungle-card.png`
and `public/assets/dreamisland/atlas-manifest.json`. Deterministic: no
randomness, no network, no time, so re-running writes byte-identical files, and
the manifest carries the sha256 of each of them so a drift is detectable without
a dry-run mode.

CHOSEN RESOLUTION: 1024x1024 for all six roles. That is the phase-B kit
README's own choice and Tideline's precedent; Ascension's 1254x1254 + 1024
emissive mismatch is deliberately not inherited. All seven sources are already
native 1024x1024, so nothing is resampled except the two crops noted below.

QUADRANT CONVENTION (from `art/references/dreamisland/phase-b/generation.json`):
a 2x2 sheet, rects named TL/TR/BL/BR in GL (bottom-origin) V, each inset .004
from the sheet edges and from the centre gutter so bilinear sampling and JPEG
chroma never drag a neighbouring quadrant in. In pixels an inset quadrant is
[4, 508] of its 512-pixel half.

PER-SOURCE HANDLING, and why
----------------------------
concrete TL  The verdict on this quadrant is "arc-shaped polish lanes - rotate
             or crop so lanes run along U". The deskew angle is measured by
             sweeping +/-45 degrees and scoring `lane_alignment`; the winner is
             -41.5 deg, which lifts the score from .0104 to .0185 against a
             worst case of .0053. The inscribed 362x362 is resampled back to
             512, a 1.41x upscale and the only upscale in the kit. A structure
             tensor was tried first and is documented as unusable in
             `lane_alignment` below - it disagreed with what the quadrant plainly
             shows.
water   TR   "Check TR tiles before use" - it does not, so the cobalt facet
             quadrant gets the offset cross-fade below. The facets are an
             irregular field, which is the one case where cross-fade ghosting
             is not visible.
water   TL   caustics, jungle BR sand, jungle TR moss, jungle BL leaf fill and
             concrete TL road sand are the other quadrants that tile over large
             continuous surfaces and are irregular enough to cross-fade.
concrete TR/BR, jungle TL bark, every metal, signage and emissive quadrant are
             NOT blended: paving, wall block, bark banding, chevrons and the
             glow discs are regular or centred art that a cross-fade would
             ghost. Their measured wrap error is reported instead of hidden.
signage      The plates sit on a dark green field that is not a material, so
             the manifest names PLATE rects found by thresholding the field
             colour, not the quadrants.
jungle-card  Stays PNG and RGB. The magenta key must survive byte-exact for
             `min(r,b)-g > .025` to discard it at runtime the way
             `src/game/ascension-materials.ts` does; JPEG chroma subsampling
             would fray it, and the Ascension attempt at exporting real alpha
             failed. The manifest names each sprite's tight rect.

POSTERISE / TONE-MATCH, stated as a decision
--------------------------------------------
`concrete`, `metal`, `jungle` and `water` are photoreal-leaning against a naive
flat-shaded target, so each gets, in order: a 3x3 median filter (kills the
photographic micro-noise the register does not want), a x1.12 saturation lift,
and a posterise to POSTERISE_BITS bits per channel. `signage` is left alone so
the lettering stays legible at 0.59 m, `emissive` is left alone because its
glows are smooth gradients that posterise into visible rings, and `jungle-card`
is left alone so the key stays exact. Every parameter is printed in the
manifest, and `art/evidence/dreamisland-v1/phase-b/atlases/posterise-strip.png`
is the before/after the decision was made on.
"""
import hashlib,json
from pathlib import Path
import numpy as np
from PIL import Image,ImageEnhance,ImageFilter,ImageOps

ROOT=Path(__file__).resolve().parents[1]
SOURCES=ROOT/'art/references/dreamisland/phase-b'
OUT=ROOT/'public/assets/dreamisland'
TEXTURES=OUT/'textures'
EVIDENCE=ROOT/'art/evidence/dreamisland-v1/phase-b/atlases'

SIZE=1024
HALF=SIZE//2
INSET=.004
POSTERISE_BITS=5
SATURATION=1.12
MEDIAN=3
BLEND_PIXELS=64
# The sources really do carry the thin dark gutter the convention warns about:
# measured on the column and row means, it is 3-5 px wide at 0, 511/512 and
# 1023 on every one of the six role sheets. Baking it into the tile is what
# put black tick marks in the middle of the first seam-blended sand, because
# the half-offset roll moves the sheet edge to the tile centre. Each quadrant is
# therefore trimmed by GUTTER px on all four sides and resampled back to 512
# BEFORE anything else; the .004 UV inset then only has to cover bilinear and
# JPEG bleed. The card sheet is exempt - it has no gutter and must stay exact.
GUTTER=8
JPEG_QUALITY=92
ROLES=['concrete','metal','jungle','water','signage','emissive']
QUADRANTS={'TL':(0,0),'TR':(HALF,0),'BL':(0,HALF),'BR':(HALF,HALF)}

def quadrant_uv(name):
 """GL-space rect for a quadrant, inset from both the sheet edge and the gutter."""
 x,y=QUADRANTS[name]
 u0=x/SIZE+INSET;u1=(x+HALF)/SIZE-INSET
 # Pillow rows count down from the top; GL V counts up from the bottom.
 v0=1-(y+HALF)/SIZE+INSET;v1=1-y/SIZE-INSET
 return [round(u0,6),round(v0,6),round(u1,6),round(v1,6)]

def pixel_uv(box):
 """GL-space rect for an arbitrary pixel box (left, top, right, bottom)."""
 left,top,right,bottom=box
 return [round(left/SIZE,6),round(1-bottom/SIZE,6),round(right/SIZE,6),round(1-top/SIZE,6)]

def high_pass(gray,radius=12):
 """Strip the broad tonal gradient so the lane texture is what gets measured."""
 a=np.asarray(gray,dtype=float)-np.asarray(gray.filter(ImageFilter.GaussianBlur(radius)),dtype=float)
 return Image.fromarray(np.clip(a*3+128,0,255).astype(np.uint8))

def lane_alignment(gray):
 """How much of the variance lies BETWEEN rows rather than inside them.

 A Radon-style score: streaks running along U make whole rows differ from each
 other, so `var(row means) / var(all)` peaks when the lanes are horizontal. A
 structure tensor was tried first and is not usable here - on this quadrant it
 reported a near-horizontal axis at coherence .12 while the streaks are plainly
 diagonal, because the doubled-angle average is dominated by the sheet's broad
 tonal gradient rather than by the lanes."""
 a=np.asarray(gray,dtype=float)
 return float(a.mean(axis=1).var()/max(1e-9,a.var()))

def wrap_error(tile):
 """Mean |delta| across the seam a tiled quadrant would show, 0-255 per channel."""
 a=np.asarray(tile,dtype=float)
 return {'uSeamMeanAbs':float(np.abs(a[:,0]-a[:,-1]).mean()),
  'vSeamMeanAbs':float(np.abs(a[0,:]-a[-1,:]).mean())}

def cross_fade(tile,pixels=BLEND_PIXELS):
 """Cross-fade the tile toward its own half-offset copy inside an edge band.

 At x = 0 the weight is zero, so the output column is `a[:, w/2]`; at x = w-1 it
 is `a[:, w/2 - 1]`. Those two are adjacent columns of the source, so wrapping
 w-1 -> 0 is continuous, and the same argument holds in V and around the
 corners. Only the `pixels`-wide band is touched: the middle of the tile keeps
 its full contrast, which is why this is used on irregular fields only."""
 a=np.asarray(tile,dtype=float);h,w,_=a.shape
 rolled=np.roll(np.roll(a,w//2,axis=1),h//2,axis=0)
 ramp_u=np.clip(np.minimum(np.arange(w),w-1-np.arange(w))/pixels,0,1)
 ramp_v=np.clip(np.minimum(np.arange(h),h-1-np.arange(h))/pixels,0,1)
 alpha=np.minimum(ramp_u[None,:],ramp_v[:,None])[:,:,None]
 out=a*alpha+rolled*(1-alpha)
 return Image.fromarray(np.clip(out+.5,0,255).astype(np.uint8))

def flatten(tile):
 """Median, saturation lift, posterise: the naive flat-palette tone match."""
 out=tile.filter(ImageFilter.MedianFilter(MEDIAN))
 out=ImageEnhance.Color(out).enhance(SATURATION)
 return ImageOps.posterize(out,POSTERISE_BITS)

def road_sand(quadrant):
 """Deskew the tyre-polish lanes onto U. The angle is measured, not chosen.

 The whole quadrant is swept over +/-45 degrees in half-degree steps and scored
 by `lane_alignment`; the winner is applied to the untouched quadrant and the
 inscribed square is resampled back to 512. The score at zero is reported beside
 it, so "the lanes now run along U" is a comparison and not an assertion."""
 span=45
 inscribed=int(HALF/(np.cos(np.radians(span))+np.sin(np.radians(span))))
 margin=(HALF-inscribed)//2
 measured=high_pass(quadrant.convert('L'))
 def score(image,angle):
  return lane_alignment(image.rotate(angle,resample=Image.BICUBIC)
   .crop((margin,margin,margin+inscribed,margin+inscribed)))
 sweep=sorted(((score(measured,index/2),index/2) for index in range(-2*span,2*span+1)),reverse=True)
 best,deskew=sweep[0]
 cropped=quadrant.rotate(deskew,resample=Image.BICUBIC).crop((margin,margin,margin+inscribed,margin+inscribed))
 return cropped.resize((HALF,HALF),Image.LANCZOS),{
  'measure':'scripts/prepare-dreamisland-atlases.py lane_alignment: var(row means)/var(all) on a high-passed quadrant',
  'sweepDegrees':[-span,span],'stepDegrees':.5,'deskewDegrees':deskew,
  'alignmentAtZero':score(measured,0),'alignmentAtDeskew':best,
  'worstAlignment':sweep[-1][0],'worstAlignmentDegrees':sweep[-1][1],
  'inscribedPixels':inscribed,'upscale':HALF/inscribed,
  'note':'Higher alignment means more of the variance runs along U, i.e. the lanes lie along the road.'}

def plate_boxes(quadrant,offset):
 """Bounding boxes of the enamel plates, found by rejecting the green field."""
 a=np.asarray(quadrant.convert('RGB'),dtype=int)
 field=np.median(a.reshape(-1,3),axis=0)
 mask=(np.abs(a-field).sum(axis=2)>90)
 rows=np.where(mask.any(axis=1))[0];columns=np.where(mask.any(axis=0))[0]
 if not len(rows) or not len(columns):return None
 return (int(columns[0])+offset[0],int(rows[0])+offset[1],
  int(columns[-1])+1+offset[0],int(rows[-1])+1+offset[1])

def letter_band(sheet,box,border=.12):
 """Tallest run of rows inside a plate that carries dark glyph pixels.

 The 0.59 m environmental letter cap is a cap on LETTERS, not on plates, so the
 build script needs the glyph height as a fraction of the plate it sits in -
 otherwise a plate scaled to look right ships letters at whatever height falls
 out. Rows whose darkest pixel is far below the plate's own paper tone count as
 glyph rows; the tallest contiguous run of them is the lettering."""
 # The plate's own border and rivets are dark on every row, so the measurement
 # runs on the inset paper area only.
 width=box[2]-box[0];height=box[3]-box[1]
 inset=(box[0]+round(width*border),box[1]+round(height*border),
  box[2]-round(width*border),box[3]-round(height*border))
 a=np.asarray(sheet.crop(inset).convert('L'),dtype=float)
 paper=float(np.percentile(a,75))
 ink=(a<paper-60).sum(axis=1)>max(3,a.shape[1]//12)
 best=(0,0,0);run=None
 for index,value in enumerate(list(ink)+[False]):
  if value and run is None:run=index
  elif not value and run is not None:
   if index-run>best[0]:best=(index-run,run,index)
   run=None
 glyph,top,bottom=best
 return {'measuredInside':list(inset),'glyphRows':[int(top),int(bottom)],
  'glyphHeightPixels':int(glyph),'plateHeightPixels':int(height),
  'glyphFractionOfPlate':(glyph/height) if height else 0.,
  'maximumPlateHeightMetres':(0.59*height/glyph) if glyph else None,
  'note':'A plate taller than maximumPlateHeightMetres would ship letters over the 0.59 m environmental cap.'}

def sprite_box(quadrant,offset):
 """Tight box of a magenta-keyed sprite, using the runtime's own key test."""
 a=np.asarray(quadrant.convert('RGB'),dtype=int)
 keyed=(np.minimum(a[:,:,0],a[:,:,2])-a[:,:,1])>6
 mask=~keyed
 rows=np.where(mask.any(axis=1))[0];columns=np.where(mask.any(axis=0))[0]
 if not len(rows) or not len(columns):return None
 return (int(columns[0])+offset[0],int(rows[0])+offset[1],
  int(columns[-1])+1+offset[0],int(rows[-1])+1+offset[1])

# Every quadrant, in role order, with what it is, whether it tiles and how.
PLAN={
 'concrete':{
  'TL':('road-sand','Pale sandy concrete road surface with tyre-polish lanes deskewed onto U.',True),
  'TR':('causeway-paving','Dry limestone paving blocks with mossy joints, the causeway deck.',False),
  'BL':('kerb-cyan','White kerb stone with one cyan stripe; the stripe runs along V.',False),
  'BR':('wall-block','Weathered limestone wall blocks, the cut walls and the sea stacks.',False)},
 'metal':{
  'TL':('chevron-strip','Brushed steel plate with cyan launch-strip chevrons pointing along +V.',False),
  'TR':('rail','Galvanised guard rail post and beam with rivets.',False),
  'BL':('clock-ring-hands','Aged bronze clock ring and two plain hands on neutral grey.',False),
  'BR':('gate-lamp-post','Dark iron gate post with a white lamp housing.',False)},
 'jungle':{
  'TL':('bark','Segmented palm-trunk bark, bands run along U, tiles up a trunk in V.',False),
  'TR':('moss-blossom','Moss over stone with small white blossoms; the mossy tops.',True),
  'BL':('leaf-fill','Layered broadleaf fill; the broadleaf cards and canopy.',True),
  'BR':('sand','Pale beach sand with ripples and shells; the verges.',True)},
 'water':{
  'TL':('caustic-shallows','Turquoise shallows with a white caustic web, seen straight down.',True),
  'TR':('cobalt-facets','Deep cobalt sea with low-poly wave facets. Verdict-mandated tiling fix.',True),
  'BL':('foam-gradient','Surf foam dissolving into cyan. V is distance from shore: tiles in U only.',False),
  'BR':('waterfall','Vertical white and pale-blue streaks on dark stone; V scrolls with time.',False)},
 'signage':{
  'TL':('plate-dream-island','Enamel place plate reading DREAM ISLAND.',False),
  'TR':('plate-07','Square plate reading 07.',False),
  'BL':('plate-gate-numbers','Strip of six gate number plates, 1 to 6.',False),
  'BR':('plate-beach','Plate reading BEACH over a faded cyan wave mark.',False)},
 'emissive':{
  'TL':('foam-glow','Cyan foam-line glow band; the night shore rail. Tiles in U.',False),
  'TR':('shallows-glow','Turquoise lit-from-within shallows glow.',False),
  'BL':('lamp-disc','Warm pale-yellow lamp disc for the tunnel and gate lamps.',False),
  'BR':('clock-face','Glowing clock face. Face glow only: the hands are metal geometry.',False)},
}
CARD_PLAN={'TL':('frond','Single drooping palm frond, the crown cards.'),
 'TR':('fern','Tropical fern clump, the verge and joint cards.'),
 'BL':('blossom-shrub','Flowering shrub with white blossoms.'),
 'BR':('goldfish','Flat-shaded low-poly goldfish in side view.')}

TEXTURES.mkdir(parents=True,exist_ok=True)
EVIDENCE.mkdir(parents=True,exist_ok=True)
manifest={'script':'scripts/prepare-dreamisland-atlases.py',
 'source':'art/references/dreamisland/phase-b',
 'resolution':[SIZE,SIZE],
 'resolutionNote':'One resolution for all six roles, as the phase-B kit README chose. Tideline precedent; Ascension\'s 1254 + 1024 mismatch is not inherited.',
 'uvConvention':{'layout':'2x2 quadrants','vOrigin':'bottom (GL)','inset':INSET,
  'rects':{name:quadrant_uv(name) for name in QUADRANTS}},
 'posterise':{'appliedTo':['concrete','metal','jungle','water'],
  'notAppliedTo':{'signage':'lettering must stay legible at 0.59 m',
   'emissive':'smooth glow gradients band into visible rings',
   'jungle-card':'the magenta key has to stay exact for the runtime discard'},
  'medianFilter':MEDIAN,'saturation':SATURATION,'posterizeBits':POSTERISE_BITS},
 'seamBlend':{'method':'offset by half in both axes, cross-fade the old seams, offset back',
  'blendPixels':BLEND_PIXELS},
 'jpegQuality':JPEG_QUALITY,'jpegSubsampling':'4:4:4',
 'roles':{},'files':{}}

written={}
strip=[]
for role in ROLES:
 source=Image.open(SOURCES/('atlas-'+role+'-gptimage2.png')).convert('RGB')
 assert source.size==(SIZE,SIZE),role+' is not 1024x1024'
 sheet=Image.new('RGB',(SIZE,SIZE))
 entries={}
 for name,(x,y) in QUADRANTS.items():
  cell,description,blend=PLAN[role][name]
  quadrant=source.crop((x+GUTTER,y+GUTTER,x+HALF-GUTTER,y+HALF-GUTTER)).resize((HALF,HALF),Image.LANCZOS)
  record={'cell':cell,'quadrant':name,'is':description,'uv':quadrant_uv(name),
   'pixels':[x+4,y+4,x+HALF-4,y+HALF-4],'gutterTrimPixels':GUTTER,
   'wrapErrorBefore':wrap_error(quadrant)}
  if role=='concrete' and name=='TL':
   quadrant,record['deskew']=road_sand(quadrant)
  if blend:
   quadrant=cross_fade(quadrant);record['seamBlend']=True
  else:
   record['seamBlend']=False
   record['wrapErrorNote']='Not blended: regular or centred art that a cross-fade would ghost.'
  raw=quadrant
  if role in ('concrete','metal','jungle','water'):
   quadrant=flatten(quadrant);record['posterised']=True
  else:
   record['posterised']=False
  if role in ('concrete','water') and name in ('TL','TR'):
   strip.append((role+' '+name,raw,quadrant))
  record['wrapErrorAfter']=wrap_error(quadrant)
  sheet.paste(quadrant,(x,y))
  entries[cell]=record
 if role=='signage':
  for name,(x,y) in QUADRANTS.items():
   cell=PLAN[role][name][0]
   box=plate_boxes(sheet.crop((x,y,x+HALF,y+HALF)),(x,y))
   entries[cell]['plate']={'pixels':list(box),'uv':pixel_uv(box),
    'note':'The dark green field is not a material; UV the plate rect only.',
    'lettering':letter_band(sheet,box)}
   if cell=='plate-gate-numbers':
    # Six separate number plates share one strip, so each gate post needs its
    # own sixth of it rather than the whole run of digits.
    left,top,right,bottom=box;step=(right-left)/6
    entries[cell]['plate']['digits']=[{'digit':index+1,
     'pixels':[int(round(left+index*step)),top,int(round(left+(index+1)*step)),bottom],
     'uv':pixel_uv((left+index*step,top,left+(index+1)*step,bottom))} for index in range(6)]
 path=TEXTURES/(role+'.jpg')
 sheet.save(path,'JPEG',quality=JPEG_QUALITY,subsampling=0,optimize=True)
 written[path]=sheet
 manifest['roles'][role]=entries

# The card sheet: untouched pixels, tight sprite rects, PNG RGB.
card=Image.open(SOURCES/'atlas-jungle-card-gptimage2.png').convert('RGB')
card_entries={}
for name,(x,y) in QUADRANTS.items():
 cell,description=CARD_PLAN[name]
 box=sprite_box(card.crop((x,y,x+HALF,y+HALF)),(x,y))
 card_entries[cell]={'cell':cell,'quadrant':name,'is':description,
  'uv':quadrant_uv(name),'sprite':{'pixels':list(box),'uv':pixel_uv(box)},
  'posterised':False,'seamBlend':False}
card_path=OUT/'jungle-card.png'
card.save(card_path,'PNG',optimize=True)
written[card_path]=card
keyed=np.asarray(card,dtype=int)
manifest['roles']['jungle-card']=card_entries
manifest['jungleCard']={'file':'jungle-card.png','format':'PNG RGB',
 'keyColour':[255,0,255],
 'discard':'min(r,b)-g > .025 in onBeforeCompile, before shared lighting/fog/tonemapping, exactly as src/game/ascension-materials.ts:7-8 does.',
 'keyedPixelFraction':float(((np.minimum(keyed[:,:,0],keyed[:,:,2])-keyed[:,:,1])>6).mean()),
 'note':'No alpha channel. The Ascension attempt at exporting real alpha failed; the key is discarded in the shader instead.'}

for path,image in written.items():
 data=path.read_bytes()
 manifest['files'][str(path.relative_to(ROOT))]={'bytes':len(data),
  'sha256':hashlib.sha256(data).hexdigest(),'size':list(image.size)}

# The before/after the posterise decision was made on: raw left, flattened right.
if strip:
 cell=HALF//2
 board=Image.new('RGB',(cell*2*len(strip),cell),(16,16,16))
 for index,(_,raw,flat) in enumerate(strip):
  board.paste(raw.resize((cell,cell),Image.LANCZOS),(index*cell*2,0))
  board.paste(flat.resize((cell,cell),Image.LANCZOS),(index*cell*2+cell,0))
 board.save(EVIDENCE/'posterise-strip.png')

(OUT/'atlas-manifest.json').write_text(json.dumps(manifest,indent=1))
(EVIDENCE/'atlas-manifest.json').write_text(json.dumps(manifest,indent=1))
print(json.dumps({'roles':ROLES,'resolution':[SIZE,SIZE],
 'files':{k:v['bytes'] for k,v in manifest['files'].items()},
 'roadSandDeskew':manifest['roles']['concrete']['road-sand'].get('deskew'),
 'keyedPixelFraction':manifest['jungleCard']['keyedPixelFraction']},indent=1))
