import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const output='art/evidence/race-feel',maps=process.argv.length>2?process.argv.slice(2):['greenwater','bitterpan','nightshift','polarity','tideline','ascension','dreamisland','afterglow','frostline'];
await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
const report=[];
try {
 for(const map of maps){
  const page=await browser.newPage({viewport:{width:960,height:600}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.routeWebSocket('**',socket=>socket.send(JSON.stringify({type:'connected'})));
  await page.route('**/src/game/game.ts*',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('this.renderer.outputColorSpace = THREE.SRGBColorSpace;','this.renderer.outputColorSpace = THREE.SRGBColorSpace; window.__game = this;')});});
  await page.goto(`http://127.0.0.1:5218/?map=${map}&quality=high&render=agx&music=0&voice=0&motion=reduce`);
  await page.waitForFunction(()=>window.__game?.sceneAssets?.environmentReady&&window.__game.course.group.userData.surfaceFinish&&!document.body.dataset.launch,null,{timeout:60000});
  await page.keyboard.press('Enter');await page.waitForFunction(()=>window.__game.phase==='running');
  await page.keyboard.press('p');await page.waitForFunction(()=>window.__game.phase==='paused');
  const views=[];
  for(const progress of [.12,.37,.62,.87]){
   const data=await page.evaluate(progress=>{
    const g=window.__game,s=g.course.sample(progress),ahead=g.course.sample(progress+25/g.course.length);
    g.camera.position.copy(s.position).addScaledVector(s.up,4);g.camera.up.copy(s.up);
    g.camera.lookAt(ahead.position.clone().addScaledVector(ahead.up,2));g.camera.fov=68;g.camera.updateProjectionMatrix();
    document.querySelector('#pause-panel').style.display='none';document.querySelector('.hud').style.visibility='hidden';
    g.atmosphere.updateFog(2,progress,g.lap,g.totalLaps,'running');
    g.sceneAssets.authoredEnvironment?.updateVisibility(g.camera);g.renderer.render(g.scene,g.camera);
    return {progress,halfWidth:s.halfWidth,position:s.position.toArray()};
   },progress);
   await page.screenshot({path:`${output}/${map}-${Math.round(progress*100)}.png`});views.push(data);
  }
  assert.deepEqual(errors,[]);report.push({map,views,errors});await page.close();
 }
}finally{await browser.close();await writeFile(`${output}/course-views${maps.length===1?`-${maps[0]}`:""}.json`,JSON.stringify(report,null,2));}
await writeFile(`${output}/course-views-latest.html`,`<!doctype html><meta charset="utf-8"><title>Futurisma · whole-circuit review</title><style>body{margin:24px;background:#11181b;color:#dbe2e4;font:16px system-ui}section{margin-bottom:36px}h2{text-transform:uppercase}article{display:grid;grid-template-columns:1fr 1fr;gap:12px}figure{margin:0}img{width:100%}figcaption{padding:5px}</style><h1>Whole-circuit review</h1><p>Four fixed road-level views per circuit, at 12%, 37%, 62% and 87% of the lap. These are visual fixtures; automated complete laps are reported separately.</p>${maps.map(map=>`<section><h2>${map}</h2><article>${[12,37,62,87].map(p=>`<figure><img src="${map}-${p}.png"><figcaption>${p}% of lap</figcaption></figure>`).join('')}</article></section>`).join('')}`);
console.log(`Course views PASS: ${report.length*4} views across ${report.length} maps, no page errors.`);
