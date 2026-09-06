import * as THREE from 'three';
import {disposeObject3DResources} from './graphics-resources';
import type {AscensionCourse} from './ascension-course';
export const ASCENSION_LAUNCH_ZONES=[{id:'pad-road',from:.075,to:.095,lane:0 as const},{id:'causeway',from:.815,to:.835,lane:0 as const}];
import {atlasTile,hardwareMaterial,HardwareBatch} from './tideline-hardware';

interface Strip {root:THREE.Group;from:number;to:number;lamps:THREE.InstancedMesh;flashAt:number}
export class AscensionRoadSignals {
 readonly root=new THREE.Group();readonly strips:Strip[]=[];
 private readonly pose=new THREE.Object3D();private readonly color=new THREE.Color();
 constructor(private readonly course:AscensionCourse) {
  this.root.name='ascension_deck_hardware';
  const texture=new THREE.TextureLoader().load('/assets/ascension/textures/metal.jpg');texture.colorSpace=THREE.SRGBColorSpace;
  const metal=hardwareMaterial(texture);
  const paint=hardwareMaterial(this.wornRoadPaint(),0xffffff,.08);paint.transparent=true;paint.opacity=.82;paint.depthWrite=false;paint.polygonOffset=true;paint.polygonOffsetFactor=-1;
  const lamps=hardwareMaterial(null,0xffffff,.9);
  const sample=course.createSampleScratch();
  for(const zone of ASCENSION_LAUNCH_ZONES) {
   const root=new THREE.Group();root.name=`launch_strip_${zone.id}`;const chevrons=new HardwareBatch();
   const matrices:THREE.Matrix4[]=[];
   for(let p=zone.from;p<zone.to;p+=5/course.length) {
    course.sample(p,sample);const basis=new THREE.Matrix4().makeBasis(sample.right,sample.up,sample.tangent.clone().negate());
    // Separate worn chevron arms leave the road's original paint visible.
    for(const side of [-1,1]) {
     const geometry=atlasTile(new THREE.PlaneGeometry(5.1,1.45),3);geometry.rotateX(-Math.PI/2);geometry.rotateY(-side*.58);geometry.translate(side*2.05,.052,0);geometry.applyMatrix4(basis);geometry.translate(...sample.position.toArray());chevrons.add(geometry);
     this.pose.position.copy(sample.position).addScaledVector(sample.right,side*4.1).addScaledVector(sample.up,.065);this.pose.quaternion.setFromRotationMatrix(basis);this.pose.scale.set(1,1,1);this.pose.updateMatrix();matrices.push(this.pose.matrix.clone());
    }
   }
   root.add(chevrons.mesh('launch_worn_chevron_paint',paint));
   const row=new THREE.InstancedMesh(new THREE.PlaneGeometry(.39,1.3).rotateX(-Math.PI/2),lamps,matrices.length);row.name='launch_recessed_lit_lenses';matrices.forEach((m,i)=>{row.setMatrixAt(i,m);row.setColorAt(i,new THREE.Color(.4,.4,.4));});row.computeBoundingSphere();root.add(row);
   const frames=new HardwareBatch();
   for(const matrix of matrices){
    for(const side of [-1,1]){
     frames.add(atlasTile(new THREE.BoxGeometry(.13,.14,1.6),0).translate(side*.26,.005,0).applyMatrix4(matrix));
     frames.add(atlasTile(new THREE.BoxGeometry(.39,.14,.14),0).translate(0,.005,side*.73).applyMatrix4(matrix));
     for(const end of [-1,1])frames.add(atlasTile(new THREE.CylinderGeometry(.011,.016,.012,8),0).translate(side*.26,.083,end*.73).applyMatrix4(matrix));
    }
   }
   root.add(frames.mesh('launch_recessed_metal_housings_and_rivets',metal));
   const stamp=this.stencil('SURGE'),at=course.sample(zone.from+.002);
   // The same painted stencil is on the deck and two plates fixed to the
   // guardrails. Their height makes the strip entrance readable over a crest.
   const stamps=new THREE.InstancedMesh(stamp.geometry,stamp.material,3);stamps.name=stamp.name;stamps.userData.maximumLetterHeight=.59;
   const basis=new THREE.Matrix4().makeBasis(at.right,at.up,at.tangent.clone().negate());
   this.pose.position.copy(at.position).addScaledVector(at.up,.057);this.pose.quaternion.setFromRotationMatrix(basis);this.pose.scale.setScalar(1);this.pose.updateMatrix();stamps.setMatrixAt(0,this.pose.matrix);
   for(const [i,side] of [-1,1].entries()) {
    this.pose.position.copy(at.position).addScaledVector(at.right,side*(at.halfWidth-.15)).addScaledVector(at.up,1.75);
    this.pose.quaternion.setFromRotationMatrix(basis.clone().multiply(new THREE.Matrix4().makeRotationX(Math.PI/2)));this.pose.updateMatrix();stamps.setMatrixAt(i+1,this.pose.matrix);
   }
   stamps.computeBoundingSphere();root.add(stamps);
   this.root.add(root);this.strips.push({root,from:zone.from,to:zone.to,lamps:row,flashAt:-100});
  }
 }
 private wornRoadPaint():THREE.Texture {
  const canvas=document.createElement('canvas');canvas.width=canvas.height=1024;
  const context=canvas.getContext('2d')!;
  context.fillStyle='#ddd4ac';context.fillRect(0,0,1024,1024);
  // Broad worn patches survive mipmaps; hairline cracks provide close detail.
  for(let i=0;i<220;i++){
   context.fillStyle=i%3===0?'#a69e80':'#c2baa0';
   context.fillRect((i*179)%1024,(i*397)%1024,12+i%47,3+i%11);
  }
  context.globalCompositeOperation='destination-out';
  for(let i=0;i<350;i++)context.fillRect((i*127)%1024,(i*313)%1024,2+i%29,1+i%5);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;return texture;
 }
 private stencil(text:string):THREE.Mesh {
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=64;const c=canvas.getContext('2d')!;
  c.fillStyle='#b4b396';c.font='bold 44px monospace';c.textAlign='center';c.fillText(text,128,48);
  c.globalCompositeOperation='destination-out';for(let i=0;i<180;i++)c.fillRect((i*73)%256,(i*29)%64,1+i%5,1+i%2);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  const material=new THREE.MeshLambertMaterial({map:texture,transparent:true,opacity:.62,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1});
  const geometry=new THREE.PlaneGeometry(3.8,.85);geometry.rotateX(-Math.PI/2);const mesh=new THREE.Mesh(geometry,material);mesh.name='launch_faded_SURGE_stencil';mesh.userData.maximumLetterHeight=.59;return mesh;
 }
 dispose():void {this.root.removeFromParent();disposeObject3DResources(this.root);}
 fireSurge(progress:number,time:number):void {for(const strip of this.strips)if(progress>=strip.from&&progress<strip.to)strip.flashAt=time;}
 update(time:number,reduced:boolean,progress:number,ready:boolean,surge:boolean):void {
  for(const strip of this.strips) {
   const distance=Math.abs((((strip.from+strip.to)/2-progress+1.5)%1)-.5)*this.course.length;strip.root.visible=distance<185;
   const inside=progress>=strip.from&&progress<strip.to;const flash=time-strip.flashAt<.16&&!reduced;
   for(let i=0;i<strip.lamps.count;i++) {
    const chase=reduced?1:.35+.65*Math.pow(.5+.5*Math.sin(time*7-Math.floor(i/2)*1.2),3);
    const pulse=ready&&inside&&!reduced?.65+.35*Math.sin(time*5):1;
    const intensity=flash?2.4:surge&&inside&&Math.abs(Math.floor(i/2)*5-(progress-strip.from)*this.course.length)<12?1.5:.2+chase*.8*pulse;
    this.color.setRGB(intensity,intensity*(flash?1:.79),intensity*(flash?1:.47));strip.lamps.setColorAt(i,this.color);
   }
   strip.lamps.instanceColor!.needsUpdate=true;
  }
 }
}
