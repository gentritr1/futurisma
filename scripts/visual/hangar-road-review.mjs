import {mkdir, writeFile} from 'node:fs/promises';
import {launchReviewBrowser} from './tideline-v4/browser.mjs';
import {instrument} from './dreamisland/instrument.mjs';

const out=process.argv.find(arg=>arg.startsWith('--out='))?.slice(6) ?? 'art/evidence/hangar-road/after';
await mkdir(out,{recursive:true});
const browser=await launchReviewBrowser();
const report={instrument:'scripts/visual/hangar-road-review.mjs',captures:[]};
try {
  const distances=process.argv.find(arg=>arg.startsWith('--distances='))?.slice(12).split(',').map(Number)??[610,640,660,680,710,740];
  for (const distance of distances) {
    const page=await browser.newPage();
    await instrument(page);
    await page.evaluateOnNewDocument(()=>{window.__diCaptureFrame=(_renderer,args)=>{window.__hangarCamera=args[1];};});
    await page.goto(`http://127.0.0.1:5201/?map=greenwater&diagnostics=1&headless=1&quality=high&music=0&voice=0&probe=boundary-hold&probeDistance=${distance}&probeLateral=0&start=manual`,{waitUntil:'networkidle0'});
    await page.waitForFunction(()=>window.__diScene && JSON.parse(document.getElementById('futurisma-diagnostics').textContent).current.environmentReady);
    await page.evaluate(()=>{
      window.__diCaptureFrame=(_renderer,args)=>{window.__hangarCamera=args[1];};
      for(const node of document.querySelectorAll('#app > *'))if(node.id!=='game-canvas'&&!node.classList.contains('image-treatment'))node.style.display='none';
      window.dispatchEvent(new Event('resize'));
    });
    await page.waitForFunction(()=>window.__hangarCamera);
    const data=await page.evaluate(async()=>{
      const THREE=await import('/node_modules/.vite/deps/three.js');
      const scene=window.__diScene;
      const ray=new THREE.Raycaster();
      const hits=[];
      for(const x of [-.5,0,.5]) {
        ray.setFromCamera(new THREE.Vector2(x,.1),window.__hangarCamera);
        hits.push({x,objects:ray.intersectObjects(scene.children,true).slice(0,5).map(h=>({name:h.object.name,point:h.point.toArray(),distance:h.distance,face:h.faceIndex}))});
      }
      return {diagnostics:JSON.parse(document.getElementById('futurisma-diagnostics').textContent).current,hits};
    });
    await page.screenshot({path:`${out}/${distance}.png`});
    report.captures.push({distance,...data});
    console.log(distance,JSON.stringify(data.hits));
    await page.close();
  }
} finally {await browser.close();await writeFile(`${out}/review.json`,JSON.stringify(report,null,2)+'\n');}
