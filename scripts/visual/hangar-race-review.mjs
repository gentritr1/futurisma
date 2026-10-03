import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchReviewBrowser} from './tideline-v4/browser.mjs';
import {instrument} from './dreamisland/instrument.mjs';
const out='art/evidence/hangar-road/race';
await mkdir(out,{recursive:true});
const browser=await launchReviewBrowser({protocolTimeout:300000});
try {
 const page=await browser.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(String(error)));
 await instrument(page);
 await page.evaluateOnNewDocument(()=>{
  window.__diCaptureFrame=()=>{
   const text=document.getElementById('futurisma-diagnostics')?.textContent;
   if(text)window.__diFrames.at(-1).phase=JSON.parse(text).current?.phase;
  };
 });
 await page.goto('http://127.0.0.1:5201/?map=greenwater&seed=714&tier=works&mode=race&demo=1&headless=1&diagnostics=1&start=manual&quality=high&music=0&voice=0',{waitUntil:'networkidle0'});
 await page.waitForSelector('#start-button',{visible:true});
 await page.click('#start-button');
 await page.waitForFunction(()=>{
  const d=JSON.parse(document.getElementById('futurisma-diagnostics').textContent).current;
  // Diagnostics refresh once per second; a narrow 20 m window can be skipped
  // entirely at race speed. Static paired captures cover the exact pose.
  return d.phase==='running' && d.distanceMeters>=640 && d.distanceMeters<=740;
 },{timeout:60000});
 console.log('Greenwater running through Hangar Six');
 await page.screenshot({path:out+'/live-approach.png'});
 await page.waitForFunction(()=>JSON.parse(document.getElementById('futurisma-diagnostics').textContent).current.phase==='finished',{timeout:240000});
 const data=await page.evaluate(()=>({diagnostics:JSON.parse(document.getElementById('futurisma-diagnostics').textContent).current,frames:window.__diFrames.filter(f=>f.phase==='running')}));
 const metrics={instrument:'scripts/visual/hangar-race-review.mjs',errors,lapTimesMs:data.diagnostics.lapTimesMs,missedGates:data.diagnostics.missedGates,recoveries:data.diagnostics.recoveries,
  peakMainCalls:Math.max(...data.frames.map(f=>f.mainCalls)),peakShadowCalls:Math.max(...data.frames.map(f=>f.shadowCalls)),peakCombinedCalls:Math.max(...data.frames.map(f=>f.mainCalls+f.shadowCalls)),
  peakMainTriangles:Math.max(...data.frames.map(f=>f.mainTriangles)),peakCombinedTriangles:Math.max(...data.frames.map(f=>f.mainTriangles+f.shadowTriangles)),
  note:'Integration and draw measurement. Code validators ran concurrently; no isolated performance percentile is claimed.'};
 await writeFile(out+'/race.json',JSON.stringify({metrics,diagnostics:data.diagnostics},null,2)+'\n');
 await page.screenshot({path:out+'/finish.png'});
 console.log(JSON.stringify(metrics));
 assert.equal(errors.length,0);assert.equal(metrics.lapTimesMs.length,5);assert.equal(metrics.missedGates,0);assert.equal(metrics.recoveries,0);
 assert.equal(data.diagnostics.environmentError,null);assert.deepEqual(data.diagnostics.environmentContractDrift,[]);
} finally {await browser.close();}
