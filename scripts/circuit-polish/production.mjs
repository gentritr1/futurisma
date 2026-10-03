import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const headers=await readFile('public/_headers','utf8'),csp=headers.match(/Content-Security-Policy: (.+)/)[1];
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
const reports=[];
try {
 for(const map of ['greenwater','bitterpan','nightshift','polarity','tideline','ascension','dreamisland','afterglow','frostline']){
  const page=await browser.newPage({viewport:{width:1536,height:864}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.route('http://127.0.0.1:5219/?*',async route=>{const response=await route.fetch();await route.fulfill({response,headers:{...response.headers(),'content-security-policy':csp}});});
  await page.goto(`http://127.0.0.1:5219/?map=${map}&music=0&voice=0`);await page.waitForTimeout(4500);
  await page.keyboard.press('Enter');await page.waitForTimeout(5500);
  assert.equal(await page.locator('.hud').getAttribute('data-minimap'),'aplus');
  assert.equal(await page.locator('.hud').getAttribute('data-map-theme'),map);
  assert.equal(await page.locator('.map-hud-environment').evaluate(node=>getComputedStyle(node).position),'absolute','Map skin stylesheet loads under CSP');
  await page.waitForFunction(()=>{const image=document.querySelector('.map-hud-environment img');return image.complete&&image.naturalWidth>0;});
  if(map==='afterglow')assert.equal(await page.locator('.relay-status').evaluate(node=>getComputedStyle(node).position),'absolute','CSP permits external relay styling');
  if(map==='frostline'){assert.equal(await page.locator('.winter-status').evaluate(node=>getComputedStyle(node).position),'absolute','CSP permits winter styling');assert.equal((await page.request.get('http://127.0.0.1:5219/assets/frostline/visor-frost.png')).status(),200);}
  await page.keyboard.down('w');await page.waitForTimeout(1200);await page.keyboard.up('w');
  await page.screenshot({path:`.dream-loop/circuit-polish/production-${map}.png`});
  assert.deepEqual(errors,[]);reports.push({map,errors,minimap:'aplus',phase:await page.evaluate(()=>document.body.dataset.phase)});await page.close();
 }
 await writeFile('scripts/circuit-polish/production-summary.json',JSON.stringify(reports,null,2)+'\n');console.log(JSON.stringify(reports));
} finally {await browser.close();}
