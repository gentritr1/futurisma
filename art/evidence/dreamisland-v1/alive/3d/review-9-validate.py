"""Validate the isolated final renderer without editing F-CODE files."""
from pathlib import Path
import subprocess,json
root=Path.cwd();out=root/'art/evidence/dreamisland-v1/alive/3d/review-9';target=Path('/tmp/dreamisland-f3d-eafe0b9');rows=[]
for label,command in [('build',['npm','run','build']),('build-ceilings',['node','scripts/validate-build.mjs']),('runtime',['npm','run','validate:dreamisland-runtime']),('painted',['npm','run','validate:dreamisland-painted'])]:
 with (out/(label+'.log')).open('w') as log:result=subprocess.run(command,cwd=target,stdout=log,stderr=subprocess.STDOUT)
 rows.append(dict(check=label,command=command,cwd=str(target),exitCode=result.returncode));print(rows[-1],flush=True)
(out/'validation.json').write_text(json.dumps(rows,indent=2));assert all(r['exitCode']==0 for r in rows)
subprocess.run(['node',str(root/'art/evidence/dreamisland-v1/alive/3d/measure-build.mjs'),str(out)],cwd=root,check=True)
