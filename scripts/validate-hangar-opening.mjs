import assert from 'node:assert/strict';
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {parseGeometry} from './lib/glb-geometry.mjs';
import {openHangarRoadBay,HANGAR_OPENING_Y} from '../src/game/greenwater-hangar-opening.js';

const bytes=readFileSync('public/assets/greenwater/models/greenwater_environment_runtime.glb');
const {scene}=await parseGeometry(bytes);
scene.updateMatrixWorld(true);
const mesh=scene.getObjectByName('GW_SECTOR_HANGAR_SIX_metal');
const original=mesh.geometry.clone();
// Unit scope is the offending bay panel. The runtime face probe separately
// includes all meshes after the pre-existing prop/barrier relocations run.
mesh.geometry.setDrawRange(296*3,12*3);
const samples=JSON.parse(readFileSync('src/game/data/greenwater-blockout.json')).centreline.samples;
const ray=new THREE.Raycaster();
// Actual triangles, not just corners. The authored road is unbanked here.
function intersections() {
  const hits=[];let rays=0;
  for(let i=0;i<samples.length-1;i++) {
    const a=samples[i],b=samples[i+1];
    if(a.d<680 || a.d>710)continue;
    assert.equal(a.bank,0);
    const start=new THREE.Vector3(a.x,a.y,a.z),end=new THREE.Vector3(b.x,b.y,b.z);
    const tangent=end.clone().sub(start).normalize();
    const right=tangent.clone().cross(new THREE.Vector3(0,1,0)).normalize();
    for(let lateral=-a.w/2; lateral<=a.w/2; lateral+=.5)for(const height of [.31,1,2,3.19]) {
      ray.set(start.clone().addScaledVector(right,lateral).add(new THREE.Vector3(0,height,0)),tangent);
      ray.far=start.distanceTo(end);rays++;
      for(const hit of ray.intersectObject(mesh,false))hits.push({distance:a.d,lateral,height,face:hit.faceIndex});
    }
  }
  return {rays,hits};
}
const before=intersections();
assert.ok(before.hits.length>0,'Control must reproduce the wall crossing the road.');
const repair=openHangarRoadBay(mesh.geometry);
const after=intersections();
assert.equal(after.hits.length,0,'Hangar wall faces must clear the full road width.');
assert.equal(repair.movedVertices,12);
assert.deepEqual(mesh.geometry.index.array,original.index.array);
assert.deepEqual(mesh.geometry.attributes.normal.array,original.attributes.normal.array);
// Prove the exact scope and that cropping remains inside each original atlas
// triangle: every changed UV lies on its original vertical edge.
let moved=0,changedUvs=0;
const p=mesh.geometry.attributes.position,oldP=original.attributes.position;
const uv=mesh.geometry.attributes.uv,oldUv=original.attributes.uv;
for(let i=0;i<p.count;i++) {
  assert.equal(p.getX(i),oldP.getX(i));assert.equal(p.getZ(i),oldP.getZ(i));
  if(p.getY(i)!==oldP.getY(i)) {moved++;assert.equal(oldP.getY(i),.5);assert.ok(Math.abs(p.getY(i)-HANGAR_OPENING_Y)<.00001);}
  if(uv.getX(i)!==oldUv.getX(i)||uv.getY(i)!==oldUv.getY(i)) {
    changedUvs++;assert.notEqual(p.getY(i),oldP.getY(i));
    const top=Array.from({length:oldP.count},(_,j)=>j).find(j=>oldP.getX(j)===oldP.getX(i)&&oldP.getZ(j)===oldP.getZ(i)&&oldP.getY(j)===26.5
      && [0,1,2].every(axis=>original.attributes.normal.getComponent(j,axis)===original.attributes.normal.getComponent(i,axis)));
    assert.notEqual(top,undefined);
    for(const axis of [0,1])assert.ok(uv.getComponent(i,axis)>=Math.min(oldUv.getComponent(i,axis),oldUv.getComponent(top,axis))-.00001
      && uv.getComponent(i,axis)<=Math.max(oldUv.getComponent(i,axis),oldUv.getComponent(top,axis))+.00001);
  }
}
assert.equal(moved,12);assert.equal(changedUvs,8);
assert.throws(()=>openHangarRoadBay(mesh.geometry),/remeasure/,'Unexpected/repeated geometry edits must fail the contract.');
const out=process.argv.find(a=>a.startsWith('--out='))?.slice(6)??'art/evidence/hangar-road/validator';
mkdirSync(out,{recursive:true});
writeFileSync(out+'/opening.json',JSON.stringify({instrument:'scripts/validate-hangar-opening.mjs',assetSha256:createHash('sha256').update(bytes).digest('hex'),before,after,repair,changedUvs,trianglesUnchanged:true,atlasEdgesContained:true,passed:true},null,2)+'\n');
console.log(`Hangar opening PASS: ${before.hits.length} face hits before, ${after.hits.length} after; ${after.rays} road rays; ${moved} vertices raised; atlas edges retained.`);
