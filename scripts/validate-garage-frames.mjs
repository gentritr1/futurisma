import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { SCHEME_CARDS, SCHEME_SWATCHES } from "../src/game/garage-catalog.js";
import { phaseRunsContinuousPresentation } from "../src/game/frame-scheduling.js";
import { FRAME_CODES, bodySchemes } from "../src/game/garage-rules.js";

/**
 * Garage frames — the five frame bodies keep the contract `TotemVehicle.mountBody`
 * mounts them by. Built by `art/blender/build_garage_frames.py`; this reads the
 * shipped GLBs themselves, not the script, so a hand-edited or stale export
 * fails here rather than on the grid.
 *
 *   - every pivot `updateVisual` drives is present, at identity rotation and
 *     scale, mirrored left/right, and every airbrake panel lies forward of its
 *     hinge (so a positive pitch lifts it into the air rather than the deck);
 *   - every anchor the race presence and the kit re-read is present and
 *     mirrored, and the jets exit on the kit's twin line;
 *   - materials are the declared roles only, all single-sided like TOTEM's,
 *     with the four kit lamps present so their reporting survives a mount;
 *   - triangles, draw calls, bytes and bounds sit inside the budget, and the
 *     manifest the build wrote matches what was exported;
 *   - every body paint scheme the rules offer a frame was built: a 512 JPEG
 *     under the atlas ceiling, its bytes pinned in the manifest, and its chip
 *     swatch in the catalog the same pair the build painted; and both the paint
 *     and the accent sample the ONE atlas, so a scheme is a single swap.
 */

const PIVOTS = ["steering_fin_L", "steering_fin_R", "airbrake_L", "airbrake_R", "elevon_L", "elevon_R", "skids"]
  .map((name) => `${name}_pivot`);
const ANCHORS = [
  "FX_jet_left", "FX_jet_right", "HARDPOINT_left", "HARDPOINT_right",
  "FX_engine_left", "FX_engine_right", "FX_boost_center", "FX_trail_wing_left", "FX_trail_wing_right",
  "FX_dust_rear_left", "FX_dust_rear_right", "FX_impact_nose", "FX_impact_left", "FX_impact_right",
];
const ROLES = new Set(["FRAME_paint", "FRAME_accent", "FRAME_trim", "FRAME_metal", "FRAME_glass", "FRAME_lights",
  "TE_boost", "TE_brake", "TE_gravity", "TE_power"]);
const REQUIRED_ROLES = ["FRAME_paint", "FRAME_accent", "FRAME_lights", "TE_boost", "TE_brake", "TE_gravity", "TE_power"];
/**
 * The budget, revised at stage 2 from the plan's first estimate (<= 2,000
 * triangles, 100-150 KB) once review added exposed structure and lit detail:
 * TOTEM itself is 6,186 triangles over 18 draws, and a body stays under half
 * its triangles and at or under its draw calls plus three.
 */
const MAX_TRIANGLES = 3_000;
const MAX_DRAWS = 21;
const MAX_BYTES = 200 * 1024;
/** Model space: TOTEM spans x +-1.7, y -0.9 (its ring) to 1.37, z -3.9 to 2.47. */
const BOUNDS = { min: [-1.85, -0.9, -4.8], max: [1.85, 1.35, 2.75] };

/**
 * The ranges `TotemVehicle.updateVisual` drives each pivot through (degrees,
 * or metres for the skids' drop), so the envelope holds in every pose the race
 * can put a body in, not only at rest. The source lines these come from are
 * pinned below; change one and this table has to follow.
 */
const MOTION = {
  steering_fin_L_pivot: ["y", -20, 20], steering_fin_R_pivot: ["y", -20, 20],
  airbrake_L_pivot: ["x", 0, 60], airbrake_R_pivot: ["x", 0, 60],
  elevon_L_pivot: ["y", -15, 15], elevon_R_pivot: ["y", -15, 15],
  stabiliser_ring_pivot: ["z", -22, 22], skids_pivot: ["drop", 0, -0.22],
};

/** Every vertex of one primitive, in its node's model-space frame. */
function vertices(bytes, gltf, primitive) {
  const accessor = gltf.accessors[primitive.attributes.POSITION];
  const view = gltf.bufferViews[accessor.bufferView];
  const base = 20 + bytes.readUInt32LE(12) + 8 + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const stride = view.byteStride ?? 12;
  return Array.from({ length: accessor.count }, (_, index) => {
    const at = base + index * stride;
    return [bytes.readFloatLE(at), bytes.readFloatLE(at + 4), bytes.readFloatLE(at + 8)];
  });
}

