import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {sourceModule} from './visual/ascension/modules.mjs';
const {AscensionAudio}=await import(await sourceModule('ascension-audio.ts'));
const config=JSON.parse(readFileSync('src/game/data/ascension/schedule.json'));
const results=[];
for(const distance of [343,686]){
 let tick=0;const graph={play:()=>tick/120,duck:()=>{},dispose:()=>{}},controller=new AscensionAudio({ascensionSound:graph,enableAscension:async()=>{}});
 const course={schedule:{config,tick:0},group:{userData:{eventState:{pad:[0,0,0]}}},trenchOccupied:false},camera={position:{x:distance,y:0,z:0}};
 const end=config.launchTick+5*120;
 for(tick=0;tick<=end;tick++){course.schedule.tick=tick;controller.update(course,camera);}
 const launch=controller.records.filter(r=>r.cue==='launch');assert.equal(launch.length,1);assert.equal(launch[0].delaySeconds,distance/343);assert.equal(launch[0].residualSeconds,0);
 assert.deepEqual(controller.duckEvents,[{tick:config.launchTick,scale:.25},{tick:config.launchTick+480,scale:1}]);
 for(const e of config.events.filter(e=>e.id.startsWith('crawler-cross'))){const k=controller.records.find(r=>r.id===e.id.replace('cross','klaxon'));assert.equal(e.tick-k.tick,360);}
 results.push({distance,launch:launch[0],duckTicks:480,duckSeconds:480/120,windowSeconds:end/120,rateHz:120,expectedSamples:end+1,observedSamples:end+1,residual:0});
 controller.dispose();
}
const result={script:'scripts/validate-ascension-audio.mjs',scope:'Pure cue decisions with a fake audio graph. This validates schedule/distance logic, not audible output. The separate live audio capture tests the real graph.',results};writeFileSync('art/evidence/ascension-v1/phase-d/logic-validation.json',JSON.stringify(result,null,2));console.log(result);
