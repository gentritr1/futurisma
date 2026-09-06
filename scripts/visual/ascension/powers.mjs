import {mkdir,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {launchReviewBrowser} from '../tideline-v4/browser.mjs';
const out='art/evidence/ascension-v1/phase-c-revision/carry-overs';await mkdir(out+'/chain-frames',{recursive:true});
const browser=await launchReviewBrowser(),errors=[];
try{
 let page=await browser.newPage();page.on('pageerror',e=>{errors.push(String(e));console.error(e);});
 await page.goto('http://127.0.0.1:5200/?map=ascension&seed=3868938316&tier=works&demo=1&headless=1&diagnostics=1&start=manual&quality=high&music=0&demoTrench=1&demoChain=1',{waitUntil:'networkidle0',timeout:60000});await page.waitForSelector('#start-button',{visible:true});await page.click('#start-button');
 const state=()=>page.$eval('#ascension-diagnostics',e=>JSON.parse(e.textContent));
 await page.waitForFunction(()=>{try{const d=JSON.parse(document.getElementById('ascension-diagnostics').textContent);return d.progress>.045&&d.powers.heldPower==='surge';}catch{return false;}},{timeout:60000});
 const before=await state();await page.keyboard.press('KeyE');await delay(100);const after=await state();await page.screenshot({path:out+'/player-E-live.png'});
 // Real keyboard input relinquishes demo steering; use a fresh demo for the chain.
 const url=page.url();await page.close();page=await browser.newPage();page.on('pageerror',e=>errors.push(String(e)));await page.goto(url,{waitUntil:'networkidle0'});await page.waitForSelector('#start-button',{visible:true});await page.click('#start-button');
 await page.waitForFunction(()=>{try{const d=JSON.parse(document.getElementById('ascension-diagnostics').textContent);return d.progress>.54&&d.progress<.555;}catch{return false;}},{timeout:30000}).catch(async e=>{console.error(await state());await page.screenshot({path:out+'/failed-chain-approach.png'});throw e;});
 const records=[],started=Date.now();
 while(Date.now()-started<4000){const row=await state(),file=String(records.length).padStart(3,'0')+'.png';await page.screenshot({path:out+'/chain-frames/'+file});records.push({file,wallMs:Date.now()-started,...row});await delay(Math.max(0,100-(Date.now()-started-records.length*100)));}
 const report={script:'scripts/visual/ascension/powers.mjs',scope:'Live demo flag supplies one Shield and a follow-up Surge; production field contact and CHAIN command award the reward. E is a real keyboard event before the launch strip.',playerE:{before,after,pass:after.powers.powersUsed>before.powers.powersUsed},chain:records.find(r=>r.chains.length)?.chains??[],capture:{windowMs:Date.now()-started,expectedRateHz:10,expectedSamples:(Date.now()-started)/100,observedSamples:records.length,residual:records.length-(Date.now()-started)/100},records,errors};
 await writeFile(out+'/powers.json',JSON.stringify(report,null,2));console.log({playerE:report.playerE.pass,chain:report.chain,capture:report.capture,errors});
 if(!report.playerE.pass||!report.chain.length||errors.length)throw Error('Live power evidence failed');
}finally{await browser.close();}
