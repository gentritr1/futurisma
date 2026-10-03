import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
const report=[];
try{
  for(const mode of ['module-failure','image-failure','pixel','no-shadows','reduced']){
    const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[],warnings=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='warning'&&m.text().includes('surface finish'))warnings.push(m.text());if(m.type()==='error'&&/Shader|VALIDATE_STATUS|GL_INVALID/.test(m.text()))errors.push(m.text());});
    await page.route('**/src/game/game.ts*',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('this.renderer.outputColorSpace = THREE.SRGBColorSpace;','this.renderer.outputColorSpace = THREE.SRGBColorSpace; window.__game = this;')});});
    if(mode==='module-failure')await page.route('**/circuit-surface-finish.ts*',route=>route.abort());
    if(mode==='image-failure')await page.route('**/surface-finish/aggregate.jpg',route=>route.abort());
    const query=mode==='pixel'?'render=ps2':mode==='no-shadows'?'shadows=0':mode==='reduced'?'motion=reduce':'render=agx';
    await page.goto(`http://127.0.0.1:5218/?map=nightshift&quality=high&music=0&voice=0&${query}`);
    await page.waitForFunction(()=>window.__game?.circuitRuntime&&document.body.dataset.phase==='intro'&&!document.body.dataset.launch,null,{timeout:60000});
    const failure=mode.endsWith('failure');
    if(!failure)await page.waitForFunction(()=>window.__game.course.group.userData.surfaceFinish,null,{timeout:30000});
    await page.keyboard.press('Enter');await page.waitForFunction(()=>window.__game.phase==='running');
    await page.waitForTimeout(700);
    assert.deepEqual(errors,[]);assert.equal(warnings.length,failure?1:0);
    const state=await page.evaluate(()=>({phase:window.__game.phase,shadows:window.__game.renderer.shadowMap.enabled,finish:window.__game.course.group.userData.surfaceFinish}));
    if(failure)assert.equal(state.finish,undefined);else assert.ok(state.finish.materials>0);
    if(mode==='pixel'||mode==='no-shadows')assert.equal(state.shadows,false);
    await page.evaluate(()=>window.__game.dispose());
    report.push({mode,state,errors,warningCount:warnings.length});await page.close();
  }
}finally{await browser.close();await writeFile('art/evidence/surface-finish/fallback-report.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify(report,null,2));
