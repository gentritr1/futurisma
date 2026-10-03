import * as THREE from 'three';
import {overlapsCircuitSignature} from './circuit-signature-sites';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {Reflector} from 'three/addons/objects/Reflector.js';
import {RelayEffects} from './afterglow-relay-effects';
import type {AfterglowCourse} from './afterglow-course';
import type {RaceEnvironment,RaceEnvironmentStats} from './environment';

const ASSETS='/assets/afterglow/';
const UP=new THREE.Vector3(0,1,0);
const CELLS:Record<string,[number,number]>={concrete:[0,.5],blue:[.5,0],orange:[0,0],road:[.5,.5],silver:[0,.5]};

/** Original Blender models, instanced structural parts and a painted sky.
 * The boulevard has one low-resolution planar puddle reflection. The rest of
 * the elevated circuit uses inexpensive painted sky and lamp reflections.
 */
export class AfterglowEnvironment implements RaceEnvironment {
  readonly root=new THREE.Group();
  readonly stats:RaceEnvironmentStats={meshes:0,triangles:0,materials:0,textures:0,visibleGroups:0,visibleTriangles:0,shaderModel:'lambert',signageSource:'baked',contractDrift:[]};
  private readonly materials=new Map<string,THREE.Material>();
  private readonly boxes=new Map<THREE.Material,THREE.Matrix4[]>();
  private readonly geometryBatches=new Map<THREE.Material,THREE.BufferGeometry[]>();
  private readonly train=new THREE.Group();
  private readonly trainPath:THREE.CatmullRomCurve3;
  private readonly dishes:{head:THREE.Object3D;rotation:THREE.Euler}[]=[];
  private readonly sky:THREE.Mesh;
  private readonly clock={value:0};
  private readonly beacons:THREE.MeshBasicMaterial;
  private readonly rain:THREE.LineSegments;
  private readonly cameraForward=new THREE.Vector3();
  private lastTime=-1;
  private readonly trainPoint=new THREE.Vector3();
  private readonly trainTangent=new THREE.Vector3();
  private readonly wetMaterials:THREE.Material[]=[];
  private readonly relayEffects:RelayEffects;

