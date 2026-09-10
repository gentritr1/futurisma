"""Read-only asset/HEAD comparison; writes its report only beside this script."""
import hashlib
import json
import subprocess
from pathlib import Path

OUT=Path(__file__).resolve().parent
ROOT=OUT.parents[3]
manifest=json.loads((ROOT/'public/assets/dreamisland/heroes/heroes.json').read_text())
baseline=json.loads((OUT/'watchtower-rebuild-baseline.json').read_text())
report={'status':'VERIFIED','method':'SHA-256 and full manifest-entry equality against the pre-rebuild snapshot','approvedAssets':{}}
for name,old in baseline['approved'].items():
    path=ROOT/'public/assets/dreamisland/heroes'/manifest['assets'][name]['file']
    sha=hashlib.sha256(path.read_bytes()).hexdigest()
    assert sha==old['sha256'],name
    assert manifest['assets'][name]==old['manifestEntry'],name
    report['approvedAssets'][name]={'sha256':sha,'glbUnchanged':True,'manifestEntryUnchanged':True}
report['headBefore']=baseline['head']
report['headAfter']=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
report['headUnchanged']=report['headBefore']==report['headAfter']
report['branch']=subprocess.check_output(['git','branch','--show-current'],cwd=ROOT,text=True).strip()
# Another implementer may commit in this shared tree. Record that observation;
# asset preservation is independent of the branch moving during our work.
report['headObservation']='unchanged' if report['headUnchanged'] else 'Shared branch advanced during the rebuild; this task issued no commit command.'
(OUT/'watchtower-preservation-check.json').write_text(json.dumps(report,indent=2)+'\n')
print('VERIFIED three approved GLBs and full manifest entries unchanged; current HEAD:',report['headAfter'],'; HEAD unchanged:',report['headUnchanged'])
