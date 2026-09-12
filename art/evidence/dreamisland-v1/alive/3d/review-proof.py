"""Pixel proofs and literal §8 gates; never turn a missing white mask into a pass."""
import json,hashlib,importlib.util
from pathlib import Path
from PIL import Image
import numpy as np
root=Path.cwd();e=root/'art/evidence/dreamisland-v1/alive/3d';out=e/'review-8'
spec=importlib.util.spec_from_file_location('grade',root/'scripts/visual/grade/measure-frames.py');grade=importlib.util.module_from_spec(spec);spec.loader.exec_module(grade)
def pixels(path):return np.array(Image.open(path).convert('RGB'))
result={'sky':[],'rails':[],'emission':[],'gates':[]}
old=json.loads((e/'step-0/review-measurements.json').read_text())
for pose in ['court','reef']:
 for blend in ['000','100']:
  before=out/'step-0'/pose;after=out/'step-4'/pose;name=f'blend-{blend}'
  for kind in ['sky','rails']:
   a=pixels(before/f'{name}-{kind}.png');b=pixels(after/f'{name}-{kind}.png')
   result[kind].append(dict(pose=pose,blend=blend,changedPixels=int(np.any(a!=b,axis=2).sum())))
  result['sky'].append(dict(pose=pose,blend=blend,reference='original step-0',changedPixels=int(np.any(pixels(e/'step-0'/pose/f'{name}-sky.png')!=pixels(after/f'{name}-sky.png'),axis=2).sum())))
  if blend=='100':
   result['emission'].append(dict(pose=pose,withEmission=grade.measure(str(after/f'{name}.png')),withoutWaterEmission=grade.measure(str(after/f'{name}-without-water-emission.png'))))
  for folder in [before,after]:
   pixels_path=folder/f'{name}.png'
   # Same source rectangle for every stage, no resampling before the 2x enlargement.
   Image.open(pixels_path).crop((0,260,400,460)).resize((800,400),Image.Resampling.NEAREST).save(folder/f'{name}-sea-2x.png')
   Image.open(folder/f'{name}-rails.png').crop((90,325,490,525)).resize((800,400),Image.Resampling.NEAREST).save(folder/f'{name}-rails-2x.png')
rows=json.loads((out/'step-4/review-measurements.json').read_text())
painting_p99=next(r for r in old if r['pose']=='court' and r['blend']=='100')['paintingRoad']['p99']
for row in rows:
 pose,blend=row['pose'],row['blend'];baseline=next(r for r in old if r['pose']==pose and r['blend']==blend)
 sea,road=row['sea'],row['road']
 checks={'skyUnchanged':all(r['changedPixels']==0 for r in result['sky'] if r['pose']==pose and r['blend']==blend),'railsUnchanged':all(r['changedPixels']==0 for r in result['rails'] if r['pose']==pose and r['blend']==blend)}
 if blend=='000':checks.update(seaChroma=sea['chroma']>=baseline['sea']['chroma'],seaMedian=abs(sea['p50']-baseline['sea']['p50'])<=8,wholeFrameChroma=row['chromaMean']>=21.8,seaWhite=.15<=sea['whitePct']<=1,whiteBlob=sea['maxWhiteBlob']<=60,autocorrelation=sea['autocorrelationPeak']<=.3)
 else:checks.update(roadMedian=road['p50']>=30.9,roadWhite=road['whitePct']==0,roadP99=road['p99']<=painting_p99,roadAutocorrelation=road['autocorrelationPeak']<=.3,nightP99=row['p99']>=150,nightRange=row['range']>=140)
 result['gates'].append(dict(pose=pose,blend=blend,checks=checks))
old_ref=(out/'rejected-dreamisland-reflections.ts').read_text();new_ref=(root/'src/game/dreamisland-reflections.ts').read_text();marker='/** The two node recipes.'
result['acceptedRecipesAndGlowUnchanged']=old_ref[old_ref.index(marker):]==new_ref[new_ref.index(marker):]
result['paintingRoadP99']=painting_p99
result['finalSourceHashes']={f:hashlib.sha256((root/f).read_bytes()).hexdigest() for f in ['src/game/dreamisland-water.ts','src/game/dreamisland-reflections.ts']}
(out/'proof.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
