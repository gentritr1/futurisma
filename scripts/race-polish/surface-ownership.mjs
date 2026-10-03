import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import * as THREE from 'three';
import {disposeObject3DResources} from '../../src/game/graphics-resources.js';
const path=new URL('../../src/game/circuit-surface-finish.ts',import.meta.url);
let source=stripTypeScriptTypes(await readFile(path,'utf8'),{mode:'transform'});
source=source.replace("from 'three'",`from '${import.meta.resolve('three')}'`)
  .replace("from './render-mode.js'",`from '${new URL('../../src/game/render-mode.js',import.meta.url)}'`);
const {finishCircuitSurfaces}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
globalThis.location={search:''};
const originalLoad=THREE.TextureLoader.prototype.loadAsync;
let loads=0,releases=0;
THREE.TextureLoader.prototype.loadAsync=async()=>{loads++;const t=new THREE.Texture();t.addEventListener('dispose',()=>releases++);return t;};
function course(){return {kind:'nightshift',group:new THREE.Group(),sample:()=>({position:new THREE.Vector3(),right:new THREE.Vector3(1,0,0),up:new THREE.Vector3(0,1,0),tangent:new THREE.Vector3(0,0,-1),halfWidth:8})};}
try{
  const c=course(),env=new THREE.Group();
  // One standard material and one custom city shader exercise both ownership paths.
  const standard=new THREE.MeshStandardMaterial({name:'GW_MAT_concrete'});
  const custom=new THREE.ShaderMaterial({vertexShader:'void main(){ vec3 vWorld=position; #include <fog_vertex> }',fragmentShader:'void main(){ #include <fog_fragment> }'});
  const a=new THREE.Mesh(new THREE.PlaneGeometry(),standard),b=new THREE.Mesh(new THREE.PlaneGeometry(),custom);
  b.name='nightshift_rain_polished_asphalt';env.add(a,b);c.group.add(env);
  await finishCircuitSurfaces(c,env,()=>false);
  await finishCircuitSurfaces(c,env,()=>false);
  assert.equal(loads,1,'Repeated application must not reload or patch twice');
  for(const material of [standard,custom]){
    const shader={uniforms:material.uniforms??{},vertexShader:'#include <begin_vertex>',fragmentShader:'#include <opaque_fragment>'};
    material.onBeforeCompile(shader,{});
    assert.ok(shader.uniforms.surfaceAggregate.value.isTexture);
  }
  assert.equal(custom.uniforms.surfaceAggregate,undefined,'Generic traversal must not own the hook texture');
  let buffers=0;c.group.getObjectByName('circuit_service_drainage').addEventListener('dispose',()=>buffers++);
  disposeObject3DResources(c.group);
  assert.equal(releases,1,'Shared texture disposed once across standard/custom shaders');
  assert.equal(buffers,1);assert.equal(c.group.userData.surfaceFinish.disposed,true);
  const cancelled=course();await finishCircuitSurfaces(cancelled,new THREE.Group(),()=>true);
  assert.equal(releases,2,'Late texture load released after cancellation');
  assert.equal(cancelled.group.userData.surfaceFinish,undefined);
  console.log('Surface ownership PASS: idempotence, shared texture released exactly once, instance buffers released, cancelled load cleanup.');
}finally{THREE.TextureLoader.prototype.loadAsync=originalLoad;}
