import * as THREE from 'three';
import type {AfterglowCourse} from './afterglow-course';

const UP=new THREE.Vector3(0,1,0);
const FACE=new THREE.Vector3(0,0,1);
/** One beam, one road warning, and a small smoke plume. All are reused. */
export class RelayEffects {
  readonly root=new THREE.Group();
  private readonly beam:THREE.Mesh;
  private readonly core:THREE.Mesh;
  private readonly marker:THREE.Mesh;
  private readonly ring:THREE.Mesh;
  private readonly smoke:THREE.Points;
  private readonly source=new THREE.Vector3();
  private readonly target=new THREE.Vector3();
  private readonly direction=new THREE.Vector3();
  private readonly time={value:0};
  private markerProgress=-1;
  private markerLane=100;
  constructor(private readonly course:AfterglowCourse,private readonly heads:THREE.Object3D[]){
    const glow=new THREE.MeshBasicMaterial({color:0xff9561,transparent:true,opacity:.24,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false});
    this.beam=new THREE.Mesh(new THREE.CylinderGeometry(1,1,1,12),glow);
    this.core=new THREE.Mesh(new THREE.CylinderGeometry(1,1,1,8),new THREE.MeshBasicMaterial({color:0xfff2cd,transparent:true,opacity:.88,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false}));
    const warning=new THREE.ShaderMaterial({uniforms:{time:this.time,live:{value:0}},transparent:true,depthWrite:false,side:THREE.DoubleSide,
      vertexShader:'varying vec2 coords;void main(){coords=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader:'uniform float time;uniform float live;varying vec2 coords;void main(){float edge=step(.92,abs(coords.x-.5)*2.);float bars=step(.62,fract(coords.y*18.+coords.x*2.));float end=smoothstep(0.,.04,coords.y)*smoothstep(0.,.04,1.-coords.y);float pulse=.7+.3*sin(time*7.);gl_FragColor=vec4(mix(vec3(1.,.52,.14),vec3(1.,.25,.1),live),end*(.13+edge*.65+bars*.16)*pulse);}'
    });
    this.marker=new THREE.Mesh(new THREE.PlaneGeometry(7.6,104,1,24),warning);
    this.ring=new THREE.Mesh(new THREE.RingGeometry(4.8,5.3,40),glow.clone());
    const positions=new Float32Array(36*3),phases=new Float32Array(36);
    for(let i=0;i<36;i++)phases[i]=i/36;
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('phase',new THREE.BufferAttribute(phases,1));
    this.smoke=new THREE.Points(geometry,new THREE.ShaderMaterial({uniforms:{time:this.time,damage:{value:0}},transparent:true,depthWrite:false,
      vertexShader:'uniform float time;uniform float damage;attribute float phase;varying float alpha;void main(){float age=fract(phase+time*.35);vec3 p=position+vec3(sin(phase*49.)*age,age*5.,sin(phase*23.)*age);vec4 v=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*v;gl_PointSize=clamp((12.+age*25.)*45./-v.z,1.,42.);alpha=sin(age*3.14159)*damage*.55;}',
      fragmentShader:'varying float alpha;void main(){float r=length(gl_PointCoord-.5)*2.;gl_FragColor=vec4(.2,.23,.26,alpha*(1.-smoothstep(.2,1.,r)));}'
    }));this.smoke.frustumCulled=false;
    this.root.name='relay_attack_effects';this.root.add(this.beam,this.core,this.marker,this.ring,this.smoke);
  }
  update(){
    const attack=this.course.relay;this.time.value=this.course.visualTime;
    const live=attack.phase==='strike',sky=attack.phase==='sky';
    this.marker.visible=live||attack.phase==='mark';this.ring.visible=live;
    this.beam.visible=this.core.visible=live||sky;
    const sample=this.course.sample(attack.targetProgress);
    this.target.copy(sample.position).addScaledVector(sample.right,attack.targetLateral).addScaledVector(sample.up,.16);
    if(this.markerProgress!==attack.targetProgress||this.markerLane!==attack.targetLateral){
      const positions=this.marker.geometry.attributes.position;
      for(let row=0;row<=24;row++)for(let side=0;side<2;side++){
        const point=this.course.sample(attack.targetProgress+(row/24-.5)*104/this.course.length);
        const p=point.position.addScaledVector(point.right,attack.targetLateral+(side?1:-1)*3.8).addScaledVector(point.up,.18);
        positions.setXYZ(row*2+side,p.x,p.y,p.z);
      }
      positions.needsUpdate=true;this.marker.geometry.computeBoundingSphere();
      this.markerProgress=attack.targetProgress;this.markerLane=attack.targetLateral;
    }
    (this.marker.material as THREE.ShaderMaterial).uniforms.live.value=live?1:0;
    this.ring.position.copy(this.target);this.ring.quaternion.setFromUnitVectors(FACE,sample.up);
    this.ring.scale.setScalar(1+Math.sin(this.time.value*4)*.12);
    if(sky||live){
      const head=this.heads[(attack.volley-1)%this.heads.length];head.updateWorldMatrix(true,false);
      this.source.set(0,27,0);head.localToWorld(this.source);
      if(sky)this.target.copy(this.course.sample(attack.playerProgress+.09).position).addScaledVector(UP,85);
      else this.source.copy(this.target).addScaledVector(UP,220);
      this.direction.subVectors(this.target,this.source);const length=this.direction.length();this.direction.normalize();
      for(const [mesh,width] of [[this.beam,live?3.2:1.8],[this.core,live?.85:.5]] as const){
        mesh.position.copy(this.source).add(this.target).multiplyScalar(.5);mesh.quaternion.setFromUnitVectors(UP,this.direction);mesh.scale.set(width,length,width);
      }
    }
    this.smoke.position.copy(this.course.relayCraftPosition).addScaledVector(UP,1);
    (this.smoke.material as THREE.ShaderMaterial).uniforms.damage.value=(100-attack.integrity)/72;
    this.smoke.visible=attack.integrity<100;
  }
}
