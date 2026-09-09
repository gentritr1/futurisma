/**
 * Rendered-pixel atlas proof for Dream Island (the P20.8 rule).
 *
 *   node scripts/visual/dreamisland/atlas-proof.mjs [--out=DIR]
 *
 * THE CLAIM UNDER TEST: each consumer draws the atlas quadrant it NAMES.
 * Reading the rect out of a manifest and nodding does not test it. The defect
 * this replaces is exactly that kind: the road's UVs named the road-sand
 * quadrant and the SAMPLER's V convention put them on the cyan kerb stone one
 * quadrant below, so a sand road drew teal. The manifest was right, the code was
 * right on its own terms, and only pixels showed the disagreement.
 *
 * So this renders, and it renders the SHIPPED scene: the real map loads, and for
 * each claim the live mesh is isolated by `setDrawRange` over the longest
 * contiguous run of its own index buffer whose UVs fall inside the claimed rect,
 * with every other mesh hidden.
 *
 * It does NOT race. Three earlier versions did, and all three failed the same
 * way: a claim can only be photographed while its geometry is in front of the
 * craft, the waiting costs laps, and once the race passes `night-settled` the
 * fog and the clear colour move under the measurement. Here the scene is left on
 * the start line, where it is completely static, and the CAMERA is moved to each
 * claim instead. A background frame is taken from the same camera, so the mask
 * is exactly the pixels that consumer drew and nothing else.
 *
 * The mask's mean is then compared, in normalised chromaticity (r/(r+g+b),
 * g/(r+g+b)) so that lighting and fog move luma without moving the answer,
 * against ALL FOUR quadrants of that role decoded straight out of the served
 * texture file. PASS = the nearest quadrant is the one claimed.
 *
 * Both artefacts are written: `atlas-proof.json` (the rects, the census, the
 * chromaticity distances) and one PNG per claim.
 */
import {mkdir,writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {launchReviewBrowser} from '../tideline-v4/browser.mjs';
import {instrument} from './instrument.mjs';

const flag=name=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3);
const out=flag('out')??'art/evidence/dreamisland-v1/phase-b/atlas-proof';
const base=flag('base')??'http://127.0.0.1:5200';
await mkdir(out,{recursive:true});
const atlas=JSON.parse(readFileSync('public/assets/dreamisland/atlas-manifest.json','utf8'));
const route=JSON.parse(readFileSync('src/game/data/dreamisland/route.json','utf8'));

/** The claims. `mesh` is the live object, `role`/`cell` the quadrant it names. */
// `at` is the progress window the claim's geometry is actually in front of the
// camera. Ordered around one lap so a single race captures all thirteen: a
// claim isolated where its geometry is behind the camera measures the clear
// colour and proves nothing, which is what the first run of this script did.
const CLAIMS=[
 {id:'road-deck',mesh:'dreamisland_blockout_road',role:'concrete',cell:'road-sand',at:[.03,.06],
  is:'The road ribbon draws the sand road surface.'},
 {id:'kerb',mesh:'dreamisland_blockout_road',role:'concrete',cell:'kerb-cyan',at:[.06,.09],
  is:'The kerbs draw the cyan-striped kerb stone.'},
 {id:'foam',mesh:'dreamisland_foam',role:'water',cell:'foam-gradient',uniform:true,at:[.09,.115],
  is:'The foam line draws the foam gradient.'},
 {id:'sea',mesh:'dreamisland_sea',role:'water',cell:'cobalt-facets',uniform:true,at:[.13,.16],
  is:'The open sea draws the cobalt facet swell.'},
 {id:'palm-bark',mesh:'DI_STATIC_DI_MAT_jungle',role:'jungle',cell:'bark',at:[.17,.20],
  is:'The palm trunks draw the segmented bark.'},
 {id:'frond-card',mesh:'DI_STATIC_DI_MAT_jungle-card',role:'jungle-card',cell:'frond',at:[.21,.24],
  is:'The palm crowns draw the frond sprite.'},
 {id:'sand-verge',mesh:'DI_STATIC_DI_MAT_jungle',role:'jungle',cell:'sand',at:[.25,.28],
  is:'The verge draws the beach sand.'},
 {id:'gate-markers',mesh:'dreamisland_blockout_markers',role:'metal',cell:'rail',at:[.36,.39],
  is:'The gate, strip and device markers draw the galvanised rail.'},
 {id:'causeway-paving',mesh:'DI_STATIC_DI_MAT_concrete',role:'concrete',cell:'causeway-paving',at:[.42,.47],
  is:'The causeway deck and the clock plinth draw the paving.'},
 {id:'clock-face',mesh:'DI_STATIC_DI_MAT_emissive',role:'emissive',cell:'clock-face',at:[.55,.60],
  is:'The clock face draws the lit face.'},
 {id:'shallows',mesh:'dreamisland_shallows',role:'water',cell:'caustic-shallows',uniform:true,at:[.70,.76],
  is:'The shallows draw the caustic web.'},
 {id:'wall-block',mesh:'DI_STATIC_DI_MAT_concrete',role:'concrete',cell:'wall-block',at:[.88,.93],
  is:'The cut walls and the sea stacks draw the limestone wall block.'},
 {id:'signage-plate',mesh:'DI_STATIC_DI_MAT_signage',role:'signage',cell:'plate-dream-island',at:[.975,.995],
  is:'The place plate draws the DREAM ISLAND plate.'},
];
/** Manifest rects, in the manifest's own bottom-origin V. */
const rectOf=(role,cell)=>{
 const entry=atlas.roles[role][cell];
 const uv=entry.plate?.uv??entry.sprite?.uv??entry.uv;
 return {uv,is:entry.is};
};
/** Bottom-origin manifest rect -> the top-origin rect a flipY:false sampler uses. */
const sampledRect=([u0,v0,u1,v1])=>[u0,1-v1,u1,1-v0];

