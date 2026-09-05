import {existsSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {instrument,metrics} from './instrument.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchReviewBrowser} from '../tideline-v4/browser.mjs';
const branch=process.argv.includes('--trench'),reduced=process.argv.includes('--reduced');
const tier=process.argv.find(a=>a.startsWith('--tier='))?.slice(7)??'works',seed=process.argv.find(a=>a.startsWith('--seed='))?.slice(7)??'3868938316';
const out='art/evidence/ascension-v1/phase-a/'+(branch?'trench':'deluge')+(reduced?'-reduced':'')+(process.argv.includes('--unbatched')?'-unbatched':'')+(process.argv.includes('--calibrate')?'-calibration':'')+(tier!=='works'||seed!=='3868938316'?'-'+tier+'-'+seed:'');await mkdir(out,{recursive:true});
while(existsSync('/tmp/ascension-review-pause'))await delay(250);
const inputFiles=['src/game/ascension-course.ts','src/game/ascension-runtime.ts','src/game/ascension-schedule.js','src/game/ascension-environment.ts','src/game/ascension-flat-batch.ts','src/game/data/ascension/route.json','src/game/data/ascension/schedule.json','src/game/data/ascension/rival-pace.json','public/assets/ascension/blockout.glb'];
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
 await page.waitForFunction(()=>{try{return JSON.parse(document.getElementById('futurisma-diagnostics').textContent).current.phase==='finished';}catch{return false;}},{timeout:180000});
 const capture=await page.evaluate(()=>({frames:window.__ascFrames,draws:window.__ascDraws,diagnostics:JSON.parse(document.getElementById('futurisma-diagnostics').textContent),ascension:JSON.parse(document.getElementById('ascension-diagnostics').textContent)}));
 await writeFile(out+'/metrics.json',JSON.stringify(metrics(capture.frames,calibration),null,2));
 await page.screenshot({path:out+'/finish.png'});await writeFile(out+'/race.json',JSON.stringify({script:'scripts/visual/ascension/race.mjs',url,inputHashes,calibration,errors,...capture},null,2));console.log(JSON.stringify({laps:capture.diagnostics.current.lapTimesMs,missedGates:capture.diagnostics.current.missedGates,recoveries:capture.diagnostics.current.recoveries,errors}));
}finally{await browser.close();}
