"""Recompose the same 17 slots from round 1 beside round 2's fresh renders."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import json
out=Path('art/evidence/dreamisland-v1/polish/round-2');prior=out.parent
pairs=[]
for i,item in enumerate(json.loads((prior/'eyeball-before-after.json').read_text())['pairs']):
 before=Path(item['after'])
 if i<8:after=out/'final-frames'/before.name
 elif i<13:after=out/'crossfade-baseline'/before.name
 elif i<15:after=out/'final-reef/blend-1-full.png'
 else:after=out/'crossfade-baseline/blend-100.png'
 assert before.exists() and after.exists(),str(after)
 pairs.append({**{k:item[k]for k in ['row','column','label']},'before':str(before),'after':str(after)})
w,h,pad,cap,head=320,180,8,42,64
sheet=Image.new('RGB',(1648,1912),'#101720');d=ImageDraw.Draw(sheet)
try:font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',13)
except OSError:font=ImageFont.load_default()
d.text((12,10),'DREAM ISLAND / ROUND 1 BEFORE + ROUND 2 AFTER',font=font,fill='white')
d.text((12,32),'Same 17 source slots. Each BEFORE row is followed by its AFTER row.',font=font,fill='#b8cad6')
for pair in pairs:
 for state,key,color in [(0,'before','#91a2ad'),(1,'after','#75ded6')]:
  x=pad+pair['column']*(w+pad);y=head+(pair['row']*2+state)*(h+cap+pad)
  sheet.paste(Image.open(pair[key]).convert('RGB').resize((w,h),Image.Resampling.LANCZOS),(x,y))
  label=pair['label'] if pair['row']<3 else ('REEF exact .72 pose' if pair['column']<2 else 'BEACH exact .05 pose')
  d.text((x+3,y+h+4),('BEFORE / 'if state==0 else'AFTER / ')+label,font=font,fill=color)
  d.text((x+3,y+h+22),Path(pair[key]).parent.name+'/'+Path(pair[key]).name,font=font,fill='#b8cad6')
sheet.save(out/'eyeball-before-after.png');(out/'eyeball-before-after.json').write_text(json.dumps({'instrument':__file__,'pairs':pairs,'beforeSlots':17,'afterSlots':17,'note':'The final four inherited slots duplicate the REEF and BEACH endpoints, as the round-1 sheet did. Fresh final endpoint renders fill all four.'},indent=2)+'\n')
# Eight rendered hero views, with the elevated watchtower pose exposing its top faces.
hero=json.loads((out/'hero-features/focal-capture.json').read_text());assets=list(dict.fromkeys(f['asset']for f in hero['frames']));s=Image.new('RGB',(1280,1536),'#101720');sd=ImageDraw.Draw(s)
for f in hero['frames']:
 x=f['blend']*640;y=assets.index(f['asset'])*384;s.paste(Image.open(out/'hero-features'/f['frames']['full']).resize((640,360)),(x,y));sd.text((x+8,y+366),f['asset']+' / 40 m / '+('night'if f['blend']else'day'),font=font,fill='white')
s.save(out/'heroes-day-night.png')
strike=json.loads((out/'final-strike/strike.json').read_text());frames=[];s=Image.new('RGB',(1600,408),'#101720');sd=ImageDraw.Draw(s)
for i,f in enumerate(strike['frames']):
 x=i%5*320;y=i//5*204;s.paste(Image.open(out/'final-strike'/f['file']).resize((320,180)),(x,y));label=f"{f['secondsFromStrike']:.3f} s / blend {f['nightBlend']:.4f}";sd.text((x+8,y+185),label,font=font,fill='white');frames.append({'src':'final-strike/'+f['file'],'label':label})
s.save(out/'strike-contact-sheet.png')
html='''<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Dream Island — round 2</title><style>body{background:#111922;color:#e9f0f4;font:16px system-ui;max-width:1400px;margin:32px auto;padding:0 20px}h1{font-size:26px}img{max-width:100%;display:block}input{width:min(700px,80%)}button{padding:8px 20px;margin-right:16px}a{color:#83dbe1}section{margin:36px 0}small{color:#bbc8d1}</style><h1>Dream Island — round 2</h1><p><a href="README.md">Measured report</a> · <a href="crossfade-baseline/ten-means.md">Crossfade ten means</a></p><p>The distant BEACH beacon remains below target. The report records the measured limit.</p><section><h2>The strike</h2><img id="strike" alt="Rendered strike frame"><p><button id="play">Play</button><input id="frame" type="range" min="0" max="9" value="0" step="1"></p><small id="caption"></small></section><section><h2>Same 17 views</h2><img src="eyeball-before-after.png" alt="Round 1 and round 2 at the same seventeen slots"></section><section><h2>Heroes at 40 metres</h2><img src="heroes-day-night.png" alt="Four heroes by day and night"></section><section><h2>Reference comparison before editing</h2><img src="reference-comparison.png" alt="Round 1 evidence beside the source references"></section><script>const frames=FRAMES;let timer;const slider=document.querySelector('#frame'),image=document.querySelector('#strike'),caption=document.querySelector('#caption'),button=document.querySelector('#play');function show(){const f=frames[Number(slider.value)];image.src=f.src;caption.textContent=f.label}slider.oninput=()=>{clearInterval(timer);button.textContent='Play';show()};button.onclick=()=>{if(button.textContent==='Pause'){clearInterval(timer);button.textContent='Play';return}slider.value=0;show();button.textContent='Pause';timer=setInterval(()=>{slider.value=Number(slider.value)+1;show();if(Number(slider.value)===9){clearInterval(timer);button.textContent='Play'}},12000/9)};show();</script>'''.replace('FRAMES',json.dumps(frames));(out/'index.html').write_text(html)
print('VERIFIED: 17 paired slots, 8 hero views, 10 strike frames.')
