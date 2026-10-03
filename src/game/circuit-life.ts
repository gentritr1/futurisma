import * as THREE from 'three';
import {overlapsCircuitSignature} from './circuit-signature-sites';
import type {RaceCourse, CourseKind} from './course';
import type {CircuitBoothKit} from './circuit-booth-kit';

type Motion = {node: THREE.Object3D; kind: 'spin' | 'sway' | 'float' | 'wave' | 'fan' | 'steam'; phase: number; y: number};
type Batch = {mesh: THREE.InstancedMesh; parts: THREE.Mesh[]; moving: boolean};
const COLORS: Record<CourseKind, [number, number, number]> = {
  greenwater:[0x386b64,0x9ce4a9,0xe3bd79], bitterpan:[0xb99872,0xffc674,0xe6ded0],
  nightshift:[0x343c55,0xff7998,0x82dfdd], polarity:[0x353952,0x8ceaff,0xe7ad62],
  tideline:[0x536a61,0xffc87c,0x96d9bd], ascension:[0xa5afb3,0xffb961,0x82dfe4],
  dreamisland:[0x5e9987,0xffd88e,0xf29d9d], afterglow:[0x403c59,0xff985e,0xb59aff],
  frostline:[0x5b7482,0xffd392,0x96e4ed],
};

/** Inhabited roadside scenes batched by material, with two bounded local lights
 * for authored booths. Every complete footprint clears the playable road. */
export class CircuitLife {
  readonly root = new THREE.Group();
  readonly sites: {progress:number; clearance:number}[] = [];
  private readonly source = new THREE.Group();
  private readonly motions: Motion[] = [];
  private readonly batches: Batch[] = [];
  private lastTime = -1;
  private readonly animatedRoots: THREE.Object3D[] = [];
  readonly vergeSites: {progress:number;clearance:number}[] = [];
  readonly midgroundSites: {progress:number;clearance:number}[] = [];
  private readonly box = new THREE.BoxGeometry(1,1,1);
  private readonly cylinder = new THREE.CylinderGeometry(1,1,1,10);
  private readonly sphere = new THREE.SphereGeometry(1,8,6);
  private readonly cone = new THREE.ConeGeometry(1,1,8);
  private readonly materials: THREE.MeshStandardMaterial[];
  private readonly signTexture: THREE.CanvasTexture;
  private readonly glowTexture: THREE.CanvasTexture;
  private readonly floorPlane=new THREE.PlaneGeometry(1,1);
  private readonly floorMaterials: THREE.MeshBasicMaterial[];
  private readonly steamMaterial:THREE.MeshBasicMaterial;
  private readonly lanternHaloMaterial:THREE.MeshBasicMaterial;
  private readonly boothLights:THREE.PointLight[]=[];
  private readonly boothLightAnchors:{progress:number;position:THREE.Vector3}[]=[];
  private readonly signGeometries: THREE.BoxGeometry[] = [];
  private readonly route: {position:THREE.Vector3; width:number}[];

