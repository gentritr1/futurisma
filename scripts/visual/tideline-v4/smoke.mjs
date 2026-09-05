import {launchReviewBrowser} from './browser.mjs';
import {writeFile,mkdir} from 'node:fs/promises';
const browser=await launchReviewBrowser();
try {
 const page=await browser.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.evaluateOnNewDocument(()=>{window.__v4CaptureRenderer=r=>{const render=r.render.bind(r);r.render=(s,c)=>{window.__v4Scene=s;return render(s,c);};};});
 await page.setRequestInterception(true);page.on('request',async r=>{
  if(new URL(r.url()).pathname==='/src/game/game.ts') {const response=await fetch(r.url());const code=(await response.text()).replace('this.renderer.outputColorSpace = THREE.SRGBColorSpace;','this.renderer.outputColorSpace = THREE.SRGBColorSpace;window.__v4CaptureRenderer(this.renderer);');await r.respond({status:200,contentType:'text/javascript',body:code});} else await r.continue();
 });
 await page.goto('http://127.0.0.1:5215/?map=tideline&demo=1&headless=1&start=manual&music=0&diagnostics&seed=3868938316',{waitUntil:'networkidle0'});
 await page.click('#start-button');await page.waitForFunction(()=>document.querySelector('#speed-value')?.textContent!=='0');
 await new Promise(r=>setTimeout(r,8000));
 const materials=await page.evaluate(()=>{const rows=[];window.__v4Scene.traverse(o=>{if(!o.userData.tidelineGameplay)return;for(const m of Array.isArray(o.material)?o.material:[o.material])rows.push({object:o.name,material:m.name,type:m.type,toneMapped:m.toneMapped,fog:m.fog});});return rows;});
 await mkdir('art/evidence/tideline-v4/render-rule',{recursive:true});
 await page.screenshot({path:'art/evidence/tideline-v4/render-rule/smoke.png'});
 const accepted=materials.length>0&&materials.every(m=>m.toneMapped!==false&&m.fog!==false)&&errors.length===0;
 await writeFile('art/evidence/tideline-v4/render-rule/material-walk.json',JSON.stringify({script:'scripts/visual/tideline-v4/smoke.mjs',materials,errors,accepted},null,2));console.log(JSON.stringify({materials:materials.length,errors,accepted}));if(!accepted)throw Error('Render acceptance failed');
}finally{await browser.close();}
