import {launchReviewBrowser} from '../../../../../scripts/visual/tideline-v4/browser.mjs';
const browser=await launchReviewBrowser();
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 for(const node of ['PR_ball','PR_ring','PR_sphere','PR_pipes','PR_bollard','PR_plinth','capsule','CAP_frame','CAP_glass','CAP_core','CAP_cap','PR_bollard_core']){
  const kind=node.startsWith('CAP_')?'capsule':node;
  const single=node.startsWith('CAP_')||node==='PR_bollard_core'?`&node=${node}`:'';
  await page.goto(`http://127.0.0.1:5202/art/evidence/dreamisland-v1/alive/3d/assets.html?kind=${kind}${single}&quadrants=1`,{waitUntil:'networkidle0'});
  await page.waitForFunction(()=>window.__assetReady===true);
  await page.screenshot({path:`art/evidence/dreamisland-v1/alive/3d/assets/${node}-quadrants.png`});
 }
 if(errors.length)throw Error(errors.join('\n'));
}finally{await browser.close();}