  constructor(private readonly course: RaceCourse, private readonly boothKit: CircuitBoothKit | null = null,
    private readonly districts: readonly {position:THREE.Vector3;radius:number}[] = []) {
    this.root.name = `${course.kind}_roadside_life`;
    const [base,light,accent] = COLORS[course.kind];
    const names:Record<string,[string,string]>={greenwater:['REED RADIO','CANTEEN / WETLAND OUTPOST'],bitterpan:['PAN SERVICE','SOLAR / SALT / SUPPLY'],nightshift:['LATE SHIFT','24 HOUR NOODLE CLUB'],polarity:['FLUX SERVICE','FIELD ENGINEERING / 02'],tideline:['DOCK FOUR','CREW / COFFEE / REPAIRS'],ascension:['ORBITAL WATCH','OBSERVATION / FLIGHT CREW'],dreamisland:['MANGO CLUB','FRESH FRUIT / COAST RADIO'],afterglow:['NIGHT MARKET','OPEN UNTIL FIRST LIGHT']};
    const subtitles:Record<string,[string,string]>={
      greenwater:['FERRY MARKET / FRESH DAILY','WETLAND RADIO / CREW REST'],
      bitterpan:['MINERAL EXCHANGE / SUPPLIES','SOLAR REPAIR / CREW REST'],
      nightshift:['NIGHT MARKET / FRESH DAILY','MIDNIGHT SERVICE / OPEN LATE'],
      polarity:['COIL MAINTENANCE / STATION 02','GRAVITY CALIBRATION / CREW'],
      tideline:['DOCK SUPPLIES / FRESH DAILY','VALVE REPAIR / CREW REST'],
      ascension:['FLIGHT WATCH / OBSERVERS','MISSION SUPPORT / CREW REST'],
      dreamisland:['FRUIT MARKET / FRESH DAILY','COAST RADIO / BOARD REPAIR'],
      afterglow:['NIGHT MARKET / FRESH DAILY','RELAY SERVICE / OPEN LATE'],
    };
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=384;
    const context=canvas.getContext('2d')!;
    for(let variant=0;variant<3;variant++){
      context.save();context.translate(0,variant*128);
      context.fillStyle='#17272d';context.fillRect(0,0,512,128);
      context.fillStyle=new THREE.Color(light).getStyle();context.fillRect(10,10,5,108);context.fillRect(497,10,5,108);
      context.textAlign='center';context.font='bold 42px monospace';context.fillText(names[course.kind][0],256,62);
      context.font='17px monospace';context.fillText([names[course.kind][1],...subtitles[course.kind]][variant],256,99);
      context.restore();
      const geometry=this.box.clone(),uv=geometry.getAttribute('uv');
      for(let i=0;i<uv.count;i++)uv.setY(i,(uv.getY(i)+2-variant)/3);
      this.signGeometries.push(geometry);
    }
    this.signTexture=new THREE.CanvasTexture(canvas);this.signTexture.colorSpace=THREE.SRGBColorSpace;

    const glowCanvas=document.createElement('canvas');glowCanvas.width=glowCanvas.height=64;
    const glowContext=glowCanvas.getContext('2d')!;
    const gradient=glowContext.createRadialGradient(32,32,0,32,32,32);
    gradient.addColorStop(0,'rgba(255,255,255,1)');gradient.addColorStop(.35,'rgba(255,255,255,.6)');gradient.addColorStop(1,'rgba(255,255,255,0)');
    glowContext.fillStyle=gradient;glowContext.fillRect(0,0,64,64);
    this.glowTexture=new THREE.CanvasTexture(glowCanvas);
    this.steamMaterial=new THREE.MeshBasicMaterial({map:this.glowTexture,color:0xa5a9b2,transparent:true,opacity:.18,depthWrite:false,side:THREE.DoubleSide});
    this.lanternHaloMaterial=new THREE.MeshBasicMaterial({map:this.glowTexture,color:0xffbd88,transparent:true,opacity:.26,depthWrite:false,side:THREE.DoubleSide,toneMapped:false});
    this.floorMaterials=[
      new THREE.MeshBasicMaterial({map:this.glowTexture,color:boothKit?0xffc08c:light,transparent:true,opacity:boothKit ? .55 : .4,toneMapped:!boothKit,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1}),
      new THREE.MeshBasicMaterial({map:this.glowTexture,color:0x071013,transparent:true,opacity:.35,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1}),
    ];
    this.materials = [
      new THREE.MeshStandardMaterial({color:base,roughness:.8}),
      new THREE.MeshStandardMaterial({color:0x283338,roughness:.72,metalness:.3}),
      new THREE.MeshStandardMaterial({color:light,emissive:light,emissiveIntensity:1.3,roughness:.35}),
      new THREE.MeshStandardMaterial({color:accent,roughness:.7}),
      new THREE.MeshStandardMaterial({color:0xd7c2a5,roughness:.94}),
      new THREE.MeshStandardMaterial({color:0x67817a,roughness:.85}),
      new THREE.MeshStandardMaterial({map:this.signTexture,emissiveMap:this.signTexture,emissive:0xffffff,emissiveIntensity:.55,roughness:.65}),
    ];
    this.route = Array.from({length:Math.ceil(course.length/8)},(_,i)=> {
      const s=course.sample(i/Math.ceil(course.length/8));return {position:s.position.clone(),width:s.halfWidth};
    });
    for(let i=0;i<18;i++) this.site((.027+i/18)%1,i);
    this.fillVerges();
    this.fillOlderMapMidground();
    this.source.updateMatrixWorld(true);
    if(boothKit){
      for(let i=0;i<this.sites.length;i++){
        const position=new THREE.Vector3(0,2.35,-1.5).applyMatrix4(this.source.children[i].matrixWorld);
        this.boothLightAnchors.push({progress:this.sites[i].progress,position});
      }
      // Two unshadowed lights serve the nearest stops; cost never scales with
      // the number of booths. Distant stalls retain their emissive fixtures.
      for(let i=0;i<2;i++){
        const light=new THREE.PointLight(0xffbb8f,0,9,2);
        this.boothLights.push(light);this.root.add(light);
      }
    }
    const movingNodes=new Set(this.motions.map(motion=>motion.node));
    for(const motion of this.motions){
      let parent=motion.node.parent, nested=false;
      while(parent){if(movingNodes.has(parent)){nested=true;break;}parent=parent.parent;}
      if(!nested)this.animatedRoots.push(motion.node);
    }
    this.batch();
    this.root.userData.sites=this.sites;
    this.root.userData.vergeSites=this.vergeSites;
    this.root.userData.midgroundSites=this.midgroundSites;
    this.root.userData.animatedElements=this.motions.length;
    this.root.userData.drawCalls=this.batches.length;
    this.root.userData.authoredBooths=Boolean(boothKit);
    this.update(0,false);
  }

