import {spawnSync} from 'node:child_process';
import {openSync,closeSync,readFileSync,writeFileSync} from 'node:fs';
const base='art/evidence/dreamisland-v1/vs-design';
function run(program,args,log){
 const fd=log?openSync(`${base}/${log}`,'w'):null;
 const result=spawnSync(program,args,{stdio:fd===null?'inherit':['ignore',fd,fd]});if(fd!==null)closeSync(fd);
 if(result.status!==0)throw Error(`${program} ${args.join(' ')} exited ${result.status}`);
}
run(process.execPath,[`${base}/capture.mjs`,'--label=final','--sources','--masks']);
run('python3',[`${base}/proof.py`],'proof.log');
const rows=JSON.parse(readFileSync(`${base}/measurements.json`)),regions=JSON.parse(readFileSync(`${base}/water-road.json`));
const day=rows.find(r=>r.stage==='final'&&r.pose==='court'&&r.state==='day');
if(!(day.p01<=34&&day.lumaStd>=45&&day.chromaMean>=19&&day.whitePct<=.35))throw Error('G2 gate failed');
for(const pose of ['court','reef']){
 const night=rows.find(r=>r.stage==='final'&&r.pose===pose&&r.state==='night');
 if(night.p99<160)throw Error(`${pose} G1 range gate failed`);
 for(const r of regions.filter(r=>r.pose===pose&&r.state==='night')){
  if(r.kind==='road'&&(r.visible.p50<30.9||r.visible.p50>45))throw Error(`${pose} road median failed`);
  if(r.kind!=='road'&&r.sameFrameWaterWithGlow.maximum>239)throw Error(`${pose} composited water clips`);
 }
}
console.log('G1/G2 final pixel gates PASS');
run(process.execPath,[`${base}/soaks.mjs`]);
run('npm',['run','test:code'],'test-code.log');
writeFileSync(`${base}/verification.json`,JSON.stringify({pixelGates:'PASS',pixelGateScope:'G1 night p99, road median and same-frame composited-water clipping; G2 COURT day only',fourSoaksCompleted:true,testCodeExit:0,g3:'Separate measurement in ball.json; not asserted by this runner',strictSeaChromaFloor:'Separate measurement in extra-checks.json; not asserted by this runner'},null,2));
console.log('Four soaks and test:code complete');
