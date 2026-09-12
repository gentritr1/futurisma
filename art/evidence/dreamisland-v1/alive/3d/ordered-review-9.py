"""Replay each stage, capture both poses, then measure before advancing."""
from pathlib import Path
import subprocess,sys
root=Path.cwd();e=Path('art/evidence/dreamisland-v1/alive/3d')
start=int(sys.argv[1]);end=int(sys.argv[2])
for stage in range(start,end+1):
 subprocess.run(['python3',str(e/'review-9-stage.py'),str(stage)],check=True)
 for pose,progress in [('court','.575'),('reef','.75')]:
  command=['node',str(e/'capture-9.mjs'),'--base=http://127.0.0.1:5204','--source-root=/tmp/dreamisland-f3d-eafe0b9','--progress='+progress,'--blends=0,1','--out='+str(e/'review-9'/f'step-{stage}'/pose)]
  subprocess.run(command,check=True)
 subprocess.run(['python3',str(e/'measure.py'),f'review-9/step-{stage}'],check=True)
 subprocess.run(['python3',str(e/'measure-9.py'),f'review-9/step-{stage}'],check=True)
