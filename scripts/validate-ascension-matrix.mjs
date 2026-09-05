import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
const root='art/evidence/ascension-v1/phase-a',rows=[];
for(const seed of [3868938316,714,20260905])for(const [tier,position] of [['rookie',1],['works',2],['feral',4]]){
 const directory='trench'+(tier!=='works'||seed!==3868938316?'-'+tier+'-'+seed:'');
 const file=root+'/'+directory+'/race.json',race=JSON.parse(readFileSync(file)),c=race.diagnostics.current;
 assert.equal(race.ascension.seed,seed);assert.equal(c.playerPosition,position);
 assert.equal(c.lapTimesMs.length,3);assert.equal(c.missedGates,0);assert.equal(c.recoveries,0);assert.deepEqual(race.errors,[]);
 const windowSeconds=c.lapTimesMs.reduce((a,b)=>a+b,0)/1000,expectedSamples=windowSeconds*120;
 assert.ok(Math.abs(c.physicsSteps-expectedSamples)<=.18,'Three rounded lap milliseconds allow at most 0.18 ticks of rounding');
 rows.push({file,seed,tier,position,lapsMs:c.lapTimesMs,physics:{windowSeconds,expectedRateHz:120,expectedSamples,observedSamples:c.physicsSteps,residual:c.physicsSteps-expectedSamples}});
}
const report={script:'scripts/validate-ascension-matrix.mjs',rows,scope:'Nine complete private-browser races. Material-ID colour correction after this matrix does not alter route or physics; each raw capture records its input hashes.'};
writeFileSync(root+'/matrix-validation.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
