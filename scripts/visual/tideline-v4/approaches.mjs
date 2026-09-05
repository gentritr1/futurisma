import {mkdir,writeFile,copyFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {launchReviewBrowser} from './browser.mjs';
import route from '../../../src/game/data/tideline/route.json' with {type:'json'};
const out='art/evidence/tideline-v4/approaches';await mkdir(out,{recursive:true});const browser=await launchReviewBrowser(),errors=[],records=[];
const samples=[{id:'A',kind:'strip',target:.449,lap:3},{id:'B',kind:'cradle',target:.42,lap:3},{id:'C',kind:'bulkhead',target:.53,lap:3},{id:'D',kind:'lane',target:.025,lap:1}];
try{const page=await browser.newPage();page.on('pageerror',e=>errors.push(String(e)));for(const sample of samples){const temp='/tmp/tideline-v4-approach-'+sample.id;await mkdir(temp,{recursive:true});await page.goto(`http://127.0.0.1:5215/tideline-v4-review.html?lap=${sample.lap}&progress=${sample.target}`,{waitUntil:'networkidle0'});await page.waitForFunction(()=>window.tidelineApproach);const frames=[];
 for(let frame=0;frame<48;frame++){const seconds=frame/24,ahead=180-(300/3.6)*seconds,progress=(sample.target-ahead/route.length+1)%1;const state=await page.evaluate(({progress,seconds,target,kind})=>{
 const state=window.tidelineApproach.renderAt(progress,8+seconds),review=window.tidelineReview,sample=review.course.sample(target);
 const point=sample.position.clone().addScaledVector(sample.up,kind==='cradle'?4.5:kind==='bulkhead'?1.85:.12).addScaledVector(sample.right,kind==='lane'?4:kind==='bulkhead'?-3:0);
 const projected=point.clone().project(review.camera);
 return {...state,cameraDistance:point.distanceTo(review.camera.position),targetPixel:{x:Math.round((projected.x*.5+.5)*1280),y:Math.round((-.5*projected.y+.5)*720)}};
 },{progress,seconds,target:sample.target,kind:sample.kind});frames.push({...state,routeDistanceAhead:ahead});await page.screenshot({path:`${temp}/${String(frame).padStart(3,'0')}.png`,clip:{x:0,y:0,width:1280,height:720}});}
 await copyFile(temp+'/016.png',`${out}/${sample.id}.png`);execFileSync('/opt/homebrew/bin/ffmpeg',['-y','-framerate','24','-i',temp+'/%03d.png','-c:v','libx264','-crf','18','-pix_fmt','yuv420p',`${out}/${sample.id}.mp4`],{stdio:'ignore'});
 records.push({...sample,posterFrame:16,posterRouteDistance:frames[16].routeDistanceAhead,posterCameraDistance:frames[16].cameraDistance,targetPixel:frames[16].targetPixel,frames});}
 await writeFile(out+'/capture.json',JSON.stringify({script:'scripts/visual/tideline-v4/approaches.mjs',method:'Real map and hardware; fixed camera rail, 300 km/h, 48 frames at 24 Hz, 2-second encoded burst. No physics or gameplay overrides.',records,errors},null,2));if(errors.length)throw Error(errors.join('\n'));
}finally{await browser.close();}
