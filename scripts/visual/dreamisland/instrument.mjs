/** Read-only render instrumentation. Each row is one completed renderer call. */
export async function instrument(page,{grip,basinWidth}={}){
 await page.evaluateOnNewDocument(()=>{
  window.__diFrames=[];
  window.__diDriving=[];
  window.__diInstrument=renderer=>{
   let shadowCalls=0,shadowTriangles=0,last=performance.now();const tagged=new WeakSet();let draws=[];
   const shadowRender=renderer.shadowMap.render.bind(renderer.shadowMap);
   renderer.shadowMap.render=(...args)=>{const c=renderer.info.render.calls,t=renderer.info.render.triangles;const result=shadowRender(...args);shadowCalls+=renderer.info.render.calls-c;shadowTriangles+=renderer.info.render.triangles-t;return result;};
   // The night state's emissive terms, sampled off the LIVE materials every
   // frame. `?motion=reduce` must produce no per-frame emissive change after the
   // strike (decision 6: no flicker), and that is only checkable against the
   // values the renderer actually saw. Materials are found once; a name that
   // stops existing reads as null rather than as a silent zero.
   let emissiveSources=null;
   const emissiveSample=scene=>{
    if(!emissiveSources){
     emissiveSources=[];
     scene.traverse(o=>{
      if(!o.isMesh&&!o.isInstancedMesh)return;
      for(const m of Array.isArray(o.material)?o.material:[o.material]){
       if(!m||m.emissiveIntensity===undefined)continue;
       if(!/dreamisland_(foam|shallows)|DI_MAT_emissive/.test(m.name||''))continue;
       if(!emissiveSources.some(e=>e.material===m))emissiveSources.push({name:m.name,material:m});
      }
     });
    }
    return emissiveSources.map(e=>e.material.emissiveIntensity);
   };
   const render=renderer.render.bind(renderer);
   renderer.render=(...args)=>{draws=[];args[0].traverse(o=>{if(!o.isMesh||tagged.has(o))return;tagged.add(o);const previous=o.onBeforeRender;o.onBeforeRender=function(...a){previous.apply(this,a);draws.push({name:o.name,triangles:(o.geometry.index?.count??o.geometry.attributes.position.count)/3,castShadow:o.castShadow});};});shadowCalls=0;shadowTriangles=0;const result=render(...args),now=performance.now();window.__diScene=args[0];window.__diDraws=draws;
    const text=document.getElementById('dreamisland-diagnostics')?.textContent;let tick=0,grip=null,nightBlend=null,sector=null;try{const d=JSON.parse(text);tick=d.tick;grip=d.grip;nightBlend=d.nightBlend;sector=d.sector;}catch{}
    window.__diFrames.push({now,delta:now-last,tick,grip,nightBlend,sector,emissive:emissiveSample(args[0]),mainCalls:renderer.info.render.calls,shadowCalls,mainTriangles:renderer.info.render.triangles,shadowTriangles,width:renderer.domElement.width,height:renderer.domElement.height});last=now;window.__diCaptureFrame?.(renderer,args,render);
    window.__diEmissiveNames=emissiveSources?emissiveSources.map(e=>e.name):[];
    return result;
   };
  };
 });
 await page.setRequestInterception(true);
 page.on('request',async request=>{
  try{if(new URL(request.url()).pathname==='/src/game/game.ts'){
   const response=await fetch(request.url());let code=await response.text();const marker='this.renderer.outputColorSpace = THREE.SRGBColorSpace;';if(!code.includes(marker))throw Error('Missing renderer marker');
   code=code.replace(marker,marker+'\nwindow.__diInstrument(this.renderer);');await request.respond({status:response.status,contentType:'text/javascript',body:code});
  }else if(new URL(request.url()).pathname==='/src/game/dreamisland-course.ts'){
   const response=await fetch(request.url()),code=await response.text();
   await request.respond({status:response.status,contentType:'text/javascript',body:code+`
    const diBlend=Object.getOwnPropertyDescriptor(DreamIslandCourse.prototype,'nightBlend');
    Object.defineProperty(DreamIslandCourse.prototype,'nightBlend',{...diBlend,get(){window.__diCourse=this;return diBlend.get.call(this);}});
    ${basinWidth===undefined?'':`const diSample=DreamIslandCourse.prototype.sample;
    DreamIslandCourse.prototype.sample=function(...args){const sample=diSample.apply(this,args);
     if(sample.sector==='BASIN'){sample.width=${Number(basinWidth)};sample.halfWidth=sample.width/2;}return sample;};`}`});
  }else if(grip!==undefined&&new URL(request.url()).pathname==='/src/game/dreamisland-schedule.js'){
   const response=await fetch(request.url()),code=await response.text();
   await request.respond({status:response.status,contentType:'text/javascript',body:code+`
    const diOriginalGrip=DreamIslandSchedule.prototype.grip;
    DreamIslandSchedule.prototype.grip=function(...args){const value=diOriginalGrip.apply(this,args);return value<1?${Number(grip)}:value;};`});
  }else if(new URL(request.url()).pathname==='/src/game/totem-evolution.ts'){
   const response=await fetch(request.url()),code=await response.text();
   await request.respond({status:response.status,contentType:'text/javascript',body:code+`
    const diEvolutionUpdate=TotemEvolution.prototype.update;
    TotemEvolution.prototype.update=function(state){
     window.__diEvolution=this;window.__diPowerState={...state};
     return diEvolutionUpdate.call(this,window.__diPowerPose?{...state,...window.__diPowerPose}:state);
    };`});
  }else if(new URL(request.url()).pathname==='/src/game/autopilot.ts'){
   const response=await fetch(request.url());
   let code=await response.text();
   const marker='this.input.throttle = speed > desiredSpeed + 3 ? .18 : 1;';
   if(!code.includes(marker))throw Error('Missing braking instrument marker');
   code=code.replace(marker, 'window.__diDecision={approachingTurnLimit,desiredSpeed,brakingDistance,turnCue:turnCue?{...turnCue}:null};'+marker);
   await request.respond({status:response.status,contentType:'text/javascript',body:code+`
    const diRead=DemoAutopilot.prototype.read;
    DemoAutopilot.prototype.read=function(...args){
     const input=diRead.apply(this,args),course=this.course;
     if(course.kind==='dreamisland')window.__diDriving.push({
      tick:course.schedule.tick,elapsedMs:args[7],lap:args[5],progress:args[3],speed:args[4],
      sector:course.sectorLabelAt(args[3]),nightBlend:course.nightBlend,
      grip:course.surfaceGripAt(args[3]),fogDensity:course.fogAt(args[3]).density,
      brake:input.brake,throttle:input.throttle,boost:input.boost,lateral:this.projection.lateral,width:this.projection.width,decision:window.__diDecision});
     return input;
    };`});
  }else await request.continue();}catch(error){console.error(new URL(request.url()).pathname,String(error));await request.abort();}
 });
}
/** Peaks split by lighting state. The key light is armed once in
 * `installLighting` and nothing ever re-arms it, so the night state pays the
 * same shadow pass as the day one; this is where that gets measured rather than
 * assumed. `nightBlend` comes from the map's own diagnostics blob. */
