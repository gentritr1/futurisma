import json,sys
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
base=Path('art/evidence/dreamisland-v1/alive/3d');rows=[]
source=base/(sys.argv[1] if len(sys.argv)>1 else 'step-4');out=base/(sys.argv[2] if len(sys.argv)>2 else '.')
target=Image.open('art/references/dreamisland/phase-f/target-court-day-gptimage2.png').convert('RGB');w,h=target.size
rect=[0,round(.415*h),round(.064*w),round(.49*h)]
inputs=[('painting-water',np.asarray(target.crop(rect)).reshape(-1,3),{'rectangle':rect})]
for pose in ['court','reef']:
 p=source/pose
 full=np.asarray(Image.open(p/'blend-000.png').convert('RGB'));sea=np.asarray(Image.open(p/'blend-000-sea.png').convert('RGB'));shallow=np.asarray(Image.open(p/'blend-000-glow.png').convert('RGB'));blank=np.asarray(Image.open(p/'blend-000-blank.png').convert('RGB'))
 mask=(np.all(full==sea,2)&np.any(sea!=blank,2))|(np.all(full==shallow,2)&np.any(shallow!=blank,2))
 inputs.append((pose+'-water',full[mask],{'mask':'visible pixels exactly matching sea or shallows isolation and differing from blank'}))
for name,pixels,region in inputs:
 im=Image.fromarray(pixels.reshape(1,-1,3));q=im.quantize(colors=8,method=Image.Quantize.MEDIANCUT)
 palette=q.getpalette();colors=[]
 for count,index in sorted(q.getcolors(),reverse=True):
  rgb=palette[index*3:index*3+3];colors.append(dict(hex='#'+''.join(f'{v:02x}' for v in rgb),percent=round(count/len(pixels)*100,2)))
 rows.append(dict(name=name,pixels=len(pixels),region=region,palette=colors))
canvas=Image.new('RGB',(800,len(rows)*100),'white');draw=ImageDraw.Draw(canvas)
for i,row in enumerate(rows):
 draw.text((8,i*100+5),row['name'],fill='black')
 for j,color in enumerate(row['palette']):
  draw.rectangle((j*100,i*100+25,j*100+98,i*100+74),fill=color['hex']);draw.text((j*100+3,i*100+78),color['hex'],fill='black')
canvas.save(out/'water-palettes.png');(out/'water-palettes.json').write_text(json.dumps(rows,indent=2));print(json.dumps(rows,indent=2))
