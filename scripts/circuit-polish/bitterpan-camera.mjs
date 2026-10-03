import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

// Compare camera behavior on identical geometry and vehicle poses. Only the
// course identity changes, so terrain cannot conceal a map-specific override.
const baseline=process.argv.includes('--baseline');
const out='.dream-loop/circuit-polish';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
try {
  const page=await browser.newPage({viewport:{width:1536,height:864}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/src/game/game.ts*',async route=>{
    const response=await route.fetch();
    const body=(await response.text()).replace('this.renderer.outputColorSpace = THREE.SRGBColorSpace;','this.renderer.outputColorSpace = THREE.SRGBColorSpace; window.__game=this;');
    await route.fulfill({response,body});
  });
  await page.goto('http://127.0.0.1:5218/?map=bitterpan&quality=high&music=0&voice=0&diagnostics=1');
  await page.waitForFunction(()=>window.__game?.circuitRuntime?.life&&window.__game?.sceneAssets?.authoredEnvironment);
  await page.waitForTimeout(2500);
  await page.keyboard.press('Enter');
  await page.waitForFunction(()=>window.__game.phase==='running');
  await page.keyboard.press('p');
  await page.waitForFunction(()=>window.__game.phase==='paused');
  const poses=await page.evaluate(()=>{
    const g=window.__game,results=[];
    for(const progress of [.03,.2,.38,.57,.76,.92])for(const speed of [0,60,100])for(const steer of [0,.65]){
      const views=[];
      for(const kind of ['bitterpan','greenwater']){
        g.course.kind=kind;
        const s=g.course.sample(progress);
        g.progress=progress;g.lateral=0;g.position.copy(s.position);
        g.forward.copy(s.tangent);g.travelDirection.copy(s.tangent);g.speed=speed;
        g.driftIntensity=0;g.impactShake=0;g.cameraOcclusionPull=0;
        g.syncPresentationPose();g.updatePose({throttle:0,brake:0,steer,boost:false},0);
        g.camera.up.copy(s.up);g.camera.fov=56;g.snapCamera();
        const snapped=g.camera.position.toArray();
        for(let frame=0;frame<120;frame++)g.updateCamera(1/60,steer,0,g.poseProjection);
        views.push({snapped,position:g.camera.position.toArray(),look:g.cameraLook.toArray(),fov:g.camera.fov,clearance:g.diagnosticCameraSurfaceClearance,hull:[g.diagnosticHullNdcX,g.diagnosticHullNdcY]});
      }
      results.push({progress,speed,steer,views});
    }
    g.course.kind='bitterpan';
    return results;
  });
  const maxDifference=Math.max(...poses.flatMap(({views:[a,b]})=>[...a.snapped.map((v,i)=>Math.abs(v-b.snapped[i])),...a.position.map((v,i)=>Math.abs(v-b.position[i])),...a.look.map((v,i)=>Math.abs(v-b.look[i])),Math.abs(a.fov-b.fov)]));
  if(!baseline)assert.ok(maxDifference<1e-6,`Bitterpan should share the legacy chase camera, difference ${maxDifference}`);
  for(const {views} of poses)for(const view of views){
    assert.ok(view.clearance>=1.59,'Camera stays above the road');
    assert.ok(view.hull.every(Number.isFinite),'Hull remains projectable');
    assert.ok(Math.abs(view.hull[0])<=.8&&view.hull[1]>=-.85&&view.hull[1]<=.65,'Hull stays inside the reviewed framing window');
  }
  assert.deepEqual(errors,[]);
  const report={poses:poses.length,maxDifference,errors,details:poses};
  await writeFile(`${out}/bitterpan-camera-${baseline?'before':'after'}.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify({poses:poses.length,maxDifference,errors}));
}finally{await browser.close();}
