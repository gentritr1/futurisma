import * as THREE from 'three';
import paths from './data/dreamisland/fish-paths.json';
import type {DreamIslandCourse} from './dreamisland-course';

/**
 * Decision 3: the goldfish are ambience and never an obstacle.
 *
 * Two shoals, each batched into its own meshes by the world build, each drifting
 * on an authored closed path: a figure-eight over the basin pool and a long loop
 * over the reef shallows. `src/game/data/dreamisland/fish-paths.json` is the
 * only place either the resting placements or the paths are written down - the
 * Blender build reads it to place the fish and this reads it to move them, so
 * the two cannot disagree about where a shoal starts.
 *
 * THE PATHS ARE AUTHORED IN ROUTE SPACE, `{progress, lateral, rise}`, and that
 * is the whole trick. Where a path is over the road, `rise` IS the height above
 * the deck, so "at least six metres above the deck" is a property of the data
 * rather than something to hope for. It is still MEASURED rather than inferred:
 * a Catmull-Rom can overshoot between waypoints, so `minimumDeckClearance`
 * tracks the real lowest point of the real geometry against the real deck, and
 * `validate-dreamisland-runtime.mjs` asserts it over a whole period at a
 * resolution no frame rate could miss.
 *
 * MOTION IS A WHOLE-MESH TRANSFORM. No skinning, no per-fish simulation: each
 * shoal's baked world geometry is re-origined on its resting point once at load,
 * and after that the shoal is a position and a yaw. Both are pure functions of
 * the absolute tick, so the drift is deterministic across render rates and a
 * schedule snapshot restores it exactly.
 *
 * Under `?motion=reduce` the shoals never spawn at all (decision 6), so
 * `fishVisible` reads zero for the whole race.
 */
type Point={progress:number;lateral:number;rise:number};
type FishData={livery:string;yaw:number}&Point;
type ShoalData={id:string;batch:string;sector:string;periodSeconds:number;
 startHeadingYaw:number;rest:Point;fish:FishData[];path:Point[];
 /** Phase F: a shoal with no batch of its own in `painted.glb`, which
  * instances the named shipped shoal's already re-origined geometry. */
 source?:string;minimumDeckClearanceMetres?:number};
/** Where a shoal's geometry lives: its own baked meshes, or a slot in the
 * shared instanced meshes the phase-F shoals were added as. */
type Rig={place(position:THREE.Vector3,yaw:number):void;setVisible(visible:boolean):void;meshes:number};
const TICK_RATE=120;
/** Half the goldfish's widest span, from `painted.json`'s measured 6.026 m
 * width. A fish this far off the road edge still has nothing over the deck. */
const FISH_HALF_WIDTH=3.013;
const DATA=paths as unknown as {riseSeconds:number;minimumDeckClearanceMetres:number;
 fishLowestPointMetres:number;shoals:ShoalData[]};

class Shoal {
 /** Lowest point of this shoal's geometry, in world Y, at rest. Measured off
  * the buffers rather than taken from the manifest. */
 readonly restLowestY:number;
 readonly restWorld=new THREE.Vector3();
 /** Each fish's resting position RELATIVE to the shoal origin, plus how far its
  * own progress sits from the shoal's. The clearance counter needs a per-fish
  * answer: a shoal is 34 m long, so asking whether its CENTRE is over the road
  * with a 20 m slop either way reports the pool as a road crossing, which is
  * how the first run of this counter produced a clearance of -5.3 m for fish
  * that were still in the water. */
 readonly fish:{offset:THREE.Vector3;progressOffset:number}[]=[];
 constructor(readonly data:ShoalData,readonly rig:Rig,source:THREE.Mesh[],
  reorigin:boolean,course:DreamIslandCourse){
  routePoint(course,data.rest,this.restWorld);
  const scratch=new THREE.Vector3();
  for(const fish of data.fish){
   routePoint(course,fish,scratch);
   this.fish.push({offset:scratch.clone().sub(this.restWorld),
    progressOffset:fish.progress-data.rest.progress});
  }
  const box=new THREE.Box3();
  for(const mesh of source){
   mesh.geometry.computeBoundingBox();
   box.union(mesh.geometry.boundingBox!);
  }
  this.restLowestY=box.min.y;
  if(!reorigin)return;
  // Re-origin: the world build bakes absolute coordinates, so without this a
  // yaw would swing the shoal around the map origin instead of around itself.
  const shift=new THREE.Matrix4().makeTranslation(-this.restWorld.x,-this.restWorld.y,-this.restWorld.z);
  for(const mesh of source){
   mesh.geometry.applyMatrix4(shift);
   mesh.geometry.computeBoundingSphere();
   mesh.position.copy(this.restWorld);
  }
 }
}

/** A point of an authored path, in world space. `right` is rebuilt the way the
 * Blender build's `beside()` builds it - tangent x world up, ignoring bank - so
 * a route-space number means the same thing on both sides. */
