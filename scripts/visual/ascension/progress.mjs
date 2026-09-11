import {readFileSync} from 'node:fs';
const files=process.argv.slice(2);
for(const file of files){const r=JSON.parse(readFileSync(file)),c=r.diagnostics.current;console.log(JSON.stringify({script:'scripts/visual/ascension/progress.mjs',file,seconds:c.lapTimesMs.reduce((a,b)=>a+b,0)/1000,laps:c.lapTimesMs,missedGates:c.missedGates,recoveries:c.recoveries,impacts:c.impacts,errors:r.errors,physicsSteps:c.physicsSteps,expectedPhysicsSteps:c.lapTimesMs.reduce((a,b)=>a+b,0)/1000*120,calls:c.calls,triangles:c.triangles}));}
