import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {DREAMISLAND_ABILITY_CONFIG} from './dreamisland-powers-config.js';
import colors from './data/dreamisland/power-colors.json';
import type {DreamIslandCourse} from './dreamisland-course';

/**
 * Phase F §4.4 — what the player actually drives through.
 *
 * The playtest's second finding was that the powers are "barely noticeable,
 * barely seen on the road". The rules do not change at all: one collect per
 * pickup per lap, the same trigger, the same launch zones, the same bore field.
 * What changes is that the pickup is now a THING IN THE AIR OVER THE ROAD with
 * a column of light over it, instead of a flat plate on the tarmac and a device
 * 2.5 m off the verge.
 *
 * Three pieces per pickup:
 *   - a 3 m capsule, centre 2.2 m above the deck at the pickup's own lateral,
 *     spinning at 0.25 rev/s;
 *   - a 40 m light column, one additive quad 1.2 m wide standing on the
 *     capsule and fading out with height;
 *   - a 3 m ring on the tarmac beneath it.
 *
 * THE COLUMN IS WHAT CARRIES THE DISTANCE. A 3 m capsule at 150 m is a dozen
 * pixels from the 62-degree chase camera; the column is two orders of magnitude
 * taller than it is wide, which is exactly the shape that survives being small.
 * `scripts/visual/dreamisland/alive-frames.mjs` measures both in pixels at
 * 1280x720 at 300 m, 150 m and 40 m rather than taking this paragraph's word.
 *
 * THE COLUMN FACES BACK UP THE ROAD. It is one quad, not a billboard and not a
 * cross: the player only ever approaches a pickup along the road, so a quad
 * whose normal is the reversed road tangent is face-on for the whole approach
 * and costs one draw instead of two.
 *
 * THE GLB, WITH PRIMITIVES AS THE FALLBACK. `public/assets/dreamisland/capsule.glb`
 * is the 3D track's file and carries the four nodes of the §5.4 contract —
 * `CAP_frame`, `CAP_glass`, `CAP_core`, `CAP_cap`. Each gets its own
 * `InstancedMesh` of five; if the file or any node is missing, the same four
 * names are built from primitives and `report.source` says so. That is why this
 * costs six draws and not the three the brief estimated: the estimate counted
 * the capsule as one mesh, and the node contract makes it four.
 *
 * EVERY TRANSFORM IS A PURE FUNCTION OF THE ABSOLUTE TICK. The spin, the
 * collect shrink and the return are whole-mesh matrices derived from ticks, so
 * two render rates and a restored snapshot agree, and nothing here can move the
 * simulation.
 */
const TICK_RATE=120;
/**
 * Round 2, item 5, and the one number in it that had to move. The brief asks
 * for the capsule at x2.2 and describes it as hovering at 2.2 m. Both together
 * do not work: `capsule.glb`'s tallest node reaches 1.5 m below its own centre,
 * so at x2.2 the capsule reaches 3.3 m below its centre and a 2.2 m rise buries
 * 1.1 m of it in the tarmac - measured, and photographed at
 * `round-2/capsule-rise/`. The rise therefore goes to 3.8 m, which puts the
 * capsule's lowest point 0.5 m clear of the deck and matches the reference
 * painting, where the capsule floats with the ring on the road beneath it. The
 * height in pixels is unchanged by the move: 80 px at 40 m before, 81 px after.
 */
const CAPSULE_METRES=3,CAPSULE_CENTRE_RISE=3.8,SPIN_REVS_PER_SECOND=.25;
/**
 * Round 2, item 5. The capsule measured 37 px tall at 40 m and read as a bead;
 * the reference painting's is an 8-9 m object. The GLB stays 3 m at scale 1 -
 * it is the 3D track's file and its own contract says 3 m - so the size is a
 * scale on the instance matrix, applied here and nowhere else.
 */
const CAPSULE_SCALE=2.2;
const COLUMN_WIDTH=3,COLUMN_HEIGHT=40;
const RING_DIAMETER=6,RING_RISE=.035;
/** §4.4: the capsule scales to zero over 250 ms and returns over 1 s. */
const COLLAPSE_TICKS=Math.round(.25*TICK_RATE),RETURN_TICKS=TICK_RATE;