function turn(axis, radians, [x, y, z]) {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  if (axis === "x") return [x, y * c - z * s, y * s + z * c];
  if (axis === "y") return [x * c + z * s, y, -x * s + z * c];
  return [x * c - y * s, x * s + y * c, z];
}

const root = new URL("../public/assets/garage/frames/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
const bodies = FRAME_CODES.filter((code) => code !== "totem");
assert.deepEqual(Object.keys(manifest).sort(), [...bodies].sort(), "The manifest lists a frame the rules do not, or misses one.");

function parseGlb(bytes) {
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, "not a GLB");
  const jsonLength = bytes.readUInt32LE(12);
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a, "first chunk is not JSON");
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8"));
}

/**
 * A scheme atlas is fetched only when fitted or previewed. The ceiling leaves
 * room for the busiest schemes (HAZARD's stripes, NEBULA's star field), which
 * JPEG spends the most bytes on.
 */
const MAX_ATLAS_BYTES = 96 * 1024;

/** Width and height from a baseline or progressive JPEG's frame header. */
function jpegSize(bytes) {
  assert.equal(bytes.readUInt16BE(0), 0xffd8, "not a JPEG");
  for (let at = 2; at < bytes.length;) {
    const marker = bytes.readUInt16BE(at);
    if (marker === 0xffc0 || marker === 0xffc2) return [bytes.readUInt16BE(at + 7), bytes.readUInt16BE(at + 5)];
    at += 2 + bytes.readUInt16BE(at + 2);
  }
  throw new Error("JPEG without a frame header");
}

