import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {Reflector} from 'three/addons/objects/Reflector.js';
import type {FrostlineCourse} from './frostline-course';
import {snowStrengthAt, SNOW_SECTIONS} from './frostline-snow';
import {FrostlineWinterEffects} from './frostline-winter-effects';
import {FrostlineHolidayLife,holidaySitePads} from './frostline-holiday-life';
import {FrostlineTerrain} from './frostline-terrain';
import type {RaceEnvironment,RaceEnvironmentStats} from './environment';

const UP=new THREE.Vector3(0,1,0);
const ROOT='/assets/frostline/';
type Batch={geometry:THREE.BufferGeometry;material:THREE.Material;matrices:THREE.Matrix4[]};
type Building={model:THREE.Group;progress:number;lateral:number;scale:number;yaw:number;outpost:number};

/** Original Blender village kits, repeated with instancing. The cold landscape
 * and close, warm architecture are separate layers, not a ring of empty boxes. */
export class FrostlineEnvironment implements RaceEnvironment {
  readonly root=new THREE.Group();
  readonly stats:RaceEnvironmentStats={meshes:0,triangles:0,materials:0,textures:0,visibleGroups:0,visibleTriangles:0,shaderModel:'lambert',signageSource:'baked',contractDrift:[]};
  private readonly materials=new Map<string,THREE.Material>();
  private readonly batches=new Map<string,Batch>();
  private readonly boxGeometry=new THREE.BoxGeometry(1,1,1);
  private readonly ballGeometry=new THREE.IcosahedronGeometry(1,1);
  private readonly coneGeometry=new THREE.ConeGeometry(1,1,10);
  private readonly time={value:0};
  private readonly celebration={value:0};
  private readonly winterEffects:FrostlineWinterEffects;
  readonly holidayLife:FrostlineHolidayLife;
  private readonly sky:THREE.Mesh;
  private readonly snow:THREE.Points;
  private readonly gondolas:THREE.Group[]=[];
  private readonly minuteHand:THREE.Group;
  private readonly hourHand:THREE.Group;
  private readonly smokeSources:THREE.Vector3[]=[];
  private readonly glows:number[]=[];
  private readonly cameraForward=new THREE.Vector3();
  private readonly terrain:FrostlineTerrain;
  private readonly footprint=new THREE.Box3();

