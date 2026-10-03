import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
try{
 const reports=[];
 for(const failAsset of [false,true]){
  const page=await browser.newPage();
  await page.route('**/src/game/game.ts*',async route=>{
   const response=await route.fetch();
   const body=(await response.text()).replace('this.renderer.outputColorSpace = THREE.SRGBColorSpace;','this.renderer.outputColorSpace = THREE.SRGBColorSpace;window.__game=this;');
   await route.fulfill({response,body});
  });
  if(failAsset)await page.route('**/assets/circuit-booths/booths.glb',route=>route.fulfill({status:503,body:'Optional asset unavailable'}));
  await page.goto('http://127.0.0.1:5218/?map=nightshift&music=0&voice=0');
  await page.waitForFunction(()=>window.__game?.circuitRuntime?.life&&window.__game?.sceneAssets?.authoredEnvironment);
  await page.waitForTimeout(2500);await page.keyboard.press('Enter');
  await page.waitForFunction(()=>window.__game.phase==='running');
  await page.keyboard.press('p');await page.waitForFunction(()=>window.__game.phase==='paused');
  const report=await page.evaluate(()=>{
   const life=window.__game.circuitRuntime.life,kit=life.boothKit;
   const expected={geometry:0,materials:0,textures:0},disposed={geometry:0,materials:0,textures:0};
   if(kit)for(const type of ['geometry','materials','textures'])for(const resource of kit[type]){
    expected[type]++;resource.addEventListener('dispose',()=>disposed[type]++);
   }
   const lights=life.boothLights.length,authored=life.root.userData.authoredBooths;
   if(kit){life.dispose();kit.dispose();}
   return {authored,lights,expected,disposed,detached:kit?!life.root.parent:null};
  });
  assert.equal(report.authored,!failAsset);
  if(!failAsset){assert.equal(report.lights,2);assert.deepEqual(report.disposed,report.expected);assert.ok(report.detached);}
  reports.push({failAsset,...report});await page.close();
 }
 await writeFile('.dream-loop/blender-polish/lifecycle.json',JSON.stringify(reports,null,2));console.log(JSON.stringify(reports));
}finally{await browser.close();}
