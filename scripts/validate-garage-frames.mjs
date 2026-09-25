import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { FRAME_CODES } from "../src/game/garage-rules.js";

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
 *     manifest the build wrote matches what was exported.
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
/** TOTEM itself is 6,186 triangles over 18 draws; a frame body stays well under it. */
const MAX_TRIANGLES = 3_000;
const MAX_DRAWS = 21;
const MAX_BYTES = 200 * 1024;
/** Model space: TOTEM spans x +-1.7, y -0.9 (its ring) to 1.37, z -3.9 to 2.47. */
const BOUNDS = { min: [-1.85, -0.9, -4.8], max: [1.85, 1.35, 2.75] };

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
  const paint = gltf.materials.find((material) => material.name === "FRAME_paint");
  assert.ok(paint.pbrMetallicRoughness?.baseColorTexture, `${label}: FRAME_paint lost its livery atlas.`);
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
  const pinned = manifest[code];
  assert.equal(pinned.bytes, bytes.length, `${label}: the manifest's bytes are stale; rebuild.`);
  assert.equal(pinned.triangles, triangles, `${label}: the manifest's triangles are stale; rebuild.`);
  assert.equal(pinned.drawCalls, draws, `${label}: the manifest's draw calls are stale; rebuild.`);
  report.push(`${code} ${triangles} tris / ${draws} draws / ${(bytes.length / 1024).toFixed(0)} KiB`);
}

// Runtime wiring: the body is mounted, not scaled; refits are serialized and a
// launch waits for the latest one; the GLBs are fetched only by the lazy look.
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [totem, look, main, catalog, index] = await Promise.all([
  read("src/game/totem.ts"), read("src/game/garage-look.ts"), read("src/main.ts"),
  read("src/game/garage-catalog.js"), read("index.html"),
]);
assert.match(totem, /mountBody\(body: THREE\.Object3D \| null\): void/, "TotemVehicle.mountBody is gone.");
assert.match(totem, /this\.racePresence\?\.rebind\(this\.model, named\)/, "mountBody no longer re-anchors the race presence.");
assert.match(totem, /this\.evolution\?\.anchorTo\(body, named\)/, "mountBody no longer re-anchors the kit.");
assert.match(look, /vehicle\.mountBody\(body\)/, "garage-look.ts no longer mounts the body.");
assert.match(look, /serials\.get\(vehicle\) !== serial/, "garage-look.ts lost the latest-refit-wins guard.");
assert.doesNotMatch(look, /hull\.scale\.set\(width/, "A frame body must not be stance-scaled on top of its own geometry.");
assert.doesNotMatch(catalog, /stance/, "The catalog still carries stance scales.");
assert.match(main, /await refitting;\s*\n\s*await game\.startTrial\(\)/, "A launch must wait for the latest refit.");
assert.doesNotMatch(index, /garage\/frames/, "The frame GLBs must stay out of the initial shell.");

console.log(`Garage frames PASS: ${report.join("; ")}; pivots identity and mirrored, airbrakes forward of their hinges, anchors mirrored, jets on the kit's line, single-sided role materials with all four kit lamps, manifest current; bodies mount (never scale), refits serialize and a launch waits for the latest.`);
