// Presentation replay of the measured classifications, not another race run.
// Give the compositor time to settle after removing the WebGL iframe.
import {readFile,writeFile} from 'node:fs/promises';
import {launchReviewBrowser} from './tideline-v4/browser.mjs';
const out='art/evidence/grand-tour-preview';
const review=JSON.parse(await readFile(out+'/review.json','utf8'));
const browser=await launchReviewBrowser();
try{
  const page=await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request',request=>request.url().includes('/grand-tour/race.html')
    ? request.respond({status:200,contentType:'text/html',body:'<!doctype html><html><body>Recorded-classification replay</body></html>'})
    : request.continue());
  await page.goto('http://127.0.0.1:5201/experiments/grand-tour/',{waitUntil:'networkidle0'});
  for(const result of review.races){
    await page.click('#launch');
    await page.evaluate(result=>{
      const frame=document.getElementById('race');
      const token=new URL(frame.src).searchParams.get('tourToken');
      window.dispatchEvent(new MessageEvent('message',{origin:location.origin,source:frame.contentWindow,data:{type:'tour-finish',token,result}}));
    },result);
    await page.click('#continue');
    await page.waitForFunction(()=>document.getElementById('race-shell').hidden && [...document.images].every(image=>image.complete && image.naturalWidth>0));
    await new Promise(resolve=>setTimeout(resolve,350));
    await page.screenshot({path:`${out}/${result.map}-cup-result-settled.png`,fullPage:true});
  }
  await writeFile(out+'/capture-provenance.json',JSON.stringify({instrument:'scripts/visual/grand-tour-capture-results.mjs',source:'review.json',method:'Replay recorded real classifications through the preview result adapter; no races run by this capture script.'},null,2)+'\n');
}finally{await browser.close();}
