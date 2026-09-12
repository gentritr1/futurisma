import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const arg=(name,fallback)=>process.argv.find(v=>v.startsWith(`--${name}=`))?.slice(name.length+3)??fallback;
const out=arg('out','art/evidence/hud/followup-3-menus');mkdirSync(out,{recursive:true});
const viewport={width:Number(arg('width','1280')),height:Number(arg('height','720'))};
const browser=await chromium.launch(),page=await browser.newPage({viewport}),records=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));
/*
  `controlsRows` is the whole reason this script gained an assertion.
  It asserted only that `#controls-screen` OPENED, and a screen that opens with
  `display:none` on its only content passes that -- which is how a CONTROLS
  view that was empty at 1280x720 shipped inside accepted evidence. Counting
  LAID-OUT rows (`getBoundingClientRect().height > 0`) is the check the old one
  should have been: it fails on `display:none`, on a zero-height parent and on
  an off-screen panel, none of which `hidden === false` can see.

  >= 8 rather than 10: `[data-polarity-control]` and `[data-power-control]` are
  hidden on a circuit with neither, which Greenwater is.
*/
const readState=()=>({phase:document.body.dataset.phase,controls:!document.getElementById('controls-screen').hidden,options:!document.getElementById('options-screen').hidden,pause:!document.getElementById('pause-panel').hidden,returnTo:document.getElementById('options-screen').dataset.returnTo,time:document.getElementById('time-value').textContent,controlsRows:[...document.querySelectorAll('#controls-screen .controls-list > div')].filter(row=>row.getBoundingClientRect().height>0).length,controlsRowsTotal:document.querySelectorAll('#controls-screen .controls-list > div').length,backBottom:Math.round(document.getElementById('controls-close').getBoundingClientRect().bottom),panelBottom:Math.round(document.querySelector('#controls-screen .options-panel').getBoundingClientRect().bottom)});
const record=async(name,expected,minControlsRows)=>{
 await page.waitForFunction(expected=>{
  const state={phase:document.body.dataset.phase,controls:!document.getElementById('controls-screen').hidden,options:!document.getElementById('options-screen').hidden,pause:!document.getElementById('pause-panel').hidden,returnTo:document.getElementById('options-screen').dataset.returnTo};
  return Object.entries(expected).every(([key,value])=>state[key]===value);
 },expected,{timeout:10000});
 const state=await page.evaluate(readState);
 for(const [key,value] of Object.entries(expected))assert.equal(state[key],value,name+':'+key);
 if(minControlsRows!==undefined){
  assert.ok(state.controlsRows>=minControlsRows,`${name}: ${state.controlsRows} of ${state.controlsRowsTotal} control rows are laid out; at least ${minControlsRows} must be. An open screen with no visible rows is the bug this counts.`);
  assert.ok(state.backBottom<=viewport.height,`${name}: the BACK button's bottom is ${state.backBottom}, past the ${viewport.height}px viewport.`);
 }
 records.push({name,...state});await page.screenshot({path:out+'/'+name+'.png'});return state;
};
try{
 await page.goto(`http://127.0.0.1:${arg('port','5200')}/?map=greenwater&demo=1&diagnostics&start=manual`,{waitUntil:'load'});
 await page.waitForFunction(()=>document.body.dataset.phase==='intro',null,{timeout:120000});
 await page.keyboard.press('c');await record('controls',{phase:'intro',controls:true,options:false},8);
 await page.keyboard.press('o');await record('controls-options',{phase:'intro',controls:false,options:true,returnTo:'controls'});
 await page.keyboard.press('Escape');await record('back-to-controls',{phase:'intro',controls:true,options:false},8);
 await page.keyboard.press('Escape');await record('back-to-paddock',{phase:'intro',controls:false,options:false});
 await page.locator('#start-button').focus();await page.keyboard.press('Enter');
 await page.waitForFunction(()=>document.body.dataset.phase==='race'&&document.getElementById('time-value').textContent!=='00:00.000',null,{timeout:120000});
 await page.keyboard.press('o');await page.keyboard.press('c');await record('race-menu-keys',{phase:'race',controls:false,options:false});
 await page.keyboard.press('Escape');const paused=await record('paused',{phase:'paused',pause:true});
 await page.keyboard.press('o');await record('pause-options',{phase:'paused',options:true,returnTo:'paused'});
 await page.keyboard.press('Escape');const returned=await record('back-to-pause',{phase:'paused',pause:true,options:false});
 assert.equal(returned.time,paused.time,'Options must not advance a paused race');assert.deepEqual(errors,[]);
 writeFileSync(out+'/paths.json',JSON.stringify({script:'scripts/visual/hud/menu-paths.mjs',viewport,records,errors},null,2)+'\n');console.log(`Eight keyboard-path observations PASS at ${viewport.width}x${viewport.height}; CONTROLS laid out ${records.find(r=>r.name==='controls').controlsRows} rows with BACK inside the viewport; paused clock unchanged.`);
}finally{await browser.close();}
