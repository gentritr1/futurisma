import * as THREE from 'three';
import type {FrostlineCourse} from './frostline-course';
import {WINTER_PICKUPS} from './frostline-snow';

const UP = new THREE.Vector3(0, 1, 0);

/** Reused lights and a small set of original gyro devices; no per-frame allocation. */
export class FrostlineWinterEffects {
  readonly root = new THREE.Group();
  private readonly pickups: THREE.Group[] = [];
  private readonly cores: THREE.Group[] = [];
  private readonly lanterns = [new THREE.PointLight(0xffc17e, 0, 39, 2), new THREE.PointLight(0xffc17e, 0, 39, 2)];
  private readonly deviceLight = new THREE.PointLight(0x63eaff, 0, 20, 2);
  private readonly projectile: THREE.Mesh;
  private readonly burst: THREE.Points;
  private readonly burstTime = {value: 0};
  private readonly source = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly sample: ReturnType<FrostlineCourse['createSampleScratch']>;

  constructor(private readonly course: FrostlineCourse) {
    this.sample = course.createSampleScratch();
    this.root.name = 'frostline_winter_devices';
    const casing = new THREE.MeshPhongMaterial({color: 0x344f62, shininess: 75, specular: 0x9abcce});
    const snow = new THREE.MeshLambertMaterial({color: 0xe0efff});
    const ring = new THREE.TorusGeometry(1.05, .085, 6, 20);
    const base = new THREE.CylinderGeometry(1.6, 1.9, .24, 16);
    const core = new THREE.OctahedronGeometry(.48);
    for (const pickup of WINTER_PICKUPS) {
      const group = new THREE.Group(), rotor = new THREE.Group();
      const color = pickup.kind === 'stabilizer' ? 0x62e8ff : 0xffb94e;
      const light = new THREE.MeshBasicMaterial({color, toneMapped: false});
      const foot = new THREE.Mesh(base, casing);foot.position.y = .18;group.add(foot);
      const disc = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.52, 24), light);disc.rotation.x = -Math.PI/2;disc.position.y = .32;group.add(disc);
      for (let i = 0; i < 2; i++) {const hoop = new THREE.Mesh(ring, light);hoop.rotation.y = i*Math.PI/2;hoop.rotation.z = .45;rotor.add(hoop);}
      rotor.add(new THREE.Mesh(core, light));rotor.position.y = 1.8;group.add(rotor);
      this.place(group, pickup.progress, pickup.lateral, 0);this.root.add(group);this.pickups.push(group);this.cores.push(rotor);
    }
    for (const [progress, side] of [[.52, 1], [.7, -1]]) {
      const cannon = new THREE.Group();
      const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.5, 2.4, 10), casing);pedestal.position.y = 1.2;cannon.add(pedestal);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(.85, 1.1, 4.2, 12), casing);barrel.position.set(-side*1.1, 3.8, 0);barrel.rotation.z = side*.95;cannon.add(barrel);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(.91,.15,6,16), new THREE.MeshBasicMaterial({color:0xe5b77d}));rim.position.set(-side*2.7,5,0);rim.rotation.y=Math.PI/2;cannon.add(rim);
      for(let i=0;i<5;i++){const ball=new THREE.Mesh(new THREE.IcosahedronGeometry(.65,1),snow);ball.position.set(1+i%2,2.3+Math.floor(i/2)*.6,.5);cannon.add(ball);}
      this.place(cannon,progress,side*19,0);this.root.add(cannon);
    }
    this.projectile = new THREE.Mesh(new THREE.IcosahedronGeometry(.9,2),snow);this.projectile.visible=false;this.root.add(this.projectile);
    const particles:number[]=[];for(let i=0;i<56;i++){const a=i*2.39996,r=.4+(i%7)/7;particles.push(Math.cos(a)*r, .3+(i%9)/9, Math.sin(a)*r);}
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(particles,3));
    this.burst=new THREE.Points(geometry,new THREE.ShaderMaterial({uniforms:{age:this.burstTime},transparent:true,depthWrite:false,
      vertexShader:'uniform float age;varying float alpha;void main(){vec3 p=position*(1.+age*15.);p.y-=age*age*8.;vec4 v=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*v;gl_PointSize=clamp(240./-v.z,2.,9.);alpha=1.-age;}',
      fragmentShader:'varying float alpha;void main(){float r=length(gl_PointCoord-.5)*2.;gl_FragColor=vec4(.88,.96,1.,alpha*(1.-smoothstep(.2,1.,r)));}'}));this.burst.visible=false;this.burst.frustumCulled=false;this.root.add(this.burst);
    this.root.add(...this.lanterns,this.deviceLight);
  }

  private place(object:THREE.Object3D, progress:number, lateral:number, height:number) {
    this.course.sample(progress,this.sample);object.position.copy(this.sample.position).addScaledVector(this.sample.right,lateral).addScaledVector(UP,height);
  }

  update(): void {
    const winter=this.course.winter,time=this.course.visualTime;
    for(let i=0;i<this.pickups.length;i++){
      this.pickups[i].visible=winter.collectedLap[i]!==this.course.lap;
      this.cores[i].rotation.y=time*.8;this.cores[i].position.y=1.8+Math.sin(time*1.7+i)*.18;
    }
    // These match the authored 90-lantern rhythm. Distant lamps remain emissive.
    const nearest=Math.round(this.course.raceProgress*90);
    for(let i=0;i<2;i++){
      const station=nearest+i,progress=station/90,side=station%2?1:-1;
      this.place(this.lanterns[i],progress,side*16.7,6.95);
      this.lanterns[i].intensity=520*Math.exp(-Math.pow((this.course.raceProgress-progress)*this.course.length/25,2));
    }
    const protectedCraft=winter.stabilizerSeconds>0,thermal=winter.thermalSeconds>0;
    this.deviceLight.color.setHex(thermal&&!protectedCraft?0xffb84c:0x62eaff);
    this.deviceLight.position.copy(this.course.craftPosition).addScaledVector(UP,2.7).addScaledVector(this.course.craftForward,-1.8);
    this.deviceLight.intensity=protectedCraft||thermal?130:0;
    if(!protectedCraft&&!thermal){
      for(let i=0;i<WINTER_PICKUPS.length;i++){
        const pickup=WINTER_PICKUPS[i];const distance=Math.abs(((pickup.progress-this.course.raceProgress+1.5)%1)-.5)*this.course.length;
        if(this.pickups[i].visible&&distance<20){this.place(this.deviceLight,pickup.progress,pickup.lateral,2.5);this.deviceLight.color.setHex(pickup.kind==='stabilizer'?0x62eaff:0xffb84c);this.deviceLight.intensity=110*(1-distance/20);break;}
      }
    }
    this.projectile.visible=winter.snowballPhase==='flight';
    this.course.sample(winter.snowballSource,this.sample);this.source.copy(this.sample.position).addScaledVector(this.sample.right,winter.snowballSide*17).addScaledVector(UP,5);
    this.course.sample(winter.snowballTarget,this.sample);this.target.copy(this.sample.position).addScaledVector(this.sample.right,winter.snowballLane).addScaledVector(UP,1);
    if(this.projectile.visible){const flight=1-winter.snowballRemaining/1.1;this.projectile.position.lerpVectors(this.source,this.target,flight);this.projectile.position.y+=Math.sin(flight*Math.PI)*9;this.projectile.rotation.set(time*2,time*3,0);}
    this.burst.visible=winter.snowballPhase==='impact';this.burst.position.copy(this.target);this.burstTime.value=1-winter.snowballRemaining/.4;
  }
}
