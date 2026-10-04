import * as THREE from 'three';
import type {FrostlineCourse} from './frostline-course';

const UP = new THREE.Vector3(0, 1, 0);
type ColorName = 'snow'|'wood'|'red'|'green'|'gold'|'skin'|'dark'|'light'|'ice'|'glow';
type Shape = 'box'|'ball'|'cone'|'ring'|'disc';
type Actor = {pose: THREE.Object3D; anchor: THREE.Matrix4; animate: (time: number, pose: THREE.Object3D) => void};
type Part = {matrix: THREE.Matrix4; actor?: Actor};
type Batch = {geometry: THREE.BufferGeometry; material: THREE.Material; parts: Part[]; mesh?: THREE.InstancedMesh};

/** Small roadside stories, drawn in shared batches. All motion reads the same
 * paused/reduced-motion clock as the snow and windows. Nothing enters the road. */
export class FrostlineHolidayLife {
  readonly root = new THREE.Group();
  readonly sites: {name: string; progress: number; radius: number; clearance: number}[] = [];
  readonly actors: Actor[] = [];
  private readonly batches = new Map<string, Batch>();
  private readonly geometry = {
    box: new THREE.BoxGeometry(1,1,1), ball: new THREE.IcosahedronGeometry(1,1),
    cone: new THREE.ConeGeometry(1,1,12), disc:new THREE.CircleGeometry(1,24), ring: new THREE.TorusGeometry(1,.04,4,64),
  };
  private readonly palette: Record<ColorName, THREE.Material>;
  private readonly scratch = new THREE.Object3D();
  private readonly world = new THREE.Matrix4();
  private readonly composed = new THREE.Matrix4();
  private readonly steamTime = {value: 0};
  private readonly steamSources: THREE.Vector3[] = [];
  private lastTime = NaN;

