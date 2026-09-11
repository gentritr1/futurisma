import * as THREE from 'three';

/** Repeated lamps and wall variants keep identical paint and geometry in visible instance batches. */
export function instanceAscensionProps(root:THREE.Group){
 root.updateMatrixWorld(true);
 const inverse=root.matrixWorld.clone().invert(),groups=new Map<string,THREE.Mesh[]>();
 root.traverse(prop=>{
  if(!prop.userData.instanceAsset)return;
  prop.traverse(object=>{
   if(!(object instanceof THREE.Mesh)||Array.isArray(object.material))return;
   const variant=object.material.name.endsWith('concrete')?prop.userData.trenchZone??'default':'shared';
   const key=[prop.userData.instanceAsset,variant,object.material.uuid,object.userData.paintVariant??0,object.geometry.attributes.position.count,object.geometry.index?.count,object.userData.lodLevel??-1].join(':');
   const group=groups.get(key)??[];
   if(group.length){
    const source=group[0].geometry;
    for(const name of Object.keys(source.attributes)){
     const a=source.getAttribute(name).array,b=object.geometry.getAttribute(name).array;
     if(a.length!==b.length||a.some((v,i)=>v!==b[i]))throw Error(`Non-identical geometry in instance family ${key}: ${name}`);
    }
   }
   group.push(object);groups.set(key,group);
  });
 });
 const batches:{mesh:THREE.InstancedMesh,matrices:THREE.Matrix4[],spheres:THREE.Sphere[],lod:number}[]=[];
 for(const [key,meshes] of groups){
  const first=meshes[0],instances=new THREE.InstancedMesh(first.geometry,first.material,meshes.length);
  instances.name='ascension_prop_instances_'+key.split(':').slice(0,2).join('_')+'_'+(first.material as THREE.Material).name;
  first.geometry.computeBoundingSphere();instances.frustumCulled=false;instances.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const matrices=meshes.map(mesh=>new THREE.Matrix4().multiplyMatrices(inverse,mesh.matrixWorld));
  const spheres=matrices.map(matrix=>first.geometry.boundingSphere!.clone().applyMatrix4(matrix));
  meshes.forEach(mesh=>mesh.removeFromParent());root.add(instances);batches.push({mesh:instances,matrices,spheres,lod:first.userData.lodLevel??-1});
 }
 const frustum=new THREE.Frustum(),projection=new THREE.Matrix4();
 return (camera:THREE.Camera)=>{
  frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
  for(const batch of batches){let count=0;batch.matrices.forEach((matrix,i)=>{const distant=camera.position.distanceTo(batch.spheres[i].center)>160;if((batch.lod===-1||(batch.lod===1)===distant)&&frustum.intersectsSphere(batch.spheres[i]))batch.mesh.setMatrixAt(count++,matrix);});batch.mesh.count=count;batch.mesh.instanceMatrix.needsUpdate=true;}
 };
}
