#!/usr/bin/env python3
"""
One sheet a person can accept or reject in a single look.

    python3 scripts/visual/dreamisland/contact-sheet.py [OUT_DIR]

Phase B's fourteen district frames were never accepted by anyone, and phase C
adds five crossfade frames and two before/after pairs on top of them. A reviewer
asked to open twenty-one PNGs will not do it, so the eyeball set the phase brief
names - day and night at BEACH, POINT, BASIN and REEF, plus the five points of
the crossfade - is composed here into one image, with the two night-state
before/after pairs beside them because those are the only tiles on the sheet
where something was CHANGED rather than measured.

Every tile is captioned with the file it came from and the measured `nightBlend`
where the source recorded one, so a tile can be traced back rather than trusted.
A missing source is drawn as a labelled gap instead of being skipped, because a
contact sheet that quietly omits a frame is how a missing frame gets accepted.
"""
import json,sys
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont

ROOT=Path(__file__).resolve().parents[3]
OUT=Path(sys.argv[1]) if len(sys.argv)>1 else ROOT/'art/evidence/dreamisland-v1/phase-c'
if not OUT.is_absolute():OUT=ROOT/OUT
FRAMES=OUT/'frames'
CROSSFADE=OUT/'crossfade-shipped'
BASE=OUT/'crossfade'
PIER=OUT/'pier-edge'
TILE_WIDTH=384
COLUMNS=5
CAPTION=34
HEADER=64
PAD=8

def blend_of(directory,name):
 """The measured nightBlend beside a frame, never a guess."""
 record=directory/'frames.json'
 if record.exists():
  for row in json.loads(record.read_text())['frames']:
   if row.get('frame')==name:return row.get('nightBlend')
 record=directory/'crossfade-capture.json'
 if record.exists():
  for row in json.loads(record.read_text())['captures']:
   if row['frames']['full']==name:return row['applied'].get('skyUniformNightBlend')
 return None

rows=[
 [(FRAMES,'day-beach.png','BEACH day'),(FRAMES,'day-point.png','POINT day'),
  (FRAMES,'day-basin.png','BASIN day'),(FRAMES,'day-reef.png','REEF day'),None],
 [(FRAMES,'night-beach.png','BEACH night'),(FRAMES,'night-point.png','POINT night'),
  (FRAMES,'night-basin.png','BASIN night'),(FRAMES,'night-reef.png','REEF night'),None],
 [(CROSSFADE,'blend-000.png','crossfade 0.00'),(CROSSFADE,'blend-025.png','crossfade 0.25'),
  (CROSSFADE,'blend-050.png','crossfade 0.50'),(CROSSFADE,'blend-075.png','crossfade 0.75'),
  (CROSSFADE,'blend-100.png','crossfade 1.00')],
 [(PIER/'before','blend-100.png','REEF night BEFORE the water fixes'),
  (PIER/'after','blend-100.png','REEF night AFTER'),
  (BASE,'blend-100.png','BEACH night BEFORE'),
  (CROSSFADE,'blend-100.png','BEACH night AFTER'),None],
]
sample=None
for row in rows:
 for cell in row:
  if cell and (cell[0]/cell[1]).exists():
   sample=Image.open(cell[0]/cell[1]);break
 if sample:break
if sample is None:raise SystemExit('No source frame exists yet; run frames.mjs and crossfade-profile.mjs first.')
aspect=sample.size[1]/sample.size[0]
tile_height=round(TILE_WIDTH*aspect)
width=COLUMNS*TILE_WIDTH+(COLUMNS+1)*PAD
height=HEADER+len(rows)*(tile_height+CAPTION+PAD)+PAD
sheet=Image.new('RGB',(width,height),(16,17,20))
draw=ImageDraw.Draw(sheet)
try:font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',15)
except OSError:font=ImageFont.load_default()
try:title=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf',20)
except OSError:title=font
draw.text((PAD,14),'DREAM ISLAND (MAP 07) - PHASE C EYEBALL SET',fill=(235,235,235),font=title)
draw.text((PAD,40),'Rows: day districts | night districts | the five-point crossfade | the two night fixes, before and after. '
 'Headless Chrome 1280x720 on ANGLE/Metal. Nothing here is a device.',fill=(150,152,158),font=font)
manifest=[]
for r,row in enumerate(rows):
 top=HEADER+r*(tile_height+CAPTION+PAD)
 for c,cell in enumerate(row):
  if cell is None:continue
  directory,name,label=cell
  left=PAD+c*(TILE_WIDTH+PAD)
  path=directory/name
  if path.exists():
   frame=Image.open(path).convert('RGB').resize((TILE_WIDTH,tile_height),Image.LANCZOS)
   sheet.paste(frame,(left,top))
   blend=blend_of(directory,name)
   caption=label if blend is None else f'{label}  ·  nightBlend {blend}'
   manifest.append({'row':r,'column':c,'label':label,'source':str(path.relative_to(ROOT)),'nightBlend':blend})
  else:
   draw.rectangle([left,top,left+TILE_WIDTH,top+tile_height],outline=(120,60,60),width=2)
   draw.text((left+12,top+tile_height//2),'MISSING: '+str(path.relative_to(ROOT)),fill=(210,120,120),font=font)
   caption=label+'  ·  MISSING'
   manifest.append({'row':r,'column':c,'label':label,'source':str(path.relative_to(ROOT)),'missing':True})
  draw.text((left+2,top+tile_height+8),caption,fill=(205,207,212),font=font)
sheet_path=OUT/'eyeball-contact-sheet.png'
sheet.save(sheet_path)
(OUT/'eyeball-contact-sheet.json').write_text(json.dumps(
 {'script':'scripts/visual/dreamisland/contact-sheet.py','sheet':str(sheet_path.relative_to(ROOT)),
  'tileWidth':TILE_WIDTH,'tiles':manifest,
  'missing':[t['source'] for t in manifest if t.get('missing')],
  'note':'A user eyeball on this sheet is what closes the look of phase B and phase C. No number on it is an acceptance.'},
 indent=1))
print(json.dumps({'sheet':str(sheet_path.relative_to(ROOT)),'tiles':len(manifest),
 'missing':[t['source'] for t in manifest if t.get('missing')]},indent=1))