function routePoint(course:DreamIslandCourse,point:Point,target:THREE.Vector3):THREE.Vector3{
 const sample=course.sample(THREE.MathUtils.euclideanModulo(point.progress,1));
 const right=new THREE.Vector3().copy(sample.tangent).cross(UP).normalize();
 return target.copy(sample.position).addScaledVector(right,point.lateral).addScaledVector(UP,point.rise);
}
const UP=new THREE.Vector3(0,1,0);

const smoothstep=(t:number):number=>{
 const x=THREE.MathUtils.clamp(t,0,1);return x*x*(3-2*x);
};
/** Closed centripetal Catmull-Rom on one component of the path. */
function spline(values:number[],u:number):number{
 const count=values.length,scaled=THREE.MathUtils.euclideanModulo(u,1)*count;
 const i=Math.floor(scaled),t=scaled-i;
 const p0=values[(i-1+count)%count],p1=values[i%count],p2=values[(i+1)%count],p3=values[(i+2)%count];
 return .5*((2*p1)+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t*t+(-p0+3*p1-3*p2+p3)*t*t*t);
}

export class DreamIslandShoals {
 readonly shoals:Shoal[]=[];
 /** Metres. Starts at Infinity and only ever falls, so a race in which no path
  * ever crossed the deck reports Infinity and `deckSamples` zero, rather than a
  * comfortable-looking number nothing measured. */
 minimumDeckClearance=Number.POSITIVE_INFINITY;
 deckSamples=0;
 visibleMeshes=0;
 /**
  * Phase F: the six added shoals share ONE `InstancedMesh` per material, built
  * from a shipped shoal's geometry AFTER that shoal has re-origined it. Six
  * shoals therefore cost two draws rather than twelve, and the instanced
  * meshes are added to this group for the caller to parent.
  */
 readonly instancedRoot=new THREE.Group();
 readonly report={bakedShoals:0,instancedShoals:0,instancedDraws:0,instancedTriangles:0,
  perShoalFloors:[] as {id:string;floorMetres:number}[]};
 private readonly instanced:THREE.InstancedMesh[]=[];
 constructor(private readonly course:DreamIslandCourse,meshes:THREE.Mesh[]){
  this.instancedRoot.name='dreamisland_fish_instanced';
  const baked=new Map<string,THREE.Mesh[]>();
  for(const data of DATA.shoals){
   if(data.source)continue;
   const owned=meshes.filter(mesh=>mesh.name.startsWith('DI_'+data.batch+'_'));
   if(owned.length===0)continue;
   baked.set(data.id,owned);
   this.shoals.push(new Shoal(data,bakedRig(owned),owned,true,course));
   this.report.bakedShoals++;
  }
  // Second pass, because a source shoal's geometry is only centred on its own
  // origin once its `Shoal` has re-origined it above. Cloning before that would
  // instance a cluster built around the map origin.
  const added=DATA.shoals.filter(data=>data.source&&baked.has(data.source));
  if(added.length){
   const template=baked.get(added[0].source!)!;
   for(const mesh of template){
    const instance=new THREE.InstancedMesh(mesh.geometry,mesh.material,added.length);
    instance.name=mesh.name.replace(/^DI_[A-Z]+_/,'DI_FISHADDED_');
    instance.frustumCulled=false;instance.castShadow=false;instance.receiveShadow=false;
    this.instanced.push(instance);this.instancedRoot.add(instance);
    this.report.instancedDraws++;
    this.report.instancedTriangles+=(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3*added.length;
   }
   added.forEach((data,index)=>{
    this.shoals.push(new Shoal(data,instancedRig(this.instanced,index),template,false,course));
    this.report.instancedShoals++;
    if(data.minimumDeckClearanceMetres!==undefined){
     this.report.perShoalFloors.push({id:data.id,floorMetres:data.minimumDeckClearanceMetres});
    }
   });
  }
 }
 get meshCount(){return this.shoals.reduce((total,shoal)=>total+shoal.rig.meshes,0);}
 /** Where a shoal is at an absolute tick, in route space, already blended out of
  * its resting point. Pure: the same tick always gives the same point. */
 private pointAt(shoal:Shoal,tick:number,fishRiseTick:number,into:Point):number{
  const since=tick-fishRiseTick,window=DATA.riseSeconds*TICK_RATE;
  // The six seconds are spent RISING FIRST and drifting second. The height is
  // finished by 60% of the window and the lateral swing only starts at 40%, so
  // the shoal is already clear of the water before it can be anywhere near the
  // road. Without that lead the two ramps run together and a fish is over the
  // causeway while it is still three metres below the deck.
  const lift=smoothstep(since/(window*.6));
  const swim=smoothstep((since-window*.4)/(window*.6));
  const u=since/(shoal.data.periodSeconds*TICK_RATE);
  const path=shoal.data.path;
  const progress=spline(path.map(p=>p.progress),u);
  const lateral=spline(path.map(p=>p.lateral),u);
  const rise=spline(path.map(p=>p.rise),u);
  into.progress=THREE.MathUtils.lerp(shoal.data.rest.progress,progress,swim);
  into.lateral=THREE.MathUtils.lerp(shoal.data.rest.lateral,lateral,swim);
  into.rise=THREE.MathUtils.lerp(shoal.data.rest.rise,rise,lift);
  return swim;
 }
 private readonly scratch:Point={progress:0,lateral:0,rise:0};
 private readonly ahead:Point={progress:0,lateral:0,rise:0};
 private readonly here=new THREE.Vector3();
 private readonly next=new THREE.Vector3();
 private readonly fishWorld=new THREE.Vector3();
 private readonly right=new THREE.Vector3();
 private readonly turn=new THREE.Quaternion();
 /**
  * @param tick the schedule's absolute tick
  * @param fishRiseTick null on a calibrating race, which has no schedule at all
  */
 update(tick:number,fishRiseTick:number|null,reducedMotion:boolean):void{
  this.visibleMeshes=0;
  const risen=fishRiseTick!==null&&!reducedMotion&&tick>=fishRiseTick;
  for(const instance of this.instanced)instance.visible=risen;
  for(const shoal of this.shoals){
   shoal.rig.setVisible(risen);
   if(!risen)continue;
   this.visibleMeshes+=shoal.rig.meshes;
   const blend=this.pointAt(shoal,tick,fishRiseTick!,this.scratch);
   routePoint(this.course,this.scratch,this.here);
   // Heading from a point a little further along the same path, so the shoal
   // turns with the drift instead of sliding sideways. The turn is a DELTA from
   // the heading each fish was authored pointing at, which is why the authored
   // scatter survives and no fish ever swims backwards.
   this.pointAt(shoal,tick+6,fishRiseTick!,this.ahead);
   routePoint(this.course,this.ahead,this.next);
   const heading=Math.atan2(this.next.x-this.here.x,this.next.z-this.here.z);
   const turn=THREE.MathUtils.euclideanModulo(heading-shoal.data.startHeadingYaw+Math.PI,Math.PI*2)-Math.PI;
   shoal.rig.place(this.here,turn*blend);
   // Clearance, PER FISH. Each fish's world position is the shoal's origin plus
   // its own resting offset turned by the shoal's turn; its lateral is then
   // measured against the road at its own progress, and its lowest point is its
   // origin minus the 1.507 m the goldfish body hangs below it (measured off the
   // exported bounds, not chosen). A fish counts as over the deck only when it
   // is genuinely over it - road half width plus half a fish.
   this.turn.setFromAxisAngle(UP,turn*blend);
   for(const fish of shoal.fish){
    this.fishWorld.copy(fish.offset).applyQuaternion(this.turn).add(this.here);
    const progress=THREE.MathUtils.euclideanModulo(this.scratch.progress+fish.progressOffset,1);
    const sample=this.course.sample(progress);
    this.right.copy(sample.tangent).cross(UP).normalize();
    const lateral=this.fishWorld.clone().sub(sample.position).dot(this.right);
    if(Math.abs(lateral)>sample.halfWidth+FISH_HALF_WIDTH)continue;
    this.deckSamples+=1;
    this.minimumDeckClearance=Math.min(this.minimumDeckClearance,
     this.fishWorld.y+DATA.fishLowestPointMetres-sample.position.y);
   }
  }
 }
}


/** A shipped shoal's own baked meshes: a position and a yaw, as phase C had it. */
function bakedRig(meshes:THREE.Mesh[]):Rig{
 return {
  meshes:meshes.length,
  place(position,yaw){for(const mesh of meshes){mesh.position.copy(position);mesh.rotation.y=yaw;}},
  setVisible(visible){for(const mesh of meshes)mesh.visible=visible;},
 };
}
/** One slot of the shared instanced meshes. A hidden shoal is scaled to zero
 * rather than culled, because an `InstancedMesh` has no per-instance visible
 * flag; the whole mesh's `visible` still does the real hiding before the rise. */
function instancedRig(meshes:THREE.InstancedMesh[],index:number):Rig{
 const matrix=new THREE.Matrix4();
 return {
  meshes:meshes.length,
  place(position,yaw){
   matrix.makeRotationY(yaw).setPosition(position);
   for(const mesh of meshes){mesh.setMatrixAt(index,matrix);mesh.instanceMatrix.needsUpdate=true;}
  },
  setVisible(visible){
   if(visible)return;
   matrix.makeScale(0,0,0);
   for(const mesh of meshes){mesh.setMatrixAt(index,matrix);mesh.instanceMatrix.needsUpdate=true;}
  },
 };
}
