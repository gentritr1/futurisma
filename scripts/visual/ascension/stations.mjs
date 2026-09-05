import {readFileSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchReviewBrowser} from '../tideline-v4/browser.mjs';
const route=JSON.parse(readFileSync('src/game/data/ascension/route.json')),schedule=JSON.parse(readFileSync('src/game/data/ascension/schedule.json'));
const out='art/evidence/ascension-v1/phase-a/stations';await mkdir(out,{recursive:true});
const boardsOnly=process.argv.includes('--boards-only');
const browser=await launchReviewBrowser(),records=boardsOnly?JSON.parse(readFileSync(out+'/capture.json')).records.filter(r=>!r.board):[],errors=[];
try{
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(String(e)));
 const phases=[['base',0],['test',schedule.testTick+120],['launch',schedule.launchTick+120],['reopened',schedule.reopenTick+120]];
 const stations=route.districts.map((d,i)=>({id:d.id,progress:(d.from+(route.districts[i+1]?.from??1))/2}));stations.push({id:'TRENCH',progress:(route.shortcut.from+route.shortcut.to)/2,trench:true});
 if(!boardsOnly)for(const [phase,tick] of phases)for(const station of stations){
  const url=`http://127.0.0.1:5200/ascension-review.html?progress=${station.progress}&tick=${tick}${station.trench?'&trench=1':''}`;
  await page.goto(url,{waitUntil:'networkidle0'});await page.waitForSelector('#review-state');
  const file=`${phase}-${station.id}.png`;await page.screenshot({path:out+'/'+file});records.push({file,...await page.$eval('#review-state',e=>JSON.parse(e.textContent))});
 }
 for(const board of [1,2]){await page.goto(`http://127.0.0.1:5200/ascension-review.html?board=${board}`,{waitUntil:'networkidle0'});await page.waitForSelector('#review-state');const file=`board-${board}-150m.png`;await page.screenshot({path:out+'/'+file});records.push({file,...await page.$eval('#review-state',e=>JSON.parse(e.textContent))});}
 await writeFile(out+'/capture.json',JSON.stringify({script:'scripts/visual/ascension/stations.mjs',records,errors,roadPatches:{under:{x:640,y:430},between:{x:640,y:455}}},null,2));if(errors.length)throw Error(errors.join('\n'));
}finally{await browser.close();}
