import {mkdir,writeFile} from 'node:fs/promises';
import {launchReviewBrowser} from './browser.mjs';
const base=process.argv[2]??'http://127.0.0.1:5200';
const out=process.argv[3]??'art/evidence/tideline-v4/race';
const reduced=process.argv.includes('--reduced');
await mkdir(out,{recursive:true});
const browser=await launchReviewBrowser();
try {
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.log(m.text());}else if(m.text().startsWith('__V4_PROGRESS'))console.log(m.text());});
 // Instrument the real renderer, without changing scene state, clock or materials.
 await page.evaluateOnNewDocument(trace=>{
  window.__v4Frames=[];window.__v4MotionSamples=[];window.__v4InstrumentRenderer=renderer=>{
   let shadowCalls=0,shadowTriangles=0;
   const shadows=renderer.shadowMap.render.bind(renderer.shadowMap);
   renderer.shadowMap.render=(...args)=>{const calls=renderer.info.render.calls,triangles=renderer.info.render.triangles;const result=shadows(...args);shadowCalls+=renderer.info.render.calls-calls;shadowTriangles+=renderer.info.render.triangles-triangles;return result;};
   const render=renderer.render.bind(renderer);let last=performance.now();
   renderer.render=(...args)=>{window.__v4Scene=args[0];shadowCalls=0;shadowTriangles=0;const result=render(...args),now=performance.now();
    const text=document.getElementById('time-value')?.textContent??'';const match=/^(\d+):(\d+)\.(\d+)$/.exec(text);
    const raceMs=match?Number(match[1])*60000+Number(match[2])*1000+Number(match[3]):0;
    window.__v4Frames.push({now,delta:now-last,raceMs,mainCalls:renderer.info.render.calls,mainTriangles:renderer.info.render.triangles,shadowCalls,shadowTriangles,width:renderer.domElement.width,height:renderer.domElement.height});last=now;
    if(window.__v4Frames.length%120===0){
     const sample={raceMs,swings:[],beacons:[],skyTimes:[],domes:[],strobesUniform:[],heatVisible:[]};
     args[0].traverse(object=>{
      if(object.name==='cradle_suspended_hook')sample.swings.push(object.rotation.z);
      if(object.name==='cradle_rotating_hazard_beacon')sample.beacons.push(object.rotation.y);
      if(object.name==='tideline_refinery_horizon')sample.skyTimes.push(object.material.uniforms.time.value);
      if(object.name==='tideline_refund_hex_dome')sample.domes.push({opacity:object.material.opacity,emission:object.material.emissiveIntensity});
      if(object.name==='surge_trailing_heat_cone')sample.heatVisible.push(object.visible);
      if(object.name==='bulkhead_warning_status_lamps'){const colors=object.instanceColor.array;sample.strobesUniform.push(Array.from(colors).every((value,index)=>value===colors[index%3]));}
     });
     window.__v4MotionSamples.push(sample);
    }
    if(trace&&window.__v4Frames.length%120===0)console.log('__V4_PROGRESS '+JSON.stringify({raceMs,calls:renderer.info.render.calls,triangles:renderer.info.render.triangles}));return result;
   };
  };
 },process.argv.includes('--trace'));
 await page.setRequestInterception(true);
 page.on('request',async request=>{
  try {
   if(new URL(request.url()).pathname==='/src/game/game.ts'){
    const response=await fetch(request.url());let code=await response.text();
    const marker='this.renderer.outputColorSpace = THREE.SRGBColorSpace;';
    if(!code.includes(marker))throw Error('Renderer instrumentation marker missing');
    code=code.replace(marker,marker+'\nwindow.__v4InstrumentRenderer(this.renderer);');
    await request.respond({status:response.status,contentType:'text/javascript',body:code});
   }else await request.continue();
  }catch(error){errors.push(String(error));await request.abort();}
 });
 const url=base+'/?map=tideline&seed=3868938316&demo=1&headless=1&diagnostics=1&start=manual&quality=high&music=0'+(reduced?'&motion=reduce':'');
 await page.goto(url,{waitUntil:'networkidle0',timeout:60000});await page.waitForSelector('#start-button',{visible:true,timeout:30000});
 const calibration=await page.evaluate(()=>new Promise(resolve=>{const samples=[];const tick=t=>{samples.push(t);if(samples.length<121)requestAnimationFrame(tick);else resolve({samples:120,windowMs:samples.at(-1)-samples[0],hz:120000/(samples.at(-1)-samples[0])});};requestAnimationFrame(tick);}));
 await page.click('#start-button');
 await page.waitForFunction(()=>{try{return JSON.parse(document.getElementById('futurisma-diagnostics').textContent).current.phase==='finished';}catch{return false;}},{timeout:240000});
 const materials=await page.evaluate(()=>{const rows=[];window.__v4Scene.traverse(o=>{if(!o.userData.tidelineGameplay)return;for(const m of Array.isArray(o.material)?o.material:[o.material])rows.push({object:o.name,material:m.name,type:m.type,toneMapped:m.toneMapped,fog:m.fog});});return rows;});
 await writeFile(out+'/material-walk.json',JSON.stringify({script:'scripts/visual/tideline-v4/race.mjs',materials,accepted:materials.every(m=>m.toneMapped!==false&&m.fog!==false)},null,2));
 const capture=await page.evaluate(()=>({frames:window.__v4Frames,motionSamples:window.__v4MotionSamples,diagnostics:JSON.parse(document.getElementById('futurisma-diagnostics').textContent),tide:JSON.parse(document.getElementById('tideline-diagnostics').textContent)}));
 if(reduced){
  const samples=capture.motionSamples.filter(s=>s.raceMs>500),issues=[];
  for(const sample of samples){
   if(!sample.swings.length||sample.swings.some(v=>v!==0))issues.push('Cradle swing');
   if(sample.beacons.some(v=>v!==0))issues.push('Rotating beacon');
   if(!sample.skyTimes.length||sample.skyTimes.some(v=>v!==0))issues.push('Cloud scroll');
   if(sample.strobesUniform.some(v=>!v))issues.push('Alternating door strobe');
   if(sample.heatVisible.some(Boolean))issues.push('Heat distortion');
   if(sample.domes.some(d=>![.13,.4].some(v=>Math.abs(d.opacity-v)<1e-6)||![.32,1.25].some(v=>Math.abs(d.emission-v)<1e-6)))issues.push('Dome pulse');
  }
  await writeFile(out+'/motion-audit.json',JSON.stringify({script:'scripts/visual/tideline-v4/race.mjs',cadence:'One read-only scene walk every 120 rendered frames.',samples:samples.length,issues:[...new Set(issues)],accepted:samples.length>0&&issues.length===0},null,2));
  if(issues.length)throw Error('Reduced motion audit failed: '+issues.join(', '));
 }
 const race=capture.frames.filter(f=>f.raceMs>500&&f.raceMs<capture.diagnostics.current.lapTimesMs.reduce((a,b)=>a+b,0));
 const window=race.slice(-720),ordered=window.map(f=>f.delta).sort((a,b)=>a-b);
 const sampleWindowMs=window.reduce((sum,f)=>sum+f.delta,0);
 const metrics={script:'scripts/visual/tideline-v4/race.mjs',url,calibration,frames:race.length,windowSamples:window.length,sampleWindowMs,expectedSamples:sampleWindowMs/1000*calibration.hz,observedRate:window.length/sampleWindowMs*1000,p95Ms:ordered[Math.floor(ordered.length*.95)],peakMainCalls:Math.max(...race.map(f=>f.mainCalls)),peakShadowCalls:Math.max(...race.map(f=>f.shadowCalls)),peakMainTriangles:Math.max(...race.map(f=>f.mainTriangles)),peakShadowTriangles:Math.max(...race.map(f=>f.shadowTriangles)),internalSizes:[...new Set(race.map(f=>f.width+'x'+f.height))],errors};
 await writeFile(out+'/capture.json',JSON.stringify(capture));await writeFile(out+'/metrics.json',JSON.stringify(metrics,null,2));await page.screenshot({path:out+'/finish.png'});console.log(JSON.stringify({metrics,lapTimes:capture.diagnostics.current.lapTimesMs,classification:capture.diagnostics.current.finalClassification}));
 if(errors.length)throw Error('Browser errors recorded');
}finally{await browser.close();}
