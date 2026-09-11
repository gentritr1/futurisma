import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {launchReviewBrowser} from '../tideline-v4/browser.mjs';
const browser=await launchReviewBrowser();
try{
 const page=await browser.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(String(e)));
 const url='http://127.0.0.1:5217/art/evidence/dreamisland-v1/polish/index.html';
 await page.goto(url,{waitUntil:'networkidle0'});
 await page.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>0));
 const first=await page.$eval('#caption',e=>e.textContent);
 await page.$eval('#frame',e=>{e.value='9';e.dispatchEvent(new Event('input'));});
 await page.waitForFunction(()=>document.querySelector('#strike').complete&&document.querySelector('#strike').src.endsWith('/09.png'));
 const last=await page.$eval('#caption',e=>e.textContent);
 await page.click('#play');
 await page.waitForFunction(()=>Number(document.querySelector('#frame').value)>0);
 await page.click('#play');
 const stopped=await page.$eval('#play',e=>e.textContent);
 assert.equal(stopped,'Play');assert.notEqual(first,last);assert.deepEqual(errors,[]);
 await writeFile('art/evidence/dreamisland-v1/polish/review-check.json',JSON.stringify({script:'scripts/visual/dreamisland-heroes/polish-review-check.mjs',url,first,last,allImagesLoaded:true,playPauseWorks:true,errors},null,2)+'\n');
 console.log('VERIFIED review images, frame slider and play/pause');
}finally{await browser.close();}
