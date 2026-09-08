import {randomInt,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchReviewBrowser} from '../tideline-v4/browser.mjs';
const out='art/evidence/ascension-v1/phase-e/feature-bursts';await mkdir(out,{recursive:true});
const cases=[['cradle-pad',.04,false],['cradle-trench',.545,true],['cradle-causeway',.795,false],['cradle-tank',.91,false],['strip-pad',.075,false],['strip-causeway',.815,false],['bulkhead-trench',.575,true],['bulkhead-tank',.935,false]];
for(let i=cases.length-1;i>0;i--){const j=randomInt(i+1);[cases[i],cases[j]]=[cases[j],cases[i]];}
const privateKey=[];
const browser=await launchReviewBrowser(),records=[],errors=[];try{const page=await browser.newPage();page.on('pageerror',e=>errors.push(String(e)));
for(const [caseIndex,[id,target,trench]] of cases.entries()){const folder='burst-'+String(caseIndex+1).padStart(2,'0');privateKey.push({folder,id,target,trench});await mkdir(out+'/'+folder,{recursive:true});await page.goto(`http://127.0.0.1:5200/ascension-review.html?progress=${target}${trench?'&trench=1':''}`,{waitUntil:'networkidle0'});await page.waitForFunction(()=>!!window.__ascReview);
 for(let i=0;i<=20;i++){
  const row=await page.evaluate(({target,trench,i})=>{const {course,camera,renderer,scene,environment,runtime}=window.__ascReview;const seconds=i/10,speed=300/3.6,distance=180-seconds*speed;
   // The branch parameter spans its own measured metres, not the surface route length.
   const branchLength=course.sampleShortcut?Math.abs(course.shortcut.to-course.shortcut.from):0;
   const progress=trench?target-distance/course.shortcut.length*branchLength:((target-distance/course.length)%1+1)%1;
   const s=trench?course.sampleShortcut(progress):course.sample(progress),goal=trench?course.sampleShortcut(target):course.sample(target);
   camera.position.copy(s.position).addScaledVector(s.tangent,-11.5).addScaledVector(s.up,5.76);camera.lookAt(s.position.clone().addScaledVector(s.tangent,19).addScaledVector(s.up,2.11));
   course.project(s.position,progress);runtime.updateHud(progress);environment.updateVisibility(camera);const fog=course.fogAt(progress);scene.fog.color.copy(fog.color);scene.fog.density=fog.density;renderer.render(scene,camera);
   return {seconds,speedKph:300,nominalAlongRoadDistanceMetres:distance,worldCameraToObjectMetres:camera.position.distanceTo(goal.position),progress,camera:camera.position.toArray()};
  },{target,trench,i});const file=folder+'/'+String(i).padStart(3,'0')+'.png';await page.screenshot({path:out+'/'+file});records.push({file,...row});
 }
}
const secret=JSON.stringify(privateKey,null,2);await writeFile('/Users/gentlegen/Desktop/futurisma-race/ascension-private-review-keys/bursts.json',secret);
await writeFile(out+'/capture.json',JSON.stringify({script:'scripts/visual/ascension/feature-bursts.mjs',keySha256:createHash('sha256').update(secret).digest('hex'),scope:'Constant 300 km/h camera traverse through the production route, materials and chase-camera offsets. This isolates visual recognition; it is not a controller race, pickup activation or performance benchmark. No current lane exists on Ascension.',windowSeconds:2,rateHz:10,inclusiveEndpoint:1,perBurstExpected:21,bursts:cases.length,expected:cases.length*21,observed:records.length,residual:records.length-cases.length*21,records,errors},null,2));if(errors.length)throw Error(errors.join());
}finally{await browser.close();}
