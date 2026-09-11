import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const rows=[];
for(const seed of [3868938316,714,20260905])for(const tier of ['rookie','works','feral']){
 const args=['scripts/visual/ascension/race.mjs','--trench','--tier='+tier,'--seed='+seed];
 const code=await new Promise(resolve=>{const child=spawn(process.execPath,args,{stdio:'inherit'});child.once('exit',resolve);});
 rows.push({seed,tier,code});writeFileSync('art/evidence/ascension-v1/phase-a/matrix-status.json',JSON.stringify({script:'scripts/visual/ascension/matrix.mjs',rows},null,2));
 if(code!==0)throw Error('Race matrix stopped at failed run');
}
