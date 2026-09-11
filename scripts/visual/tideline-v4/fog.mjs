import {mkdir,writeFile} from 'node:fs/promises';
import {launchReviewBrowser} from './browser.mjs';
const out='art/evidence/tideline-v4/fog-distance';await mkdir(out,{recursive:true});const records=[],errors=[];const browser=await launchReviewBrowser();
try{const page=await browser.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});for(const [index,kind] of ['cradle','surge','shield','strip','lane','bulkhead','gate','dome','launch-marker','current-marker'].entries()){
 await page.goto(`http://127.0.0.1:5215/tideline-fog-review.html?kind=${kind}`,{waitUntil:'networkidle0'});await page.waitForFunction(()=>window.fogReview,{timeout:30000});
 for(const distance of [45,100,180]){records.push(await page.evaluate(d=>window.fogReview.render(d),distance));await page.screenshot({path:`${out}/${index}-${distance}.png`,clip:{x:0,y:0,width:1280,height:720}});}}
 await writeFile(out+'/capture.json',JSON.stringify({script:'scripts/visual/tideline-v4/fog.mjs',mode:'Isolated comparison bay; actual gameplay meshes/materials and actual gantry, same fixed camera height, 20-degree lens and lighting at three distances. Framing includes the gantry right pillar and specimen; one actual lane module and first gate pair exclude unrelated route instances.',records,errors},null,2));if(errors.length)throw Error(errors.join('\n'));
}finally{await browser.close();}
