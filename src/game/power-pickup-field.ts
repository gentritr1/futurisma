import * as THREE from "three";
import type { CourseSample } from "./course";
import { PowerKit, type PowerPickupVisual } from "./power-kit";

export type PowerKind = "surge" | "shield";
export interface PickupDefinition {
  progress: number;
  lane: 0 | 1;
  lateral: number;
  kind: PowerKind;
}
export interface PickupAppearance { kind: PowerKind; available: boolean; charge: number }

/** Shared presentation for physical pickup devices. Gameplay owns availability. */
export class PowerPickupField {
  readonly root = new THREE.Group();
  readonly ready: Promise<void>;
  private kit: PowerKit | null = null;
  private disposed = false;
  private readonly sockets: THREE.Group[] = [];
  private readonly devices: Record<PowerKind, PowerPickupVisual>[] = [];

  constructor(private readonly definitions: readonly PickupDefinition[],
    private readonly courseLength: number, sample: (pickup: PickupDefinition) => CourseSample) {
    this.root.name = "power_device_field";
    for (const pickup of definitions) {
      const station = sample(pickup);
      const socket = new THREE.Group();
      const basis = new THREE.Matrix4().makeBasis(station.right, station.up, station.tangent.clone().negate());
      socket.quaternion.setFromRotationMatrix(basis);
      socket.position.copy(station.position).addScaledVector(station.right, pickup.lateral).addScaledVector(station.up, 1.8);
      this.root.add(socket); this.sockets.push(socket);
    }
    this.ready = this.load();
  }

  private async load(): Promise<void> {
    const kit = await PowerKit.load();
    if (this.disposed) { kit.dispose(); return; }
    this.kit = kit;
    this.sockets.forEach((socket) => {
      const surge = kit.createPickupVisual("surge");
      const shield = kit.createPickupVisual("shield");
      surge.root.visible = shield.root.visible = false;
      socket.add(surge.root, shield.root);
      this.devices.push({ surge, shield });
    });
  }

  update(elapsed: number, reducedMotion: boolean, states: readonly PickupAppearance[], progress: number): void {
    this.definitions.forEach((pickup, index) => {
      const device = this.devices[index];
      if (!device) return;
      const state = states[index];
      const distance = Math.abs(((pickup.progress - progress + 1.5) % 1) - .5) * this.courseLength;
      const visible = Boolean(state?.available) && distance < 270;
      for (const kind of ["surge", "shield"] as const) {
        const visual = device[kind];
        visual.root.visible = visible && state.kind === kind;
        if (!visual.root.visible) continue;
        visual.update(elapsed, reducedMotion, state.charge, 0);
      }
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const device of this.devices) for (const visual of Object.values(device)) {
      visual.root.removeFromParent(); visual.dispose();
    }
    this.devices.length = 0;
    this.kit?.dispose(); this.kit = null;
  }
}
