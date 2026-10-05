import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { frameModel, TEAM_COLORS } from "./garage-anchors";
import type { FrameFit, PartCode } from "./garage-rules.js";

export const PART_BENEFITS: Record<PartCode, string> = {
  engine: "Carry more speed down the straights.",
  thrusters: "Get back to speed faster after a corner.",
  stabilisers: "Hold your chosen line with more grip.",
  skid: "Build drift charge faster and rotate harder.",
  plasma: "Refill boost faster and push harder on boost.",
};
export const PART_HARDWARE: Record<PartCode, readonly string[]> = {
  engine: ["REINFORCED NOZZLE COLLARS", "TWIN COOLING COLLARS", "ACTIVE EXHAUST LINERS"],
  thrusters: ["VECTOR SERVO CASINGS", "BRACED VECTOR SERVOS", "ACTIVE VECTOR ACTUATORS"],
  stabilisers: ["FIN REINFORCEMENT", "DOUBLE FIN BRACING", "ACTIVE STABILITY TRIM"],
  skid: ["REINFORCED SKID SHOES", "SEGMENTED DRIFT RAILS", "ENERGISED DRIFT RAILS"],
  plasma: ["REGULATOR HEAT SINK", "EXPANDED COOLING STACK", "ACTIVE PLASMA CONDUCTORS"],
};

interface Installation { key: string; groups: THREE.Group[] }
const installed = new WeakMap<THREE.Object3D, Installation>();
const NAME = "garage_upgrade_";
/**
 * One alloy and one conductor material per frame, kept for the page: a part
 * preview rebuilds the hardware's geometry, never its material, so the program
 * stays compiled (a disposed material releases it, and the next preview paid a
 * fresh link every time).
 */
const materials = new Map<string, THREE.MeshStandardMaterial>();
export function upgradeMaterial(frame: string, lit: boolean): THREE.MeshStandardMaterial {
  const key = `${frame}:${lit}`;
  let material = materials.get(key);
  if (!material) materials.set(key, material = new THREE.MeshStandardMaterial({
    name: lit ? "UPGRADE_conductor" : "UPGRADE_alloy", color: lit ? TEAM_COLORS[frame] : 0x73858a,
    roughness: lit ? .48 : .64, metalness: lit ? .12 : .42,
    emissive: lit ? TEAM_COLORS[frame] : 0, emissiveIntensity: lit ? .55 : 0,
  }));
  return material;
}

/** Bounds in the actual moving part's coordinate system, before adding trim. */
function localBounds(part: THREE.Object3D): THREE.Box3 {
  part.updateWorldMatrix(true, true);
  const inverse = part.matrixWorld.clone().invert(), bounds = new THREE.Box3();
  part.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.computeBoundingBox();
    bounds.union(object.geometry.boundingBox!.clone().applyMatrix4(inverse.clone().multiply(object.matrixWorld)));
  });
  return bounds;
}

/** One material batch per attachment: detail costs geometry, not dozens of draws. */
class Hardware {
  readonly group = new THREE.Group();
  private readonly metal: THREE.BufferGeometry[] = [];
  private readonly lamps: THREE.BufferGeometry[] = [];

  constructor(private readonly frame: string, part: PartCode, stage: number) {
    this.group.name = `${NAME}${part}`;
    this.group.userData = { part, stage, frame };
  }

  box(at: number[], size: number[], lit = false): void {
    this.add(new THREE.BoxGeometry(size[0], size[1], size[2]).translate(at[0], at[1], at[2]), lit);
  }

  ring(at: number[], radius: number, thickness: number, lit = false, squash = 1, rake = 0): void {
    const shape = new THREE.TorusGeometry(radius, thickness, 4, 16);
    shape.scale(1, squash, 1); shape.rotateX(rake); shape.translate(at[0], at[1], at[2]); this.add(shape, lit);
  }

  private add(shape: THREE.BufferGeometry, lit: boolean): void { (lit ? this.lamps : this.metal).push(shape); }

