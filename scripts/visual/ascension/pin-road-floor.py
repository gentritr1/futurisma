"""Pin a per-sector art guard after recording its phase base, never before."""
import argparse,importlib.util,json,hashlib
from pathlib import Path
spec=importlib.util.spec_from_file_location('frame_metrics','scripts/visual/frame-metrics.py');metrics=importlib.util.module_from_spec(spec);spec.loader.exec_module(metrics)
parser=argparse.ArgumentParser();parser.add_argument('--phase',choices=['phase-a','phase-b'],default='phase-a');parser.add_argument('--root');args=parser.parse_args()
root=Path(args.root) if args.root else Path('art/evidence/ascension-v1')/args.phase
base=json.loads((root/'road-luma-base.json').read_text())
patches={'under':{'x':600,'y':500},'between':{'x':600,'y':530}}
references=[]
for name in ['B','C','F','H','J']:
 file=Path('art/evidence/tideline-v4/phases-round4')/(name+'.png')
 row=metrics.analyse(str(file),patches);row['sha256']=hashlib.sha256(file.read_bytes()).hexdigest();references.append(row)
minimum=min(row['lamp_luma_under'] for row in references)
floors=[]
for row in base:
 if not row['file'].startswith('base-'):continue
 floors.append({'sector':row['file'][5:-4],'baseLuma':row['lamp_luma_under'],'floor':max(minimum,.85*row['lamp_luma_under'])})
result={'script':'scripts/visual/ascension/pin-road-floor.py','measurementScript':'scripts/visual/frame-metrics.py','baseRecordedFirst':'road-luma-base.json','referencePatches':patches,'references':references,'darkestAcceptedTunnelPatch':minimum,'rule':'85% of each sector recorded phase base, allowing texture shading variation, but never below the darkest measured accepted Tideline tunnel road patch. These are art acceptance floors, not proof of finished-art compliance.','floors':floors}
(root/'road-luma-floor.json').write_text(json.dumps(result,indent=2));print(json.dumps({'referenceMinimum':minimum,'floors':floors}))
