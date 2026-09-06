import {mkdir,writeFile} from 'node:fs/promises';
import {launchReviewBrowser} from '../tideline-v4/browser.mjs';
const out='art/evidence/ascension-v1/phase-b/sky-turntable';await mkdir(out,{recursive:true});
const browser=await launchReviewBrowser(),records=[],errors=[];
try{const page=await browser.newPage();page.on('pageerror',e=>errors.push(String(e)));
for(let i=0;i<24;i++){const yaw=i*360/24;await page.goto('http://127.0.0.1:5200/ascension-review.html?progress=.74&yaw='+yaw,{waitUntil:'networkidle0'});await page.waitForSelector('#review-state');const file=String(i).padStart(2,'0')+'.png';await page.screenshot({path:out+'/'+file});records.push({file,yaw,...await page.$eval('#review-state',e=>JSON.parse(e.textContent))});await page.goto('http://127.0.0.1:5200/ascension-review.html?progress=.74&yaw='+yaw+'&skyMask=1',{waitUntil:'networkidle0'});await page.waitForSelector('#review-state');await page.screenshot({path:out+'/mask-'+file});}
await writeFile(out+'/capture.json',JSON.stringify({script:'scripts/visual/ascension/sky-turntable.mjs',sampling:'24 discrete azimuth stations, one frame per 15 degrees; not a timed frame-rate sample.',records,errors},null,2));if(errors.length)throw Error(errors.join('\n'));
}finally{await browser.close();}