function byLightingState(active){
 const state=rows=>rows.length===0?null:{frames:rows.length,
  peakMainCalls:Math.max(...rows.map(f=>f.mainCalls)),
  peakShadowCalls:Math.max(...rows.map(f=>f.shadowCalls)),
  minimumShadowCalls:Math.min(...rows.map(f=>f.shadowCalls)),
  peakTotalCalls:Math.max(...rows.map(f=>f.mainCalls+f.shadowCalls)),
  peakTriangles:Math.max(...rows.map(f=>f.mainTriangles)),
  peakShadowTriangles:Math.max(...rows.map(f=>f.shadowTriangles)),
  minimumShadowTriangles:Math.min(...rows.map(f=>f.shadowTriangles))};
 return {day:state(active.filter(f=>f.nightBlend===0)),
  crossfade:state(active.filter(f=>f.nightBlend!==null&&f.nightBlend>0&&f.nightBlend<1)),
  night:state(active.filter(f=>f.nightBlend===1)),
  note:'Split on the course own nightBlend. renderer.info.render.calls EXCLUDES the shadow pass, so the shadow columns come from wrapping shadowMap.render and differencing the counters around it.'};
}
/** Decision 6 forbids flicker under `?motion=reduce`. Once the blend has
 * settled at 1 no emissive intensity may move again; this counts the frames on
 * which one did, comparing consecutive settled frames. */
