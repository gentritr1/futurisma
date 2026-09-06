"""Summarise executed Phase C checks without promoting image inference to acceptance."""
import json,hashlib
from pathlib import Path
root=Path('art/evidence/ascension-v1/phase-c');before=root.parent/'phase-b-revision'
def read(path):return json.loads(path.read_text())
runs=[];hashes=[]
for name in ['trench','deluge','trench-reduced']:
 race=read(root/name/'race.json');m=read(root/name/'metrics.json');hashes.append(race['inputHashes']);frames=race['frames'];effects=[f['effects'] for f in frames if f.get('effects')]
 windows=[{'kind':'all recorded render intervals','observed':len(frames),'windowSeconds':sum(f['delta'] for f in frames)/1000,'expectedRateHz':m['expectedRateHz']},{'kind':'calibration','observed':m['calibration']['samples'],'windowSeconds':m['calibration']['windowMs']/1000,'expectedRateHz':m['calibration']['hz']},{'kind':'active rendering','observed':m['samples'],'windowSeconds':m['activeWindowMs']/1000,'expectedRateHz':m['expectedRateHz']},{'kind':'p95 tail','observed':m['windowSamples'],'windowSeconds':m['windowMs']/1000,'expectedRateHz':m['expectedRateHz']}]
 for w in windows:w['expected']=w['windowSeconds']*w['expectedRateHz'];w['residual']=w['observed']-w['expected']
 walk=read(root/name/'material-walk.json');current=race['diagnostics']['current']
 baseline=read(before/('fix-5/after' if name=='trench' else name)/'race.json')['diagnostics']['current']
 assert current['lapTimesMs']==baseline['lapTimesMs'] and current['finalClassification']==baseline['finalClassification']
 runs.append({'name':name,'script':'scripts/visual/ascension/race.mjs','measurementScript':m['script'],'lapTimesMs':current['lapTimesMs'],'finalClassification':current['finalClassification'],'sameClassificationAndLapsAsB':True,'impacts':current['impacts'],'missedGates':current['missedGates'],'recoveries':current['recoveries'],'errors':race['errors'],'peakAllRecordedDraws':max(f['mainCalls']+f['shadowCalls'] for f in frames),'peakAllRecordedMainTriangles':max(f['mainTriangles'] for f in frames),'peakTotalDraws':m['peakTotalCalls'],'peakMainDraws':m['peakMainCalls'],'peakShadowDraws':m['peakShadowCalls'],'peakMainTriangles':m['peakTriangles'],'peakShadowTriangles':m['peakShadowTriangles'],'p95Ms':m['p95Ms'],'windows':windows,'materialViolations':walk['violations'],'publishedEffectFlags':{'steam':any(e['steamVisible'] for e in effects),'launch':any(e['rocketVisible'] and e['rocketHeight']>0 for e in effects),'persistentSmoke':any(e['smokeVisible'] and not e['rocketVisible'] for e in effects),'lampFlicker':any(e['lampScale']<1 for e in effects)},'flagScope':'Event state published through the HUD; may trail the rendered state by one frame. Flags are not frame-accurate image proof.'})
 assert not race['errors'] and current['missedGates']==0 and current['recoveries']==0 and not walk['violations']
 assert max(f['mainCalls']+f['shadowCalls'] for f in frames)<=145 and max(f['mainTriangles'] for f in frames)<=220000
assert all(h==hashes[0] for h in hashes)
assert all(hashlib.sha256(Path(p).read_bytes()).hexdigest()==h for p,h in hashes[0].items())
assert runs[0]['lapTimesMs']==runs[2]['lapTimesMs']
assert not runs[2]['publishedEffectFlags']['lampFlicker']
floors={r['sector']:r for r in read(root/'road-luma-floor.json')['floors']};luma=[]
for row in read(root/'road-luma-base.json'):
 phase,sector=row['file'].split('-',1);sector=sector[:-4];floor=floors[sector]['floor'];luma.append({'file':row['file'],'luma':row['lamp_luma_under'],'floor':floor,'passes':row['lamp_luma_under']>=floor})
assert all(r['passes'] for r in luma)
base=read(before/'fix-5/after/metrics.json')
report={'script':'scripts/visual/ascension/report-phase-c.py','runs':runs,'sameInputsAndCurrentFiles':True,'budgetBefore':{'totalDraws':base['peakTotalCalls'],'mainTriangles':base['peakTriangles'],'source':'art/evidence/ascension-v1/phase-b-revision/fix-5/after/metrics.json','measurementScript':'scripts/visual/ascension/instrument.mjs'},'luma':{'script':'scripts/visual/frame-metrics.py','baseScript':'scripts/visual/ascension/record-road-base.py','pinScript':'scripts/visual/ascension/pin-road-floor.py','sampling':'32 discrete sector/schedule image patches, not a timed window. New scorched paint base is retained alongside the previous B and blockout baselines.','rows':luma},'clearance':read(root/'event-clearance.json'),'forkMeasurement':read(root/'driving.json'),'acceptance':'Trench blind classification is pending. These measurements do not assert phase or whole-level visual acceptance.'}
(root/'executed-results.json').write_text(json.dumps(report,indent=2))
print(json.dumps({'runs':[{'name':r['name'],'totalDraws':r['peakTotalDraws'],'triangles':r['peakMainTriangles'],'p95Ms':r['p95Ms']} for r in runs],'sameInputs':True,'lumaPasses':len(luma)}))
