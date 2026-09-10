"""Extract eight deterministic median-cut swatches per reference/game state."""
import json,sys
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
out=Path(sys.argv[1]);day,night=map(Path,sys.argv[2:4]);out.mkdir(parents=True,exist_ok=True)
reference=Path('art/references/dreamisland/heroes/08_the_strike.png');ref=Image.open(reference).convert('RGB')
images={'Reference day':ref.crop((0,0,ref.width//2,ref.height)),'Game day':Image.open(day).convert('RGB'),'Reference night':ref.crop((ref.width//2,0,ref.width,ref.height)),'Game night':Image.open(night).convert('RGB')}
result={}
for name,image in images.items():
 q=image.quantize(8,method=Image.Quantize.MEDIANCUT);palette=q.getpalette()
 result[name]=[{'rgb':palette[i*3:i*3+3],'hex':'#'+''.join(f'{v:02x}' for v in palette[i*3:i*3+3]),'pixelShare':count/(image.width*image.height)} for count,i in sorted(q.getcolors(),reverse=True)]
report={'instrument':__file__,'reference':str(reference),'gameDay':str(day),'gameNight':str(night),'method':'Eight-color Pillow MEDIANCUT on each complete HUD-free game frame and each reference half separately; percentages are each swatch index pixel counts. Different scene composition changes swatch proportions.','palettes':result}
(out/'palette.json').write_text(json.dumps(report,indent=2)+'\n')
sheet=Image.new('RGB',(1280,640),'#151b23');draw=ImageDraw.Draw(sheet)
for row,(name,swatches) in enumerate(result.items()):
 y=row*160;draw.text((16,y+12),name,fill='white')
 for i,s in enumerate(swatches):
  x=i*160;draw.rectangle((x,y+38,x+157,y+112),fill=tuple(s['rgb']));draw.text((x+8,y+120),s['hex']+' '+f"{s['pixelShare']:.1%}",fill='white')
sheet.save(out/'palette-swatches.png');print(json.dumps(report,indent=2))
