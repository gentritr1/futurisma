import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
const root='art/evidence/ascension-v1/phase-a';
const read=path=>JSON.parse(readFileSync(root+'/'+path));
const normal=read('trench/race.json'),reduced=read('trench-reduced/race.json'),deluge=read('deluge/race.json');
const current=r=>r.diagnostics.current;
for(const race of [normal,reduced,deluge]){assert.equal(current(race).lapTimesMs.length,3);assert.equal(current(race).missedGates,0);assert.equal(current(race).recoveries,0);assert.deepEqual(race.errors,[]);}
assert.deepEqual(current(normal).lapTimesMs,current(reduced).lapTimesMs);
assert.deepEqual(normal.ascension.events,reduced.ascension.events);
const savings=current(deluge).lapTimesMs.map((ms,i)=>(ms-current(normal).lapTimesMs[i])/1000),meanSavings=savings.reduce((a,b)=>a+b,0)/3;
assert.ok(meanSavings>=3&&meanSavings<=6,`Fork saves ${meanSavings}s`);
const unbatched=read('trench-reduced-unbatched/race.json');
assert.deepEqual(unbatched.inputHashes,reduced.inputHashes);assert.deepEqual(current(unbatched).lapTimesMs,current(reduced).lapTimesMs);
const before=read('trench-reduced-unbatched/metrics.json'),after=read('trench-reduced/metrics.json');
assert.ok(after.peakTotalCalls*2<=145);assert.ok((after.peakTriangles+after.peakShadowTriangles)*2<=220000);
const frames=read('stations/capture.json');assert.deepEqual(frames.errors,[]);assert.equal(frames.records.length,34);assert.ok(frames.records.filter(r=>r.board).every(r=>r.boardDistance>=150));
const reconciliation=m=>({windowSeconds:m.windowMs/1000,expectedRateHz:m.expectedRateHz,expectedSamples:m.expectedSamples,observedSamples:m.windowSamples,residual:m.windowSamples-m.expectedSamples,observedRateHz:m.observedRateHz});
const report={script:'scripts/validate-ascension-evidence.mjs',fork:{measurementScript:'scripts/visual/ascension/race.mjs',lapSavingsSeconds:savings,meanSavingsSeconds:meanSavings,scope:'Full Works demos, schedule enabled, both route choices. Traffic and nitro included.'},reduced:{matchingLapTimes:true,matchingScheduleEvents:true,scope:'Phase A camera/clock. Launch and steam cards do not exist yet.'},budget:{measurementScript:'scripts/visual/ascension/instrument.mjs',scope:'Same final blockout, reduced-motion query, environment batching off/on. Glass shadow exclusion and road batching unchanged in both.',before,after,reconciliation:{before:reconciliation(before),after:reconciliation(after)},twoTimesHeadroom:true},boards:frames.records.filter(r=>r.board).map(r=>({file:r.file,distanceMetres:r.boardDistance}))};
writeFileSync(root+'/acceptance.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
