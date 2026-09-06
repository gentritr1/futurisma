import * as THREE from 'three';
import type {AscensionCourse} from './ascension-course';
import {AscensionEventPose,BELT_LENGTH,beltPose} from './ascension-event-pose.js';
import {ABILITY_TICK_RATE} from './polarity-simulation.js';

/** Integer-clock event presentation. All materials retain Lambert lighting, fog and tone mapping. */
export class AscensionEffects {
 readonly root=new THREE.Group();
 readonly ready:Promise<void>;
 private readonly pose:AscensionEventPose;
 private readonly crawler:THREE.Object3D;
 private readonly rocket:THREE.Object3D;
 private readonly platform:THREE.Object3D;
 private readonly rocketBase:THREE.Vector3;
 private readonly arms:THREE.Object3D[]=[];
 private readonly links:THREE.InstancedMesh;
 private readonly steam:THREE.InstancedMesh;
 private readonly smoke:THREE.InstancedMesh;
 private readonly deluge:THREE.InstancedMesh;
 private readonly flood:THREE.Mesh;
 private readonly gravel:THREE.InstancedMesh;
 private readonly flame:THREE.Mesh;
 private readonly engine:THREE.Mesh;
 private readonly beacon:THREE.Mesh;
 private readonly lamps:{material:THREE.MeshLambertMaterial,base:number}[]=[];
 private readonly dummy=new THREE.Object3D();
 private readonly reduced=new URLSearchParams(location.search).get('motion')==='reduce';
 private readonly time={value:0};
 private readonly pad=new THREE.Vector3();
 constructor(world:THREE.Group,private readonly course:AscensionCourse){
  this.root.name='ascension_scheduled_effects';
  this.crawler=world.getObjectByName('crawler-transporter_1')!;
  this.platform=world.getObjectByName('rocket-platform_0')!;
  this.rocket=this.platform.children.find(o=>o.name.startsWith('rocket-ascent'))!;
  if(!this.crawler||!this.platform||!this.rocket||!course.schedule.config)throw Error('Missing authored Ascension event hierarchy or calibration');
  this.rocketBase=this.rocket.position.clone();this.pad.copy(this.platform.position);this.pad.y=new THREE.Box3().setFromObject(this.rocket).min.y-2;
  this.pose=new AscensionEventPose(course.schedule.config,this.crawler.position.clone());
  this.arms.push(...this.platform.children.filter(o=>o.name.startsWith('swing-arm-pivot')));
  const lampSet=new Set<THREE.MeshLambertMaterial>();world.traverse(o=>{if(o instanceof THREE.Mesh){const m=o.material as THREE.MeshLambertMaterial;if(m.emissiveIntensity>0&&m.emissiveMap)lampSet.add(m);}});
  lampSet.forEach(material=>this.lamps.push({material,base:material.emissiveIntensity}));
  // Keep the authored track bodies and wheels. Replace only the existing belt plates
  // with a single instanced set that circulates around each capsule-shaped track.
  let treadMaterial:THREE.MeshLambertMaterial|undefined;
  for(const [i,track] of this.crawler.children.filter(o=>o.name.startsWith('crawler-tread')).entries()){
   const centerX=i<2?-16:16;
   track.traverse(o=>{if(!(o instanceof THREE.Mesh))return;
    treadMaterial=o.material as THREE.MeshLambertMaterial;
    const geometry=o.geometry.clone(),p=geometry.attributes.position,index=geometry.index!,keep:number[]=[];
    for(let j=0;j<index.count;j+=3){const face=[index.getX(j),index.getX(j+1),index.getX(j+2)];if(!face.every(v=>Math.abs(Math.abs(p.getX(v)-centerX)-2.9)<.001))keep.push(...face);}
    geometry.setIndex(keep);o.geometry=geometry;
   });
  }
  if(!treadMaterial)throw Error('Missing crawler treads');
  const linkGeometry=new THREE.BoxGeometry(5.8,.2,.51),uv=linkGeometry.attributes.uv;
  for(let i=0;i<uv.count;i++)uv.setXY(i,.012+uv.getX(i)*.476,.012+uv.getY(i)*.476);
  this.links=new THREE.InstancedMesh(linkGeometry,treadMaterial,192);this.links.name='crawler_rotating_tread_links';this.links.frustumCulled=false;this.crawler.add(this.links);
  const water=new THREE.Texture(),delugePaint=new THREE.Texture();
  this.ready=Promise.all([[water,'steam.png'],[delugePaint,'water.jpg']].map(async ([target,file])=>{const texture=await new THREE.TextureLoader().loadAsync('/assets/ascension/textures/'+file);const destination=target as THREE.Texture;destination.copy(texture);destination.colorSpace=THREE.SRGBColorSpace;destination.needsUpdate=true;})).then(()=>undefined);
  const cardMaterial=(name:string,color:number,opacity:number,emission=0)=>{
   const m=new THREE.MeshLambertMaterial({name,color,map:water,transparent:true,opacity,depthWrite:false,side:THREE.DoubleSide,emissive:color,emissiveIntensity:emission});
   m.onBeforeCompile=shader=>{
    shader.uniforms.eventTime=this.time;
    shader.fragmentShader='uniform float eventTime;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
     float grey=dot(sampledDiffuseColor.rgb,vec3(.299,.587,.114));diffuseColor.rgb=mix(diffuseColor.rgb,vec3(grey)*diffuse, .85);
     vec2 q=vMapUv*2.-1.;float edge=1.-smoothstep(.30,1.,length(q));
     float billow=.72+.28*sin(vMapUv.x*21.+sin(vMapUv.y*17.)+eventTime*.7);
     diffuseColor.a*=edge*billow;if(diffuseColor.a<.005)discard;`);
   };return m;
  };
  const cards=(name:string,count:number,m:THREE.Material)=>{const mesh=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1),m,count);mesh.name=name;mesh.frustumCulled=false;this.root.add(mesh);return mesh;};
  this.steam=cards('launch_apron_steam_wall',24,cardMaterial('steam_lit_fogged',0xc5c6b8,.40));
  this.smoke=cards('persistent_launch_smoke',24,cardMaterial('smoke_lit_fogged',0x9c9e94,.64));
  const sheets=new THREE.MeshLambertMaterial({name:'deluge_lit_fogged',color:0xc4d2c7,map:delugePaint,transparent:true,opacity:.36,depthWrite:false,side:THREE.DoubleSide});
  sheets.onBeforeCompile=shader=>{shader.uniforms.eventTime=this.time;shader.fragmentShader='uniform float eventTime;\n'+shader.fragmentShader;shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`vec2 flowUv=vec2(.012+vMapUv.x*.476,.512+fract(vMapUv.y-eventTime*.9)*.476);
   vec4 wetPaint=texture2D(map,flowUv);diffuseColor.rgb*=mix(vec3(1.),wetPaint.rgb,.25);
   float stream=.25+.75*pow(.5+.5*sin(vMapUv.x*145.+sin(vMapUv.y*8.-eventTime*12.)),3.);
   diffuseColor.a*=stream*smoothstep(0.,.06,vMapUv.x)*smoothstep(0.,.06,1.-vMapUv.x);`);};
  this.deluge=cards('deluge_water_sheets',14,sheets);
  const floodGeometry=new THREE.BufferGeometry(),vertices:number[]=[],uvs:number[]=[],indices:number[]=[];
  const stations=course.shortcut.stations;
  for(const [i,st] of stations.entries()){
   const right=new THREE.Vector3(...st.t).cross(new THREE.Vector3(0,1,0)).normalize();
   for(const side of [-1,1]){vertices.push(st.p[0]+right.x*side*9.8,st.p[1]+.045,st.p[2]+right.z*side*9.8);uvs.push(side<0?0:1,i*.2);}
   if(i<stations.length-1)indices.push(i*2,i*2+1,i*2+2,i*2+1,i*2+3,i*2+2);
  }
  floodGeometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));floodGeometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));floodGeometry.setIndex(indices);floodGeometry.computeVertexNormals();
  const floodMaterial=new THREE.MeshLambertMaterial({name:'flood_lit_fogged',color:0x8baba2,transparent:true,opacity:.32,depthWrite:false,side:THREE.DoubleSide});
  floodMaterial.onBeforeCompile=shader=>{shader.uniforms.eventTime=this.time;shader.vertexShader='varying vec3 waterPosition;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nwaterPosition=position;');shader.fragmentShader='uniform float eventTime;varying vec3 waterPosition;\n'+shader.fragmentShader;shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\nfloat ripple=pow(max(0.,sin(waterPosition.x*.8+waterPosition.z*.6-eventTime*2.)),12.);diffuseColor.rgb+=ripple*.12;');};
  this.flood=new THREE.Mesh(floodGeometry,floodMaterial);this.flood.name='trench_flood_water';this.root.add(this.flood);
  this.gravel=new THREE.InstancedMesh(new THREE.CircleGeometry(1,5),new THREE.MeshLambertMaterial({name:'shed_gravel_paint',color:0x817768,map:(this.platform.children.find(o=>o instanceof THREE.Mesh) as THREE.Mesh<THREE.BufferGeometry,THREE.MeshLambertMaterial>).material.map,side:THREE.DoubleSide}),96);this.gravel.name='crawler_shed_gravel';const stoneUV=this.gravel.geometry.attributes.uv;for(let i=0;i<stoneUV.count;i++)stoneUV.setXY(i,.012+stoneUV.getX(i)*.476,.012+stoneUV.getY(i)*.476);
  for(let i=0;i<96;i++){const s=course.sample(.642+(i%16)*.001);this.dummy.position.copy(s.position).addScaledVector(s.right,Math.sin(i*31.7)*s.halfWidth*.85);this.dummy.position.y+=.035;this.dummy.rotation.set(-Math.PI/2,0,i*2.399);this.dummy.scale.set(.25+(i%5)*.11,.25+(i%3)*.13,1);this.dummy.updateMatrix();this.gravel.setMatrixAt(i,this.dummy.matrix);}this.root.add(this.gravel);
  const emissionPaint=(this.platform.children.find(o=>o instanceof THREE.Mesh&&(o.material as THREE.MeshLambertMaterial).emissiveMap) as THREE.Mesh<THREE.BufferGeometry,THREE.MeshLambertMaterial>).material.emissiveMap;
  const fireMaterial=new THREE.MeshLambertMaterial({map:emissionPaint,emissiveMap:emissionPaint,name:'engine_emission_lit_fogged',color:0xca8b41,emissive:0xf6bc74,emissiveIntensity:8,transparent:true,opacity:.82});
  this.flame=new THREE.Mesh(new THREE.CylinderGeometry(1.8,5,1,12,1,true),fireMaterial);this.flame.name='launch_flame_column';this.root.add(this.flame);
  this.engine=new THREE.Mesh(new THREE.SphereGeometry(1,12,8),fireMaterial);this.engine.name='rocket_engine_glow';this.root.add(this.engine);
  for(const mesh of [this.flame,this.engine]){const uv=mesh.geometry.attributes.uv;for(let i=0;i<uv.count;i++)uv.setXY(i,.012+uv.getX(i)*.476,.512+uv.getY(i)*.476);}
  this.beacon=new THREE.Mesh(new THREE.BoxGeometry(.24,.65,.7),new THREE.MeshLambertMaterial({name:'crawler_beacon_lens',color:0xc1a45e,emissive:0xffc76a,emissiveIntensity:.8}));this.beacon.position.set(17.2,16,23);this.crawler.add(this.beacon);
 }
 update(camera:THREE.Camera){
  const clock=this.course.schedule,c=clock.config!;const tick=clock.tick,seconds=tick/ABILITY_TICK_RATE,p=this.pose.at(tick);
  this.time.value=this.reduced?0:seconds;
  this.crawler.position.copy(p.crawler);this.crawler.rotation.y=Math.PI/2;
  this.rocket.position.copy(this.rocketBase);this.rocket.position.y+=p.rocketHeight;this.rocket.visible=!clock.state.rocketGone;
  this.arms.forEach(a=>a.rotation.y=-p.armAngle);
  const radius=Math.hypot(2,.255),fy=2/radius,fz=6/(4+radius),warp=new THREE.Matrix4(),link=new THREE.Matrix4();
  let instance=0;
  for(const x of [-16,16])for(const z of [-17,17])for(let j=0;j<48;j++){
   const b=beltPose(j*BELT_LENGTH/48+p.travel);this.dummy.position.set(0,b.y-2,b.z);this.dummy.rotation.set(b.angle,0,0);this.dummy.scale.set(1,1,1);this.dummy.updateMatrix();warp.makeScale(1,fy,fz);link.multiplyMatrices(warp,this.dummy.matrix);link.setPosition(link.elements[12]+x,link.elements[13]+2,link.elements[14]+z);this.links.setMatrixAt(instance++,link);
  }this.links.instanceMatrix.needsUpdate=true;
  this.beacon.rotation.y=this.reduced?0:seconds*2;this.beacon.userData.klaxon=p.klaxon;
  this.steam.visible=clock.state.steam;this.smoke.visible=clock.state.launched;this.smoke.count=Math.min(24,Math.ceil((p.rocketHeight+40)/20));this.deluge.visible=clock.state.deluge;
  this.flood.visible=clock.state.launched||(tick>=c.testTick&&tick<c.testTick+10*ABILITY_TICK_RATE);
  this.gravel.visible=clock.events.some(e=>e.id.startsWith('crawler-cross'));
  const face=(mesh:THREE.InstancedMesh,i:number,position:THREE.Vector3,width:number,height:number)=>{this.dummy.position.copy(position);this.dummy.quaternion.copy(camera.quaternion);this.dummy.scale.set(width,height,1);this.dummy.updateMatrix();mesh.setMatrixAt(i,this.dummy.matrix);};
  for(let i=0;i<24;i++){
   const s=this.course.sample((i/24)*.16),drift=this.reduced?0:Math.sin(seconds*.18+i)*8;
   face(this.steam,i,s.position.clone().addScaledVector(s.right,(i%2?1:-1)*(20+drift)).addScaledVector(s.up,13),55,24);
   face(this.smoke,i,this.pad.clone().add(new THREE.Vector3(Math.sin(i*2.4)*9+i*1.1,20+i*20,Math.cos(i*2.4)*9)),35+i*1.4,65);
  }
  for(let i=0;i<14;i++){
   const progress=i<2?this.course.shortcut.from+.015+i*.005:this.course.shortcut.from+(this.course.shortcut.to-this.course.shortcut.from)*(.79+(i-2)*.015);
   const s=this.course.sampleShortcut(progress);face(this.deluge,i,s.position.clone().addScaledVector(s.up,5.7),21,12);
  }
  for(const mesh of [this.steam,this.smoke,this.deluge])mesh.instanceMatrix.needsUpdate=true;
  this.flame.visible=clock.state.launched&&!clock.state.rocketGone;this.engine.visible=this.flame.visible;
  const flameHeight=Math.min(65,Math.max(2,p.rocketHeight+2));this.flame.position.copy(this.pad);this.flame.position.y+=p.rocketHeight+2-flameHeight/2;this.flame.scale.set(1,flameHeight,1);
  this.engine.position.copy(this.pad);this.engine.position.y+=p.rocketHeight+2;this.engine.scale.set(4,2,4);
  const wave=seconds-c.launchTick/ABILITY_TICK_RATE-camera.position.distanceTo(this.pad)/343;
  const flicker=!this.reduced&&wave>=0&&wave<1.2?(Math.floor(wave*12)%3===0?.28:1):1;
  this.lamps.forEach(l=>l.material.emissiveIntensity=l.base*flicker);
  this.root.userData.eventState={tick,reducedMotion:this.reduced,crawlerPosition:p.crawler.toArray(),treadTravel:p.travel,rocketHeight:p.rocketHeight,rocketVisible:this.rocket.visible,steamVisible:this.steam.visible,smokeVisible:this.smoke.visible,delugeVisible:this.deluge.visible,floodVisible:this.flood.visible,lampScale:flicker,klaxon:p.klaxon};
  this.course.group.userData.eventState=this.root.userData.eventState;
 }
}
