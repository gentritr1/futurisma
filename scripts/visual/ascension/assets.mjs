import {mkdir,writeFile} from 'node:fs/promises';
import {launchReviewBrowser} from '../tideline-v4/browser.mjs';
const assets=process.argv.find(a=>a.startsWith('--assets='))?.slice(9).split(',')??['rocket-platform','crawler-transporter','countdown-board','trench-wall-module','deluge-water-tower','propellant-tank','vent-stack','crawlerway-gravel-bed','mangrove-pier','egret-card-set','service-tower-swing-arm','surge','shield'];
const out=process.argv.find(a=>a.startsWith('--out='))?.slice(6)??'art/evidence/ascension-v1/phase-b/focal';await mkdir(out,{recursive:true});
const browser=await launchReviewBrowser(),records=[],errors=[];
try{const page=await browser.newPage();page.on('pageerror',e=>errors.push(String(e)));
for(const asset of assets){await page.goto('http://127.0.0.1:5200/ascension-assets.html?asset='+(['surge','shield'].includes(asset)?'power-kit&device='+asset:asset),{waitUntil:'networkidle0'});await page.waitForSelector('#asset-state');await page.screenshot({path:out+'/'+asset+'.png'});records.push(await page.$eval('#asset-state',e=>JSON.parse(e.textContent)));}
await writeFile(out+'/capture.json',JSON.stringify({script:'scripts/visual/ascension/assets.mjs',records,errors},null,2));if(errors.length)throw Error(errors.join('\n'));
}finally{await browser.close();}