type PickupState={available:boolean;charge:number};
type Node={mesh:THREE.InstancedMesh;base:THREE.Matrix4[];spins:boolean};

export class DreamIslandCapsules{
 readonly root=new THREE.Group();
 readonly report={draws:0,triangles:0,pickups:0,
  source:'primitives' as 'primitives'|'/assets/dreamisland/capsule.glb',
  capsuleMetres:CAPSULE_METRES,centreRiseMetres:CAPSULE_CENTRE_RISE,
  columnMetres:COLUMN_HEIGHT,columnWidthMetres:COLUMN_WIDTH,ringMetres:RING_DIAMETER,
  capsuleScale:CAPSULE_SCALE,capsuleMetresScaled:CAPSULE_METRES*CAPSULE_SCALE,
  /** Measured off the built geometry: where the capsule's lowest point sits
   * above the deck. It has NO COLLISION - the pickup is the existing
   * progress-and-lateral trigger in polarity-simulation.js - so this is a
   * readability number, not a corridor one. */
  capsuleLowestAboveDeckMetres:null as number|null,
  spinRevsPerSecond:SPIN_REVS_PER_SECOND,collapseTicks:COLLAPSE_TICKS,returnTicks:RETURN_TICKS,
  nodes:[] as {node:string;count:number;trianglesEach:number}[],
  nodesFound:[] as string[],nodesMissing:[] as string[],boundsMetres:{} as Record<string,number[]>,
  placements:[] as {id:string;kind:string;progress:number;lateral:number;
   deckY:number;centreY:number;columnTopY:number}[]};
 /** Live per-pickup presence, 1 present and 0 collected. Published so a frame
  * can be keyed on the state rather than on a guess about timing. */
 readonly presence:number[]=[];
 private readonly nodes:Node[]=[];
 private readonly columns:Node;
 private readonly rings:Node;
 private readonly core:Node;
 private readonly columnTints:number[][]=[];
 private readonly collectedAt=new Map<number,number>();
 private readonly availableAt=new Map<number,number>();
 private readonly matrix=new THREE.Matrix4();
 private readonly spin=new THREE.Matrix4();
 private readonly scaling=new THREE.Matrix4();
 private readonly ownedMaterials:THREE.Material[]=[];
 /** Reads the 3D track's GLB; falls back to primitives if it is not there. */
 static async load(course:DreamIslandCourse):Promise<DreamIslandCapsules>{
  let glb:THREE.Group|null=null;
  try{
   if(typeof Image!=='undefined'){
    glb=(await new GLTFLoader().loadAsync('/assets/dreamisland/capsule.glb')).scene as THREE.Group;
   }
  }catch{glb=null;}
  return new DreamIslandCapsules(course,glb);
 }
 constructor(course:DreamIslandCourse,glb:THREE.Group|null=null){
  this.root.name='dreamisland_capsules';
  const pickups=DREAMISLAND_ABILITY_CONFIG.pickups;
  this.report.pickups=pickups.length;
  const bases:THREE.Matrix4[]=[],columnBases:THREE.Matrix4[]=[],ringBases:THREE.Matrix4[]=[];
  const tints:THREE.Color[]=[];
  pickups.forEach(pickup=>{
   const sample=course.sample(THREE.MathUtils.euclideanModulo(pickup.progress,1));
   const lateral=pickup.lateral??0;
   const deck=sample.position.clone().addScaledVector(sample.right,lateral);
   const centre=deck.clone().addScaledVector(sample.up,CAPSULE_CENTRE_RISE);
   // Upright in world space. The capsule hangs over a banked road at the Clock
   // Court and does not bank with it.
   bases.push(new THREE.Matrix4().makeTranslation(centre.x,centre.y,centre.z));
   // The column stands on the capsule and faces back up the road.
   const facing=Math.atan2(-sample.tangent.x,-sample.tangent.z);
   columnBases.push(new THREE.Matrix4().makeRotationY(facing)
    .premultiply(new THREE.Matrix4().makeTranslation(centre.x,centre.y,centre.z)));
   const ring=deck.clone().addScaledVector(sample.up,RING_RISE);
   ringBases.push(new THREE.Matrix4().makeTranslation(ring.x,ring.y,ring.z));
   tints.push(new THREE.Color().fromArray((colors as Record<string,number[]>)[pickup.kind!]));
   this.presence.push(1);
   this.report.placements.push({id:pickup.id,kind:pickup.kind!,progress:pickup.progress,
    lateral,deckY:Math.round(deck.y*1000)/1000,centreY:Math.round(centre.y*1000)/1000,
    columnTopY:Math.round((centre.y+COLUMN_HEIGHT)*1000)/1000});
  });

  // --- the four capsule nodes of the §5.4 contract ----------------------------
  const chrome=new THREE.Color(0xe4eef6),glass=new THREE.Color(0xa9e8ff);
  const frame=new THREE.CylinderGeometry(.62,.62,CAPSULE_METRES*.72,10,1,true);
  const shell=new THREE.SphereGeometry(.72,12,8);
  const core=new THREE.CylinderGeometry(.3,.3,CAPSULE_METRES*.5,8,1);
  const cap=mergeGeometries([
   new THREE.ConeGeometry(.62,CAPSULE_METRES*.14,10,1).translate(0,CAPSULE_METRES*.43,0),
   new THREE.ConeGeometry(.62,CAPSULE_METRES*.14,10,1).rotateX(Math.PI).translate(0,-CAPSULE_METRES*.43,0),
  ]);
  /** A contracted node: the GLB's geometry and material when they are there,
   * and the primitive beside it when they are not. */
  const node=(name:string,fallbackGeometry:THREE.BufferGeometry,
   fallbackMaterial:THREE.MeshLambertMaterial,white:boolean)=>{
   const found=glb?.getObjectByName(name);
   if(found instanceof THREE.Mesh){
    const source=found.material as THREE.MeshStandardMaterial;
    for(const texture of [source.map,source.emissiveMap]){
     if(!texture)continue;
     texture.anisotropy=Math.max(texture.anisotropy,16);texture.needsUpdate=true;
    }
    const geometry=found.geometry.clone();
    geometry.computeBoundingBox();
    const box=geometry.boundingBox!;
    this.report.nodesFound.push(name);
    this.report.boundsMetres[name]=[box.min.x,box.min.y,box.min.z,box.max.x,box.max.y,box.max.z]
     .map(value=>Math.round(value*1000)/1000);
    const material=new THREE.MeshLambertMaterial({name:source.name||fallbackMaterial.name,
     color:source.color,map:source.map,emissive:source.emissive,emissiveMap:source.emissiveMap,
     emissiveIntensity:source.emissiveIntensity,vertexColors:!!geometry.attributes.color,
     transparent:name==='CAP_glass',opacity:name==='CAP_glass'?.55:1,
     depthWrite:name!=='CAP_glass'});
    fallbackGeometry.dispose();fallbackMaterial.dispose();
    return this.addNode(name,geometry,material,bases,tints,true,white);
   }
   this.report.nodesMissing.push(name);
   return this.addNode(name,fallbackGeometry,fallbackMaterial,bases,tints,true,white);
  };
  node('CAP_frame',frame,new THREE.MeshLambertMaterial({name:'dreamisland_capsule_frame',
   color:chrome,emissive:new THREE.Color(0x1b3240),emissiveIntensity:1}),false);
  node('CAP_glass',shell,new THREE.MeshLambertMaterial({name:'dreamisland_capsule_glass',
   color:glass,transparent:true,opacity:.35,depthWrite:false}),false);
  this.core=node('CAP_core',core,new THREE.MeshLambertMaterial({name:'dreamisland_capsule_core',
   color:new THREE.Color(0x101820),emissive:new THREE.Color(0xffffff),emissiveIntensity:1.5,
   vertexColors:false}),true);
  node('CAP_cap',cap,new THREE.MeshLambertMaterial({name:'dreamisland_capsule_cap',
   color:chrome,emissive:new THREE.Color(0x1b3240),emissiveIntensity:1}),false);
  if(this.report.nodesFound.length===4)this.report.source='/assets/dreamisland/capsule.glb';

  // --- the light column -------------------------------------------------------
  // One quad, vertex-coloured so the fade with height is authored geometry and
  // not a texture, drawn additively with depth writes off so it lights whatever
  // is behind it instead of cutting a hole in it.
  const column=new THREE.PlaneGeometry(COLUMN_WIDTH,COLUMN_HEIGHT,1,6).translate(0,COLUMN_HEIGHT/2,0);
  const columnColors=new Float32Array(column.attributes.position.count*3);
  for(let i=0;i<column.attributes.position.count;i++){
   // 1 at the capsule, 0 at 40 m: a squared falloff, so the bright part is the
   // first few metres and the top is a hint rather than a bar.
   const t=column.attributes.position.getY(i)/COLUMN_HEIGHT;
   const fade=(1-t)*(1-t);
   columnColors[i*3]=fade;columnColors[i*3+1]=fade;columnColors[i*3+2]=fade;
  }
  column.setAttribute('color',new THREE.Float32BufferAttribute(columnColors,3));
  const columnMaterial=new THREE.MeshBasicMaterial({name:'dreamisland_capsule_column',
   vertexColors:true,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,
   side:THREE.DoubleSide});
  this.columns=this.addNode('column',column,columnMaterial,columnBases,tints,false);
  this.columns.mesh.renderOrder=6;

  // --- the ring on the tarmac --------------------------------------------------
  const ring=new THREE.RingGeometry(RING_DIAMETER/2-.28,RING_DIAMETER/2,24,1).rotateX(-Math.PI/2);
  const ringMaterial=new THREE.MeshBasicMaterial({name:'dreamisland_capsule_ring',
   transparent:true,opacity:.85,blending:THREE.AdditiveBlending,depthWrite:false,
   side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-6,polygonOffsetUnits:-12});
  this.rings=this.addNode('ring',ring,ringMaterial,ringBases,tints,false);
  this.rings.mesh.renderOrder=5;
  // Measured off the built geometry rather than from CAPSULE_METRES: the GLB's
  // own tallest node decides how far the capsule reaches below its centre.
  let lowest=0;
  for(const node of this.nodes){
   if(node===this.columns||node===this.rings)continue;
   node.mesh.geometry.computeBoundingBox();
   lowest=Math.min(lowest,node.mesh.geometry.boundingBox!.min.y*CAPSULE_SCALE);
  }
  this.report.capsuleLowestAboveDeckMetres=Math.round((CAPSULE_CENTRE_RISE+lowest)*1000)/1000;
  this.update(pickups.map(()=>({available:true,charge:1})),0,0,false);
 }
 private addNode(name:string,geometry:THREE.BufferGeometry,material:THREE.Material,
  bases:THREE.Matrix4[],tints:THREE.Color[],spins:boolean,white=false):Node{
  const mesh=new THREE.InstancedMesh(geometry,material,bases.length);
  mesh.name='DI_CAPSULE_'+name;mesh.frustumCulled=false;mesh.castShadow=false;mesh.receiveShadow=false;
  bases.forEach((base,i)=>{
   mesh.setMatrixAt(i,base);
   // The core is the power's own colour; the chrome and glass take a pale tint
   // of it so the capsule reads as SURGE or SHIELD before its label does.
   mesh.setColorAt(i,white?tints[i]:tints[i].clone().lerp(new THREE.Color(0xffffff),.55));
  });
  mesh.instanceMatrix.needsUpdate=true;
  if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
  this.root.add(mesh);this.ownedMaterials.push(material);
  const node:Node={mesh,base:bases.map(base=>base.clone()),spins};
  this.nodes.push(node);
  const trianglesEach=(geometry.index?.count??geometry.attributes.position.count)/3;
  this.report.nodes.push({node:mesh.name,count:bases.length,trianglesEach});
  this.report.draws++;this.report.triangles+=trianglesEach*bases.length;
  return node;
 }
 /**
  * @param states one per pickup, from `PolaritySimulation.getPickupStates()`
  * @param tick the simulation's absolute tick
  */
 update(states:PickupState[],tick:number,nightBlend:number,reducedMotion:boolean):void{
  states.forEach((state,index)=>{
   if(state.available){
    if(this.collectedAt.has(index)){this.collectedAt.delete(index);this.availableAt.set(index,tick);}
   }else if(!this.collectedAt.has(index)){this.collectedAt.set(index,tick);this.availableAt.delete(index);}
  });
  const seconds=reducedMotion?0:tick/TICK_RATE;
  const spin=seconds*SPIN_REVS_PER_SECOND*Math.PI*2;
  for(let index=0;index<this.presence.length;index++){
   const collected=this.collectedAt.get(index),returned=this.availableAt.get(index);
   let presence=1;
   if(collected!==undefined)presence=1-THREE.MathUtils.clamp((tick-collected)/COLLAPSE_TICKS,0,1);
   else if(returned!==undefined)presence=THREE.MathUtils.clamp((tick-returned)/RETURN_TICKS,0,1);
   // Smoothstep both ways, so the shrink does not end on a visible corner.
   this.presence[index]=presence*presence*(3-2*presence);
  }
  for(const node of this.nodes){
   for(let index=0;index<node.base.length;index++){
    const presence=this.presence[index];
    this.matrix.copy(node.base[index]);
    if(node.spins)this.matrix.multiply(this.spin.makeRotationY(spin));
    if(node===this.columns){/* the column fades; it never scales */}
    else if(node===this.rings)this.matrix.multiply(this.scaling.makeScale(
     THREE.MathUtils.lerp(.6,1,presence),1,THREE.MathUtils.lerp(.6,1,presence)));
    else this.matrix.multiply(this.scaling.makeScale(
     presence*CAPSULE_SCALE,presence*CAPSULE_SCALE,presence*CAPSULE_SCALE));
    node.mesh.setMatrixAt(index,this.matrix);
   }
   node.mesh.instanceMatrix.needsUpdate=true;
  }
  // The column and the ring fade rather than shrink: a column that scaled to
  // zero would collapse towards the deck and read as the light falling over.
  const mean=this.presence.reduce((total,value)=>total+value,0)/Math.max(1,this.presence.length);
  (this.columns.mesh.material as THREE.MeshBasicMaterial).opacity=mean*(.55+nightBlend*.45);
  (this.rings.mesh.material as THREE.MeshBasicMaterial).opacity=mean*(.5+nightBlend*.5);
  // Per-instance presence, so one collected pickup does not dim the other four.
  this.captureColumnTints();
  const tint=this.columns.mesh.instanceColor?.array??null;
  if(tint)for(let index=0;index<this.presence.length;index++){
   const presence=this.presence[index],base=this.columnTints[index];
   if(base)for(let c=0;c<3;c++)tint[index*3+c]=base[c]*presence;
  }
  if(this.columns.mesh.instanceColor)this.columns.mesh.instanceColor.needsUpdate=true;
  (this.core.mesh.material as THREE.MeshLambertMaterial).emissiveIntensity=1.2+nightBlend*1.6;
 }
 /** Captured once the instance colours exist; called from the constructor's
  * first `update`, which runs after every node is built. */
 private captureColumnTints(){
  const array=this.columns.mesh.instanceColor?.array;
  if(!array||this.columnTints.length)return;
  for(let index=0;index<this.presence.length;index++){
   this.columnTints.push([array[index*3],array[index*3+1],array[index*3+2]]);
  }
 }
 reset(){this.collectedAt.clear();this.availableAt.clear();
  for(let i=0;i<this.presence.length;i++)this.presence[i]=1;}
 dispose(){
  this.root.removeFromParent();
  for(const node of this.nodes)node.mesh.geometry.dispose();
  for(const material of this.ownedMaterials)material.dispose();
 }
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
