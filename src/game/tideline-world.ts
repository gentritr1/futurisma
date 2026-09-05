import * as THREE from "three";
import type { TidelineCourse } from "./tideline-course";
import { TIDELINE_ABILITY_CONFIG } from "./tideline-rules.js";
import type { PickupAppearance } from "./power-pickup-field";
import { TidelineCradles } from "./tideline-cradles";
import route from "./data/tideline/route.json";
import { TidelineRoadSignals } from "./tideline-road-signals";
import { TidelineBulkheads } from "./tideline-bulkheads";
import { TidelineSky } from "./tideline-sky";

function paintedBox(width:number,height:number,depth:number,variant=0):THREE.BoxGeometry {
  const geometry=new THREE.BoxGeometry(width,height,depth),uv=geometry.getAttribute("uv");
  for(let i=0;i<uv.count;i++) uv.setXY(i,
    (variant%2)*.5+.012+uv.getX(i)*.476,
    (1-Math.floor(variant/2))*.5+.012+uv.getY(i)*.476);
  return geometry;
}

/** Authored game signals: machines to collect, launch paint, current lanes and fields. */
export class TidelineWorld {
  readonly root = new THREE.Group();
  readonly ready: Promise<void>;
  readonly sky = new TidelineSky();
  readonly devices: TidelineCradles;
  private readonly sluices = new THREE.Group();
  private readonly forkGuards = new THREE.Group();
  readonly signals: TidelineRoadSignals;
  readonly bulkheads: TidelineBulkheads;
  constructor(private readonly course: TidelineCourse) {
    this.root.name = "tideline_gameplay";
    this.devices = new TidelineCradles(course, TIDELINE_ABILITY_CONFIG.pickups);
    this.signals = new TidelineRoadSignals(course);
    this.bulkheads = new TidelineBulkheads(course);
    this.ready = Promise.all([this.devices.ready,this.sky.ready]).then(()=>{});
    this.root.add(this.devices.root, this.sky.root, this.signals.root, this.bulkheads.root, this.sluices, this.forkGuards);
    this.addSign(.035, "P-07", "PELAGIC", "#ccb67a");
    this.addSign(.31, "P-08", "PUMP HALL", "#ccb67a");
    this.addSign(.59, "P-09", "LOCK WORKS", "#ccb67a");
    const gateTexture = typeof Image === "undefined" ? null : new THREE.TextureLoader().load("/assets/tideline-foundry/textures/metal.jpg");
    if(gateTexture) gateTexture.colorSpace=THREE.SRGBColorSpace;
    // Both doors sit in the separated hall, away from either shared mouth.
    for(const progress of [.125, .175]) {
      const sample=course.sampleShortcut(progress);
      const gate=new THREE.Mesh(paintedBox(route.shortcut.width,6.5,.45),
        new THREE.MeshLambertMaterial({color:0xe0dfcc,map:gateTexture}));
      gate.position.copy(sample.position).addScaledVector(sample.up,3.25);
      gate.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(sample.right,sample.up,sample.tangent.clone().negate()));
      gate.userData.baseHeight=gate.position.y;gate.name="pump_hall_sluice";this.sluices.add(gate);
    }
    // Retractable walls show the closed road boundary at both shared mouths.
    // They lower before the lap-three craft reaches the fork.
    const guardMatrices:THREE.Matrix4[][]=[[],[],[]];
    const guardPose=new THREE.Object3D();
    let guardIndex=0;
    for(const [from,to] of [[.035,.125],[.18,.29]]) {
      for(let progress=from;progress<to;progress+=4/course.length) {
        const s=course.sample(progress);
        guardPose.position.copy(s.position).addScaledVector(s.right,s.halfWidth+.4).addScaledVector(s.up,.7);
        guardPose.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(s.right,s.up,s.tangent.clone().negate()));
        guardPose.updateMatrix();guardMatrices[guardIndex++%3].push(guardPose.matrix.clone());
      }
    }
    const guardMaterial=new THREE.MeshLambertMaterial({color:0xe0dfcc,map:gateTexture});
    for(let variant=0;variant<3;variant++) {
      const guard=new THREE.InstancedMesh(paintedBox(.3,1.4,4.1,variant),guardMaterial,guardMatrices[variant].length);
      guardMatrices[variant].forEach((matrix,index)=>guard.setMatrixAt(index,matrix));
      guard.name="pump_hall_mouth_guard";guard.computeBoundingSphere();this.forkGuards.add(guard);
    }
  }
  update(elapsed: number, reduced: boolean, pickups: readonly PickupAppearance[], progress: number, seed: number, lap: number, readySurge = false, surge = false): void {
    this.devices.update(elapsed, reduced, pickups, progress);
    this.signals.update(elapsed, reduced, progress, seed, lap, readySurge, surge);
    this.bulkheads.update(elapsed, reduced, progress);
    const lift = lap >= 3 ? Math.min(1, this.course.tide.elapsed / 5) * 15 : 0;
    for(const gate of this.sluices.children) gate.position.y=gate.userData.baseHeight+lift;
    const guardDrop=lap>=3?Math.min(1,this.course.tide.elapsed/2)*3:0;
    this.forkGuards.position.y=guardDrop>0?-guardDrop:0;
  }
  dispose(): void { this.devices.dispose(); }

  private addSign(progress: number, title: string, subtitle: string, color: string): void {
    const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 128;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#0a202a"; context.fillRect(0, 0, 512, 128);
    context.strokeStyle = color; context.lineWidth = 3; context.strokeRect(3, 3, 506, 122);
    context.textAlign = "center"; context.fillStyle = color; context.font = "bold 28px monospace"; context.fillText(title, 256, 55);
    context.fillStyle = "#d2e4df"; context.font = "18px monospace"; context.fillText(subtitle, 256, 96);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.4, .6), new THREE.MeshLambertMaterial({ map: texture, emissive: 0x697965, emissiveIntensity: .35, side: THREE.DoubleSide }));
    const sample = this.course.sample(progress);
    mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(sample.right, sample.up, sample.tangent.clone().negate()));
    mesh.position.copy(sample.position).addScaledVector(sample.up, 2.2).addScaledVector(sample.right, sample.halfWidth + 1.5);
    mesh.userData.maximumLetterHeight = .14;
    this.root.add(mesh);
  }
}