let atlasBytes = 0;
let atlases = 0;
const report = [];
for (const code of bodies) {
  const bytes = await readFile(new URL(`${code}.glb`, root));
  const gltf = parseGlb(bytes);
  const label = `${code}.glb`;
  const nodes = gltf.nodes;
  const byName = new Map(nodes.map((node, index) => [node.name, index]));
  const parent = new Map();
  nodes.forEach((node, index) => (node.children ?? []).forEach((child) => parent.set(child, index)));
  const position = (index) => {
    const out = [0, 0, 0];
    for (let at = index; at !== undefined; at = parent.get(at)) {
      const node = nodes[at];
      assert.ok(!node.matrix, `${label}: ${node.name} uses a matrix; the contract is TRS.`);
      const t = node.translation ?? [0, 0, 0];
      for (let axis = 0; axis < 3; axis += 1) out[axis] += t[axis];
    }
    return out;
  };

  for (const name of [...PIVOTS, ...ANCHORS]) assert.ok(byName.has(name), `${label}: missing ${name}.`);
  for (const name of PIVOTS) {
    const node = nodes[byName.get(name)];
    const r = node.rotation ?? [0, 0, 0, 1];
    assert.ok(Math.abs(r[0]) + Math.abs(r[1]) + Math.abs(r[2]) < 1e-6, `${label}: ${name} is rotated; pivots are identity.`);
    assert.ok(!node.scale || node.scale.every((s) => Math.abs(s - 1) < 1e-6), `${label}: ${name} is scaled.`);
    assert.ok((node.children ?? []).length > 0, `${label}: ${name} drives nothing.`);
  }
  for (const [left, right] of [
    ["steering_fin_L_pivot", "steering_fin_R_pivot"], ["airbrake_L_pivot", "airbrake_R_pivot"],
    ["elevon_L_pivot", "elevon_R_pivot"], ...ANCHORS.filter((n) => n.endsWith("_left")).map((n) => [n, n.replace(/_left$/, "_right")]),
  ]) {
    const l = position(byName.get(left));
    const r = position(byName.get(right));
    assert.ok(Math.abs(l[0] + r[0]) < 1e-4 && Math.abs(l[1] - r[1]) < 1e-4 && Math.abs(l[2] - r[2]) < 1e-4,
      `${label}: ${left} and ${right} are not mirrored.`);
  }
  const jet = position(byName.get("FX_jet_right"));
  assert.ok(Math.abs(jet[0] - 0.45) < 0.01, `${label}: the jets exit at x ${jet[0]}, not on the kit's 0.45 line.`);
  assert.ok(position(byName.get("FX_impact_nose"))[2] < -3, `${label}: the nose impact anchor is not at the nose.`);

  // Materials: roles only, single-sided, lamps present, the paint textured.
  const materialNames = gltf.materials.map((material) => material.name);
  for (const name of materialNames) assert.ok(ROLES.has(name), `${label}: undeclared material ${name}.`);
  for (const name of REQUIRED_ROLES) assert.ok(materialNames.includes(name), `${label}: missing material ${name}.`);
  for (const material of gltf.materials) {
    assert.ok(!material.doubleSided, `${label}: ${material.name} is double-sided; TOTEM's materials are not.`);
  }
  // The finish, per role, as close to TOTEM's own hull (roughness 0.78,
  // metalness 0.14) as each role should be: a rebake cannot drift glossier.
  for (const [name, metal, rough] of [["FRAME_paint", 0.12, 0.72], ["FRAME_accent", 0.18, 0.70], ["FRAME_metal", 0.18, 0.65]]) {
    const pbr = gltf.materials.find((material) => material.name === name)?.pbrMetallicRoughness ?? {};
    assert.ok(Math.abs((pbr.metallicFactor ?? 1) - metal) < 1e-3 && Math.abs((pbr.roughnessFactor ?? 1) - rough) < 1e-3,
      `${label}: ${name} is metalness ${pbr.metallicFactor} / roughness ${pbr.roughnessFactor}, not ${metal} / ${rough}.`);
  }
  const paint = gltf.materials.find((material) => material.name === "FRAME_paint");
  assert.ok(paint.pbrMetallicRoughness?.baseColorTexture, `${label}: FRAME_paint lost its livery atlas.`);
  const accent = gltf.materials.find((material) => material.name === "FRAME_accent");
  assert.equal(gltf.textures[accent.pbrMetallicRoughness?.baseColorTexture?.index ?? -1]?.source,
    gltf.textures[paint.pbrMetallicRoughness.baseColorTexture.index].source,
    `${label}: FRAME_accent does not sample the livery atlas, so a paint scheme cannot recolour it.`);
  assert.equal(gltf.images.length, 1, `${label}: one livery atlas per frame.`);
  assert.equal(gltf.images[0].mimeType, "image/jpeg", `${label}: the atlas ships as JPEG.`);

  // Budget: triangles, draw calls, bytes, bounds.
  let triangles = 0;
  let draws = 0;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  nodes.forEach((node, index) => {
    if (node.mesh === undefined) return;
    const at = position(index);
    for (const primitive of gltf.meshes[node.mesh].primitives) {
      draws += 1;
      triangles += gltf.accessors[primitive.indices].count / 3;
      const accessor = gltf.accessors[primitive.attributes.POSITION];
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], accessor.min[axis] + at[axis]);
        max[axis] = Math.max(max[axis], accessor.max[axis] + at[axis]);
      }
    }
    // Airbrakes lie forward of the hinge: a positive local-x pitch lifts them.
    if (/^airbrake_[LR]_body$/.test(node.name)) {
      const accessor = gltf.accessors[gltf.meshes[node.mesh].primitives[0].attributes.POSITION];
      assert.ok(accessor.max[2] <= 0.01, `${label}: ${node.name} reaches aft of its hinge.`);
    }
  });
  assert.ok(triangles <= MAX_TRIANGLES, `${label}: ${triangles} triangles against ${MAX_TRIANGLES}.`);
  assert.ok(draws <= MAX_DRAWS, `${label}: ${draws} draw calls against ${MAX_DRAWS}.`);
  assert.ok(bytes.length <= MAX_BYTES, `${label}: ${bytes.length} B against ${MAX_BYTES}.`);
  for (let axis = 0; axis < 3; axis += 1) {
    assert.ok(min[axis] >= BOUNDS.min[axis] - 1e-3 && max[axis] <= BOUNDS.max[axis] + 1e-3,
      `${label}: bounds ${min.map((v) => v.toFixed(2))} .. ${max.map((v) => v.toFixed(2))} leave the envelope.`);
  }
  // Swept: every vertex under an animated pivot, at nine points across its
  // range, about the pivot's own origin. The whole craft's pitch and bank
  // (updateVisual's lerps on the visual group) are left out by design, as
  // they are for TOTEM: the envelope is the body's, not the banked craft's.
  nodes.forEach((node, index) => {
    if (node.mesh === undefined) return;
    let pivot;
    for (let at = parent.get(index); at !== undefined; at = parent.get(at)) {
      if (MOTION[nodes[at].name]) {
        pivot = at;
        break;
      }
    }
    if (pivot === undefined) return;
    const [axis, from, to] = MOTION[nodes[pivot].name];
    const origin = position(pivot);
    const at = position(index);
    for (const primitive of gltf.meshes[node.mesh].primitives) {
      const points = vertices(bytes, gltf, primitive).map((v) => [v[0] + at[0] - origin[0], v[1] + at[1] - origin[1], v[2] + at[2] - origin[2]]);
      for (let step = 0; step <= 8; step += 1) {
        const amount = from + (to - from) * step / 8;
        for (const point of points) {
          const moved = axis === "drop" ? [point[0], point[1] + amount, point[2]] : turn(axis, amount * Math.PI / 180, point);
          for (let k = 0; k < 3; k += 1) {
            const value = moved[k] + origin[k];
            assert.ok(value >= BOUNDS.min[k] - 1e-3 && value <= BOUNDS.max[k] + 1e-3,
              `${label}: ${nodes[pivot].name} at ${amount.toFixed(1)} takes ${node.name} to ${"xyz"[k]} ${value.toFixed(3)}, outside the envelope.`);
          }
        }
      }
    }
  });
  const pinned = manifest[code];
  assert.equal(pinned.bytes, bytes.length, `${label}: the manifest's bytes are stale; rebuild.`);
  assert.equal(pinned.triangles, triangles, `${label}: the manifest's triangles are stale; rebuild.`);
  assert.equal(pinned.drawCalls, draws, `${label}: the manifest's draw calls are stale; rebuild.`);
  // Body paint: every scheme the rules offer this frame, built and pinned.
  const paints = pinned.paints ?? {};
  assert.deepEqual(Object.keys(paints).sort(), bodySchemes(code).sort(), `${label}: the build's schemes differ from the rules'.`);
  for (const scheme of bodySchemes(code)) {
    assert.deepEqual(SCHEME_SWATCHES[code]?.[scheme], paints[scheme].swatch,
      `${code}-${scheme}: the catalog's chip swatch is not the colour the build painted; copy it from the manifest.`);
    assert.ok(SCHEME_CARDS.some((card) => card.code === scheme), `${scheme} has no catalog card.`);
    if (scheme === "factory") continue;
    const atlas = await readFile(new URL(`paint/${code}-${scheme}.jpg`, root));
    assert.equal(atlas.length, paints[scheme].bytes, `${code}-${scheme}.jpg: the manifest's bytes are stale; rebuild.`);
    assert.ok(atlas.length <= MAX_ATLAS_BYTES, `${code}-${scheme}.jpg is ${atlas.length} B against ${MAX_ATLAS_BYTES}.`);
    assert.deepEqual(jpegSize(atlas), [512, 512], `${code}-${scheme}.jpg is not a 512 atlas.`);
    atlasBytes += atlas.length;
    atlases += 1;
  }
  report.push(`${code} ${triangles} tris / ${draws} draws / ${(bytes.length / 1024).toFixed(0)} KiB`);
}

