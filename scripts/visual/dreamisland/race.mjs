import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {instrument,metrics} from './instrument.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchReviewBrowser} from '../tideline-v4/browser.mjs';
const flag=name=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3);
const tier=flag('tier')??'works',seed=flag('seed')??'3868938316',calibrate=process.argv.includes('--calibrate'),reduced=process.argv.includes('--reduced');
const out=flag('out')??'art/evidence/dreamisland-v1/phase-a/'+(calibrate?'calibration':'soak-'+tier)+(reduced?'-reduced':'');
await mkdir(out,{recursive:true});
const inputFiles=['src/game/dreamisland-course.ts','src/game/dreamisland-runtime.ts','src/game/dreamisland-schedule.js',
 'src/game/dreamisland-powers.ts','src/game/dreamisland-powers-config.js','src/game/dreamisland-environment.ts',
 'src/game/data/dreamisland/route.json','src/game/data/dreamisland/schedule.json','src/game/data/dreamisland/rival-pace.json'];
const inputHashes=Object.fromEntries(inputFiles.map(file=>[file,createHash('sha256').update(readFileSync(file)).digest('hex')]));
const browser=await launchReviewBrowser();
try{
 const page=await browser.newPage(),errors=[];
 page.on('pageerror',e=>{errors.push(String(e));console.log(String(e));});
 page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.log(m.text());}});
 await instrument(page);
 // `?autostart=1` does not exist. `demo=1` autostarts UNLESS diagnostics and
 // start=manual are both present, which they are here, so the harness clicks.
 const url='http://127.0.0.1:5200/?map=dreamisland&seed='+seed+'&tier='+tier
  +'&demo=1&headless=1&diagnostics=1&start=manual&quality=high&music=0'
  +(calibrate?'&calibrate=1':'')+(reduced?'&motion=reduce':'');
 await page.goto(url,{waitUntil:'networkidle0',timeout:60000});
 if(errors.length)throw Error(errors.join('\n'));
 await page.waitForSelector('#start-button',{visible:true});
 const calibration=await page.evaluate(()=>new Promise(resolve=>{const times=[];function tick(t){times.push(t);if(times.length<121)requestAnimationFrame(tick);else resolve({samples:120,windowMs:times.at(-1)-times[0],hz:120000/(times.at(-1)-times[0])});}requestAnimationFrame(tick);}));
 await page.click('#start-button');await page.screenshot({path:out+'/start.png'});
 // Two rendered frames the review can actually look at: the day blockout on the
 // first lap, and the settled night state after the clock has struck.
 const at=predicate=>page.waitForFunction(predicate,{timeout:240000});
 const shot=async(name,predicate)=>{
  try{
   await at(predicate);
   await page.screenshot({path:out+'/'+name+'.png'});
   await writeFile(out+'/'+name+'.json',JSON.stringify(await page.evaluate(()=>JSON.parse(document.getElementById('dreamisland-diagnostics').textContent)),null,2));
  }catch(error){console.log('missed '+name+': '+error.message);}
 };
 if(!calibrate){
  await shot('day-grove',()=>{try{const d=JSON.parse(document.getElementById('dreamisland-diagnostics').textContent);return d.nightBlend===0&&d.progress>.18&&d.progress<.26;}catch{return false;}});
  await shot('night-settled',()=>{try{const d=JSON.parse(document.getElementById('dreamisland-diagnostics').textContent);return d.state.nightSettled&&d.progress>.55&&d.progress<.72;}catch{return false;}});
 }
 await page.waitForFunction(()=>{try{return JSON.parse(document.getElementById('futurisma-diagnostics').textContent).current.phase==='finished';}catch{return false;}},{timeout:240000});
 const materialWalk=await page.evaluate(()=>{const rows=[];window.__diScene.traverse(o=>{if(!o.isMesh&&!o.isPoints)return;for(const m of Array.isArray(o.material)?o.material:[o.material])rows.push({object:o.name,material:m.name,type:m.type,toneMapped:m.toneMapped,fog:m.fog,visible:o.visible});});return rows;});
 await writeFile(out+'/material-walk.json',JSON.stringify({script:'scripts/visual/dreamisland/race.mjs',scope:'Live scene at race finish, hidden objects included; the sky dome runs its own haze shader.',rows:materialWalk,violations:materialWalk.filter(r=>r.toneMapped===false||(r.fog===false&&!['sky_backdrop'].includes(r.object)))},null,2));
 const capture=await page.evaluate(()=>({frames:window.__diFrames,draws:window.__diDraws,
  diagnostics:JSON.parse(document.getElementById('futurisma-diagnostics').textContent),
  dreamisland:JSON.parse(document.getElementById('dreamisland-diagnostics').textContent)}));
 await writeFile(out+'/metrics.json',JSON.stringify(metrics(capture.frames,calibration),null,2));
 await page.screenshot({path:out+'/finish.png'});
 await writeFile(out+'/race.json',JSON.stringify({script:'scripts/visual/dreamisland/race.mjs',url,inputHashes,calibration,errors,...capture},null,2));
 console.log(JSON.stringify({laps:capture.diagnostics.current.lapTimesMs,missedGates:capture.diagnostics.current.missedGates,recoveries:capture.diagnostics.current.recoveries,errors:errors.length,out}));
}finally{await browser.close();}