  static async load(course:AfterglowCourse):Promise<AfterglowEnvironment>{
    const loader=new GLTFLoader(),textures=new THREE.TextureLoader();
    const [atlas,sky,facade,...models]=await Promise.all([
      textures.loadAsync(ASSETS+'materials.png'),textures.loadAsync(ASSETS+'sky.png'),textures.loadAsync(ASSETS+'facade.png'),
      ...['relay_dish','relay_terminal','relay_gate','relay_train','relay_palm'].map(name=>loader.loadAsync(ASSETS+name+'.glb')),
    ]);
    atlas.colorSpace=sky.colorSpace=THREE.SRGBColorSpace;atlas.anisotropy=4;sky.wrapS=THREE.RepeatWrapping;
    facade.colorSpace=THREE.SRGBColorSpace;facade.anisotropy=4;
    return new AfterglowEnvironment(course,atlas,sky,facade,models.map(model=>model.scene));
  }
  private constructor(private readonly course:AfterglowCourse,atlas:THREE.Texture,panorama:THREE.Texture,facade:THREE.Texture,models:THREE.Group[]){
    this.root.name='afterglow_original_blender_city';
    const colors:Record<string,number>={concrete:0xbbc5d5,blue:0x8fa8d5,orange:0xffffff,dark:0x0c1725,silver:0x8c9ab3,amber:0xffc58a,mint:0x81e8dc,leaf:0x314b2b,leaflight:0x617d3a,bark:0x514934,white:0xd4d4bf,road:0x64697c};
    for(const [name,color] of Object.entries(colors)){
      const cell=CELLS[name];let map:THREE.Texture|undefined;
      if(cell){map=atlas.clone();map.repeat.set(.488,.488);map.offset.set(cell[0]+.006,cell[1]+.006);map.needsUpdate=true;}
      const material=name==='amber'||name==='mint'?new THREE.MeshBasicMaterial({color,toneMapped:false}):new THREE.MeshLambertMaterial({color,map,side:name.startsWith('leaf')?THREE.DoubleSide:THREE.FrontSide});
      material.name='afterglow_'+name;this.materials.set(name,material);
      if(name.startsWith('leaf')){
        material.onBeforeCompile=shader=>{
          shader.uniforms.relayTime=this.clock;
          shader.vertexShader='uniform float relayTime;\n'+shader.vertexShader;
          shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\ntransformed.x += sin(relayTime*1.3+position.z*.3+position.x*.2)*.14;');
        };
      }
    }
    this.materials.set('facade',new THREE.MeshLambertMaterial({map:facade,color:0xa4b6d0,emissive:0x46516a,emissiveMap:facade,emissiveIntensity:.22}));
    this.materials.set('window',new THREE.MeshLambertMaterial({color:0x80603e,emissive:0xc08242,emissiveIntensity:.32}));
    this.materials.set('facadeWarm',new THREE.MeshLambertMaterial({map:facade,color:0xddd1c3,emissive:0x4a4750,emissiveMap:facade,emissiveIntensity:.22}));
    this.beacons=new THREE.MeshBasicMaterial({color:0xff6a43});this.materials.set('beacon',this.beacons);
    const reflectionMap=panorama;
    const road=new THREE.MeshPhongMaterial({color:0xffffff,map:(this.materials.get('road') as THREE.MeshLambertMaterial).map,shininess:95,specular:0x27313a});
    road.name='afterglow_road_surface';road.color.setRGB(1.55,1.4,1.2);
    road.onBeforeCompile=shader=>{
      shader.uniforms.relaySky={value:reflectionMap};shader.uniforms.relayTime=this.clock;
      shader.vertexShader='attribute vec2 relayRoad;varying vec2 roadCoord;varying vec3 relayWorld;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <worldpos_vertex>','#include <worldpos_vertex>\nrelayWorld=(modelMatrix*vec4(transformed,1.)).xyz;roadCoord=relayRoad;');
      shader.fragmentShader='uniform sampler2D relaySky;uniform float relayTime;varying vec3 relayWorld;varying vec2 roadCoord;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','#include <map_fragment>\ndiffuseColor.rgb=mix(diffuseColor.rgb,vec3(.045,.049,.056),.91);');
      shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
        vec3 eye=normalize(relayWorld-cameraPosition);
        vec3 reflected=reflect(eye,vec3(0.,1.,0.));
        float wav=sin(relayWorld.x*.65+relayWorld.z*.18)*.004+sin(relayWorld.z*1.7)*.002;
        vec2 skyUV=vec2(fract(atan(reflected.z,reflected.x)/6.283185+.22+wav),clamp(.24+reflected.y*.55,.19,.98));
        vec3 wetSky=texture2D(relaySky,skyUV).rgb;
        wetSky=mix(vec3(dot(wetSky,vec3(.2126,.7152,.0722))),wetSky,.28);
        float mask=smoothstep(.18,.67,sin(relayWorld.x*.36+sin(relayWorld.z*.17))*sin(relayWorld.z*.31)*.5+.5);
        float fresnel=pow(1.-abs(eye.y),3.);
        float lampDistance=abs(mod(roadCoord.y+7.,36.4)-18.2);
        float lampPool=exp(-lampDistance*lampDistance*.022)*exp(-pow((abs(roadCoord.x)-.64)*6.,2.));
        float broken=sin(relayWorld.z*17.+sin(relayWorld.x*9.)*2.)*.08+.92;
        outgoingLight+=vec3(.23,.12,.038)*lampPool*broken*fresnel;
        outgoingLight+=vec3(.02,.085,.077)*pow(abs(roadCoord.x),12.)*mask*broken*fresnel;
        outgoingLight=mix(outgoingLight,wetSky*.45,mask*fresnel*.32);
        #include <opaque_fragment>`);
    };
    this.materials.set('road',road);this.wetMaterials.push(road);
    this.buildRoad();
    this.buildPuddles();
    for(const model of models)model.traverse(object=>{
      if(!(object instanceof THREE.Mesh))return;
      const original=Array.isArray(object.material)?object.material[0]:object.material;
      object.material=this.materials.get(original.name)??this.materials.get('concrete')!;
      object.castShadow=true;object.receiveShadow=true;
    });
    const [dish,terminal,gate,car,palm]=models;
    // The opening hero is placed from the road basis, never guessed in world XY.
    for(const [progress,lateral,scale,yaw] of [[.039,-52,1,-.55],[.335,-75,.8,1.1],[.765,85,.6,-1.5]]){
      const object=dish.clone(true);this.place(object,progress,lateral,scale,yaw);this.root.add(object);
      const head=object.getObjectByName('dish_head');if(head)this.dishes.push({head,rotation:head.rotation.clone()});
      const base=this.course.sample(progress).position.clone().addScaledVector(this.course.sample(progress).right,lateral);
      this.box('concrete',base.clone().add(new THREE.Vector3(0,-3,0)),new THREE.Vector3(70,6,72));
    }
    for(const [progress,lateral,yaw] of [[.018,43,-Math.PI/2],[.058,44,-Math.PI/2],[.09,-48,Math.PI/2],[.135,-47,Math.PI/2],[.3,55,-Math.PI/2],[.515,-47,Math.PI/2],[.565,48,-Math.PI/2],[.76,-53,Math.PI/2],[.9,52,-Math.PI/2]]){
      const object=terminal.clone(true);this.place(object,progress,lateral,1,yaw);this.bake(object);
    }
    for(const [index,progress] of [0,.145,.31,.46,.62,.79,.92].entries()){
      const object=gate.clone(true);this.place(object,progress,0,1,0);this.bake(object);
      this.sign(index===0?'AFTERGLOW  /  RELAY 08':`${String(index).padStart(2,'0')}  /  ${course.sectorLabelAt(progress)}`,progress,0,14.55,31,2.8);
    }
    const entryGate=gate.clone(true);this.place(entryGate,.028,0,1.2,0);this.bake(entryGate);
    this.sign('AFTERGLOW  /  RELAY 08',.028,0,17.46,37.2,3.36,3.65);
    this.sign('08   /   ORBITAL RELAY',.039,-52,4.5,17,3.5,17);
    for(let i=0;i<38;i++){
      const progress=(i/38+.012)%1,lateral=i%2?-24:26;
      if(overlapsCircuitSignature(course,course.sample(progress).position.clone().addScaledVector(course.sample(progress).right,lateral),3))continue;
      const object=palm.clone(true);this.place(object,progress,lateral,.72+(i%4)*.1,i*1.7);this.bake(object);
      const s=course.sample(progress);this.box('concrete',s.position.clone().addScaledVector(s.right,lateral).addScaledVector(UP,.4),new THREE.Vector3(5,.8,5));
    }
    this.buildCity();
    this.buildTerminalCanopy();
    this.buildSignals();
    this.buildRelayDetails();
    this.buildStreetLife();
    this.relayEffects=new RelayEffects(course,this.dishes.map(dish=>dish.head));this.root.add(this.relayEffects.root);
    // A second transport network travels alongside the opening boulevard and
    // across the high line, well above the race's 10 m clearance envelope.
    const railPoints=Array.from({length:30},(_,i)=>{
      const s=course.sample(i/30);return s.position.clone().addScaledVector(s.right,32).addScaledVector(UP,22);
    });
    this.trainPath=new THREE.CatmullRomCurve3(railPoints,true,'centripetal');this.trainPath.arcLengthDivisions=2000;
    const railCount=420;
    for(let i=0;i<railCount;i++){
      const a=this.trainPath.getPointAt(i/railCount),b=this.trainPath.getPointAt((i+1)/railCount);
      this.beam('concrete',a,b,5.4,1.5);
      if(i%6===0)this.box('blue',a.clone().addScaledVector(UP,-18),new THREE.Vector3(2.5,36,3));
    }
    for(let i=0;i<5;i++){const object=car.clone(true);object.position.z=i*16;this.train.add(object);}
    this.root.add(this.train);
    this.sky=new THREE.Mesh(new THREE.SphereGeometry(560,40,24),new THREE.ShaderMaterial({
      uniforms:{panorama:{value:panorama}},side:THREE.BackSide,depthWrite:false,depthTest:false,
      vertexShader:'varying vec3 direction;void main(){direction=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader:`uniform sampler2D panorama;varying vec3 direction;void main(){vec3 d=normalize(direction);float u=fract(atan(d.z,d.x)/6.283185+.22);float v=clamp(.24+d.y*.72,0.,.995);vec3 c=texture2D(panorama,vec2(u,v)).rgb;float seam=smoothstep(0.,.035,min(u,1.-u));c=mix((texture2D(panorama,vec2(.003,v)).rgb+texture2D(panorama,vec2(.997,v)).rgb)*.5,c,seam);gl_FragColor=vec4(c,1.);#include <tonemapping_fragment>\n#include <colorspace_fragment>}`.replace(';#include',';\n#include'),
    }));
    this.sky.name='afterglow_painted_sky';this.sky.frustumCulled=false;this.sky.renderOrder=-990;this.root.add(this.sky);
    this.rain=this.buildRain();this.root.add(this.rain);
    this.flush();
    this.root.traverse(o=>{if(o instanceof THREE.Mesh){this.stats.meshes++;this.stats.triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3*(o instanceof THREE.InstancedMesh?o.count:1);}});
    this.stats.materials=this.materials.size;this.stats.textures=8;this.stats.visibleGroups=this.stats.meshes;this.stats.visibleTriangles=this.stats.triangles;
    course.group.userData.afterglow={originalModels:5,generatedTextures:3,length:course.length,dishes:3,palms:38,trainCars:5};
  }
  private box(name:string,position:THREE.Vector3,size:THREE.Vector3,quaternion=new THREE.Quaternion()){
    const material=this.materials.get(name)!;
    let matrices=this.boxes.get(material);if(!matrices){matrices=[];this.boxes.set(material,matrices);}
    matrices.push(new THREE.Matrix4().compose(position,quaternion,size));
  }
  private beam(name:string,a:THREE.Vector3,b:THREE.Vector3,width:number,height:number){
    const direction=b.clone().sub(a),forward=direction.clone().normalize();
    const right=new THREE.Vector3().crossVectors(UP,forward).normalize();
    const up=new THREE.Vector3().crossVectors(forward,right).normalize();
    const q=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right,up,forward));
    this.box(name,a.clone().add(b).multiplyScalar(.5),new THREE.Vector3(width,height,direction.length()+.12),q);
  }
  private place(object:THREE.Object3D,progress:number,lateral:number,scale:number,yaw:number){
    const s=this.course.sample(progress);object.position.copy(s.position).addScaledVector(s.right,lateral);
    object.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(s.right,UP,s.tangent.clone().negate()));object.rotateY(yaw);object.scale.setScalar(scale);object.updateMatrixWorld(true);
  }
  private bake(object:THREE.Object3D){
    object.updateMatrixWorld(true);object.traverse(o=>{
      if(!(o instanceof THREE.Mesh))return;
      const geometry=o.geometry.clone().applyMatrix4(o.matrixWorld);
      const material=o.material as THREE.Material;
      let batch=this.geometryBatches.get(material);if(!batch){batch=[];this.geometryBatches.set(material,batch);}batch.push(geometry);
    });
  }
  private flush(){
    for(const [material,matrices] of this.boxes){
      const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),material,matrices.length);
      matrices.forEach((m,i)=>mesh.setMatrixAt(i,m));mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();
      mesh.castShadow=material.type!=='MeshBasicMaterial';mesh.receiveShadow=true;mesh.name='afterglow_instanced_'+material.name;this.root.add(mesh);
    }
    for(const [material,geometries] of this.geometryBatches){
      // GLTF assets include normals and UVs; ignore optional Blender tangents.
      for(const g of geometries)for(const name of Object.keys(g.attributes))if(!['position','normal','uv'].includes(name))g.deleteAttribute(name);
      const flat=geometries.map(g=>g.index?g.toNonIndexed():g);
      const merged=mergeGeometries(flat);if(merged){const mesh=new THREE.Mesh(merged,material);mesh.castShadow=material.type!=='MeshBasicMaterial';mesh.receiveShadow=true;mesh.name='afterglow_blender_'+material.name;this.root.add(mesh);}
      for(const g of new Set([...geometries,...flat]))g.dispose();
    }
    this.boxes.clear();this.geometryBatches.clear();
  }
  private buildRoad(){
    const positions:number[]=[],uvs:number[]=[],indices:number[]=[],roadCoords:number[]=[];
    const n=960;
    for(let i=0;i<n;i++){
      const a=this.course.sample(i/n),b=this.course.sample((i+1)/n),base=positions.length/3;
      for(const [sample,v] of [[a,0],[b,1]] as const)for(const side of [-1,1]){
        const p=sample.position.clone().addScaledVector(sample.right,14*side);positions.push(p.x,p.y,p.z);uvs.push((side+1)/2,((i%5)+v)/5);roadCoords.push(side,(i+v)/n*this.course.length);
      }
      indices.push(base,base+1,base+3,base,base+3,base+2);
      for(const side of [-1,1]){
        const start=a.position.clone().addScaledVector(a.right,side*14.65),end=b.position.clone().addScaledVector(b.right,side*14.65);
        this.beam('concrete',start.clone().addScaledVector(UP,.8),end.clone().addScaledVector(UP,.8),1.1,1.6);
        this.beam(i%4<2?'orange':'white',start.clone().addScaledVector(a.right,-side*.9).addScaledVector(UP,.07),end.clone().addScaledVector(b.right,-side*.9).addScaledVector(UP,.07),.8,.14);
        if(i%6===0)this.beam('mint',start.clone().addScaledVector(a.right,-side*.58).addScaledVector(UP,.66),end.clone().addScaledVector(b.right,-side*.58).addScaledVector(UP,.66),.07,.2);
      }
      if(i%5<2){for(const side of [-1,1])this.beam('white',a.position.clone().addScaledVector(a.right,4.5*side).addScaledVector(UP,.025),b.position.clone().addScaledVector(b.right,4.5*side).addScaledVector(UP,.025),.16,.018);}
      if(i%16===0){const p=a.position.clone().addScaledVector(UP,-18);this.box('blue',p,new THREE.Vector3(8,35,8));}
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setAttribute('relayRoad',new THREE.Float32BufferAttribute(roadCoords,2));geometry.setIndex(indices);geometry.computeVertexNormals();
    const road=new THREE.Mesh(geometry,this.materials.get('road'));road.name='afterglow_drivable_road';road.receiveShadow=true;this.root.add(road);
    // Continuous underside gives the elevated road mass from every viewpoint.
    for(let i=0;i<n;i+=3){const a=this.course.sample(i/n).position.clone().addScaledVector(UP,-1.5),b=this.course.sample((i+3)/n).position.clone().addScaledVector(UP,-1.5);this.beam('blue',a,b,30,2.8);}
    // Actual line is across the road, at checkpoint 0.
    const s=this.course.sample(0);for(let x=-13;x<14;x+=2)for(let z=0;z<2;z++)if(((x+13)/2+z)%2===0)this.box('white',s.position.clone().addScaledVector(s.right,x+1).addScaledVector(s.tangent,z*1.5).addScaledVector(UP,.04),new THREE.Vector3(2,.025,1.5),new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(s.right,UP,s.tangent.clone().negate())));
  }
  private buildCity(){
    let seed=84;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
    const positions=this.course.points;
    // Overlap the vanishing point with a few distinct relay towers. These
    // authored anchors sit beyond the first turn, outside the road envelope.
    for(const [x,z,h,w] of [[-20,-370,152,28],[20,-315,118,23],[64,-360,195,32],[105,-280,104,26],[-85,-410,142,30],[-135,-440,173,26],[-190,-425,155,27]]){
      const base=new THREE.Vector3(x,h/2-28,z);
      this.box('facadeWarm',base,new THREE.Vector3(w,h,30));
      this.box('blue',new THREE.Vector3(x,h-26,z),new THREE.Vector3(w+2,4,32));
      this.box('silver',new THREE.Vector3(x,h-15,z),new THREE.Vector3(.6,23,.6));
      this.box('beacon',new THREE.Vector3(x,h-3,z),new THREE.Vector3(1,1,1));
      for(let y=8;y<h-4;y+=12)this.box('amber',new THREE.Vector3(x+w*.2,y-28,z+15.05),new THREE.Vector3(w*.18,2,.1));
    }
    // Deliberate overlapping silhouettes behind the opening vista, beyond the
    // northern turn's clearance envelope. Random massing alone left this empty.
    for(let i=0;i<26;i++){
      const x=-390+i*31,z=-430-(i%4)*54,h=55+(i*47%125),w=18+(i%3)*9;
      this.box(i%3?'facade':'facadeWarm',new THREE.Vector3(x,h/2-30,z),new THREE.Vector3(w,h,25+(i%4)*5));
      this.box('blue',new THREE.Vector3(x,h-27,z),new THREE.Vector3(w*.7,7,20));
      this.box('silver',new THREE.Vector3(x,h-15,z),new THREE.Vector3(.5,22,.5));
      this.box('beacon',new THREE.Vector3(x,h-4,z),new THREE.Vector3(1,1,1));
    }
    for(let i=0;i<380;i++){
      const x=-1050+random()*2000,z=-950+random()*2100;
      if(x<0&&x>-150&&z<30&&z>-180)continue;
      let distance=Infinity;for(let j=0;j<positions.length;j+=5)distance=Math.min(distance,(positions[j].x-x)**2+(positions[j].z-z)**2);
      if(distance<75*75)continue;
      const height=30+random()**1.4*150,w=12+random()*26,d=12+random()*25,base=-38;
      this.box(i%3?'facade':'facadeWarm',new THREE.Vector3(x,base+height/2,z),new THREE.Vector3(w,height,d));
      this.box('dark',new THREE.Vector3(x,base+height+1,z),new THREE.Vector3(w+1,2,d+1));
      this.box('blue',new THREE.Vector3(x,base+height+6,z),new THREE.Vector3(w*.52,10,d*.6));
      if(i%3===0){this.box('silver',new THREE.Vector3(x,base+height+19,z),new THREE.Vector3(.6,28,.6));this.box('beacon',new THREE.Vector3(x,base+height+33,z),new THREE.Vector3(1,1,1));}
      for(let floor=5;floor<height-4;floor+=14)for(let col=0;col<2;col++){
        if(random()<.5)continue;
        this.box('amber',new THREE.Vector3(x-w*.32+col*w*.32,base+floor,z+d*.5+.02),new THREE.Vector3(1.3,2.2,.05));
        this.box('amber',new THREE.Vector3(x+w*.5+.02,base+floor,z-d*.3+col*d*.3),new THREE.Vector3(.05,2.2,1.3));
      }
    }
    // Dense midground follows the circuit, with a clear road envelope.
    for(let i=0;i<66;i++){
      const p=(i/66+.011)%1,s=this.course.sample(p),side=i%2?1:-1;
      if(p<.105&&side<0)continue;
      const base=s.position.clone().addScaledVector(s.right,side*(40+(i%3)*5));const h=9+(i%5)*6;
      if(overlapsCircuitSignature(this.course,base,16))continue;
      this.box(i%4?'facadeWarm':'blue',base.clone().addScaledVector(UP,h/2-2),new THREE.Vector3(21,h,20));
      this.box('blue',base.clone().addScaledVector(UP,h-1),new THREE.Vector3(23,2,22));
      for(let y=3;y<h-1;y+=5)this.box('amber',base.clone().addScaledVector(s.right,-side*10.6).addScaledVector(UP,y),new THREE.Vector3(.15,1.25,16),new THREE.Quaternion().setFromAxisAngle(UP,Math.atan2(s.tangent.x,s.tangent.z)));
    }
    this.box('dark',new THREE.Vector3(-100,-42,120),new THREE.Vector3(2600,4,2600));
  }
  private buildPuddles(){
    // Only the first 82 m are planar. A single 512 px reflection keeps the
    // satellite, moving train and lights visible in the water at modest cost.
    const puddle=new Reflector(new THREE.PlaneGeometry(27.2,82),{textureWidth:512,textureHeight:512,multisample:0,clipBias:.003,color:0x9ca8b8});
    puddle.name='afterglow_boulevard_puddles';puddle.rotation.x=-Math.PI/2;puddle.position.set(0,.018,-41);
    const material=puddle.material as THREE.ShaderMaterial;
    material.addEventListener('dispose',()=>puddle.getRenderTarget().dispose());
    material.transparent=true;material.depthWrite=false;
    material.vertexShader='varying vec2 puddleCoord;\n'+material.vertexShader.replace('void main() {','void main() { puddleCoord=position.xy;');
    material.fragmentShader='varying vec2 puddleCoord;\n'+material.fragmentShader;
    material.fragmentShader=material.fragmentShader.replace('vec4 base = texture2DProj( tDiffuse, vUv );',`vec4 reflectedUv=vUv;reflectedUv.x+=sin(puddleCoord.y*8.+puddleCoord.x)*.0008*vUv.w;vec4 base=texture2DProj(tDiffuse,reflectedUv);`);
    material.fragmentShader=material.fragmentShader.replace('gl_FragColor = vec4( blendOverlay( base.rgb, color ), 1.0 );',`float patches=smoothstep(-.2,.5,sin(puddleCoord.x*.43+sin(puddleCoord.y*.12))*cos(puddleCoord.y*.19));float edge=smoothstep(0.,2.,13.6-abs(puddleCoord.x))*smoothstep(0.,5.,41.-abs(puddleCoord.y));gl_FragColor=vec4(base.rgb*.82,edge*(.04+patches*.35));`);
    this.root.add(puddle);
  }
  private buildTerminalCanopy(){
    // Opening concourse canopy, running beside the race rather than across it.
    for(let i=0;i<14;i++){
      const s=this.course.sample(.004+i*.0037),q=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(s.right,UP,s.tangent.clone().negate()));
      this.box('concrete',s.position.clone().addScaledVector(s.right,23).addScaledVector(UP,4.7),new THREE.Vector3(.65,9.4,.7),q);
      this.box('silver',s.position.clone().addScaledVector(s.right,30).addScaledVector(UP,9.4),new THREE.Vector3(15,.5,1),q);
      this.box('amber',s.position.clone().addScaledVector(s.right,27).addScaledVector(UP,9.1),new THREE.Vector3(7,.12,.36),q);
      this.box('amber',s.position.clone().addScaledVector(s.right,23.5).addScaledVector(UP,8.9),new THREE.Vector3(.25,.24,10.2),q);
      if(i%3===0)this.box('blue',s.position.clone().addScaledVector(s.right,24).addScaledVector(UP,6.8),new THREE.Vector3(2.8,4.2,.16),q);
    }
    for(let i=0;i<16;i++){
      const p=.505+i*.006,s=this.course.sample(p),q=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(s.right,UP,s.tangent.clone().negate()));
      for(const side of [-1,1])this.box('concrete',s.position.clone().addScaledVector(s.right,side*18).addScaledVector(UP,6),new THREE.Vector3(1.2,12,1.2),q);
      this.box('blue',s.position.clone().addScaledVector(UP,12),new THREE.Vector3(39,1,1.2),q);
      if(i%2===0)this.box('amber',s.position.clone().addScaledVector(UP,11.4),new THREE.Vector3(30,.2,.5),q);
    }
  }
  private sign(text:string,progress:number,lateral:number,height:number,width:number,size:number,front=3.04){
    const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=128;
    const ctx=canvas.getContext('2d')!;ctx.fillStyle='#142b3e';ctx.fillRect(0,0,1024,128);ctx.fillStyle='#a7f5df';ctx.font='bold 48px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,512,64,970);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(width,size),new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide}));
    this.place(mesh,progress,lateral,1,0);mesh.position.y+=height;mesh.position.addScaledVector(this.course.sample(progress).tangent,-front);this.root.add(mesh);
  }
  private buildSignals(){
    const canvas=document.createElement('canvas');canvas.width=128;canvas.height=64;const ctx=canvas.getContext('2d')!;
    ctx.fillStyle='#161d20';ctx.fillRect(0,0,128,64);ctx.fillStyle='#f0b72f';
    for(const x of [5,60]){ctx.beginPath();ctx.moveTo(x,3);ctx.lineTo(x+26,3);ctx.lineTo(x+52,32);ctx.lineTo(x+26,61);ctx.lineTo(x,61);ctx.lineTo(x+26,32);ctx.fill();}
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    const material=new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide});
    for(const progress of [.012,.025,.04,.055]){
      const panel=new THREE.Mesh(new THREE.PlaneGeometry(5.8,2.6),material);
      this.place(panel,progress,-14.9,1,.5);panel.position.y+=2.6;panel.scale.x=-1;this.bake(panel);
    }
    for(let i=0;i<130;i++){
      const p=i/130,s=this.course.sample(p);if(Math.abs(s.curvature)<.27)continue;
      const side=s.curvature>0?-1:1,mesh=new THREE.Mesh(new THREE.PlaneGeometry(4.4,2.2),material);
      this.place(mesh,p,side*14.6,1,side>0?Math.PI*.45:-Math.PI*.45);mesh.position.y+=2.4;this.bake(mesh);
    }
    for(let i=0;i<75;i++){
      const p=i/75,s=this.course.sample(p),side=i%2?-1:1,base=s.position.clone().addScaledVector(s.right,side*17.5);
      this.box('silver',base.clone().addScaledVector(UP,5),new THREE.Vector3(.25,10,.25));
      this.beam('silver',base.clone().addScaledVector(UP,10),base.clone().addScaledVector(UP,10).addScaledVector(s.right,-side*5),.22,.22);
      this.box('amber',base.clone().addScaledVector(UP,9.85).addScaledVector(s.right,-side*4.5),new THREE.Vector3(1.8,.25,1.2));
      // A stylised painted reflection below each lamp, broken into short bars.
      for(let j=0;j<4;j++){
        const reflected=s.position.clone().addScaledVector(s.right,side*(10-j*.35)).addScaledVector(s.tangent,-j*1.2).addScaledVector(UP,.04);
        this.box('orange',reflected,new THREE.Vector3(.8+j*.23,.02,.22));
      }
    }
  }
  private buildStreetLife(){
    // Layer the foreground with a service street, shop fronts and working
    // rooftops. Every footprint stays outside the physical racing barrier.
    for(let i=0;i<124;i++){
      const progress=(i/124+.001)%1,s=this.course.sample(progress);
      const q=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(s.right,UP,s.tangent.clone().negate()));
      for(const side of [-1,1]){
        const p=s.position.clone().addScaledVector(s.right,side*24);
        this.box('concrete',p.clone().addScaledVector(UP,-.45),new THREE.Vector3(17,.9,24),q);
        if(overlapsCircuitSignature(this.course,p.clone().addScaledVector(s.right,side*5),5))continue;
        this.box('blue',p.clone().addScaledVector(s.right,side*5).addScaledVector(UP,1.1),new THREE.Vector3(4.4,2.2,6),q);
        this.box('silver',p.clone().addScaledVector(s.right,side*5).addScaledVector(UP,2.3),new THREE.Vector3(4.8,.25,6.3),q);
        for(const n of [-1,1])this.box('dark',p.clone().addScaledVector(s.right,side*5).addScaledVector(s.tangent,n*1.5).addScaledVector(UP,2.5),new THREE.Vector3(3.5,.3,.5),q);
        if(i%3===0){
          this.box('concrete',p.clone().addScaledVector(s.tangent,7).addScaledVector(UP,.6),new THREE.Vector3(3,1.2,3),q);
          this.box('leaf',p.clone().addScaledVector(s.tangent,7).addScaledVector(UP,1.4),new THREE.Vector3(2.7,.8,2.7),q);
        }
        if(i%4===0){
          this.box('orange',p.clone().addScaledVector(s.right,side*2).addScaledVector(UP,2.2),new THREE.Vector3(.5,4.4,.5),q);
          this.box('amber',p.clone().addScaledVector(s.right,side*2).addScaledVector(UP,4.5),new THREE.Vector3(.8,.35,.8),q);
        }
      }
    }
    for(let i=0;i<16;i++){
      const progress=.001+i*.0063,s=this.course.sample(progress),side=-1;
      const p=s.position.clone().addScaledVector(s.right,side*(36+(i%3)*4));
      const q=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(s.right,UP,s.tangent.clone().negate()));
      const h=4.5+(i%3)*2;
      this.box('facadeWarm',p.clone().addScaledVector(UP,h/2),new THREE.Vector3(18,h,13),q);
      this.box('blue',p.clone().addScaledVector(UP,h),new THREE.Vector3(20,.8,15),q);
      this.box('silver',p.clone().addScaledVector(UP,h+1),new THREE.Vector3(5,2,4),q);
      this.box('amber',p.clone().addScaledVector(s.right,9.1).addScaledVector(UP,2.7),new THREE.Vector3(.15,1.8,10),q);
      this.box('orange',p.clone().addScaledVector(s.right,10).addScaledVector(UP,4),new THREE.Vector3(3,.3,12),q);
      for(const dz of [-5,0,5])this.box('concrete',p.clone().addScaledVector(s.right,10).addScaledVector(s.tangent,dz).addScaledVector(UP,1.9),new THREE.Vector3(.3,3.8,.3),q);
    }
    for(let i=0;i<18;i++){
      const progress=(.018+i*.053)%1,s=this.course.sample(progress),side=i%2?1:-1;
      const p=s.position.clone().addScaledVector(s.right,side*24).addScaledVector(UP,.8);
      const q=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(s.right,UP,s.tangent.clone().negate()));
      this.box(i%3?'concrete':'orange',p.clone().addScaledVector(UP,.8),new THREE.Vector3(2.8,2.2,7),q);
      this.box('dark',p.clone().addScaledVector(UP,1.6),new THREE.Vector3(2.84,.75,5.5),q);
      this.box('blue',p.clone().addScaledVector(UP,2.1),new THREE.Vector3(2.5,.4,6),q);
      for(const x of [-1,1])this.box('amber',p.clone().addScaledVector(s.right,x).addScaledVector(s.tangent,3.55),new THREE.Vector3(.5,.35,.1),q);
    }
  }
  private buildRain(){
    const a:number[]=[];for(let i=0;i<360;i++){const x=Math.sin(i*57.1)*42,y=(i*.73)%24,z=Math.cos(i*39.7)*42;a.push(x,y,z,x+.15,y-1.4,z+.1);}
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(a,3));
    const material=new THREE.LineBasicMaterial({color:0xaec5e4,transparent:true,opacity:.12,depthWrite:false});
    const rain=new THREE.LineSegments(geometry,material);rain.frustumCulled=false;return rain;
  }
  private buildRelayDetails(){
    const canvas=document.createElement('canvas');canvas.width=128;canvas.height=256;const ctx=canvas.getContext('2d')!;
    ctx.fillStyle='#223854';ctx.fillRect(0,0,128,256);ctx.strokeStyle='#c8dbd9';ctx.lineWidth=3;
    ctx.beginPath();ctx.arc(64,75,25,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.ellipse(64,75,44,12,-.5,0,Math.PI*2);ctx.stroke();
    ctx.fillStyle='#c8dbd9';ctx.font='bold 22px sans-serif';ctx.textAlign='center';ctx.fillText('RELAY',64,147);ctx.font='bold 48px sans-serif';ctx.fillText('08',64,198);
    const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;
    const material=new THREE.MeshBasicMaterial({map,side:THREE.DoubleSide});
    for(const progress of [.014,.031,.048,.08,.523,.565]){
      const banner=new THREE.Mesh(new THREE.PlaneGeometry(2.8,5.6),material);this.place(banner,progress,23.6,1,0);banner.position.y+=6.7;this.bake(banner);
    }
    // Substantial low-rise mass under the dish and adjoining relay control room.
    const s=this.course.sample(.042),q=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(s.right,UP,s.tangent.clone().negate()));
    const base=s.position.clone().addScaledVector(s.right,-51);
    this.box('concrete',base.clone().addScaledVector(UP,-4),new THREE.Vector3(75,8,90),q);
    this.box('amber',base.clone().addScaledVector(s.right,34).addScaledVector(UP,.45),new THREE.Vector3(.25,.35,78),q);
    for(const offset of [-22,22]){
      const p=base.clone().addScaledVector(s.right,offset).addScaledVector(s.tangent,30);
      this.box('concrete',p.clone().addScaledVector(UP,5),new THREE.Vector3(15,10,22),q);
      this.box('blue',p.clone().addScaledVector(UP,10),new THREE.Vector3(17,1.5,24),q);
      this.box('amber',p.clone().addScaledVector(UP,7).addScaledVector(s.tangent,-11.05),new THREE.Vector3(13,1.1,.12),q);
    }
    const crossing=this.course.sample(.1);
    const a=crossing.position.clone().addScaledVector(crossing.right,-130).addScaledVector(UP,29);
    const b=crossing.position.clone().addScaledVector(crossing.right,120).addScaledVector(UP,29);
    this.beam('concrete',a,b,7,2);this.beam('mint',a.clone().addScaledVector(UP,1.3),b.clone().addScaledVector(UP,1.3),.1,.12);
    for(const side of [-1,1])this.box('blue',crossing.position.clone().addScaledVector(crossing.right,side*45).addScaledVector(UP,2),new THREE.Vector3(4,52,4));
    const points:number[]=[],phases:number[]=[];
    for(const progress of [.018,.058,.515,.565,.76]){
      const sample=this.course.sample(progress),position=sample.position.clone().addScaledVector(sample.right,progress===.515||progress===.76?-48:44).addScaledVector(UP,21);
      for(let i=0;i<14;i++){points.push(position.x,position.y,position.z);phases.push(i/14);}
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(points,3));geometry.setAttribute('phase',new THREE.Float32BufferAttribute(phases,1));
    const steam=new THREE.Points(geometry,new THREE.ShaderMaterial({uniforms:{time:this.clock},transparent:true,depthWrite:false,
      vertexShader:'uniform float time;attribute float phase;varying float fade;void main(){float age=fract(phase+time*.11);vec3 p=position+vec3(age*5.+sin(phase*20.)*.8,age*11.,sin(age*4.+phase*9.));vec4 view=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*view;gl_PointSize=clamp((14.+age*22.)*90./-view.z,1.,50.);fade=sin(age*3.14159)*.14;}',
      fragmentShader:'varying float fade;void main(){float r=length(gl_PointCoord-.5)*2.;gl_FragColor=vec4(.66,.72,.82,(1.-smoothstep(.15,1.,r))*fade);}',
    }));steam.frustumCulled=false;steam.name='afterglow_vent_steam';this.root.add(steam);
  }
  updateVisibility(camera:THREE.Camera){
    this.sky.position.copy(camera.position);const time=this.course.visualTime;this.clock.value=time;
    this.relayEffects.update();
    camera.getWorldDirection(this.cameraForward);this.rain.position.copy(camera.position).addScaledVector(this.cameraForward,23);this.rain.position.y-=time*12%22;
    if(Math.abs(time-this.lastTime)<1/30)return;this.lastTime=time;
    for(const [i,dish] of this.dishes.entries())dish.head.rotation.y=dish.rotation.y+Math.sin(time*.055+i)*.07;
    const progress=(time*.008+.053)%1;
    for(let i=0;i<this.train.children.length;i++){
      const p=THREE.MathUtils.euclideanModulo(progress-i*16/this.trainPath.getLength(),1);
      this.trainPath.getPointAt(p,this.trainPoint);this.trainPath.getTangentAt(p,this.trainTangent);
      const car=this.train.children[i];car.position.copy(this.trainPoint).addScaledVector(UP,.8);car.rotation.y=Math.atan2(-this.trainTangent.x,-this.trainTangent.z);
    }
    this.beacons.color.setHex(Math.sin(time*2)>-.35?0xff7055:0x61302e);
  }
}