  constructor(private readonly course: FrostlineCourse) {
    this.root.name='frostline_holiday_life';
    const matte=(color:number)=>new THREE.MeshLambertMaterial({color});
    this.palette={
      snow:matte(0xe1efff),wood:matte(0x755041),red:matte(0xbc354c),green:matte(0x387966),
      gold:matte(0xe6b95f),skin:matte(0xdcb28b),dark:matte(0x243246),
      light:new THREE.MeshBasicMaterial({color:0xffd79a,toneMapped:false}),
      glow:new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
        vertexShader:'varying vec2 glowUv;void main(){glowUv=uv;vec4 p=vec4(position,1.);\n#ifdef USE_INSTANCING\np=instanceMatrix*p;\n#endif\ngl_Position=projectionMatrix*modelViewMatrix*p;}',
        fragmentShader:'varying vec2 glowUv;void main(){float a=pow(max(0.,1.-length(glowUv-.5)*2.),2.);gl_FragColor=vec4(1.,.48,.12,a*.24);}'}),
      ice:new THREE.MeshPhongMaterial({color:0x94cbd9,shininess:90,specular:0xc8e8ec}),
    };
    this.populateVillage();
    this.buildCocoaStops();
    this.buildRink();
    this.buildTrain();
    this.buildSleighs();
    this.buildSteam();
    for(const batch of this.batches.values()){
      const mesh=new THREE.InstancedMesh(batch.geometry,batch.material,batch.parts.length);
      mesh.castShadow=batch.material!==this.palette.light&&batch.material!==this.palette.glow;mesh.receiveShadow=true;
      mesh.instanceMatrix.setUsage(batch.parts.some(part=>part.actor)?THREE.DynamicDrawUsage:THREE.StaticDrawUsage);
      batch.mesh=mesh;this.root.add(mesh);
    }
    this.update(0);
    // Bounds include a generous margin for the small closed animation paths.
    for(const batch of this.batches.values()){batch.mesh!.computeBoundingSphere();batch.mesh!.boundingSphere!.radius+=18;}
  }

  private anchor(progress:number,lateral:number):THREE.Matrix4 {
    const s=this.course.sample(progress),p=s.position.clone().addScaledVector(s.right,lateral);
    const q=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(s.right,UP,s.tangent.clone().negate()));
    return new THREE.Matrix4().compose(p,q,new THREE.Vector3(1,1,1));
  }

  private site(name:string,progress:number,lateral:number,radius:number):THREE.Matrix4|null {
    const anchor=this.anchor(progress,lateral),position=new THREE.Vector3().setFromMatrixPosition(anchor);
    let clearance=Infinity;
    // Full route, not only the nearest sampled station: protect neighbouring bends.
    for(let i=0;i<this.course.points.length;i++){
      const a=this.course.points[i],b=this.course.points[(i+1)%this.course.points.length];
      const dx=b.x-a.x,dz=b.z-a.z,t=THREE.MathUtils.clamp(((position.x-a.x)*dx+(position.z-a.z)*dz)/(dx*dx+dz*dz),0,1);
      clearance=Math.min(clearance,Math.hypot(position.x-a.x-t*dx,position.z-a.z-t*dz));
    }
    if(clearance<radius+15)return null;
    this.sites.push({name,progress,radius,clearance});return anchor;
  }

  private actor(anchor:THREE.Matrix4,animate:Actor['animate']):Actor {
    const actor={anchor,pose:new THREE.Object3D(),animate};this.actors.push(actor);return actor;
  }

  private part(anchor:THREE.Matrix4,shape:Shape,color:ColorName,x:number,y:number,z:number,sx:number,sy:number,sz:number,actor?:Actor,rx=0,ry=0,rz=0):void {
    this.scratch.position.set(x,y,z);this.scratch.rotation.set(rx,ry,rz);this.scratch.scale.set(sx,sy,sz);this.scratch.updateMatrix();
    const matrix=actor?this.scratch.matrix.clone():new THREE.Matrix4().multiplyMatrices(anchor,this.scratch.matrix);
    const key=shape+color;let batch=this.batches.get(key);
    if(!batch){batch={geometry:this.geometry[shape],material:this.palette[color],parts:[]};this.batches.set(key,batch);}
    batch.parts.push({matrix,actor});
  }

  private resident(anchor:THREE.Matrix4,x:number,z:number,index:number,skating=false):void {
    const color:ColorName=index%2?'red':'green',phase=index*1.71;
    const body=this.actor(anchor,(time,pose)=>{
      const angle=time*.27+phase;
      pose.position.set(skating?Math.cos(angle)*6.8:x,skating?.19:.04*Math.sin(time*1.3+phase),skating?Math.sin(angle)*4.7:z);
      pose.rotation.y=skating?-angle:Math.sin(phase)*.5;
      pose.rotation.z=skating?Math.sin(angle)*.09:0;
    });
    this.part(anchor,'box',color,0,1.3,0,.72,.95,.48,body);
    this.part(anchor,'ball','skin',0,2.07,0,.3,.34,.3,body);
    this.part(anchor,'ball',color,0,2.32,0,.34,.25,.34,body);
    this.part(anchor,'ball','snow',0,2.6,0,.13,.13,.13,body);
    this.part(anchor,'box','gold',0,1.78,.02,.78,.13,.55,body);
    this.part(anchor,'box','gold',.24,1.53,.28,.14,.48,.09,body);
    for(const side of [-1,1]){
      this.part(anchor,'box','dark',side*.2,.53,0,.23,.7,.3,body,skating?side*.2:0);
      this.part(anchor,'box','dark',side*.2,.16,.1,.29,.2,.5,body);
      this.part(anchor,'ball','dark',side*.1,2.11,.277,.034,.039,.035,body);
      if(skating)this.part(anchor,'box','gold',side*.2,.035,.12,.05,.08,.66,body);
    }
    this.part(anchor,'box','red',0,1.97,.286,.13,.035,.025,body);
    this.part(anchor,'box',color,-.49,1.25,0,.23,.7,.3,body,0,0,-.2);
    const arm=this.actor(anchor,(time,pose)=>{
      body.animate(time,body.pose);body.pose.updateMatrix();
      pose.position.set(.45,1.65,0).applyMatrix4(body.pose.matrix);
      pose.rotation.set(0,body.pose.rotation.y,skating?-.95:-2.15+Math.sin(time*2+phase)*.3);
    });
    this.part(anchor,'box',color,0,-.3,0,.23,.6,.28,arm);
    this.part(anchor,'ball','skin',0,-.66,0,.14,.15,.14,arm);
  }

  private snowman(anchor:THREE.Matrix4,x:number,z:number,scale=1):void {
    for(const [y,r] of [[.7,.73],[1.55,.52],[2.22,.36]])this.part(anchor,'ball','snow',x,y*scale,z,r*scale,r*scale,r*scale);
    this.part(anchor,'box','red',x,1.92*scale,z,.85*scale,.16*scale,.74*scale);
    this.part(anchor,'box','red',x+.25*scale,1.65*scale,z+.42*scale,.18*scale,.6*scale,.1*scale);
    this.part(anchor,'box','dark',x,2.59*scale,z,.86*scale,.1*scale,.73*scale);
    this.part(anchor,'box','dark',x,2.83*scale,z,.53*scale,.45*scale,.48*scale);
    for(const side of [-1,1]){
      this.part(anchor,'ball','dark',x+side*.13*scale,2.27*scale,z+.32*scale,.05*scale,.05*scale,.05*scale);
      this.part(anchor,'box','wood',x+side*.7*scale,1.67*scale,z,.8*scale,.09*scale,.1*scale,undefined,0,0,side*.35);
    }
    this.part(anchor,'cone','gold',x,2.16*scale,z+.48*scale,.09*scale,.4*scale,.09*scale,undefined,Math.PI/2);
    for(const y of [1.1,1.45,1.7])this.part(anchor,'ball','dark',x,y*scale,z+.5*scale,.05*scale,.05*scale,.05*scale);
  }

  private populateVillage():void {
    for(const [index,p] of [.012,.039,.069,.098,.167,.208,.29,.38,.427,.49,.57,.612,.735,.805,.857,.91,.965].entries()){
      const side=index%2?1:-1,anchor=this.site('village gathering',p,side*19.7,3.4);if(!anchor)continue;
      this.resident(anchor,0,0,index);this.resident(anchor,1.9,-1,index+1);
      if(index%2===0){this.snowman(anchor,-1.8,-2);this.snowman(anchor,-.4,-2.8,.63);}
      for(let i=0;i<9;i++)this.part(anchor,'box','ice',.6+(i%2)*.3,.012,2+i*.4,.17,.015,.28);
      this.part(anchor,'box','wood',-2,.7,2,1.7,.15,1.1);
      for(const x of [-2.6,-1.4])this.part(anchor,'box','wood',x,.35,2,.12,.7,.8);
      this.part(anchor,'box','red',-2,.92,2,.8,.3,.65);
      this.part(anchor,'box','gold',-2,1.085,2,.09,.04,.7);
    }
  }

  private buildCocoaStops():void {
    for(const [index,p] of [.055,.246,.412,.588,.768,.895].entries()){
      const anchor=this.site('cocoa cart',p,(index%2?1:-1)*20.5,4.2);if(!anchor)continue;
      this.part(anchor,'disc','glow',0,.04,1,6,6,1,undefined,-Math.PI/2);
      this.part(anchor,'box','wood',0,1.1,0,3.8,1.5,2);
      this.part(anchor,'box','gold',0,1.94,0,4.1,.15,2.2);
      for(const x of [-1.8,1.8])this.part(anchor,'box','wood',x,2.8,0,.13,2.2,.13);
      for(let i=0;i<8;i++)this.part(anchor,'box',i%2?'snow':'red',-1.84+i*.525,4,0,.53,.25,2.9,undefined,0,0,0);
      this.part(anchor,'box','snow',0,4.2,0,4.35,.16,3);
      for(const x of [-1.6,1.6]){this.part(anchor,'ball','dark',x,.38,.72,.45,.45,.16);this.part(anchor,'ball','light',x,3.55,.85,.15,.23,.15);}
      for(let j=0;j<4;j++){this.part(anchor,'box','snow',-.9+j*.55,2.15,.3,.23,.33,.23);this.part(anchor,'ball','wood',-.9+j*.55,2.33,.3,.095,.025,.095);}
      this.steamSources.push(new THREE.Vector3(0,2.4,.3).applyMatrix4(anchor));
      this.resident(anchor,.4,-1.3,index+40);
      this.sign(anchor,'COCOA & COOKIES',0,3.22,1.53,3.5);
      this.part(anchor,'box','green',2.8,.55,.4,.85,1.1,.85);this.part(anchor,'box','gold',2.8,1.13,.4,.15,.08,.95);
    }
  }

  private buildRink():void {
    const anchor=this.site('lantern skating pond',.666,-34,13.5);if(!anchor)return;
    this.part(anchor,'ball','snow',0,-.45,0,13.5,.5,10);
    this.part(anchor,'ball','ice',0,.08,0,12,.12,8.7);
    for(let i=0;i<40;i++){
      const angle=i/40*Math.PI*2,x=Math.cos(angle)*12.5,z=Math.sin(angle)*9.2;
      this.part(anchor,'box','wood',x,.75,z,.15,1.5,.15);
      this.part(anchor,'ball','light',x,1.6,z,.13,.18,.13);
      if(i%5===0)this.part(anchor,'disc','glow',x,.075,z,2.7,2.7,1,undefined,-Math.PI/2);
    }
    for(const radius of [5,7,9])this.part(anchor,'ring','snow',0,.22,0,radius,radius*.68,1,undefined,-Math.PI/2);
    for(let i=0;i<5;i++)this.resident(anchor,0,0,i+70,true);
    this.snowman(anchor,-10,2,1.1);
    this.sign(anchor,'LANTERN POND',9,3.1,2,5.3);
  }

  private buildTrain():void {
    const anchor=this.site('gift express',.365,32,12);if(!anchor)return;
    this.part(anchor,'ball','snow',0,-.3,0,13,.5,10);
    for(const radius of [8.4,9.5])this.part(anchor,'ring','gold',0,.16,0,radius,radius*.73,1,undefined,-Math.PI/2);
    for(let i=0;i<56;i++){
      const a=i/56*Math.PI*2;this.part(anchor,'box','wood',Math.cos(a)*9,.11,Math.sin(a)*6.55,1.5,.12,.18,undefined,0,-a,0);
    }
    for(let car=0;car<4;car++){
      const actor=this.actor(anchor,(time,pose)=>{const angle=time*.17-car*.37;pose.position.set(Math.cos(angle)*9,0,Math.sin(angle)*6.55);pose.rotation.y=-Math.atan2(6.55*Math.cos(angle),-9*Math.sin(angle));});
      this.part(anchor,'box',car?'green':'red',0,.7,0,2.4,1,1.5,actor);
      for(const x of [-.75,.75])for(const z of [-.8,.8])this.part(anchor,'ball','dark',x,.35,z,.33,.33,.15,actor);
      if(car===0){
        this.part(anchor,'box','red',-.5,1.6,0,1.1,1.2,1.35,actor);this.part(anchor,'box','snow',-.5,2.28,0,1.4,.2,1.65,actor);
        this.part(anchor,'box','light',-.5,1.75,.7,.65,.55,.035,actor);this.part(anchor,'box','dark',.65,1.75,0,.35,1,.35,actor);
        this.part(anchor,'ball','light',1.25,.95,0,.14,.14,.14,actor);
      }else for(let j=0;j<3;j++){
        const x=-.7+j*.65;this.part(anchor,'box',j%2?'red':'gold',x,1.5,0,.57,.75,.8,actor);
        this.part(anchor,'box','snow',x,1.9,0,.12,.07,.83,actor);
      }
    }
    this.snowman(anchor,0,0,1.4);
    this.sign(anchor,'GIFT EXPRESS',-9,3.3,1,5);
    for(let i=0;i<9;i++){const a=i/9*Math.PI*2;this.part(anchor,'ball','light',Math.cos(a)*3.5,.4,Math.sin(a)*3.5,.18,.18,.18);}
  }

  private buildSleighs():void {
    for(const [index,p] of [.12,.32,.535,.825,.94].entries()){
      const anchor=this.site('gift sleigh',p,(index%2?1:-1)*20.5,4.4);if(!anchor)continue;
      for(const z of [-.8,.8])this.part(anchor,'box','gold',0,.24,z,4.4,.15,.12);
      this.part(anchor,'box','red',0,.8,0,3.2,.7,1.6);this.part(anchor,'box','red',-1.5,1.45,0,.2,1.3,1.7);
      for(let i=0;i<6;i++){const x=-.8+(i%3)*.8,z=(i<3?-.4:.4);this.part(anchor,'box',i%2?'green':'gold',x,1.45,z,.65,.7,.65);this.part(anchor,'box','snow',x,1.81,z,.1,.06,.7);}
      this.resident(anchor,2.4,1,index+90);
    }
  }

  private sign(anchor:THREE.Matrix4,label:string,x:number,y:number,z:number,width:number):void {
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;
    const context=canvas.getContext('2d')!;context.fillStyle='#203e39';context.fillRect(0,0,512,128);
    context.strokeStyle='#e8c98c';context.lineWidth=5;context.strokeRect(7,7,498,114);
    context.fillStyle='#ffe5b3';context.textAlign='center';context.textBaseline='middle';context.font='bold 40px Georgia';context.fillText(label,256,67,478);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    const sign=new THREE.Mesh(new THREE.PlaneGeometry(width,width/4),new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide}));
    this.scratch.position.set(x,y,z);this.scratch.rotation.set(0,0,0);this.scratch.scale.set(1,1,1);this.scratch.updateMatrix();
    sign.applyMatrix4(new THREE.Matrix4().multiplyMatrices(anchor,this.scratch.matrix));this.root.add(sign);
    this.part(anchor,'box','snow',x,y+width/8+.09,z,width+.15,.15,.22);
    if(label!=='COCOA & COOKIES')this.part(anchor,'box','wood',x,y/2,z-.1,.17,y,.17);
  }

  private buildSteam():void {
    const positions:number[]=[],phases:number[]=[];
    for(const source of this.steamSources)for(let i=0;i<9;i++){positions.push(source.x,source.y,source.z);phases.push(i/9);}
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('phase',new THREE.Float32BufferAttribute(phases,1));
    const material=new THREE.ShaderMaterial({uniforms:{time:this.steamTime},transparent:true,depthWrite:false,
      vertexShader:'uniform float time;attribute float phase;varying float alpha;void main(){float a=fract(phase+time*.22);vec3 p=position+vec3(sin(a*4.+position.x)*a*.4,a*2.6,0.);vec4 v=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*v;gl_PointSize=clamp((12.+a*18.)*55./-v.z,1.,19.);alpha=sin(a*3.14159)*.23;}',
      fragmentShader:'varying float alpha;void main(){float r=length(gl_PointCoord-.5)*2.;gl_FragColor=vec4(1.,.92,.79,alpha*(1.-smoothstep(.1,1.,r)));}'});
    const steam=new THREE.Points(geometry,material);steam.frustumCulled=false;this.root.add(steam);
  }

  update(time:number):void {
    if(time===this.lastTime)return;this.lastTime=time;this.steamTime.value=time;
    for(const actor of this.actors){actor.animate(time,actor.pose);actor.pose.updateMatrix();}
    for(const batch of this.batches.values()){
      let changed=false;
      for(const [index,part] of batch.parts.entries()){
        if(part.actor){this.world.multiplyMatrices(part.actor.anchor,part.actor.pose.matrix);this.composed.multiplyMatrices(this.world,part.matrix);batch.mesh!.setMatrixAt(index,this.composed);changed=true;}
        else if(time===0||Number.isNaN(time))batch.mesh!.setMatrixAt(index,part.matrix);
      }
      // Static transforms are installed on construction (time = 0).
      if(changed||time===0)batch.mesh!.instanceMatrix.needsUpdate=true;
    }
  }
}
