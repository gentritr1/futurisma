// Review-only browser module. Vite serves it to the harness; the game never imports it.
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

export function prepare(scene,camera,renderer){
 const saved=[];
 scene.traverse(o=>{if(o.isMesh||o.isInstancedMesh)saved.push({object:o,visible:o.visible});});
 const byRole=new Map();
 for(const {object} of saved)for(const m of Array.isArray(object.material)?object.material:[object.material]){
  if(m.name.startsWith('DI_MAT_')&&!byRole.has(m.name))byRole.set(m.name,m);
 }
 const originalLookAt=camera.lookAt;
 let focal=null;
 const tunnelLights=[];scene.traverse(o=>{if(o.isPointLight&&o.name.startsWith('dreamisland_tunnel_lamp_'))tunnelLights.push({object:o,position:o.position.clone()});});
 function hideWorld(){for(const {object} of saved)object.visible=object.name==='dreamisland_panorama';}
 function pin(position,target,fov=62){
  for(const key of ['x','y','z'])delete camera.position[key];
  delete camera.fov;
  camera.position.set(...position);camera.up.set(0,1,0);
  originalLookAt.call(camera,new THREE.Vector3(...target));
  camera.fov=fov;camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
  for(const key of ['x','y','z']){const value=camera.position[key];Object.defineProperty(camera.position,key,{get:()=>value,set:()=>{},configurable:true});}
  camera.lookAt=()=>{};Object.defineProperty(camera,'fov',{get:()=>fov,set:()=>{},configurable:true});
  const horizontal=new THREE.Vector3(...target).sub(camera.position);horizontal.y=0;
  const horizon=horizontal.normalize().multiplyScalar(camera.far/2).add(camera.position).project(camera);
  return {position:camera.position.toArray(),target,fov,far:camera.far,quaternion:camera.quaternion.toArray(),horizonRow:(1-horizon.y)*360};
 }
 async function loadFocal(name,url,scale=1){
  if(focal)scene.remove(focal);
  const gltf=await new GLTFLoader().loadAsync(url);focal=gltf.scene;focal.name='review_focal_'+name;focal.scale.setScalar(scale);
  for(const [i,s] of tunnelLights.entries()){s.object.position.copy(s.position);if(name==='watchtower')s.object.position.set((i?1:-1)*6.6,6,0);}
  let triangles=0,meshes=0;const materials=new Set();
  focal.traverse(o=>{if(!o.isMesh)return;const role=o.material.name;
   const shared=byRole.get(role);if(!shared)throw Error('No shared material for '+role);
   o.material=shared;o.castShadow=name==='clock-tower';o.receiveShadow=name==='clock-tower';meshes++;
   materials.add(role);triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;
  });
  scene.add(focal);focal.updateMatrixWorld(true);hideWorld();
  const box=new THREE.Box3().setFromObject(focal,true);
  return {scale,triangles,meshes,materials:[...materials],bounds:{min:box.min.toArray(),max:box.max.toArray(),size:box.getSize(new THREE.Vector3()).toArray()}};
 }
 function focalPose(name,distance){
  const box=new THREE.Box3().setFromObject(focal,true),center=box.getCenter(new THREE.Vector3());
  const direction=new THREE.Vector3(...(name==='sea-stack-set'?[0,.12,-1]:name==='watchtower'?[.35,.60,-1]:[.35,.15,-1])).normalize();
  return pin(center.clone().addScaledVector(direction,distance).toArray(),center.toArray(),70);
 }
 let bandSaved=[];
 function lowerBand(stone=false){
  if(!bandSaved.length)focal.traverse(o=>{if(o.isMesh)bandSaved.push({object:o,visible:o.visible,material:o.material,geometry:o.geometry});});
  renderer.localClippingEnabled=true;
  for(const s of bandSaved){
   s.object.visible=s.object.name.startsWith('watchtower_drum_');
   if(!s.object.visible)continue;
   const material=(stone?byRole.get('DI_MAT_concrete'):s.material).clone();
   material.clippingPlanes=[new THREE.Plane(new THREE.Vector3(0,-1,0),10)];
   if(stone){
    material.vertexColors=false;
    const source=s.object.userData.atlasRect;
    const target=bandSaved.find(s=>s.material.name==='DI_MAT_concrete').object.userData.atlasRect;
    if(!source||!target)throw Error('Missing atlas rectangle for stone counterfactual');
    const geometry=s.geometry.clone(),uv=geometry.attributes.uv;
    for(let i=0;i<uv.count;i++)uv.setXY(i,target[0]+(uv.getX(i)-source[0])/(source[2]-source[0])*(target[2]-target[0]),1-(target[1]+(1-uv.getY(i)-source[1])/(source[3]-source[1])*(target[3]-target[1])));
    s.object.geometry=geometry;
   }
   s.object.material=material;
  }
  for(const {object} of saved)object.visible=false;
 }
 function blank(){if(focal)focal.visible=false;for(const {object} of saved)object.visible=false;}
 function restoreFocal(){
  for(const s of bandSaved){s.object.material=s.material;s.object.visible=s.visible;s.object.geometry=s.geometry;}
  bandSaved=[];renderer.localClippingEnabled=false;focal.visible=true;hideWorld();
 }
 function liveState(){
  const lights=[];scene.traverse(o=>{if(o.isLight)lights.push({name:o.name,type:o.type,intensity:o.intensity,color:o.color.toArray(),position:o.position.toArray(),groundColor:o.groundColor?.toArray()});});
  return {lights,fog:{color:scene.fog?.color?.toArray(),density:scene.fog?.density},skyBlend:scene.getObjectByName('dreamisland_panorama')?.material.uniforms.nightBlend.value};
 }
 function stackPlacements(placements){
  return placements.filter(p=>p.asset==='sea-stack').map((p,index)=>{
   const height=Number(p.hero.child.match(/_(\d+)m$/)[1])*p.hero.heroScale;
   const position=new THREE.Vector3(...p.position),center=position.clone();center.y+=height/2;
   const screen=center.project(camera);
   return {index,child:p.hero.child,position:p.position,height,distance:position.distanceTo(camera.position),screen:[(screen.x+1)*640,(1-screen.y)*360],inFront:screen.z<1};
  });
 }
 let regionMesh=null;
 function kerbProbe(){
  const mesh=saved.find(s=>s.object.name==='dreamisland_blockout_road').object;
  const geometry=mesh.geometry,p=geometry.attributes.position,uv=geometry.attributes.uv;
  const boxes=mesh.userData.polishKerb?.boxes;if(!boxes)throw Error('Kerb reshape did not run');
  const first=p.count-boxes*24,candidates=[];
  const project=v=>{const q=v.clone().project(camera);return [(q.x+1)*640,(1-q.y)*360];};
  for(let base=first;base<p.count;base+=24){
   let top=null;
   for(let f=0;f<6;f++){
    const ids=[0,1,2,3].map(k=>base+f*4+k),vertices=ids.map(i=>new THREE.Vector3().fromBufferAttribute(p,i));
    const center=vertices.reduce((a,b)=>a.add(b),new THREE.Vector3()).multiplyScalar(.25);
    if(!top||center.y>top.center.y)top={ids,vertices,center};
   }
   const screen=project(top.center);
   if(screen[0]<0||screen[0]>1280||screen[1]<0||screen[1]>720)continue;
   const edges=[0,1].map(side=>top.ids.filter(i=>Math.abs(uv.getX(i)-(side?.496:.004))<.001)
    .sort((a,b)=>uv.getY(a)-uv.getY(b)).map(i=>new THREE.Vector3().fromBufferAttribute(p,i)));
   const at=t=>edges.map(([a,b])=>a.clone().lerp(b,t));
   const distanceAt=t=>at(t).reduce((a,b)=>a.add(b),new THREE.Vector3()).multiplyScalar(.5).distanceTo(camera.position);
   if((distanceAt(0)-40)*(distanceAt(1)-40)>0)continue;
   let low=0,high=1;const increasing=distanceAt(1)>distanceAt(0);
   for(let i=0;i<40;i++){const t=(low+high)/2;if((distanceAt(t)<40)===increasing)low=t;else high=t;}
   const t=(low+high)/2,points=at(t);
   candidates.push({distance:distanceAt(t),line:points.map(project),center:screen,normal:new THREE.Vector3().fromBufferAttribute(geometry.attributes.normal,top.ids[0]).toArray()});
  }
  candidates.sort((a,b)=>Math.abs(a.distance-40)-Math.abs(b.distance-40));return candidates.slice(0,2);
 }
 function only(mode,tower){
  if(regionMesh){scene.remove(regionMesh);regionMesh.geometry.dispose();regionMesh=null;}
  for(const {object,visible} of saved)object.visible=mode==='full'?visible:
   mode==='sky'?object.name==='dreamisland_panorama':
   mode==='foliage'?object.name.includes('jungle-card')&&!object.name.includes('HERO'):
   mode==='stacks'?object.name.startsWith('DI_HERO_sea-stack_'):false;
  if(mode==='clockface')for(const {object} of saved)object.visible=object.name==='DI_HERO_clock-tower_DI_MAT_emissive';
  if(mode==='waterfall')for(const {object} of saved)object.visible=object.name.startsWith('DI_HERO_waterfall-cliff_');
  if(mode==='waterfallfoam'||mode==='waterfallsheets'){
   const mesh=saved.find(s=>s.object.name==='DI_HERO_waterfall-cliff_DI_MAT_water').object;
   const geometry=mesh.geometry.clone(),uv=geometry.attributes.uv,index=geometry.index,indices=[];
   const bounds=new THREE.Box3(),point=new THREE.Vector3();
   for(let i=0;i<index.count;i+=3){
    const sheet=[0,1,2].every(k=>uv.getX(index.getX(i+k))>.5);
    if(sheet===(mode==='waterfallsheets'))for(let k=0;k<3;k++){
     const id=index.getX(i+k);indices.push(id);bounds.expandByPoint(point.fromBufferAttribute(geometry.attributes.position,id));
    }
   }
   geometry.setIndex(indices);regionMesh=new THREE.Mesh(geometry,mesh.material);scene.add(regionMesh);
   return {triangles:indices.length/3,bounds:{min:bounds.min.toArray(),max:bounds.max.toArray(),size:bounds.getSize(new THREE.Vector3()).toArray()}};
  }
  if(mode==='clockhands'){
   const mesh=saved.find(s=>s.object.name==='DI_HERO_clock-tower_DI_MAT_metal').object;
   const geometry=mesh.geometry.clone(),color=geometry.attributes.color,index=geometry.index,indices=[];
   for(let i=0;i<index.count;i+=3)if([0,1,2].every(k=>color.getX(index.getX(i+k))<.1))for(let k=0;k<3;k++)indices.push(index.getX(i+k));
   geometry.setIndex(indices);regionMesh=new THREE.Mesh(geometry,mesh.material);scene.add(regionMesh);
   return {triangles:indices.length/3};
  }
  if(mode==='kerb')for(const {object} of saved)object.visible=object.name==='dreamisland_blockout_road';
  const roundTwoNames={road:'dreamisland_blockout_road',sea:'dreamisland_sea',
   foam:'dreamisland_foam',shallows:'dreamisland_shallows',
   lamps:'DI_HERO_watchtower-ruin_DI_MAT_emissive',signage:'DI_STATIC_DI_MAT_signage'};
  if(roundTwoNames[mode])for(const {object} of saved)object.visible=object.name===roundTwoNames[mode];
  if(mode==='lamps'){
   const lamps=saved.find(s=>s.object.name===roundTwoNames.lamps)?.object;
   if(lamps){
    lamps.visible=false;const geometry=lamps.geometry.clone(),p=geometry.attributes.position,index=geometry.index,indices=[];
    // Placed upper-window lamps start above world Y=44. The mouth mask must
    // contain only the bore discs and exterior arch lamps, not those windows.
    for(let i=0;i<index.count;i+=3)if([0,1,2].every(k=>p.getY(index.getX(i+k))<38))for(let k=0;k<3;k++)indices.push(index.getX(i+k));
    geometry.setIndex(indices);regionMesh=new THREE.Mesh(geometry,lamps.material);scene.add(regionMesh);
   }
  }
  if(mode==='stripe'){
   const road=saved.find(s=>s.object.name==='dreamisland_blockout_road').object;
   const material=road.material.clone(),compile=road.material.onBeforeCompile;
   material.onBeforeCompile=shader=>{
    compile(shader,renderer);
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
     if(vMapUv.y<.504||vMapUv.x>.496||min(sampledDiffuseColor.g,sampledDiffuseColor.b)-sampledDiffuseColor.r<.025)discard;`);
   };
   material.customProgramCacheKey=()=> 'review-kerb-stripe-mask';
   regionMesh=new THREE.Mesh(road.geometry.clone(),material);regionMesh.receiveShadow=road.receiveShadow;scene.add(regionMesh);
  }
  if(mode==='road'){
   const cards=saved.find(s=>s.object.name==='DI_STATIC_DI_MAT_jungle-card')?.object;
   const colors=cards?.geometry.attributes.color;
   if(colors?.itemSize===4){
    const geometry=cards.geometry.clone(),index=geometry.index,indices=[];
    for(let i=0;i<index.count;i+=3)if([0,1,2].every(k=>colors.getW(index.getX(i+k))<.5))for(let k=0;k<3;k++)indices.push(index.getX(i+k));
    geometry.setIndex(indices);regionMesh=new THREE.Mesh(geometry,cards.material);scene.add(regionMesh);
   }
  }
  if(mode==='mouth'||mode==='drum'){
   const mesh=saved.find(s=>s.object.name==='DI_HERO_watchtower-ruin_DI_MAT_concrete')?.object;
   if(!mesh)throw Error('Tower concrete batch missing');
   const scale=tower.hero.heroScale;
   const inverse=new THREE.Matrix4().compose(new THREE.Vector3(...tower.position),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),tower.yaw),new THREE.Vector3(scale,scale,scale)).invert();
   const geometry=mesh.geometry.clone(),p=geometry.attributes.position,index=geometry.index,indices=[];
   const center=new THREE.Vector3(),point=new THREE.Vector3();
   for(let i=0;i<index.count;i+=3){
    center.set(0,0,0);for(let k=0;k<3;k++)center.add(point.fromBufferAttribute(p,index.getX(i+k)).applyMatrix4(inverse));center.multiplyScalar(1/3);
    const crown=8+2*Math.sqrt(Math.max(0,1-(center.x/7)**2));
    const mouth=center.y>0&&((Math.abs(Math.abs(center.x)-7)<.04&&center.y<8.1)||(Math.abs(center.y-crown)<.12&&Math.abs(center.x)<7));
    const drum=center.y>0&&center.y<17&&Math.hypot(center.x,center.z)>13;
    if(mode==='mouth'?mouth:drum)for(let k=0;k<3;k++)indices.push(index.getX(i+k));
   }
   geometry.setIndex(indices);regionMesh=new THREE.Mesh(geometry,mesh.material);scene.add(regionMesh);
   return {triangles:indices.length/3,method:'Original world-space concrete triangles classified in tower-local coordinates; exact full/isolation equality selects visible pixels'};
  }
  return {names:saved.filter(s=>s.object.visible).map(s=>s.object.name)};
 }
 return {pin,loadFocal,focalPose,lowerBand,blank,restoreFocal,liveState,only,kerbProbe,stackPlacements};
}
