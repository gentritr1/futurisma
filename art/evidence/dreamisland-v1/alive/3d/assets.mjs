import {mkdir,writeFile} from 'node:fs/promises';
import {launchReviewBrowser} from '../../../../../scripts/visual/tideline-v4/browser.mjs';
const out='art/evidence/dreamisland-v1/alive/3d/assets';await mkdir(out,{recursive:true});
const browser=await launchReviewBrowser(),rows=[],errors=[];
try{
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 for(const kind of ['PR_ball','PR_ring','PR_sphere','PR_pipes','PR_bollard','PR_plinth','capsule']){
  for(const night of [0,1])for(const distance of [8,40]){
   const name=`${kind}-${night?'night':'day'}-${distance}m`;
   await page.goto(`http://127.0.0.1:5202/art/evidence/dreamisland-v1/alive/3d/assets.html?kind=${kind}&night=${night}&distance=${distance}`,{waitUntil:'networkidle0'});
   await page.waitForFunction(()=>window.__assetReady===true);await page.screenshot({path:out+'/'+name+'.png'});
   rows.push(await page.evaluate(()=>window.__assetProof));console.log(name);
  }
  await page.goto(`http://127.0.0.1:5202/art/evidence/dreamisland-v1/alive/3d/assets.html?kind=${kind}&quadrants=1`,{waitUntil:'networkidle0'});
  await page.waitForFunction(()=>window.__assetReady===true);await page.screenshot({path:out+'/'+kind+'-quadrants.png'});
 }
 await writeFile(out+'/captures.json',JSON.stringify({rows,errors},null,2));if(errors.length)throw Error(errors.join('\n'));
}finally{await browser.close();}