  static async load(course:FrostlineCourse){
    const loader=new GLTFLoader(),textures=new THREE.TextureLoader();
    const [atlas,road,sky,...models]=await Promise.all([
      textures.loadAsync(ROOT+'materials.png'),textures.loadAsync(ROOT+'road.png'),textures.loadAsync(ROOT+'sky.png'),
      ...['chalet_a','chalet_b','clock_tower','snow_pine','market_stall','gondola'].map(name=>loader.loadAsync(ROOT+name+'.glb')),
    ]);
    for(const texture of [atlas,road,sky]){texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;}
    road.wrapS=road.wrapT=sky.wrapS=THREE.RepeatWrapping;
    return new FrostlineEnvironment(course,atlas,road,sky,models.map(model=>model.scene));
  }
  private constructor(private readonly course:FrostlineCourse,atlas:THREE.Texture,roadTexture:THREE.Texture,panorama:THREE.Texture,models:THREE.Group[]){
    this.root.name='frostline_original_village';
    const cells:Record<string,[number,number]>={wood:[0,.5],stone:[.5,.5],snow:[0,0],window:[.5,0],red:[0,.5],copper:[0,.5]};
    const colors:Record<string,number>={wood:0xe0c7ac,stone:0xa6b6d0,snow:0xd8e8ff,cream:0xcac0a3,red:0xd64e51,green:0x315a48,copper:0xcb9464,dark:0x142233,gold:0xefb646,bulb:0xffd996,window:0xffffff};
    for(const [name,color] of Object.entries(colors)){
      let map:THREE.Texture|undefined;
      if(cells[name]){map=atlas.clone();map.repeat.set(.488,.488);map.offset.set(cells[name][0]+.006,cells[name][1]+.006);map.needsUpdate=true;}
      const material=name==='bulb'?new THREE.MeshBasicMaterial({color,toneMapped:false}):new THREE.MeshLambertMaterial({color,map,side:name==='window'?THREE.DoubleSide:THREE.FrontSide});
      material.name='frostline_'+name;
      if(name==='window'){
        const window=material as THREE.MeshLambertMaterial;window.emissive.setHex(0xffb45e);window.emissiveMap=map!;window.emissiveIntensity=1.1;
        window.onBeforeCompile=shader=>{
          shader.uniforms.villageTime=this.time;
          shader.vertexShader='varying vec3 housePosition;\n'+shader.vertexShader;
          shader.vertexShader=shader.vertexShader.replace('#include <worldpos_vertex>',`#include <worldpos_vertex>\nvec4 house=vec4(transformed,1.);\n#ifdef USE_INSTANCING\nhouse=instanceMatrix*house;\n#endif\nhousePosition=(modelMatrix*house).xyz;`);
          shader.fragmentShader='uniform float villageTime;varying vec3 housePosition;\n'+shader.fragmentShader;
          shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>\nfloat room=floor(housePosition.x/4.)*1.73+floor(housePosition.z/5.)*.83+floor(housePosition.y/4.)*.6;float occupied=smoothstep(-.9,.65,sin(villageTime*.12+room));totalEmissiveRadiance*=.24+occupied*.76;`);
        };
      }
      if(name==='bulb')material.onBeforeCompile=shader=>{
        shader.uniforms.villageTime=this.time;shader.fragmentShader='uniform float villageTime;\n'+shader.fragmentShader;
        shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>','outgoingLight*=.88+.12*sin(villageTime*.8+gl_FragCoord.x*.025);\n#include <opaque_fragment>');
      };
      if(name==='snow'){
        const snow=material as THREE.MeshLambertMaterial;snow.emissive.setHex(0x131b29);
        snow.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','#include <map_fragment>\ndiffuseColor.rgb=mix(diffuseColor.rgb,vec3(.77,.84,.95),.72);');};
      }
      if(name==='stone'){
        const stone=material as THREE.MeshLambertMaterial;stone.color.setHex(0xe6ddca);stone.emissive.setHex(0x171923);
        stone.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','#include <map_fragment>\ndiffuseColor.rgb=mix(diffuseColor.rgb,vec3(.34,.37,.43),.5);');};
      }
      this.materials.set(name,material);
    }
    this.materials.set('ornament',new THREE.MeshPhongMaterial({color:0xeb1838,emissive:0x30040a,shininess:100}));
    this.materials.set('ribbon',new THREE.MeshLambertMaterial({color:0xc82940,emissive:0x220306}));
    const road=new THREE.MeshPhongMaterial({map:roadTexture,bumpMap:roadTexture,bumpScale:.12,color:0x8ba3cc,shininess:55,specular:0x182435});
    road.name='frostline_road_surface';road.onBeforeCompile=shader=>{
      shader.uniforms.snowAtlas={value:atlas};
      shader.vertexShader='attribute float snowDepth;varying float roadSnow;varying vec2 wetUv;varying vec3 wetWorld;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <worldpos_vertex>','#include <worldpos_vertex>\nroadSnow=snowDepth;wetUv=uv;wetWorld=(modelMatrix*vec4(transformed,1.)).xyz;');
      shader.fragmentShader='uniform sampler2D snowAtlas;varying float roadSnow;varying vec2 wetUv;varying vec3 wetWorld;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','#include <map_fragment>\ndiffuseColor.rgb=mix(diffuseColor.rgb,vec3(.021,.028,.049),.72);');
      shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`float edge=abs(wetUv.x-1.);
float slush=smoothstep(.86,1.,edge+sin(wetWorld.z*2.3)*.025)*(.7+.3*sin(wetWorld.x*19.+wetWorld.z*7.));
outgoingLight=mix(outgoingLight,vec3(.3,.37,.5),slush*.65);
        float ripples=.6+.22*sin(wetWorld.z*4.7+sin(wetWorld.x*6.1)*3.)+.16*sin(wetWorld.x*17.3+wetWorld.z*11.1);
        float pools=exp(-pow((edge-.84)*13.,2.))*exp(-pow(sin(wetUv.y*1.55)*3.1,2.));
        float fresnel=pow(1.-abs(normalize(wetWorld-cameraPosition).y),2.);
        outgoingLight+=vec3(.78,.36,.075)*pools*ripples*fresnel;
        outgoingLight+=vec3(.015,.035,.09)*fresnel*(.65+.35*sin(wetWorld.x*.7+wetWorld.z*.3));
        float lane=(wetUv.x-1.)*13.;
        float tracks=exp(-pow((abs(lane)-5.5)/1.15,2.));
        float coverage=roadSnow*(1.-tracks*.72);
        float grain=.82+.24*texture2D(snowAtlas,vec2(fract(wetUv.x*4.),fract(wetUv.y*1.8))*.48+vec2(.007)).r;
        float driftEdge=sin(wetWorld.z*.37+wetWorld.x*.2)*.045;
        float packed=smoothstep(.07,.75,coverage+driftEdge);
        vec3 snowColor=vec3(.48,.59,.72)*grain+vec3(.24,.13,.055)*pools;
        outgoingLight=mix(outgoingLight,snowColor,packed*.95);
        #include <opaque_fragment>`);
    };this.materials.set('road',road);
    // Snow ground: the snow look, its atlas grain tiled every 24 m by world position.
    const ground=new THREE.MeshLambertMaterial({color:colors.snow,map:(this.materials.get('snow') as THREE.MeshLambertMaterial).map,emissive:0x131b29});ground.name='frostline_ground';
    ground.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`vec2 groundUv=(vMapUv-vec2(.006))/.488;
      vec4 sampledDiffuseColor=textureGrad(map,fract(groundUv)*.488+vec2(.006),dFdx(vMapUv),dFdy(vMapUv));diffuseColor*=sampledDiffuseColor;
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.77,.84,.95),.72);`);};
    // Buildings are sited first so the ground under each one is levelled before anything is placed.
    const buildings=this.buildingSites(models);
    this.terrain=new FrostlineTerrain(course,ground,[...buildings.map(site=>this.footprintOf(site)),...holidaySitePads(course)]);this.root.add(this.terrain.mesh);
    for(const model of models)model.traverse(object=>{if(object instanceof THREE.Mesh){const original=object.material as THREE.Material;object.material=this.materials.get(original.name)??this.materials.get('wood')!;object.castShadow=true;object.receiveShadow=true;}});
    this.buildRoad();this.buildLandscape(models[3]);this.buildVillage(buildings);this.buildWinterOutposts(buildings);
    // Landmark composition is authored, not randomized: tree left, tower right.
    const tree=this.ground(.014,-27,0,8.5);this.buildChristmasTree(tree,1);
    const clock=this.raise(buildings.find(site=>site.model===models[2])!);
    [this.minuteHand,this.hourHand]=this.buildClock(clock);
    this.buildArch(.018,'FROSTLINE / MIDNIGHT RUN');
    for(const [i,p] of [.145,.31,.46,.62,.79,.92].entries())this.buildArch(p,`${String(i+1).padStart(2,'0')} / ${course.sectorLabelAt(p)}`);
    for(const p of [.043,.063,.084,.104,.119,.877,.902,.932,.961])this.buildGarland(p);
    this.buildFestiveDetails();this.buildMarket(models[4]);
    const groundUnder=(x:number,z:number,radius:number)=>this.terrain.heightUnder(x,z,radius);
    this.holidayLife=new FrostlineHolidayLife(course,groundUnder);this.root.add(this.holidayLife.root);
    this.winterEffects=new FrostlineWinterEffects(course,groundUnder);this.root.add(this.winterEffects.root);
    this.buildGondolas(models[5]);this.buildPuddles();
    this.sky=new THREE.Mesh(new THREE.SphereGeometry(560,48,24),new THREE.ShaderMaterial({uniforms:{panorama:{value:panorama}},side:THREE.BackSide,depthWrite:false,depthTest:false,
      vertexShader:'varying vec3 direction;void main(){direction=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader:'uniform sampler2D panorama;varying vec3 direction;void main(){vec3 d=normalize(direction);float u=fract(atan(d.z,d.x)/6.283185+.18);float v=clamp(.27+d.y*.77,.02,.99);vec3 c=texture2D(panorama,vec2(u,v)).rgb*vec3(.19,.23,.43);gl_FragColor=vec4(c,1.);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}'
    }));this.sky.frustumCulled=false;this.sky.renderOrder=-990;this.root.add(this.sky);
    this.snow=this.buildSnow();this.root.add(this.snow);this.buildSmoke();this.buildFireworks();this.buildGlows();this.flush();
    this.root.traverse(o=>{if(o instanceof THREE.Mesh){this.stats.meshes++;this.stats.triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3*(o instanceof THREE.InstancedMesh?o.count:1);}});
    this.stats.materials=this.materials.size;this.stats.textures=7;this.stats.visibleGroups=this.stats.meshes;this.stats.visibleTriangles=this.stats.triangles;
  }
  private at(progress:number,lateral=0,height=0){const sample=this.course.sample(progress);return sample.position.clone().addScaledVector(sample.right,lateral).addScaledVector(UP,height);}
  private orientation(progress:number){const s=this.course.sample(progress);return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(s.right,UP,s.tangent.clone().negate()));}
  /** Road-relative (x, z), standing on the snow ground under a round footprint. */
  private ground(progress:number,lateral:number,height=0,radius=0){const p=this.at(progress,lateral);p.y=this.terrain.heightUnder(p.x,p.z,radius)+height;return p;}
  private groundAt(p:THREE.Vector3,height=0,radius=0){return p.clone().setY(this.terrain.heightUnder(p.x,p.z,radius)+height);}
  /** A vertical post from 0.1 m under the ground at (x, z) up to world height `top`. */
  private post(name:string,x:number,z:number,top:number,width:number){const bottom=this.terrain.heightAt(x,z)-.1;this.box(name,new THREE.Vector3(x,(top+bottom)/2,z),new THREE.Vector3(width,top-bottom,width));}
  /** Models rest their lowest point on the lowest ground under their footprint;
   * a flat object (sign, flag) keeps its own origin on the ground instead. Trees
   * pass a smaller `footprint` (fraction of their spread): they stand on the trunk. */
  private place(object:THREE.Object3D,progress:number,lateral:number,scale:number,yaw:number,footprint:boolean|number=true){
    object.position.copy(this.ground(progress,lateral));object.quaternion.copy(this.orientation(progress));object.rotateY(yaw);object.scale.setScalar(scale);object.updateMatrixWorld(true);
    if(!footprint)return;
    // The footprint is the model's own (rotated) base rectangle, not its world box.
    const matrix=object.matrixWorld.clone(),position=object.position.clone(),quaternion=object.quaternion.clone();
    object.position.set(0,0,0);object.quaternion.identity();object.scale.setScalar(1);object.updateMatrixWorld(true);
    const local=this.footprint.setFromObject(object).clone();object.position.copy(position);object.quaternion.copy(quaternion);object.scale.setScalar(scale);object.updateMatrixWorld(true);
    const corner=new THREE.Vector3();let low=Infinity;
    const f=footprint===true?1:footprint,cx=(local.min.x+local.max.x)/2,cz=(local.min.z+local.max.z)/2,hx=(local.max.x-local.min.x)/2*f,hz=(local.max.z-local.min.z)/2*f;
    for(const x of [cx-hx,cx,cx+hx])for(const z of [cz-hz,cz,cz+hz]){corner.set(x,local.min.y,z).applyMatrix4(matrix);low=Math.min(low,this.terrain.heightAt(corner.x,corner.z));}
    object.position.y+=low-.05-this.footprint.setFromObject(object).min.y;object.updateMatrixWorld(true);
  }
  private instance(geometry:THREE.BufferGeometry,material:THREE.Material,matrix:THREE.Matrix4){
    const key=geometry.uuid+material.uuid;let batch=this.batches.get(key);if(!batch){batch={geometry,material,matrices:[]};this.batches.set(key,batch);}batch.matrices.push(matrix);
  }
  private shape(geometry:THREE.BufferGeometry,name:string,position:THREE.Vector3,size:THREE.Vector3,q=new THREE.Quaternion()){
    this.instance(geometry,this.materials.get(name)!,new THREE.Matrix4().compose(position,q,size));
  }
  private box(name:string,p:THREE.Vector3,size:THREE.Vector3,q=new THREE.Quaternion()){this.shape(this.boxGeometry,name,p,size,q);}
  private ball(name:string,p:THREE.Vector3,r:number){this.shape(this.ballGeometry,name,p,new THREE.Vector3(r,r,r));}
  private beam(name:string,a:THREE.Vector3,b:THREE.Vector3,w:number,h:number){
    const f=b.clone().sub(a),r=new THREE.Vector3().crossVectors(UP,f).normalize(),up=new THREE.Vector3().crossVectors(f,r).normalize();
    this.box(name,a.clone().add(b).multiplyScalar(.5),new THREE.Vector3(w,h,f.length()+.05),new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(r,up,f.normalize())));
  }
  private addModel(model:THREE.Object3D){model.updateMatrixWorld(true);model.traverse(o=>{if(o instanceof THREE.Mesh)this.instance(o.geometry,o.material as THREE.Material,o.matrixWorld.clone());});}
  private flush(){
    for(const batch of this.batches.values()){
      const mesh=new THREE.InstancedMesh(batch.geometry,batch.material,batch.matrices.length);batch.matrices.forEach((m,i)=>mesh.setMatrixAt(i,m));mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();mesh.castShadow=batch.material.type!=='MeshBasicMaterial';mesh.receiveShadow=true;this.root.add(mesh);
    }this.batches.clear();
  }
  private buildRoad(){
    const positions:number[]=[],uv:number[]=[],indices:number[]=[],snowDepth:number[]=[];
    for(let i=0;i<960;i++){
      const a=this.course.sample(i/960),b=this.course.sample((i+1)/960),base=positions.length/3;
      for(const [sample,v] of [[a,0],[b,1]] as const)for(const side of [-1,1]){const p=sample.position.clone().addScaledVector(sample.right,13*side);positions.push(p.x,p.y,p.z);uv.push((side+1),(i+v)*this.course.length/960/18);snowDepth.push(snowStrengthAt((i+v)/960));}
      indices.push(base,base+1,base+3,base,base+3,base+2);
      for(const side of [-1,1]){
        const x=a.position.clone().addScaledVector(a.right,side*13.65),y=b.position.clone().addScaledVector(b.right,side*13.65);
        // The rail runs 1.6 m into the snow so the road's edge never shows a gap.
        this.beam('red',x,y,.8,3.2);
        this.beam('snow',x.clone().addScaledVector(UP,1.7),y.clone().addScaledVector(UP,1.7),1.25,.35);
        if(i%5===0){this.beam('bulb',x.clone().addScaledVector(a.right,-side*.43).addScaledVector(UP,.85),y.clone().addScaledVector(b.right,-side*.43).addScaledVector(UP,.85),.08,.22);}
        if(i%2===0){
          const p=this.groundAt(x.clone().addScaledVector(a.right,side*.4),.5+Math.sin(i*1.73)*.14);
          this.shape(this.ballGeometry,'snow',p,new THREE.Vector3(1.4+Math.sin(i)*.32,.47,4.6));
        }
      }
      if(i%6<2)for(const side of [-1,1])this.beam('snow',a.position.clone().addScaledVector(a.right,side*4.2).addScaledVector(UP,.03),b.position.clone().addScaledVector(b.right,side*4.2).addScaledVector(UP,.03),.13,.02);
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.setAttribute('snowDepth',new THREE.Float32BufferAttribute(snowDepth,1));geometry.setIndex(indices);geometry.computeVertexNormals();const mesh=new THREE.Mesh(geometry,this.materials.get('road'));mesh.receiveShadow=true;this.root.add(mesh);
    // Blue ice in Silver Lake has a clearly marked safer outside line.
    for(let i=0;i<38;i++){
      const p=.64+i*.14/38;

      if(i%7===0)this.sign('ICE / OUTSIDE LINE',p,16,4,7,1.5);
    }
  }
  private buildLandscape(pine:THREE.Group){
    for(let i=0;i<56;i++){
      const p=.024+(i%28)*.005,side=i<28?-1:1,position=this.at(p,side*(65+(i%4)*7));
      let clearance=Infinity;for(let j=0;j<this.course.points.length;j+=8)clearance=Math.min(clearance,Math.hypot(position.x-this.course.points[j].x,position.z-this.course.points[j].z));if(clearance<30)continue;
      // The mound settles 1 m into the lowest ground under it; the pine stands 2 m into the mound's crown.
      const mound=this.groundAt(position,-1,15),crown=mound.y+11+(i%4)*2;
      const model=pine.clone(true);this.place(model,p,side*(65+(i%4)*7),1.25+(i%5)*.17,i*.37);model.position.y+=crown-2-this.footprint.setFromObject(model).min.y;this.addModel(model);
      this.shape(this.ballGeometry,'snow',mound,new THREE.Vector3(15,11+(i%4)*2,15));
    }
    for(let i=0;i<95;i++){
      const p=(i/95+.002)%1,side=i%2?1:-1,model=pine.clone(true);
      this.place(model,p,side*(31+(i%4)*11),.8+(i%5)*.2,i*.61,.2);this.addModel(model);
    }
    // Forest layers use faceted distant trees instead of repeated high-detail kits.
    for(let i=0;i<460;i++){
      const p=(i*.61803398875)%1,side=i%2?1:-1,s=this.course.sample(p);
      const distance=70+(i%11)*13,base=s.position.clone().addScaledVector(s.right,side*distance);base.y=this.terrain.heightUnder(base.x,base.z,(12+(i%6)*3)*.25)-.1;
      let near=Infinity;for(let j=0;j<this.course.points.length;j+=8)near=Math.min(near,(base.x-this.course.points[j].x)**2+(base.z-this.course.points[j].z)**2);if(near<32*32)continue;
      const h=12+(i%6)*3;
      this.shape(this.coneGeometry,'green',base.clone().addScaledVector(UP,h*.5),new THREE.Vector3(h*.25,h,h*.25));
      this.shape(this.coneGeometry,'snow',base.clone().addScaledVector(UP,h*.65),new THREE.Vector3(h*.22,h*.75,h*.22));
    }
    for(let i=0;i<28;i++){
      const p=i/28,s=this.course.sample(p),position=s.position.clone().addScaledVector(s.right,(i%2?1:-1)*(460+i%4*120));
      let clearance=Infinity;for(let j=0;j<this.course.points.length;j+=8)clearance=Math.min(clearance,Math.hypot(position.x-this.course.points[j].x,position.z-this.course.points[j].z));if(clearance<190)continue;
      this.shape(this.ballGeometry,'snow',position.addScaledVector(UP,-30),new THREE.Vector3(120,75+i%4*22,130));
    }
  }
  /** Chalets, outpost houses and the clock tower, in build order. */
  private buildingSites(models:THREE.Group[]):Building[]{
    const [a,b]=models,sites:Building[]=[];
    const village:[number,number,number,number][]=[[.003,-28,1.2,Math.PI/2]];
    for(let i=0;i<13;i++)for(const side of [-1,1]){
      const p=.0005+i*.009;
      // Preserve the Christmas tree and clock tower silhouettes.
      if(side<0&&p>.007&&p<.022||side>0&&p>.013&&p<.039)continue;
      village.push([p,side*(24+(i%3)*2),.9+(i%3)*.1,side<0?Math.PI/2:-Math.PI/2]);
    }
    for(let i=0;i<12;i++)village.push([.84+i*.012,i%2?27:-27,1+(i%3)*.1,i%2?-Math.PI/2:Math.PI/2]);
    for(let i=0;i<20;i++)village.push([.005+i*.011,i%2?51:-53,.95+(i%3)*.16,i%2?-Math.PI/2:Math.PI/2]);
    for(let i=0;i<9;i++)village.push([.033+i*.011,i%2?76:-76,.95,i%2?-Math.PI/2:Math.PI/2]);
    for(const [i,[progress,lateral,scale,yaw]] of village.entries())sites.push({model:i%5?a:b,progress,lateral,scale,yaw,outpost:-1});
    // Small lit hamlets give the forest stretches a destination every few bends.
    for(const [index,p] of [.18,.22,.28,.335,.405,.435,.55,.585,.635,.69,.745,.8].entries()){
      for(const side of [-1,1]){
        const lateral=side*(30+index%3*4),position=this.at(p,lateral);
        let clearance=Infinity;
        for(let j=0;j<this.course.points.length;j+=8)clearance=Math.min(clearance,Math.hypot(position.x-this.course.points[j].x,position.z-this.course.points[j].z));
        if(clearance<26)continue;
        sites.push({model:index%4?a:b,progress:p,lateral,scale:.8+(index%3)*.08,yaw:side<0?Math.PI/2:-Math.PI/2,outpost:index});
      }
    }
    sites.push({model:models[2],progress:.024,lateral:27,scale:1,yaw:0,outpost:-1});
    return sites;
  }
  /** The building's base rectangle in world space, for the terrain to level. */
  private footprintOf(site:Building){
    const box=this.footprint.setFromObject(site.model),q=this.orientation(site.progress).multiply(new THREE.Quaternion().setFromAxisAngle(UP,site.yaw));
    const centre=new THREE.Vector3((box.min.x+box.max.x)/2,0,(box.min.z+box.max.z)/2).multiplyScalar(site.scale).applyQuaternion(q).add(this.at(site.progress,site.lateral));
    const axis=new THREE.Vector3(1,0,0).applyQuaternion(q);
    return {x:centre.x,z:centre.z,ax:axis.x,az:axis.z,hx:(box.max.x-box.min.x)/2*site.scale,hz:(box.max.z-box.min.z)/2*site.scale};
  }
  private raise(site:Building){
    const house=site.model.clone(true);this.place(house,site.progress,site.lateral,site.scale,site.yaw);this.addModel(house);return house;
  }
  private buildVillage(buildings:Building[]){
    for(const site of buildings.filter(site=>site.outpost<0&&site!==buildings[buildings.length-1])){
      const house=this.raise(site);
      this.smokeSources.push(new THREE.Vector3(4,19.5,-3).applyMatrix4(house.matrixWorld));
    }
    for(let i=0;i<90;i++){
      const p=i/90,side=i%2?1:-1,base=this.ground(p,side*16.7,-.05);
      this.box('dark',base.clone().addScaledVector(UP,3.3),new THREE.Vector3(.22,6.6,.22));
      this.box('gold',base.clone().addScaledVector(UP,6.4),new THREE.Vector3(1.1,.2,1.1));
      this.box('bulb',base.clone().addScaledVector(UP,6.95),new THREE.Vector3(.65,1,.65));
      this.shape(this.coneGeometry,'dark',base.clone().addScaledVector(UP,7.7),new THREE.Vector3(.95,.7,.95));
      this.glows.push(base.x,base.y+6.9,base.z);
    }
  }
  private buildWinterOutposts(buildings:Building[]){
    for(const site of buildings.filter(site=>site.outpost>=0)){
      const p=site.progress,side=Math.sign(site.lateral);
      const house=this.raise(site);
      this.smokeSources.push(new THREE.Vector3(4,19.5,-3).applyMatrix4(house.matrixWorld));
      const base=this.ground(p,side*18.5,0,2.6),q=this.orientation(p),tangent=this.course.sample(p).tangent;
      this.box('wood',base.clone().addScaledVector(UP,.65),new THREE.Vector3(1.6,.25,5),q);
      this.box('snow',base.clone().addScaledVector(UP,.84),new THREE.Vector3(1.7,.15,5.1),q);
      for(const end of [-1,1])this.box('dark',this.groundAt(base.clone().addScaledVector(tangent,end*1.8),.25,.7),new THREE.Vector3(1.4,.6,.25),q);
      for(let j=0;j<3;j++)this.box(j%2?'ribbon':'green',this.groundAt(base.clone().addScaledVector(tangent,4+j*1.1),.55,.45),new THREE.Vector3(.9,1.2,.9),q);
    }
    // Decorated trees, fences and hanging lamps repeat with the existing batches.
    for(let i=0;i<76;i++){
      const p=(i/76+.006)%1,side=i%2?1:-1,base=this.ground(p,side*19.5,-.05,2.6);
      for(let tier=0;tier<3;tier++){
        const y=2+tier*2.2,r=2.6-tier*.65;
        this.shape(this.coneGeometry,'green',base.clone().addScaledVector(UP,y),new THREE.Vector3(r,4,r));
        this.shape(this.coneGeometry,'snow',base.clone().addScaledVector(UP,y+.65),new THREE.Vector3(r*.85,3,r*.85));
        for(let j=0;j<9;j++){const angle=j/9*Math.PI*2,bulb=base.clone().add(new THREE.Vector3(Math.cos(angle)*r*.85,y-1,Math.sin(angle)*r*.85));this.ball('bulb',bulb,.1);this.glows.push(bulb.x,bulb.y,bulb.z);}
      }
      const start=this.ground(p,side*17.3,1.2),end=this.ground(p+.005,side*17.3,1.2);
      this.beam('wood',start,end,.15,.22);this.beam('snow',start.clone().addScaledVector(UP,.2),end.clone().addScaledVector(UP,.2),.22,.16);
      // Fence posts carry the rail at both ends and the middle.
      for(const t of [0,.5,1]){const x=THREE.MathUtils.lerp(start.x,end.x,t),z=THREE.MathUtils.lerp(start.z,end.z,t);this.post('wood',x,z,THREE.MathUtils.lerp(start.y,end.y,t)+.3,.2);}
    }
    for(const p of [.19,.23,.4,.44,.6,.81])this.buildGarland(p);
    for(const section of SNOW_SECTIONS)this.sign('SNOW / FOLLOW THE TRACKS',section.from-.006,17,5,9,1.8);
  }

  private buildFestiveDetails(){
    const canvas=document.createElement('canvas');canvas.width=128;canvas.height=256;const ctx=canvas.getContext('2d')!;
    ctx.fillStyle='#882d39';ctx.fillRect(0,0,128,256);ctx.strokeStyle='#f5d99e';ctx.lineWidth=5;ctx.strokeRect(6,6,116,244);
    ctx.strokeStyle='#fff1d7';ctx.lineWidth=4;
    for(let i=0;i<6;i++){const a=i*Math.PI/3;ctx.beginPath();ctx.moveTo(64,102);ctx.lineTo(64+Math.cos(a)*40,102+Math.sin(a)*40);ctx.stroke();for(const side of [-1,1]){const x=64+Math.cos(a)*25,y=102+Math.sin(a)*25;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-Math.cos(a+side*.65)*14,y-Math.sin(a+side*.65)*14);ctx.stroke();}}
    const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;const material=new THREE.MeshBasicMaterial({map,side:THREE.DoubleSide});
    material.onBeforeCompile=shader=>{shader.uniforms.villageTime=this.time;shader.vertexShader='uniform float villageTime;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nfloat loose=1.-uv.y;transformed.z+=sin(villageTime*1.1+position.x*2.+modelMatrix[3].x*.07)*loose*loose*.22;');};
    for(const p of [.006,.019,.04,.065,.092,.88,.92,.96])for(const side of [-1,1]){const flag=new THREE.Mesh(new THREE.PlaneGeometry(2.1,4.2,6,10),material);this.place(flag,p,side*16.7,1,0,false);flag.position.y+=6.4;this.root.add(flag);
      // Each banner hangs from a crossbar on its own pole.
      const pole=this.at(p,side*17.82),top=flag.position.y+2.25;this.post('dark',pole.x,pole.z,top+.1,.16);
      this.box('dark',this.at(p,side*16.76).setY(top),new THREE.Vector3(2.3,.1,.1),this.orientation(p));}
    for(const p of [.012,.035,.055,.11,.16,.31,.46,.62,.79,.93]){
      const c=document.createElement('canvas');c.width=256;c.height=128;const x=c.getContext('2d')!;x.fillStyle='#101d27';x.fillRect(0,0,256,128);x.fillStyle='#ffe7a1';
      for(let i=0;i<2;i++){x.beginPath();x.moveTo(24+i*120,64);x.lineTo(85+i*120,7);x.lineTo(117+i*120,7);x.lineTo(59+i*120,64);x.lineTo(117+i*120,121);x.lineTo(85+i*120,121);x.closePath();x.fill();}
      const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;const panel=new THREE.Mesh(new THREE.PlaneGeometry(5,2.5),new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide}));this.place(panel,p,-14.7,1,0,false);panel.position.y+=2.7;this.root.add(panel);
      for(const lateral of [-14.35,-16.85]){const foot=this.at(p,lateral);this.post('dark',foot.x,foot.z,panel.position.y,.14);}
    }
    for(const p of [.018,.045,.073,.1,.9,.94])for(const side of [-1,1]){
      const base=this.at(p,side*16,13.8),q=this.orientation(p);this.post('wood',base.x,base.z,base.y,.3);
      for(const sign of [-1,1]){const wing=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),sign*.55).premultiply(q);this.box('ribbon',base.clone().addScaledVector(this.course.sample(p).right,sign*.5),new THREE.Vector3(1.2,.9,.45),wing);}
      this.ball('ribbon',base,.3);
    }
  }
  private buildMarket(stall:THREE.Group){
    for(let i=0;i<12;i++){
      const model=stall.clone(true);this.place(model,.006+i*.0045,i<7?-20:21,.9,i<7?Math.PI/2:-Math.PI/2);this.addModel(model);
    }
    for(let i=0;i<26;i++){
      const p=.004+i*.0048,position=this.ground(p,i%2?-18:18,-.03,.8),q=this.orientation(p);
      this.box(i%2?'green':'red',position.clone().addScaledVector(UP,.5),new THREE.Vector3(1.2,1,1.1),q);
      this.box('gold',position.clone().addScaledVector(UP,1.03),new THREE.Vector3(.18,.1,1.2),q);
    }
    for(const p of [.01,.034,.087,.893]){
      const position=this.ground(p,-19,-.05,.85);
      this.ball('snow',position.clone().addScaledVector(UP,.85),.85);this.ball('snow',position.clone().addScaledVector(UP,1.85),.6);this.ball('snow',position.clone().addScaledVector(UP,2.6),.43);
      this.box('red',position.clone().addScaledVector(UP,2.27),new THREE.Vector3(.85,.17,.85));
      this.box('dark',position.clone().addScaledVector(UP,3),new THREE.Vector3(.65,.5,.65));
      for(const x of [-.16,.16])this.ball('dark',position.clone().add(new THREE.Vector3(x,2.68,.38)),.06);
    }
  }
  private buildChristmasTree(base:THREE.Vector3,scale:number){
    const snowCap=new THREE.ConeGeometry(1,1,24,3);const vertices=snowCap.attributes.position;
    for(let i=0;i<vertices.count;i++){
      const angle=Math.atan2(vertices.getZ(i),vertices.getX(i)),y=vertices.getY(i);
      if(y<.4)vertices.setY(i,y-Math.pow(.5-y,2)*(.035+.065*Math.sin(angle*9.+.7)));
    }snowCap.computeVertexNormals();
    this.box('wood',base.clone().addScaledVector(UP,2),new THREE.Vector3(1,4,1));
    for(let tier=0;tier<7;tier++){
      const y=5+tier*3.2,r=(8.5-tier)*scale,h=7*scale;
      this.shape(this.coneGeometry,'green',base.clone().addScaledVector(UP,y),new THREE.Vector3(r,h,r));
      this.shape(snowCap,'snow',base.clone().addScaledVector(UP,y+1.1),new THREE.Vector3(r*.87,h*.75,r*.87));
      for(let j=0;j<96;j++){
        const angle=j/96*Math.PI*2,position=base.clone().add(new THREE.Vector3(Math.cos(angle)*r*.88,y-2.2+Math.sin(angle*3)*.48,Math.sin(angle)*r*.88));
        this.ball('bulb',position,.11);this.glows.push(position.x,position.y,position.z);
        if(j%12===0)this.ball(j%24?'ornament':'gold',position.clone().addScaledVector(UP,-.5),.55);
      }
    }
    this.star(base.clone().addScaledVector(UP,28),1.7);
    this.glows.push(base.x,base.y+28,base.z);
    const light=new THREE.PointLight(0xffc274,110,42,2);light.position.copy(base).addScaledVector(UP,10);this.root.add(light);
  }
  private star(position:THREE.Vector3,radius:number){
    const shape=new THREE.Shape();for(let i=0;i<10;i++){const a=i/10*Math.PI*2+Math.PI/2,r=i%2?radius*.42:radius;const x=Math.cos(a)*r,y=Math.sin(a)*r;i?shape.lineTo(x,y):shape.moveTo(x,y);}shape.closePath();
    const geometry=new THREE.ExtrudeGeometry(shape,{depth:.25,bevelEnabled:false});const mesh=new THREE.Mesh(geometry,this.materials.get('bulb'));mesh.position.copy(position);this.addModel(mesh);
  }
  private buildGarland(progress:number){
    const s=this.course.sample(progress),positions:THREE.Vector3[]=[];
    for(let j=0;j<=24;j++){
      const x=-17+j*34/24,height=15-2.1*Math.sin(j/24*Math.PI),p=s.position.clone().addScaledVector(s.right,x).addScaledVector(UP,height);positions.push(p);
      this.shape(this.ballGeometry,'green',p,new THREE.Vector3(.9,.45,.8));
      if(j%2===0){this.ball('bulb',p.clone().addScaledVector(UP,-.32),.12);this.glows.push(p.x,p.y-.35,p.z);}
      if(j%6===0){this.star(p.clone().addScaledVector(UP,-1.25),.65);this.box('red',p.clone().addScaledVector(UP,-.2),new THREE.Vector3(.6,1.1,.3));}
    }
    for(const side of [-1,1]){const foot=s.position.clone().addScaledVector(s.right,side*17);this.post('wood',foot.x,foot.z,s.position.y+15,.4);}
  }
  private buildArch(progress:number,label:string){
    const s=this.course.sample(progress),q=this.orientation(progress);
    for(const side of [-1,1]){
      // Pillars reach down to the lowest snow under their base.
      const foot=s.position.clone().addScaledVector(s.right,side*16),bottom=this.terrain.heightUnder(foot.x,foot.z,1.9)-.1,top=s.position.y+14;
      this.box('stone',foot.setY((top+bottom)/2),new THREE.Vector3(3.8,top-bottom,3.8),q);
      this.box('snow',s.position.clone().addScaledVector(s.right,side*16).addScaledVector(UP,14.2),new THREE.Vector3(4.4,.7,4.4),q);
    }
    this.box('wood',s.position.clone().addScaledVector(UP,14),new THREE.Vector3(34,3,2.2),q);
    this.sign(label,progress,0,14,30,2.1);
    for(let j=-15;j<=15;j++){
      const p=s.position.clone().addScaledVector(s.right,j).addScaledVector(UP,16);this.ball('green',p,.65);
      const front=p.clone().addScaledVector(s.tangent,-1.3);this.ball('bulb',front,.11);this.glows.push(front.x,front.y,front.z);
      if(j%5===0)this.star(front.clone().addScaledVector(UP,-.05),.7);
      if(j%10===0){for(const sign of [-1,1]){const wing=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),sign*.55).premultiply(q);this.box('ribbon',front.clone().addScaledVector(s.right,sign*.45),new THREE.Vector3(1.1,.8,.35),wing);}this.box('ribbon',front.clone().addScaledVector(UP,-.7),new THREE.Vector3(.45,1.3,.3),q);}
    }
    for(const side of [-1,1]){const p=s.position.clone().addScaledVector(s.right,side*16).addScaledVector(UP,8).addScaledVector(s.tangent,-2.1);this.box('bulb',p,new THREE.Vector3(.75,1.4,.5),q);this.glows.push(p.x,p.y,p.z);} 
  }
  private sign(text:string,progress:number,lateral:number,height:number,width:number,size:number){
    const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=128;const ctx=canvas.getContext('2d')!;
    ctx.fillStyle='#102b44';ctx.fillRect(0,0,1024,128);ctx.strokeStyle='#84bed9';ctx.lineWidth=4;ctx.strokeRect(5,5,1014,118);ctx.fillStyle='#d8f0ff';ctx.font='bold 47px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,512,66,970);
    const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(width,size),new THREE.MeshBasicMaterial({map,side:THREE.DoubleSide}));
    // Arch boards hang on the arch (road height); roadside boards stand on two posts.
    mesh.position.copy(lateral?this.ground(progress,lateral):this.at(progress,0));mesh.quaternion.copy(this.orientation(progress));mesh.position.y+=height;mesh.position.addScaledVector(this.course.sample(progress).tangent,-1.15);this.root.add(mesh);
    if(lateral)for(const end of [-1,1]){const foot=mesh.position.clone().addScaledVector(this.course.sample(progress).right,end*(width/2-.4));this.post('dark',foot.x,foot.z,mesh.position.y+size/2,.2);}
  }
  private buildClock(tower:THREE.Object3D):[THREE.Group,THREE.Group]{
    const canvas=document.createElement('canvas');canvas.width=canvas.height=512;const ctx=canvas.getContext('2d')!;
    ctx.fillStyle='#f8d49a';ctx.fillRect(0,0,512,512);ctx.strokeStyle='#423527';ctx.lineWidth=12;ctx.beginPath();ctx.arc(256,256,242,0,Math.PI*2);ctx.stroke();
    ctx.font='bold 48px Georgia';ctx.fillStyle='#332b24';ctx.textAlign='center';ctx.textBaseline='middle';
    for(let i=1;i<=12;i++){const a=i/12*Math.PI*2;ctx.fillText(String(i),256+Math.sin(a)*185,256-Math.cos(a)*185);}
    const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;
    const parent=new THREE.Group();parent.position.copy(new THREE.Vector3(0,26,4.61).applyMatrix4(tower.matrixWorld));parent.quaternion.copy(tower.quaternion);
    const face=new THREE.Mesh(new THREE.CircleGeometry(3.2,48),new THREE.MeshBasicMaterial({map,color:0xffe4b6,toneMapped:false}));parent.add(face);
    const hands=[new THREE.Group(),new THREE.Group()] as [THREE.Group,THREE.Group];
    for(const [i,hand] of hands.entries()){const mesh=new THREE.Mesh(new THREE.BoxGeometry(i?.22:.14,i?1.7:2.5,.06),this.materials.get('dark'));mesh.position.set(0,i?.65:1,.1);hand.add(mesh);parent.add(hand);}this.root.add(parent);
    return hands;
  }
  private buildGondolas(model:THREE.Group){
    for(const z of [-135,-145])this.beam('dark',new THREE.Vector3(-160,44,z),new THREE.Vector3(190,70,z),.1,.1);
    for(let i=0;i<5;i++){const car=model.clone(true);car.scale.setScalar(1.4);this.root.add(car);this.gondolas.push(car);}
  }
  private buildPuddles(){
    const mirror=new Reflector(new THREE.PlaneGeometry(24.8,84),{textureWidth:512,textureHeight:512,multisample:0,clipBias:.003});mirror.position.set(0,.015,-42);mirror.rotation.x=-Math.PI/2;
    const material=mirror.material as THREE.ShaderMaterial;material.transparent=true;material.depthWrite=false;
    material.addEventListener('dispose',()=>mirror.getRenderTarget().dispose());
    material.vertexShader='varying vec2 iceCoord;\n'+material.vertexShader.replace('void main() {','void main() {iceCoord=position.xy;');
    material.fragmentShader='varying vec2 iceCoord;\n'+material.fragmentShader;
    material.fragmentShader=material.fragmentShader.replace('vec4 base = texture2DProj( tDiffuse, vUv );','vec4 wetUv=vUv;wetUv.x+=sin(iceCoord.y*5.+sin(iceCoord.x*4.)*3.)*.0028*vUv.w;wetUv.y+=sin(iceCoord.x*9.+iceCoord.y*2.)*.0015*vUv.w;vec4 base=texture2DProj(tDiffuse,wetUv);');
    material.fragmentShader=material.fragmentShader.replace('gl_FragColor = vec4( blendOverlay( base.rgb, color ), 1.0 );','float icePatch=smoothstep(.1,.75,sin(iceCoord.x*.66+sin(iceCoord.y*.19))*cos(iceCoord.y*.4));float end=smoothstep(0.,5.,42.-abs(iceCoord.y));gl_FragColor=vec4(base.rgb*.72,icePatch*end*.21);');
    this.root.add(mirror);
  }
  private buildSnow(){
    const positions:number[]=[];for(let i=0;i<1100;i++)positions.push(Math.sin(i*41.4)*52,(i*.137)%40,Math.cos(i*17.7)*52);
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    const material=new THREE.ShaderMaterial({uniforms:{time:this.time},transparent:true,depthWrite:false,
      vertexShader:'uniform float time;varying float alpha;void main(){vec3 p=position;p.y=mod(position.y-time*1.5,40.);p.x+=sin(time*.3+position.z)*1.4;vec4 v=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*v;gl_PointSize=clamp(110./-v.z,1.1,4.5);alpha=.65;}',
      fragmentShader:'varying float alpha;void main(){float r=length(gl_PointCoord-.5)*2.;gl_FragColor=vec4(.87,.94,1.,alpha*(1.-smoothstep(.2,1.,r)));}'});
    const mesh=new THREE.Points(geometry,material);mesh.frustumCulled=false;return mesh;
  }
  private buildSmoke(){
    const positions:number[]=[],phases:number[]=[];
    for(const source of this.smokeSources)for(let j=0;j<8;j++){positions.push(source.x,source.y,source.z);phases.push(j/8+source.x*.001);}
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('phase',new THREE.Float32BufferAttribute(phases,1));
    const mesh=new THREE.Points(geometry,new THREE.ShaderMaterial({uniforms:{time:this.time},transparent:true,depthWrite:false,
      vertexShader:'uniform float time;attribute float phase;varying float alpha;void main(){float age=fract(phase+time*.075);vec3 p=position+vec3(age*5.,age*12.,sin(age*3.+phase)*2.);vec4 v=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*v;gl_PointSize=clamp((10.+age*35.)*80./-v.z,1.,48.);alpha=sin(age*3.14159)*.16;}',
      fragmentShader:'varying float alpha;void main(){float r=length(gl_PointCoord-.5)*2.;gl_FragColor=vec4(.73,.78,.84,alpha*(1.-smoothstep(.15,1.,r)));}'}));mesh.frustumCulled=false;this.root.add(mesh);
  }
  private buildGlows(){
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(this.glows,3));
    const mesh=new THREE.Points(geometry,new THREE.ShaderMaterial({uniforms:{time:this.time},transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
      vertexShader:'uniform float time;varying float alpha;void main(){vec4 v=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*v;gl_PointSize=clamp(620./-v.z,3.,24.);alpha=.6+.06*sin(time+position.x);}',
      fragmentShader:'varying float alpha;void main(){float r=length(gl_PointCoord-.5)*2.;gl_FragColor=vec4(1.,.6,.2,alpha*pow(max(0.,1.-r),2.));}'}));mesh.frustumCulled=false;this.root.add(mesh);
  }
  private buildFireworks(){
    const points:number[]=[],seeds:number[]=[];for(let i=0;i<720;i++){const a=i*.6180339*Math.PI*2,z=1-2*(i%120)/120,r=Math.sqrt(1-z*z);points.push(Math.cos(a)*r,z,Math.sin(a)*r);seeds.push(Math.floor(i/120));}
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(points,3));geometry.setAttribute('seed',new THREE.Float32BufferAttribute(seeds,1));
    const mesh=new THREE.Points(geometry,new THREE.ShaderMaterial({uniforms:{time:this.time,celebration:this.celebration},transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
      vertexShader:'uniform float time;uniform float celebration;attribute float seed;varying float alpha;varying vec3 color;void main(){float age=mod(time+seed*1.37,8.);float spread=min(age,3.)*14.;vec3 center=vec3(120.+seed*32.,120.+sin(seed*2.)*12.,-300.-seed*18.);vec3 p=center+position*spread;p.y-=age*age*2.;vec4 v=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*v;gl_PointSize=clamp(1800./-v.z,2.,7.);alpha=step(age,3.)*(1.-age/3.)*celebration;color=mix(vec3(1.,.64,.2),vec3(1.,.38,.3),mod(seed,2.));}',
      fragmentShader:'varying float alpha;varying vec3 color;void main(){float r=length(gl_PointCoord-.5)*2.;gl_FragColor=vec4(color,alpha*max(0.,1.-r));}'}));mesh.frustumCulled=false;mesh.name='midnight_fireworks';this.root.add(mesh);
    const streakPositions:number[]=[],streakSeeds:number[]=[],tails:number[]=[];
    for(let i=0;i<720;i++)for(const tail of [0,1]){streakPositions.push(points[i*3],points[i*3+1],points[i*3+2]);streakSeeds.push(seeds[i]);tails.push(tail);}
    const streaks=new THREE.BufferGeometry();streaks.setAttribute('position',new THREE.Float32BufferAttribute(streakPositions,3));streaks.setAttribute('seed',new THREE.Float32BufferAttribute(streakSeeds,1));streaks.setAttribute('tail',new THREE.Float32BufferAttribute(tails,1));
    const source=mesh.material as THREE.ShaderMaterial;
    const trailMaterial=new THREE.ShaderMaterial({uniforms:source.uniforms,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
      vertexShader:'attribute float tail;'+source.vertexShader.replace('vec3 p=center+position*spread;','vec3 p=center+position*(spread-tail*min(spread*.28,5.));').replace('color=mix','alpha*=.7-tail*.4;color=mix'),
      fragmentShader:'varying float alpha;varying vec3 color;void main(){gl_FragColor=vec4(color,alpha);}'});
    const trails=new THREE.LineSegments(streaks,trailMaterial);trails.frustumCulled=false;this.root.add(trails);
  }
  updateVisibility(camera:THREE.Camera){
    this.winterEffects.update();this.holidayLife.update(this.course.visualTime);
    const time=this.course.visualTime;this.time.value=time;this.celebration.value=this.course.lap>=this.course.totalLaps?1:.65;
    this.sky.position.copy(camera.position);camera.getWorldDirection(this.cameraForward);this.snow.position.copy(camera.position).addScaledVector(this.cameraForward,30);this.snow.position.y-=9;
    for(const [i,car] of this.gondolas.entries()){const phase=(time*.012+i/5)%1,x=-160+phase*350;car.position.set(x,44+phase*26-10,-135);car.rotation.z=Math.sin(time*.6+i)*.025;}
    const midnight=this.course.lap>=this.course.totalLaps;
    this.minuteHand.rotation.z=midnight?0:-Math.PI*2*(.93+Math.min(time,180)/180*.06);
    this.hourHand.rotation.z=midnight?0:Math.PI/18;
  }
}
