import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {launchReviewBrowser} from './tideline-v4/browser.mjs';
import {bestReachablePosition,cupTarget,formatLap} from '../../experiments/grand-tour/cup.js';

const out='art/evidence/grand-tour-preview/fable-pass';
await mkdir(out,{recursive:true});
const recorded=JSON.parse(await readFile('art/evidence/grand-tour-preview/review.json','utf8')).races;
const report={instrument:'scripts/visual/grand-tour-fable-review.mjs',checks:[],errors:[]};
assert.equal(bestReachablePosition(recorded.slice(0,1)),1);
assert.equal(bestReachablePosition(recorded.slice(0,2)),2);
assert.match(cupTarget(recorded.slice(0,2)).detail,/NIGHTFORM 24 is 1 point ahead/);
assert.match(cupTarget(recorded).detail,/Final round won/);
assert.equal(formatLap(59999.8),'1:00.000');
const fixture=positions=>({standings:positions.map((position,index)=>({position,name:['TOTEM','A','B','C'][index],team:'TEST',player:index===0}))});
assert.equal(bestReachablePosition([fixture([4,1,2,3]),fixture([4,3,2,1])]),4);
assert.match(cupTarget([fixture([4,1,2,3]),fixture([4,3,2,1])]).detail,/final-round win/);
assert.equal(bestReachablePosition([fixture([2,1,3,4]),fixture([1,3,2,4]),fixture([3,2,1,4])]),3);
report.checks.push('Reachable title, unreachable title, locked P4, final tie and lap rollover PASS');

const browser=await launchReviewBrowser({protocolTimeout:300000});
async function screenshot(page,name){
  await page.waitForFunction(()=>[...document.images].every(image=>image.complete && image.naturalWidth>0));
  await new Promise(resolve=>setTimeout(resolve,350));
  await page.screenshot({path:`${out}/${name}.png`,fullPage:true});
}
async function injectFinish(page,result){
  await page.evaluate(result=>{
    const frame=document.getElementById('race');
    const token=new URL(frame.src).searchParams.get('tourToken');
    window.dispatchEvent(new MessageEvent('message',{origin:location.origin,source:frame.contentWindow,data:{type:'tour-finish',token,result}}));
  },result);
}
try {
  const page=await browser.newPage();
  page.on('pageerror',error=>report.errors.push(String(error)));
  let mockRace=true;
  await page.setRequestInterception(true);
  page.on('request',request=>mockRace && request.url().includes('/grand-tour/race.html')
    ? request.respond({status:200,contentType:'text/html',body:'<!doctype html><html><body>Recorded-classification fixture</body></html>'})
    : request.continue());
  const url='http://127.0.0.1:5201/experiments/grand-tour/';
  await page.goto(url,{waitUntil:'networkidle0'});
  await screenshot(page,'opening');
  for(const result of recorded){
    await page.click('#launch');
    await injectFinish(page,result);
    assert.equal(await page.$eval('#race-shell',node=>node.hidden),false);
    assert.equal(await page.$eval('#race',node=>node.inert),true);
    assert.equal(await page.evaluate(()=>document.activeElement.id),'continue');
    await injectFinish(page,result);
    await page.keyboard.press('Enter');
    assert.equal(await page.$eval('#race-shell',node=>node.hidden),true);
    await screenshot(page,`${result.map}-recorded-result`);
    if(result.map==='nightshift'){
      assert.match(await page.$eval('#verdict',node=>node.textContent),/Best available: P2/);
      assert.match(await page.$eval('#verdict-detail',node=>node.textContent),/NIGHTFORM 24/);
      for(const width of [320,390,768]){
        await page.setViewport({width,height:844,deviceScaleFactor:1});
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      }
      await screenshot(page,'target-tablet');
      await page.setViewport({width:390,height:844,deviceScaleFactor:1});
      await screenshot(page,'target-mobile');
      await page.setViewport({width:1280,height:720,deviceScaleFactor:1});
    }
  }
  assert.equal(await page.$eval('#round-count',node=>node.textContent),'3 / 3 ROUNDS LOGGED');
  report.checks.push('Held result, duplicate while held, keyboard continuation and recorded three-round sequence PASS');
  await page.click('#launch');
  await page.click('#sample');await page.click('#sample');await page.click('#sample');
  assert.match(await page.$eval('#verdict',node=>node.textContent),/cup is yours/);
  assert.equal(await page.$eval('#launch',node=>node.disabled),true);
  report.checks.push('Sample sequence remains separate PASS');

  // Seed only the already measured opening classification, then run a fresh
  // normal-length Night Shift race to exercise the real retained result screen.
  await page.goto(url+'?autopilot=1',{waitUntil:'networkidle0'});
  await page.click('#launch');await injectFinish(page,recorded[0]);await page.click('#continue');
  mockRace=false;
  await page.click('#launch');
  console.log('Running fresh Night Shift race');
  await page.waitForSelector('#continue:not([hidden])',{timeout:240000});
  const gameFrame=page.frames().find(frame=>frame.url().includes('race.html'));
  await gameFrame.waitForSelector('#result-screen',{visible:true,timeout:5000});
  assert.equal(await gameFrame.evaluate(async()=>{
    const {FuturismaGame}=await import('/src/game/game.ts');
    return FuturismaGame.prototype.canStart.call({});
  }),false,'A held finish cannot be restarted by the gamepad start gate');
  await new Promise(resolve=>setTimeout(resolve,1000));
  await page.screenshot({path:out+'/held-real-finish.png'});
  report.liveResult=await gameFrame.evaluate(()=>JSON.parse(document.getElementById('futurisma-diagnostics').textContent).current);
  await page.keyboard.press('Enter');
  assert.equal(await page.$eval('#race-shell',node=>node.hidden),true);
  assert.equal(await page.$eval('#round-count',node=>node.textContent),'2 / 3 ROUNDS LOGGED');
  await screenshot(page,'after-real-finish');
  report.checks.push('Real Night Shift finish held, replay start blocked and keyboard continuation PASS');
  assert.equal(report.errors.length,0);
} finally {
  await writeFile(out+'/review.json',JSON.stringify(report,null,2)+'\n');
  await browser.close();
}
console.log('Fable refinement review PASS');
