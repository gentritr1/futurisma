import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
/** Flat-ID blockout only: preserve each part's diffuse and emissive colours
 * while collecting immutable geometry into one lit, fogged draw. */
export function flatIdBatch(parts:THREE.Mesh[],name:string):THREE.Mesh {
 const geometries:THREE.BufferGeometry[]=[],instance=new THREE.Matrix4(),matrix=new THREE.Matrix4(),instanceColor=new THREE.Color();
 for(const part of parts){
  const material=part.material;
  if(!(material instanceof THREE.MeshLambertMaterial)&&!(material instanceof THREE.MeshStandardMaterial))throw Error('Flat-ID batching requires a single lit material');
  const count=part instanceof THREE.InstancedMesh?part.count:1;
  for(let i=0;i<count;i++){
   matrix.copy(part.matrixWorld);instanceColor.set(0xffffff);
   if(part instanceof THREE.InstancedMesh){part.getMatrixAt(i,instance);matrix.multiply(instance);if(part.instanceColor)part.getColorAt(i,instanceColor);}
   const geometry=part.geometry.index?part.geometry.toNonIndexed():part.geometry.clone();geometry.applyMatrix4(matrix);
   const colors:number[]=[],emissions:number[]=[],source=geometry.attributes.color;
   for(let v=0;v<geometry.attributes.position.count;v++){
    const color=material.color.clone().multiply(instanceColor);
    if(material.vertexColors&&source)color.multiply(new THREE.Color(source.getX(v),source.getY(v),source.getZ(v)));
    colors.push(color.r,color.g,color.b);const emission=material.emissive.clone().multiplyScalar(material.emissiveIntensity);emissions.push(emission.r,emission.g,emission.b);
   }
   for(const attribute of Object.keys(geometry.attributes))if(!['position','normal'].includes(attribute))geometry.deleteAttribute(attribute);
   geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setAttribute('flatEmission',new THREE.Float32BufferAttribute(emissions,3));geometries.push(geometry);
  }
 }
 const geometry=mergeGeometries(geometries);if(!geometry)throw Error('Incompatible flat-ID geometry');for(const g of geometries)g.dispose();
 const material=new THREE.MeshLambertMaterial({vertexColors:true,emissive:0xffffff});material.name='ascension_flat_material_ids';
 material.onBeforeCompile=shader=>{
  shader.vertexShader='attribute vec3 flatEmission; varying vec3 vFlatEmission;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvFlatEmission=flatEmission;');
  shader.fragmentShader='varying vec3 vFlatEmission;\n'+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance=vFlatEmission;');
 };material.customProgramCacheKey=()=> 'ascension-flat-id-emission-v1';
 const mesh=new THREE.Mesh(geometry,material);mesh.name=name;return mesh;
}
