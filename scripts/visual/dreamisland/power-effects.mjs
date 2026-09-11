import {mkdir,writeFile} from 'node:fs/promises';
import {launchReviewBrowser} from '../tideline-v4/browser.mjs';
import {instrument} from './instrument.mjs';
const out=process.argv.find(argument=>argument.startsWith('--out='))?.slice(6)??'art/evidence/dreamisland-v1/polish-3/hardware/effects';
await mkdir(out,{recursive:true});
const browser=await launchReviewBrowser(),captures=[];
try{
 const page=await browser.newPage();await instrument(page);
 await page.evaluateOnNewDocument(()=>{window.__diCaptureFrame=(_renderer,args)=>{window.__diCamera=args[1];};});
 for(const kind of ['surge','shield']){
  await page.goto('http://127.0.0.1:5200/?map=dreamisland&start=manual&headless=1&diagnostics=1&motion=reduce&nightBlend=0&music=0',{waitUntil:'networkidle0'});
  await page.waitForFunction(()=>!!window.__diEvolution&&!!window.__diCourse?.hardware);
  const meta=await page.evaluate(kind=>{
   const evolution=window.__diEvolution,camera=window.__diCamera,V=camera.position.constructor;
   window.__diPowerPose={overdriveActive:kind==='surge',shieldActive:kind==='shield',boostActive:false,
    throttle:1,powerCharge:1,powerActivation:1,elapsed:2,reducedMotion:true};
   evolution.root.updateWorldMatrix(true,false);
   const target=evolution.root.getWorldPosition(new V()).add(new V(0,.4,0));
   const position=target.clone().add(new V(5,3,8).normalize().multiplyScalar(8));
   camera.position.copy(position);camera.up.set(0,1,0);camera.lookAt(target);camera.fov=45;camera.updateProjectionMatrix();
   for(const axis of ['x','y','z']){const value=camera.position[axis];Object.defineProperty(camera.position,axis,{get:()=>value,set:()=>{},configurable:true});}
   camera.lookAt=()=>{};Object.defineProperty(camera,'fov',{get:()=>45,set:()=>{},configurable:true});
   const canvas=document.querySelector('canvas');
   for(const element of document.querySelectorAll('body *'))if(element!==canvas&&!element.contains(canvas))element.style.visibility='hidden';
   return {kind,target:target.toArray(),position:position.toArray(),distance:position.distanceTo(target)};
  },kind);
  await page.evaluate(async()=>{for(let i=0;i<40;i++){
   window.__diEvolution.update({...window.__diPowerState,delta:1/120});window.dispatchEvent(new Event('resize'));
   await new Promise(resolve=>requestAnimationFrame(resolve));
  }});
  await page.evaluate(()=>{window.__diEvolution.update=()=>{};});
  meta.material=await page.evaluate(kind=>{const e=window.__diEvolution,m=kind==='surge'?e.jetMaterial:e.shieldMaterial;
   return {name:m.name,toneMapped:m.toneMapped,fog:m.fog,color:m.uniforms.uColor.value.toArray()};},kind);
  await page.screenshot({path:out+'/'+kind+'.png'});
  await page.evaluate(kind=>{const e=window.__diEvolution,mesh=kind==='surge'?e.jets:e.shield;
   Object.defineProperty(mesh,'visible',{get:()=>false,set:()=>{},configurable:true});window.dispatchEvent(new Event('resize'));
  },kind);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.screenshot({path:out+'/'+kind+'-off.png'});
  captures.push(meta);
 }
 await writeFile(out+'/capture.json',JSON.stringify({script:'scripts/visual/dreamisland/power-effects.mjs',captures},null,2)+'\n');
}finally{await browser.close();}
