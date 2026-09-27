import * as THREE from "three";
import type { PartCode } from "./garage-rules.js";

export const FLEET_CODES: Record<string, string> = {
  totem: "07", lance: "S3", sidewinder: "D2", bulwark: "G4", corona: "P5", halo: "X1",
};
export const TEAM_COLORS: Record<string, string> = {
  totem: "#c8ed51", lance: "#58cee1", sidewinder: "#e67eaf", bulwark: "#ebca65", corona: "#bfa0ef", halo: "#e4c893",
};

export interface PartAnchor {
  node: string;
  offset: readonly [number, number, number];
  direction: readonly [number, number, number];
  span: number;
  label: string;
}

// These names resolve inside the selected body, never inside hidden TOTEM
// geometry. Offsets identify serviceable surfaces on the authored part.
const engine: PartAnchor = { node: "FX_engine_right", offset: [0, 0, 0.02], direction: [1.8, 1.3, 5], span: 2.5, label: "REAR ENGINE ASSEMBLY" };
const thrusters: PartAnchor = { node: "elevon_R_pivot", offset: [0, .15, .35], direction: [4, 2.5, 3], span: 2.6, label: "THRUST VECTORING" };
const stabilisers: PartAnchor = { node: "steering_fin_R_pivot", offset: [0, .2, .35], direction: [4, 3, 2], span: 2.4, label: "STABILISER ASSEMBLY" };
const skid: PartAnchor = { node: "skids_pivot", offset: [1.05, 0, .3], direction: [5, .25, 2], span: 2.8, label: "STARBOARD SKID RIG" };
const plasma: PartAnchor = { node: "TE_gyro_pivot", offset: [0, 0.18, 0], direction: [3, 4, 4], span: 2.8, label: "PLASMA REGULATOR" };
const regulator: PartAnchor = { node: "FX_boost_center", offset: [0, .31, -.24], direction: [1, 3, 5], span: 2.2, label: "PLASMA REGULATOR" };

export const FRAME_ANCHORS: Record<string, Record<PartCode, PartAnchor>> = {
  totem: { engine: { ...engine, offset: [.33, -.524, -.065] }, thrusters: { ...thrusters, offset: [0, .28, -.2] },
    stabilisers: { ...stabilisers, offset: [0, .22, -.3] }, skid: { ...skid, offset: [.985, 0, 1.55], direction: [5, -.35, 0] },
    plasma: { ...plasma, offset: [.984, 0, .05], direction: [2, 1, 5] } },
  lance: { engine, thrusters, stabilisers: { ...stabilisers, direction: [3, 3, 5] }, skid: { ...skid, offset: [.46, -.03, .2] }, plasma: { ...regulator, offset: [0, .35, -.24] } },
  sidewinder: { engine, thrusters, stabilisers, skid: { ...skid, offset: [.64, -.03, .3] }, plasma: regulator },
  bulwark: { engine, thrusters, stabilisers, skid: { ...skid, offset: [.74, -.03, .3] }, plasma: regulator },
  corona: { engine, thrusters, stabilisers: { ...stabilisers, node: "stabiliser_ring_pivot", offset: [.87, .3, .1], direction: [4, 2, 4], span: 3 }, skid: { ...skid, offset: [.54, -.03, .3] },
    plasma: { ...plasma, node: "body_static", offset: [1.48, .2, .4], direction: [5, 3, 2], label: "STARBOARD PLASMA CELL" } },
  halo: { engine, thrusters: { ...thrusters, direction: [5, 1, 0] }, stabilisers: { ...stabilisers, node: "stabiliser_ring_pivot", offset: [1.55, .25, .05], direction: [4, 2, 4], span: 3 }, skid: { ...skid, offset: [1.32, -.03, .3] }, plasma: regulator },
};

export function frameModel(hull: THREE.Object3D, frame: string): THREE.Object3D | null {
  return frame === "totem" ? hull.getObjectByName("TOTEM_runtime") ?? null
    : hull.getObjectByName(`FRAME_${frame}`) ?? null;
}

export function partAnchor(hull: THREE.Object3D, frame: string, part: PartCode, out: THREE.Vector3): PartAnchor | null {
  const spec = FRAME_ANCHORS[frame]?.[part];
  if (!spec) return null;
  const model = frameModel(hull, frame);
  if (!model) return null;
  // Only TOTEM exposes the gyro kit. Other bodies have their own regulators.
  const target = spec.node === "TE_gyro_pivot" ? hull.getObjectByName(spec.node) : model.getObjectByName(spec.node);
  if (!target) return null;
  out.fromArray(spec.offset);
  target.localToWorld(out);
  return spec;
}
