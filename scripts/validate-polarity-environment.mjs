import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { parseGlb } from "./lib/greenwater-package-validator.mjs";

const root = new URL("../", import.meta.url);
const route = JSON.parse(await readFile(new URL("src/game/data/polarity/route.json", root), "utf8"));
const base = new URL("public/assets/polarity/", root);
const bytes = await readFile(new URL("polarity_station.glb", base));
const { json, binary } = parseGlb(bytes, "Polarity interchange");
const manifest = JSON.parse(await readFile(new URL("manifest.json", base), "utf8"));
const lamps = JSON.parse(await readFile(new URL("lights.json", base), "utf8"));
assert.ok(bytes.length < 12 * 1024 * 1024);
assert.ok(!json.animations?.length && !json.skins?.length && !json.cameras?.length);
assert.ok(!json.extensionsRequired?.length);
assert.equal(manifest.inverterRings, 7);
assert.ok(manifest.powerHalls >= 15 && manifest.capacitorBanks >= 15);
assert.ok(manifest.pylons >= 40 && manifest.towers >= 30);
assert.equal(lamps.length, manifest.lightAnchors);
for (const lamp of lamps) {
  assert.ok([...lamp.p, lamp.ground, lamp.size].every(Number.isFinite));
  assert.ok(lamp.size > 0 && lamp.size <= 8);
}
let triangles = 0;
let primitives = 0;
for (const mesh of json.meshes) {
  for (const primitive of mesh.primitives) {
    primitives++;
    assert.equal(primitive.mode ?? 4, 4);
    triangles += json.accessors[primitive.indices].count / 3;
  }
}
assert.equal(triangles, manifest.triangles);
assert.ok(triangles <= 180_000);
assert.ok(primitives <= 60);

// Measure exported geometry in world space, including Blender's merged-node
// transforms. No scenery may occupy the playable corridor between the decks.
const cells = new Map();
for (const station of [...route.stations, ...route.upper]) {
  const key = `${Math.floor(station.p[0] / 32)},${Math.floor(station.p[2] / 32)}`;
  const bucket = cells.get(key) ?? [];
  bucket.push(station);
  cells.set(key, bucket);
}
const point = new THREE.Vector3();
let checkedVertices = 0;
function checkPoint(p, nodeName) {
  if (p.y < -.25 || p.y > 28) return;
  checkedVertices++;
  const xCell = Math.floor(p.x / 32), zCell = Math.floor(p.z / 32);
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    for (const station of cells.get(`${xCell + dx},${zCell + dz}`) ?? []) {
      const distance = Math.hypot(p.x - station.p[0], p.z - station.p[2]);
      assert.ok(distance >= station.width / 2 + 2,
        `${nodeName} enters the driving corridor at ${p.toArray()} (${distance.toFixed(2)} m).`);
    }
  }
}
function visit(index, parent) {
  const node = json.nodes[index];
  const local = node.matrix ? new THREE.Matrix4().fromArray(node.matrix) : new THREE.Matrix4().compose(
    new THREE.Vector3().fromArray(node.translation ?? [0, 0, 0]),
    new THREE.Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
    new THREE.Vector3().fromArray(node.scale ?? [1, 1, 1]),
  );
  const world = parent.clone().multiply(local);
  if (node.mesh !== undefined) for (const primitive of json.meshes[node.mesh].primitives) {
    const accessor = json.accessors[primitive.attributes.POSITION];
    assert.equal(accessor.componentType, 5126);
    const view = json.bufferViews[accessor.bufferView];
    const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const stride = view.byteStride ?? 12;
    for (let i = 0; i < accessor.count; i++) {
      point.set(binary.readFloatLE(start + i * stride), binary.readFloatLE(start + i * stride + 4),
        binary.readFloatLE(start + i * stride + 8)).applyMatrix4(world);
      checkPoint(point, node.name);
    }
  }
  for (const child of node.children ?? []) visit(child, world);
}
for (const node of json.scenes[json.scene ?? 0].nodes) visit(node, new THREE.Matrix4());
assert.ok(checkedVertices > 10_000);
console.log(`Polarity environment PASS: ${triangles.toLocaleString()} triangles, ${primitives} primitives, ${(bytes.length / 1024 / 1024).toFixed(1)} MiB; ${checkedVertices.toLocaleString()} exported vertices checked against both driving decks; ${manifest.inverterRings} inverter rings and ${lamps.length} light anchors.`);
