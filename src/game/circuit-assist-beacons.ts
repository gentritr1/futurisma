import * as THREE from 'three';
import type {RaceCourse} from './course';
import type {PickupDefinition, PickupAppearance} from './power-pickup-field';

/** Painted light markers make airborne devices readable against a busy road.
 * Circle = grip, hexagon = charge; spent sockets stay dim until the next lap. */
export class CircuitAssistBeacons {
  readonly root = new THREE.Group();
  private readonly grip: THREE.InstancedMesh;
  private readonly charge: THREE.InstancedMesh;
  private readonly arrows: THREE.InstancedMesh;
  private readonly material = new THREE.MeshBasicMaterial({
    color:0xffffff, transparent:true, opacity:.82, depthWrite:false,
    polygonOffset:true, polygonOffsetFactor:-2, toneMapped:false,
  });
  private readonly anchors: THREE.Object3D[] = [];
  private readonly placement = new THREE.Object3D();
  private readonly color = new THREE.Color();
  private readonly cyan = new THREE.Color(0x6ce9f4);
  private readonly amber = new THREE.Color(0xffbc69);

  constructor(private readonly course:RaceCourse, private readonly definitions:readonly PickupDefinition[]) {
    this.root.name='assist_road_beacons';
    const arrowPositions:number[]=[];
    for(const y of [-3.3,-5.6]){
      for(const sign of [-1,1]){
        const a=[0,y+.7,0],b=[sign*.82,y-.1,0],c=[sign*.82,y-.45,0],d=[0,y+.35,0];
        for(const point of sign>0?[a,c,b,a,d,c]:[a,b,c,a,c,d])arrowPositions.push(...point);
      }
    }
    const arrowGeometry=new THREE.BufferGeometry();
    arrowGeometry.setAttribute('position',new THREE.Float32BufferAttribute(arrowPositions,3));
    this.grip=new THREE.InstancedMesh(new THREE.RingGeometry(1.53,1.65,40),this.material,definitions.length);
    this.charge=new THREE.InstancedMesh(new THREE.RingGeometry(1.53,1.65,6),this.material,definitions.length);
    this.arrows=new THREE.InstancedMesh(arrowGeometry,this.material,definitions.length);
    for(const mesh of [this.grip,this.charge,this.arrows]){
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;this.root.add(mesh);
    }
    for(const definition of definitions){
      const sample=course.sample(definition.progress),anchor=new THREE.Object3D();
      anchor.position.copy(sample.position).addScaledVector(sample.right,definition.lateral).addScaledVector(sample.up,.045);
      anchor.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(sample.right,sample.tangent,sample.up));
      this.anchors.push(anchor);
    }
  }

  update(elapsed:number,reducedMotion:boolean,states:readonly PickupAppearance[],progress:number){
    const time=reducedMotion?0:elapsed;
    this.definitions.forEach((definition,index)=>{
      const available=states[index].available;
      const distance=Math.abs(((definition.progress-progress+1.5)%1)-.5)*this.course.length;
      const visible=distance<270;
      const pulse=available ? .92+.08*Math.sin(time*2+index) : .12;
      this.color.copy(definition.kind==='shield'?this.cyan:this.amber).multiplyScalar(pulse);
      this.placement.position.copy(this.anchors[index].position);
      this.placement.quaternion.copy(this.anchors[index].quaternion);
      for(const [mesh,enabled] of [[this.grip,definition.kind==='shield'],[this.charge,definition.kind==='surge'],[this.arrows,available]] as const){
        this.placement.scale.setScalar(visible&&enabled?1:0);this.placement.updateMatrix();
        mesh.setMatrixAt(index,this.placement.matrix);mesh.setColorAt(index,this.color);
      }
    });
    for(const mesh of [this.grip,this.charge,this.arrows]){
      mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
    }
  }
  dispose(){
    this.root.removeFromParent();
    for(const mesh of [this.grip,this.charge,this.arrows]){mesh.geometry.dispose();mesh.dispose();}
    this.material.dispose();this.root.clear();
  }
}
