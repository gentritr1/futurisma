import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

/**
 * Phase C: the four focal assets that now ship as their own GLBs.
 *
 * `art/blender/build_dreamisland_painted.py` no longer copies the clock tower,
 * the watchtower, the waterfall cliff or the sea stacks into the batched island.
 * It still records their placements in `painted.json`, tagged `batch: "HERO"`
 * with the GLB to load, so the placement list stays the single source of truth
 * for where each one stands and the island cannot end up carrying two of any of
 * them.
 *
 * THE DRAW BUDGET IS WHY THIS MERGES. The four GLBs carry 38 meshes between
 * them and the sea-stack set is instanced six times, which is 62 draws for
 * decoration on a map whose whole remaining reserve is 29. So every placement's
 * geometry is baked into world space at load and concatenated by material,
 * ONE mesh per `DI_MAT_*` per hero: twelve draws for the four.
 *
 * MATERIALS ARE THE PAINTED WORLD'S OWN INSTANCES, not copies. The hero GLBs
 * carry no embedded textures - they name `DI_MAT_<role>` and expect the shared
 * atlas - so binding the instance the painted world already built gives them
 * the same sheet, the same anisotropy, the same magenta-key discard on
 * `DI_MAT_jungle-card`, and the same `emissiveIntensity` driven by `nightBlend`
 * every frame, for no extra texture and no extra program.
 *
 * One role can be missing from that map: with the waterfall cliff gone from the
 * batch, `DI_MAT_water` has no static consumer left in `painted.glb`, and the
 * hero's plunge-pool foam ring is the only thing that wants it. That case
 * builds the material here from the same `/assets/dreamisland/textures/water.jpg`
 * the water surfaces already fetch, so it is a cache hit rather than a download.
 */
export type HeroPlacement={
 asset:string;position:[number,number,number];yaw:number;scale:number;sector:string;
 batch?:string;hero?:{glb:string;child?:string;heroScale?:number};
};
export type HeroBuild={
 meshes:THREE.Mesh[];
 clockHands:{mesh:THREE.Mesh;base:THREE.Matrix4;kind:'hour'|'minute'}[];
 /** Everything the report has to quote, measured rather than asserted. */
 report:{glbs:string[];placements:number;sourceMeshes:number;mergedMeshes:number;
  triangles:number;perAsset:{asset:string;glb:string;placements:number;sourceMeshes:number;
   mergedMeshes:number;triangles:number;materials:string[]}[];
  materialsBoundFromPaintedWorld:string[];materialsBuiltHere:string[];missingChildren:string[]};
};
const ROLE_TEXTURE=(name:string):string=>name==='DI_MAT_water-overlay'
 ? '/assets/dreamisland/textures/water.jpg':name==='DI_MAT_jungle-card'
 ? '/assets/dreamisland/jungle-card.png'
 : '/assets/dreamisland/textures/'+name.replace('DI_MAT_','')+'.jpg';

/** Concatenate transformed geometry. `BufferGeometryUtils` is not imported
 * anywhere on this map and pulling it in for four assets would cost bytes the
 * shell does not have; this is the same shape as the merge in
 * `dreamisland-water.ts`, with a matrix and the vertex colours added. */
export function mergeInto(parts:{geometry:THREE.BufferGeometry;matrix:THREE.Matrix4}[]):THREE.BufferGeometry{
 const positions:number[]=[],normals:number[]=[],uvs:number[]=[],colors:number[]=[],indices:number[]=[];
 const point=new THREE.Vector3(),normalMatrix=new THREE.Matrix3();
 let tinted=false;
 for(const part of parts)if(part.geometry.attributes.color)tinted=true;
 for(const {geometry,matrix} of parts){
  const base=positions.length/3,position=geometry.attributes.position;
  const normal=geometry.attributes.normal,uv=geometry.attributes.uv,color=geometry.attributes.color;
  normalMatrix.getNormalMatrix(matrix);
  for(let i=0;i<position.count;i++){
   point.fromBufferAttribute(position,i).applyMatrix4(matrix);
   positions.push(point.x,point.y,point.z);
   if(normal){point.fromBufferAttribute(normal,i).applyMatrix3(normalMatrix).normalize();
    normals.push(point.x,point.y,point.z);}
   else normals.push(0,1,0);
   uvs.push(uv?uv.getX(i):0,uv?uv.getY(i):0);
   // A part without vertex colours joining a merge that has them must
   // contribute white, or its share of the mesh would draw black.
   if(tinted)colors.push(color?color.getX(i):1,color?color.getY(i):1,color?color.getZ(i):1,
    color?.itemSize===4?color.getW(i):1);
  }
  const index=geometry.index;
  if(index)for(let i=0;i<index.count;i++)indices.push(base+index.getX(i));
  else for(let i=0;i<position.count;i++)indices.push(base+i);
 }
 const merged=new THREE.BufferGeometry();
 merged.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
 merged.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
 merged.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
 if(tinted)merged.setAttribute('color',new THREE.Float32BufferAttribute(colors,4));
 merged.setIndex(indices);
 merged.computeBoundingSphere();
 return merged;
}

