import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
/** Beyond mechanism-reading distance, preserve the actual painted silhouette
 * in one draw per role. The cradle still swings and its beacon still turns. */
export function distantDevice(source:THREE.Object3D):THREE.Group {
 source.updateWorldMatrix(true,true);const inverse=source.matrixWorld.clone().invert();
 const groups=new Map<THREE.Material,THREE.BufferGeometry[]>();
 source.traverse(object=>{
  if(!(object instanceof THREE.Mesh)||Array.isArray(object.material))return;
  const geometry=object.geometry.clone().applyMatrix4(inverse.clone().multiply(object.matrixWorld));
  const parts=groups.get(object.material)??[];parts.push(geometry);groups.set(object.material,parts);
 });
 const root=new THREE.Group();root.name='distant_painted_device';
 for(const [material,parts] of groups){const geometry=mergeGeometries(parts);if(!geometry)throw Error('Device role geometry cannot be merged.');parts.forEach(part=>part.dispose());const mesh=new THREE.Mesh(geometry,material);mesh.receiveShadow=true;root.add(mesh);}
 return root;
}
/** Only merged geometry is owned here; source-kit paint remains shared. */
export function disposeDistantDevice(root:THREE.Group):void {root.traverse(o=>{if(o instanceof THREE.Mesh)o.geometry.dispose();});root.removeFromParent();root.clear();}
