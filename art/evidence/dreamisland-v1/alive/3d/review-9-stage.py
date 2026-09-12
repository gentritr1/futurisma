"""Install a water stage ONLY in the isolated tree; preserve source snapshots."""
from pathlib import Path
import sys,json,hashlib,re
root=Path.cwd();e=root/'art/evidence/dreamisland-v1/alive/3d';target=Path('/tmp/dreamisland-f3d-eafe0b9')
stage=int(sys.argv[1]);out=e/'review-9'/f'step-{stage}';out.mkdir(exist_ok=True)
if stage>0:
 previous=json.loads((out.parent/f'step-{stage-1}'/'review-measurements.json').read_text())
 assert {(r['pose'],r['blend']) for r in previous}=={(p,b) for p in ['court','reef'] for b in ['000','100']},'Measure both poses/states before advancing'
w=(root/'src/game/dreamisland-water.ts').read_text();r=(root/'src/game/dreamisland-reflections.ts').read_text()
if stage<4:
 w=w.replace('emissive:0x48f4ec','emissive:0x8ff4ec')
 w=w.replace('new THREE.Color().setRGB(.0005,.001,.002)','new THREE.Color(0x1a2230)')
 w=w.replace("if(road)applyDreamIslandReflection(road.material as THREE.MeshLambertMaterial,this.reflections,this.time,'road');",'// Wet road is installed in step 4.')
if stage<3:w=w.replace('  applyDreamIslandDepthBand(shallowsMaterial);','  // Accepted depth band is replayed in step 3.')
if stage<2:r=re.sub(r'float diGlint=[^;]+;', 'float diGlint=0.;',r)
if stage==0:w=w.replace('  for(const material of [seaMaterial,shallowsMaterial])applyDreamIslandReflection(material,this.reflections,this.time);','  // Baseline: original lit water, no reflection or glint.')
for name,s in [('dreamisland-water.ts',w),('dreamisland-reflections.ts',r)]:
 (target/'src/game'/name).write_text(s);(out/name).write_text(s)
(out/'stage.json').write_text(json.dumps({'stage':stage,'base':'eafe0b9','reviewBrief':'216bafe','acceptedAO':True,'sourceHashes':{n:hashlib.sha256(s.encode()).hexdigest() for n,s in [('dreamisland-water.ts',w),('dreamisland-reflections.ts',r)]}},indent=2))
print(out)
