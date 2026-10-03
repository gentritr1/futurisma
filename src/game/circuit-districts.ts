import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import type {RaceCourse} from './course';
import {overlapsCircuitSignature} from './circuit-signature-sites';

type Landmark = 'works' | 'silos' | 'hall' | 'tower' | 'tug';
type Site = {progress:number; position:THREE.Vector3; radius:number; clearance:number; landmark:Landmark};
type Batch = {mesh:THREE.InstancedMesh; parts:THREE.Mesh[]; moving:boolean};
type Activity = {node:THREE.Group; origin:THREE.Vector3; phase:number; kind:'tug'|'rotor'};

/** Larger, authored places behind the roadside shops. All scenery is outside
 * the road envelope; activity stays inside its reserved district footprint. */
export class CircuitDistricts {
  readonly root=new THREE.Group();
  readonly sites:Site[]=[];
  private readonly source=new THREE.Group();
  private readonly geometries=new Set<THREE.BufferGeometry>();
  private readonly materials=new Set<THREE.Material>();
  private readonly textures=new Set<THREE.Texture>();
  private readonly batches:Batch[]=[];
  private readonly activities:Activity[]=[];
  private readonly route:{position:THREE.Vector3;width:number}[];
  private readonly box=new THREE.BoxGeometry(1,1,1);
  private readonly bulb=new THREE.SphereGeometry(.2,8,6);
  private readonly trim:THREE.MeshStandardMaterial;
  private readonly deck:THREE.MeshStandardMaterial;
  private readonly glow:THREE.MeshStandardMaterial;
  private readonly lightPlane=new THREE.PlaneGeometry(1,1);
  private readonly pool:THREE.MeshBasicMaterial;
  private readonly halo:THREE.MeshBasicMaterial;
  private readonly shadow:THREE.MeshBasicMaterial;
  private readonly signs:THREE.MeshBasicMaterial[]=[];
  private mintWorks:THREE.BufferGeometry|null=null;
  private readonly lights:THREE.PointLight[]=[];
  private readonly lightAnchors:{position:THREE.Vector3;progress:number}[]=[];
  private lastTime=-1;
  private disposed=false;