/**
 * @param placements every placement in `painted.json`, hero-tagged or not
 * @param byRole the painted world's own materials, keyed by `DI_MAT_<role>`
 */
export async function loadDreamIslandHeroes(
 placements:HeroPlacement[],byRole:Map<string,THREE.MeshLambertMaterial>,
 adopt:(material:THREE.MeshLambertMaterial)=>void,
):Promise<HeroBuild>{
 const heroes=placements.filter(placement=>placement.batch==='HERO'&&placement.hero?.glb);
 const report:HeroBuild['report']={glbs:[],placements:heroes.length,sourceMeshes:0,mergedMeshes:0,
  triangles:0,perAsset:[],materialsBoundFromPaintedWorld:[],materialsBuiltHere:[],missingChildren:[]};
 if(heroes.length===0)return {meshes:[],clockHands:[],report};
 const files=[...new Set(heroes.map(placement=>placement.hero!.glb))];
 report.glbs=files;
 const loader=new GLTFLoader();
 const scenes=new Map<string,THREE.Group>();
 await Promise.all(files.map(async file=>{
  const gltf=await loader.loadAsync('/assets/dreamisland/'+file);
  scenes.set(file,gltf.scene as THREE.Group);
 }));
 // The material a hero names is the painted world's instance wherever the
 // painted world still has one; anything left is built once, here, from the
 // same served atlas file.
 const materials=new Map<string,THREE.MeshLambertMaterial>();
 const textures=new THREE.TextureLoader();
 const materialFor=(name:string):THREE.MeshLambertMaterial=>{
  const existing=materials.get(name);
  if(existing)return existing;
  const shared=byRole.get(name);
  if(shared){materials.set(name,shared);report.materialsBoundFromPaintedWorld.push(name);return shared;}
  const built=new THREE.MeshLambertMaterial({name,color:0xffffff,vertexColors:true,side:THREE.DoubleSide});
  if(typeof Image!=='undefined')void textures.loadAsync(ROLE_TEXTURE(name)).then(texture=>{
   texture.flipY=false;texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=16;
   built.map=texture;built.needsUpdate=true;
  }).catch(()=>undefined);
  adopt(built);
  materials.set(name,built);report.materialsBuiltHere.push(name);
  return built;
 };
 const meshes:THREE.Mesh[]=[];
 const clockHands:HeroBuild['clockHands']=[];
 const byAsset=new Map<string,HeroPlacement[]>();
 for(const placement of heroes){
  const list=byAsset.get(placement.asset);
  if(list)list.push(placement);else byAsset.set(placement.asset,[placement]);
 }
 const matrix=new THREE.Matrix4(),quaternion=new THREE.Quaternion(),up=new THREE.Vector3(0,1,0);
 for(const [asset,list] of byAsset){
  const parts=new Map<string,{geometry:THREE.BufferGeometry;matrix:THREE.Matrix4}[]>();
  let sourceMeshes=0;
  for(const placement of list){
   const scene=scenes.get(placement.hero!.glb)!;
   // A sea-stack placement takes ONE named child of the four-stack set. The set
   // carries its own display translations, so the child's own transform is
   // dropped and it is re-seated on the placement's origin.
   const child=placement.hero!.child;
   const subtree=child?scene.getObjectByName(child)??findByPrefix(scene,child):scene;
   if(child&&!subtree){report.missingChildren.push(asset+':'+child);continue;}
   const scale=placement.hero!.heroScale??placement.scale??1;
   quaternion.setFromAxisAngle(up,placement.yaw);
   const placementMatrix=new THREE.Matrix4().compose(
    new THREE.Vector3(...placement.position),quaternion,new THREE.Vector3(scale,scale,scale));
   // The set's own root/child translation is what spreads the four stacks along
   // X for the turntable; a placed stack must start from its own foot instead.
   const local=child?localOffsetOf(subtree!):null;
   subtree!.updateMatrixWorld(true);
   subtree!.traverse(object=>{
    if(!(object instanceof THREE.Mesh))return;
    sourceMeshes+=1;
    const name=(object.material as THREE.Material).name||'DI_MAT_concrete';
    matrix.copy(object.matrixWorld);
    if(local)matrix.premultiply(local);
    matrix.premultiply(placementMatrix);
    if(asset==='clock-tower'&&/^clock_(hour|minute)_hand$/.test(object.name)){
     // Keep each authored pivot out of the static merge. Infer its rest angle
     // from the beam's centroid, so an art rebuild cannot silently move 12:00.
     const geometry=object.geometry.clone(),positions=geometry.attributes.position;
     const centre=new THREE.Vector3(),point=new THREE.Vector3();
     for(let i=0;i<positions.count;i++)centre.add(point.fromBufferAttribute(positions,i));
     const restAngle=Math.atan2(-centre.x,centre.y);
     geometry.rotateZ(-restAngle);
     const mesh=new THREE.Mesh(geometry,materialFor(name));
     mesh.name=object.name;mesh.matrixAutoUpdate=false;
     mesh.matrix.copy(matrix);mesh.castShadow=true;mesh.receiveShadow=true;
     meshes.push(mesh);
     clockHands.push({mesh,base:matrix.clone(),kind:object.name==='clock_hour_hand'?'hour':'minute'});
     return;
    }
    const list_=parts.get(name);
    const entry={geometry:object.geometry,matrix:matrix.clone()};
    if(list_)list_.push(entry);else parts.set(name,[entry]);
   });
  }
  const perAsset={asset,glb:list[0].hero!.glb,placements:list.length,sourceMeshes,
   mergedMeshes:0,triangles:0,materials:[...parts.keys()].sort()};
  if(asset==='clock-tower')for(const hand of clockHands){
   perAsset.mergedMeshes++;
   perAsset.triangles+=(hand.mesh.geometry.index?.count??hand.mesh.geometry.attributes.position.count)/3;
  }
  for(const [name,entries] of parts){
   const geometry=mergeInto(entries);
   const mesh=new THREE.Mesh(geometry,materialFor(name));
   mesh.name='DI_HERO_'+asset+'_'+name;
   mesh.castShadow=asset==='clock-tower';mesh.receiveShadow=asset==='clock-tower';mesh.frustumCulled=true;
   meshes.push(mesh);
   perAsset.mergedMeshes+=1;
   perAsset.triangles+=(geometry.index?.count??geometry.attributes.position.count)/3;
  }
  report.sourceMeshes+=sourceMeshes;report.mergedMeshes+=perAsset.mergedMeshes;
  report.triangles+=perAsset.triangles;report.perAsset.push(perAsset);
 }
 return {meshes,clockHands,report};
}

/** The set's children are named for their height; a prefix match keeps working
 * if the hero build appends a suffix to a child name. */
function findByPrefix(root:THREE.Object3D,prefix:string):THREE.Object3D|null{
 let found:THREE.Object3D|null=null;
 root.traverse(object=>{if(!found&&object.name.startsWith(prefix))found=object;});
 return found;
}
/** Undo a set member's own display translation so it stands on its placement. */
function localOffsetOf(subtree:THREE.Object3D):THREE.Matrix4{
 subtree.updateMatrixWorld(true);
 const box=new THREE.Box3().setFromObject(subtree);
 const centre=new THREE.Vector3();box.getCenter(centre);
 // Only the horizontal spread is a display default: the height datum is
 // authored from the stack's own foot at Y = 0 and must survive.
 return new THREE.Matrix4().makeTranslation(-centre.x,0,-centre.z);
}
