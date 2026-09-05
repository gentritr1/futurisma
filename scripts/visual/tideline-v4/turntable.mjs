import {mkdir,writeFile} from 'node:fs/promises';
import {launchReviewBrowser} from './browser.mjs';
const base=process.argv[2]??'http://127.0.0.1:5215';
const out='art/evidence/tideline-v4/sky-turntable';await mkdir(out,{recursive:true});
const browser=await launchReviewBrowser();
try {
 const page=await browser.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto(`${base}/tideline-v4-review.html?lap=3&station=3`,{waitUntil:'networkidle0'});
 await page.waitForFunction(()=>window.tidelineReview,{timeout:30000});
 const state=await page.$eval('#review-state',e=>JSON.parse(e.textContent));
 for(let i=0;i<24;i++) {
  await page.evaluate(yaw=>window.tidelineReview.render(yaw,false),i*Math.PI/12);
  await page.screenshot({path:`${out}/view-${String(i).padStart(2,'0')}.png`,clip:{x:0,y:0,width:1280,height:720}});
  await page.evaluate(yaw=>window.tidelineReview.render(yaw,true),i*Math.PI/12);
  await page.screenshot({path:`${out}/sky-${String(i).padStart(2,'0')}.png`,clip:{x:0,y:0,width:1280,height:720}});
 }
 await writeFile(`${out}/capture.json`,JSON.stringify({script:'scripts/visual/tideline-v4/turntable.mjs',state,frames:24,yawStepDegrees:15,exposure:1.04,toneMapping:'AgX',errors},null,2));
 if(errors.length)throw Error(errors.join('\n'));console.log(JSON.stringify(state));
}finally{await browser.close();}
