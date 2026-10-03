import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';

const output='art/evidence/circuit-polish-final';await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
const errors=[],report={};
try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:5218/?map=greenwater&motion=reduce&music=0&voice=0');
  await page.waitForSelector('.launch-tour');
  assert.equal(await page.locator('.launch-tour strong').textContent(),'CIRCUIT TOUR · 0 / 9');
  report.settlement=await page.evaluate(async()=>{
    const {save}=await import('/src/game/persistence.ts');
    const {settleRace}=await import('/src/game/garage-economy.js');
    const facts={track:'greenwater',mode:'race',tier:'works',position:2,racerCount:4,laps:5,newBestLap:false,topSpeedKph:200,nearMisses:0,cleanGateChain:0,slipstreamSeconds:0,driftCashes:0,demo:false};
    const demo=settleRace(save.garage,{...facts,demo:true});
    const first=settleRace(save.garage,facts),repeat=settleRace(first.garage,facts);
    save.setGarage(repeat.garage);
    return {demoCircuits:demo.garage.circuits,firstBonus:first.lines.find(line=>line.code==='circuit')?.amount,repeatBonus:repeat.lines.some(line=>line.code==='circuit')};
  });
  assert.deepEqual(report.settlement,{demoCircuits:[],firstBonus:300,repeatBonus:false});
  await page.reload();await page.waitForSelector('.launch-tour');
  assert.equal(await page.locator('.launch-tour strong').textContent(),'CIRCUIT TOUR · 1 / 9');
  assert.match(await page.locator('.launch-tour p').textContent(),/^Circuit logged/);
  assert.equal(await page.locator('.launch-tour__marks [data-complete="true"]').count(),1);
  assert.equal(await page.getByRole('listitem',{name:'GREENWATER STRIP: completed, selected',exact:true}).count(),1);
  assert.equal(await page.getByRole('listitem',{name:/not yet completed/}).count(),8);
  await page.locator('#track-select [data-value="nightshift"]').click();
  assert.match(await page.locator('.launch-tour p').textContent(),/^Finish here/);
  await page.locator('#track-select [data-value="greenwater"]').click();
  for(const [width,height] of [[1440,900],[1280,720],[390,844],[390,680],[844,390]]){
    await page.setViewportSize({width,height});
    await page.locator('.launch-tour').evaluate(node=>node.scrollIntoView({block:'nearest'}));
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await page.waitForTimeout(150);
    const bounds=await page.evaluate(()=>{
      const guide=document.querySelector('.launch-guide'),tour=document.querySelector('.launch-tour');
      const rect=tour.getBoundingClientRect(),clip=guide.getBoundingClientRect(),launch=document.querySelector('#start-button').getBoundingClientRect();
      return {overflow:document.documentElement.scrollWidth>innerWidth,ownOverflow:tour.scrollWidth>tour.clientWidth,
        accessible:rect.top>=clip.top-1&&rect.bottom<=clip.bottom+1,launchVisible:launch.top>=0&&launch.bottom<=innerHeight,clipHeight:clip.height};
    });
    assert.ok(!bounds.overflow&&!bounds.ownOverflow&&bounds.accessible&&bounds.launchVisible,JSON.stringify({width,height,bounds}));
    await page.screenshot({path:`${output}/tour-${width}x${height}.png`});
  }
  report.errors=errors;assert.deepEqual(errors,[]);
}finally{await browser.close();await writeFile(`${output}/tour.json`,JSON.stringify(report,null,2));}
console.log('Circuit tour PASS: real settlement, demo excluded, first-finish reward only once, persisted progress, map switching and five viewport sizes.');
