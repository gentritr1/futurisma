import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {randomInt,createHash} from 'node:crypto';
import {launchReviewBrowser} from '../tideline-v4/browser.mjs';
import {instrument} from './instrument.mjs';
const root='art/evidence/ascension-v1/phase-e/live-feature-bursts';await mkdir(root,{recursive:true});
const route=JSON.parse(await readFile('src/game/data/ascension/route.json'));
const cases=[['cradle-pad',.04,false],['cradle-trench',.545,true],['cradle-causeway',.795,false],['cradle-tank',.91,false],['strip-pad',.075,false],['strip-causeway',.815,false],['bulkhead-trench',.575,true],['bulkhead-tank',.935,false]];
for(let i=cases.length-1;i>0;i--){const j=randomInt(i+1);[cases[i],cases[j]]=[cases[j],cases[i]];}
const targets=cases.map(([id,progress,trench],i)=>{const points=trench?route.shortcut.stations:route.stations;const nearest=points.reduce((best,s)=>Math.abs((trench?s.progress:s.d/route.length)-progress)<Math.abs((trench?best.progress:best.d/route.length)-progress)?s:best);return {id,progress,trench,folder:'burst-'+String(i+1).padStart(2,'0'),point:nearest.p};});
const browser=await launchReviewBrowser(),records=[],errors=[],writes=[];try{for(const branch of [false,true]){
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(String(e)));await instrument(page);
 for(const t of targets.filter(t=>t.trench===branch))await mkdir(root+'/'+t.folder,{recursive:true});
 await page.exposeFunction('saveFeature',(row)=>{const {image,...data}=row;records.push(data);writes.push(writeFile(root+'/'+data.file,Buffer.from(image.split(',')[1],'base64')));});
 await page.evaluateOnNewDocument(({targets,branch,length,shortcut})=>{
  const selected=targets.filter(t=>t.trench===branch).map(t=>({...t,start:null,next:0,count:0,done:false}));window.__featuresDone=false;
  window.__ascCaptureFrame=(renderer,args)=>{
   let d,c;try{d=JSON.parse(document.getElementById('ascension-diagnostics').textContent);c=JSON.parse(document.getElementById('futurisma-diagnostics').textContent).current;}catch{return;}
   if(c.phase!=='running')return;
   for(const t of selected){if(t.done)continue;const ahead=((t.progress-d.progress)%1+1)%1*(branch?shortcut.length/(shortcut.to-shortcut.from):length);
    const lap=c.lapTimesMs.length;const lapReady=lap===1||(t.id==='cradle-pad'&&lap===0&&d.progress>.95&&d.tick>d.schedule.worksLapSeconds*120*.8);
    if(t.start===null&&lapReady&&d.trenchOccupied===branch&&ahead<=190){t.start=d.tick;t.next=d.tick;}
    if(t.start===null||d.tick<t.next)continue;
    if(d.tick>=t.start+240){t.done=true;continue;}
    t.next=t.start+(Math.floor((d.tick-t.start)/12)+1)*12;
    const p=t.point,cam=args[1].position;window.saveFeature({folder:t.folder,file:t.folder+'/'+String(t.count++).padStart(3,'0')+'.png',tick:d.tick,seconds:(d.tick-t.start)/120,wall:performance.now(),speedKph:c.speedKph,worldCameraToObjectMetres:Math.hypot(cam.x-p[0],cam.y-p[1],cam.z-p[2]),image:renderer.domElement.toDataURL('image/png')});
   }
   window.__featuresDone=selected.every(t=>t.done);
  };
 },{targets,branch,length:route.length,shortcut:route.shortcut});
 await page.goto(`http://127.0.0.1:5200/?map=ascension&seed=3868938316&tier=works&demo=1&demoTrench=${branch?1:0}&headless=1&diagnostics=1&start=manual&quality=high&music=0`,{waitUntil:'networkidle0'});await page.click('#start-button');await page.waitForFunction(()=>window.__featuresDone,{timeout:180000});await Promise.all(writes);await page.close();
 }
const secret=JSON.stringify(targets,null,2);await writeFile('/Users/gentlegen/Desktop/futurisma-race/ascension-private-review-keys/live-bursts.json',secret);
await writeFile(root+'/capture.json',JSON.stringify({script:'scripts/visual/ascension/live-feature-bursts.mjs',scope:'Unmodified live Works demos on both branches, normal chase camera. Sampled at 10 Hz on the 120 Hz schedule clock; actual speed is recorded, not forced to 300 km/h. This supplements the exact-speed camera recognition fixture. Capture overhead means these are not performance benchmarks.',windowSeconds:2,expectedRateHz:10,endpointSamples:0,samplingWindow:'[0,2) seconds',keySha256:createHash('sha256').update(secret).digest('hex'),records,errors},null,2));if(errors.length)throw Error(errors.join());
}finally{await browser.close();}
