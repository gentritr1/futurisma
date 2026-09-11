/**
 * One chase-height frame per district, by day and by night: fourteen frames.
 *
 *   node scripts/visual/dreamisland/frames.mjs [--out=DIR] [--tier=works]
 *
 * A green soak proves no regression; it never proves the art loaded, because
 * decoration is non-interactive and the lap times are identical with and
 * without it. These are the frames a reviewer looks at.
 *
 * WHY NINE LAPS. The strike lands just after the lap-2/lap-3 boundary and the
 * night takes twelve seconds to settle, so on the default three-lap race only
 * BASIN, COURT, REEF and CUT are ever seen at full night — the last lap's
 * BEACH, GROVE and POINT are still mid-crossfade. `?laps=` is clamped to [1, 9]
 * by the course, so a nine-lap run puts six whole laps after `night-settled`
 * and every district can be photographed in BOTH settled states. The alternative
 * — `?motion=reduce`, which steps nightBlend at the strike — would photograph a
 * different mode than the one that ships by default, so it is not used here.
 *
 * Frames are taken from the shipped chase camera at the district's mid-point,
 * with `nightBlend` recorded beside each one rather than assumed.
 */
import {mkdir,writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {launchReviewBrowser} from '../tideline-v4/browser.mjs';
import {instrument} from './instrument.mjs';

const flag=name=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3);
const out=flag('out')??'art/evidence/dreamisland-v1/phase-b/frames';
const tier=flag('tier')??'works',seed=flag('seed')??'3868938316';
const base=flag('base')??'http://127.0.0.1:5200';
const DAY_LAP=1,NIGHT_LAP=Number(flag('night-lap')??5),LAPS=9;
await mkdir(out,{recursive:true});
const route=JSON.parse(readFileSync('src/game/data/dreamisland/route.json','utf8'));
const districts=route.districts.map((district,index)=>({
 id:district.id,name:district.name,
 from:district.from,to:route.districts[index+1]?.from??1,
 at:(district.from+(route.districts[index+1]?.from??1))/2}));

const browser=await launchReviewBrowser();
try{
 const page=await browser.newPage(),errors=[];
 page.on('pageerror',e=>{errors.push(String(e));console.log(String(e));});
 page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.log(m.text());}});
 await instrument(page);
 const url=base+'/?map=dreamisland&seed='+seed+'&tier='+tier
  +'&laps='+LAPS+'&demo=1&headless=1&diagnostics=1&start=manual&quality=high&music=0';
 await page.goto(url,{waitUntil:'networkidle0',timeout:60000});
 if(errors.length)throw Error(errors.join('\n'));
 await page.waitForSelector('#start-button',{visible:true});
 await page.click('#start-button');
 const diagnostics=()=>page.evaluate(()=>{try{return JSON.parse(document.getElementById('dreamisland-diagnostics').textContent);}catch{return null;}});
 // There is no `current.lap` in the diagnostics blob; the lap in progress is
 // one past the number of completed lap times, which is what the HUD counts.
 const lap=()=>page.evaluate(()=>{try{return JSON.parse(document.getElementById('futurisma-diagnostics').textContent).current.lapTimesMs.length+1;}catch{return 0;}});
 const frames=[];
 for(const [state,wantedLap] of [['day',DAY_LAP],['night',NIGHT_LAP]]){
  for(const district of districts){
   const name=state+'-'+district.id.toLowerCase();
   try{
    await page.waitForFunction((target,window_)=>{
     try{
      const race=JSON.parse(document.getElementById('futurisma-diagnostics').textContent);
      const map=JSON.parse(document.getElementById('dreamisland-diagnostics').textContent);
      return race.current.lapTimesMs.length+1===target&&map.progress>=window_[0]&&map.progress<=window_[1];
     }catch{return false;}
    },{timeout:120000,polling:40},wantedLap,[district.at-.012,district.at+.012]);
    await page.screenshot({path:out+'/'+name+'.png'});
    const state_=await diagnostics();
    frames.push({frame:name+'.png',state,district:district.id,districtName:district.name,
     lap:await lap(),progress:state_?.progress,sector:state_?.sector,
     nightBlend:state_?.nightBlend,tick:state_?.tick,grip:state_?.grip,
     scheduleState:state_?.state,painted:state_?.painted});
   }catch(error){
    frames.push({frame:name+'.png',state,district:district.id,missed:error.message});
    console.log('missed '+name+': '+error.message);
   }
  }
 }
 const inputs=['public/assets/dreamisland/painted.glb','public/assets/dreamisland/painted.json',
  'public/assets/dreamisland/atlas-manifest.json','public/assets/dreamisland/signage-manifest.json'];
 await writeFile(out+'/frames.json',JSON.stringify({script:'scripts/visual/dreamisland/frames.mjs',
  url,laps:LAPS,dayLap:DAY_LAP,nightLap:NIGHT_LAP,errors,
  inputHashes:Object.fromEntries(inputs.map(file=>[file,createHash('sha256').update(readFileSync(file)).digest('hex')])),
  note:'Nine laps so that every district can be photographed after night-settled; the default race is three laps and only reaches full night from BASIN onward.',
  frames},null,2));
 console.log(JSON.stringify({captured:frames.filter(f=>!f.missed).length,missed:frames.filter(f=>f.missed).map(f=>f.frame),
  nightBlend:[...new Set(frames.filter(f=>!f.missed).map(f=>f.state+':'+f.nightBlend))]},null,1));
}finally{await browser.close();}
