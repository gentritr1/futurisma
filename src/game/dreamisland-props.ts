import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import data from './data/dreamisland/props.json';
import type {DreamIslandCourse} from './dreamisland-course';

/**
 * Phase F §4.2 — the props layer: ONE `InstancedMesh` per kind, placed from
 * `src/game/data/dreamisland/props.json` in route space.
 *
 * The playtest said the island feels empty. This is what fills it: beach balls
 * and rings in the shallows, chrome spheres at three heights over the water,
 * a pipes sculpture on each district's shore, and cyan bollards down both road
 * edges so the road has an edge at night as well as by day.
 *
 * THE GLB, WITH PRIMITIVES AS THE FALLBACK. `public/assets/dreamisland/props.glb`
 * is the 3D track's file and carries the seven nodes of the brief's §5.3
 * contract — `PR_ball`, `PR_ring`, `PR_sphere`, `PR_pipes`, `PR_bollard` with
 * its `PR_bollard_core`, `PR_plinth`. `DreamIslandProps.load` reads it; if it
 * is missing or a node is absent, `sourceGeometry()` builds the same seven
 * names out of three.js primitives instead and `report.source` says which was
 * used, so the placements, the counts and the budgets are provable either way
 * and the file genuinely is a swap rather than a rewrite.
 *
 * The primitive fallback carries NO texture, deliberately. The GLB's contract
 * binds each node to an atlas cell, and a primitive with 0..1 UVs pointed at a
 * 2x2 atlas samples all four quadrants at grazing angles — the trap that made
 * this map's sand road read teal for thirteen phases.
 *
 * MOTION IS A PURE FUNCTION OF THE TICK. Spheres bob +/- 0.4 m over 6 s and
 * balls roll on the spot; both are derived from the schedule's absolute tick,
 * so two render rates agree and `?motion=reduce` freezes them by passing the
 * same constant tick every frame. Nothing here touches the simulation.
 *
 * THE CORRIDOR RULE IS CHECKED AGAINST THE BUILT GEOMETRY, not against the
 * data. `assertCorridor` measures each instance's real bounding box in road
 * space and throws if anything is over the deck below 8.85 m.
 */
type PropData={kind:string;progress:number;lateral:number;rise:number;yaw:number;scale:number;anchor:string};
const DATA=data as unknown as {seaLevelMetres:number;corridorClearanceMetres:number;
 bollardSpacingMetres:number;bollardEdgeOffsetMetres:number;counts:Record<string,number>;props:PropData[]};
const TICK_RATE=120;
/** Ball and sphere idle motion, from §4.2: +/- 0.4 m over 6 s. */
const BOB_METRES=.4,BOB_SECONDS=6,ROLL_SECONDS=11;

type KindBuild={geometry:THREE.BufferGeometry;color:THREE.Color;emissive?:boolean;
 material?:THREE.MeshLambertMaterial;
 /** Half the widest horizontal extent, in metres, at scale 1. */
 halfExtent:number;lowest:number;highest:number};

/**
 * The seven contracted nodes, out of the 3D track's GLB.
 *
 * Each node's own material is converted to the shared lit material the rest of
 * this map uses — `toneMapped` and `fog` at their defaults, as the render-rule
 * audit requires — and keeps its map, because `dreamisland-reflections.ts`
 * rebuilds the chrome and glass recipes from `material.map` when it binds them
 * by node name. Returns null if the file is absent or any node is, so the
 * fallback is taken as a whole rather than a kind at a time: half a set of real
 * meshes and half a set of primitives would be the hardest failure to see.
 */
