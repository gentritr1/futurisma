import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {instrument,metrics} from '../../../../../scripts/visual/dreamisland/instrument.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchReviewBrowser} from '../../../../../scripts/visual/tideline-v4/browser.mjs';
const flag=name=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3);
const tier=flag('tier')??'works',seed=flag('seed')??'3868938316',calibrate=process.argv.includes('--calibrate'),reduced=process.argv.includes('--reduced');
// Phase D. `--mode=` is the race FORMAT (race|sprint|timeattack) and `--laps=`
// the `?laps=` override; both are passed straight through to the query string
// the game itself arbitrates, so the harness proves what the game decides
// rather than deciding anything of its own. `--profile=` keeps a chrome user
// data directory across launches, which is what makes a ghost recorded by one
// invocation visible to the next.
const mode=flag('mode')??'race',laps=flag('laps'),profile=flag('profile');
if(!['race','sprint','timeattack'].includes(mode))throw Error('--mode= must be race, sprint or timeattack');
if(laps!==undefined&&!/^-?\d+$/.test(laps))throw Error('--laps= must be an integer');
const out=flag('out')??'art/evidence/dreamisland-v1/phase-a/'+(calibrate?'calibration':'soak-'+tier)+(reduced?'-reduced':'');
await mkdir(out,{recursive:true});
const inputFiles=['src/game/dreamisland-course.ts','src/game/dreamisland-runtime.ts','src/game/dreamisland-schedule.js',
 'src/game/dreamisland-powers.ts','src/game/dreamisland-powers-config.js',
 'src/game/dreamisland-painted-environment.ts','src/game/dreamisland-materials.ts',
 'src/game/dreamisland-sky.ts','src/game/dreamisland-water.ts','src/game/dreamisland-reflections.ts','public/assets/dreamisland/painted.glb',
 'src/game/data/dreamisland/route.json','src/game/data/dreamisland/schedule.json','src/game/data/dreamisland/rival-pace.json',
 'src/game/dreamisland-clock.js','src/game/dreamisland-hardware.ts','src/game/dreamisland-hardware-layout.js',
 'src/game/dreamisland-audio.ts','src/game/dreamisland-sound-graph.ts','src/game/dreamisland-audio-plan.js',
 'src/game/dreamisland-beds.js','src/game/data/dreamisland/bed-profile.json','src/game/data/dreamisland/sound-levels.json',
 'src/game/data/dreamisland/power-colors.json','src/game/audio.ts','src/game/totem-evolution.ts',
 'public/assets/dreamisland/power-kit.glb','public/assets/dreamisland/painted.json'];
