import {mkdir,writeFile} from 'node:fs/promises';
import {launchReviewBrowser} from '../tideline-v4/browser.mjs';
import {instrument} from './instrument.mjs';
const out=process.argv.find(a=>a.startsWith('--out='))?.slice(6)??'art/evidence/dreamisland-v1/polish-3/frames';
const requested=process.argv.find(a=>a.startsWith('--shots='))?.slice(8).split(',');
// `--base=`, defaulting to the 5200 this script has always used.
const base=process.argv.find(a=>a.startsWith('--base='))?.slice(7)??'http://127.0.0.1:5200';
await mkdir(out,{recursive:true});
const browser=await launchReviewBrowser();
const captures=[];
try{
 const page=await browser.newPage(),errors=[];
 page.on('pageerror',error=>{errors.push(String(error));console.error(String(error));});
 page.on('console',message=>{if(message.type()==='error')console.error(message.text());});
 await instrument(page);
 await page.evaluateOnNewDocument(()=>{window.__diCaptureFrame=(renderer,args)=>{window.__diCamera=args[1];};});
 for(const shot of [
  {id:'clock-before-strike',kind:'clock',blend:0,before:600,distance:40},
  {id:'clock-at-strike',kind:'clock',blend:0,before:0,distance:40},
  ...['surge','shield'].flatMap(kind=>[0,1].flatMap(blend=>[40,8].map(distance=>({id:kind+'-'+(blend?'night':'day')+'-'+distance+'m',kind,blend,distance})))),
  ...[0,15,30].map(openTicks=>({id:'shield-collected-'+openTicks+'ticks',kind:'shield',blend:1,distance:8,openTicks})),
  {id:'surge-half-charge',kind:'surge',blend:1,distance:8,charge:.5},
  ...[0,1].map(blend=>({id:'shield-moss-'+(blend?'night':'day'),kind:'shield',blend,distance:8,moss:true})),
  ...[0,1].map(blend=>({id:'shield-metal-'+(blend?'night':'day'),kind:'shield',blend,distance:8,body:true})),
  ...['surge','shield'].flatMap(kind=>[0,1].map(blend=>({id:kind+'-plate-'+(blend?'night':'day'),kind,blend,distance:8,plate:true}))),
 ]){
  if(requested&&!requested.includes(shot.id))continue;
  await page.goto(base+'/?map=dreamisland&diagnostics=1&start=manual&headless=1&quality=high&music=0&nightBlend='+shot.blend,{waitUntil:'networkidle0'});
  await page.waitForFunction(()=>!!window.__diCourse?.hardware&&!!window.__diCamera);
  const meta=await page.evaluate(shot=>{
   const course=window.__diCourse,scene=window.__diScene,camera=window.__diCamera,V=camera.position.constructor;
   const manifest=course.group.userData.hardware;
   const index=shot.kind==='shield'?1:0;
   const target=new V(),direction=new V();
   if(shot.kind==='clock'){
    const hand=scene.getObjectByName('clock_minute_hand');
    hand.updateWorldMatrix(true,false);target.setFromMatrixPosition(hand.matrixWorld);
    direction.set(0,0,-1).transformDirection(hand.matrixWorld);
    course.schedule.tick=course.schedule.config.strikeTick-shot.before;
   }else{
    target.fromArray(manifest.placements[index].position);target.y+=.8;
    const progress=shot.kind==='shield'?.205:.045,sample=course.sample(progress);
    const side=manifest.placements[index].hardwareLateral<0?-1:1;
    direction.copy(sample.right).multiplyScalar(-side).addScaledVector(sample.tangent,-.35).addScaledVector(sample.up,.25).normalize();
    if(shot.plate){
     target.copy(sample.position).addScaledVector(sample.right,manifest.placements[index].triggerLateral).addScaledVector(sample.up,.085);
     direction.copy(sample.tangent).multiplyScalar(-1).addScaledVector(sample.up,.8).normalize();
    }
    const states=Array.from({length:5},()=>({available:true,charge:1}));
    course.hardware.update(states,0,shot.blend);
    if(shot.openTicks!==undefined||shot.charge!==undefined){
     states[index]={available:shot.openTicks===undefined,charge:shot.charge??0};
     const update=course.hardware.update.bind(course.hardware);
     update(states,0,shot.blend);
     course.hardware.update=()=>update(states,shot.openTicks??0,shot.blend);
     course.hardware.update();
    }
   }
   const position=target.clone().addScaledVector(direction,shot.distance);
   camera.position.copy(position);camera.up.set(0,1,0);camera.lookAt(target);camera.fov=35;
   camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
   for(const axis of ['x','y','z']){const value=camera.position[axis];Object.defineProperty(camera.position,axis,{get:()=>value,set:()=>{},configurable:true});}
   camera.lookAt=()=>{};Object.defineProperty(camera,'fov',{get:()=>35,set:()=>{},configurable:true});
   const canvas=document.querySelector('canvas');
   for(const element of document.querySelectorAll('body *'))if(element!==canvas&&!element.contains(canvas)&&!canvas.contains(element))element.style.visibility='hidden';
   window.dispatchEvent(new Event('resize'));
   return {shot,position:position.toArray(),target:target.toArray(),distance:position.distanceTo(target),
    tick:course.schedule.tick,strikeTick:course.schedule.config.strikeTick,hardware:manifest};
  },shot);
  // Settle the shared lights by comparing measured intensities, not a frame count.
  meta.settle=await page.evaluate(async()=>{
   let stable=0,previous=null,polls=0;
   while(stable<6&&polls<200){
    window.dispatchEvent(new Event('resize'));
    const lights=[];window.__diScene.traverse(o=>{if(o.isLight)lights.push(o.intensity);});
    const current=JSON.stringify(lights.map(v=>Math.round(v*1e5)));
    stable=current===previous?stable+1:0;previous=current;polls++;
    await new Promise(resolve=>setTimeout(resolve,50));
   }
   return {stable,polls};
  });
  if(meta.settle.stable<6)throw Error('Lights did not settle');
  await page.screenshot({path:out+'/'+shot.id+'.png'});
  meta.applied=await page.evaluate(()=>({
   angles:window.__diCourse.group.userData.clockHands,
   hands:['hour','minute'].map(kind=>{const hand=window.__diScene.getObjectByName('clock_'+kind+'_hand');return {kind,angle:hand.userData.clockAngle,matrix:hand.matrix.toArray()};}),
   petalTint:(()=>{const c=window.__diScene.getObjectByName('DI_POWER_petals').geometry.attributes.color;return [c.getX(0),c.getY(0),c.getZ(0)];})(),
   petalMatrices:Array.from(window.__diScene.getObjectByName('DI_POWER_petals').instanceMatrix.array),
   coreColors:['surge','shield'].map(kind=>({kind,colors:Array.from(window.__diScene.getObjectByName('DI_POWER_core_'+kind).instanceColor.array)})),
   plates:['surge','shield'].map(kind=>{const p=window.__diScene.getObjectByName('DI_POWER_plate_'+kind);return {kind,cell:p.userData.atlasCell,height:p.userData.heightMetres,count:p.count,emissive:p.material.emissiveIntensity};}),
  }));
  if(shot.kind==='clock'){
   const fraction=(meta.strikeTick-shot.before)/meta.strikeTick;
   const expected=shot.before?fraction*Math.PI*2:0;
   if(Math.abs(meta.applied.angles.minute-expected)>1e-10)throw Error('Clock frame did not render its pinned schedule tick');
  }
  if(shot.kind!=='clock'&&shot.distance===8&&shot.openTicks===undefined){
   const name=shot.moss?'DI_POWER_DI_MAT_concrete':shot.body?'DI_POWER_petals':'DI_POWER_'+(shot.plate?'plate_':'core_')+shot.kind;
   await page.evaluate(name=>{
    window.__diVisibility=[];window.__diScene.traverse(object=>{
     if(object.isMesh){window.__diVisibility.push([object,object.visible]);object.visible=object.name===name;}
    });
    window.dispatchEvent(new Event('resize'));
   },name);
   if(shot.moss)await page.evaluate(()=>{
    const mesh=window.__diScene.getObjectByName('DI_POWER_DI_MAT_concrete'),g=mesh.geometry,c=g.attributes.color;
    const indices=g.index?Array.from(g.index.array):Array.from({length:g.attributes.position.count},(_,i)=>i),selected=[];
    for(let i=0;i<indices.length;i+=3){
     const triangle=indices.slice(i,i+3);
     if(triangle.every(v=>c.getX(v)<.99||c.getY(v)<.99||c.getZ(v)<.99))selected.push(...triangle);
    }
    if(!selected.length)throw Error('No moss triangles in the shipped concrete batch');
    mesh.geometry=g.clone();mesh.geometry.setIndex(selected);window.dispatchEvent(new Event('resize'));
   });
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   await page.screenshot({path:out+'/'+shot.id+'-isolation.png'});
   await page.evaluate(()=>{window.__diScene.traverse(object=>{if(object.isMesh)object.visible=false;});window.dispatchEvent(new Event('resize'));});
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   await page.screenshot({path:out+'/'+shot.id+'-blank.png'});
   await page.evaluate(()=>{for(const [object,visible] of window.__diVisibility)object.visible=visible;});
   meta.pixelRegion={full:shot.id+'.png',isolation:shot.id+'-isolation.png',blank:shot.id+'-blank.png',mesh:name};
  }
  captures.push(meta);console.log(shot.id,JSON.stringify(meta.applied.angles));
 }
 await writeFile(out+'/capture.json',JSON.stringify({script:'scripts/visual/dreamisland/polish3-frames.mjs',captures,errors},null,2)+'\n');
 if(errors.length)throw Error(errors.join('\n'));
}finally{await browser.close();}
