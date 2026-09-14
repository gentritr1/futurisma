import {spawnSync} from 'node:child_process';
import {openSync,closeSync,writeFileSync} from 'node:fs';
const results=[];
for(const [label,tier,reduced] of [['rookie','rookie',false],['works','works',false],['feral','feral',false],['works-reduced','works',true]]){
 const out=`art/evidence/dreamisland-v1/vs-design/soak-${label}`;
 const log=openSync(`${out}.log`,'w');
 const args=['scripts/visual/dreamisland/race.mjs',`--tier=${tier}`,`--out=${out}`,...(reduced?['--reduced']:[])];
 const result=spawnSync(process.execPath,args,{stdio:['ignore',log,log]});closeSync(log);
 results.push({label,args,exitCode:result.status});console.log(label,result.status);
 writeFileSync('art/evidence/dreamisland-v1/vs-design/soak-runs.json',JSON.stringify(results,null,2));
 if(result.status!==0)process.exit(result.status??1);
}