const inputHashes=Object.fromEntries(inputFiles.map(file=>[file,createHash('sha256').update(readFileSync(file)).digest('hex')]));
// The flag wait is a single CDP call, so puppeteer's 180 s protocol timeout —
// not the wait's own timeout — is what killed `?laps=9` before this. Both are
// derived from the lap count for the same reason.
const flagTimeoutMs=Math.max(240000,(Number(laps)||3)*45000);
const browser=await launchReviewBrowser({...(profile?{userDataDir:profile}:{}),protocolTimeout:flagTimeoutMs+120000});
try{
 const page=await browser.newPage(),errors=[];
 page.on('pageerror',e=>{errors.push(String(e));console.log(String(e));});
 page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.log(m.text());}});
 const grip=flag('grip');
 if(grip!==undefined&&!(Number(grip)>=.2&&Number(grip)<=1))throw Error('--grip= must be within the physics grip range');
 const basinWidth=flag('basin-width');
 if(basinWidth!==undefined&&!(Number(basinWidth)>=13.9&&Number(basinWidth)<=20))throw Error('--basin-width= must stay inside the validator width range and existing BASIN width');
 await instrument(page,{...(grip!==undefined?{grip:Number(grip)}:{}),...(basinWidth!==undefined?{basinWidth:Number(basinWidth)}:{})});
 // `?autostart=1` does not exist. `demo=1` autostarts UNLESS diagnostics and
 // start=manual are both present, which they are here, so the harness clicks.
 const url=(flag('base')??'http://127.0.0.1:5203')+'/?map=dreamisland&seed='+seed+'&tier='+tier+'&mode='+mode
  +'&demo=1&headless=1&diagnostics=1&start=manual&quality=high&music=0'
  +(laps!==undefined?'&laps='+laps:'')
  +(calibrate?'&calibrate=1':'')+(reduced?'&motion=reduce':'');
 await page.goto(url,{waitUntil:'networkidle0',timeout:60000});
 if(errors.length)throw Error(errors.join('\n'));
 await page.waitForSelector('#start-button',{visible:true});
 const calibration=await page.evaluate(()=>new Promise(resolve=>{const times=[];function tick(t){times.push(t);if(times.length<121)requestAnimationFrame(tick);else resolve({samples:120,windowMs:times.at(-1)-times[0],hz:120000/(times.at(-1)-times[0])});}requestAnimationFrame(tick);}));
 await page.screenshot({path:out+'/start.png'});
 // Phase D — the start screen BEFORE the click, so the format chip row and the
 // intro panel's schedule line are in the frame the review looks at.
 await writeFile(out+'/intro.json',JSON.stringify(await page.evaluate(()=>({
  introCode:document.querySelector('.intro-code')?.textContent??null,
  introDeck:document.querySelector('.intro-deck')?.textContent??null,
  introFooter:document.querySelector('.intro-footer')?.textContent??null,
  lapValue:document.getElementById('lap-value')?.textContent??null,
  // The starting grid as the paddock prints it. In a sprint this is the proof
  // of the reversal: the field's own slots are handed out back to front, so the
  // quickest rival lines up furthest from the player.
  startingGrid:[...document.querySelectorAll('#grid-order li')].map(row=>row.textContent),
  formatChips:[...document.querySelectorAll('#format-select [data-value]')].map(chip=>({
   value:chip.dataset.value,selected:chip.getAttribute('aria-checked')==='true',
   text:chip.textContent})),
 })),null,2));
 await page.click('#start-button');
 // Phase D — THE TICK AT THE FLAG, latched in the page.
 //
 // Read after the fact it is not the same number: the schedule clock keeps
 // running through the post-flag coast (`updateCoast` calls `advanceClocks`),
 // so a tick sampled once the harness has noticed `phase === "finished"` and
 // walked the scene graph is tens of seconds of coast later than the crossing,
 // and an event that fired in that coast reads exactly like an event that fired
 // in the race. This latches the clock on the first frame the phase flips, so
 // "did the strike land inside the race" is answered by the race and not by how
 // long the harness took to look.
 await page.evaluate(()=>{
  window.__diFlag=null;
  const read=id=>{try{return JSON.parse(document.getElementById(id).textContent);}catch{return null;}};
  const watch=()=>{
   const race=read('futurisma-diagnostics'),island=read('dreamisland-diagnostics');
   if(window.__diFlag===null&&race?.current?.phase==='finished'&&island){
    window.__diFlag={tick:island.tick,progress:island.progress,nightBlend:island.nightBlend,
     state:island.state,events:island.events.map(e=>({id:e.id,tick:e.tick})),
     lapTimesMs:race.current.lapTimesMs};
    return;
   }
   requestAnimationFrame(watch);
  };
  requestAnimationFrame(watch);
 });
 // Phase D — the grid as the fleet was actually placed, read at the first
 // diagnostics frame of the race. `reverseGridOrder` permutes the FIELD's own
 // slots, so the proof is each rival's race distance on the grid: unreversed the
 // profiles sit at their authored offsets in order, reversed the quickest
 // profile holds the offset the slowest had. Read from the runtime, not from
 // the query string the harness typed.
 await writeFile(out+'/grid.json',JSON.stringify(await page.evaluate(async()=>{
  const read=()=>{try{return JSON.parse(document.getElementById('futurisma-diagnostics').textContent);}catch{return null;}};
  for(let attempt=0;attempt<600;attempt++){
   const report=read();
   // An EMPTY field is the answer in time attack, not a failure to find one:
   // `modeHasField` is false there, so `fieldSize` reports 1 and no rival is
   // ever placed. Waiting for rivals that the format refuses to spawn would
   // report a timeout where the format is working exactly as specified.
   if(report?.current&&Array.isArray(report.current.rivals)&&report.current.distanceMeters<40)
    return {phase:report.current.phase,fieldSize:report.current.fieldSize,
     hasField:report.current.rivals.length>0,
     playerDistanceMeters:report.current.distanceMeters,
     rivals:report.current.rivals.map(r=>({id:r.id,name:r.name,
      raceDistanceMeters:r.raceDistanceMeters,lateralMeters:r.lateralMeters}))};
   await new Promise(resolve=>requestAnimationFrame(resolve));
  }
  return {error:'no early diagnostics frame before the craft had left the grid'};
 }),null,2));
 // Two rendered frames the review can actually look at: the day blockout on the
 // first lap, and the settled night state after the clock has struck.
 const at=(predicate,...args)=>page.waitForFunction(predicate,{timeout:240000},...args);
 const shot=async(name,predicate,...args)=>{
  try{
   await at(predicate,...args);
   await page.screenshot({path:out+'/'+name+'.png'});
   await writeFile(out+'/'+name+'.json',JSON.stringify(await page.evaluate(()=>JSON.parse(document.getElementById('dreamisland-diagnostics').textContent)),null,2));
  }catch(error){console.log('missed '+name+': '+error.message);}
 };
 if(!calibrate){
  await shot('day-grove',()=>{try{const d=JSON.parse(document.getElementById('dreamisland-diagnostics').textContent);return d.nightBlend===0&&d.progress>.18&&d.progress<.26;}catch{return false;}});
  // Phase D. The REEF window is where the night state reads best, and a three
  // lap race settles the night with most of a lap left to reach it. A two-lap
  // sprint does not: it settles at 0.68 of the race, which is already past the
  // reef, so waiting for that pose would time out rather than shoot. The sprint
  // shoots the settled night wherever the craft is, which is the honest frame
  // for that format rather than a pose it never holds.
  await shot('night-settled',anywhere=>{try{const d=JSON.parse(document.getElementById('dreamisland-diagnostics').textContent);return d.state.nightSettled&&(anywhere||(d.progress>.55&&d.progress<.72));}catch{return false;}},mode==='sprint');
 }
 // The flag timeout has to cover the race being run, not the default one: a
 // nine-lap `?laps=9` race is ~293 s of driving and timed out at the old flat
 // 240 s, which looks exactly like a hung page. 45 s of headroom per lap over
 // the measured Works lap, floored at the original 240 s — see `flagTimeoutMs`,
 // which the launch's protocol timeout is derived from too.
 await page.waitForFunction(()=>{try{return JSON.parse(document.getElementById('futurisma-diagnostics').textContent).current.phase==='finished';}catch{return false;}},
  {timeout:flagTimeoutMs});
 const materialWalk=await page.evaluate(()=>{const rows=[];window.__diScene.traverse(o=>{if(!o.isMesh&&!o.isPoints)return;for(const m of Array.isArray(o.material)?o.material:[o.material])rows.push({object:o.name,material:m.name,type:m.type,toneMapped:m.toneMapped,fog:m.fog,visible:o.visible});});return rows;});
 await writeFile(out+'/material-walk.json',JSON.stringify({script:'scripts/visual/dreamisland/race.mjs',scope:'Live scene at race finish, hidden objects included. Two names are exempt from the fog rule: the shared sky_backdrop and dreamisland_panorama, both ShaderMaterials, for which three defaults fog to false; each mixes the fog colour itself as a haze term.',rows:materialWalk,violations:materialWalk.filter(r=>r.toneMapped===false||(r.fog===false&&!['sky_backdrop','dreamisland_panorama'].includes(r.object)))},null,2));
 const capture=await page.evaluate(()=>({frames:window.__diFrames,draws:window.__diDraws,driving:window.__diDriving,
  diagnostics:JSON.parse(document.getElementById('futurisma-diagnostics').textContent),
  dreamisland:JSON.parse(document.getElementById('dreamisland-diagnostics').textContent),
  atFlag:window.__diFlag,
  // Phase D. The save is MEASURED off the storage key rather than reconstructed:
  // `MAX_PAYLOAD_CHARACTERS` in save-schema.js counts characters of the stored
  // text, so characters is the number the 64 KiB refusal is actually about, and
  // the UTF-8 byte length is reported beside it because that is what the phrase
  // "save size" usually means. Read after the finish, so it includes whatever
  // this race just wrote.
  save:(()=>{try{
   const text=localStorage.getItem('futurisma.save.v1');
   if(text===null)return {present:false,characters:0,bytes:0,ghostSlots:[],records:{}};
   const parsed=JSON.parse(text);
   return {present:true,characters:text.length,bytes:new TextEncoder().encode(text).length,
    limitCharacters:64*1024,
    ghostSlots:Object.entries(parsed.records??{}).flatMap(([course,record])=>
     Object.keys(record.ghosts??{}).map(ghostMode=>({course,mode:ghostMode,
      characters:JSON.stringify(record.ghosts[ghostMode]).length}))),
    records:Object.fromEntries(Object.entries(parsed.records??{}).map(([course,record])=>
     [course,{bests:record.bests??{},bestLapMs:record.bestLapMs??null,laps:record.laps??0,
      ghosts:Object.keys(record.ghosts??{})}]))};
  }catch(error){return {present:false,error:String(error)};}})()}));
 await writeFile(out+'/metrics.json',JSON.stringify(metrics(capture.frames,calibration),null,2));
 await page.screenshot({path:out+'/finish.png'});
 await writeFile(out+'/race.json',JSON.stringify({script:'scripts/visual/dreamisland/race.mjs',url,trialGrip:grip??null,trialBasinWidth:basinWidth??null,inputHashes,calibration,errors,...capture},null,2));
 console.log(JSON.stringify({mode,tier,lapsFlag:laps??null,laps:capture.diagnostics.current.lapTimesMs,
  missedGates:capture.diagnostics.current.missedGates,recoveries:capture.diagnostics.current.recoveries,
  raceMode:capture.diagnostics.current.raceMode,ghostActive:capture.diagnostics.current.ghostActive,
  strike:capture.dreamisland.schedule?.strikeTick??null,
  flagTick:capture.atFlag?.tick??null,struckAtFlag:capture.atFlag?.state.struck??null,
  nightSettledAtFlag:capture.atFlag?.state.nightSettled??null,
  eventsAtFlag:capture.atFlag?.events.map(e=>e.id)??null,
  eventsAfterCoast:capture.dreamisland.events.map(e=>e.id),
  saveCharacters:capture.save?.characters??null,errors:errors.length,out}));
 if(errors.length)throw new Error(errors.join('\n'));
}finally{await browser.close();}
// All evidence is flushed; close intercepted-fetch keep-alive handles.
process.exit(0);