function glbGeometry(glb:THREE.Group|null,report:{nodesFound:string[];nodesMissing:string[];
 boundsMetres:Record<string,number[]>}):Map<string,KindBuild>|null{
 if(!glb)return null;
 const kinds=new Map<string,KindBuild>();
 const emissiveNodes=new Set(['PR_bollard_core']);
 for(const name of KIND_NAMES){
  const node=glb.getObjectByName(name);
  if(!(node instanceof THREE.Mesh)){report.nodesMissing.push(name);continue;}
  report.nodesFound.push(name);
  const geometry=node.geometry.clone();
  geometry.computeBoundingBox();
  const box=geometry.boundingBox!;
  report.boundsMetres[name]=[box.min.x,box.min.y,box.min.z,box.max.x,box.max.y,box.max.z]
   .map(value=>Math.round(value*1000)/1000);
  const source=node.material as THREE.MeshStandardMaterial;
  for(const texture of [source.map,source.emissiveMap]){
   if(!texture)continue;
   texture.anisotropy=Math.max(texture.anisotropy,16);texture.needsUpdate=true;
  }
  const material=new THREE.MeshLambertMaterial({name:source.name||('dreamisland_prop_'+name),
   color:source.color,map:source.map,emissive:source.emissive,emissiveMap:source.emissiveMap,
   emissiveIntensity:emissiveNodes.has(name)?0:source.emissiveIntensity,
   vertexColors:!!geometry.attributes.color});
  kinds.set(name,{geometry,material,color:new THREE.Color(0xffffff),
   emissive:emissiveNodes.has(name),
   halfExtent:Math.max(box.max.x,-box.min.x,box.max.z,-box.min.z),
   lowest:box.min.y,highest:box.max.y});
 }
 if(report.nodesMissing.length){report.nodesFound.length=0;return null;}
 return kinds;
}
const KIND_NAMES=['PR_ball','PR_ring','PR_sphere','PR_pipes','PR_bollard','PR_bollard_core','PR_plinth'];

/** Every kind's placeholder geometry, under the GLB's own node names. */
function sourceGeometry():Map<string,KindBuild>{
 const kinds=new Map<string,KindBuild>();
 const register=(name:string,geometry:THREE.BufferGeometry,color:number,emissive=false)=>{
  geometry.computeBoundingBox();
  const box=geometry.boundingBox!;
  kinds.set(name,{geometry,color:new THREE.Color(color),emissive,
   halfExtent:Math.max(box.max.x,-box.min.x,box.max.z,-box.min.z),
   lowest:box.min.y,highest:box.max.y});
 };
 // PR_ball — a striped beach ball, 1.2 m across. The stripes are vertex colour
 // on the same geometry rather than a texture, so they survive the GLB swap as
 // an authored attribute rather than as a UV assumption.
 // A low sphere, not an icosahedron: `IcosahedronGeometry` had no other
 // consumer in the tree, so importing it pulled `PolyhedronGeometry` into the
 // SHARED three chunk the shell loads and cost the shell 0.9 KiB gzip for a
 // ball nobody can tell apart at 1.2 m across. Measured, then swapped.
 const ball=new THREE.SphereGeometry(.6,8,6);
 stripe(ball,[new THREE.Color(0xff5a4f),new THREE.Color(0xfdf6e3),new THREE.Color(0x35c8ff),new THREE.Color(0xffd34f)]);
 register('PR_ball',ball,0xffffff);
 // PR_ring — a swim ring lying flat.
 const ring=new THREE.TorusGeometry(.75,.18,6,12).rotateX(Math.PI/2);
 stripe(ring,[new THREE.Color(0xfdf6e3),new THREE.Color(0xff5a4f)]);
 register('PR_ring',ring,0xffffff);
 // PR_sphere — the chrome ball the Y2K screensaver is made of.
 register('PR_sphere',new THREE.SphereGeometry(.9,10,7),0xd8e6f2);
 // PR_pipes — four vertical pipes and a cross-piece, 4 m tall.
 register('PR_pipes',pipes(),0xc6d6e4);
 // PR_bollard — 1.1 m, a concrete post; its lit core is its own node, because
 // §5.3 makes it one and because the core is the only part that answers to
 // nightBlend.
 register('PR_bollard',new THREE.CylinderGeometry(.14,.19,1.1,6,1).translate(0,.55,0),0xb9c3c6);
 register('PR_bollard_core',new THREE.CylinderGeometry(.115,.115,.26,6,1).translate(0,.94,0),0x9ff6ff,true);
 // PR_plinth — what a sculpture stands on.
 register('PR_plinth',new THREE.BoxGeometry(2.2,.5,2.2).translate(0,.25,0),0xb0b7ad);
 return kinds;
}
/** Banded vertex colour by height, so a primitive reads as a painted toy. */
function stripe(geometry:THREE.BufferGeometry,palette:THREE.Color[]):void{
 const position=geometry.attributes.position,colors=new Float32Array(position.count*3);
 geometry.computeBoundingBox();
 const box=geometry.boundingBox!,span=Math.max(1e-6,box.max.y-box.min.y);
 for(let i=0;i<position.count;i++){
  const t=(position.getY(i)-box.min.y)/span;
  const band=palette[Math.min(palette.length-1,Math.floor(t*palette.length))];
  colors[i*3]=band.r;colors[i*3+1]=band.g;colors[i*3+2]=band.b;
 }
 geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
}
/** Four pipes and a lintel, merged into one buffer: the district sculpture. */
function pipes():THREE.BufferGeometry{
 const parts:THREE.BufferGeometry[]=[];
 for(const [x,z,height] of [[-.7,-.7,4],[.7,-.7,3.1],[-.7,.7,3.4],[.7,.7,2.6]] as const){
  parts.push(new THREE.CylinderGeometry(.16,.16,height,8,1).translate(x,height/2,z));
 }
 parts.push(new THREE.CylinderGeometry(.13,.13,2.2,8,1).rotateZ(Math.PI/2).translate(0,3.05,-.7));
 parts.push(new THREE.TorusGeometry(.8,.13,5,10).rotateY(Math.PI/2).translate(0,3.4,.7));
 return mergeGeometries(parts);
}
function mergeGeometries(parts:THREE.BufferGeometry[]):THREE.BufferGeometry{
 const positions:number[]=[],normals:number[]=[],indices:number[]=[];
 for(const part of parts){
  const base=positions.length/3,position=part.attributes.position,normal=part.attributes.normal;
  for(let i=0;i<position.count;i++){
   positions.push(position.getX(i),position.getY(i),position.getZ(i));
   normals.push(normal.getX(i),normal.getY(i),normal.getZ(i));
  }
  const index=part.index;
  if(index)for(let i=0;i<index.count;i++)indices.push(base+index.getX(i));
  else for(let i=0;i<position.count;i++)indices.push(base+i);
  part.dispose();
 }
 const geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
 geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
 geometry.setIndex(indices);
 return geometry;
}

