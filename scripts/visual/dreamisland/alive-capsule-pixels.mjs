/**
 * Phase F §4.4 — how big the capsule and its column actually are, in pixels.
 *
 *   node scripts/visual/dreamisland/alive-capsule-pixels.mjs [--out=DIR] [--base=URL]
 *
 * The brief's own estimate is that a 3 m capsule is about 14 px tall at 150 m
 * from the 62-degree chase camera and that the 40 m column is what carries the
 * distance, with a floor of 100 px of column at 150 m. This measures both
 * rather than believing either.
 *
 * METHOD, and why it is a measurement and not a screenshot:
 *   - the camera is placed exactly where `DreamIslandRuntime.updateCamera` puts
 *     it for a craft 300 / 150 / 40 m short of the COURT pickup (11.5 m back,
 *     4.8 m up, aimed 19 m ahead, FOV 62) — so "at 150 m" means the same thing
 *     here as it does in the race;
 *   - the scene is then drawn twice: once with ONLY the capsule's four nodes
 *     visible, once with ONLY the column, and once with nothing visible at all;
 *   - the pixel height is the bounding box of everything that differs from the
 *     blank frame, which cannot be confused with a bright cloud behind it.
 *
 * Day and night both, because the column is additive and the night is where it
 * has to work hardest.
 */
import {mkdir,writeFile} from 'node:fs/promises';
import {launchReviewBrowser} from '../tideline-v4/browser.mjs';
import {instrument} from './instrument.mjs';

const flag=name=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3);
const out=flag('out')??'art/evidence/dreamisland-v1/alive/code/capsule';
const base=flag('base')??'http://127.0.0.1:5200';
const DISTANCES=[300,150,40];
await mkdir(out,{recursive:true});

const browser=await launchReviewBrowser();
const rows=[];
try{
 const page=await browser.newPage(),errors=[];
 page.on('pageerror',e=>{errors.push(String(e));console.log(String(e));});
 page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.log(m.text());}});
 await instrument(page);
 await page.evaluateOnNewDocument(()=>{window.__diCaptureFrame=(renderer,args)=>{window.__diCamera=args[1];};});
 for(const blend of [0,1]){
  for(const distance of DISTANCES){
   // A FRESH PAGE PER POSE. The camera is pinned by redefining its position
   // accessors, which is what stops the render loop dragging it back to the
   // chase pose; that also makes it unmovable for the NEXT pose, and the first
   // run of this script duly reported the same 7 px capsule at 300 m, 150 m and
   // 40 m — three photographs of one camera.
   await page.goto(base+'/?map=dreamisland&diagnostics=1&start=manual&headless=1&quality=high&music=0&nightBlend='+blend,
    {waitUntil:'networkidle0',timeout:90000});
   await page.waitForFunction(()=>!!window.__diCourse?.capsules&&!!window.__diCamera,{timeout:90000});
   const meta=await page.evaluate(({distance})=>{
    const course=window.__diCourse,camera=window.__diCamera,V=camera.position.constructor;
    // The COURT pickup, which is the pose every measurement in this pass uses.
    const index=course.capsules.report.placements.findIndex(p=>p.id==='court-turbine');
    const placement=course.capsules.report.placements[index];
    const craftProgress=placement.progress-distance/course.length;
    const sample=course.sample((craftProgress%1+1)%1);
    const craft=sample.position.clone();
    const forward=sample.tangent.clone().normalize();
    const position=craft.clone().addScaledVector(forward,-11.5);position.y+=4.8;
    const look=craft.clone().addScaledVector(forward,19);look.y+=1.15;
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
    return {index,placement,craftProgress,
     capsuleDistanceMetres:placement.progress*course.length-craftProgress*course.length,
     cameraToCapsuleMetres:position.distanceTo(new V(0,0,0).copy(sample.position))};
   },{distance});
   const shoot=async(suffix,names)=>{
    await page.evaluate(names=>{
     // The DOM hide is re-applied for EVERY shot, not once per pose. The start
     // screen's own rows came back between two shots of one pose and landed in
     // the capsule's bounding box as a 443 x 761 px "capsule" at 150 m.
     const canvas=document.querySelector('canvas');
     for(const element of document.querySelectorAll('body *')){
      if(element!==canvas&&!element.contains(canvas)&&!canvas.contains(element))element.style.visibility='hidden';
     }
     window.__diScene.traverse(object=>{
      if(object.isMesh)object.visible=names.length>0&&names.some(name=>object.name.startsWith(name));
     });
     window.dispatchEvent(new Event('resize'));
    },names);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const file=`${out}/${blend?'night':'day'}-${distance}m-${suffix}.png`;
    // The CANVAS, not the page. Hiding the DOM element by element kept losing a
    // race with the start screen, which re-showed its own rows between two
    // shots of one pose; an element screenshot of the canvas cannot contain a
    // DOM node at all, whatever the shell does with its visibility.
    await (await page.$('canvas')).screenshot({path:file});
    return file;
   };
   const capsule=await shoot('capsule',['DI_CAPSULE_CAP_']);
   const column=await shoot('column',['DI_CAPSULE_column']);
   const ring=await shoot('ring',['DI_CAPSULE_ring']);
   const blank=await shoot('blank',[]);
   const full=await (async()=>{
    await page.evaluate(()=>{window.__diScene.traverse(object=>{if(object.isMesh)object.visible=true;});
     window.dispatchEvent(new Event('resize'));});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const file=`${out}/${blend?'night':'day'}-${distance}m-full.png`;
    await (await page.$('canvas')).screenshot({path:file});return file;
   })();
   rows.push({state:blend?'night':'day',distanceMetres:distance,
    craftProgress:meta.craftProgress,capsule,column,ring,blank,full});
   console.log((blend?'night':'day')+' '+distance+'m captured');
  }
 }
 await writeFile(out+'/capture.json',JSON.stringify({
  script:'scripts/visual/dreamisland/alive-capsule-pixels.mjs',base,viewport:'1280x720',
  camera:'DreamIslandRuntime.updateCamera: 11.5 m back, 4.8 m up, aimed 19 m ahead, FOV 62',
  pickup:'court-turbine (progress .575)',rows,errors},null,2)+'\n');
}finally{await browser.close();}
console.log('frames written to '+out+'; run alive-capsule-pixels.py to measure them');
