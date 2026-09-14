import {mkdir,writeFile} from 'node:fs/promises';
import {instrument} from './instrument.mjs';
import {launchReviewBrowser} from '../../../../scripts/visual/tideline-v4/browser.mjs';
const label=process.argv.find(a=>a.startsWith('--label='))?.slice(8)??'baseline';
const out=`art/evidence/dreamisland-v1/vs-design/${label}`;
await mkdir(out,{recursive:true});
const browser=await launchReviewBrowser(),rows=[],errors=[];
try{
 const page=await browser.newPage();await page.setViewport({width:1280,height:720});
 await instrument(page,{stage:label});
 page.on('pageerror',e=>{errors.push(String(e));console.log(String(e));});
 page.on('console',m=>{if(m.type()==='error')console.log(m.text());});
 await page.evaluateOnNewDocument(()=>{
  const raf=window.requestAnimationFrame.bind(window);window.__held=[];window.__hold=false;

  window.__resume=()=>{window.__hold=false;for(const callback of window.__held.splice(0))window.requestAnimationFrame(callback);};
  window.__poseIndex=0;
  window.__diCaptureFrame=(renderer,args,render)=>{
   const drive=window.__diDriving.at(-1),target=[.560,.735][window.__poseIndex];
   if(!drive||target===undefined||drive.progress<target||drive.progress>target+.006||window.__hold)return;
   for(const el of document.querySelectorAll('#app > *:not(#game-canvas)'))el.style.visibility='hidden';
   window.__hold=true;window.__poseIndex++;
   window.__shot={progress:drive.progress,tick:drive.tick,nightBlend:drive.nightBlend,camera:args[1].position.toArray(),quaternion:args[1].quaternion.toArray(),fov:args[1].fov};
   window.__render=()=>render(...args);window.__renderer=renderer;window.__camera=args[1];
  };
 });
 for(const blend of (process.argv.includes('--day-only')?[0]:process.argv.includes('--night-only')?[1]:[0,1])){
  const url='http://127.0.0.1:5200/?map=dreamisland&seed=3868938316&tier=works&laps=3&demo=1&headless=1&diagnostics=1&start=manual&quality=high&music=0'+(blend?'&nightBlend=1':'');
  await page.goto(url,{waitUntil:'networkidle0',timeout:60000});await page.click('#start-button');
  for(const pose of ['court','reef']){
   await page.waitForFunction(()=>window.__hold,{timeout:60000,polling:20}).catch(async error=>{console.log(await page.evaluate(()=>({hold:window.__hold,pose:window.__poseIndex,drive:window.__diDriving?.at(-1),frames:window.__diFrames?.length,diagnostics:document.getElementById('dreamisland-diagnostics')?.textContent,race:document.getElementById('futurisma-diagnostics')?.textContent})));throw error;});
   const name=`${pose}-${blend?'night':'day'}`;
   await page.screenshot({path:`${out}/${name}.png`});
   const meta=await page.evaluate(()=>({...window.__shot,meshes:window.__diDraws,glow:window.__diScene.getObjectByName('dreamisland_glow_sprites')?.userData}));rows.push({name,url,...meta});console.log(name,meta.progress);
   if(blend&&process.argv.includes('--trials'))for(const [size,intensity,column,opacity] of [[3.4,16,4.5,.35],[3.4,16,8,.35],[3.4,16,16,.35]]){
    await page.evaluate(({size,intensity,column,opacity})=>{
     const scene=window.__diScene,glow=scene.getObjectByName('dreamisland_glow_sprites');
     window.__trialRestore=[];
     const core=scene.getObjectByName('PR_bollard_core');const old=core.material.emissiveIntensity;
     core.material.emissiveIntensity=intensity;window.__trialRestore.push(()=>core.material.emissiveIntensity=old);
     const beam=scene.getObjectByName('DI_CAPSULE_column-night');const beamOpacity=beam.material.opacity;beam.material.opacity=1;window.__trialRestore.push(()=>beam.material.opacity=beamOpacity);const beamColor=beam.material.color.clone();beam.material.color.setScalar(column);window.__trialRestore.push(()=>beam.material.color.copy(beamColor));
     const original=glow.instanceMatrix.array.slice();
     const oldOpacity=glow.material.opacity;glow.material.opacity=opacity;window.__trialRestore.push(()=>glow.material.opacity=oldOpacity);
     const sea=scene.getObjectByName('dreamisland_sea'),beforeSea=sea.onBeforeRender;sea.onBeforeRender=()=>{};window.__trialRestore.push(()=>sea.onBeforeRender=beforeSea);
     for(let i=0;i<glow.count;i++){
      const matrix=glow.matrixWorld.clone();glow.getMatrixAt(i,matrix);const scale=glow.scale.clone().setFromMatrixScale(matrix);
      if(Math.abs(scale.x-4.5)>.001)for(let j=0;j<12;j++)glow.instanceMatrix.array[i*16+j]*=size/scale.x;
     }
     glow.instanceMatrix.needsUpdate=true;window.__trialRestore.push(()=>{glow.instanceMatrix.array.set(original);glow.instanceMatrix.needsUpdate=true;});
     window.__render();
    },{size,intensity,column,opacity});
    await page.screenshot({path:`${out}/${name}-trial-${size}-${column}-${opacity}.png`});
    await page.evaluate(()=>{for(const restore of window.__trialRestore)restore();window.__render();});
   }
   await page.evaluate(()=>window.__render());
   await page.screenshot({path:`${out}/${name}-control.png`});
   // Identical frozen scene/camera/time. Hide each source and its matching glow instances.
   if(blend&&process.argv.includes('--sources'))for(const source of ['bollard','column','capsule','fish','glow']){
    await page.evaluate(source=>{
     const scene=window.__diScene,glow=scene.getObjectByName('dreamisland_glow_sprites');window.__restore=[];
     const matches=o=>source==='bollard'?o.name==='PR_bollard_core':source==='column'?o.name==='DI_CAPSULE_column-night':source==='capsule'?o.name==='DI_CAPSULE_CAP_core':source==='fish'?/^DI_FISH.*_DI_MAT_emissive$/.test(o.name):o===glow;
     scene.traverse(o=>{if(matches(o)){window.__restore.push(()=>o.visible=true);const visible=o.visible;window.__restore[window.__restore.length-1]=()=>o.visible=visible;o.visible=false;}});
     // Source batches retain the order used by DreamIslandGlow.update.
     if(glow&&source!=='column'&&source!=='glow'){
      const original=glow.instanceMatrix.array.slice();let offset=0;
      const centres=[];
      scene.traverse(o=>{
       if(!o.isMesh||!matches(o)||source==='fish')return;
       o.geometry.computeBoundingBox();const centre=o.geometry.boundingBox.getCenter(o.position.clone());
       for(let i=0;i<(o.isInstancedMesh?o.count:1);i++){
        const matrix=o.matrixWorld.clone();if(o.isInstancedMesh){o.getMatrixAt(i,matrix);matrix.premultiply(o.matrixWorld);}
        centres.push(centre.clone().applyMatrix4(matrix));
       }
      });
      for(let i=0;i<glow.count;i++){
       const matrix=glow.matrixWorld.clone();glow.getMatrixAt(i,matrix);matrix.premultiply(glow.matrixWorld);
       const point=glow.position.clone().setFromMatrixPosition(matrix);
       // Fish halos have their unchanged 4.5 m size and no other source uses it.
       const size=glow.scale.clone().setFromMatrixScale(matrix).x;
       if(source==='fish'?Math.abs(size-4.5)<.001:centres.some(c=>c.distanceTo(point)<.001))glow.instanceMatrix.array.fill(0,i*16,i*16+16);
      }
      glow.instanceMatrix.needsUpdate=true;window.__restore.push(()=>{glow.instanceMatrix.array.set(original);glow.instanceMatrix.needsUpdate=true;});
     }
     window.__render();
    },source);
    await page.screenshot({path:`${out}/${name}-without-${source}.png`});
    await page.evaluate(()=>{for(const restore of window.__restore)restore();window.__render();});
   }
   if(process.argv.includes('--masks'))for(const group of ['sea','shallows','road','blank']){
    await page.evaluate(group=>{
     window.__visibility=[];window.__diScene.traverse(o=>{if(!o.isMesh&&!o.isPoints)return;window.__visibility.push([o,o.visible]);
      o.visible=group==='sea'?o.name==='dreamisland_sea':group==='shallows'?/dreamisland_(shallows|foam)$/.test(o.name):group==='road'?o.name==='dreamisland_blockout_road':false;
     });window.__render();
    },group);
    await page.screenshot({path:`${out}/${name}-${group}.png`});
    await page.evaluate(()=>{for(const [o,v] of window.__visibility)o.visible=v;window.__render();});
   }
   const end=await page.evaluate(()=>({held:window.__hold,camera:window.__camera.position.toArray(),progress:window.__diDriving.at(-1).progress}));
   if(!end.held||JSON.stringify(end.camera)!==JSON.stringify(meta.camera)||end.progress!==meta.progress)throw Error('Pose moved during capture: '+JSON.stringify({start:meta.progress,end}));
   await page.evaluate(()=>window.__resume());
  }
 }
 await writeFile(`${out}/${process.argv.includes('--night-only')?'night-captures':'captures'}.json`,JSON.stringify({rows,errors},null,2));
 if(errors.length)throw Error(errors.join('\n'));
}finally{await browser.close();}
