/**
 * The day->night crossfade, captured. ONE pose, five points on the ramp.
 *
 *   node scripts/visual/dreamisland/crossfade-profile.mjs [--out=DIR] [--base=URL]
 *   python3 scripts/visual/dreamisland/crossfade-profile.py [DIR]
 *
 * WHY THIS EXISTS. Nothing in this repo measures a sky or lighting crossfade.
 * `sky-profile.py` scores one 4096x1024 still; `check-sky-frames.py` and
 * `turntable-profile.py` each score frames at ONE schedule tick. Two panoramas
 * that pass the still gate independently prove nothing about the 50% blend,
 * which is exactly where a mismatched pair goes muddy. Until this capture
 * exists there is no defensible midpoint target, and a target written before it
 * is an invented number.
 *
 * WHAT IS PINNED, AND HOW.
 *
 *  * `nightBlend`. `?nightBlend=` is a review-only override in
 *    `dreamisland-course.ts`, honoured only alongside `?diagnostics`. Each of
 *    the five captures is its own page load, so every state is fully settled
 *    rather than caught mid-lerp: `atmosphere.ts` smooths lights at
 *    `1 - exp(-delta * 2.8)` and fog at `5.5`, and this script waits for those
 *    to stop moving and records how long that took.
 *  * The pose. The race is never started, so the world is static; the camera is
 *    then moved to the BEACH straight at progress .05 with the SHIPPED chase
 *    geometry from `DreamIslandRuntime.updateCamera` (11.5 m back, 4.8 m up,
 *    looking 19 m ahead at 1.15 m, fov 62). `updateCamera` runs every frame
 *    even in standby, so the pose is held by freezing the camera's own
 *    position components and `lookAt` rather than by writing it once - a write
 *    is undone by the next frame, which is a trap worth stating.
 *
 * WHAT IS MEASURED, AND HOW THE REGIONS ARE PROVED.
 *
 * Four renders per blend, from the identical camera: the full frame, the sky
 * dome alone, the road ribbon alone, and everything hidden. The regions are
 * then EXACT rather than guessed at a row number:
 *
 *   sky pixels  = pixels where the full frame equals the dome-alone frame.
 *                 The dome draws first (renderOrder -990, no depth test), so a
 *                 pixel still showing it is a pixel nothing occluded.
 *   road pixels = pixels where the full frame equals the road-alone frame AND
 *                 the road-alone frame differs from the blank frame, so the
 *                 flat clear colour behind the isolated road cannot be counted
 *                 as road where it happens to match the sky.
 *
 * `crossfade-profile.py` does that arithmetic and writes the per-column sky
 * luma and warmth and the road means. This script writes the frames and the
 * capture record; it deliberately states no target.
 */
import {mkdir,writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {launchReviewBrowser} from '../../../../../scripts/visual/tideline-v4/browser.mjs';
import {instrument} from '../../../../../scripts/visual/dreamisland/instrument.mjs';

const flag=name=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3);
const out=flag('out')??'art/evidence/dreamisland-v1/phase-c/crossfade';
const base=flag('base')??'http://127.0.0.1:5202';
const sourceRoot=flag('source-root')??'.';
const seed=flag('seed')??'3868938316';
/** The five points of the ramp. `--blends=0,1` narrows it, which is what a
 * one-off look at a single pose uses; the acceptance capture is all five. */
const BLENDS=(flag('blends')??'0,0.25,0.5,0.75,1').split(',').map(Number);
const POSE_PROGRESS=Number(flag('progress')??'0.05');
/** The shipped chase camera, restated from `dreamisland-runtime.ts:51-55`. */
const CHASE={back:11.5,rise:4.8,lookAhead:19,lookRise:1.15,fov:62};
await mkdir(out,{recursive:true});

const route=JSON.parse(readFileSync('src/game/data/dreamisland/route.json','utf8'));
const painted=JSON.parse(readFileSync('public/assets/dreamisland/painted.json','utf8'));
const index=Math.round(POSE_PROGRESS*route.count)%route.count;
const station=route.stations[index];
const point=station.p.map(Number),forward=station.t.map(Number);
const position=[point[0]-forward[0]*CHASE.back,point[1]-forward[1]*CHASE.back+CHASE.rise,point[2]-forward[2]*CHASE.back];
const target=[point[0]+forward[0]*CHASE.lookAhead,point[1]+forward[1]*CHASE.lookAhead+CHASE.lookRise,point[2]+forward[2]*CHASE.lookAhead];
/** The pose is named "looking down the road toward the watchtower"; that claim
 * is a geometric fact about this route, so it is measured here rather than
 * asserted in prose. */