// Runtime wiring: the body is mounted, not scaled; refits are serialized and a
// launch waits for the latest one; the GLBs are fetched only by the lazy look.
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [totem, look, main, catalog, index, game, bay] = await Promise.all([
  read("src/game/totem.ts"), read("src/game/garage-look.ts"), read("src/main.ts"),
  read("src/game/garage-catalog.js"), read("index.html"), read("src/game/game.ts"), read("src/game/garage-ui.ts"),
]);
assert.match(totem, /mountBody\(body: THREE\.Object3D \| null\): void/, "TotemVehicle.mountBody is gone.");
// CORONA's cells are its plasma gauge: two long TE_boost cells outboard, which
// garage-look.ts masks into four bands by the reserve, on its own treated copy
// of the kit's lamp (PS2 treatment and the circuit rule, so it fogs and grades).
{
  const bytes = await readFile(new URL("corona.glb", root));
  const gltf = parseGlb(bytes);
  const lamp = gltf.materials.findIndex((material) => material.name === "TE_boost");
  const cells = gltf.meshes.flatMap((mesh) => mesh.primitives).filter((primitive) => primitive.material === lamp)
    .map((primitive) => gltf.accessors[primitive.attributes.POSITION]);
  assert.ok(cells.some((accessor) => Math.abs(accessor.max[0]) > 1 || Math.abs(accessor.min[0]) > 1),
    "corona.glb: no TE_boost cell outboard of x 1.0; the reserve gauge has nothing to light.");
  const reach = cells.reduce((span, accessor) => [Math.min(span[0], accessor.min[2]), Math.max(span[1], accessor.max[2])], [Infinity, -Infinity]);
  assert.ok(reach[0] <= -1.6 && reach[1] >= 1.6, `corona.glb: the cells span z ${reach}, not the gauge's -1.7..1.7.`);
  for (const needle of ["const CELL_Z = [-1.7, 1.7] as const;", "applyPs2MaterialTreatment(mesh);",
    "fill.value = reserve();", 'frame === "corona") await fitCellGauge(', "await applyCircuitRule(circuit, ...cells);"]) {
    assert.ok(look.includes(needle), `garage-look.ts lost part of CORONA's cell gauge: ${needle}`);
  }
  // CORONA's and HALO's rings hang below their skids; the wash is measured from the hull and skids alone.
  for (const needle of ['at.name === "stabiliser_ring_pivot"', "userData.washFloor as number"]) {
    assert.ok(look.includes(needle), `garage-look.ts measures the wash from the ring again: ${needle}`);
  }
}
// The swept-pose table above follows these lines.
for (const line of ["state.steer * 20 * DEG", "state.brake * 60 * DEG", "(-state.steer * 9 + state.brake * 6) * DEG",
  "(-state.lateralLoad * 12 - state.steer * state.driftIntensity * 10) * DEG", "retract * 0.22"]) {
  assert.ok(totem.includes(line), `updateVisual changed (${line}); update MOTION in validate-garage-frames.mjs.`);
}
assert.match(totem, /this\.racePresence\?\.rebind\(this\.model, named\)/, "mountBody no longer re-anchors the race presence.");
assert.match(totem, /this\.evolution\?\.anchorTo\(body, named\)/, "mountBody no longer re-anchors the kit.");
assert.match(look, /vehicle\.mountBody\(body\)/, "garage-look.ts no longer mounts the body.");
assert.match(look, /serials\.get\(vehicle\) !== serial/, "garage-look.ts lost the latest-refit-wins guard.");
assert.doesNotMatch(look, /hull\.scale\.set\(width/, "A frame body must not be stance-scaled on top of its own geometry.");
assert.doesNotMatch(catalog, /stance/, "The catalog still carries stance scales.");
// The wait lives in `startTrial`, which the button, Enter and a pad's START all
// reach; `main.ts` hands the refit over synchronously, before the bay loads.
assert.match(game, /await Promise\.all\(\[this\.audio\.start\(\)\.catch\(\(\) => undefined\), this\.refitting\]\)/,
  "startTrial must wait for the latest refit on every launch path.");
assert.match(main, /= game\.refitCraft\(async \(vehicle\) => \{\s*\n\s*const \{ applyCraftLook[\w\s,]*\} = await loadGarageBay\(\);/,
  "main.ts must hand the refit to the game before the bay chunk loads.");
assert.doesNotMatch(index, /garage\/frames/, "The frame GLBs must stay out of the initial shell.");
// The showroom turntable yaws the craft's visual group, which is only safe
// while the race loop never yaws it; and closing the bay must put the turn
// back to zero BEFORE the refit that repaints the paddock.
assert.doesNotMatch(totem, /visual\.rotation\.y\s*=/, "totem.ts now yaws the visual group; the showroom turntable would fight it.");
assert.match(look, /hull\.rotation\.y = radians/, "turnCraft no longer yaws the craft's visual group.");
// An underglow pattern moves only where frames keep coming; every other phase
// holds the steady wash, or a still frame would freeze it at a random phase.
// The paddock's body phases map onto the race loop's: intro = standby,
// race = countdown/running, paused, resuming, result = finished.
{
  const moving = JSON.parse(look.match(/const MOVING_PHASES = new Set\((\[[^\]]*\])\)/)?.[1] ?? "null");
  const bodyToLoop = { intro: "standby", race: "running", paused: "paused", resuming: "resuming" };
  assert.deepEqual(moving?.sort(), Object.keys(bodyToLoop).filter((phase) => phaseRunsContinuousPresentation(bodyToLoop[phase], 0)).sort(),
    "MOVING_PHASES must be exactly the paddock phases that draw every frame (frame-scheduling.js).");
}
const hide = bay.slice(bay.indexOf("  hide(): void {"), bay.indexOf("  dispose(): void {"));
assert.ok(hide.indexOf("this.animate()") >= 0 && hide.indexOf("this.animate()") < hide.indexOf("this.hooks.refit(null)"),
  "hide() must stop the turntable (animate) before it refits the paddock.");
assert.match(bay, /this\.yaw = this\.opened \? STILL_YAW : 0;\s*\n\s*turnCraft\(this\.yaw\);/,
  "a closed bay must turn the craft back to zero.");

console.log(`Garage frames PASS: ${report.join("; ")}; the showroom turntable owns the visual group's yaw and zeroes it before the paddock refits; ${atlases} paint schemes built (${(atlasBytes / 1024).toFixed(0)} KiB, fetched one at a time), each matching its catalog swatch; pivots identity and mirrored, airbrakes forward of their hinges, anchors mirrored, jets on the kit's line, single-sided role materials with all four kit lamps, manifest current; bodies mount (never scale), refits serialize and a launch waits for the latest.`);
