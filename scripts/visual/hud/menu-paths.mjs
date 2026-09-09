import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const arg=(name,fallback)=>process.argv.find(v=>v.startsWith(`--${name}=`))?.slice(name.length+3)??fallback;
const out=arg('out','art/evidence/hud/followup-3-menus');mkdirSync(out,{recursive:true});
const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1280,height:720}}),records=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));
const record=async(name,expected)=>{
 const state=await page.evaluate(()=>({phase:document.body.dataset.phase,controls:!document.getElementById('controls-screen').hidden,options:!document.getElementById('options-screen').hidden,pause:!document.getElementById('pause-panel').hidden,returnTo:document.getElementById('options-screen').dataset.returnTo,time:document.getElementById('time-value').textContent}));
 for(const [key,value] of Object.entries(expected))assert.equal(state[key],value,name+':'+key);
 records.push({name,...state});await page.screenshot({path:out+'/'+name+'.png'});return state;
};
try{
 await page.goto(`http://127.0.0.1:${arg('port','5200')}/?map=greenwater&demo=1&diagnostics&start=manual`,{waitUntil:'load'});
 await page.waitForFunction(()=>document.body.dataset.phase==='intro',null,{timeout:120000});
 await page.keyboard.press('c');await record('controls',{phase:'intro',controls:true,options:false});
 await page.keyboard.press('o');await record('controls-options',{phase:'intro',controls:false,options:true,returnTo:'controls'});
 await page.keyboard.press('Escape');await record('back-to-controls',{phase:'intro',controls:true,options:false});
 await page.keyboard.press('Escape');await record('back-to-paddock',{phase:'intro',controls:false,options:false});
 await page.locator('#start-button').focus();await page.keyboard.press('Enter');
 await page.waitForFunction(()=>document.body.dataset.phase==='race'&&document.getElementById('time-value').textContent!=='00:00.000',null,{timeout:120000});
 await page.keyboard.press('o');await page.keyboard.press('c');await record('race-menu-keys',{phase:'race',controls:false,options:false});
 await page.keyboard.press('Escape');const paused=await record('paused',{phase:'paused',pause:true});
 await page.keyboard.press('o');await record('pause-options',{phase:'paused',options:true,returnTo:'paused'});
 await page.keyboard.press('Escape');const returned=await record('back-to-pause',{phase:'paused',pause:true,options:false});
 assert.equal(returned.time,paused.time,'Options must not advance a paused race');assert.deepEqual(errors,[]);
 writeFileSync(out+'/paths.json',JSON.stringify({script:'scripts/visual/hud/menu-paths.mjs',records,errors},null,2)+'\n');console.log('Eight keyboard-path observations PASS; paused clock unchanged.');
}finally{await browser.close();}
