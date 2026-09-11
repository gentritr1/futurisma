import assert from 'node:assert/strict';
import {Box3, DoubleSide, Raycaster, Triangle, Vector3} from 'three';

// Clearance excludes a 1 mm contact boundary: authored walls are allowed to
// touch the nominal opening, but cannot enter its interior. The 32 chords
// match the exported elliptical vault, not its rectangular bounding envelope.
const tolerance=.001;
const outline=[[-7,0],[7,0],...Array.from({length:33},(_,i)=>[7*Math.cos(i*Math.PI/32),8+2*Math.sin(i*Math.PI/32)])];
function clippedToArch(triangle) {
  let polygon=[triangle.a.clone(),triangle.b.clone(),triangle.c.clone()];
  for(let i=0;i<outline.length && polygon.length;i++) {
    const a=outline[i],b=outline[(i+1)%outline.length],dx=b[0]-a[0],dy=b[1]-a[1];
    const distance=p=>(dx*(p.y-a[1])-dy*(p.x-a[0]))/Math.hypot(dx,dy)-tolerance;
    const next=[];
    for(let j=0;j<polygon.length;j++) {
      const p=polygon[j],q=polygon[(j+1)%polygon.length],dp=distance(p),dq=distance(q);
      if(dp>=0)next.push(p);
      if((dp>=0)!==(dq>=0))next.push(p.clone().lerp(q,dp/(dp-dq)));
    }
    polygon=next;
  }
  return polygon.length>0;
}
function node(scene,name) {
  const found=scene.getObjectByName(name);assert.ok(found,`Missing ${name}`);return found;
}
const boxOf=root=>new Box3().setFromObject(root,true);
const close=(value,target,label)=>assert.ok(Math.abs(value-target)<.01,`${label}: ${value}, expected ${target}`);

export function checkWatchtower(scene,measuredBounds) {
  const minZ=measuredBounds.min[2]-1,maxZ=measuredBounds.max[2]+1;
  const rectangle=new Box3(new Vector3(-7+tolerance,tolerance,minZ),new Vector3(7-tolerance,8-tolerance,maxZ));
  const envelope=new Box3(new Vector3(-7+tolerance,tolerance,minZ),new Vector3(7-tolerance,10-tolerance,maxZ));
  const triangle=new Triangle(),rectangleHits=[],archHits=[],envelopeHits=[];
  let tested=0;
  scene.traverse(mesh=>{
    if(!mesh.isMesh)return;
    const p=mesh.geometry.attributes.position,index=mesh.geometry.index;
    for(let i=0;i<(index?.count??p.count);i+=3) {
      [triangle.a,triangle.b,triangle.c].forEach((v,k)=>v.fromBufferAttribute(p,index?index.getX(i+k):i+k).applyMatrix4(mesh.matrixWorld));
      tested++;
      if(!envelope.intersectsTriangle(triangle))continue;
      const hit={mesh:mesh.name,triangle:i/3};
      envelopeHits.push(hit);
      if(rectangle.intersectsTriangle(triangle))rectangleHits.push(hit);
      if(clippedToArch(triangle))archHits.push(hit);
    }
  });
  assert.equal(rectangleHits.length,0,`14 x 8 rectangle obstructed: ${JSON.stringify(rectangleHits.slice(0,8))}`);
  assert.equal(archHits.length,0,`Arched cap obstructed: ${JSON.stringify(archHits.slice(0,8))}`);
  assert.ok(envelopeHits.length>0,'The arch must occupy the envelope upper corners; a rectangle is not an arch');
  const meshes=[];
  scene.traverse(mesh=>{
    if(!mesh.isMesh)return;
    mesh.material.side=DoubleSide;meshes.push(mesh);
  });
  function firstHit(origin,direction) {
    const hits=new Raycaster(new Vector3(...origin),new Vector3(...direction),0,80).intersectObjects(meshes,false);
    assert.ok(hits.length,`No masonry hit from ${origin}`);return hits[0].point;
  }
  const flankSamples=[];
  for(const y of [1,4,7.5])for(const sign of [-1,1]) {
    const inner=firstHit([0,y,0],[sign,0,0]);
    const outer=firstHit([sign*20,y,0],[-sign,0,0]);
    close(Math.abs(inner.x),7,'Bore jamb');
    const width=Math.abs(outer.x-inner.x);
    assert.ok(width>=7-1e-4,`Insufficient solid flank: ${width}`);
    flankSamples.push({y,side:sign<0?'left':'right',jamb:inner.toArray(),outside:outer.toArray(),width});
  }
  const ceilingSamples=[];
  for(const z of [-10,0,10]) {
    // Avoid a ray exactly on the shared apex edge (x ~= 4e-16 after export).
    const hit=firstHit([.001,.01,z],[0,1,0]);close(hit.y,10,'Arch crown');
    ceilingSamples.push(hit.toArray());
  }
  const chamberFloor=boxOf(node(scene,'watchtower_upper_chamber_floor')).min.y;
  const overburden=chamberFloor-Math.max(...ceilingSamples.map(p=>p[1]));
  assert.ok(overburden>=6,`Insufficient masonry above vault: ${overburden}`);
  const crownWidth=boxOf(node(scene,'watchtower_crown_cornice')).getSize(new Vector3()).x;
  close(crownWidth,20,'Crown width');
  const moss=node(scene,'watchtower_drum_jungle');
  assert.equal(moss.parent.name,'watchtower_tapered_block_drum');
  assert.equal(moss.userData.structuralSurface,true);assert.equal(moss.userData.mossBand,true);
  const sectors=new Set(),p=moss.geometry.attributes.position,c=moss.geometry.attributes.color;
  let tinted=0;
  for(let i=0;i<p.count;i++) {
    if(p.getY(i)<10 && Math.hypot(p.getX(i),p.getZ(i))>12) {
      sectors.add(Math.floor(((Math.atan2(p.getZ(i),p.getX(i))+Math.PI*2)%(Math.PI*2))/(Math.PI*2)*12));
    }
    if(Math.min(c.getX(i),c.getY(i),c.getZ(i))<.98)tinted++;
  }
  assert.equal(sectors.size,12,'Ivy band must wrap the whole drum');assert.ok(tinted>0);
  for(const side of ['front','back']) {
    node(scene,`watchtower_${side}_arch_voussoirs`);node(scene,`watchtower_${side}_arch_keystone`);
    node(scene,`watchtower_${side}_arched_window`);
  }
  return {
    targetMeasurements:{height:measuredBounds.size[1],baseWidth:measuredBounds.size[0],crownWidth,
      flankSamples,minimumFlank:Math.min(...flankSamples.map(s=>s.width)),ceilingSamples,chamberFloor,overburden,
      mossBandAngularSectors:sectors.size,mossTintedVertices:tinted},
    bore:{width:14,springHeight:8,crownHeight:10,fullDepth:true,contactToleranceMetres:tolerance,testedTriangles:tested,
      nominalRectangleMin:[-7,0,minZ],nominalRectangleMax:[7,8,maxZ],rectangleIntersectingTriangles:rectangleHits.length,
      archSegments:32,archedVolumeIntersectingTriangles:archHits.length,
      envelope14x10:{intersectingTriangles:envelopeHits.length,interpretation:'Expected upper-corner masonry; the user confirmed a true arch, not full rectangular clearance'},
      method:'World-space THREE.Box3 SAT on every exported triangle; convex polygon clipping against the full-depth arch; 1 mm boundary contact tolerance',
      intersectingTriangles:archHits.length}
  };
}
