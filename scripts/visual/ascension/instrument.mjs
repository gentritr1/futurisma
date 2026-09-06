/** Read-only render instrumentation. Each row is one completed renderer call. */
export async function instrument(page){
 await page.evaluateOnNewDocument(()=>{
  window.__ascFrames=[];
  window.__ascInstrument=renderer=>{
   let shadowCalls=0,shadowTriangles=0,last=performance.now();const tagged=new WeakSet();let draws=[];
   const shadowRender=renderer.shadowMap.render.bind(renderer.shadowMap);
   renderer.shadowMap.render=(...args)=>{const c=renderer.info.render.calls,t=renderer.info.render.triangles;const result=shadowRender(...args);shadowCalls+=renderer.info.render.calls-c;shadowTriangles+=renderer.info.render.triangles-t;return result;};
   const render=renderer.render.bind(renderer);
   renderer.render=(...args)=>{draws=[];args[0].traverse(o=>{if(!o.isMesh||tagged.has(o))return;tagged.add(o);const previous=o.onBeforeRender;o.onBeforeRender=function(...a){previous.apply(this,a);draws.push({name:o.name,triangles:(o.geometry.index?.count??o.geometry.attributes.position.count)/3,castShadow:o.castShadow});};});shadowCalls=0;shadowTriangles=0;const result=render(...args),now=performance.now();window.__ascScene=args[0];window.__ascDraws=draws;
    const text=document.getElementById('ascension-diagnostics')?.textContent;let tick=0,effects=null;try{const d=JSON.parse(text);tick=d.tick;effects=d.effects??null;}catch{}
    window.__ascFrames.push({now,delta:now-last,tick,effects,mainCalls:renderer.info.render.calls,shadowCalls,mainTriangles:renderer.info.render.triangles,shadowTriangles,width:renderer.domElement.width,height:renderer.domElement.height});last=now;return result;
   };
  };
 });
 await page.setRequestInterception(true);
 page.on('request',async request=>{
  try{if(new URL(request.url()).pathname==='/src/game/game.ts'){
   const response=await fetch(request.url());let code=await response.text();const marker='this.renderer.outputColorSpace = THREE.SRGBColorSpace;';if(!code.includes(marker))throw Error('Missing renderer marker');
   code=code.replace(marker,marker+'\nwindow.__ascInstrument(this.renderer);');await request.respond({status:response.status,contentType:'text/javascript',body:code});
  }else await request.continue();}catch{await request.abort();}
 });
}
export function metrics(frames,calibration){
 const active=frames.filter(f=>f.tick>120),window=active.slice(-720),sorted=window.map(f=>f.delta).sort((a,b)=>a-b),windowMs=window.reduce((s,f)=>s+f.delta,0),activeWindowMs=active.reduce((s,f)=>s+f.delta,0);
 return {script:'scripts/visual/ascension/instrument.mjs',samples:active.length,activeWindowMs,activeExpectedSamples:activeWindowMs/1000*calibration.hz,activeSampleResidual:active.length-activeWindowMs/1000*calibration.hz,windowSamples:window.length,windowMs,calibration,expectedRateHz:calibration.hz,expectedSamples:windowMs/1000*calibration.hz,sampleResidual:window.length-windowMs/1000*calibration.hz,observedRateHz:window.length/windowMs*1000,p95Ms:sorted[Math.floor(sorted.length*.95)],peakMainCalls:Math.max(...active.map(f=>f.mainCalls)),peakShadowCalls:Math.max(...active.map(f=>f.shadowCalls)),peakTotalCalls:Math.max(...active.map(f=>f.mainCalls+f.shadowCalls)),peakTriangles:Math.max(...active.map(f=>f.mainTriangles)),peakShadowTriangles:Math.max(...active.map(f=>f.shadowTriangles)),sizes:[...new Set(active.map(f=>f.width+'x'+f.height))],note:'Expected rendering rate comes from a separate pre-start requestAnimationFrame calibration. Physics remains 120 Hz. Each sampled delta covers one render interval, including any stalls.'};
}
