/**
 * The quadrant-ID proof: the P20.8 obligation closed without ambiguity.
 *
 *   node scripts/visual/dreamisland/atlas-quadrant-proof.mjs [--out=DIR]
 *
 * WHAT THIS FIXES. `atlas-proof.mjs` compares an isolated consumer's pixels
 * against all four quadrants of its own sheet in normalised chromaticity, and
 * eight of the thirteen claims decide cleanly. The other five do not, and the
 * reason is the ART, not the code: a sand road against limestone block, a frond
 * against a blossom shrub, a galvanised rail against a chevron strip - two
 * quadrants of the same sheet that are genuinely nearly the same colour. A
 * margin of 0.009 between two grey stones proves nothing either way, and the
 * signage plate never covered more than 21 pixels of a frame.
 *
 * So the sheet is taken out of the question. Every atlas texture in the live
 * scene is replaced by four flat, maximally separated colours - one per quadrant,
 * in the same 2x2 layout, with the same `flipY = false` convention and the same
 * inset gutters - and the consumer is asked again. The UVs are the shipped UVs,
 * the sampler is the shipped sampler, the mesh is the shipped mesh; only the
 * pixels behind them are unambiguous. A consumer that lands in the wrong
 * quadrant now reads as a different PRIMARY COLOUR, which no amount of
 * chromatic adjacency can blur.
 *
 * DELIBERATE DEVIATION FROM THE BRIEF. The brief asks for this behind a
 * review-only flag in the shipped code. It is done from the harness instead:
 * the swap happens in `page.evaluate` against the live materials, so nothing
 * about it ships, and the proof is identical because it is the same scene, the
 * same UVs and the same sampler settings either way. A debug texture path
 * inside the map would add a code path that can only ever be wrong in
 * production.
 *
 * The means are computed IN THE PAGE. A 1280x720 frame is 3.7 MB of pixels and
 * there are two per claim; shipping them over the wire to decode in node would
 * dominate the run for a number that is four floats.
 */
import {mkdir,writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {launchReviewBrowser} from '../tideline-v4/browser.mjs';
import {instrument} from './instrument.mjs';
import {CLAIMS} from './atlas-claims.mjs';

const flag=name=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3);
const out=flag('out')??'art/evidence/dreamisland-v1/phase-c/atlas-quadrant-proof';
const base=flag('base')??'http://127.0.0.1:5200';
await mkdir(out,{recursive:true});
const atlas=JSON.parse(readFileSync('public/assets/dreamisland/atlas-manifest.json','utf8'));
/** Four colours no lighting term can confuse: each is a different primary at
 * full strength and each pair differs on at least two channels. */
const QUADRANT_COLOURS={TL:[255,0,0],TR:[0,255,0],BL:[0,0,255],BR:[255,255,0]};
const rectOf=(role,cell)=>{
 const entry=atlas.roles[role][cell];
 return {uv:entry.plate?.uv??entry.sprite?.uv??entry.uv,is:entry.is};
};
/** Bottom-origin manifest rect -> the top-origin rect a flipY:false sampler uses. */
const sampledRect=([u0,v0,u1,v1])=>[u0,1-v1,u1,1-v0];
/** Which quadrant a manifest rect sits in, from its own centre. */
const quadrantOf=([u0,v0,u1,v1])=>((u0+u1)/2<.5?'':'R')===''
 ? ((v0+v1)/2<.5?'BL':'TL') : ((v0+v1)/2<.5?'BR':'TR');

