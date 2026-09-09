import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {RaceEnvironment, RaceEnvironmentStats} from './environment';
import type {DreamIslandCourse} from './dreamisland-course';

/**
 * Phase A island massing: the two towers, the two water planes and the mossy
 * cut walls. No GLB yet — this is a procedural blockout whose only job is to
 * make the corridor, the bore and the budget real before the art phase.
 *
 * Every mass merges into a single vertex-coloured mesh, so the whole island is
 * one draw and the art phases inherit the headroom rather than spend it. Nothing
 * casts: the two shipped maps leave their static environment out of the shadow
 * pass and the vehicles are the casters, and a blockout is not the place to
 * change that. Every material is Lambert with the default `toneMapped: true`
 * and `fog: true`, which is what the render-rule audit checks for.
 */
export class DreamIslandEnvironment implements RaceEnvironment {
 readonly stats:RaceEnvironmentStats={meshes:0,triangles:0,materials:0,textures:0,visibleGroups:0,visibleTriangles:0,shaderModel:'lambert',signageSource:'none',contractDrift:[]};
 private constructor(readonly root:THREE.Group){
  root.updateMatrixWorld(true);
  const materials=new Set<THREE.Material>();
  root.traverse(o=>{if(!(o instanceof THREE.Mesh))return;
   this.stats.meshes++;
   const count=o instanceof THREE.InstancedMesh?o.count:1;
   this.stats.triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3*count;
   for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);
  });
  this.stats.materials=materials.size;
  this.stats.visibleGroups=this.stats.meshes;this.stats.visibleTriangles=this.stats.triangles;
 }
 static async load(course:DreamIslandCourse):Promise<DreamIslandEnvironment>{
  const root=new THREE.Group();root.name='dreamisland_blockout';
  const centre=new THREE.Vector3();
  for(let i=0;i<24;i++)centre.add(course.sample(i/24).position);
  centre.divideScalar(24);centre.y=0;
  // The whole island massing is ONE vertex-coloured draw. Draw calls, not
  // triangles, are the binding budget on this project (145 a frame including
  // the shadow pass), so the blockout is merged rather than left as six meshes.
  root.add(merged([...sea(centre),...basinPool(course),...watchtower(course),...clockTower(course),...cutWalls(course)],
   'dreamisland_blockout_island'));
  return new DreamIslandEnvironment(root);
 }
 updateVisibility(_camera:THREE.Camera){}
}

/** Paints a flat material-ID colour onto a geometry so the whole island can
 * merge into one mesh and still read as separate stone, water and moss. */
function paint(geometry:THREE.BufferGeometry,hex:number):THREE.BufferGeometry{
 const colour=new THREE.Color(hex),count=geometry.attributes.position.count,colours=new Float32Array(count*3);
 for(let i=0;i<count;i++)colours.set([colour.r,colour.g,colour.b],i*3);
 geometry.setAttribute('color',new THREE.Float32BufferAttribute(colours,3));
 geometry.deleteAttribute('uv');
 return geometry;
}
function merged(parts:THREE.BufferGeometry[],name:string):THREE.Mesh{
 const geometry=mergeGeometries(parts.map(p=>p.toNonIndexed()),false);
 for(const part of parts)part.dispose();
 if(!geometry)throw Error('Incompatible blockout attributes for '+name);
 const mesh=new THREE.Mesh(geometry,new THREE.MeshLambertMaterial({color:0xffffff,vertexColors:true}));
 mesh.name=name;mesh.frustumCulled=false;return mesh;
}

/** One quad of open water under the whole island. */
function sea(centre:THREE.Vector3):THREE.BufferGeometry[]{
 return [paint(new THREE.PlaneGeometry(6000,6000).rotateX(-Math.PI/2).translate(centre.x,-.8,centre.z),0x1f8fa6)];
}

/** The waterfall pool the basin causeway crosses, four metres under the deck. */
function basinPool(course:DreamIslandCourse):THREE.BufferGeometry[]{
 const middle=course.sample(.4541);
 return [paint(new THREE.PlaneGeometry(320,240).rotateX(-Math.PI/2)
  .translate(middle.position.x,middle.position.y-4,middle.position.z),0x39b6bd)];
}

/** Places a box in the road's own basis and returns it in world space. */
function slab(sample:ReturnType<DreamIslandCourse['sample']>,lateral:number,rise:number,along:number,
 width:number,height:number,depth:number,hex:number):THREE.BufferGeometry{
 const geometry=new THREE.BoxGeometry(width,height,depth);
 const basis=new THREE.Matrix4().makeBasis(sample.right,sample.up,sample.tangent.clone().negate());
 const position=sample.position.clone().addScaledVector(sample.right,lateral)
  .addScaledVector(sample.up,rise).addScaledVector(sample.tangent,along);
 return paint(geometry.applyMatrix4(new THREE.Matrix4().setPosition(position).multiply(basis)),hex);
}

/**
 * The watchtower ruin: 16 m across, 24 m tall, with a 14 m x 8 m bore through
 * the full 18 m depth that the road passes through. Decision 5 narrows
 * WATCHTOWER POINT to 14 m so the pinch is the corner; the piers stand exactly
 * on the road edge and the drivable limit is another 2.05 m inside that.
 */
function watchtower(course:DreamIslandCourse):THREE.BufferGeometry[]{
 const at=course.sample(.3375),stone=0x9c907c,parts:THREE.BufferGeometry[]=[];
 for(const side of [-1,1]){
  parts.push(slab(at,side*7.5,4,0,1,8,18,stone));       // bore pier
  parts.push(slab(at,side*13,7,0,6,14,10,stone));       // buttress shoulder
 }
 parts.push(slab(at,0,16,0,16,16,18,stone));            // lintel and tower body
 parts.push(slab(at,0,25,0,18,2,20,0x8a7f6c));          // parapet cap
 return parts;
}

/**
 * The grandfather clock tower, 14 m across, standing inside the Clock Court
 * sweep so the face is in view down the causeway and around the bank.
 */
function clockTower(course:DreamIslandCourse):THREE.BufferGeometry[]{
 const at=course.sample(.5875),stone=0xb4a488;
 // The court turns towards `right`, so the inside of the sweep is that side.
 return [slab(at,58,9,0,16,18,16,stone),slab(at,58,26,0,14,34,14,stone),
  slab(at,58,45,0,16,4,16,0x9d8e73),slab(at,58,50,0,10,10,10,stone),
  slab(at,58,32,-7.2,10,10,.6,0xf3e6c2)];               // the face, toward the road
}

/** Mossy block walls down both sides of the cut. */
function cutWalls(course:DreamIslandCourse):THREE.BufferGeometry[]{
 const from=.85*course.length,step=14,count=Math.floor((course.length-from)/step),parts:THREE.BufferGeometry[]=[];
 for(let i=0;i<count;i++){
  const at=course.sampleAtDistance(from+i*step);
  for(const side of [-1,1])parts.push(slab(at,(at.halfWidth+4.2)*side,3,0,6,7,10,0x6f8a55));
 }
 return parts;
}
