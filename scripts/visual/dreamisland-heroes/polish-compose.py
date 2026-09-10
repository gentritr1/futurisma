"""Compose the requested before/after sheet and a local strike flipbook."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import json,html
out=Path('art/evidence/dreamisland-v1/polish');phase=out.parent/'phase-c'
original=json.loads((phase/'eyeball-contact-sheet.json').read_text());pairs=[]
for i,tile in enumerate(original['tiles']):
 before=Path(tile['source'])
 if i<8:after=out/'frames'/before.name
 elif i<13:after=out/'crossfade-baseline'/before.name
 elif i<15:after=out/'pier-edge'/'blend-100.png'
 else:after=out/'crossfade-baseline'/'blend-100.png'
 assert before.exists() and after.exists(),str(after)
 pairs.append({**tile,'before':str(before),'after':str(after)})
w=320;h=180;pad=8;caption=42;header=64
sheet=Image.new('RGB',(5*w+6*pad,header+8*(h+caption+pad)+pad),'#101720');draw=ImageDraw.Draw(sheet)
try:font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',13)
except OSError:font=ImageFont.load_default()
draw.text((12,10),'DREAM ISLAND / PHASE C BEFORE + POLISH AFTER',font=font,fill='white')
draw.text((12,32),'The same 17 source slots. Each BEFORE row is followed by its AFTER row.',font=font,fill='#b8cad6')
for pair in pairs:
 for state,key,color in [(0,'before','#91a2ad'),(1,'after','#75ded6')]:
  x=pad+pair['column']*(w+pad);y=header+(pair['row']*2+state)*(h+caption+pad)
  sheet.paste(Image.open(pair[key]).convert('RGB').resize((w,h),Image.Resampling.LANCZOS),(x,y))
  label=('BEFORE / ' if state==0 else 'AFTER / ')+pair['label']
  if state==1 and pair['row']==3:label='AFTER / '+('REEF exact .72 pose' if pair['column']<2 else 'BEACH exact .05 pose')
  draw.text((x+3,y+h+4),label,font=font,fill=color)
  draw.text((x+3,y+h+22),Path(pair[key]).parent.name+'/'+Path(pair[key]).name,font=font,fill='#b8cad6')
sheet.save(out/'eyeball-before-after.png')
record={'instrument':__file__,'pairs':pairs,'beforeSlots':len(pairs),'afterSlots':len(pairs),'note':'The last four Phase C slots contain historical before/after edge pairs. Each pair used an identical camera, so the two corresponding AFTER slots reuse the same fresh endpoint capture. The old defects are preserved only in the BEFORE rows, never recreated or relabelled as new renders.'}
(out/'eyeball-before-after.json').write_text(json.dumps(record,indent=2)+'\n')
strike=json.loads((out/'strike/strike.json').read_text())
frames=[{'src':'strike/'+f['file'],'label':f"{f['secondsFromStrike']:.3f} s after strike · blend {f['nightBlend']:.4f} · tick {f['tick']}"}for f in strike['frames']]
page='''<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Dream Island polish evidence</title><style>body{background:#111922;color:#e9f0f4;font:16px system-ui;max-width:1400px;margin:32px auto;padding:0 20px}h1{font-size:26px}img{max-width:100%;display:block}input{width:min(700px,80%)}button{padding:8px 20px;margin-right:16px}a{color:#83dbe1}section{margin:36px 0}small{color:#bbc8d1}</style><h1>Dream Island — polish review</h1><p><a href="README.md">Measured report</a> · <a href="crossfade-baseline/ten-means.md">Ten means, before / after / repeat</a></p><section><h2>The strike</h2><p>Ten actual rendered frames across the shipped twelve-second ramp.</p><img id="strike" alt="Dream Island strike frame"><p><button id="play">Play</button><input id="frame" type="range" min="0" max="9" value="0" step="1"></p><small id="caption"></small></section><section><h2>Before and after</h2><img src="eyeball-before-after.png" alt="Phase C and polish at the same seventeen source slots"></section><section><h2>Palette</h2><img src="palette/palette-swatches.png" alt="Eight dominant colours per reference and game state"></section><section><h2>Horizon profiles</h2><img src="horizon-profiles.png" alt="Four day frames with their row-luma profiles"></section><script>const frames=FRAMES;let timer;const slider=document.querySelector('#frame'),image=document.querySelector('#strike'),caption=document.querySelector('#caption'),button=document.querySelector('#play');function show(){const f=frames[Number(slider.value)];image.src=f.src;caption.textContent=f.label}slider.oninput=()=>{clearInterval(timer);button.textContent='Play';show()};button.onclick=()=>{if(button.textContent==='Pause'){clearInterval(timer);button.textContent='Play';return}slider.value=0;show();button.textContent='Pause';timer=setInterval(()=>{slider.value=Number(slider.value)+1;show();if(Number(slider.value)===9){clearInterval(timer);button.textContent='Play'}},12000/9)};show();</script>'''.replace('FRAMES',json.dumps(frames))
(out/'index.html').write_text(page)
strike_sheet=Image.new('RGB',(1600,408),'#101720');sd=ImageDraw.Draw(strike_sheet)
for i,entry in enumerate(strike['frames']):
 x=i%5*320;y=i//5*204;strike_sheet.paste(Image.open(out/'strike'/entry['file']).resize((320,180)),(x,y));sd.text((x+8,y+185),f"{entry['secondsFromStrike']:.3f} s / blend {entry['nightBlend']:.4f}",fill='white')
strike_sheet.save(out/'strike/contact-sheet.png')
# One readable atlas contact sheet covers the rendered source and quadrant-ID checks.
atlas=[]
for label,folder,qfolder in [('Original','atlas-original','atlas-original-quadrant'),('Added','atlas-added','atlas-added-quadrant')]:
 data=json.loads((out/qfolder/'atlas-quadrant-proof.json').read_text())
 for r in data['results']:atlas.append((label,r,out/folder/(r['id']+'.png'),out/qfolder/(r['id']+'.png')))
atlas_sheet=Image.new('RGB',(1280,((len(atlas)+3)//4)*230),'#101720');d=ImageDraw.Draw(atlas_sheet)
for i,(kind,r,normal,quad) in enumerate(atlas):
 x=(i%4)*320;y=(i//4)*230
 for source,offset in [(normal,0),(quad,160)]:
  assert source.exists();im=Image.open(source).convert('RGB');im.thumbnail((160,180));atlas_sheet.paste(im,(x+offset,y+25))
 d.text((x+4,y+4),kind+' / '+r['id'],font=font,fill='white');d.text((x+4,y+190),r['cell']+' / '+r['claimed']+' -> '+r['nearest'],font=font,fill='#75ded6');d.text((x+4,y+208),str(r['maskedPixels'])+' pixels / '+str(r['decided']),font=font,fill='#b8cad6')
atlas_sheet.save(out/'atlas-cells.png')
print('VERIFIED paired slots',len(pairs),'strike frames',len(frames),'atlas consumers',len(atlas))
# Keep every required focal distance/state and every district verge reviewable.
focals=json.loads((out/'focals/focal-capture.json').read_text())
focal_sheet=Image.new('RGB',(1280,4*204),'#101720');fd=ImageDraw.Draw(focal_sheet)
assets=list(dict.fromkeys(item['asset'] for item in focals['frames']))
for item in focals['frames']:
 x=(int(item['distance']==300)*2+int(item['blend']))*320;y=assets.index(item['asset'])*204
 focal_sheet.paste(Image.open(out/'focals'/item['frames']['full']).resize((320,180)),(x,y))
 fd.text((x+6,y+186),item['asset']+' / '+str(item['distance'])+' m / '+('night' if item['blend'] else 'day'),fill='white')
focal_sheet.save(out/'focals/contact-sheet.png')
verges=json.loads((out/'frames/frames.json').read_text());districts=list(dict.fromkeys(item['district'] for item in verges['frames']))
verge_sheet=Image.new('RGB',(1280,len(districts)*384),'#101720');vd=ImageDraw.Draw(verge_sheet)
for item in verges['frames']:
 x=int(item['state']=='night')*640;y=districts.index(item['district'])*384
 verge_sheet.paste(Image.open(out/'frames'/item['frame']).resize((640,360)),(x,y));vd.text((x+8,y+366),item['district']+' / '+item['state'],fill='white')
verge_sheet.save(out/'frames/verge-contact-sheet.png')
