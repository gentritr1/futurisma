import * as THREE from 'three';
import type {TidelineCourse} from './tideline-course';
import {TIDELINE_ABILITY_CONFIG,currentLane} from './tideline-rules.js';
import {atlasTile,hardwareAtlas,hardwareMaterial,HardwareBatch} from './tideline-hardware';

interface Strip {root:THREE.Group;from:number;to:number;lamps:THREE.InstancedMesh;flashAt:number}
interface Current {root:THREE.Group;lamps:THREE.InstancedMesh;bubbles:THREE.InstancedMesh;samples:THREE.Matrix4[];side:number}
export class TidelineRoadSignals {
 readonly root=new THREE.Group();readonly strips:Strip[]=[];readonly currents:Current[]=[];
 private readonly pose=new THREE.Object3D();private readonly color=new THREE.Color();
 constructor(private readonly course:TidelineCourse) {
  this.root.name='tideline_deck_hardware';
  const metal=hardwareMaterial(hardwareAtlas('metal'));
  const paint=hardwareMaterial(this.wornRoadPaint(),0xffffff,.08);paint.transparent=true;paint.opacity=.82;paint.depthWrite=false;paint.polygonOffset=true;paint.polygonOffsetFactor=-1;
  const lamps=hardwareMaterial(null,0xffffff,.9);
  const sample=course.createSampleScratch();
  for(const zone of TIDELINE_ABILITY_CONFIG.launchZones) {
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
   const row=new THREE.InstancedMesh(new THREE.BoxGeometry(.65,.065,1.6),lamps,matrices.length);row.name='launch_flush_chasing_lamps';matrices.forEach((m,i)=>{row.setMatrixAt(i,m);row.setColorAt(i,new THREE.Color(.4,.4,.4));});row.computeBoundingSphere();root.add(row);
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
  for(const side of [-1,1]) {
   const root=new THREE.Group();root.name=`current_cable_tray_${side}`;
   const tray=new HardwareBatch(),covers=new HardwareBatch(),samples:THREE.Matrix4[]=[];
   for(const [from,to] of [[.025,.205],[.94,.995]])for(let p=from;p<to;p+=6/course.length) {
    course.sample(p,sample);const basis=new THREE.Matrix4().makeBasis(sample.right,sample.up,sample.tangent.clone().negate());
    this.pose.position.copy(sample.position).addScaledVector(sample.right,side*4);this.pose.quaternion.setFromRotationMatrix(basis);this.pose.scale.setScalar(1);this.pose.updateMatrix();samples.push(this.pose.matrix.clone());
    for(const x of [-1.22,1.22]) {const g=atlasTile(new THREE.BoxGeometry(.12,.16,6.05),2).translate(x,0,0).applyMatrix4(this.pose.matrix);tray.add(g);}
    for(const x of [-.7,-.35,0,.35,.7])tray.add(atlasTile(new THREE.BoxGeometry(.06,.055,6.05),2).translate(x,-.005,0).applyMatrix4(this.pose.matrix));
    const g=new THREE.PlaneGeometry(2.32,5.85);g.rotateX(-Math.PI/2);g.translate(0,.095,0);g.applyMatrix4(this.pose.matrix);covers.add(g);
   }
   root.add(tray.mesh('submerged_cable_tray',metal));
   const glass=new THREE.MeshLambertMaterial({color:0x518788,transparent:true,opacity:.23,emissive:0x172d2b,emissiveIntensity:.12,depthWrite:false,side:THREE.DoubleSide,forceSinglePass:true});
   root.add(covers.mesh('sealed_channel_glass',glass));
   const row=new THREE.InstancedMesh(new THREE.BoxGeometry(1.05,.045,1.25),hardwareMaterial(null,0xb9dfc9,1.4),samples.length);row.name='current_travelling_lamps';
   samples.forEach((m,i)=>{const matrix=m.clone().multiply(new THREE.Matrix4().makeTranslation(0,.035,0));row.setMatrixAt(i,matrix);row.setColorAt(i,new THREE.Color(.3,.3,.3));});row.computeBoundingSphere();root.add(row);
   const bubbles=new THREE.InstancedMesh(new THREE.SphereGeometry(.065,5,3),new THREE.MeshLambertMaterial({color:0x95b8b3,emissive:0x47605e,emissiveIntensity:.35,transparent:true,opacity:.48}),samples.length*2);bubbles.name='current_channel_bubbles';bubbles.frustumCulled=false;root.add(bubbles);
   this.root.add(root);this.currents.push({root,lamps:row,bubbles,samples,side});
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
 fireSurge(progress:number,time:number):void {for(const strip of this.strips)if(progress>=strip.from&&progress<strip.to)strip.flashAt=time;}
 update(time:number,reduced:boolean,progress:number,seed:number,lap:number,ready:boolean,surge:boolean):void {
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
  for(const current of this.currents) {
   const active=lap===1&&current.side===Math.sign(currentLane(seed,lap));
   for(let i=0;i<current.samples.length;i++) {
    const wave=reduced?.8:.2+.8*Math.pow(.5+.5*Math.sin(time*4-i*.8),3);
    this.color.setScalar(active?1.1+wave*.7:.28);current.lamps.setColorAt(i,this.color);
    for(let bubble=0;bubble<2;bubble++) {
     const phase=reduced?.5:(time*.32+i*.37+bubble*.5)%1;
     const local=new THREE.Matrix4().makeTranslation((bubble?1:-1)*.65,.05+Math.sin(phase*Math.PI)*.035,2.8-phase*5.6);
     this.pose.matrix.multiplyMatrices(current.samples[i],local);current.bubbles.setMatrixAt(i*2+bubble,this.pose.matrix);
    }
   }
   current.lamps.instanceColor!.needsUpdate=true;current.bubbles.instanceMatrix.needsUpdate=true;current.bubbles.visible=active&&!reduced;
  }
 }
}
