import * as THREE from "three";
import type { TidelineCourse } from "./tideline-course";
import { TIDELINE_ABILITY_CONFIG, TIDELINE_FIELDS, currentLane } from "./tideline-rules.js";
import { PowerPickupField, type PickupAppearance } from "./power-pickup-field";
import { TidelineSky } from "./tideline-sky";

/** Authored game signals: machines to collect, launch paint, current lanes and fields. */
export class TidelineWorld {
  readonly root = new THREE.Group();
  readonly ready: Promise<void>;
  readonly sky = new TidelineSky();
  private readonly devices: PowerPickupField;
  private readonly currents = [new THREE.Group(), new THREE.Group()];
  constructor(private readonly course: TidelineCourse) {
    this.root.name = "tideline_gameplay";
    const sample = course.createSampleScratch();
    this.devices = new PowerPickupField(TIDELINE_ABILITY_CONFIG.pickups, course.length,
      pickup => course.sample(pickup.progress, sample));
    this.ready = this.devices.ready;
    this.root.add(this.devices.root, this.sky.root, ...this.currents);
    for (const zone of TIDELINE_ABILITY_CONFIG.launchZones) {
      this.addRibbon(zone.from, zone.to, 0, 8, 0xd0e798, this.root);
      this.addSign(zone.from - .012, "E / LAUNCH WINDOW", "TIME SURGE FOR +1 SECOND", "#d0e798");
    }
    for (let side = 0; side < 2; side++) {
      this.addRibbon(.025, .205, side ? 4 : -4, 2.5, 0x5ed6c3, this.currents[side]);
      this.addRibbon(.94, .995, side ? 4 : -4, 2.5, 0x5ed6c3, this.currents[side]);
    }
    this.addSign(.015, "FOLLOW THE LIT CURRENT", "FAVOURED LINE CHANGES EACH LAP", "#9cddd5");
    this.addSign(.435, "SKYLIFT / 480M GLIDE", "FOLLOW THE LANDING BEACONS", "#dbcd9c");
    this.addSign(.727, "PELAGIC / 340M GLIDE", "KEEP YOUR LINE / HOLD THRUST", "#dbcd9c");
    this.addFields();
  }
  update(elapsed: number, reduced: boolean, pickups: readonly PickupAppearance[], progress: number, seed: number, lap: number): void {
    this.devices.update(elapsed, reduced, pickups, progress);
    const lane = currentLane(seed, lap);
    this.currents[0].visible = lane < 0;
    this.currents[1].visible = lane > 0;
  }
  dispose(): void { this.devices.dispose(); }

  private addRibbon(from: number, to: number, lateral: number, width: number, color: number, parent: THREE.Group): void {
    const positions: number[] = [];
    for (let progress = from; progress < to; progress += .003) {
      const a = this.course.sample(progress), b = this.course.sample(Math.min(to, progress + .0013));
      const points = [a.position.clone().addScaledVector(a.right, lateral - width / 2).addScaledVector(a.up, .075),
        a.position.clone().addScaledVector(a.right, lateral + width / 2).addScaledVector(a.up, .075),
        b.position.clone().addScaledVector(b.right, lateral - width / 2).addScaledVector(b.up, .075),
        b.position.clone().addScaledVector(b.right, lateral + width / 2).addScaledVector(b.up, .075)];
      for (const index of [0, 2, 1, 1, 2, 3]) positions.push(...points[index]);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    parent.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .36,
      depthWrite: false, side: THREE.DoubleSide, toneMapped: false })));
  }

  private addFields(): void {
    const material = new THREE.MeshBasicMaterial({ color: 0xffb48d, transparent: true, opacity: .23, depthWrite: false, toneMapped: false });
    const edgeMaterial = new THREE.MeshBasicMaterial({ color: 0xffc39b, toneMapped: false });
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const fields = new THREE.InstancedMesh(geometry, material, TIDELINE_FIELDS.length);
    const frames = new THREE.InstancedMesh(geometry, edgeMaterial, TIDELINE_FIELDS.length * 3);
    const transform = new THREE.Object3D();
    for (let i = 0; i < TIDELINE_FIELDS.length; i++) {
      const field = TIDELINE_FIELDS[i], s = this.course.sample(field.progress);
      transform.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(s.right, s.up, s.tangent.clone().negate()));
      transform.position.copy(s.position).addScaledVector(s.right, field.lateral).addScaledVector(s.up, 1.85);
      transform.scale.set(field.halfWidth * 2, 3.7, .3); transform.updateMatrix(); fields.setMatrixAt(i, transform.matrix);
      for (let part = 0; part < 3; part++) {
        transform.position.copy(s.position).addScaledVector(s.right, field.lateral + (part === 2 ? 0 : (part ? 1 : -1) * field.halfWidth));
        transform.position.addScaledVector(s.up, part === 2 ? 3.7 : 1.85);
        transform.scale.set(part === 2 ? field.halfWidth * 2 : .1, part === 2 ? .1 : 3.7, .14);
        transform.updateMatrix(); frames.setMatrixAt(i * 3 + part, transform.matrix);
      }
      this.addSign(field.progress - .018, "PHASE BULKHEAD", "STEER CLEAR / TIME YOUR SHIELD", "#edb28b");
    }
    this.root.add(fields, frames);
  }

  private addSign(progress: number, title: string, subtitle: string, color: string): void {
    const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 128;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#0a202a"; context.fillRect(0, 0, 512, 128);
    context.strokeStyle = color; context.lineWidth = 3; context.strokeRect(3, 3, 506, 122);
    context.textAlign = "center"; context.fillStyle = color; context.font = "bold 28px monospace"; context.fillText(title, 256, 55);
    context.fillStyle = "#d2e4df"; context.font = "18px monospace"; context.fillText(subtitle, 256, 96);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.25), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false, side: THREE.DoubleSide }));
    const sample = this.course.sample(progress);
    mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(sample.right, sample.up, sample.tangent.clone().negate()));
    mesh.position.copy(sample.position).addScaledVector(sample.up, 6.8);
    this.root.add(mesh);
  }
}
