import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import route from './data/ascension/route.json';

/** Thin trunks and exposed prop roots support upright, camera-facing foliage. */
export class AscensionMangroves {
 readonly root=new THREE.Group();
 readonly ready:Promise<void>;
 readonly maximumCanopyTop=8.9;
 readonly trunkDiameter=.4;
 private readonly cards:THREE.InstancedMesh;
 private readonly trunks:THREE.InstancedMesh;
 private readonly treePositions:THREE.Vector3[]=[];
 private readonly frustum=new THREE.Frustum();
 private readonly sphere=new THREE.Sphere(new THREE.Vector3(),12);
 private readonly centers:THREE.Vector3[]=[];
 private readonly pose=new THREE.Object3D();
 constructor(){
  this.root.name='ascension_mangroves';
  const texture=new THREE.Texture();
  this.ready=new THREE.TextureLoader().loadAsync('/assets/ascension/textures/greenwater-jungle.png').then(loaded=>{texture.copy(loaded);texture.colorSpace=THREE.SRGBColorSpace;texture.needsUpdate=true;});
  const bark=new THREE.MeshLambertMaterial({map:texture,color:0xb3a990,alphaTest:.5,side:THREE.DoubleSide});
  const leaf=new THREE.MeshLambertMaterial({map:texture,color:0xc6bca4,emissive:0xffffff,emissiveMap:texture,emissiveIntensity:.08,alphaTest:.5,side:THREE.DoubleSide});
  const parts:THREE.BufferGeometry[]=[];
  const cylinder=(a:THREE.Vector3,b:THREE.Vector3,r:number)=>{
   const g=new THREE.CylinderGeometry(r*.65,r,a.distanceTo(b),7,1,true);g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),b.clone().sub(a).normalize()));g.translate(...a.clone().add(b).multiplyScalar(.5).toArray());
   const uv=g.getAttribute('uv');for(let i=0;i<uv.count;i++)uv.setXY(i,.576+uv.getX(i)*.078,.535+uv.getY(i)*.20);parts.push(g);
  };
  cylinder(new THREE.Vector3(0,1.2,0),new THREE.Vector3(0,6.5,0),.2);
  for(let i=0;i<7;i++){
   const a=i*Math.PI*2/7,x=Math.cos(a),z=Math.sin(a);
   cylinder(new THREE.Vector3(0,2.3,0),new THREE.Vector3(x*1.5,-.3,z*1.5),.105);
   cylinder(new THREE.Vector3(x*1.5,-.3,z*1.5),new THREE.Vector3(x*2.8,-4.6,z*2.8),.085);
   cylinder(new THREE.Vector3(0,4.6,0),new THREE.Vector3(x*2.5,6.2,z*2.5),.075);
  }
  const geometry=mergeGeometries(parts)!;parts.forEach(g=>g.dispose());
  const positions:THREE.Vector3[]=[];
  for(let i=Math.floor(route.count*.65);i<route.count*.90;i+=13){
   const s=route.stations[i],right=new THREE.Vector3(s.t[2],0,-s.t[0]).normalize();
   for(const side of [-1,1])for(const [band,offset] of [s.width/2+9,s.width/2+22,s.width/2+40].entries()){
    // Local deterministic placement hash does not consume the racing RNG.
    const seed=i*71+band*137+side*29;
    const jitter=(n:number)=>{const h=Math.sin(n*12.9898)*43758.5453;return h-Math.floor(h)-.5;};
    positions.push(new THREE.Vector3(s.p[0],0,s.p[2]).addScaledVector(right,side*(offset+jitter(seed)*6)).addScaledVector(new THREE.Vector3(...s.t),jitter(seed+17)*24));
   }
  }
  this.treePositions.push(...positions);
  const trunks=this.trunks=new THREE.InstancedMesh(geometry,bark,positions.length);trunks.frustumCulled=false;trunks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);trunks.name='mangrove_thin_trunks_and_root_fans';
  positions.forEach((p,i)=>{this.pose.position.copy(p);this.pose.rotation.set(0,i*2.399,0);this.pose.scale.setScalar(1);this.pose.updateMatrix();trunks.setMatrixAt(i,this.pose.matrix);for(const [x,y,z] of [[0,6.8,0],[-2,6.2,1],[2,6.5,-1]])this.centers.push(p.clone().add(new THREE.Vector3(x,y,z)));});trunks.computeBoundingSphere();this.root.add(trunks);
  const card=new THREE.PlaneGeometry(7.2,4.2),uv=card.getAttribute('uv');
  // Lower-left atlas cell is a complete canopy silhouette with transparent margins.
  for(let i=0;i<uv.count;i++)uv.setXY(i,.006+uv.getX(i)*.242,.255+uv.getY(i)*.238);
  this.cards=new THREE.InstancedMesh(card,leaf,this.centers.length);this.cards.name='mangrove_camera_facing_canopy_cards';this.cards.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.cards.frustumCulled=false;this.root.add(this.cards);
  this.root.userData.dimensions={trunkDiameter:.4,maximumCanopyTop:8.9,canopyCards:this.centers.length,trunks:positions.length};
 }
 update(camera:THREE.Camera){
  this.frustum.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
  let trees=0,cards=0;
  this.treePositions.forEach((p,i)=>{
   this.sphere.center.copy(p);this.sphere.center.y=2;
   if(!this.frustum.intersectsSphere(this.sphere))return;
   this.pose.position.copy(p);this.pose.rotation.set(0,i*2.399,0);this.pose.scale.setScalar(1);this.pose.updateMatrix();this.trunks.setMatrixAt(trees++,this.pose.matrix);
   for(let j=0;j<3;j++){const center=this.centers[i*3+j];this.pose.position.copy(center);this.pose.rotation.set(0,Math.atan2(camera.position.x-center.x,camera.position.z-center.z),0);this.pose.updateMatrix();this.cards.setMatrixAt(cards++,this.pose.matrix);}
  });
  this.trunks.count=trees;this.cards.count=cards;this.trunks.instanceMatrix.needsUpdate=true;this.cards.instanceMatrix.needsUpdate=true;
 }
}
