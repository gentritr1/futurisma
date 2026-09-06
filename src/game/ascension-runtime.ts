import {mergeAscensionStaticPaint} from './ascension-static-paint';
import {AscensionRoadSignals} from './ascension-road-signals';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {ABILITY_TICK_RATE} from './polarity-simulation.js';
import * as THREE from 'three';
import type {CircuitRuntime} from './circuit-runtime';
import type {AscensionCourse} from './ascension-course';
import type {CourseProjection} from './course';
import type {InputController,InputFrame} from './input';
import type {TotemVisualState} from './totem';
/** Phase A clock and published boards. Powers are added after the blockout gate. */
export class AscensionRuntime implements CircuitRuntime {
 readonly ready:Promise<void>;readonly ceiling=false;readonly isFlipping=false;
 readonly surgeActive=false;readonly shieldActive=false;readonly boostRechargeScale=1;
 private remainder=0;
 readonly signals:AscensionRoadSignals;
 private readonly reducedMotion=new URLSearchParams(location.search).get('motion')==='reduce';
 private readonly boards: {root:THREE.Group;canvas:HTMLCanvasElement;texture:THREE.CanvasTexture}[]=[];
 private readonly entryRail:THREE.Mesh;
 private readonly boardHardware=new THREE.Group();
 private lastSecond=-1;
 private readonly output=document.createElement('output');
 constructor(readonly course:AscensionCourse,private readonly input:InputController){
  this.signals=new AscensionRoadSignals(course);course.group.add(this.signals.root);
  input.setPowerControls(true);document.getElementById('polarity-hud')!.hidden=false;this.output.id='ascension-diagnostics';this.output.hidden=true;document.body.append(this.output);
  const entrance=course.sampleShortcut(course.shortcut.from+(course.shortcut.to-course.shortcut.from)*.025);
  this.entryRail=new THREE.Mesh(new THREE.BoxGeometry(20,.7,.3),new THREE.MeshLambertMaterial({color:0xd2a345,map:new THREE.TextureLoader().load('/assets/ascension/textures/signage.jpg')}));
  this.entryRail.position.copy(entrance.position);this.entryRail.position.y-=2;this.entryRail.userData.baseY=entrance.position.y+1.3;
  this.entryRail.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(entrance.right,entrance.up,entrance.tangent.clone().negate()));
  const railUV=this.entryRail.geometry.attributes.uv;for(let i=0;i<railUV.count;i++)railUV.setXY(i,.512+railUV.getX(i)*.476,.012+railUV.getY(i)*.476);
  this.entryRail.name='ascension_entry_only_rail';this.entryRail.visible=false;course.group.add(this.entryRail);
  const masts:THREE.Mesh[]=[],signs:THREE.Mesh[]=[];
  for(const progress of [150/course.length,.80]){
   const root=new THREE.Group(),s=course.sample(progress);root.position.copy(s.position);root.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(s.right,s.up,s.tangent.clone().negate()));
   const steel=new THREE.MeshLambertMaterial({color:0x424f36});
   for(const x of [-15,15]){const mast=new THREE.Mesh(new THREE.BoxGeometry(1,32,1),steel);mast.position.set(x,16,0);root.add(mast);masts.push(mast);}
   const crossbeam=new THREE.Mesh(new THREE.BoxGeometry(1,32,1),steel);crossbeam.scale.set(31,.6/32,1.2);crossbeam.position.y=10.5;root.add(crossbeam);masts.push(crossbeam);
   const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=256;
   const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
   const sign=new THREE.Mesh(new THREE.PlaneGeometry(26.4,7),new THREE.MeshLambertMaterial({map:texture,emissiveMap:texture,emissive:0xffffff,emissiveIntensity:.45,side:THREE.DoubleSide}));sign.position.set(0,26.5,.96);root.add(sign);signs.push(sign);root.name='ascension_countdown_board';
   course.group.add(root);this.boards.push({root,canvas,texture});
  }
  course.group.updateMatrixWorld(true);
  for(const parts of [masts,signs]){
    const batch=new THREE.InstancedMesh(parts[0].geometry.clone(),parts[0].material,parts.length);
    parts.forEach((part,i)=>{batch.setMatrixAt(i,part.matrixWorld);part.removeFromParent();part.geometry.dispose();});
    batch.name=parts===masts?'ascension_board_masts':'ascension_board_displays';this.boardHardware.add(batch);
  }
  course.group.add(this.boardHardware);
  this.ready=new GLTFLoader().loadAsync('/assets/ascension/countdown-board.glb').then(gltf=>{
   gltf.scene.traverse(object=>{if(object instanceof THREE.Mesh){const source=object.material as THREE.MeshStandardMaterial;object.material=new THREE.MeshLambertMaterial({color:source.color,map:source.map,emissive:source.emissive,emissiveMap:source.emissiveMap,emissiveIntensity:source.emissiveIntensity,vertexColors:true});}});
   gltf.scene.traverse(o=>{if(o instanceof THREE.Mesh)o.name='AP_STATIC_'+o.name;});gltf.scene.updateMatrixWorld(true);mergeAscensionStaticPaint(gltf.scene);
   const instances=new Map<THREE.BufferGeometry,THREE.Mesh[]>();
   for(const board of this.boards){
    const housing=gltf.scene.clone(true);housing.position.y=10.5;housing.scale.set(3,2,1);housing.name='ascension_authored_board_housing';board.root.add(housing);
    housing.traverse(object=>{if(object instanceof THREE.Mesh){const parts=instances.get(object.geometry)??[];parts.push(object);instances.set(object.geometry,parts);}});
   }
   course.group.updateMatrixWorld(true);
   for(const [geometry,parts] of instances){const batch=new THREE.InstancedMesh(geometry,parts[0].material,parts.length);batch.name='ascension_authored_board_'+parts[0].name;parts.forEach((part,i)=>{batch.setMatrixAt(i,part.matrixWorld);part.removeFromParent();});this.boardHardware.add(batch);}

  });
 }
 handleActions(_running:boolean,_progress:number,_position:THREE.Vector3,_lateral:number,_demo:boolean){this.input.consumePower();return false;}
 step(delta:number,_progress:number,_lateral:number,lap:number){this.remainder+=delta*ABILITY_TICK_RATE;const ticks=Math.floor(this.remainder+1e-7);this.remainder-=ticks;this.course.setLapBoard(lap);this.course.advanceSchedule(ticks);}
 advanceClocks(delta:number){this.step(delta,0,0,this.course.tide.lap);}
 applySurge(_previous:number,normal:number,_input:InputFrame,_delta:number){return normal;}
 private updateEntryRail(){
  const clock=this.course.schedule,closed=!clock.state.trenchOpen&&!this.course.trenchOccupied;
  const lowering=closed?THREE.MathUtils.clamp((clock.tick-(clock.config?.launchTick??0))/(.6*ABILITY_TICK_RATE),0,1):0;
  this.entryRail.visible=true;this.entryRail.position.y=this.entryRail.userData.baseY+10*(1-lowering);
 }
 present(_sample:CourseProjection,_position:THREE.Vector3,_forward:THREE.Vector3,state:TotemVisualState){state.gravitySign=1;state.gravityTransition=0;this.updateEntryRail();}
 updateCamera(camera:THREE.PerspectiveCamera,_delta:number,position:THREE.Vector3,forward:THREE.Vector3,_speed:number){camera.position.copy(position).addScaledVector(forward,-11.5);camera.position.y+=4.8;const look=position.clone().addScaledVector(forward,19);look.y+=1.15;camera.up.set(0,1,0);camera.lookAt(look);camera.fov=62;camera.updateProjectionMatrix();}
 updateHud(progress:number){
  this.updateEntryRail();
  this.signals.update(this.course.schedule.tick/ABILITY_TICK_RATE,this.reducedMotion,progress,false,this.surgeActive);
  document.getElementById('polarity-deck')!.textContent='PAD 09 / LAUNCH DAY';
  document.getElementById('polarity-flip')!.textContent='SPACE / SHIFT · NITRO';
  document.getElementById('polarity-power')!.textContent='E / DEVICE';
  const clock=this.course.schedule,config=clock.config,seconds=config?Math.ceil((config.launchTick-clock.tick)/ABILITY_TICK_RATE):null;
  if(seconds!==this.lastSecond){this.lastSecond=seconds??-1;
   const text=seconds===null?'CALIBRATING':`T${seconds<0?'+':'−'}${String(Math.floor(Math.abs(seconds)/60)).padStart(2,'0')}:${String(Math.abs(seconds)%60).padStart(2,'0')}`;
   for(const b of this.boards){const ctx=b.canvas.getContext('2d')!;ctx.fillStyle='#263125';ctx.fillRect(0,0,1024,256);ctx.fillStyle='#ffda98';ctx.font='bold 140px monospace';ctx.textAlign='center';ctx.fillText(text,512,145);ctx.font='bold 55px monospace';ctx.fillText(clock.state.trenchOpen?'PAD 09 / TRENCH OPEN':'TRENCH CLOSED / DELUGE ROAD',512,226);b.texture.needsUpdate=true;}
   const line=document.getElementById('polarity-route');if(line)line.textContent=text+' / '+(clock.state.trenchOpen?'TRENCH OPEN':'TAKE DELUGE ROAD');
  }
  this.output.textContent=JSON.stringify({script:'src/game/ascension-runtime.ts',seed:clock.seed,tick:clock.tick,progress,sector:this.course.sectorLabelAt(progress),effects:this.course.group.userData.eventState,trenchOccupied:this.course.trenchOccupied,schedule:config,state:clock.state,events:clock.events});
 }
 onShieldImpact(){return 0;}
 recover(_progress:number){this.course.releaseTrench();}
 reset(){this.remainder=0;this.course.resetSchedule();}
 dispose(){this.signals.dispose();this.boardHardware.removeFromParent();this.boardHardware.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});this.entryRail.removeFromParent();this.entryRail.geometry.dispose();(this.entryRail.material as THREE.Material).dispose();for(const b of this.boards){b.root.removeFromParent();b.texture.dispose();b.root.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});}this.output.remove();}
}
