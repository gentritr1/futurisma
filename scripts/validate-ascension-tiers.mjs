import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {sourceModule} from './visual/ascension/modules.mjs';
import {simulateRivalField} from './lib/rival-field-sim.mjs';
import {applyPaceTier} from '../src/game/race-modes-rules.js';
const {AscensionCourse}=await import(await sourceModule('ascension-course.ts'));
const course=new AscensionCourse();course.gridStart=()=>null;
const pace=JSON.parse(readFileSync('src/game/data/ascension/rival-pace.json'));
const race=JSON.parse(readFileSync('art/evidence/ascension-v1/phase-a/calibration/works-trench.json'));
const playerSeconds=race.diagnostics.current.lapTimesMs.reduce((a,b)=>a+b,0)/1000;
const rows=[];
for(const tier of ['rookie','works','feral']){
 const results=[];
 for(const hz of [60,120,240]){
  const run=simulateRivalField({course,pace:applyPaceTier(pace,tier),totalLaps:3,renderDeltaSeconds:1/hz,contest:true});
  const finishes=run.states.map(s=>s.finishTimeSeconds);results.push(finishes);
  rows.push({tier,hz,finishes,playerPosition:1+finishes.filter(t=>t<playerSeconds).length});
 }
 assert.deepEqual(results[0],results[1]);assert.deepEqual(results[1],results[2]);
}
assert.equal(new Set(rows.map(r=>r.playerPosition)).size,3);
writeFileSync('art/evidence/ascension-v1/phase-a/tier-model.json',JSON.stringify({script:'scripts/validate-ascension-tiers.mjs',scope:'Production fleet integration at three render rates against measured player total; no live demo player, and no seed variation in the base fleet model. Three-seed browser acceptance remains separate.',playerSeconds,rows},null,2));console.log(JSON.stringify(rows));
