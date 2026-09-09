import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const arg=(name,fallback)=>process.argv.find(v=>v.startsWith(`--${name}=`))?.slice(name.length+3)??fallback;
const out=arg('out','art/evidence/hud/followup-2-gamepad'),probe=arg('probe-only','false')==='true';mkdirSync(out,{recursive:true});
const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{
 window.__pad=null;
 Object.defineProperty(navigator,'getGamepads',{value:()=>window.__pad?[window.__pad]:[]});
 window.__connect=()=>{window.__pad={index:0,id:'Synthetic standard pad',connected:true,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,touched:false,value:0}))};window.dispatchEvent(new Event('gamepadconnected'));};
 window.__disconnect=()=>{window.__pad=null;window.dispatchEvent(new Event('gamepaddisconnected'));};
});
const press=async index=>{await page.evaluate(i=>Object.assign(window.__pad.buttons[i],{pressed:true,value:1}),index);await page.waitForTimeout(150);await page.evaluate(i=>Object.assign(window.__pad.buttons[i],{pressed:false,value:0}),index);await page.waitForTimeout(150);};
const prompts=()=>page.locator('kbd:visible').evaluateAll(nodes=>nodes.map(n=>({action:n.dataset.prompt,text:n.textContent.trim()})));
try{
 await page.goto(`http://127.0.0.1:${arg('port','5200')}/?map=greenwater`,{waitUntil:'load'});
 await page.waitForFunction(()=>document.body.dataset.phase==='intro',null,{timeout:120000});
 await page.locator('#options-button').focus();
 const keyboard=await prompts();
 await page.evaluate(()=>window.__connect());await page.waitForTimeout(200);
 const gamepad=await prompts();
 await press(0);await page.waitForFunction(()=>document.body.dataset.options==='true');
 const optionsGamepad=await prompts();await page.screenshot({path:out+'/pad-options.png'});
 await page.keyboard.press('Tab');const optionsKeyboard=await prompts();
 await press(1);await page.waitForFunction(()=>document.body.dataset.options==='false');
 await page.evaluate(()=>window.__disconnect());await page.waitForTimeout(200);
 const disconnected=await prompts();
 if(!probe){
  const {INPUT_PROMPTS}=await import('../../../src/game/input-prompt-map.js');
  for(const [device,rows] of [['keyboard',keyboard],['gamepad',gamepad],['gamepad',optionsGamepad],['keyboard',optionsKeyboard],['keyboard',disconnected]])for(const row of rows){assert.ok(row.action,'Every kbd has an action');assert.equal(row.text,INPUT_PROMPTS[row.action][device]);}
  assert.deepEqual(disconnected,keyboard);
 }
 assert.deepEqual(errors,[]);
 writeFileSync(out+'/gamepad.json',JSON.stringify({script:'scripts/visual/hud/gamepad-prompts.mjs',probeOnly:probe,executed:{confirmButton:0,confirmObserved:'Focused SYSTEM OPTIONS activated and terminal opened',backButton:1,backObserved:'Terminal closed and returned to paddock'},keyboard,gamepad,optionsGamepad,optionsKeyboard,disconnected,errors},null,2)+'\n');
 console.log('Observed standard button 0 confirm and button 1 back.'+(probe?' Before prompt mapping.':' All visible prompts switched and restored.'));
}finally{await browser.close();}
