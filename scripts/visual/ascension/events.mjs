import {readFileSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchReviewBrowser} from '../tideline-v4/browser.mjs';
const config=JSON.parse(readFileSync('src/game/data/ascension/schedule.json')),out='art/evidence/ascension-v1/phase-c/event-tour';await mkdir(out,{recursive:true});
const crosses=config.events.filter(e=>e.id.startsWith('crawler-cross')),shots=[];
for(const [i,event] of crosses.entries())for(const offset of [0,180,360,540,720])shots.push({name:`crawler-${i+1}-${offset}`,progress:.60,tick:event.tick+offset});
for(const [i,fraction] of [-.15,0,.15,.4,.7,1,1.25].entries())shots.push({name:'launch-'+i,progress:.25,target:'pad',tick:Math.round(config.launchTick+fraction*(config.rocketGoneTick-config.launchTick))});
for(const reduced of [false,true])for(const tick of [config.launchTick-120,config.launchTick+120,config.steamEndTick+120])shots.push({name:`apron-${tick}-${reduced?'reduced':'normal'}`,progress:.10,tick,reduced});
for(const [name,tick] of [['rehearsal',config.testTick+120],['dry',config.testTick+11*120],['launch',config.launchTick+120],['flooded',config.reopenTick+120]])shots.push({name:'deluge-'+name,progress:.56,tick,trench:true});
const browser=await launchReviewBrowser(),records=[],errors=[];
try{const page=await browser.newPage();page.on('pageerror',e=>{errors.push(String(e));console.error(String(e));});page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 for(const shot of shots){await page.goto(`http://127.0.0.1:5200/ascension-review.html?progress=${shot.progress}&tick=${shot.tick}${shot.target?'&target='+shot.target:''}${shot.trench?'&trench=1':''}${shot.reduced?'&motion=reduce':''}`,{waitUntil:'networkidle0'});await page.waitForSelector('#review-state');await page.screenshot({path:out+'/'+shot.name+'.png'});records.push({...shot,state:await page.$eval('#review-state',e=>JSON.parse(e.textContent))});}
 await writeFile(out+'/capture.json',JSON.stringify({script:'scripts/visual/ascension/events.mjs',sampling:'Discrete authored poses, not a timed rendering window. All event anchors are computed from the build-produced schedule. Crawler offsets cover six seconds in five views including endpoints; the 120Hz sweep is in validate-ascension-events.mjs.',records,errors},null,2));if(errors.length)throw Error(errors.join('\n'));
}finally{await browser.close();}
