import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchReviewBrowser} from './tideline-v4/browser.mjs';
const out='art/evidence/grand-tour-preview';
await mkdir(out,{recursive:true});
const browser=await launchReviewBrowser();
const report={instrument:'scripts/visual/grand-tour-controls-review.mjs',widths:[],errors:[]};
try {
  const page=await browser.newPage();
  page.on('pageerror',error=>report.errors.push(String(error)));
  await page.goto('http://127.0.0.1:5201/experiments/grand-tour/',{waitUntil:'networkidle0'});
  for(const width of [320,768,1280]) {
    await page.setViewport({width,height:720,deviceScaleFactor:1});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
    assert.equal(overflow,0);report.widths.push({width,overflow});
  }
  report.contrast=await page.evaluate(()=>{
    const style=getComputedStyle(document.documentElement);
    const context=document.createElement('canvas').getContext('2d');
    const luminance=token=>{
      context.fillStyle=style.getPropertyValue(token).trim();context.fillRect(0,0,1,1);
      const channels=[...context.getImageData(0,0,1,1).data].slice(0,3).map(v=>{const s=v/255;return s<=.04045?s/12.92:((s+.055)/1.055)**2.4;});
      return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;
    };
    return [['--ink','--void'],['--muted','--void'],['--void','--acid']].map(([text,background])=>{
      const a=luminance(text),b=luminance(background);
      return {text,background,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
    });
  });
  assert.ok(report.contrast.every(pair=>pair.ratio>=4.5));
  await page.keyboard.press('Tab');await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'launch');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#race-shell:not([hidden])');
  await page.waitForFunction(()=>document.querySelector('iframe').contentDocument?.getElementById('start-button')?.disabled===false,{timeout:60000});
  const gameFrame=page.frames().find(frame=>frame.url().includes('race.html'));
  assert.ok(gameFrame);
  assert.equal(new URL(gameFrame.url()).searchParams.has('demo'),false);
  await gameFrame.waitForSelector('#start-button',{visible:true,timeout:60000});
  await page.screenshot({path:out+'/race-paddock.png'});
  await gameFrame.click('#start-button');
  await page.keyboard.down('w');
  await new Promise(resolve=>setTimeout(resolve,11000));
  await page.keyboard.up('w');
  report.humanEntry={phase:await gameFrame.evaluate(()=>document.body.dataset.phase),autopilot:false};
  assert.equal(report.humanEntry.phase,'race');
  await page.screenshot({path:out+'/in-game.png'});
  await page.click('#leave');
  assert.equal(await page.$eval('#leave-dialog',node=>node.open),true);
  await page.click('#stay');
  assert.equal(await page.$eval('#race-shell',node=>node.hidden),false);
  await page.click('#leave');await page.click('#confirm-leave');
  assert.equal(await page.$eval('#race-shell',node=>node.hidden),true);
  assert.equal(await page.$eval('#round-count',node=>node.textContent),'BEFORE ROUND 01');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'launch');
  assert.equal(report.errors.length,0);
  report.keyboardEntry='PASS';report.leaveWithoutPoints='PASS';report.focusRestore='PASS';
} finally {await writeFile(out+'/controls.json',JSON.stringify(report,null,2)+'\n');await browser.close();}
console.log(JSON.stringify(report));
