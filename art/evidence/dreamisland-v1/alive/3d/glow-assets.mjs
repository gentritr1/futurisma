import {mkdir,writeFile} from 'node:fs/promises';
import {launchReviewBrowser} from '../../../../../scripts/visual/tideline-v4/browser.mjs';
const out='art/evidence/dreamisland-v1/alive/3d/glow-assets';await mkdir(out,{recursive:true});
const browser=await launchReviewBrowser(),errors=[];
try{
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 for(const kind of ['capsule','PR_bollard'])for(const distance of [8,40])for(const disabled of [false,true]){
  await page.goto(`http://127.0.0.1:5202/art/evidence/dreamisland-v1/alive/3d/assets.html?kind=${kind}&night=1&distance=${distance}&glow=1${disabled?'&withoutGlow=1':''}`,{waitUntil:'networkidle0'});
  await page.waitForFunction(()=>window.__assetReady===true);await page.screenshot({path:out+`/${kind}-${distance}m-${disabled?'without':'with'}.png`});
 }
 await writeFile(out+'/errors.json',JSON.stringify(errors));if(errors.length)throw Error(errors.join('\n'));
}finally{await browser.close();}
