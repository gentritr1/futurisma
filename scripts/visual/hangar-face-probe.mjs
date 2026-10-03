import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {launchReviewBrowser} from './tideline-v4/browser.mjs';
import {instrument} from './dreamisland/instrument.mjs';
const out=process.argv.find(a=>a.startsWith('--out='))?.slice(6)??'art/evidence/hangar-road/after';
await mkdir(out,{recursive:true});
const browser=await launchReviewBrowser();
try {
 const page=await browser.newPage();await instrument(page);
 await page.goto('http://127.0.0.1:5201/?map=greenwater&diagnostics=1&headless=1&probe=corridor-sweep&census=1&start=manual',{waitUntil:'networkidle0'});
 await page.waitForFunction(()=>JSON.parse(document.getElementById('futurisma-diagnostics')?.textContent||'{}').current?.corridorSweepRan,{timeout:120000});
 const data=await page.evaluate(async()=>{
  const THREE=await import('/node_modules/.vite/deps/three.js');
  const {GreenwaterCourse,surfaceHeightAtLateral}=await import('/src/game/course.ts');
  const course=new GreenwaterCourse(),scene=window.__diScene;
  const root=scene.getObjectByName('greenwater_authored_environment');
  const meshes=[];root.traverse(o=>{if(o.isMesh)meshes.push(o);});
  const ray=new THREE.Raycaster(),hits=[];
  let rays=0;
  for(let distance=680;distance<710;distance+=1)for(let lateral=-9.5;lateral<=9.5;lateral+=.5)for(const height of [.31,1,2,3.19]) {
   const a=course.sample(distance/course.length),b=course.sample((distance+1)/course.length);
   const pose=s=>s.position.clone().addScaledVector(s.right,lateral).addScaledVector(s.up,height+surfaceHeightAtLateral(s,lateral));
   const start=pose(a),end=pose(b),delta=end.sub(start);ray.set(start,delta.clone().normalize());ray.far=delta.length();rays++;
   for(const hit of ray.intersectObjects(meshes,false))hits.push({distance,lateral,height,mesh:hit.object.name,face:hit.faceIndex,point:hit.point.toArray()});
  }
  const relevant=[...new Set(hits.map(h=>h.mesh))].map(name=>{
   const mesh=root.getObjectByName(name),p=mesh.geometry.attributes.position,idx=mesh.geometry.index;
   const faces=[...new Set(hits.filter(h=>h.mesh===name).map(h=>h.face))].map(face=>({face,vertices:[0,1,2].map(i=>new THREE.Vector3().fromBufferAttribute(p,idx.getX(face*3+i)).applyMatrix4(mesh.matrixWorld).toArray())}));
   return {name,faces};
  });
  return {instrument:'scripts/visual/hangar-face-probe.mjs; 1 m longitudinal segments, 0.5 m lane spacing across the full 19 m road, four heights; actual runtime environment triangles at 680–710 m',rays,hits,relevant,diagnostics:JSON.parse(document.getElementById('futurisma-diagnostics').textContent).current};
 });
 await writeFile(out+'/face-probe.json',JSON.stringify(data,null,2)+'\n');
 console.log(JSON.stringify({rays:data.rays,hits:data.hits,faces:data.relevant,sweepIntrusions:data.diagnostics.corridorIntrusions},null,2));
 assert.equal(data.rays,4680);
 assert.equal(data.hits.length,0,'A rendered environment face still crosses the Hangar driving lanes.');
 assert.equal(data.diagnostics.corridorSweepRan,true);
 assert.equal(data.diagnostics.corridorGate,'drivable');
 assert.equal(data.diagnostics.corridorIntrusions,0);
} finally {await browser.close();}
