import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const arg=(name,fallback)=>process.argv.find(v=>v.startsWith(`--${name}=`))?.slice(name.length+3)??fallback;
const out=arg('out','art/evidence/hud/followup-4-results');mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']}),records=[],errors=[];
try{
 for(const mode of ['race','sprint','timeattack']){
  const context=await browser.newContext({viewport:{width:1280,height:720}}),page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  // A genuine first time-attack finish supplies the previous record for the second.
  for(let run=0;run<(mode==='timeattack'?2:1);run++){
   const label=mode==='timeattack'&&run===0?'timeattack-record-run':mode;
   const started=Date.now();
   await page.goto(`http://127.0.0.1:${arg('port','5200')}/?map=ascension&demo=1&mode=${mode}&diagnostics=1&seed=3868938316&music=0`,{waitUntil:'load'});
   await page.waitForFunction(()=>{try{return JSON.parse(document.getElementById('futurisma-diagnostics').textContent).current.phase==='finished';}catch{return false;}},null,{timeout:300000});
   const state=await page.evaluate(()=>({phase:document.body.dataset.phase,heading:document.getElementById('result-time').textContent,detail:document.getElementById('result-detail').textContent,mode:document.getElementById('result-screen').dataset.mode,previousBestLapMs:document.getElementById('result-screen').dataset.previousBestLapMs,newBestLap:document.getElementById('result-screen').dataset.newBestLap,badgeVisible:!document.getElementById('result-best').hidden,circuitSelectVisible:document.getElementById('circuit-select-button').getClientRects().length>0,diagnostics:JSON.parse(document.getElementById('futurisma-diagnostics').textContent).current}));
   assert.equal(state.phase,'result');assert.equal(state.mode,mode);assert.equal(state.badgeVisible,state.newBestLap==='true');assert.ok(state.circuitSelectVisible);assert.ok(state.diagnostics.lapTimesMs.length>0);
   if(mode==='timeattack'){assert.match(state.heading,/^\d+:\d+\.\d+$/);assert.match(state.detail,/PREVIOUS BEST/);if(run===1)assert.equal(Number(state.previousBestLapMs),Math.min(...records.find(r=>r.label==='timeattack-record-run').diagnostics.lapTimesMs));}
   else assert.match(state.heading,/^P\d/);
   await page.screenshot({path:out+'/'+label+'.png'});records.push({label,wallMs:Date.now()-started,...state});console.log(label+': real finish, '+state.heading);
  }
  await page.locator('#circuit-select-button').click();await page.waitForFunction(()=>document.body.dataset.phase==='intro',null,{timeout:120000});
  assert.equal(new URL(page.url()).searchParams.has('demo'),false);
  await context.close();
 }
 assert.deepEqual(errors,[]);
 writeFileSync(out+'/finishes.json',JSON.stringify({script:'scripts/visual/hud/result-finishes.mjs',scope:'Four actual finishes: one field, one sprint, and two time attacks; first time attack supplies a real previous record. No race state is injected. Circuit Select returned to the paddock after every format.',records,errors},null,2)+'\n');
}finally{await browser.close();}
