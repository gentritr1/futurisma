/**
 * Phase F round 2, item 4 — are the toys big enough to see from the road?
 *
 *   node scripts/visual/dreamisland/alive-toys.mjs --base=URL [--out=DIR]
 *   python3 scripts/visual/dreamisland/alive-toys.py [DIR]
 *
 * Three day poses — BEACH, COURT and REEF at the district mid-point, from the
 * autopilot chase camera the game actually draws — and at each one three canvas
 * frames: everything, the beach balls and rings alone, and nothing. The pair of
 * isolation frames is the same method the capsule pixel table uses, and it is
 * what makes "four toys at least 20 px tall" a count rather than an impression:
 * a toy is a connected run of pixels that differs from the blank frame, and its
 * height is the height of that run's bounding box.
 *
 * The page is frozen on the first frame that matches the pose, so the camera in
 * the isolation frames is the camera in the full frame.
 */
import {mkdir,writeFile} from 'node:fs/promises';
import {launchReviewBrowser} from '../tideline-v4/browser.mjs';
import {instrument} from './instrument.mjs';

const flag=name=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3);
const out=flag('out')??'art/evidence/dreamisland-v1/alive/code/round-2/toys';
const base=flag('base');
if(!base)throw Error('--base= is required');
const [width,height]=(flag('size')??'1440x810').split('x').map(Number);
await mkdir(out,{recursive:true});
const POSES=[{id:'day-beach',at:.0625},{id:'day-court',at:.5875},{id:'day-reef',at:.7542}];

// A single `waitForFunction` is one CDP call, and puppeteer bounds one call at
// 180 s by default: the BEACH pose is most of a lap away from the start line and
// the first run of this script died on that, not on the game.
const browser=await launchReviewBrowser({protocolTimeout:480000});
const poses=[];
try{
 const page=await browser.newPage(),errors=[];
 await page.setViewport({width,height,deviceScaleFactor:1});
 page.on('pageerror',e=>{errors.push(String(e));console.log(String(e));});
 page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.log(m.text());}});
 await instrument(page);
 // `__diCamera` is published by the instrument's per-frame hook; without this
 // line the wait below is for a global nobody ever sets.
 await page.evaluateOnNewDocument(()=>{window.__diCaptureFrame=(renderer,args)=>{window.__diCamera=args[1];};});
 for(const pose of POSES){
  await page.goto(base+'/?map=dreamisland&diagnostics=1&start=manual&headless=1'
   +'&quality=high&music=0&nightBlend=0',{waitUntil:'networkidle0',timeout:120000});
  await page.waitForFunction(()=>!!window.__diCourse&&!!window.__diCamera,{timeout:120000});
  // THE CAMERA IS PINNED, THE PAGE IS NOT FROZEN.
  //
  // The first version of this script froze the tab the way `alive-hud.mjs`
  // does - cancel every animation frame, replace `requestAnimationFrame` with a
  // no-op - and then asked the page to redraw with only the toys visible. It
  // cannot: with rAF dead nothing repaints, so the isolation frames would have
  // been three copies of the frame before them, and the `await` on a doubled
  // rAF never returned at all, which is what the protocol timeout was.
  //
  // Instead the camera is placed exactly where `DreamIslandRuntime.updateCamera`
  // puts it for a craft at the district mid-point - 11.5 m back, 4.8 m up,
  // aimed 19 m ahead, FOV 62 - and its accessors are redefined so the render
  // loop cannot drag it back. The loop keeps running, so a visibility change
  // reaches the next frame.
  const frozen=await page.evaluate(at=>{
   const course=window.__diCourse,camera=window.__diCamera;
   const sample=course.sample((at%1+1)%1);
   const forward=sample.tangent.clone().normalize();
   const position=sample.position.clone().addScaledVector(forward,-11.5);position.y+=4.8;
   const look=sample.position.clone().addScaledVector(forward,19);look.y+=1.15;
   camera.position.copy(position);camera.up.set(0,1,0);camera.lookAt(look);
   camera.fov=62;camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
   for(const axis of ['x','y','z']){const value=camera.position[axis];
    Object.defineProperty(camera.position,axis,{get:()=>value,set:()=>{},configurable:true});}
   camera.lookAt=()=>{};Object.defineProperty(camera,'fov',{get:()=>62,set:()=>{},configurable:true});
   const canvas=document.querySelector('canvas');
   for(const element of document.querySelectorAll('body *')){
    if(element!==canvas&&!element.contains(canvas)&&!canvas.contains(element))element.style.visibility='hidden';
   }
   window.dispatchEvent(new Event('resize'));
   return {progress:at,sector:course.sectorLabelAt(at),
    props:course.group.userData.props?{visibleInstances:course.group.userData.props.visibleInstances,
     visibleTriangles:course.group.userData.props.visibleTriangles}:null};
  },pose.at);
  const shoot=async(suffix,names)=>{
   await page.evaluate(names=>{
    window.__diScene.traverse(object=>{
     if(object.isMesh)object.visible=names.length>0&&names.some(name=>object.name===name);
    });
    window.dispatchEvent(new Event('resize'));
   },names);
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const file=out+'/'+pose.id+'-'+suffix+'.png';
   await (await page.$('canvas')).screenshot({path:file});
   return file;
  };
  const restore=async()=>{
   await page.evaluate(()=>{window.__diScene.traverse(o=>{if(o.isMesh)o.visible=true;});
    window.dispatchEvent(new Event('resize'));});
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  };
  // TWO readings, not one. `toys` is balls and rings, the two kinds the brief
  // names in its placement rule; `all` adds the chrome spheres, which are
  // equally the painting's toys and are placed by the same item. The table
  // reports both, so nobody has to take the wider reading on trust.
  const toys=await shoot('toys',['PR_ball','PR_ring']);
  const all=await shoot('all',['PR_ball','PR_ring','PR_sphere']);
  const blank=await shoot('blank',[]);
  await restore();
  const full=out+'/'+pose.id+'-full.png';
  await (await page.$('canvas')).screenshot({path:full});
  poses.push({...pose,full,toys,all,blank,frozen});
  console.log(pose.id,'progress',frozen.progress.toFixed(4),'sector',frozen.sector,
   'props drawn',frozen.props?.visibleInstances,'tris',frozen.props?.visibleTriangles);
 }
 await writeFile(out+'/capture.json',JSON.stringify({
  script:'scripts/visual/dreamisland/alive-toys.mjs',base,viewport:width+'x'+height,
  kinds:{toys:['PR_ball','PR_ring'],all:['PR_ball','PR_ring','PR_sphere']},poses,errors},null,2)+'\n');
 console.log('errors',errors.length);
}finally{await browser.close();}
