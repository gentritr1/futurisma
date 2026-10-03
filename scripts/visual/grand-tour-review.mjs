import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchReviewBrowser} from './tideline-v4/browser.mjs';
import {validateResult,standingsFor} from '../../experiments/grand-tour/cup.js';
const out='art/evidence/grand-tour-preview';
await mkdir(out,{recursive:true});
const fixture=positions=>({racerCount:4,standings:positions.map((position,index)=>({position,name:['TOTEM','A','B','C'][index],team:'TEST',player:index===0}))});
const a=fixture([2,1,3,4]),b=fixture([1,2,3,4]),c=fixture([1,2,4,3]);
assert.equal(standingsFor([a,b]).filter(row=>row.cupPosition===1).length,2,'Interim tied leaders share a rank');
assert.equal(standingsFor([a,b,c])[0].name,'TOTEM','Most points wins');
assert.equal(standingsFor([fixture([2,1,3,4]),fixture([1,3,2,4]),fixture([3,2,1,4])])[0].name,'B','Final tie uses final race order');
assert.equal(standingsFor([a,b,c])[0].points,11);
assert.throws(()=>validateResult({...a,racerCount:3}));
assert.throws(()=>validateResult(fixture([1,1,3,4])));
assert.throws(()=>validateResult({...a,standings:a.standings.map(row=>({...row,name:row.name+' changed'}))},[a]));
validateResult(b,[a]);
const browser=await launchReviewBrowser({protocolTimeout:300000});
const report={instrument:'scripts/visual/grand-tour-review.mjs',rules:'PASS',ui:{},races:[],errors:[]};
try{
  const page=await browser.newPage();
  page.on('pageerror',error=>report.errors.push(String(error)));
  await page.goto('http://127.0.0.1:5201/experiments/grand-tour/',{waitUntil:'networkidle0'});
  await page.screenshot({path:out+'/cup-desktop.png',fullPage:true});
  await page.click('#sample');
  assert.match(await page.$eval('#sample-label',node=>node.textContent),/SAMPLE/);
  assert.equal(await page.$eval('#launch',node=>node.disabled),true,'Sample results cannot enter a live cup');
  await page.screenshot({path:out+'/sample-result.png',fullPage:true});
  await page.click('#sample');await page.click('#sample');
  assert.match(await page.$eval('#verdict',node=>node.textContent),/cup is yours/);
  await page.screenshot({path:out+'/sample-complete.png',fullPage:true});
  await page.click('#reset');
  await page.setViewport({width:390,height:844,deviceScaleFactor:1});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Mobile must not overflow horizontally');
  await page.screenshot({path:out+'/cup-mobile.png',fullPage:true});
  report.ui={sampleSequence:'PASS',sampleLiveSeparation:'PASS',mobileOverflow:'PASS'};
  await page.setViewport({width:1280,height:720,deviceScaleFactor:1});
  await page.goto('http://127.0.0.1:5201/experiments/grand-tour/?autopilot=1',{waitUntil:'networkidle0'});
  await page.evaluate(()=>{
    window.__tourMessages=[];
    window.addEventListener('message',event=>{
      if(event.source===document.getElementById('race').contentWindow && event.data?.type==='tour-finish') window.__tourMessages.push(event.data);
    });
  });
  for(const [index,map] of ['greenwater','nightshift','dreamisland'].entries()){
    console.log('Starting',map);
    await page.click('#launch');
    if(index===0){
      await page.waitForFunction(()=>document.querySelector('iframe').contentDocument?.body.dataset.phase==='race',{timeout:60000});
      await new Promise(resolve=>setTimeout(resolve,8000));
      await page.screenshot({path:out+'/autopilot-in-game.png'});
    }
    await page.waitForFunction(expected=>window.__tourMessages.length===expected,{timeout:300000},index+1);
    await page.waitForSelector('#continue:not([hidden])');
    await page.click('#continue');
    await page.waitForFunction(()=>document.getElementById('race-shell').hidden,{timeout:5000});
    assert.equal(await page.$eval('#feedback',node=>node.textContent),'');
    const result=await page.evaluate(()=>window.__tourMessages.at(-1).result);
    report.races.push({map,...result});
    await page.waitForFunction(()=>[...document.images].every(image=>image.complete && image.naturalWidth>0));
    await new Promise(resolve=>setTimeout(resolve,250));
    await page.screenshot({path:`${out}/${map}-cup-result.png`,fullPage:true});
    // A late duplicate from the removed race must never add another round.
    const before=await page.$eval('#round-count',node=>node.textContent);
    await page.evaluate(()=>window.postMessage(window.__tourMessages.at(-1),location.origin));
    assert.equal(await page.$eval('#round-count',node=>node.textContent),before);
    console.log(JSON.stringify({map,laps:result.totalLaps,position:result.position,elapsedMs:result.elapsedMs,standings:result.standings}));
    await writeFile(out+'/review.json',JSON.stringify(report,null,2)+'\n');
  }
  assert.equal(await page.$eval('#round-label',node=>node.textContent),'CUP COMPLETE');
  assert.equal(report.errors.length,0);
  report.ui.realCupSequence='PASS';report.ui.duplicateFinish='PASS';
  await page.click('#launch');
  assert.equal(await page.$eval('#round-count',node=>node.textContent),'BEFORE ROUND 01');
  report.ui.newCup='PASS';
}finally{await writeFile(out+'/review.json',JSON.stringify(report,null,2)+'\n');await browser.close();}
console.log('Grand Tour review PASS');
