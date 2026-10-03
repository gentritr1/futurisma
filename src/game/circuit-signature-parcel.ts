import * as THREE from 'three';
import type {RaceCourse} from './course';
import {findComponents} from './course-repair';
import {CIRCUIT_SIGNATURE_SITES,circuitSignatureOrigin} from './circuit-signature-sites';

const swaps=new WeakMap<THREE.Object3D,{mesh:THREE.Mesh;original:THREE.BufferGeometry;working:THREE.BufferGeometry}[]>();

/** The dock is a working clearing in the marsh. Relocate complete vegetation
 * components, preserving their shape, UVs, seeds and mesh/triangle counts.
 * Buildings, terrain and the road are outside this deliberately narrow pass. */
export function reserveCircuitSignatureVegetation(environment:THREE.Object3D,course:RaceCourse):void {
  if(course.kind!=='greenwater')return;
  const owner=course.group.getObjectByName('circuit_signature');if(!owner||swaps.has(owner))return;
  const origin=circuitSignatureOrigin(course),site=CIRCUIT_SIGNATURE_SITES.greenwater;
  const sample=course.sample(site.progress),outward=sample.right.clone().multiplyScalar(site.side);
  const road=Array.from({length:Math.ceil(course.length/4)},(_,index)=>course.sample(index/Math.ceil(course.length/4)));
  const changes:{mesh:THREE.Mesh;original:THREE.BufferGeometry;working:THREE.BufferGeometry}[]=[];
  const world=new THREE.Vector3(),bounds=new THREE.Box3(),center=new THREE.Vector3(),inverse=new THREE.Matrix4();
  environment.updateMatrixWorld(true);
  let relocated=0;
  environment.traverse(mesh=>{
    if(!(mesh instanceof THREE.Mesh)||!mesh.name.endsWith('_jungle'))return;
    const original=mesh.geometry,working=original.clone(),p=working.getAttribute('position');
    inverse.copy(mesh.matrixWorld).invert();let moved=false;
    for(const component of findComponents(working)){
      bounds.makeEmpty();
      for(const vertex of component){world.fromBufferAttribute(p,vertex).applyMatrix4(mesh.matrixWorld);bounds.expandByPoint(world);}
      bounds.getCenter(center);
      const radius=Math.hypot(bounds.max.x-bounds.min.x,bounds.max.z-bounds.min.z)/2;
      if(radius>12||bounds.max.y-bounds.min.y<.5||Math.hypot(center.x-origin.x,center.z-origin.z)>site.radius+radius+3)continue;
      // One translation keeps each plant intact and retains its world height.
      let shift:THREE.Vector3|null=null;
      for(let attempt=0;attempt<12;attempt++){
        const candidate=outward.clone().multiplyScalar(site.radius*2+16+attempt*12);candidate.y=0;
        const destination=center.clone().add(candidate);
        const clear=road.every(s=>Math.hypot(s.position.x-destination.x,s.position.z-destination.z)>s.halfWidth+Math.max(s.apronLeft,s.apronRight)+radius+5);
        if(clear){shift=candidate;break;}
      }
      // If there is no safe parcel, retain the authored plant rather than
      // putting it on another part of the driving corridor.
      if(!shift)continue;
      for(const vertex of component){
        world.fromBufferAttribute(p,vertex).applyMatrix4(mesh.matrixWorld).add(shift).applyMatrix4(inverse);
        p.setXYZ(vertex,world.x,world.y,world.z);
      }
      moved=true;relocated++;
    }
    if(moved){p.needsUpdate=true;working.computeBoundingBox();working.computeBoundingSphere();mesh.geometry=working;changes.push({mesh,original,working});}
    else working.dispose();
  });
  owner.userData.relocatedMarshPlants=relocated;swaps.set(owner,changes);
}

export function restoreCircuitSignatureVegetation(owner:THREE.Object3D):void {
  for(const {mesh,original,working} of swaps.get(owner)??[]){mesh.geometry=original;working.dispose();}
  swaps.delete(owner);
}
