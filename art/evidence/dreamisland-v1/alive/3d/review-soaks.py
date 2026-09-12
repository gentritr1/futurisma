"""Compare current water with a matched no-reflection control; no overlap."""
from pathlib import Path
import subprocess,sys
root=Path.cwd();e=root/'art/evidence/dreamisland-v1/alive/3d';target=Path('/tmp/dreamisland-f3d-eafe0b9');runtime=target/'src/game'
# Accepted geometry, AO and glow stay fixed, including during the control soak.
final={n:(root/'src/game'/n).read_bytes() for n in ['dreamisland-water.ts','dreamisland-reflections.ts']}
try:
 for label,tier,reduced in [('baseline','works',False),('works','works',False),('rookie','rookie',False),('feral','feral',False),('works-reduced','works',True)]:
  water=final['dreamisland-water.ts'].decode()
  if label=='baseline':
   water=water.replace('  for(const material of [shallowsMaterial,foamMaterial])applyDreamIslandEmissionDistance(material);','  // Matched performance control: no emission distance response.')
   water=water.replace('  for(const material of [seaMaterial,shallowsMaterial])applyDreamIslandReflection(material,this.reflections,this.time);','  // Matched performance control: no water reflection or glint.')
   water=water.replace("if(road)applyDreamIslandReflection(road.material as THREE.MeshLambertMaterial,this.reflections,this.time,'road');",'// Matched performance control: no wet road.')
  (runtime/'dreamisland-water.ts').write_text(water);(runtime/'dreamisland-reflections.ts').write_bytes(final['dreamisland-reflections.ts'])
  command=['node',str(e/'race.mjs'),'--base=http://127.0.0.1:5204','--tier='+tier,'--out='+str(e/'review-8'/('soak-'+label))]+(['--reduced'] if reduced else [])
  subprocess.run(command,cwd=target,check=True)
finally:
 for name,data in final.items():(runtime/name).write_bytes(data)
