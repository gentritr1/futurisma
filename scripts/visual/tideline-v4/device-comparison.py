from pathlib import Path
from PIL import Image,ImageDraw
root=Path('art/evidence/tideline-v4/devices')
hero=Image.open('art/references/power-kit-v2/hero.png').convert('RGB')
for index,kind in enumerate(['surge','shield']):
 reference=hero.crop((hero.width//2*index,0,hero.width//2*(index+1),hero.height)).resize((768,1024))
 model=Image.open(root/(kind+'-idle.png')).convert('RGB')
 comparison=Image.new('RGB',(1536,1064),'#26343a');comparison.paste(reference,(0,40));comparison.paste(model,(768,40))
 draw=ImageDraw.Draw(comparison);draw.text((20,12),'GENERATED HERO / '+kind.upper(),fill='white');draw.text((788,12),'ACTUAL GLB / GAME AgX + FOG',fill='white')
 comparison.save(root/(kind+'-hero-versus-model.png'))
