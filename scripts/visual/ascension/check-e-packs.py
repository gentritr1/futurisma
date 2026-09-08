"""Check artifact completeness without publishing or grading the withheld answers."""
from pathlib import Path
import json,hashlib,sys,subprocess
root=Path('art/evidence/ascension-v1/phase-e');results=[]
for folder,expected in [('phase-blind',10),('phase-pairs',6),('pasted-on',108),('rival-powers',18)]:
 p=root/folder;manifest=json.loads((p/'manifest.json').read_text());files=list(p.glob('view-*.png')) if folder!='phase-pairs' else list(p.glob('station-*.png'));assert len(files)==expected,(folder,len(files));assert len(manifest['keySha256'])==64
 results.append(dict(pack=folder,expectedFrames=expected,observedFrames=len(files),residual=len(files)-expected,answerKey='withheld'))
for folder in ['feature-bursts','live-feature-bursts']:
 p=root/folder;d=json.loads((p/'capture.json').read_text());rows=[]
 for case in sorted(p.glob('burst-*')):
  if not case.is_dir():continue
  frames=[r for r in d['records'] if r['file'].startswith(case.name+'/')];probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=nb_read_frames,r_frame_rate,duration','-of','json',str(case/'burst.mp4')],text=True))['streams'][0];assert int(probe['nb_read_frames'])==20
  endpoint=d.get('inclusiveEndpoint',d.get('endpointSamples',0));nominal=2*10+endpoint;rows.append(dict(case=case.name,windowSeconds=2,expectedHz=10,inclusiveEndpoint=endpoint,expected=nominal,observed=len(frames),residual=len(frames)-nominal,videoSeconds=float(probe['duration']),videoRateHz=10,videoExpectedFrames=20,videoObservedFrames=int(probe['nb_read_frames']),videoResidual=0,observedSampleSpanSeconds=frames[-1]['seconds']-frames[0]['seconds'],spanExpectedWithEndpoint=(frames[-1]['seconds']-frames[0]['seconds'])*10+1,spanSampleResidual=len(frames)-((frames[-1]['seconds']-frames[0]['seconds'])*10+1),wallSpanSeconds=(frames[-1]['wall']-frames[0]['wall'])/1000 if 'wall' in frames[0] else None,wallExpectedWithEndpoint=(frames[-1]['wall']-frames[0]['wall'])/1000*10+1 if 'wall' in frames[0] else None,wallSampleResidual=len(frames)-((frames[-1]['wall']-frames[0]['wall'])/1000*10+1) if 'wall' in frames[0] else None))
 assert len(rows)==8;results.append(dict(pack=folder,rows=rows))
focal=json.loads((root/'focal/manifest.json').read_text());assert focal['pairs']==13;results.append(dict(pack='focal',pairs=13,images=26,expected=13*2,observed=len(list((root/'focal').glob('*.png'))),classification='pending'))
sky=json.loads((root/'sky-turntable/luma-check.json').read_text());assert sky['pass'];results.append(dict(pack='sky-turntable',angularStepDegrees=15,expected=360/15,observed=sky['actualFrames'],residual=sky['actualFrames']-24))
if '--check-private' in sys.argv:
 private=Path('/Users/gentlegen/Desktop/futurisma-race/ascension-private-review-keys')
 for folder,key in [('phase-blind','phase-blind'),('phase-pairs','phase-pairs'),('pasted-on','pasted-on'),('focal','focal'),('feature-bursts','bursts'),('live-feature-bursts','live-bursts'),('rival-powers','rival-powers')]:
  metadata=root/folder/('capture.json' if 'bursts' in folder else 'manifest.json');expected=json.loads(metadata.read_text())['keySha256'];assert hashlib.sha256((private/f'{key}.json').read_bytes()).hexdigest()==expected
(root/'pack-check.json').write_text(json.dumps(dict(script='scripts/visual/ascension/check-e-packs.py',scope='Counts, video durations and private-key hash commitments only. Does not grade image classification.',results=results),indent=2));print('Phase E artifact counts and key commitments passed')