const watchtower=painted.placements.find(placement=>placement.asset==='watchtower-ruin');
const horizontal=(a,b)=>{const x=a[0]-b[0],z=a[2]-b[2],m=Math.hypot(x,z)||1;return [x/m,z/m];};
const toTower=horizontal(watchtower.position,position),along=horizontal(target,position);
const towerOffAxisDegrees=Math.acos(Math.max(-1,Math.min(1,toTower[0]*along[0]+toTower[1]*along[1])))*180/Math.PI;
const towerDistance=Math.hypot(Math.hypot(watchtower.position[0]-position[0],watchtower.position[1]-position[1]),watchtower.position[2]-position[2]);
// Horizontal half-angle of the frame, from the vertical fov and the 1280x720
// viewport, so "in frame" is arithmetic and not an impression of a screenshot.
const halfHorizontalDegrees=Math.atan(Math.tan(CHASE.fov/2*Math.PI/180)*1280/720)*180/Math.PI;

const pose={progress:POSE_PROGRESS,station:index,sector:station.sector,
 roadPoint:point,tangent:forward,camera:position,lookAt:target,fov:CHASE.fov,
 viewport:[1280,720],chase:CHASE,
 watchtower:{placement:watchtower.position,metres:towerDistance,
  offAxisDegrees:towerOffAxisDegrees,halfHorizontalDegrees,
  inFrame:towerOffAxisDegrees<halfHorizontalDegrees}};

