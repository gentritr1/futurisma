import * as THREE from "three";
import { PolarityCourse, POLARITY_BARRIERS } from "./polarity-course";
import { PowerPickupField, type PickupAppearance } from "./power-pickup-field";

export type PowerKind = "surge" | "shield";
export { POLARITY_PICKUPS as POWER_PICKUPS } from "./polarity-simulation.js";
import { POLARITY_PICKUPS as POWER_PICKUPS, POLARITY_ABILITY_CONFIG } from "./polarity-simulation.js";

export class PolarityWorld {
  readonly root = new THREE.Group();
  readonly ready: Promise<void>;
  private readonly devices: PowerPickupField;
  private readonly transform = new THREE.Object3D();
  private readonly basis = new THREE.Matrix4();
  private readonly back = new THREE.Vector3();
  private readonly sample;

  constructor(private readonly course: PolarityCourse) {
    this.root.name = "polarity_gameplay_markers";
    this.sample = course.createSampleScratch();
    this.devices = new PowerPickupField(POWER_PICKUPS, course.length,
      pickup => course.sampleLane(pickup.progress, pickup.lane, this.sample));
    this.root.add(this.devices.root);
    this.ready = this.devices.ready;
    this.addBarriers();
    this.addLaunchStrips();
    for (const progress of [.055, .57]) {
      this.addSign(progress, 0, "SPACE / UPPER EXPRESS", "SHORTER LINE  /  LOWER RECHARGE", "#79deeb");
    }
    for (const progress of [.445, .95]) {
      this.addSign(progress, 1, "SPACE / POWER LINE", "WIDER ROAD  /  CHARGED CAPSULES", "#efba7c");
    }
    this.addSign(.014, 0, "E / DEPLOY DEVICE", "SURGE TURBINE  +  PHASE PROJECTOR", "#c6b0e9");
  }

  update(elapsed: number, reducedMotion: boolean, collectedLaps: readonly number[], lap: number,
    states?: readonly PickupAppearance[], progress = 0): void {
    const appearances = states ?? POWER_PICKUPS.map((pickup, index) => ({
      kind: pickup.kind, available: collectedLaps[index] !== lap, charge: 1,
    }));
    this.devices.update(elapsed, reducedMotion, appearances, progress);
  }

  dispose(): void { this.devices.dispose(); }

  private addLaunchStrips(): void {
    for (const zone of POLARITY_ABILITY_CONFIG.launchZones) {
      const vertices: number[] = [];
      for (let progress = zone.from; progress < zone.to; progress += .0025) {
        const a = this.course.sampleLane(progress, zone.lane, this.course.createSampleScratch());
        const b = this.course.sampleLane(Math.min(zone.to, progress + .0012), zone.lane, this.course.createSampleScratch());
        const points = [a.position.clone().addScaledVector(a.right, -4).addScaledVector(a.up, .08),
          a.position.clone().addScaledVector(a.right, 4).addScaledVector(a.up, .08),
          b.position.clone().addScaledVector(b.right, -4).addScaledVector(b.up, .08),
          b.position.clone().addScaledVector(b.right, 4).addScaledVector(b.up, .08)];
        for (const i of [0, 2, 1, 1, 2, 3]) vertices.push(...points[i]);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
      this.root.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0xd0e798,
        transparent: true, opacity: .4, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })));
      this.addSign(zone.from - .012, zone.lane, "E / LAUNCH WINDOW", "TIME SURGE FOR +1 SECOND", "#d0e798");
    }
  }

  private addBarriers(): void {
    const fields = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xff965c, transparent: true, opacity: .22,
        depthWrite: false, toneMapped: false }), POLARITY_BARRIERS.length);
    const edges = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffbd78, toneMapped: false }), POLARITY_BARRIERS.length * 3);
    POLARITY_BARRIERS.forEach((barrier, i) => {
      const s = this.course.sampleLane(barrier.progress, barrier.lane, this.sample);
      this.basis.makeBasis(s.right, s.up, this.back.copy(s.tangent).negate());
      this.transform.quaternion.setFromRotationMatrix(this.basis);
      this.transform.position.copy(s.position).addScaledVector(s.right, barrier.lateral).addScaledVector(s.up, 1.85);
      this.transform.scale.set(barrier.halfWidth * 2, 3.7, .4);
      this.transform.updateMatrix(); fields.setMatrixAt(i, this.transform.matrix);
      for (let part = 0; part < 3; part++) {
        this.transform.position.copy(s.position).addScaledVector(s.right, barrier.lateral);
        this.transform.position.addScaledVector(s.up, part === 2 ? 3.7 : 1.85);
        if (part !== 2) this.transform.position.addScaledVector(s.right, (part ? 1 : -1) * barrier.halfWidth);
        this.transform.scale.set(part === 2 ? barrier.halfWidth * 2 : .12, part === 2 ? .12 : 3.7, .15);
        this.transform.updateMatrix(); edges.setMatrixAt(i * 3 + part, this.transform.matrix);
      }
      this.addSign(barrier.progress - .016, barrier.lane, "PHASE FIELD", "STEER CLEAR  /  SHIELD THROUGH", "#ffd0a0");
    });
    this.root.add(fields, edges);
  }

  private addSign(progress: number, lane: 0 | 1, title: string, subtitle: string, color: string): void {
    const canvas = document.createElement("canvas");
    canvas.width = 512; canvas.height = 128;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#091821"; context.fillRect(0, 0, 512, 128);
    context.strokeStyle = color; context.lineWidth = 3; context.strokeRect(2, 2, 508, 124);
    context.textAlign = "center"; context.fillStyle = color;
    context.font = "bold 31px monospace"; context.fillText(title, 256, 55);
    context.font = "19px monospace"; context.fillStyle = "#dbe7e8"; context.fillText(subtitle, 256, 97);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, toneMapped: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.25), material);
    const s = this.course.sampleLane(progress, lane, this.sample);
    this.basis.makeBasis(s.right, s.up, this.back.copy(s.tangent).negate());
    mesh.quaternion.setFromRotationMatrix(this.basis);
    mesh.position.copy(s.position).addScaledVector(s.up, 6.5);
    this.root.add(mesh);
  }
}
