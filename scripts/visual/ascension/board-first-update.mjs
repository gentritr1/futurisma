import {readFileSync,writeFileSync} from 'node:fs';
import {launchReviewBrowser} from '../tideline-v4/browser.mjs';
const schedule=JSON.parse(readFileSync('src/game/data/ascension/schedule.json'));
const browser=await launchReviewBrowser();
try{
 const page=await browser.newPage();await page.setRequestInterception(true);
 page.on('request',async request=>{
  if(new URL(request.url()).pathname.startsWith('/src/game/ascension-runtime')){
   const response=await fetch(request.url());let code=await response.text();
   if(!code.includes('lastSecond = undefined'))throw Error('Missing regression injection marker');
   code=code.replace('lastSecond = undefined','lastSecond = -1');await request.respond({status:200,contentType:'text/javascript',body:code});
  }else await request.continue();
 });
 await page.goto('http://127.0.0.1:5200/ascension-review.html?board=1&tick='+(schedule.launchTick+120),{waitUntil:'networkidle0'});await page.waitForSelector('#review-state');
 const result=await page.$eval('#review-state',e=>JSON.parse(e.textContent).boardLegibility);
 const report={script:'scripts/visual/ascension/board-first-update.mjs',scope:'Negative control: restore the old -1 cache sentinel in the served module only. Production source is unchanged.',expectedPass:false,observed:result};
 writeFileSync('art/evidence/ascension-v1/phase-c-revision/stations/negative-control.json',JSON.stringify(report,null,2));
 if(result.pass)throw Error('Black first-frame board incorrectly passed');console.log(report);
}finally{await browser.close();}