const browser=await launchReviewBrowser();
const captures=[],errors=[];
try{
 const page=await browser.newPage();
 page.on('pageerror',e=>{errors.push(String(e));console.log(String(e));});
 page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.log(m.text());}});
 await instrument(page);
 await page.evaluateOnNewDocument(()=>{window.__diCaptureFrame=(renderer,args)=>{window.__diCamera=args[1];};});
 for(const blend of BLENDS){
  const label=String(Math.round(blend*100)).padStart(3,'0');
  const url=base+'/?map=dreamisland&seed='+seed+'&tier=works&demo=1&headless=1&diagnostics=1'
   +'&start=manual&quality=high&music=0&nightBlend='+blend;
  await page.goto(url,{waitUntil:'networkidle0',timeout:60000});
  await page.waitForSelector('#start-button',{visible:true});
  await page.waitForSelector('canvas');
  await page.waitForFunction(()=>!!window.__diScene&&!!window.__diCamera,{timeout:60000});
  await page.evaluate(()=>{
   window.__diMeshes=[];window.__diScene.traverse(o=>{if(o.isMesh||o.isInstancedMesh)window.__diMeshes.push(o);});
   window.__diSaved=window.__diMeshes.map(o=>({o,visible:o.visible}));
   window.__diRestore=()=>{for(const s of window.__diSaved)s.o.visible=s.visible;};
   window.__diBlank=()=>{for(const s of window.__diSaved)s.o.visible=false;};
   window.__diOnly=(...names)=>{
    let found=0;
    for(const s of window.__diSaved){const wanted=names.includes(s.o.name);s.o.visible=wanted;if(wanted)found++;}
    return found;
   };
   // The HUD is DOM and composites into every screenshot; its clock digits also
   // change between frames, which would put a moving element inside a region
   // that is supposed to contain only sky or only road.
   window.__diHudHidden=[];
   window.__diHideHud=()=>{
    const canvas=document.querySelector('canvas');
    for(const element of document.querySelectorAll('body *')){
     if(element===canvas||element.contains(canvas)||canvas.contains(element))continue;
     if(element.style.visibility==='hidden')continue;
     window.__diHudHidden.push([element,element.style.visibility]);element.style.visibility='hidden';
    }
   };
   /**
    * `DreamIslandRuntime.updateCamera` rewrites the camera on EVERY frame,
    * standby included, so a pose written once is gone before the screenshot.
    * The components are frozen instead, and `lookAt` and `fov` with them, so
    * the runtime's writes land harmlessly and `updateVisibility` - which runs
    * before the render and parks the sky dome on the camera - sees the pinned
    * pose rather than the chase pose one frame behind it.
    */
   window.__diPinPose=(position,target,fov)=>{
    const camera=window.__diCamera,V=camera.position.constructor;
    camera.position.set(position[0],position[1],position[2]);
    camera.up.set(0,1,0);
    camera.lookAt(new V(target[0],target[1],target[2]));
    camera.fov=fov;camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
    for(const key of ['x','y','z']){
     const value=camera.position[key];
     Object.defineProperty(camera.position,key,{get:()=>value,set:()=>{},configurable:true});
    }
    camera.lookAt=()=>{};
    Object.defineProperty(camera,'fov',{get:()=>fov,set:()=>{},configurable:true});
    return {position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),fov:camera.fov};
   };
   /** What the atmosphere has actually settled on, read off the live scene. */
   window.__diLightState=()=>{
    let hemisphere=null,key=null;
    window.__diScene.traverse(o=>{
     if(o.isHemisphereLight&&hemisphere===null)hemisphere=o.intensity;
     if(o.isDirectionalLight&&key===null)key=o.intensity;
    });
    const fog=window.__diScene.fog;
    return {hemisphereIntensity:hemisphere,keyIntensity:key,
     fogDensity:fog?.density??null,fogColor:fog?.color?.getHex()??null,
     background:window.__diScene.background?.getHex?.()??null};
   };
  });
  await page.evaluate(()=>window.__diHideHud());
  if(flag('fish')==='1')await page.evaluate(()=>{const c=window.__diCourse;c.schedule.tick=c.schedule.config.fishRiseTick+3000;});
  const pinned=await page.evaluate(({position,target,fov})=>window.__diPinPose(position,target,fov),
   {position,target,fov:CHASE.fov});
  // The lights and the fog are exponential trackers, not step functions. Wait
  // for them to stop moving and RECORD how many polls that took, so "settled"
  // is a measurement rather than a sleep.
  const settle=await page.evaluate(async()=>{
   const same=(a,b)=>a&&b&&['hemisphereIntensity','keyIntensity','fogDensity'].every(k=>
    a[k]!==null&&b[k]!==null&&Math.abs(a[k]-b[k])<=1e-5)&&a.fogColor===b.fogColor;
   let previous=null,stable=0,polls=0;
   while(polls<200){
    const now=window.__diLightState();
    if(same(previous,now))stable+=1;else stable=0;
    previous=now;polls+=1;
    if(stable>=6)break;
    await new Promise(resolve=>setTimeout(resolve,50));
   }
   return {polls,stableReadings:stable,settled:stable>=6,state:previous};
  });
  const draw=async()=>{
   await page.evaluate(()=>window.dispatchEvent(new Event('resize')));
   await new Promise(resolve=>setTimeout(resolve,260));
  };
  // `updateHud` only runs once a race is under way, so on the start line the
  // diagnostics element can still be empty. The blend that actually REACHED the
  // renderer is read off the live scene instead - the dome's own `nightBlend`
  // uniform and the two water materials' emissive intensities - which is a
  // stronger proof that the pin took than the URL this script typed.
  const applied=await page.evaluate(()=>{
   const found={};
   window.__diScene.traverse(o=>{
    if(o.name==='dreamisland_panorama')found.skyUniformNightBlend=o.material.uniforms?.nightBlend?.value??null;
    if(o.name==='dreamisland_foam')found.foamEmissiveIntensity=o.material.emissiveIntensity;
    if(o.name==='dreamisland_shallows')found.shallowsEmissiveIntensity=o.material.emissiveIntensity;
    if(o.name==='dreamisland_sea')found.seaColor=o.material.color.getHex();
   });
   let diagnostics=null;
   try{diagnostics=JSON.parse(document.getElementById('dreamisland-diagnostics').textContent);}catch{}
   const counters=window.__diScene.getObjectByName('dreamisland_island_circuit')?.userData?.paintedCounters??null;
   return {...found,reflections:window.__diScene.userData.dreamIslandReflections,paintedCounters:counters,diagnostics};
  });
  const frames={};
  await draw();
  frames.full='blend-'+label+'.png';
  await page.screenshot({path:out+'/'+frames.full});
  if(flag('fish')==='1'){
   applied.glow=await page.evaluate(()=>{const glow=window.__diScene.getObjectByName('dreamisland_glow_sprites');return {count:glow.count,...glow.userData};});
   await page.evaluate(()=>{window.__diScene.getObjectByName('dreamisland_glow_sprites').visible=false;});await draw();
   await page.screenshot({path:out+'/blend-'+label+'-without-sprites.png'});
  }
  const drewSky=await page.evaluate(()=>window.__diOnly('dreamisland_panorama'));
  await draw();
  frames.sky='blend-'+label+'-sky.png';
  await page.screenshot({path:out+'/'+frames.sky});
  const drewRoad=await page.evaluate(()=>window.__diOnly('dreamisland_blockout_road'));
  await draw();
  frames.road='blend-'+label+'-road.png';
  await page.screenshot({path:out+'/'+frames.road});
  // The night state's racing argument, isolated the same way: the two glowing
  // bands that define the edges, and the black water beside them. Whether the
  // pose actually sees them is a property of the pose, so both counts are
  // recorded rather than assumed.
  // §8: isolate the rail triangles in their shared road draw by atlas quadrant.
  await page.evaluate(()=>{
   window.__diOnly('dreamisland_blockout_road');
   const mesh=window.__diScene.getObjectByName('dreamisland_blockout_road'),g=mesh.geometry;
   window.__diRoadIndex=g.index;
   const indices=[];
   for(let i=0;i<g.index.count;i+=3)if(g.attributes.uv.getY(g.index.getX(i))>.5)
    indices.push(g.index.getX(i),g.index.getX(i+1),g.index.getX(i+2));
   g.setIndex(indices);
  });
  await draw();await page.screenshot({path:out+'/blend-'+label+'-rails.png'});
  await page.evaluate(()=>{window.__diScene.getObjectByName('dreamisland_blockout_road').geometry.setIndex(window.__diRoadIndex);});
  const drewGlow=await page.evaluate(()=>window.__diOnly('dreamisland_foam','dreamisland_shallows'));
  await draw();
  frames.glow='blend-'+label+'-glow.png';
  await page.screenshot({path:out+'/'+frames.glow});
  for(const kind of ['shallows','foam']){
   await page.evaluate(kind=>window.__diOnly('dreamisland_'+kind),kind);await draw();
   await page.screenshot({path:out+'/blend-'+label+'-'+kind+'.png'});
  }
  const drewSea=await page.evaluate(()=>window.__diOnly('dreamisland_sea'));
  await draw();
  frames.sea='blend-'+label+'-sea.png';
  await page.screenshot({path:out+'/'+frames.sea});
  await page.evaluate(()=>window.__diBlank());
  await draw();
  frames.blank='blend-'+label+'-blank.png';
  await page.screenshot({path:out+'/'+frames.blank});
  await page.evaluate(()=>window.__diRestore());
  if(blend===1){
   await page.evaluate(()=>{
    window.__diEmissionHooks=[];
    for(const name of ['dreamisland_foam','dreamisland_shallows']){
     const mesh=window.__diScene.getObjectByName(name),before=mesh.onBeforeRender,after=mesh.onAfterRender;
     window.__diEmissionHooks.push({mesh,before,after});
     let intensity=0;
     mesh.onBeforeRender=function(...args){before.apply(this,args);intensity=this.material.emissiveIntensity;this.material.emissiveIntensity=0;};
     mesh.onAfterRender=function(...args){this.material.emissiveIntensity=intensity;after.apply(this,args);};
    }
   });
   await draw();await page.screenshot({path:out+'/blend-'+label+'-without-water-emission.png'});
   await page.evaluate(()=>{for(const {mesh,before,after} of window.__diEmissionHooks){mesh.onBeforeRender=before;mesh.onAfterRender=after;}});
  }
  captures.push({blend,label,url,frames,pinned,settle,drewSky,drewRoad,drewGlow,drewSea,applied});
  console.log(JSON.stringify({blend,skyUniformNightBlend:applied.skyUniformNightBlend,
   foamEmissiveIntensity:applied.foamEmissiveIntensity,
   settledAfterPolls:settle.polls,settled:settle.settled,drewSky,drewRoad}));
 }
 const inputs=['public/assets/dreamisland/sky-day.jpg','public/assets/dreamisland/sky-night.jpg',
  'public/assets/dreamisland/painted.glb','src/game/dreamisland-course.ts',
  'src/game/dreamisland-sky.ts','src/game/dreamisland-water.ts','src/game/dreamisland-reflections.ts'];
 await writeFile(out+'/crossfade-capture.json',JSON.stringify({
  script:'scripts/visual/dreamisland/crossfade-profile.mjs',base,seed,blends:BLENDS,pose,errors,
  inputHashes:Object.fromEntries(inputs.map(file=>[file,createHash('sha256').update(readFileSync(sourceRoot+'/'+file)).digest('hex')])),
  captures,
  regions:'sky = full frame equals the dome-alone frame; road = full frame equals the road-alone frame AND the road-alone frame differs from the blank frame. Both are computed by scripts/visual/dreamisland/crossfade-profile.py from the frames beside this file.',
  target:'NONE. This script measures; it states no midpoint target. The target is written afterwards, as a delta against these five captures.',
 },null,2));
 console.log('wrote '+out+'/crossfade-capture.json');
}finally{await browser.close();}
if(errors.length)throw new Error(errors.join('\n'));

// All captures and metadata are flushed and Chrome is closed. Intercepted fetch
// keep-alive handles must not hold this one-shot evidence process open.
process.exit(0);
