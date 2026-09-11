import {mkdir,writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {launchReviewBrowser} from '../tideline-v4/browser.mjs';
const out='art/evidence/ascension-v1/phase-c-revision/carry-overs/fixtures';await mkdir(out,{recursive:true});
const c=JSON.parse(readFileSync('src/game/data/ascension/schedule.json'));
const items=[['cradle-pad','progress=.035'],['cradle-trench','progress=.54&trench=1'],['bulkhead-trench','progress=.57&trench=1'],['bulkhead-tank','progress=.93'],['egrets-rest','progress=.70'],['egrets-scatter','progress=.70&tick='+(c.launchTick+360)]];
const browser=await launchReviewBrowser(),records=[],errors=[];
try{const page=await browser.newPage();page.on('pageerror',e=>errors.push(String(e)));for(const [name,query] of items){await page.goto('http://127.0.0.1:5200/ascension-review.html?'+query,{waitUntil:'networkidle0'});await page.waitForSelector('#review-state');await page.screenshot({path:out+'/'+name+'.png'});records.push({file:name+'.png',...await page.$eval('#review-state',e=>JSON.parse(e.textContent))});}await writeFile(out+'/capture.json',JSON.stringify({script:'scripts/visual/ascension/carry-stations.mjs',scope:'Discrete inspection fixtures. Crawler uses a low roadside camera, not the racing camera. Bird lap motion is additionally recorded in the live race.',records,errors},null,2));if(errors.length)throw Error(errors.join('\n'));}finally{await browser.close();}
