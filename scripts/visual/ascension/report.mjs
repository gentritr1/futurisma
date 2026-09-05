import {readFileSync,writeFileSync,existsSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='art/evidence/ascension-v1/phase-a';
const rows=[];
for(const dir of readdirSync(root)){
 const file=root+'/'+dir+'/race.json';if(!existsSync(file))continue;
 const r=JSON.parse(readFileSync(file)),c=r.diagnostics.current;
 const windowSeconds=c.lapTimesMs.reduce((a,b)=>a+b,0)/1000;
 const metricsFile=root+'/'+dir+'/metrics.json',metrics=existsSync(metricsFile)?JSON.parse(readFileSync(metricsFile)):null;
 rows.push({file,url:r.url,seed:r.ascension.seed??null,tier:c.rivalTier,lapsMs:c.lapTimesMs,playerPosition:c.playerPosition,missedGates:c.missedGates,recoveries:c.recoveries,impacts:c.impacts,errors:r.errors,
  physics:{windowSeconds,expectedRateHz:120,expectedSamples:windowSeconds*120,observedSamples:c.physicsSteps,residual:c.physicsSteps-windowSeconds*120,rivalUpdates:c.rivalUpdateSteps,explanation:'Lap milliseconds are rounded in diagnostics; physics advances integer 120 Hz ticks.'},metrics});
}
const schedule=JSON.parse(readFileSync('src/game/data/ascension/schedule.json'));
const report={script:'scripts/visual/ascension/report.mjs',rows,schedule:{...schedule,events:schedule.events.map(e=>({...e,seconds:e.tick/120,multipleOfMeasuredL:e.tick/120/schedule.worksLapSeconds}))}};
writeFileSync(root+'/report.json',JSON.stringify(report,null,2));
function walk(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(dir+'/'+e.name):[dir+'/'+e.name]);}
const sourceFiles=['package.json',...walk('scripts/visual/ascension'),...walk('src/game/data/ascension'),...walk('public/assets/ascension'),'art/blender/build_ascension.py',...readdirSync('src/game').filter(f=>f.startsWith('ascension-')).map(f=>'src/game/'+f),...readdirSync('scripts').filter(f=>f.includes('ascension')&&f.endsWith('.mjs')).map(f=>'scripts/'+f)];
const files=[...walk('art/evidence/ascension-v1').filter(f=>!f.endsWith('/index.json')),...sourceFiles];
writeFileSync('art/evidence/ascension-v1/index.json',JSON.stringify({script:'scripts/visual/ascension/report.mjs',files:files.map(file=>({file,sha256:createHash('sha256').update(readFileSync(file)).digest('hex')}))},null,2));
console.log(JSON.stringify({races:rows.length,schedule:report.schedule.events}));
