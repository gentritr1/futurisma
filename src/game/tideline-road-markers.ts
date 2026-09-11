import * as THREE from 'three';
import type {TidelineCourse} from './tideline-course';
import {TIDELINE_ABILITY_CONFIG} from './tideline-rules.js';
import {HardwareBatch,hardwareAtlas,hardwareMaterial} from './tideline-hardware';

/** Painted port signage stays readable above the grazing-angle deck surface.
 * Pictograms carry identity; small lettering names the equipment, not an action.
 */
export function tidelineRoadMarkers(course:TidelineCourse):THREE.Group {
 const canvas=document.createElement('canvas');canvas.width=canvas.height=1024;
 const context=canvas.getContext('2d')!;
 for(let row=0;row<2;row++) {
  const top=row*512;
  context.fillStyle='#414740';context.fillRect(0,top,1024,512);
  context.strokeStyle=row===0?'#d6c28b':'#9bbec0';context.lineWidth=14;
  context.strokeRect(20,top+20,984,472);
  context.lineWidth=42;context.lineCap='square';
  if(row===0) {
   for(const x of [260,512,764]){context.beginPath();context.moveTo(x-74,top+250);context.lineTo(x,top+122);context.lineTo(x+74,top+250);context.stroke();}
  }else {
   context.fillStyle='#9bbec0';context.beginPath();
   for(const [i,[x,y]] of [[545,65],[370,205],[492,205],[448,310],[660,150],[533,150]].entries()){
    if(i===0)context.moveTo(x,top+y);else context.lineTo(x,top+y);
   }
   context.closePath();context.fill();
   context.lineWidth=18;
   for(const side of [-1,1]){context.beginPath();context.moveTo(512+side*270,top+130);context.lineTo(512+side*350,top+130);context.lineTo(512+side*350,top+260);context.lineTo(512+side*270,top+260);context.stroke();}
  }
  context.fillStyle=row===0?'#d6c28b':'#9bbec0';context.font='bold 94px monospace';context.textAlign='center';context.fillText(row===0?'SURGE':'CURRENT',512,top+430);
  // Deterministic paint loss: broad chips plus scratches, never a clean sign.
  for(let i=0;i<270;i++){context.fillStyle=i%3===0?'#545345':'#343b35';context.fillRect((i*179+row*57)%1024,top+(i*227)%512,2+i%17,1+i%5);}
 }
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
 const paint=new THREE.MeshLambertMaterial({map:texture,emissiveMap:texture,emissive:0xffffff,emissiveIntensity:.32});
 const plates=new HardwareBatch(),supports=new HardwareBatch();
 const entries=[...TIDELINE_ABILITY_CONFIG.launchZones.map(zone=>({progress:zone.from,current:false})),{progress:.025,current:true},{progress:.94,current:true}];
 for(const {progress,current} of entries) {
  const sample=course.sample(progress),basis=new THREE.Matrix4().makeBasis(sample.right,sample.up,sample.tangent.clone().negate()).setPosition(sample.position);
  const plate=new THREE.PlaneGeometry(10,2.4),uv=plate.getAttribute('uv');
  for(let i=0;i<uv.count;i++)uv.setY(i,uv.getY(i)*.5+(current?0:.5));
  plate.translate(0,7.1,.45).applyMatrix4(basis);plates.add(plate);
  for(const side of [-1,1]) {
   const post=new THREE.BoxGeometry(.34,8.6,.4).translate(side*(sample.halfWidth+.8),4.3,0).applyMatrix4(basis);supports.add(post);
   const hanger=new THREE.BoxGeometry(.13,1.6,.16).translate(side*4.4,7.9,0).applyMatrix4(basis);supports.add(hanger);
  }
  supports.add(new THREE.BoxGeometry(sample.width+2,.36,.5).translate(0,8.6,0).applyMatrix4(basis));
 }
 const root=new THREE.Group();root.name='tideline_physical_road_identifiers';
 const signs=plates.mesh('painted_launch_and_current_entrance_plates',paint);signs.userData.maximumLetterHeight=.45;
 root.add(supports.mesh('road_identifier_posts_and_hangers',hardwareMaterial(hardwareAtlas('metal'))),signs);
 return root;
}