  private constructor(private readonly course:RaceCourse,private readonly asset:THREE.Group){
    this.root.name=`${course.kind}_districts`;
    this.route=Array.from({length:Math.ceil(course.length/4)},(_,i)=>{
      const s=course.sample(i/Math.ceil(course.length/4));return {position:s.position.clone(),width:s.halfWidth};
    });
    asset.traverse(node=>{
      if(!(node instanceof THREE.Mesh))return;
      this.geometries.add(node.geometry);
      const material=node.material as THREE.MeshStandardMaterial;
      if(this.materials.has(material))return;
      this.materials.add(material);
      if(material.map){this.textures.add(material.map);material.map.anisotropy=4;}
      if(material.emissiveMap)this.textures.add(material.emissiveMap);
      material.roughness=.76;
      if(material.name==='glow'||material.name==='lit'){
        material.emissiveIntensity=material.name==='lit'?.8:1.5;material.toneMapped=false;
        material.onBeforeCompile=shader=>{
          shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>',
            '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vColor.rgb;');
        };
        material.customProgramCacheKey=()=> 'district-colored-emission';
      }else{
        // Modest baked sky fill keeps recessed panels readable at the existing
        // low-poly game's exposure without introducing more scene lights.
        material.emissive.set(0xffffff);material.emissiveMap=material.map;
        material.emissiveIntensity=.035;
        material.onBeforeCompile=shader=>{
          shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>',
            '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vColor.rgb;');
        };
        material.customProgramCacheKey=()=> 'district-panel-fill';
      }
    });
    this.trim=new THREE.MeshStandardMaterial({color:0x334649,roughness:.8});
    this.deck=new THREE.MeshStandardMaterial({color:course.kind==='greenwater'?0x526a5c:0xa28a64,roughness:.95});
    this.glow=new THREE.MeshStandardMaterial({color:0xffcc7c,emissive:0xffae48,emissiveIntensity:1.8,toneMapped:false});
    [this.trim,this.deck,this.glow].forEach(m=>this.materials.add(m));this.geometries.add(this.box);this.geometries.add(this.bulb);
    const canvas=document.createElement('canvas');canvas.width=canvas.height=64;
    const context=canvas.getContext('2d')!;
    const gradient=context.createRadialGradient(32,32,0,32,32,32);
    gradient.addColorStop(0,'rgba(255,255,255,1)');gradient.addColorStop(.3,'rgba(255,255,255,.45)');gradient.addColorStop(1,'rgba(255,255,255,0)');
    context.fillStyle=gradient;context.fillRect(0,0,64,64);
    const glowTexture=new THREE.CanvasTexture(canvas);this.textures.add(glowTexture);
    this.pool=new THREE.MeshBasicMaterial({map:glowTexture,color:0xffbc69,transparent:true,opacity:.65,depthWrite:false,toneMapped:false,polygonOffset:true,polygonOffsetFactor:-2});
    this.halo=new THREE.MeshBasicMaterial({map:glowTexture,color:0xffbd70,blending:THREE.AdditiveBlending,transparent:true,opacity:.6,depthWrite:false,toneMapped:false,side:THREE.DoubleSide});
    this.shadow=new THREE.MeshBasicMaterial({map:glowTexture,color:0x191914,transparent:true,opacity:.55,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1});
    this.materials.add(this.shadow);this.materials.add(this.pool);this.materials.add(this.halo);this.geometries.add(this.lightPlane);
    const names=course.kind==='greenwater'?['REED FERRY','CANOPY STATION','TIDAL GARDENS']:['SALT EXCHANGE','SOLAR WORKS','ELEVATOR REACH'];
    for(const [index,name] of names.entries()){
      const sign=document.createElement('canvas');sign.width=512;sign.height=128;
      const ctx=sign.getContext('2d')!;ctx.fillStyle='#243835';ctx.fillRect(0,0,512,128);
      ctx.strokeStyle='#eac894';ctx.lineWidth=5;ctx.strokeRect(6,6,500,116);
      ctx.fillStyle='#ffe2aa';ctx.textAlign='center';ctx.font='bold 35px monospace';ctx.fillText(name,256,61);
      ctx.font='17px monospace';ctx.fillText(`DISTRICT 0${index+1} / CREW ACCESS`,256,97);
      const texture=new THREE.CanvasTexture(sign);texture.colorSpace=THREE.SRGBColorSpace;this.textures.add(texture);
      const material=new THREE.MeshBasicMaterial({map:texture,toneMapped:false});this.signs.push(material);this.materials.add(material);
    }
    this.build();this.source.updateMatrixWorld(true);
    for(let i=0;i<this.sites.length;i++){
      const site=this.sites[i];
      if(site.landmark==='works'||site.landmark==='hall'||site.landmark==='silos')this.lightAnchors.push({progress:site.progress,position:new THREE.Vector3(0,5,site.landmark==='silos'?-8:-5).applyMatrix4(this.source.children[i].matrixWorld)});
    }
    for(let i=0;i<4;i++){const light=new THREE.PointLight(0xff963c,0,32,2);this.lights.push(light);this.root.add(light);}
    this.batch();this.update(0,false);
    this.root.userData.sites=this.sites;this.root.userData.drawCalls=this.batches.length;
    this.root.userData.activities=this.activities.length;
  }

  static async load(course:RaceCourse):Promise<CircuitDistricts|null>{
    if(course.kind!=='greenwater'&&course.kind!=='bitterpan')return null;
    const gltf=await new GLTFLoader().loadAsync('/assets/circuit-districts/districts.glb');
    return new CircuitDistricts(course,gltf.scene);
  }

  private create(name:Landmark,variant=0):THREE.Group{
    const group=new THREE.Group();
    this.asset.traverse(node=>{
      if(!(node instanceof THREE.Mesh)||!node.name.startsWith(`${name}_`))return;
      const clone=node.clone();
      if(name==='works'&&variant%3===1&&(node.material as THREE.Material).name==='paint'){
        if(!this.mintWorks){
          const geometry:THREE.BufferGeometry=node.geometry.clone();const uv=geometry.getAttribute('uv');
          const colors=geometry.getAttribute('color');
          for(let i=0;i<uv.count;i++)if(uv.getX(i)<.25&&uv.getY(i)<.5){
            uv.setX(i,uv.getX(i)+.5);
            if(colors){const shade=Math.max(colors.getX(i),colors.getY(i),colors.getZ(i));colors.setXYZ(i,shade,shade,shade);}
          }
          this.geometries.add(geometry);this.mintWorks=geometry;
        }
        clone.geometry=this.mintWorks;
      }
      group.add(clone);
    });
    return group;
  }
  private block(parent:THREE.Object3D,material:THREE.Material,x:number,y:number,z:number,w:number,h:number,d:number){
    const mesh=new THREE.Mesh(this.box,material);mesh.position.set(x,y,z);mesh.scale.set(w,h,d);parent.add(mesh);return mesh;
  }
  private fixture(parent:THREE.Group,x:number,y:number,z:number,yaw=0){
    const fixture=new THREE.Group();fixture.position.set(x,y,z);fixture.rotation.y=yaw;parent.add(fixture);
    this.block(fixture,this.trim,0,.16,0,1.4,.18,.55);
    const bulb=new THREE.Mesh(this.bulb,this.glow);bulb.position.set(0,0,-.16);fixture.add(bulb);
    const halo=new THREE.Mesh(this.lightPlane,this.halo);halo.position.z=-.3;halo.scale.set(3.6,3.6,1);fixture.add(halo);
    const crossed=halo.clone();crossed.rotation.y=Math.PI/2;fixture.add(crossed);
    // A low-resolution projected pool reads like baked PS2 lighting and costs
    // no extra realtime light per building. Keep it on the actual facade.
    const wash=new THREE.Mesh(this.lightPlane,this.pool);wash.position.set(0,-1.4,.14);wash.rotation.y=Math.PI;
    wash.scale.set(4,5,1);fixture.add(wash);
  }
  private clearance(position:THREE.Vector3,radius:number){
    let distance=Infinity;
    for(const sample of this.route){
      if(Math.abs(sample.position.y-position.y)>35)continue;
      distance=Math.min(distance,Math.hypot(sample.position.x-position.x,sample.position.z-position.z)-sample.width-radius);
    }
    // Samples are 4m apart: reserve an extra 2m for the intervening road.
    return distance-2;
  }
  private place(progress:number,side:number,name:Landmark,scale:number,offset:number,index:number){
    progress=((progress%1)+1)%1;
    const sample=this.course.sample(progress);
    if(sample.up.y<.94)return;
    const radius=(name==='works'?24:name==='silos'?22.5:name==='hall'?15:7)*scale;
    const rearCenter=name==='works'?6*scale:0;
    const safeOffset=Math.max(offset,radius+10-rearCenter);
    const position=sample.position.clone().addScaledVector(sample.right,side*(sample.halfWidth+safeOffset));
    const footprintPosition=position.clone().addScaledVector(sample.right,name==='works'?side*6*scale:0);
    if(overlapsCircuitSignature(this.course,footprintPosition,radius))return;
    const clearance=this.clearance(footprintPosition,radius);
    if(clearance<8)return;
    if(this.sites.some(site=>site.position.distanceTo(footprintPosition)<site.radius+radius+3))return;
    const group=new THREE.Group();group.position.copy(position);
    group.rotation.y=Math.atan2(sample.tangent.x,sample.tangent.z)+(side>0?-Math.PI/2:Math.PI/2)+(name==='silos'?side*.35:0);
    group.scale.setScalar(scale);this.source.add(group);
    const building=this.create(name,this.course.kind==='bitterpan'&&side>0?1:index);
    if(name==='works'){building.scale.x=1.4;group.scale.y*=.88;}
    if(name==='silos')building.scale.x=1.35;
    group.add(building);
    const shadow=new THREE.Mesh(this.lightPlane,this.shadow);shadow.rotation.x=-Math.PI/2;
    shadow.position.y=.025;shadow.scale.set(name==='tower'?10:30,name==='tower'?10:24,1);group.add(shadow);
    const district=Math.min(2,Math.floor(progress*3));
    if(name==='works'||name==='hall'){
      const sign=new THREE.Mesh(this.lightPlane,this.signs[district]);
      sign.position.set(0,name==='works'?9:4.5,name==='works'?-6.7:-5.9);sign.scale.set(6,1.5,1);sign.rotation.y=Math.PI;group.add(sign);
      // Shared boxes form purposeful stacks beside entrances, not random scatter.
      for(let crate=0;crate<7;crate++){
        const x=8.5+(crate%2)*1.4,z=-7.6+Math.floor(crate/3)*1.5,y=.5+(crate%3===2?1:0);
        this.block(group,this.deck,x,y,z,1.2,1,1.2);
        for(const dx of [-.4,.4])this.block(group,this.trim,x+dx,y,z-.61,.08,.9,.035);
      }
    }
    this.sites.push({progress,position:footprintPosition,radius,clearance,landmark:name});
    const wetland=this.course.kind==='greenwater';
    if(name==='works'){
      for(const x of [-8,0,8])this.fixture(group,x,7.1,-6.7);
      for(const x of [-12,12])this.fixture(group,x,6.1,0,x>0?-Math.PI/2:Math.PI/2);
    }else if(name==='silos'){
      for(const x of [-7,0,7])this.fixture(group,x,7,-8.5);
      this.fixture(group,0,28,3.15);this.fixture(group,0,20,3.15);
    }else if(name==='hall'){
      for(const x of [-5.5,5.5])this.fixture(group,x,6.8,-1.4);
    }
    if(name==='works'||name==='silos'){
      this.block(group,this.deck,0,-.35,name==='works'?5:0,name==='works'?34:26,.7,name==='works'?28:20);
      // Boundary rails connect buildings into a legible working yard.
      for(const x of [-12.5,12.5]){
        this.block(group,this.trim,x,.75,0,.12,.12,19);
        for(let z=-9;z<=9;z+=3)this.block(group,this.trim,x,.6,z,.12,1.2,.12);
      }
    }
    if(name==='hall'){
      // A connected outer deck sits under the stilt hall instead of a floating island.
      this.block(group,this.deck,0,-1.5,0,22,.5,19);
      for(const x of [-10,10])for(const z of [-8,0,8])this.block(group,this.trim,x,-2.5,z,.3,2,.3);
    }
    if(name==='works'||name==='hall'){
      const tug=this.create('tug');tug.position.set(0,wetland?-1.1:.15,-8.5);
      tug.scale.setScalar(.68);tug.rotation.y=Math.PI/2;group.add(tug);
      this.activities.push({node:tug,origin:tug.position.clone(),phase:index*.71,kind:'tug'});
    }
    if(name==='tower'||name==='silos'){
      const rotor=new THREE.Group();rotor.position.set(0,name==='tower'?21:30,0);group.add(rotor);
      for(let blade=0;blade<4;blade++){
        const angle=blade*Math.PI/2;
        const part=this.block(rotor,this.deck,Math.sin(angle)*1.5,Math.cos(angle)*1.5,0,.55,3,.12);part.rotation.z=-angle;
      }
      this.activities.push({node:rotor,origin:rotor.position.clone(),phase:index,kind:'rotor'});
    }
    // Small amber lamps describe the front edge, not a solid neon outline.
    if(name==='works'||name==='hall')for(const x of [-7,7]){
      this.block(group,this.trim,x,2.5,-8,.12,5,.12);
      this.block(group,this.glow,x,5,-8,.55,.14,.4);
      const halo=new THREE.Mesh(this.lightPlane,this.halo);halo.position.set(x,4.9,-8.1);halo.scale.set(2.3,2.3,1);group.add(halo);
      const pool=new THREE.Mesh(this.lightPlane,this.pool);pool.rotation.x=-Math.PI/2;pool.position.set(x,.035,-8);pool.scale.set(10,10,1);group.add(pool);
    }
  }
  private build(){
    const wetland=this.course.kind==='greenwater';
    const count=Math.ceil(this.course.length/145);
    for(let i=0;i<count;i++){
      const progress=(.022+i/count)%1;
      const district=Math.floor(progress*3);
      for(const side of [-1,1]){
        // The low/high alternation creates landmarks on opposite sides without
        // making a symmetrical corridor. Open intervals reveal the horizon.
        const name:Landmark=wetland
          ? ((i+(side>0?1:0))%(district===1?2:5)===1?'tower':'hall')
          : (district===1 || (i+(side>0?1:0))%3===0?'works':'silos');
        const scale=wetland?.9+(i%3)*.12:(name==='works'?1.15:.9+(i%3)*.1);
        this.place(progress+(side>0?.009:0)+(name==='works'?36/this.course.length:0),side,name,scale,wetland?32:31,i*2+(side>0?1:0));
        if(!wetland&&side>0)this.place(progress+.025,side,'works',.55,22,i+200);
        // A low annex fills the interval between major silhouettes; its front
        // stays behind the established roadside shops and recovery verge.
        this.place(progress+.021,side,wetland?'hall':'works',wetland?.64:.67,27,i+100);
        if(!wetland&&i%3===0)this.place(progress+.012,side,'works',.66,57,i+150);
        // Secondary terrace: a quieter rear building at a different scale.
        if(i%2===0)this.place(progress+.019,side,wetland?'hall':'works',wetland?.75:.72,68+district*6,i+50);
      }
    }
  }
  private batch(){
    const movingRoots=new Set<THREE.Object3D>(this.activities.map(a=>a.node));
    const groups=new Map<string,{parts:THREE.Mesh[];moving:boolean}>();
    this.source.traverse(node=>{
      if(!(node instanceof THREE.Mesh))return;
      let parent:THREE.Object3D|null=node,moving=false;
      while(parent){if(movingRoots.has(parent)){moving=true;break;}parent=parent.parent;}
      const key=`${node.geometry.uuid}:${(node.material as THREE.Material).uuid}:${moving}`;
      const group=groups.get(key)??{parts:[],moving};group.parts.push(node);groups.set(key,group);
    });
    for(const {parts,moving} of groups.values()){
      const mesh=new THREE.InstancedMesh(parts[0].geometry,parts[0].material,parts.length);
      if(moving)mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      parts.forEach((part,i)=>mesh.setMatrixAt(i,part.matrixWorld));mesh.computeBoundingSphere();
      if(mesh.boundingSphere)mesh.boundingSphere.radius+=12;
      this.root.add(mesh);this.batches.push({mesh,parts,moving});
    }
  }
  update(elapsed:number,reducedMotion:boolean,progress=this.course.startProgress){
    const distance=(p:number)=>Math.abs(((p-progress+1.5)%1)-.5)*this.course.length;
    const nearby=[...this.lightAnchors].sort((a,b)=>distance(a.progress)-distance(b.progress));
    this.lights.forEach((light,index)=>{
      const anchor=nearby[index];
      if(!anchor){light.intensity=0;return;}
      light.position.copy(anchor.position);light.intensity=520*Math.max(0,Math.min(1,(260-distance(anchor.progress))/100));
    });
    const time=reducedMotion?0:elapsed;
    if(time===this.lastTime)return;this.lastTime=time;
    for(const activity of this.activities){
      if(activity.kind==='rotor')activity.node.rotation.z=time*.22+activity.phase;
      else{
        activity.node.position.x=activity.origin.x+Math.sin(time*.12+activity.phase)*6;
        activity.node.position.y=activity.origin.y+(this.course.kind==='greenwater'?Math.sin(time*.7+activity.phase)*.12:0);
      }
      activity.node.updateMatrixWorld(true);
    }
    for(const batch of this.batches)if(batch.moving){
      batch.parts.forEach((part,i)=>batch.mesh.setMatrixAt(i,part.matrixWorld));batch.mesh.instanceMatrix.needsUpdate=true;
    }
  }
  dispose(){
    if(this.disposed)return;this.disposed=true;
    this.root.removeFromParent();
    for(const batch of this.batches)batch.mesh.dispose();
    for(const geometry of this.geometries)geometry.dispose();
    for(const material of this.materials)material.dispose();
    for(const texture of this.textures)texture.dispose();
    this.source.clear();this.root.clear();this.asset.clear();
  }
}
