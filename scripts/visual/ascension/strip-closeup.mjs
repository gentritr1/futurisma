import {writeFile} from 'node:fs/promises';
import {launchReviewBrowser} from '../tideline-v4/browser.mjs';
const browser=await launchReviewBrowser(),out='art/evidence/ascension-v1/phase-b';
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.setRequestInterception(true);
 page.on('request',async request=>{
  if(new URL(request.url()).pathname!=='/scripts/visual/ascension/review.ts'){await request.continue();return;}
  const response=await fetch(request.url());let code=await response.text();
  const marker='const fog = course.fogAt(progress);';
  if(!code.includes(marker))throw Error('Review camera marker changed');
  code=code.replace(marker,`const lampMatrix = new THREE.Matrix4();
    runtime.signals.strips[0].lamps.getMatrixAt(4,lampMatrix);
    const lampCenter = new THREE.Vector3().setFromMatrixPosition(lampMatrix);
    camera.position.copy(lampCenter).add(new THREE.Vector3(1.2,.7,1.1));
    camera.lookAt(lampCenter);camera.fov=42;camera.updateProjectionMatrix();
    ${marker}`);
  await request.respond({status:200,contentType:'text/javascript',body:code});
 });
 await page.goto('http://127.0.0.1:5200/ascension-review.html?progress=.083',{waitUntil:'networkidle0'});await page.waitForSelector('#review-state');
 await page.screenshot({path:out+'/launch-lamp-housing.png'});
 await writeFile(out+'/launch-lamp-housing.json',JSON.stringify({script:'scripts/visual/ascension/strip-closeup.mjs',scope:'Production launch strip geometry and materials in the static course review. Harness changes only camera position and field of view for a physical housing close-up.',errors,state:await page.$eval('#review-state',e=>JSON.parse(e.textContent))},null,2));
 if(errors.length)throw Error(errors.join('\n'));
}finally{await browser.close();}
