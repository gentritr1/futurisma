"""Record the painted base before the existing floor pinning script runs."""
import importlib.util,json,hashlib,argparse
from pathlib import Path
spec=importlib.util.spec_from_file_location('frame_metrics','scripts/visual/frame-metrics.py');metrics=importlib.util.module_from_spec(spec);spec.loader.exec_module(metrics)
parser=argparse.ArgumentParser();parser.add_argument('--root',default='art/evidence/ascension-v1/phase-b');args=parser.parse_args()
root=Path(args.root);capture=json.loads((root/'stations/capture.json').read_text());patches=capture['roadPatches'];rows=[]
for record in capture['records']:
 if record.get('board'):continue
 path=root/'stations'/record['file'];row=metrics.analyse(str(path),patches);row['sha256']=hashlib.sha256(path.read_bytes()).hexdigest();rows.append(row)
(root/'road-luma-base.json').write_text(json.dumps(rows,indent=2))
(root/'road-luma-base-provenance.json').write_text(json.dumps({'script':'scripts/visual/ascension/record-road-base.py','measurementScript':'scripts/visual/frame-metrics.py','captureScript':'scripts/visual/ascension/stations.mjs','samples':len(rows),'sampling':'One road patch at each discrete sector/schedule station; not a timed sample window.','patches':patches,'blockoutPreserved':'../phase-a/road-luma-base.json','paintedGeometrySha256':hashlib.sha256(Path('public/assets/ascension/painted.glb').read_bytes()).hexdigest()},indent=2))
print(json.dumps({'samples':len(rows),'minimumRoadLuma':min(r['lamp_luma_under'] for r in rows)}))
