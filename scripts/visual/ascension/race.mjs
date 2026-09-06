import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {instrument,metrics} from './instrument.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchReviewBrowser} from '../tideline-v4/browser.mjs';
const branch=process.argv.includes('--trench'),reduced=process.argv.includes('--reduced');
const tier=process.argv.find(a=>a.startsWith('--tier='))?.slice(7)??'works',seed=process.argv.find(a=>a.startsWith('--seed='))?.slice(7)??'3868938316';
const out=process.argv.find(a=>a.startsWith('--out='))?.slice(6)??'art/evidence/ascension-v1/'+(process.argv.includes('--phase-b')?'phase-b':'phase-a')+'/' +(branch?'trench':'deluge')+(reduced?'-reduced':'')+(process.argv.includes('--unbatched')?'-unbatched':'')+(process.argv.includes('--calibrate')?'-calibration':'')+(tier!=='works'||seed!=='3868938316'?'-'+tier+'-'+seed:'');await mkdir(out,{recursive:true});
while(existsSync('/tmp/ascension-review-pause'))await delay(250);
const inputFiles=['src/game/ascension-course.ts','src/game/ascension-runtime.ts','src/game/ascension-schedule.js','src/game/ascension-environment.ts','src/game/ascension-flat-batch.ts','src/game/data/ascension/route.json','src/game/data/ascension/schedule.json','src/game/data/ascension/rival-pace.json',...(process.argv.includes('--phase-b')?['src/game/ascension-painted-environment.ts','src/game/ascension-effects.ts','src/game/ascension-event-pose.js','src/game/ascension-mangroves.ts','src/game/ascension-terrain.ts','src/game/ascension-instance-lamps.ts','src/game/ascension-static-paint.ts','src/game/ascension-sky.ts','public/assets/ascension/painted.glb','public/assets/ascension/horizon.png']:['public/assets/ascension/blockout.glb'])];
if(process.argv.includes('--phase-b')){for(const name of readdirSync('public/assets/ascension'))if(name.endsWith('.glb'))inputFiles.push('public/assets/ascension/'+name);for(const name of readdirSync('public/assets/ascension/textures'))inputFiles.push('public/assets/ascension/textures/'+name);inputFiles.push('src/game/ascension-materials.ts','src/game/ascension-road-signals.ts','src/game/power-kit.ts','src/game/totem-evolution.ts','src/game/totem.ts','src/game/race-presentation-setup.ts','src/game/scene-assets.ts');}
const inputHashes=Object.fromEntries(inputFiles.map(file=>[file,createHash('sha256').update(readFileSync(file)).digest('hex')]));
const browser=await launchReviewBrowser();
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>{errors.push(String(e));console.log(String(e));});page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.log(m.text());}});
 await instrument(page);
 const url='http://127.0.0.1:5200/?map=ascension&seed='+seed+'&tier='+tier+'&demo=1&headless=1&diagnostics=1&start=manual&quality=high&music=0&demoTrench='+(branch?'1':'0')+(process.argv.includes('--unbatched')?'&ascensionBatch=0':'')+(reduced?'&motion=reduce':'')+(process.argv.includes('--calibrate')?'&calibrate=1':'');
 await page.goto(url,{waitUntil:'networkidle0',timeout:60000});if(errors.length)throw Error(errors.join('\n'));
 await page.waitForSelector('#start-button',{visible:true});
 const calibration=await page.evaluate(()=>new Promise(resolve=>{const times=[];function tick(t){times.push(t);if(times.length<121)requestAnimationFrame(tick);else resolve({samples:120,windowMs:times.at(-1)-times[0],hz:120000/(times.at(-1)-times[0])});}requestAnimationFrame(tick);}));
 await page.click('#start-button');await page.screenshot({path:out+'/start.png'});
 if(process.argv.includes('--phase-b')){
  await page.waitForFunction(()=>{try{const d=JSON.parse(document.getElementById('ascension-diagnostics').textContent);return d.progress>.3&&d.progress<.45;}catch{return false;}},{timeout:60000});
  await page.screenshot({path:out+'/branch-hud-live.png'});
  await writeFile(out+'/branch-hud-live.json',JSON.stringify(await page.evaluate(()=>({script:'scripts/visual/ascension/race.mjs',ascension:JSON.parse(document.getElementById('ascension-diagnostics').textContent),hud:document.body.innerText})),null,2));
 }
 if(process.argv.includes('--phase-c')){
  await page.waitForFunction(()=>{try{const d=JSON.parse(document.getElementById('ascension-diagnostics').textContent);return d.tick>d.schedule.launchTick+120&&d.state.steam;}catch{return false;}},{timeout:120000});
  await page.screenshot({path:out+'/launch-live.png'});
  await writeFile(out+'/launch-live.json',JSON.stringify(await page.evaluate(()=>({ascension:JSON.parse(document.getElementById('ascension-diagnostics').textContent),race:JSON.parse(document.getElementById('futurisma-diagnostics').textContent),hud:document.body.innerText})),null,2));
 }
 await page.waitForFunction(()=>{try{return JSON.parse(document.getElementById('futurisma-diagnostics').textContent).current.phase==='finished';}catch{return false;}},{timeout:180000});
 const materialWalk=await page.evaluate(()=>{const rows=[];window.__ascScene.traverse(o=>{if(!o.isMesh&&!o.isPoints)return;for(const m of Array.isArray(o.material)?o.material:[o.material])rows.push({object:o.name,material:m.name,type:m.type,toneMapped:m.toneMapped,fog:m.fog,visible:o.visible});});return rows;});
 await writeFile(out+'/material-walk.json',JSON.stringify({script:'scripts/visual/ascension/race.mjs',scope:'Live scene at race finish, includes currently hidden objects; sky uses its own haze shader.',rows:materialWalk,violations:materialWalk.filter(r=>r.toneMapped===false||(r.fog===false&&!['sky_backdrop','ascension_dawn_panorama'].includes(r.object)))},null,2));
 const capture=await page.evaluate(()=>({frames:window.__ascFrames,draws:window.__ascDraws,diagnostics:JSON.parse(document.getElementById('futurisma-diagnostics').textContent),ascension:JSON.parse(document.getElementById('ascension-diagnostics').textContent)}));
 await writeFile(out+'/metrics.json',JSON.stringify(metrics(capture.frames,calibration),null,2));
 await page.screenshot({path:out+'/finish.png'});await writeFile(out+'/race.json',JSON.stringify({script:'scripts/visual/ascension/race.mjs',url,inputHashes,calibration,errors,...capture},null,2));console.log(JSON.stringify({laps:capture.diagnostics.current.lapTimesMs,missedGates:capture.diagnostics.current.missedGates,recoveries:capture.diagnostics.current.recoveries,errors}));
}finally{await browser.close();}