  mount(parent: THREE.Object3D, groups: THREE.Group[]): void {
    for (const [shapes, lit] of [[this.metal, false], [this.lamps, true]] as const) {
      if (!shapes.length) continue;
      const geometry = mergeGeometries(shapes)!;
      for (const shape of shapes) shape.dispose();
      const mesh = new THREE.Mesh(geometry, upgradeMaterial(this.frame, lit)); mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    parent.add(this.group); groups.push(this.group);
  }
}

function remove(installation: Installation): void {
  for (const group of installation.groups) {
    group.removeFromParent();
    // Geometry only: the materials are the frame's shared pair (`upgradeMaterial`).
    group.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
  }
}

/** Fitted to the real node hierarchy. A fin's reinforcement moves WITH its fin;
 * a cached frame never inherits another frame's parts or compounds its scale. */
export function fitUpgradeHardware(hull: THREE.Object3D, frame: string, fit: FrameFit): THREE.Group[] {
  const previous = installed.get(hull);
  const key = `${frame}:${Object.values(fit.parts).join(",")}`;
  if (previous?.key === key) return previous.groups;
  if (previous) remove(previous);
  const groups: THREE.Group[] = [], model = frameModel(hull, frame);
  if (!model) { installed.delete(hull); return groups; }
  const partNode = (name: string) => model.getObjectByName(name);

  const engine = fit.parts.engine;
  if (engine) for (const [side, sign] of [["left", -1], ["right", 1]] as const) {
    const node = partNode(`FX_engine_${side}`); if (!node) continue;
    const kit = new Hardware(frame, "engine", engine);
    const radius = ({ totem: .22, lance: .28, sidewinder: .25, bulwark: .26, corona: .24, halo: .24 })[frame] ?? .25;
    const [x, y, z] = frame === "totem" ? [sign * .33, -.524, -.085] : [0, 0, -.05];
    kit.ring([x,y,z], radius + .015, .043);
    if (engine >= 2) kit.ring([x,y,z - .12], radius + .025, .04);
    if (engine >= 3) kit.ring([x,y,z + .025], radius - .018, .025, true);
    kit.mount(node, groups);
  }

  for (const part of ["thrusters", "stabilisers"] as const) {
    const stage = fit.parts[part]; if (!stage) continue;
    const ring = part === "stabilisers" && (frame === "corona" || frame === "halo") ? partNode("stabiliser_ring_pivot") : null;
    if (ring) {
      const kit = new Hardware(frame, part, stage), halo = frame === "halo";
      for (let i = 0; i < stage; i++) kit.ring([0,0,(i - 1) * .065], halo ? 1.72 : .92, .026, i === 2, halo ? .42 : 1, halo ? Math.PI / 12 : 0);
      kit.mount(ring, groups);
    } else for (const [side, sign] of [["L", -1], ["R", 1]] as const) {
      const node = partNode(`${part === "thrusters" ? "elevon" : "steering_fin"}_${side}_pivot`); if (!node) continue;
      const bounds = localBounds(node), size = bounds.getSize(new THREE.Vector3()), centre = bounds.getCenter(new THREE.Vector3());
      const kit = new Hardware(frame, part, stage);
      // Probe the authored fin face, rather than its rectangular bounds: swept
      // tips leave empty corners, which made generic attachments float.
      node.updateWorldMatrix(true, true);
      for (let i = 0; i < stage; i++) {
        const local = new THREE.Vector3(sign * (Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x)) + 1), centre.y, centre.z + (i - 1) * size.z * .16);
        const origin = node.localToWorld(local.clone());
        const direction = new THREE.Vector3(-sign, 0, 0).transformDirection(node.matrixWorld);
        const hit = new THREE.Raycaster(origin, direction).intersectObject(node, true)[0];
        if (!hit) continue;
        const p = node.worldToLocal(hit.point);
        kit.box([p.x + sign * .022, p.y, p.z], [.055, Math.min(.20, size.y * .36), Math.min(.14, size.z * .19)], i === 2);
      }
      kit.mount(node, groups);
    }
  }

  const skid = fit.parts.skid, skids = partNode("skids_pivot");
  if (skid && skids) {
    const bounds = localBounds(skids), kit = new Hardware(frame, "skid", skid);
    for (const x of [bounds.min.x + .04, bounds.max.x - .04]) for (let i = 0; i < skid + 1; i++) {
      const z = THREE.MathUtils.lerp(bounds.min.z, bounds.max.z, (i + 1) / (skid + 2));
      kit.box([x, bounds.min.y + .015, z], [.14, .095, .34]);
      if (skid === 3) kit.box([x, bounds.min.y - .037, z], [.095,.016,.23], true);
    }
    kit.mount(skids, groups);
  }

  const plasma = fit.parts.plasma;
  if (plasma) {
    const kit = new Hardware(frame, "plasma", plasma);
    const node = frame === "totem" ? hull.getObjectByName("TE_gyro_pivot") : frame === "corona" ? partNode("body_static") : partNode("FX_boost_center");
    if (node) {
      if (frame === "corona") {
        // Between the stock sleeves at -.85 / 0 / .85: each added collar
        // stays visible instead of stage II disappearing inside a stock band.
        for (const side of [-1,1]) for (let i = 0; i < plasma; i++) kit.ring([side * 1.28, .12, [.425,-.425,1.25][i]], .23, .025, i === 2);
      } else if (frame === "totem") {
        // The gyro is an authored ring, not a common deck-mounted gadget.
        for (let i = 0; i < plasma; i++) kit.ring([0,0,-.05 + i * .05], .96, .022, i === 2);
      } else {
        const y = frame === "lance" ? .35 : .31;
        kit.box([0,y,-.24], [.58,.055,.16]);
        for (let i = 0; i < plasma + 1; i++) kit.box([-.21 + i * .14,y + .04,-.24], [.048,.065,.18], plasma === 3 && i === 3);
      }
      kit.mount(node, groups);
    }
  }
  installed.set(hull, { key, groups });
  return groups;
}

/** Hardpoints sit on opaque deck geometry, behind the canopy on each frame. */
export function seatPowerHardpoints(body: THREE.Object3D, frame: string): void {
  const layout: Record<string, [number, number]> = { lance: [.36,.8], sidewinder: [.57,.65], bulwark: [.73,.65], corona: [.53,.75], halo: [.29,.7] };
  const [x,z] = layout[frame];
  body.updateMatrixWorld(true);
  for (const [side, sign] of [["left",-1],["right",1]] as const) {
    const node = body.getObjectByName(`HARDPOINT_${side}`); if (!node?.parent) continue;
    const ray = new THREE.Raycaster(new THREE.Vector3(sign * x, 5, z), new THREE.Vector3(0,-1,0));
    const hit = ray.intersectObject(body, true).find(hit => (hit.object as THREE.Mesh).material && !((hit.object as THREE.Mesh).material as THREE.Material).transparent);
    if (hit) node.position.copy(node.parent.worldToLocal(hit.point)).y += .015;
  }
}
