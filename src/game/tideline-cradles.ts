import * as THREE from 'three';
import type {TidelineCourse} from './tideline-course';
import {PowerKit,type PowerKitVisual} from './power-kit';
import type {PickupDefinition,PickupAppearance} from './power-pickup-field';
import {atlasTile,hardwareAtlas,hardwareMaterial,HardwareBatch} from './tideline-hardware';

interface Cradle {
  root:THREE.Group; swing:THREE.Group; carrier:THREE.Group; cables:THREE.Mesh; jaws:THREE.Mesh[];
  beacon:THREE.Mesh; devices:Record<'surge'|'shield',PowerKitVisual>|null;
  sparks:THREE.Points; collectedAt:number; wasAvailable:boolean;
}
/** Device weight is carried by a rail, hoist cable, tray and two hinged jaws. */
export class TidelineCradles {
  readonly root=new THREE.Group();readonly ready:Promise<void>;
  readonly cradles:Cradle[]=[];
  private kit:PowerKit|null=null;private disposed=false;
  constructor(private readonly course:TidelineCourse,private readonly pickups:readonly PickupDefinition[]) {
    this.root.name='tideline_device_cradles';
    const steel=hardwareMaterial(hardwareAtlas('metal')),sign=hardwareMaterial(hardwareAtlas('signage'));
    const bulb=hardwareMaterial(hardwareAtlas('emissive'),0xffffff,1.1);
    for(const [index,pickup] of pickups.entries()) {
      const station=course.sample(pickup.progress),root=new THREE.Group();root.name=`tideline_cradle_${index}`;
      root.position.copy(station.position);root.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(station.right,station.up,station.tangent.clone().negate()));
      const rail=new HardwareBatch();
      for(const side of [-1,1])rail.box(side*(station.halfWidth+.7),4.25,0,.45,8.5,.7);
      rail.box(0,8.5,0,station.width+2,.45,.65);rail.box(pickup.lateral,8.15,0,1.2,.4,1.1);
      root.add(rail.mesh('cradle_rail_and_hoist',steel));
      const swing=new THREE.Group();swing.position.set(pickup.lateral,8.05,0);root.add(swing);
      const carrier=new THREE.Group();carrier.position.y=-5.8;swing.add(carrier);
      const cableBatch=new HardwareBatch();
      for(const side of [-1,1])cableBatch.box(side*.65,-.5,0,.07,1,.07);
      const cables=cableBatch.mesh('cradle_tension_cables',steel);swing.add(cables);
      const tray=new HardwareBatch();tray.box(0,.9,0,1.5,.12,.22);tray.box(0,-.95,0,2.1,.18,1.5);
      for(const side of [-1,1])tray.box(side*.95,-.78,0,.15,.25,1.5);
      carrier.add(tray.mesh('device_weight_bearing_tray',steel));
      const jaws:THREE.Mesh[]=[];
      for(const side of [-1,1]) {
        const jaw=new HardwareBatch();jaw.box(side*.12,.67,0,.16,1.35,1.12);jaw.box(-side*.07,1.3,0,.5,.16,1.12);
        const mesh=jaw.mesh(`cradle_release_jaw_${side}`,steel);mesh.position.set(side*.9,-.88,0);carrier.add(mesh);jaws.push(mesh);
      }
      const label=new THREE.Mesh(atlasTile(new THREE.PlaneGeometry(3.5,.95),2),sign);label.name='cradle_DEVICE_stencil';label.position.set(pickup.lateral,6.6,.43);label.userData.maximumLetterHeight=.48;root.add(label);
      const beacon=new THREE.Mesh(atlasTile(new THREE.CylinderGeometry(.23,.23,.48,8),0),bulb);beacon.name='cradle_rotating_hazard_beacon';beacon.position.set(pickup.lateral,9,0);root.add(beacon);
      const hood=new THREE.Mesh(atlasTile(new THREE.BoxGeometry(.27,.55,.35),2),steel);hood.position.z=-.15;beacon.add(hood);
      const positions=new Float32Array(18*3),sparkGeometry=new THREE.BufferGeometry();sparkGeometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
      const sparks=new THREE.Points(sparkGeometry,new THREE.PointsMaterial({color:0xffd095,size:.075,transparent:true,opacity:0,depthWrite:false}));sparks.name='cradle_release_sparks';carrier.add(sparks);
      this.root.add(root);this.cradles.push({root,swing,carrier,cables,jaws,beacon,devices:null,sparks,collectedAt:-100,wasAvailable:true});
    }
    this.ready=PowerKit.load(true).then(kit=>{
      if(this.disposed){kit.dispose();return;}this.kit=kit;
      for(const cradle of this.cradles){cradle.devices={surge:kit.createPickupVisual('surge'),shield:kit.createPickupVisual('shield')};for(const device of Object.values(cradle.devices))cradle.carrier.add(device.root);}
    });
  }
  update(time:number,reduced:boolean,states:readonly PickupAppearance[],progress:number):void {
    for(const [index,cradle] of this.cradles.entries()) {
      const state=states[index]??{kind:this.pickups[index].kind,available:true,charge:1};
      if(cradle.wasAvailable&&!state.available)cradle.collectedAt=time;
      if(state.available)cradle.collectedAt=-100;cradle.wasAvailable=state.available;
      const distance=Math.abs(((this.pickups[index].progress-progress+1.5)%1)-.5)*this.course.length;
      cradle.root.visible=distance<280;
      const age=time-cradle.collectedAt;
      const release=state.available?0:Math.min(1,Math.max(0,age)/.22);
      cradle.swing.rotation.z=reduced?0:Math.sin(time*.8+index)*.024;
      cradle.carrier.position.y=-5.8+(state.available?0:Math.min(1,Math.max(0,age-.2)/1.4)*4.4);
      // Cables stay attached to the overhead hook as the hoist retracts.
      cradle.cables.scale.y=-cradle.carrier.position.y-.9;
      cradle.jaws.forEach((jaw,i)=>jaw.rotation.z=(i===0?1:-1)*release*1.05);
      cradle.beacon.rotation.y=reduced?0:time*2.6;
      if(cradle.devices)for(const kind of ['surge','shield'] as const){const device=cradle.devices[kind];device.root.visible=state.available&&kind===state.kind;device.update(time,reduced,state.charge,0);}
      cradle.sparks.visible=!reduced&&!state.available&&age<.45;
      if(cradle.sparks.visible){const positions=cradle.sparks.geometry.getAttribute('position');for(let i=0;i<positions.count;i++){const angle=i*2.399;positions.setXYZ(i,Math.cos(angle)*age*(2+i%3),.8+Math.sin(i*3.4)*age*2-age*age*4,Math.sin(angle)*age*3);}positions.needsUpdate=true;(cradle.sparks.material as THREE.PointsMaterial).opacity=1-age/.45;}
    }
  }
  dispose():void {if(this.disposed)return;this.disposed=true;this.kit?.dispose();}
}
