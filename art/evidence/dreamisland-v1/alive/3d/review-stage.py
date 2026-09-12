"""Install a water stage ONLY in the isolated tree; preserve source snapshots."""
from pathlib import Path
import sys,json,hashlib
root=Path.cwd();e=root/'art/evidence/dreamisland-v1/alive/3d';target=Path('/tmp/dreamisland-f3d-eafe0b9')
stage=int(sys.argv[1]);out=e/'review-8'/f'step-{stage}';out.mkdir(exist_ok=True)
if stage>0:assert (out.parent/f'step-{stage-1}'/'review-measurements.json').exists(),'Measure both poses before advancing'
w=(root/'src/game/dreamisland-water.ts').read_text();r=(root/'src/game/dreamisland-reflections.ts').read_text()
if stage<4:
 w=w.replace('  for(const material of [shallowsMaterial,foamMaterial])applyDreamIslandEmissionDistance(material);','  // Distance response is installed in step 4.')
 w=w.replace('new THREE.Color().setRGB(.0005,.001,.002)','new THREE.Color(0x1a2230)').replace('nightBlend*64.0','nightBlend*1.20').replace('nightBlend*96.0','nightBlend*1.50')
 w=w.replace("if(road)applyDreamIslandReflection(road.material as THREE.MeshLambertMaterial,this.reflections,this.time,'road');",'// Wet road is installed in step 4.')
if stage<3:w=w.replace('  applyDreamIslandDepthBand(shallowsMaterial);','  // Accepted depth band is replayed in step 3.')
if stage<2:r=r.replace('float diGlint=min(1.,pow(max(dot(diNormal,diHalf),0.),64.)*4.);','float diGlint=0.;')
if stage==0:w=w.replace('  for(const material of [seaMaterial,shallowsMaterial])applyDreamIslandReflection(material,this.reflections,this.time);','  // Baseline: original lit water, no reflection or glint.')
for name,s in [('dreamisland-water.ts',w),('dreamisland-reflections.ts',r)]:
 (target/'src/game'/name).write_text(s);(out/name).write_text(s)
(out/'stage.json').write_text(json.dumps({'stage':stage,'base':'eafe0b9','reviewBrief':'9d7f744','acceptedAO':True,'sourceHashes':{n:hashlib.sha256(s.encode()).hexdigest() for n,s in [('dreamisland-water.ts',w),('dreamisland-reflections.ts',r)]}},indent=2))
print(out)