const browser=await launchReviewBrowser();
try{
 const page=await browser.newPage(),errors=[];
 page.on('pageerror',e=>{errors.push(String(e));console.log(String(e));});
 page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.log(m.text());}});
 await instrument(page);
 // The instrument hands every rendered frame to this hook; the camera is what
 // decides whether a claim's geometry is in front of the lens.
 await page.evaluateOnNewDocument(()=>{window.__diCaptureFrame=(renderer,args)=>{window.__diCamera=args[1];};});
 const url=base+'/?map=dreamisland&seed=3868938316&tier=works&demo=1&headless=1&diagnostics=1&start=manual&quality=high&music=0';
 await page.goto(url,{waitUntil:'networkidle0',timeout:60000});
 await page.waitForSelector('#start-button',{visible:true});
 // The race is never started. The scene on the start line is fully loaded and
 // completely static, which is the whole point: nothing moves under the
 // measurement between a background frame and its isolation frame.
 await page.waitForFunction(()=>!!document.getElementById('dreamisland-diagnostics'),{timeout:60000}).catch(()=>{});
 await page.waitForSelector('canvas');
 await page.evaluate(()=>{
  window.__diMeshes=[];window.__diScene.traverse(o=>{if(o.isMesh||o.isInstancedMesh)window.__diMeshes.push(o);});
  window.__diSaved=window.__diMeshes.map(o=>({o,visible:o.visible,range:{...o.geometry.drawRange}}));
  window.__diRestore=()=>{for(const s of window.__diSaved){s.o.visible=s.visible;s.o.geometry.setDrawRange(s.range.start,s.range.count);}};
  window.__diIsolate=(name,start,count)=>{
   for(const s of window.__diSaved)s.o.visible=false;
   const target=window.__diMeshes.find(o=>o.name===name);
   if(!target)return false;
   target.visible=true;
   if(count>0)target.geometry.setDrawRange(start,count);
   return true;
  };
  window.__diBlank=()=>{for(const s of window.__diSaved)s.o.visible=false;};
  // The HUD is DOM, not canvas, so it composites into every screenshot and its
  // clock digits change between frames. Hidden for the duration, it takes the
  // only moving part of the background out of the mask, which lets ONE
  // everything-hidden frame serve as the background for every claim.
  window.__diHudHidden=[];
  window.__diHideHud=()=>{
   const canvas=document.querySelector('canvas');
   for(const element of document.querySelectorAll('body *')){
    if(element===canvas||element.contains(canvas)||canvas.contains(element))continue;
    if(element.style.visibility==='hidden')continue;
    window.__diHudHidden.push([element,element.style.visibility]);element.style.visibility='hidden';
   }
  };
  window.__diShowHud=()=>{for(const [element,value] of window.__diHudHidden)element.style.visibility=value;window.__diHudHidden=[];};
  // The measurement is about WHICH RECT the shipped UVs address, so for the
  // isolation frames the shipped material is driven unlit: the map is moved onto
  // the emissive channel with a black base colour, fog and tone mapping off, and
  // the vertex tint off. The rendered pixel is then the served texel, and the
  // comparison against the file is not fighting a warm key light, a fog term, an
  // AgX curve and a moss tint at the same time. Every restore is exact.
  window.__diUnlit=name=>{
   const target=window.__diMeshes.find(o=>o.name===name);if(!target)return null;
   const m=target.material,saved={color:m.color.getHex(),emissive:m.emissive.getHex(),
    emissiveIntensity:m.emissiveIntensity,emissiveMap:m.emissiveMap,vertexColors:m.vertexColors,
    fog:m.fog,toneMapped:m.toneMapped};
   const cell=m.userData?.diUniforms?.diCell,glow=m.userData?.diUniforms?.diEmissiveCell;
   if(cell&&glow){saved.glow=glow.value.clone();glow.value.copy(cell.value);}
   m.color.setHex(0x000000);m.emissive.setHex(0xffffff);
   // The environment drives emissiveIntensity from nightBlend EVERY FRAME, so a
   // plain assignment here is overwritten before the screenshot and the surface
   // renders black. The first run of this script measured exactly that on the
   // shallows. Pin the property for the duration instead.
   // A non-writable value would THROW on the environment's next write (the
   // module is strict); a silent setter absorbs it instead.
   Object.defineProperty(m,'emissiveIntensity',{get:()=>1,set:()=>{},configurable:true});
   m.emissiveMap=m.map;m.vertexColors=false;m.fog=false;m.toneMapped=false;m.needsUpdate=true;
   window.__diUnlitRestore=()=>{
    m.color.setHex(saved.color);m.emissive.setHex(saved.emissive);
    delete m.emissiveIntensity;m.emissiveIntensity=saved.emissiveIntensity;
    m.emissiveMap=saved.emissiveMap;
    m.vertexColors=saved.vertexColors;m.fog=saved.fog;m.toneMapped=saved.toneMapped;m.needsUpdate=true;
    if(saved.glow)glow.value.copy(saved.glow);
   };
   return saved;
  };
 });
 await page.evaluate(()=>window.__diHideHud());
 const results=[];
 // `page.waitForFunction` runs in an ISOLATED world: it shares the DOM but not
 // the JS globals, so `window.__diCamera` is undefined inside it and any wait on
 // it silently runs to timeout. Everything that needs a global goes through
 // `page.evaluate`, which runs in the main world.
 const censusOf=(claim,sampler)=>page.evaluate(({name,sampler,uniform})=>{
   // A handful of world positions from whatever is about to be drawn, so the
   // camera can be CHECKED against the geometry rather than guessed at.
   const sample=(mesh,index,start,count)=>{
    const position=mesh.geometry.attributes.position,out=[],step=Math.max(1,Math.floor(count/24));
    // An InstancedMesh's own matrixWorld is the identity: its geometry sits at
    // the origin and the instances carry the placement. Sampling without an
    // instance matrix aimed the camera at an empty origin and the gate markers
    // photographed nothing.
    const matrix=mesh.matrixWorld.clone();
    if(mesh.isInstancedMesh&&mesh.count>0){
     const instance=new mesh.matrixWorld.constructor();
     mesh.getMatrixAt(0,instance);matrix.multiply(instance);
    }
    for(let t=start;t<start+count;t+=step){
     const i=index?index.getX(t):t;
     out.push(new mesh.position.constructor(position.getX(i),position.getY(i),position.getZ(i))
      .applyMatrix4(matrix).toArray());
    }
    return out;
   };
   const mesh=window.__diMeshes.find(o=>o.name===name);
   if(!mesh)return {error:'no mesh named '+name};
   if(uniform){
    // Water surfaces wrap a cell in the fragment shader, so the rect they draw
    // is a uniform, not a UV range. Read the uniform the shipped material holds.
    const cell=mesh.material.userData?.diCell??null;
    // A water surface has no UV run to stand in front of, so the camera is
    // aimed at its bounding sphere instead. Without this the shallows were
    // photographed from the world origin and drew nothing at all.
    mesh.geometry.computeBoundingSphere();
    const sphere=mesh.geometry.boundingSphere;
    const centre=sphere.center.clone().applyMatrix4(mesh.matrixWorld);
    return {uniform:true,cell,triangles:(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3,
     start:0,count:0,focus:centre.toArray(),localRadius:Math.min(60,sphere.radius),
     normal:[0,1,0],samples:sample(mesh,null,0,mesh.geometry.index?.count??mesh.geometry.attributes.position.count)};
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
   // The UV box the isolated run ACTUALLY addresses. The metric aspect
   // correction centres a face inside its cell, so a run often covers a
   // sub-rect; comparing it against the whole quadrant compares a piece of the
   // bark against a mean that includes bands the geometry never samples.
   let box=[1,1,0,0];
   for(let t=best.start;t<best.start+best.count;t++){
    const i=index?index.getX(t):t,u=uv.getX(i),v=uv.getY(i);
    box=[Math.min(box[0],u),Math.min(box[1],v),Math.max(box[2],u),Math.max(box[3],v)];
   }
   // Where the isolated run STANDS, so the capture can wait until it is in
   // front of the camera instead of photographing an empty sky.
   const position=mesh.geometry.attributes.position,centre=[0,0,0];
   for(let t=best.start;t<best.start+best.count;t++){
    const i=index?index.getX(t):t;
    centre[0]+=position.getX(i);centre[1]+=position.getY(i);centre[2]+=position.getZ(i);
   }
   const n=Math.max(1,best.count);
   const placement=mesh.matrixWorld.clone();
   if(mesh.isInstancedMesh&&mesh.count>0){
    const instance=new mesh.matrixWorld.constructor();
    mesh.getMatrixAt(0,instance);placement.multiply(instance);
   }
   const world=new mesh.position.constructor(centre[0]/n,centre[1]/n,centre[2]/n).applyMatrix4(placement);
   // A run can be the WHOLE road: its average lands in the middle of the island
   // and its radius is a kilometre, which put the camera past the far plane and
   // photographed nothing. Aim at a vertex in the MIDDLE OF THE RUN instead, and
   // size the stand-off from the spread of its neighbours only.
   const middle=index?index.getX(best.start+Math.floor(best.count/2)):best.start+Math.floor(best.count/2);
   const focus=new mesh.position.constructor(position.getX(middle),position.getY(middle),position.getZ(middle)).applyMatrix4(placement);
   // Which way the run FACES, so a flat plate is not photographed edge-on.
   const normals=mesh.geometry.attributes.normal;
   const facing=[0,0,0];
   if(normals){
    for(let t=best.start;t<best.start+best.count;t++){
     const i=index?index.getX(t):t;
     facing[0]+=normals.getX(i);facing[1]+=normals.getY(i);facing[2]+=normals.getZ(i);
    }
    const length=Math.hypot(...facing)||1;
    facing[0]/=length;facing[1]/=length;facing[2]/=length;
   }
   let radius=0,sampled=0;
   for(let t=Math.max(0,best.start+Math.floor(best.count/2)-90);t<Math.min(best.start+best.count,best.start+Math.floor(best.count/2)+90);t++){
    const i=index?index.getX(t):t;
    const p=new mesh.position.constructor(position.getX(i),position.getY(i),position.getZ(i)).applyMatrix4(placement);
    radius=Math.max(radius,p.distanceTo(focus));sampled++;
   }
   return {triangles:count/3,matchedTriangles:matched,start:best.start,count:best.count,
    addressedRect:best.count?box:null,centroid:world.toArray(),
    focus:focus.toArray(),localRadius:radius,localSamples:sampled,normal:facing,
    samples:sample(mesh,index,best.start,best.count)};
 },{name:claim.mesh,sampler,uniform:!!claim.uniform});
 // The scene renders on demand while the race has not started, so a frame is
 // produced by nudging it rather than by waiting for one.
 const draw=async()=>{await page.evaluate(()=>window.dispatchEvent(new Event('resize')));
  await new Promise(resolve=>setTimeout(resolve,220));};
 for(const claim of CLAIMS){
  const rect=rectOf(claim.role,claim.cell);
  const census=await censusOf(claim,sampledRect(rect.uv));
  if(census.error){results.push({...claim,rect,error:census.error});continue;}
  // Candidate viewpoints, SCORED by how many of the run's own vertices land
  // inside the frustum. Guessing one pose left three claims photographing an
  // empty sky; this tries the face-on direction first and then a ring of
  // fallbacks, and keeps whichever actually sees the geometry.
  const framed=await page.evaluate(({centroid,radius,normal,samples})=>{
   const camera=window.__diCamera;if(!camera)return null;
   const V=camera.position.constructor;
   const target=new V(...centroid);
   const points=samples.map(p=>new V(...p));
   const directions=[normal,[0,1,0],[1,.5,0],[-1,.5,0],[0,.5,1],[0,.5,-1],[.7,.7,.7],[-.7,.7,-.7]]
    .map(d=>new V(...d)).filter(d=>d.lengthSq()>1e-6).map(d=>d.normalize());
   let best=null;
   for(const along of directions){
    for(const factor of [2.4,4.5,8]){
     const distance=Math.max(9,radius*factor);
     camera.position.copy(target).addScaledVector(along,distance).add(new V(0,Math.max(2,distance*.2),0));
     camera.up.set(0,1,0);camera.lookAt(target);camera.updateMatrixWorld(true);
     camera.updateProjectionMatrix();
     let seen=0;
     for(const point of points){
      const ndc=point.clone().project(camera);
      if(ndc.z>-1&&ndc.z<1&&Math.abs(ndc.x)<.95&&Math.abs(ndc.y)<.95)seen++;
     }
     if(!best||seen>best.seen)best={seen,position:camera.position.toArray(),distance,
      direction:along.toArray()};
     if(seen>=points.length*.7)break;
    }
    if(best&&best.seen>=points.length*.7)break;
   }
   camera.position.set(...best.position);camera.lookAt(target);camera.updateMatrixWorld(true);
   return {...best,target:target.toArray(),samplesInFrame:best.seen,samples:points.length};
  },{centroid:census.focus??census.centroid??[0,0,0],
   radius:Math.min(70,Math.max(4,census.localRadius??20)),normal:census.normal??[0,1,0],
   samples:census.samples??[]});
  // Background first, from the SAME camera: the mask is then exact.
  await page.evaluate(()=>window.__diBlank());
  await draw();
  await page.screenshot({path:out+'/'+claim.id+'-background.png'});
  const drawn=await page.evaluate(({name,start,count})=>{
   const shown=window.__diIsolate(name,start,count);window.__diUnlit(name);return shown;},
   {name:claim.mesh,start:census.start,count:census.count});
  await draw();
  const shot=out+'/'+claim.id+'.png';
  await page.screenshot({path:shot});
  await page.evaluate(()=>{window.__diUnlitRestore?.();window.__diRestore();});
  results.push({...claim,rect,census,drawn,shot,framed,
   render:'unlit: base colour black, map on emissive, vertex tint off, fog off, tone mapping off'});
 }
 await page.evaluate(()=>{window.__diRestore();window.__diShowHud();});
 await writeFile(out+'/atlas-proof.json',JSON.stringify({
  script:'scripts/visual/dreamisland/atlas-proof.mjs',url,errors,
  atlasManifest:{file:'public/assets/dreamisland/atlas-manifest.json',
   sha256:createHash('sha256').update(readFileSync('public/assets/dreamisland/atlas-manifest.json')).digest('hex')},
  convention:'Manifest rects are bottom-origin V; every sampler on this map runs flipY:false, so the rect a UV must land in is [u0, 1-v1, u1, 1-v0].',
  claims:results,
  next:'scripts/visual/dreamisland/atlas-proof.py compares each isolation frame against all four quadrants of its role.',
 },null,2));
 console.log(JSON.stringify(results.map(r=>({id:r.id,drawn:r.drawn,matched:r.census?.matchedTriangles,run:(r.census?.count??0)/3,framed:!!r.framed})),null,1));
}finally{await browser.close();}