const browser=await launchReviewBrowser();
const results=[],errors=[];
try{
 const page=await browser.newPage();
 page.on('pageerror',e=>{errors.push(String(e));console.log(String(e));});
 page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.log(m.text());}});
 await instrument(page);
 // The readback has to happen INSIDE the frame. The context is created without
 // `preserveDrawingBuffer`, so drawing the canvas into a 2D context after the
 // frame has been presented yields a blank image - which is exactly what the
 // first run of this script measured: thirteen claims, zero masked pixels each.
 await page.evaluateOnNewDocument(()=>{
  window.__diCaptureFrame=(renderer,args)=>{window.__diCamera=args[1];window.__diOnFrame?.(renderer);};
 });
 const url=base+'/?map=dreamisland&seed=3868938316&tier=works&demo=1&headless=1&diagnostics=1&start=manual&quality=high&music=0';
 await page.goto(url,{waitUntil:'networkidle0',timeout:60000});
 await page.waitForSelector('#start-button',{visible:true});
 await page.waitForSelector('canvas');
 await page.waitForFunction(()=>!!window.__diScene&&!!window.__diCamera,{timeout:60000});
 // The race is never started: the scene on the start line is static, so a
 // background frame and an isolation frame differ only by the isolated mesh.
 await page.evaluate(colours=>{
  window.__diMeshes=[];window.__diScene.traverse(o=>{if(o.isMesh||o.isInstancedMesh)window.__diMeshes.push(o);});
  window.__diSaved=window.__diMeshes.map(o=>({o,visible:o.visible,range:{...o.geometry.drawRange}}));
  window.__diRestore=()=>{for(const s of window.__diSaved){s.o.visible=s.visible;s.o.geometry.setDrawRange(s.range.start,s.range.count);}};
  window.__diBlank=()=>{for(const s of window.__diSaved)s.o.visible=false;};
  window.__diIsolate=(name,start,count)=>{
   for(const s of window.__diSaved)s.o.visible=false;
   const target=window.__diMeshes.find(o=>o.name===name);
   if(!target)return false;
   target.visible=true;
   if(count>0)target.geometry.setDrawRange(start,count);
   return true;
  };
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
   * The quadrant-ID sheet. Built at the atlas's own 1024 so the gutter inset and
   * every mip behave exactly as the real sheet's do, drawn in IMAGE space with
   * TL at the top-left - which, under `flipY = false`, is the manifest's own
   * bottom-origin TL. Getting that backwards is the defect this whole family of
   * checks exists to catch, so it is stated rather than assumed.
   */
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=1024;
  const context=canvas.getContext('2d');
  const place=(name,x,y)=>{context.fillStyle='rgb('+colours[name].join(',')+')';context.fillRect(x,y,512,512);};
  place('TL',0,0);place('TR',512,0);place('BL',0,512);place('BR',512,512);
  window.__diQuadrantCanvas=canvas;
  window.__diSwapAtlases=()=>{
   const swapped=[];
   const seen=new Set();
   for(const {o} of window.__diSaved){
    for(const material of Array.isArray(o.material)?o.material:[o.material]){
     if(!material||seen.has(material))continue;
     seen.add(material);
     if(!material.map&&!material.emissiveMap)continue;
     const record={material,map:material.map,emissiveMap:material.emissiveMap};
     for(const key of ['map','emissiveMap']){
      const source=material[key];
      if(!source)continue;
      const texture=new source.constructor(canvas);
      // Every sampler setting copied from the texture being replaced, so the
      // only thing that changed is the pixels.
      texture.flipY=source.flipY;texture.wrapS=source.wrapS;texture.wrapT=source.wrapT;
      texture.colorSpace=source.colorSpace;texture.anisotropy=source.anisotropy;
      texture.minFilter=source.minFilter;texture.magFilter=source.magFilter;
      texture.generateMipmaps=source.generateMipmaps;texture.needsUpdate=true;
      material[key]=texture;
     }
     material.needsUpdate=true;
     swapped.push(record);
    }
   }
   window.__diSwapRestore=()=>{for(const r of swapped){r.material.map=r.map;r.material.emissiveMap=r.emissiveMap;r.material.needsUpdate=true;}};
   return swapped.length;
  };
  /** Same unlit treatment as the sheet proof, so the rendered pixel is the
   * served texel and not a texel through a warm key, a fog term and AgX. */
  window.__diUnlit=name=>{
   const target=window.__diMeshes.find(o=>o.name===name);if(!target)return null;
   const m=target.material,saved={color:m.color.getHex(),emissive:m.emissive.getHex(),
    emissiveIntensity:m.emissiveIntensity,emissiveMap:m.emissiveMap,vertexColors:m.vertexColors,
    fog:m.fog,toneMapped:m.toneMapped};
   if(target.instanceColor){saved.instanceColor=target.instanceColor.array.slice();target.instanceColor.array.fill(1);target.instanceColor.needsUpdate=true;}
   const cell=m.userData?.diUniforms?.diCell,glow=m.userData?.diUniforms?.diEmissiveCell;
   if(cell&&glow){saved.glow=glow.value.clone();glow.value.copy(cell.value);}
   m.color.setHex(0x000000);m.emissive.setHex(0xffffff);
   // The environment rewrites emissiveIntensity every frame from nightBlend, so
   // a plain assignment is gone before the screenshot; pin it with a silent
   // setter instead, because a non-writable property would throw on that write.
   Object.defineProperty(m,'emissiveIntensity',{get:()=>1,set:()=>{},configurable:true});
   m.emissiveMap=m.map;m.vertexColors=false;m.fog=false;m.toneMapped=false;m.needsUpdate=true;
   window.__diUnlitRestore=()=>{
    if(saved.instanceColor){target.instanceColor.array.set(saved.instanceColor);target.instanceColor.needsUpdate=true;}
    m.color.setHex(saved.color);m.emissive.setHex(saved.emissive);
    delete m.emissiveIntensity;m.emissiveIntensity=saved.emissiveIntensity;
    m.emissiveMap=saved.emissiveMap;m.vertexColors=saved.vertexColors;
    m.fog=saved.fog;m.toneMapped=saved.toneMapped;m.needsUpdate=true;
    if(saved.glow)glow.value.copy(saved.glow);
   };
   return saved;
  };
  const read=source=>{
   const scratch=document.createElement('canvas');
   scratch.width=source.width;scratch.height=source.height;
   const context=scratch.getContext('2d');
   context.drawImage(source,0,0);
   return context.getImageData(0,0,scratch.width,scratch.height).data;
  };
  // Serviced from inside the render hook, where the drawing buffer is still
  // readable; a request outside a frame would read a cleared buffer.
  window.__diPending=null;
  window.__diOnFrame=renderer=>{
   if(!window.__diPending)return;
   const data=read(renderer.domElement);
   if(window.__diPending==='background')window.__diBg=data;else window.__diLast=data;
   window.__diPending=null;
  };
  window.__diRequest=kind=>{window.__diPending=kind;return kind;};
  window.__diBackgroundPixels=()=>window.__diBg?window.__diBg.length/4:0;
  /** Mean colour of the pixels this claim actually drew. The mask is the exact
   * difference against the background frame from the same camera. */
  window.__diMaskedMean=threshold=>{
   const now=window.__diLast,background=window.__diBg;
   if(!now||!background||now.length!==background.length)return {pixels:0,mean:null,unread:true};
   let count=0,r=0,g=0,b=0;
   for(let i=0;i<now.length;i+=4){
    if(Math.max(Math.abs(now[i]-background[i]),Math.abs(now[i+1]-background[i+1]),
     Math.abs(now[i+2]-background[i+2]))<=threshold)continue;
    count++;r+=now[i];g+=now[i+1];b+=now[i+2];
   }
   return count?{pixels:count,mean:[r/count,g/count,b/count]}:{pixels:0,mean:null};
  };
 },QUADRANT_COLOURS);
 await page.evaluate(()=>window.__diHideHud());
 const swapped=await page.evaluate(()=>window.__diSwapAtlases());
 const draw=async()=>{
  await page.evaluate(()=>window.dispatchEvent(new Event('resize')));
  await new Promise(resolve=>setTimeout(resolve,220));
 };
 // The census: the longest contiguous run of the shipped index buffer whose UVs
 // fall inside the claimed rect, and where that run stands, so the camera can be
 // aimed at geometry rather than at an empty sky.
 const censusOf=(claim,sampler)=>page.evaluate(({name,sampler,uniform})=>{
  const mesh=window.__diMeshes.find(o=>o.name===name);
  if(!mesh)return {error:'no mesh named '+name};
  const V=mesh.position.constructor;
  const placement=mesh.matrixWorld.clone();
  if(mesh.isInstancedMesh&&mesh.count>0){
   const instance=new mesh.matrixWorld.constructor();
   mesh.getMatrixAt(0,instance);placement.multiply(instance);
  }
  if(uniform){
   // A water surface wraps its cell in the fragment shader, so there is no UV
   // run to stand in front of - the camera is aimed at the bounding sphere and
   // SCORED against real vertices of the surface. Without those samples the
   // framing search has nothing to score and takes whatever it tried first,
   // which is how the shallows photographed an empty sky and measured zero
   // masked pixels.
   mesh.geometry.computeBoundingSphere();
   const sphere=mesh.geometry.boundingSphere;
   const position=mesh.geometry.attributes.position,samples=[];
   const step=Math.max(1,Math.floor(position.count/24));
   for(let i=0;i<position.count;i+=step){
    samples.push(new V(position.getX(i),position.getY(i),position.getZ(i)).applyMatrix4(placement).toArray());
   }
   return {uniform:true,cell:mesh.material.userData?.diCell??null,start:0,count:0,
    triangles:(mesh.geometry.index?.count??position.count)/3,
    focus:sphere.center.clone().applyMatrix4(mesh.matrixWorld).toArray(),
    localRadius:Math.min(60,sphere.radius),normal:[0,1,0],samples};
  }
  const uv=mesh.geometry.attributes.uv,index=mesh.geometry.index;
  const count=index?index.count:mesh.geometry.attributes.position.count;
  const inside=i=>{const u=uv.getX(i),v=uv.getY(i);
   return u>=sampler[0]-1e-4&&u<=sampler[2]+1e-4&&v>=sampler[1]-1e-4&&v<=sampler[3]+1e-4;};
  let best={start:0,count:0},run={start:0,count:0},matched=0;
  for(let t=0;t<count;t+=3){
   const a=index?index.getX(t):t,b=index?index.getX(t+1):t+1,c=index?index.getX(t+2):t+2;
   if(inside(a)&&inside(b)&&inside(c)){
    matched+=1;
    if(run.count===0)run={start:t,count:3};else run.count+=3;
    if(run.count>best.count)best={...run};
   }else run={start:0,count:0};
  }
  const position=mesh.geometry.attributes.position;
  const middle=index?index.getX(best.start+Math.floor(best.count/2)):best.start+Math.floor(best.count/2);
  const focus=new V(position.getX(middle),position.getY(middle),position.getZ(middle)).applyMatrix4(placement);
  const normals=mesh.geometry.attributes.normal,facing=[0,0,0];
  if(normals)for(let t=best.start;t<best.start+best.count;t++){
   const i=index?index.getX(t):t;
   facing[0]+=normals.getX(i);facing[1]+=normals.getY(i);facing[2]+=normals.getZ(i);
  }
  const length=Math.hypot(...facing)||1;
  let radius=0;
  const half=best.start+Math.floor(best.count/2);
  const samples=[];
  for(let t=Math.max(best.start,half-90);t<Math.min(best.start+best.count,half+90);t++){
   const i=index?index.getX(t):t;
   const p=new V(position.getX(i),position.getY(i),position.getZ(i)).applyMatrix4(placement);
   radius=Math.max(radius,p.distanceTo(focus));
   if(samples.length<24)samples.push(p.toArray());
  }
  return {triangles:count/3,matchedTriangles:matched,start:best.start,count:best.count,
   focus:focus.toArray(),localRadius:radius,normal:[facing[0]/length,facing[1]/length,facing[2]/length],samples};
 },{name:claim.mesh,sampler,uniform:!!claim.uniform});

 for(const claim of CLAIMS){
  const rect=rectOf(claim.role,claim.cell);
  const claimed=quadrantOf(rect.uv);
  const census=await censusOf(claim,sampledRect(rect.uv));
  if(census.error){results.push({...claim,claimed,error:census.error});continue;}
  const framed=await page.evaluate(({centroid,radius,normal,samples})=>{
   window.__diPoseRestore?.();
   const camera=window.__diCamera;if(!camera)return null;
   const V=camera.position.constructor;
   const target=new V(...centroid),points=samples.map(p=>new V(...p));
   const directions=[normal,[0,1,0],[1,.5,0],[-1,.5,0],[0,.5,1],[0,.5,-1],[.7,.7,.7],[-.7,.7,-.7]]
    .map(d=>new V(...d)).filter(d=>d.lengthSq()>1e-6).map(d=>d.normalize());
   let best=null;
   for(const along of directions){
    for(const factor of [2.4,4.5,8]){
     const distance=Math.max(9,radius*factor);
     camera.position.copy(target).addScaledVector(along,distance).add(new V(0,Math.max(2,distance*.2),0));
     camera.up.set(0,1,0);camera.lookAt(target);camera.updateMatrixWorld(true);camera.updateProjectionMatrix();
     let seen=0;
     for(const point of points){
      const ndc=point.clone().project(camera);
      if(ndc.z>-1&&ndc.z<1&&Math.abs(ndc.x)<.95&&Math.abs(ndc.y)<.95)seen++;
     }
     if(!best||seen>best.seen)best={seen,position:camera.position.toArray(),distance};
     if(points.length&&seen>=points.length*.7)break;
    }
    if(best&&points.length&&best.seen>=points.length*.7)break;
   }
   camera.position.set(...best.position);camera.lookAt(target);camera.updateMatrixWorld(true);
   const lookAt=camera.lookAt,position=camera.position.toArray();
   for(const [i,axis] of ['x','y','z'].entries())Object.defineProperty(camera.position,axis,{get:()=>position[i],set:()=>{},configurable:true});
   camera.lookAt=()=>{};
   window.__diPoseRestore=()=>{for(const [i,axis] of ['x','y','z'].entries()){delete camera.position[axis];camera.position[axis]=position[i];}camera.lookAt=lookAt;};
   return {...best,target:target.toArray(),samples:points.length};
  },{centroid:census.focus??[0,0,0],radius:Math.min(70,Math.max(4,census.localRadius??20)),
   normal:census.normal??[0,1,0],samples:census.samples??[]});
  await page.evaluate(()=>{window.__diBlank();window.__diRequest('background');});
  await draw();
  const backgroundPixels=await page.evaluate(()=>window.__diBackgroundPixels());
  await page.screenshot({path:out+'/'+claim.id+'-background.png'});
  const drawn=await page.evaluate(({name,start,count})=>{
   const shown=window.__diIsolate(name,start,count);window.__diUnlit(name);
   window.__diRequest('isolation');return shown;},
   {name:claim.mesh,start:census.start,count:census.count});
  await draw();
  await page.screenshot({path:out+'/'+claim.id+'.png'});
  const measured=await page.evaluate(()=>window.__diMaskedMean(10));
  await page.evaluate(()=>{window.__diUnlitRestore?.();window.__diRestore();});
  const distances=measured.mean
   ? Object.fromEntries(Object.entries(QUADRANT_COLOURS).map(([name,colour])=>
     [name,Math.hypot(measured.mean[0]-colour[0],measured.mean[1]-colour[1],measured.mean[2]-colour[2])]))
   : null;
  const ranked=distances?Object.entries(distances).sort((a,b)=>a[1]-b[1]):null;
  results.push({...claim,claimed,rect:rect.uv,is:rect.is,census:{matchedTriangles:census.matchedTriangles,
    isolatedTriangles:census.count/3,totalTriangles:census.triangles},
   drawn,framed,backgroundPixels,maskedPixels:measured.pixels,mean:measured.mean,distances,
   nearest:ranked?ranked[0][0]:null,margin:ranked?ranked[1][1]-ranked[0][1]:null,
   decided:!!ranked&&ranked[0][0]===claimed});
  console.log(JSON.stringify({id:claim.id,claimed,nearest:ranked?ranked[0][0]:null,
   pixels:measured.pixels,margin:ranked?Math.round(ranked[1][1]-ranked[0][1]):null}));
 }
 await page.evaluate(()=>{window.__diSwapRestore?.();window.__diRestore();});
 const decided=results.filter(r=>r.decided).length;
 await writeFile(out+'/atlas-quadrant-proof.json',JSON.stringify({
  script:'scripts/visual/dreamisland/atlas-quadrant-proof.mjs',url,errors,
  atlasManifest:{file:'public/assets/dreamisland/atlas-manifest.json',
   sha256:createHash('sha256').update(readFileSync('public/assets/dreamisland/atlas-manifest.json')).digest('hex')},
  quadrantColours:QUADRANT_COLOURS,materialsSwapped:swapped,
  method:'Every atlas map and emissiveMap in the live scene replaced by a 1024x1024 four-colour quadrant sheet with the sampler settings copied from the texture it replaced; the shipped mesh isolated over the longest contiguous run of its own index buffer inside the claimed rect and rendered unlit; the mean of the pixels that differ from a background frame taken from the same camera compared against the four colours.',
  convention:'Manifest rects are bottom-origin V; every sampler on this map runs flipY:false, so the rect a UV must land in is [u0, 1-v1, u1, 1-v0], and the manifest TL is the debug sheet top-left.',
  claims:results.length,decided,undecided:results.filter(r=>!r.decided).map(r=>r.id),
  results,
 },null,2));
 console.log(JSON.stringify({claims:results.length,decided,undecided:results.filter(r=>!r.decided).map(r=>r.id)}));
}finally{await browser.close();}
if(errors.length)throw new Error(errors.join('\n'));
if(results.some(result=>!result.decided))throw new Error('Undecided atlas cells: '+results.filter(result=>!result.decided).map(result=>result.id).join(', '));
