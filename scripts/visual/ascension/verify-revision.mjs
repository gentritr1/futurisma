import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='art/evidence/ascension-v1/phase-b-revision';
const read=p=>JSON.parse(readFileSync(root+'/'+p));
const races=['fix-5/after','deluge','trench-reduced'].map(p=>read(p+'/race.json'));
for(const race of races){
 assert.equal(race.errors.length,0);
 for(const [file,hash] of Object.entries(race.inputHashes))assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'),hash,file);
 assert(Math.max(...race.frames.map(f=>f.mainCalls+f.shadowCalls))<=110);
 assert(Math.max(...race.frames.map(f=>f.mainTriangles))<=220000);
}
const reconciliation=read('reconciliation.json');assert(reconciliation.finalInputHashesMatch&&reconciliation.reducedMatchesTrench&&reconciliation.budgetPassed);
const stations=read('stations/capture.json'),tour=read('trench-tour/capture.json');assert.equal(stations.records.length,8*4+2);assert.equal(tour.records.length,10+3);assert.equal(stations.errors.length+tour.errors.length,0);
for(const board of stations.records.filter(r=>r.board))assert(Math.abs(board.boardDistance-150)<.000001);
const base=read('road-luma-base.json'),floors=read('road-luma-floor.json');assert.equal(base.length,8*4);assert.equal(floors.floors.length,8);
for(const frame of base){const sector=frame.file.slice(frame.file.indexOf('-')+1,-4);assert(frame.lamp_luma_under>=floors.floors.find(f=>f.sector===sector).floor);}
assert.equal(read('painted-corridor.json').hits.length,0);assert.equal(read('fix-5/after/branch-hud-live.json').ascension.sector,'TRENCH');assert.equal(read('deluge/branch-hud-live.json').ascension.sector,'DELUGE ROAD');
const result={script:'scripts/visual/ascension/verify-revision.mjs',acceptedAutomatedChecks:true,finalRaceHashesMatchCurrentInputs:true,fullRecordedDrawAndTriangleWindowsPass:true,stationSampling:{expected:8*4+2,observed:stations.records.length,kind:'Eight sectors × four schedule states plus two board views; discrete images, no Hz.'},trenchSampling:{expected:10+3,observed:tour.records.length,kind:'Ten even anchors plus three transition anchors; discrete images, no Hz.'},roadLumaSamples:{expected:8*4,observed:base.length,allAtOrAboveNewFloors:true},visualAcceptance:'Source-blind mangrove, focal quality and trench classification still pending. Automated checks do not approve Phase B.'};
writeFileSync(root+'/verification.json',JSON.stringify(result,null,2));console.log(result);