function emissiveStability(active){
 const settled=active.filter(f=>f.nightBlend===1&&Array.isArray(f.emissive));
 let changed=0,worst=0;
 for(let i=1;i<settled.length;i++){
  const before=settled[i-1].emissive,now=settled[i].emissive;
  if(before.length!==now.length){changed++;continue;}
  let delta=0;
  for(let k=0;k<now.length;k++)delta=Math.max(delta,Math.abs(now[k]-before[k]));
  if(delta>0){changed++;worst=Math.max(worst,delta);}
 }
 return {settledFrames:settled.length,comparisons:Math.max(0,settled.length-1),
  framesWithAnEmissiveChange:changed,largestChange:worst,
  values:settled.length?settled[settled.length-1].emissive:[],
  note:'Sampled off the live materials inside the render wrapper, so it is what the renderer saw, not what the course intended.'};
}
export function metrics(frames,calibration){
 const active=frames.filter(f=>f.tick>120),window=active.slice(-720),sorted=window.map(f=>f.delta).sort((a,b)=>a-b),windowMs=window.reduce((s,f)=>s+f.delta,0),activeWindowMs=active.reduce((s,f)=>s+f.delta,0);
 return {script:'scripts/visual/dreamisland/instrument.mjs',samples:active.length,activeWindowMs,activeExpectedSamples:activeWindowMs/1000*calibration.hz,activeSampleResidual:active.length-activeWindowMs/1000*calibration.hz,windowSamples:window.length,windowMs,calibration,expectedRateHz:calibration.hz,expectedSamples:windowMs/1000*calibration.hz,sampleResidual:window.length-windowMs/1000*calibration.hz,observedRateHz:window.length/windowMs*1000,p95Ms:sorted[Math.floor(sorted.length*.95)],peakMainCalls:Math.max(...active.map(f=>f.mainCalls)),peakShadowCalls:Math.max(...active.map(f=>f.shadowCalls)),peakTotalCalls:Math.max(...active.map(f=>f.mainCalls+f.shadowCalls)),peakTriangles:Math.max(...active.map(f=>f.mainTriangles)),peakShadowTriangles:Math.max(...active.map(f=>f.shadowTriangles)),sizes:[...new Set(active.map(f=>f.width+'x'+f.height))],
  lightingStates:byLightingState(active),emissiveStability:emissiveStability(active),
  schedule:{framesWithGripBelowOne:active.filter(f=>f.grip!==null&&f.grip<1).length,minimumGrip:Math.min(...active.map(f=>f.grip??1)),
   gripDropSectors:[...new Set(active.filter(f=>f.grip!==null&&f.grip<1).map(f=>f.sector))],
   maximumNightBlend:Math.max(...active.map(f=>f.nightBlend??0)),framesAtFullNight:active.filter(f=>f.nightBlend===1).length},note:'Expected rendering rate comes from a separate pre-start requestAnimationFrame calibration. Physics remains 120 Hz. Each sampled delta covers one render interval, including any stalls.'};
}