  private part(parent:THREE.Object3D,geometry:THREE.BufferGeometry,material:number,x:number,y:number,z:number,sx:number,sy:number,sz:number) {
    const mesh=new THREE.Mesh(geometry,this.materials[material]);
    mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);parent.add(mesh);return mesh;
  }
  private block(p:THREE.Object3D,m:number,x:number,y:number,z:number,sx:number,sy:number,sz:number) {return this.part(p,this.box,m,x,y,z,sx,sy,sz);}
  private pivot(parent:THREE.Object3D,x:number,y:number,z:number,kind:Motion['kind'],phase:number) {
    const node=new THREE.Group();node.position.set(x,y,z);parent.add(node);this.motions.push({node,kind,phase,y});return node;
  }
  private person(parent:THREE.Object3D,x:number,z:number,phase:number) {
    const body=this.pivot(parent,x,.07,z,'sway',phase);
    this.block(body,1,-.19,.34,0,.18,.68,.25);this.block(body,1,.19,.34,0,.18,.68,.25);
    this.block(body,phase%3===0?0:3,0,1.04,0,.68,.76,.4);
    this.block(body,3,-.43,1.04,0,.18,.69,.23);
    this.floorPatch(parent,1,x,.009,z,1.15,.85);
    this.part(body,this.sphere,4,0,1.66,0,.24,.29,.24);
    this.part(body,this.cylinder,0,0,1.91,0,.3,.12,.3);
    for(const eye of [-.085,.085])this.block(body,1,eye,1.71,-.224,.046,.046,.033);
    const arm=this.pivot(body,.44,1.29,0,'wave',phase+2);
    this.block(arm,3,0,.17,0,.19,.64,.23);
  }
  private lamp(parent:THREE.Object3D,x:number,z:number) {
    this.block(parent,1,x,2,z,.13,4,.13);this.block(parent,1,x,4.1,z,.8,.13,.65);
    this.block(parent,2,x,3.94,z,.5,.17,.4);
  }
  private floorPatch(parent:THREE.Object3D,material:number,x:number,y:number,z:number,width:number,depth:number){
    const patch=new THREE.Mesh(this.floorPlane,this.floorMaterials[material]);
    patch.position.set(x,y,z);patch.scale.set(width,depth,1);patch.rotation.x=-Math.PI/2;parent.add(patch);
  }
  private booth(parent:THREE.Object3D,wide=false,variant=0) {
    if(this.boothKit){
      const booth=this.boothKit.create(variant);
      const width=wide?1.35:.78;
      booth.scale.x=width;parent.add(booth);
      const rotor=this.pivot(booth,-1.8,4.65,.34,'fan',variant);
      rotor.add(this.boothKit.createRotor());
      for(const x of [-2.35,2.35]){
        const halo=new THREE.Mesh(this.floorPlane,this.lanternHaloMaterial);
        halo.position.set(x,2.45,-2.04);halo.scale.set(1.2,1.7,1);booth.add(halo);
        this.floorPatch(booth,0,x*.5,.016,-2.7,3.7,4.5);
      }
      for(let puff=0;puff<5;puff++){
        const steam=this.pivot(booth,1.65,5.2,.65,'steam',puff*.34);
        const mesh=new THREE.Mesh(this.floorPlane,this.steamMaterial);
        mesh.scale.set(.9,1.15,1);steam.add(mesh);
      }
      this.lamp(parent,-4,-2);
      this.floorPatch(parent,0,0,.014,-1.8,7,6);
      return;
    }
    const w=wide?5.6:3.8;
    if(variant===1){
      // An open market canopy and produce trays rather than another closed box.
      for(const x of [-w/2,w/2])for(const z of [-.9,1.7])this.block(parent,1,x,1.6,z,.14,3.2,.14);
      this.block(parent,0,0,.6,.6,w,1.2,2.5);
      for(let row=0;row<2;row++)for(let column=0;column<6;column++){
        this.part(parent,this.sphere,column%2?3:5,-w*.38+column*w*.15,1.34,-.25+row*.5,.18,.18,.18);
      }
    }else{
      this.block(parent,0,0,1.6,1,w,3.2,2.8);
      if(variant===2){
        this.block(parent,1,0,1.55,-.43,w*.58,2.65,.07);
        for(let j=0;j<7;j++)this.block(parent,3,0,.45+j*.3,-.49,w*.53,.045,.04);
        this.block(parent,3,w*.37,1.4,-.48,.15,.65,.06);
      }
    }
    if(variant===0)this.block(parent,2,0,2.2,-.43,w*.7,1.1,.05);
    if(variant===0)for(let i=-1;i<=1;i++)this.block(parent,1,i*w*.23,2.2,-.48,.09,1.2,.12);
    this.block(parent,3,0,3.3,.3,w+.5,.18,4.2);
    this.block(parent,1,0,.9,-1.3,w,.15,1.1);
    for(let i=-1;i<=1;i++)this.part(parent,this.cylinder,3,i,1.16,-1.4,.14,.35,.14);
    this.lamp(parent,-w/2-1,-2);
    this.floorPatch(parent,0,0,.012,-1.7,5,5);
  }
  private fan(parent:THREE.Object3D,x:number,y:number,z:number,phase:number,radius=1.2) {
    this.block(parent,1,x,y/2,z,.22,y,.22);
    const hub=this.pivot(parent,x,y,z,'spin',phase);
    this.block(hub,3,0,0,0,radius*2,.16,.28);
    this.block(hub,3,0,0,0,.28,.16,radius*2);
    this.part(hub,this.sphere,2,0,0,0,.23,.2,.23);
  }
  private scene(parent:THREE.Object3D,index:number) {
    const kind=this.course.kind;
    const variant=index%3;
    if(kind==='greenwater') {
      this.booth(parent,false,variant); // waterside canteen, reed beds and hovering insects
      for(let j=0;j<9;j++) {
        const reed=this.pivot(parent,3+(j%3)*.55,0,-2+Math.floor(j/3)*.75,'sway',index+j);
        this.block(reed,5,0,1,0,.06,2,.06);this.part(reed,this.cylinder,3,0,2,0,.12,.55,.12);
      }
      for(let j=0;j<3;j++){const insect=this.pivot(parent,2.5+j*.6,2.7,-2-j*.6,'float',index+j);this.block(insect,2,0,0,0,.36,.05,.1);}
    } else if(kind==='bitterpan') {
      this.booth(parent,false,variant);this.fan(parent,3.9,5.4,1,index,1.8);
      for(let j=0;j<4;j++) {
        this.block(parent,1,-3.5,.9,-2+j,1,.2,.8);
        this.part(parent,this.cone,4,-3.5,1.35,-2+j,.6,.8,.5);
      }
      const vane=this.pivot(parent,3.9,3.7,1,'sway',index);
      this.block(vane,3,1,0,0,2,.38,.08);
    } else if(kind==='nightshift'||kind==='afterglow') {
      this.booth(parent,true,variant);
      if(!this.boothKit)for(let j=0;j<4;j++) {
        const shade=this.block(parent,j%2?3:0,-2.1+j*1.4,3.15,-1.2,1.4,.13,1.5);shade.rotation.x=.13;
        this.block(parent,2,-2.1+j*1.4,2.9,-1.95,.18,.18,.18);
      }
      if(!this.boothKit){
        this.fan(parent,2,4.25,1,index,.65);
        this.block(parent,1,-3.6,.75,0,.8,1.5,.7);this.block(parent,2,-3.6,1.1,-.37,.6,.55,.03);
      }
      const drone=this.pivot(parent,3.3,5.1,1,'float',index);
      this.block(drone,0,0,0,0,1.3,.35,.7);this.block(drone,2,0,-.22,0,.5,.07,.3);
    } else if(kind==='polarity') {
      this.block(parent,1,0,1.1,0,5,2.2,3);
      for(let j=0;j<3;j++) {
        const rotor=this.pivot(parent,-1.6+j*1.6,3,0,'spin',index+j);
        this.block(rotor,3,0,0,0,.2,2.5,2.5);this.block(rotor,2,0,1.3,0,.25,.15,2.7);
      }
      this.lamp(parent,-3.6,-2);this.block(parent,0,3,1,-1,1,2,1);this.block(parent,2,3,1.5,-1.52,.65,.7,.06);
    } else if(kind==='tideline') {
      this.booth(parent,false,variant);this.fan(parent,3.5,3.5,1,index,1.2);
      for(let j=0;j<3;j++){
        this.part(parent,this.cylinder,3,-3.5,.8,j-1,.5,1.6,.5);
        const steam=this.pivot(parent,3.4,4.5+j*.7,1,'float',index+j);
        this.part(steam,this.sphere,5,0,0,0,.28+j*.15,.25,.3+j*.15);
      }
    } else if(kind==='ascension') {
      this.booth(parent,false,variant);this.block(parent,1,3.5,2.4,0,.3,4.8,.3);
      const dish=this.pivot(parent,3.5,4.8,0,'spin',index);
      const bowl=this.part(dish,this.cone,4,0,0,0,1.4,.65,1.4);bowl.rotation.z=.75;
      this.block(dish,2,-.5,.8,0,.15,1.5,.15);
      for(let j=0;j<3;j++)this.block(parent,3,-3.7,.45,j-1,.8,.9,.7);
    } else if(kind==='dreamisland') {
      this.booth(parent,true,variant);
      const palm=this.pivot(parent,3.8,0,1.3,'sway',index);
      this.part(palm,this.cylinder,4,0,2.5,0,.2,5,.25);
      for(let j=0;j<6;j++) {
        const leaf=this.block(palm,5,Math.sin(j)*1.1,5,Math.cos(j)*1.1,.7,.16,2.7);leaf.rotation.y=j;leaf.rotation.x=.25;
      }
      for(let j=0;j<3;j++){const board=this.block(parent,3,-3.8+j*.45,1.4,0,.32,2.8,.12);board.rotation.z=.12;}
    }
    this.part(parent,this.signGeometries[variant],6,0,3.75,this.boothKit?-2.07:-1.15,this.boothKit?5.8:4.6,this.boothKit ? .95 : 1.15,.12);
    this.block(parent,1,-2,3.25,-1.1,.1,.8,.1);this.block(parent,1,2,3.25,-1.1,.1,.8,.1);
    for(let j=0;j<7;j++){
      const x=-4.5+j*1.5,y=3.8-Math.sin(j/6*Math.PI)*.65;
      const bulbRadius=this.boothKit ? .055 : .085;
      this.block(parent,1,x,y,-4.4,1.53,.035,.035);this.part(parent,this.sphere,2,x,y-.13,-4.4,bulbRadius,.12,bulbRadius);
    }
    for(const x of [-4.5,4.5])this.block(parent,1,x,1.9,-4.4,.08,3.8,.08);
    for(const side of [-1,1]){
      const x=side*4.1;
      this.block(parent,0,x,.32,-3.1,1,.64,1);
      this.block(parent,1,x,.66,-3.1,1.07,.09,1.07);
      if(['greenwater','nightshift','dreamisland','afterglow'].includes(kind)){
        for(let leaf=0;leaf<3;leaf++)this.part(parent,this.cone,5,x+(leaf-1)*.25,1.03,-3.1,.35,.85,.35);
      }else{
        this.part(parent,this.cylinder,3,x,1,-3.1,.32,.6,.32);
        this.block(parent,2,x,1.32,-3.1,.38,.07,.38);
      }
    }
    this.person(parent,-1.2,-2.5,index);this.person(parent,1.6,-2.9,index+3);
    if(!this.boothKit){
      this.block(parent,0,0,.65,-3.9,2.8,.2,.65);
      this.block(parent,1,-1,.3,-3.9,.12,.6,.5);this.block(parent,1,1,.3,-3.9,.12,.6,.5);
    }
  }
  private site(progress:number,index:number) {
    const sample=this.course.sample(progress);
    // Do not put surface scenery into underwater chambers or on banked walls.
    if(sample.up.y<.88||this.course.travelModeAt?.(progress)==='submerged')return;
    const side=index%2?1:-1;
    const city=this.course.kind==='nightshift'||this.course.kind==='afterglow';
    const scale=city ? .55 : 1;
    const angle=Math.atan2(sample.tangent.x,sample.tangent.z)+(side>0?-Math.PI/2:Math.PI/2);
    const position=sample.position.clone().addScaledVector(sample.right,side*(sample.halfWidth+(city?6.5:12)));
    let clearance=Infinity;
    for(const point of this.route) {
      if(Math.abs(point.position.y-position.y)>12)continue;
      const dx=point.position.x-position.x,dz=point.position.z-position.z;
      const localX=Math.cos(angle)*dx-Math.sin(angle)*dz;
      const localZ=Math.sin(angle)*dx+Math.cos(angle)*dz;
      const outsideX=Math.max(0,Math.abs(localX)-6*scale);
      const outsideZ=Math.max(0,Math.abs(localZ)-5.5*scale);
      clearance=Math.min(clearance,Math.hypot(outsideX,outsideZ)-point.width);
    }
    if(clearance<3||overlapsCircuitSignature(this.course,position,8*scale))return;
    const site=new THREE.Group();site.position.copy(position);site.rotation.y=angle;
    if(city)site.scale.set(.55,1,.55);
    this.source.add(site);this.block(site,1,0,-.35,0,12,.65,11);
    // Short visible footings ground the roadside deck on elevated circuits.
    for(const x of [-5,5])for(const z of [-4,4])this.block(site,0,x,-2,z,.55,4,.55);
    this.scene(site,index);this.sites.push({progress,clearance});
  }
  /** Dense small clusters connect the larger stops without becoming obstacles.
   * The road envelope and plaza exclusions are checked before placing anything. */
  private fillVerges(){
    const kind=this.course.kind;
    const city=kind==='nightshift'||kind==='afterglow';
    const legacy=kind==='greenwater'||kind==='bitterpan'||kind==='nightshift';
    const count=Math.ceil(this.course.length/(legacy?28:48));
    const plazas=this.source.children.map(child=>child.position.clone());
    for(let i=0;i<count;i++)for(const side of [-1,1]){
      const progress=(i+.4)/count,sample=this.course.sample(progress);
      if(sample.up.y<.88||this.course.travelModeAt?.(progress)==='submerged')continue;
      if(kind==='dreamisland'&&['BASIN','REEF'].includes(sample.sector))continue;
      const radius=city?1.45:3.2;
      const position=sample.position.clone().addScaledVector(sample.right,side*(sample.halfWidth+(city?4.7:8+(i%3)*2)));
      if(plazas.some(plaza=>Math.hypot(plaza.x-position.x,plaza.z-position.z)<12))continue;
      let clearance=Infinity;
      for(const road of this.route){
        if(Math.abs(road.position.y-position.y)>12)continue;
        clearance=Math.min(clearance,Math.hypot(road.position.x-position.x,road.position.z-position.z)-road.width-radius);
      }
      if(clearance<2.5||overlapsCircuitSignature(this.course,position,radius))continue;
      const cluster=new THREE.Group();cluster.position.copy(position);
      cluster.rotation.y=Math.atan2(sample.tangent.x,sample.tangent.z)+(side>0?-Math.PI/2:Math.PI/2);
      this.source.add(cluster);this.vergeSites.push({progress,clearance});
      if(kind==='greenwater'||kind==='dreamisland'){
        // A low planted bed anchors each silhouette to the ground.
        this.part(cluster,this.cylinder,5,0,-.22,0,2.7,.45,2.1);
        if(i%3===0){
          const tree=i%2?cluster:this.pivot(cluster,0,0,0,'sway',i+side);
          this.part(tree,this.cylinder,4,0,1.9,0,.2,3.8,.22);
          if(kind==='dreamisland'){
            for(let leaf=0;leaf<6;leaf++){
              const frond=this.block(tree,5,Math.sin(leaf)*1.1,4.1,Math.cos(leaf)*1.1,.7,.16,2.8);frond.rotation.y=leaf;frond.rotation.x=.24;
            }
          }else{
            this.part(tree,this.cone,5,0,4,0,2.1,2.5,1.8);
            this.part(tree,this.cone,5,.6,4.9,.2,1.3,1.7,1.2);
          }
        }
        for(let reed=0;reed<7;reed++){
          const x=-1.7+(reed%4)*1.1,z=-.9+Math.floor(reed/4)*1.6,h=.8+(reed%3)*.45;
          this.part(cluster,this.cone,5,x,h/2,z,.3,h,.3);
          if(kind==='greenwater')this.part(cluster,this.cylinder,3,x,h,z,.06,.3,.06);
        }
      }else if(kind==='bitterpan'){
        if(i%3===0){
          this.block(cluster,0,0,.65,0,3.7,1.3,1.8);this.block(cluster,3,-.4,1.7,0,2.7,.8,1.6);
          for(let bar=0;bar<6;bar++)this.block(cluster,1,-1.55+bar*.6,.65,-.92,.035,1.1,.03);
        }else if(i%3===1){
          for(let j=0;j<3;j++)this.part(cluster,this.cone,4,-1.5+j*1.3,.75,(j%2)*.8,1.1,1.5,1);
        }else{
          for(const x of [-1.2,1.2]){
            this.block(cluster,1,x,.7,0,.12,1.4,.12);
            const panel=this.block(cluster,0,x,1.4,0,1.9,.1,2);panel.rotation.x=.35;
            for(let line=0;line<3;line++)this.block(cluster,3,x-.65+line*.65,1.48,0,.035,.035,1.8);
          }
        }
      }else if(city){
        this.block(cluster,1,0,.12,0,2.1,.24,1.65);
        if(i%3===0){
          this.block(cluster,0,0,.5,0,1.6,.65,1.1);
          for(const x of [-.5,0,.5])this.part(cluster,this.cone,5,x,1.15,0,.5,1.1,.5);
        }else if(i%3===1){
          this.block(cluster,0,0,1.05,0,.85,1.8,.65);
          this.block(cluster,2,0,1.38,-.34,.6,.67,.025);
          this.block(cluster,1,0,.65,-.36,.48,.13,.04);
        }else{
          for(const x of [-.9,.9])this.block(cluster,1,x,1.35,.4,.1,2.7,.1);
          this.block(cluster,0,0,2.7,.2,2.15,.13,1.2);
          this.block(cluster,2,0,2.58,-.38,1.5,.045,.07);
          this.block(cluster,3,0,.65,0,1.8,.15,.55);
          for(const x of [-.6,.6])this.block(cluster,1,x,.35,0,.1,.7,.4);
        }
      }else{
        this.block(cluster,1,0,.14,0,4.5,.28,3.2);
        for(let box=0;box<3;box++){
          const x=-1.3+box*1.3;
          if(kind==='tideline')this.part(cluster,this.cylinder,0,x,1,0,.48,1.7,.48);
          else this.block(cluster,0,x,.85,0,.9,1.4,1.15);
          this.block(cluster,2,x,1.43,-.6,.5,.1,.03);
        }
        if(i%3===0){
          this.block(cluster,1,0,2,.65,.1,4,.1);
          const indicator=this.pivot(cluster,0,3.6,.65,'sway',i);
          this.block(indicator,3,.55,0,0,1.15,.4,.05);
        }
      }
    }
  }
  private fillOlderMapMidground(){
    const kind=this.course.kind;
    if(kind!=='greenwater'&&kind!=='bitterpan')return;
    const count=Math.ceil(this.course.length/62);
    for(let i=0;i<count;i++)for(const side of [-1,1]){
      const progress=(i+.7)/count,sample=this.course.sample(progress);
      if(sample.up.y<.88)continue;
      const position=sample.position.clone().addScaledVector(sample.right,side*(sample.halfWidth+29+(i%3)*8));
      let clearance=Infinity;
      for(const road of this.route){
        if(Math.abs(road.position.y-position.y)>16)continue;
        clearance=Math.min(clearance,Math.hypot(road.position.x-position.x,road.position.z-position.z)-road.width-11);
      }
      if(clearance<8)continue;
      if(kind==='greenwater'&&this.districts.some(site=>site.position.distanceTo(position)<site.radius+12)){
        // Preserve a tree canopy behind the new waterfront settlement instead
        // of trading away the wetland's existing greenery for buildings.
        position.addScaledVector(sample.right,side*30);
        clearance=Infinity;
        for(const road of this.route){
          if(Math.abs(road.position.y-position.y)>16)continue;
          clearance=Math.min(clearance,Math.hypot(road.position.x-position.x,road.position.z-position.z)-road.width-11);
        }
      }
      if(clearance<8||this.districts.some(site=>site.position.distanceTo(position)<site.radius+12)||overlapsCircuitSignature(this.course,position,11))continue;
      const group=new THREE.Group();group.position.copy(position);
      group.rotation.y=Math.atan2(sample.tangent.x,sample.tangent.z)+i*.27;
      this.source.add(group);this.midgroundSites.push({progress,clearance});
      if(kind==='greenwater'){
        this.part(group,this.cylinder,5,0,-.65,0,9,1.3,7.5);
        for(let tree=0;tree<3;tree++){
          const x=-5.5+tree*5,z=tree===1?-3:1.5,h=5+(i+tree)%4;
          this.part(group,this.cylinder,4,x,h/2,z,.3,h,.35);
          // Buttress roots and overlapping broad crowns read as wetland groves.
          for(let root=0;root<3;root++){
            const limb=this.block(group,4,x+Math.sin(root*2.1)*.5,1,z+Math.cos(root*2.1)*.5,.3,2.2,.3);
            limb.rotation.z=Math.sin(root*2.1)*.3;
          }
          this.part(group,this.sphere,5,x,h,z,3.4,2.3,3.1);
          this.part(group,this.sphere,5,x+1.2,h+1.6,z-.5,2.5,1.9,2.4);
          this.part(group,this.cone,5,x-1.3,h-.8,z+.5,1.3,3.2,1.2);
        }
      }else if(i%3===0){
        for(const x of [-4.6,4.6]){
          this.part(group,this.cylinder,0,x,3.8,0,3.8,7.6,3.8);
          for(const y of [.35,3.8,7.5])this.part(group,this.cylinder,3,x,y,0,3.86,.17,3.86);
          this.part(group,this.cone,4,x,8.1,0,3.8,1,3.8);
          this.block(group,1,x,4,-3.87,.12,7.6,.12);
          for(let rung=0;rung<12;rung++)this.block(group,3,x, .7+rung*.57,-3.98,.6,.065,.07);
        }
      }else if(i%3===1){
        this.part(group,this.cone,4,-3,2.7,0,6,5.4,5);
        this.part(group,this.cone,4,4.8,1.8,1,4.5,3.6,4);
        this.block(group,0,0,.3,-5.2,15,.6,.35);
      }else{
        for(const x of [-6,0,6])for(const z of [-1.5,1.5])this.block(group,1,x,3,z,.28,6,.28);
        this.block(group,0,0,6,0,15,.4,3.6);
        this.block(group,3,0,6.4,-1.8,15,.5,.15);
        for(let brace=0;brace<5;brace++){
          const beam=this.block(group,1,-6+brace*3,3,-1.5,.14,6.3,.14);beam.rotation.z=.43;
        }
        this.part(group,this.cone,4,0,1.4,0,4.3,2.8,3);
      }
    }
  }
  private batch() {
    const groups=new Map<string,{parts:THREE.Mesh[];moving:boolean}>();
    const movingNodes=new Set(this.motions.map(motion=>motion.node));
    this.source.traverse(node=>{
      if(!(node instanceof THREE.Mesh))return;
      let parent:THREE.Object3D|null=node,moving=false;
      while(parent){if(movingNodes.has(parent)){moving=true;break;}parent=parent.parent;}
      const key=`${node.geometry.uuid}:${(node.material as THREE.Material).uuid}:${moving}`;
      const group=groups.get(key)??{parts:[],moving};group.parts.push(node);groups.set(key,group);
    });
    for(const {parts,moving} of groups.values()){
      const mesh=new THREE.InstancedMesh(parts[0].geometry,parts[0].material,parts.length);

      if(moving)mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      parts.forEach((part,i)=>mesh.setMatrixAt(i,part.matrixWorld));mesh.computeBoundingSphere();
      // Animation excursions are <1m. Expand the batch bound to avoid edge popping.
      if(mesh.boundingSphere)mesh.boundingSphere.radius+=3;
      this.root.add(mesh);this.batches.push({mesh,parts,moving});
    }
  }
  update(elapsed:number,reducedMotion:boolean,progress=this.course.startProgress) {
    if(this.boothLights.length){
      const distance=(p:number)=>Math.abs(((p-progress+1.5)%1)-.5)*this.course.length;
      const nearby=[...this.boothLightAnchors].sort((a,b)=>distance(a.progress)-distance(b.progress));
      this.boothLights.forEach((light,index)=>{
        const anchor=nearby[index];
        if(!anchor){light.intensity=0;return;}
        light.position.copy(anchor.position);
        light.intensity=14*Math.max(0,Math.min(1,(150-distance(anchor.progress))/50));
      });
    }
    const time=reducedMotion?0:elapsed;
    if(time===this.lastTime)return;this.lastTime=time;
    for(const motion of this.motions){
      if(motion.kind==='spin')motion.node.rotation.y=time*.45+motion.phase;
      else if(motion.kind==='fan')motion.node.rotation.z=time*2.4+motion.phase;
      else if(motion.kind==='steam'){
        const age=(time*.32+motion.phase)%1.7;
        motion.node.position.y=motion.y+age;
        motion.node.scale.setScalar(Math.sin(age/1.7*Math.PI)*(.4+age*.6));
      }
      else if(motion.kind==='wave'){
        const cycle=(time+motion.phase*1.7)%9;
        const greeting=Math.sin(Math.min(cycle/3,1)*Math.PI);
        motion.node.rotation.z=-.25-greeting*(.55+.13*Math.sin(time*5+motion.phase));
      }
      else if(motion.kind==='sway')motion.node.rotation.z=Math.sin(time*1.2+motion.phase)*.07;
      else motion.node.position.y=motion.y+Math.sin(time*.9+motion.phase)*.32;
    }
    for(const root of this.animatedRoots)root.updateMatrixWorld(true);
    for(const batch of this.batches)if(batch.moving){batch.parts.forEach((part,i)=>batch.mesh.setMatrixAt(i,part.matrixWorld));batch.mesh.instanceMatrix.needsUpdate=true;}
    // Very slow warm illumination, without flashing or allocating dynamic lights.
    this.materials[2].emissiveIntensity=1.15+Math.sin(time*.7)*.15;
  }
  dispose() {
    this.boothKit?.dispose();
    this.steamMaterial.dispose();
    this.lanternHaloMaterial.dispose();
    this.root.removeFromParent();this.signTexture.dispose();this.glowTexture.dispose();this.floorPlane.dispose();this.floorMaterials.forEach(material=>material.dispose());this.signGeometries.forEach(geometry=>geometry.dispose());this.box.dispose();this.cylinder.dispose();this.sphere.dispose();this.cone.dispose();
    this.batches.forEach(batch=>batch.mesh.dispose());this.materials.forEach(material=>material.dispose());this.root.clear();this.source.clear();
  }
}
