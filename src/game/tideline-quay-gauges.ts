import * as THREE from 'three';
import route from './data/tideline/route.json';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
/** Mechanical basin gauges belong to the quay infrastructure. A weighted
 * indicator follows the actual water height, with printed depth references. */
export class TidelineQuayGauges {
 readonly root=new THREE.Group();private readonly needles:THREE.InstancedMesh;
 private readonly stations:typeof route.stations=[];private readonly pose=new THREE.Object3D();
 constructor(metal:THREE.Texture|null){
  let texture:THREE.Texture|null=null;
  if(typeof document!=='undefined'){
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=1024;const c=canvas.getContext('2d')!;
  c.fillStyle='#29322b';c.fillRect(0,0,1024,1024);c.strokeStyle='#92977e';c.lineWidth=16;c.strokeRect(22,22,980,980);
  c.fillStyle='#c2bb92';c.textAlign='center';c.font='bold 108px monospace';c.fillText('BASIN',512,145);
  for(const [i,label] of ['FULL  00m','MID  -15m','LOW  -27m'].entries()){c.font='bold 85px monospace';c.fillText(label,555,330+i*285);c.fillRect(70,280+i*285,80,16);}
  c.globalCompositeOperation='destination-out';for(let i=0;i<350;i++)c.fillRect(i*73%1024,i*127%1024,2+i%6,1+i%4);
  texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  }
  const plate=new THREE.MeshLambertMaterial({map:texture,color:0xffffff});
  const steel=new THREE.MeshLambertMaterial({map:metal,color:0x8b9389});
  for(let p=.345;p<.735;p+=.022)this.stations.push(route.stations[Math.floor(p*route.count)]);
  const count=this.stations.length,boards=new THREE.InstancedMesh(new THREE.PlaneGeometry(4.9,4.9),plate,count);
  const arrow=new THREE.ConeGeometry(.31,.8,3);arrow.rotateZ(-Math.PI/2);arrow.translate(-2.05,0,0);
  const crossbar=new THREE.BoxGeometry(4.3,.10,.08);const indicator=mergeGeometries([arrow,crossbar])!;arrow.dispose();crossbar.dispose();
  this.needles=new THREE.InstancedMesh(indicator,new THREE.MeshLambertMaterial({color:0xc8ae65,emissive:0x947847,emissiveIntensity:.4}),count);
  const stems=[];
  for(const [i,s] of this.stations.entries()){
   this.pose.position.set(s.p[0]+s.t[2]*18,s.p[1]+3.7,s.p[2]-s.t[0]*18);this.pose.rotation.set(0,Math.atan2(-s.t[0],-s.t[2]),0);this.pose.updateMatrix();boards.setMatrixAt(i,this.pose.matrix);
   const post=new THREE.BoxGeometry(.18,36,.28);post.translate(-2.65,-13,0);post.applyMatrix4(this.pose.matrix);stems.push(post);
   const bracket=new THREE.BoxGeometry(5.4,.20,.4);bracket.translate(0,2.65,0);bracket.applyMatrix4(this.pose.matrix);stems.push(bracket);
  }
  const geometry=mergeGeometries(stems)!;stems.forEach(g=>g.dispose());this.root.add(new THREE.Mesh(geometry,steel),boards,this.needles);
  boards.name='painted_basin_depth_plates';boards.userData.maximumLetterHeight=.52;this.needles.name='mechanical_water_height_indicators';boards.computeBoundingSphere();this.needles.frustumCulled=false;this.root.name='tideline_quay_depth_gauges';
 }
 update(water:number):void{
  const fraction=THREE.MathUtils.clamp((water+27)/27,0,1);
  for(const [i,s] of this.stations.entries()){
   this.pose.position.set(s.p[0]+s.t[2]*18,s.p[1]+2.1+fraction*2.8,s.p[2]-s.t[0]*18);
   this.pose.rotation.set(0,Math.atan2(-s.t[0],-s.t[2]),0);this.pose.translateZ(.08);this.pose.updateMatrix();this.needles.setMatrixAt(i,this.pose.matrix);
  }this.needles.instanceMatrix.needsUpdate=true;
 }
}
