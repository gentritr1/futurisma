import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import type {RaceEnvironment, RaceEnvironmentStats} from './environment';
export class AscensionEnvironment implements RaceEnvironment {
 readonly stats:RaceEnvironmentStats={meshes:0,triangles:0,materials:0,textures:0,visibleGroups:0,visibleTriangles:0,shaderModel:'lambert',signageSource:'none',contractDrift:[]};
 private constructor(readonly root:THREE.Group){
  root.updateMatrixWorld(true);
  // Phase A uses flat material IDs as vertex colours. Keep authored parts in
  // the GLB, and batch static geometry once after loading for review headroom.
  const staticMeshes:THREE.Mesh[]=[];
  root.traverse(o=>{if(o instanceof THREE.Mesh&&o.name.startsWith('ascension_blockout_'))staticMeshes.push(o);});
  const batchEnabled=typeof location==='undefined'||new URLSearchParams(location.search).get('ascensionBatch')!=='0';
  if(batchEnabled)this.batch(root,staticMeshes,'ascension_static_material_ids');
  for(const name of ['rocket_core_09','crawler_CT2']){
    const parent=root.getObjectByName(name);
    if(parent&&batchEnabled){const parts:THREE.Mesh[]=[];parent.traverse(o=>{if(o instanceof THREE.Mesh)parts.push(o);});this.batch(root,parts,name+'_blockout');}
  }
  const materials=new Map<THREE.Material,THREE.MeshLambertMaterial>();
  root.traverse(o=>{if(!(o instanceof THREE.Mesh))return;
   const source=o.material as THREE.MeshStandardMaterial;
   let material=materials.get(source);if(!material){material=new THREE.MeshLambertMaterial({color:source.color,name:source.name,vertexColors:!!o.geometry.attributes.color});materials.set(source,material);}
   o.material=material;this.stats.meshes++;this.stats.triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;
  });this.stats.materials=materials.size;
 }
 private batch(root:THREE.Group,parts:THREE.Mesh[],name:string){
  if(!parts.length)return;
  const geometries=parts.map(o=>{
    const geometry=o.geometry.clone().toNonIndexed();geometry.applyMatrix4(o.matrixWorld);
    const source=o.material as THREE.MeshStandardMaterial,color=source.color,colors=[];
    for(let i=0;i<geometry.attributes.position.count;i++)colors.push(color.r,color.g,color.b);
    geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.deleteAttribute('uv');geometry.deleteAttribute('tangent');return geometry;
  });
  const geometry=mergeGeometries(geometries);if(!geometry)throw Error('Incompatible blockout attributes');
  const merged=new THREE.Mesh(geometry,new THREE.MeshLambertMaterial({vertexColors:true}));merged.name=name;
  for(const part of parts){part.removeFromParent();part.geometry.dispose();}
  for(const g of geometries)g.dispose();root.add(merged);
 }
 static async load(){return new AscensionEnvironment((await new GLTFLoader().loadAsync('/assets/ascension/blockout.glb')).scene);}
 updateVisibility(_camera:THREE.Camera){this.stats.visibleGroups=this.stats.meshes;this.stats.visibleTriangles=this.stats.triangles;}
}