type Instance={data:PropData;base:THREE.Matrix4;basis:THREE.Matrix4;position:THREE.Vector3;phase:number;
 /** World-space bounding sphere of this instance, for the per-instance cull. */
 sphere:THREE.Sphere};

export class DreamIslandProps{
 readonly root=new THREE.Group();
 readonly report={draws:0,triangles:0,instances:0,authoredPlacements:DATA.props.length,groundRays:0,groundHits:0,
  source:'primitives' as 'primitives'|'/assets/dreamisland/props.glb',
  corridorClearanceMetres:DATA.corridorClearanceMetres,
  nodesFound:[] as string[],nodesMissing:[] as string[],boundsMetres:{} as Record<string,number[]>,
  worstDeckClearanceMetres:null as number|null,overDeckInstances:0,
  /** What the last frame actually drew, after the per-instance frustum cull.
   * Zero if the cull ever culls everything, which is what a broken cull looks
   * like from the diagnostics blob. */
  visibleInstances:0,visibleTriangles:0,
  kinds:[] as {kind:string;count:number;draws:number;trianglesEach:number;triangles:number}[]};
 private readonly meshes:{mesh:THREE.InstancedMesh;instances:Instance[];kind:string;
  bob:boolean;roll:boolean;emissive:boolean;trianglesEach:number}[]=[];
 private readonly matrix=new THREE.Matrix4();
 private readonly offset=new THREE.Matrix4();
 private readonly rock=new THREE.Matrix4();
 private readonly scaling=new THREE.Matrix4();
 private readonly ownedMaterials:THREE.Material[]=[];
 /** Reads the 3D track's GLB; falls back to primitives if it is not there. */
 static async load(course:DreamIslandCourse,world:THREE.Object3D|null):Promise<DreamIslandProps>{
  let glb:THREE.Group|null=null;
  try{
   if(typeof Image!=='undefined'){
    glb=(await new GLTFLoader().loadAsync('/assets/dreamisland/props.glb')).scene as THREE.Group;
   }
  }catch{glb=null;}
  return new DreamIslandProps(course,world,glb);
 }
 constructor(course:DreamIslandCourse,world:THREE.Object3D|null,glb:THREE.Group|null=null){
  this.root.name='dreamisland_props';
  const kinds=glbGeometry(glb,this.report)??sourceGeometry();
  if(glb)this.report.source='/assets/dreamisland/props.glb';
  const byKind=new Map<string,PropData[]>();
  for(const prop of DATA.props)byKind.set(prop.kind,[...(byKind.get(prop.kind)??[]),prop]);
  // The bollard's core rides on the bollard's own placements, so it does not
  // appear in the data and cannot drift away from the post it lights.
  byKind.set('PR_bollard_core',byKind.get('PR_bollard')??[]);
  const ground=world?.getObjectByName('DI_STATIC_DI_MAT_jungle')??null;
  let groundTop=0;
  if(ground){ground.updateWorldMatrix(true,false);groundTop=new THREE.Box3().setFromObject(ground).max.y+1;}
  const ray=new THREE.Raycaster(new THREE.Vector3(),new THREE.Vector3(0,-1,0));
  const heightCache=new Map<string,number|null>();
  for(const [kind,build] of kinds){
   const placements=byKind.get(kind)??[];
   if(placements.length===0)continue;
   const material=build.material??new THREE.MeshLambertMaterial({name:'dreamisland_prop_'+kind,
    color:build.color,vertexColors:!!build.geometry.attributes.color,
    ...(build.emissive?{emissive:new THREE.Color(0x9ff6ff),emissiveIntensity:0}:{})});
   this.ownedMaterials.push(material);
   const mesh=new THREE.InstancedMesh(build.geometry,material,placements.length);
   mesh.name=kind;mesh.frustumCulled=false;mesh.castShadow=false;mesh.receiveShadow=false;
   const instances:Instance[]=[];
   placements.forEach((prop,index)=>{
    const sample=course.sample(THREE.MathUtils.euclideanModulo(prop.progress,1));
    const position=sample.position.clone().addScaledVector(sample.right,prop.lateral);
    if(prop.anchor==='water')position.y=DATA.seaLevelMetres+prop.rise;
    else if(prop.anchor==='ground'){
     const key=prop.progress.toFixed(6)+':'+prop.lateral.toFixed(3);
     let height=heightCache.get(key);
     if(height===undefined){
      height=null;
      if(ground){
       ray.set(new THREE.Vector3(position.x,groundTop,position.z),new THREE.Vector3(0,-1,0));
       this.report.groundRays++;
       const hit=ray.intersectObject(ground,false)[0];
       if(hit){height=hit.point.y;this.report.groundHits++;}
      }
      heightCache.set(key,height);
     }
     position.y=(height??position.y)+prop.rise;
    }else position.y+=prop.rise;
    // Upright in world space, not in road space: a beach ball does not bank
    // with the Clock Court. Yaw is the only authored rotation.
    const basis=new THREE.Matrix4().makeRotationY(prop.yaw)
     .premultiply(new THREE.Matrix4().makeTranslation(position.x,position.y,position.z));
    const base=basis.clone().multiply(new THREE.Matrix4().makeScale(prop.scale,prop.scale,prop.scale));
    mesh.setMatrixAt(index,base);
    // The cull sphere is the kind's own bounding box turned into a radius at
    // this instance's scale, plus the bob amplitude for the kinds that bob, so
    // a prop cannot be culled while part of it is still on screen.
    // The TRUE bounding-sphere radius of the box, not the larger of its two
    // half-extents: a 4 m pipes sculpture 1.08 m wide has a half-diagonal of
    // 2.27 m against a half-height of 2.00, and culling on the smaller number
    // would clip a corner of it at the edge of the frustum.
    const halfHeight=(build.highest-build.lowest)/2;
    const reach=Math.sqrt(2*build.halfExtent*build.halfExtent+halfHeight*halfHeight)*prop.scale
     +(kind==='PR_sphere'?BOB_METRES:0);
    const centre=position.clone();
    centre.y+=(build.lowest+build.highest)/2*prop.scale;
    instances.push({data:prop,base,basis,position,phase:(index*.6180339887)%1,
     sphere:new THREE.Sphere(centre,reach)});
   });
   mesh.instanceMatrix.needsUpdate=true;
   this.root.add(mesh);
   const trianglesEach=(build.geometry.index?.count??build.geometry.attributes.position.count)/3;

   this.meshes.push({mesh,instances,kind,bob:kind==='PR_sphere',roll:kind==='PR_ball',
    emissive:!!build.emissive,trianglesEach});
   this.report.kinds.push({kind,count:placements.length,draws:1,trianglesEach,
    triangles:trianglesEach*placements.length});
   this.report.draws++;this.report.triangles+=trianglesEach*placements.length;
   this.report.instances+=placements.length;
  }
  this.assertCorridor(course,kinds);
 }
 /**
  * §4.2's corridor rule, measured off the built instances: a prop whose
  * footprint reaches over the deck must have its LOWEST point at least
  * `corridorClearanceMetres` above that deck. A bollard on the verge is not
  * over the deck at all and is not exempted — it is simply outside.
  */
 private assertCorridor(course:DreamIslandCourse,kinds:Map<string,KindBuild>){
  let worst=Number.POSITIVE_INFINITY;const offenders:string[]=[];
  for(const entry of this.meshes){
   const build=kinds.get(entry.kind)!;
   for(const instance of entry.instances){
    const scale=instance.data.scale;
    const reach=build.halfExtent*scale;
    const sample=course.sample(THREE.MathUtils.euclideanModulo(instance.data.progress,1));
    if(Math.abs(instance.data.lateral)>sample.halfWidth+reach)continue;
    // The bob raises a sphere; the lowest it ever sits is what the rule is
    // about, so the bob is subtracted rather than ignored.
    const lowest=instance.position.y+build.lowest*scale-(entry.bob?BOB_METRES:0);
    const clearance=lowest-sample.position.y;
    worst=Math.min(worst,clearance);
    this.report.overDeckInstances++;
    if(clearance<DATA.corridorClearanceMetres){
     offenders.push(`${entry.kind} at progress ${instance.data.progress.toFixed(4)} lateral `
      +`${instance.data.lateral.toFixed(2)} clears the deck by ${clearance.toFixed(3)} m`);
    }
   }
  }
  this.report.worstDeckClearanceMetres=Number.isFinite(worst)?Math.round(worst*1000)/1000:null;
  if(offenders.length)throw Error('dreamisland-props: the drivable corridor is not clear: '
   +offenders.slice(0,6).join('; '));
 }
 /**
  * @param tick the schedule's absolute tick
  * @param nightBlend 0 by day, 1 once the clock has struck
  * @param reducedMotion freezes every idle motion at its authored pose
  */
 update(tick:number,nightBlend:number,reducedMotion:boolean,frustum:THREE.Frustum|null=null):void{
  const seconds=reducedMotion?0:tick/TICK_RATE;
  let drawnInstances=0,drawnTriangles=0;
  for(const entry of this.meshes){
   if(entry.emissive){
    (entry.mesh.material as THREE.MeshLambertMaterial).emissiveIntensity=nightBlend*16;
   }
   // PER-INSTANCE CULLING, because `InstancedMesh` has none of its own.
   //
   // 480 instances spread over a 2,400 m lap share ONE bounding sphere that
   // covers the whole island, so three's frustum cull is all-or-nothing and
   // keeps every bollard on the far side of the map in the draw. Measured:
   // 31,592 prop triangles every frame, which put the feral soak at 205,540
   // against a 205,000 ceiling. A distance cull does not help here — the lap
   // loops, so the island is smaller than the fog distance — but a frustum
   // test does, because the chase camera looks down the road and not around it.
   //
   // Visible instances are compacted into the FRONT of the instance buffer and
   // `count` is set to how many there were; an `InstancedMesh` draws [0, count)
   // and cannot skip a hole. The compaction is a pure function of the camera,
   // so it changes no simulation state and no two render rates can disagree
   // about anything but which frame a prop entered the frustum on.
   let slot=0;
   for(const instance of entry.instances){
    if(frustum&&!frustum.intersectsSphere(instance.sphere))continue;
    const phase=instance.phase*Math.PI*2;
    if(entry.bob){
     const rise=Math.sin(seconds/BOB_SECONDS*Math.PI*2+phase)*BOB_METRES;
     this.matrix.copy(instance.base).premultiply(this.offset.makeTranslation(0,rise,0));
    }else if(entry.roll){
     // A beach ball rolls on the spot: it turns about its own vertical axis and
     // rocks a few degrees, which reads as movement without it wandering off.
     const spin=seconds/ROLL_SECONDS*Math.PI*2+phase;
     this.matrix.copy(instance.basis)
      .multiply(this.offset.makeRotationY(spin))
      .multiply(this.rock.makeRotationX(Math.sin(spin*.7)*.22))
      .multiply(this.scaling.makeScale(instance.data.scale,instance.data.scale,instance.data.scale));
    }else this.matrix.copy(instance.base);
    entry.mesh.setMatrixAt(slot++,this.matrix);
   }
   entry.mesh.count=slot;
   entry.mesh.instanceMatrix.needsUpdate=true;
   drawnInstances+=slot;
   drawnTriangles+=slot*entry.trianglesEach;
  }
  this.report.visibleInstances=drawnInstances;
  this.report.visibleTriangles=drawnTriangles;
 }
 dispose(){
  this.root.removeFromParent();
  for(const entry of this.meshes)entry.mesh.geometry.dispose();
  for(const material of this.ownedMaterials)material.dispose();
 }
}
