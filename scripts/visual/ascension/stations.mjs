import {readFileSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchReviewBrowser} from '../tideline-v4/browser.mjs';
const route=JSON.parse(readFileSync('src/game/data/ascension/route.json')),schedule=JSON.parse(readFileSync('src/game/data/ascension/schedule.json'));
const requestedOut=process.argv.find(a=>a.startsWith('--out='))?.slice(6);
const out=requestedOut??'art/evidence/ascension-v1/'+(process.argv.includes('--phase-b')?'phase-b':'phase-a')+(process.argv.includes('--trench-tour')?'/trench-tour':'/stations');await mkdir(out,{recursive:true});
const selected=process.argv.find(a=>a.startsWith('--sectors='))?.slice(10).split(',');
const boardsOnly=process.argv.includes('--boards-only');
const browser=await launchReviewBrowser(),records=boardsOnly?JSON.parse(readFileSync(out+'/capture.json')).records.filter(r=>!r.board):[],errors=[];
try{
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(String(e)));
 const phases=process.argv.includes('--trench-tour')?[['base',0]]:[['base',0],['test',schedule.testTick+120],['launch',schedule.launchTick+120],['reopened',schedule.reopenTick+120]];
 const stations=route.districts.map((d,i)=>({id:d.id,progress:(d.from+(route.districts[i+1]?.from??1))/2}));stations.push({id:'TRENCH',progress:(route.shortcut.from+route.shortcut.to)/2,trench:true});
 if(process.argv.includes('--trench-tour')){stations.length=0;for(let i=0;i<10;i++)stations.push({id:'TRENCH_'+String(i).padStart(2,'0'),progress:route.shortcut.from+(route.shortcut.to-route.shortcut.from)*(i+.5)/10,trench:true});const zones=JSON.parse(readFileSync('public/assets/ascension/trench-zones.json'));for(const [i,transition] of zones.transitions.entries())stations.push({id:'TRANSITION_'+i,progress:transition.progress,trench:true,transition:true});}
 if(selected){for(let i=stations.length-1;i>=0;i--)if(!selected.includes(stations[i].id))stations.splice(i,1);}
 if(!boardsOnly)for(const [phase,tick] of phases)for(const station of stations){
  const url=`http://127.0.0.1:5200/ascension-review.html?progress=${station.progress}&tick=${tick}${station.trench?'&trench=1':''}${station.transition?'&transition=1':''}`;
  await page.goto(url,{waitUntil:'networkidle0'});await page.waitForSelector('#review-state');
  const file=`${phase}-${station.id}.png`;await page.screenshot({path:out+'/'+file});records.push({file,...await page.$eval('#review-state',e=>JSON.parse(e.textContent))});
 }
 for(const board of (process.argv.includes('--trench-tour')?[]:[1,2])){await page.goto(`http://127.0.0.1:5200/ascension-review.html?board=${board}`,{waitUntil:'networkidle0'});await page.waitForSelector('#review-state');const file=`board-${board}-150m.png`;await page.screenshot({path:out+'/'+file});records.push({file,...await page.$eval('#review-state',e=>JSON.parse(e.textContent))});}
 await writeFile(out+'/capture.json',JSON.stringify({script:'scripts/visual/ascension/stations.mjs',records,errors,roadPatches:{under:{x:640,y:430},between:{x:640,y:455}}},null,2));if(errors.length)throw Error(errors.join('\n'));
}finally{await browser.close();}
