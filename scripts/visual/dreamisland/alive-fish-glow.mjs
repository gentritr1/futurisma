/**
 * Phase F §4.3 — does a fish at 40 m reach the night's brightest one per cent?
 *
 *   node scripts/visual/dreamisland/alive-fish-glow.mjs [--out=DIR] [--base=URL]
 *
 * §4.3 asks for the goldfish's night emissive to be raised "until a fish at
 * 40 m contributes to the night p99", and says to measure it with one frame
 * with fish and one without, at the same pose. That is exactly what this does:
 *
 *   - `nightBlend` is pinned to 1 by the review-only query parameter, so the
 *     lighting is the settled night and nothing is mid-ramp;
 *   - the schedule's tick is set to `fishRiseTick + one full period of the
 *     COURT crossing shoal`, which is the tick at which that shoal's authored
 *     path is back on the road centre with its swim blend at full — so "over
 *     the road" is a property of the data, not of when the harness happened to
 *     look;
 *   - the camera is the shipped chase camera for a craft 40 m short of the
 *     crossing;
 *   - two canvas frames are taken, one with the shoals visible and one with
 *     them hidden, and nothing else differs between them.
 *
 * `alive-fish-glow.py` reads the pair and prints p99, p99.9 and the count of
 * pixels above the no-fish p99.
 */
import {mkdir,writeFile} from 'node:fs/promises';
import {launchReviewBrowser} from '../tideline-v4/browser.mjs';
import {instrument} from './instrument.mjs';

const flag=name=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3);
const out=flag('out')??'art/evidence/dreamisland-v1/alive/code/fish';
const base=flag('base')??'http://127.0.0.1:5200';
const DISTANCE=Number(flag('distance')??40);
await mkdir(out,{recursive:true});

const browser=await launchReviewBrowser();
try{
 const page=await browser.newPage(),errors=[];
 page.on('pageerror',e=>{errors.push(String(e));console.log(String(e));});
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await instrument(page);
 await page.evaluateOnNewDocument(()=>{window.__diCaptureFrame=(renderer,args)=>{window.__diCamera=args[1];};});
 await page.goto(base+'/?map=dreamisland&diagnostics=1&start=manual&headless=1&quality=high&music=0&nightBlend=1',
  {waitUntil:'networkidle0',timeout:120000});
 await page.waitForFunction(()=>!!window.__diCourse?.capsules&&!!window.__diCamera,{timeout:120000});
 const meta=await page.evaluate(async({distance})=>{
  const course=window.__diCourse,camera=window.__diCamera;
  const shoal=(await import('/src/game/data/dreamisland/fish-paths.json')).default.shoals
   .find(row=>row.id==='court-cross');
  const config=course.schedule.config;
  const tick=config.fishRiseTick+Math.round(shoal.periodSeconds*120);
  course.schedule.tick=tick;
  const craftProgress=shoal.rest.progress-distance/course.length;
  const sample=course.sample((craftProgress%1+1)%1);
  const forward=sample.tangent.clone().normalize();
  const position=sample.position.clone().addScaledVector(forward,-11.5);position.y+=4.8;
  const look=sample.position.clone().addScaledVector(forward,19);look.y+=1.15;
  camera.position.copy(position);camera.up.set(0,1,0);camera.lookAt(look);
  camera.fov=62;camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
  for(const axis of ['x','y','z']){const value=camera.position[axis];
   Object.defineProperty(camera.position,axis,{get:()=>value,set:()=>{},configurable:true});}
  camera.lookAt=()=>{};Object.defineProperty(camera,'fov',{get:()=>62,set:()=>{},configurable:true});
  // The tick is re-pinned every frame: `advanceSchedule` would otherwise walk
  // it forward between the two captures and the pair would differ by the drift
  // as well as by the fish.
  const advance=course.advanceSchedule.bind(course);
  course.advanceSchedule=()=>{advance(0);course.schedule.tick=tick;};
  return {tick,fishRiseTick:config.fishRiseTick,periodSeconds:shoal.periodSeconds,
   craftProgress,shoalProgress:shoal.rest.progress,distanceMetres:distance};
 },{distance:DISTANCE});
 const shoot=async(name,visible)=>{
  await page.evaluate(visible=>{
   // `visible` is REDEFINED, not assigned. `DreamIslandShoals.update` writes
   // `mesh.visible = risen` on every frame, so a plain assignment was undone
   // before the screenshot and the first run of this script compared two
   // identical frames and reported a p99 delta of exactly zero.
   window.__diScene.traverse(object=>{
    if(!object.isMesh||!/^DI_FISH/.test(object.name))return;
    Object.defineProperty(object,'visible',{get:()=>visible,set:()=>{},configurable:true});
   });
   window.dispatchEvent(new Event('resize'));
  },visible);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const file=out+'/'+name+'.png';
  await (await page.$('canvas')).screenshot({path:file});
  return file;
 };
 // With first, then without: the fish are visible by default at this tick, and
 // hiding them is the change under test.
 const withFish=await shoot('night-40m-with-fish',true);
 const withoutFish=await shoot('night-40m-without-fish',false);
 // The counters come off the course group rather than the diagnostics blob:
 // this page is never started, so updateHud never writes that blob.
 const counters=await page.evaluate(()=>window.__diCourse.group.userData.paintedCounters);
 await writeFile(out+'/capture.json',JSON.stringify({
  script:'scripts/visual/dreamisland/alive-fish-glow.mjs',base,viewport:'1280x720',
  pose:'chase camera '+DISTANCE+' m short of the court-cross shoal, nightBlend pinned to 1',
  meta,withFish,withoutFish,fishVisibleMeshes:counters.fishVisible,errors},null,2)+'\n');
 console.log(JSON.stringify({...meta,fishVisible:counters.fishVisible,errors:errors.length}));
}finally{await browser.close();}
