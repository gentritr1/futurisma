import {launchReviewBrowser} from '/Users/gentlegen/Desktop/futurisma-race/polarity_work/scripts/visual/tideline-v4/browser.mjs';
const browser=await launchReviewBrowser();
try{
 const page=await browser.newPage();await page.setViewport({width:1280,height:720});
 await page.goto('http://127.0.0.1:5200/?map=dreamisland&seed=3868938316&tier=works&laps=3&demo=1&headless=1&diagnostics=1&start=manual&quality=high&music=0',{waitUntil:'networkidle0',timeout:60000});
 await page.waitForSelector('#start-button',{visible:true});await page.click('#start-button');
 for(const [name,at] of [['court60-day',.550],['reef60-day',.725]]){
  await page.waitForFunction((lo,hi)=>{try{const m=JSON.parse(document.getElementById('dreamisland-diagnostics').textContent);return m.progress>=lo&&m.progress<=hi;}catch{return false}},{timeout:120000,polling:25},at-.005,at+.005);
  await page.evaluate(()=>{for(const el of document.querySelectorAll('#app > *:not(#game-canvas)'))el.style.visibility='hidden';});await page.screenshot({path:'/Users/gentlegen/Desktop/futurisma-race/polarity_work/art/evidence/dreamisland-v1/alive/vs-design/fix-4-nohud/'+name+'.png'});
  console.log(name, await page.evaluate(()=>{const m=JSON.parse(document.getElementById('dreamisland-diagnostics').textContent);return JSON.stringify({progress:+m.progress.toFixed(4),nightBlend:m.nightBlend,sector:m.sector});}));
 }
}finally{await browser.close();}
