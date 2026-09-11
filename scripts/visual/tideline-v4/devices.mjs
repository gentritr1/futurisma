import {launchReviewBrowser} from './browser.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
const folder='art/evidence/tideline-v4/devices';await mkdir(folder,{recursive:true});
const browser=await launchReviewBrowser();
try{const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});await page.setViewport({width:768,height:1024,deviceScaleFactor:1});
 await page.goto('http://127.0.0.1:5215/power-kit-v2-review.html',{waitUntil:'networkidle0'});await page.waitForFunction(()=>window.powerReview);
 for(const kind of ['surge','shield'])for(const activation of [0,1]){await page.evaluate((k,a)=>window.powerReview.render(k,a),kind,activation);await page.screenshot({path:`${folder}/${kind}-${activation?'active':'idle'}.png`});}
 const state=await page.evaluate(()=>({camera:window.powerReview.camera,model:window.powerReview.model,materials:window.powerReview.materials}));await writeFile(folder+'/capture.json',JSON.stringify({script:'scripts/visual/tideline-v4/devices.mjs',...state,errors},null,2));console.log(JSON.stringify({errors}));if(errors.length)throw Error('Device render failed');
}finally{await browser.close();}
