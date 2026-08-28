import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseGlb } from "./lib/greenwater-package-validator.mjs";

const expectedHashes = {
  "../public/assets/map02/models/bitterpan_blockout.glb":
    "56bb30f1aa3446366c80cb5661ae616a07bc30bb026c5e6266435de3fa1f92f9",
  "../public/assets/map02/models/bitterpan_massing.glb":
    "601287e2acd0dff1bdf7a76726e2a8949d9a17488fde488cb0f28e942c926778",
  "../src/game/data/map02/CENTRELINE_STATIONS.json":
    "031ecef06520c8895b4aaa10507243df02c6f7e702636d9a0f2687e82663e4bf",
  "../src/game/data/map02/CHECKPOINTS.json":
    "3af5895e69910e77412178570009362572c96f5190a5e498888549b6366ea979",
  "../src/game/data/map02/GRID_AND_RECOVERY.json":
    "5c537f42a0d306ce6c668544001677fc5170a91456d7d027d6878158e8446748",
  "../src/game/data/map02/SECTORS_AND_SEQUENCES.json":
    "a27f7b5ff22880188b62dfe2eb440896c643e50fcb78116d5e026c8f7aab3711",
  "../public/data/map02/MASSING_PLACEMENTS.json":
    "13f73f3634fe76ec6b78ee82fcb4171bf9f180a8b879f06c3aa21d4f2449789e",
  "../public/data/map02/MASSING_LANDMARKS.json":
    "89977c1637a62c2d6c45dd2be6815afd72f5ed12a49bc8c77d8623f1023499a0",
  "../public/data/map02/INTEGRATION_CONTRACT.json":
    "ca818015e58ea9b6f329a32e896a316798c8beb7ef52c78480d81d6f14bb4581",
};

async function acceptedBytes(relativePath) {
  const bytes = await readFile(new URL(relativePath, import.meta.url));
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    expectedHashes[relativePath],
    `${relativePath} differs from the accepted Map 02 candidate.`,
  );
  return bytes;
}

function json(bytes) {
  return JSON.parse(bytes.toString("utf8"));
}

function primitiveTriangles(glbJson, primitive) {
  assert.equal(primitive.mode ?? 4, 4, "Map 02 GLB primitives must be triangles.");
  return glbJson.accessors[primitive.indices].count / 3;
}

const loaded = new Map();
for (const relativePath of Object.keys(expectedHashes)) {
  loaded.set(relativePath, await acceptedBytes(relativePath));
}

const centreline = json(loaded.get("../src/game/data/map02/CENTRELINE_STATIONS.json"));
const checkpoints = json(loaded.get("../src/game/data/map02/CHECKPOINTS.json"));
const gridRecovery = json(loaded.get("../src/game/data/map02/GRID_AND_RECOVERY.json"));
const sectors = json(loaded.get("../src/game/data/map02/SECTORS_AND_SEQUENCES.json"));
const placements = json(loaded.get("../public/data/map02/MASSING_PLACEMENTS.json"));
const landmarks = json(loaded.get("../public/data/map02/MASSING_LANDMARKS.json"));
const contract = json(loaded.get("../public/data/map02/INTEGRATION_CONTRACT.json"));

assert.equal(centreline.format, "FUTURISMA_MAP02_BITTERPAN_CENTRELINE");
assert.equal(centreline.final_map02_blockout_freeze, false);
assert.equal(centreline.station_spacing_m, 5);
assert.equal(centreline.station_count, 610);
assert.equal(centreline.stations.length, 610);
assert.ok(Math.abs(centreline.total_length_m - 3050) < 1e-8);
let maximumGrade = 0;
for (let index = 0; index < centreline.stations.length; index += 1) {
  const station = centreline.stations[index];
  const next = centreline.stations[(index + 1) % centreline.stations.length];
  assert.equal(station.i, index);
  assert.equal(station.s, index * 5);
  assert.equal(station.s_registration_error_m, 0);
  assert.ok(station.width_m >= 22 && station.width_m <= 30);
  const horizontal = Math.hypot(next.x - station.x, next.z - station.z);
  maximumGrade = Math.max(maximumGrade, Math.abs(next.y - station.y) / horizontal);
}
assert.ok(maximumGrade <= 0.010501, `Map 02 grade is ${(maximumGrade * 100).toFixed(4)}%.`);

assert.equal(checkpoints.format, "FUTURISMA_MAP02_BITTERPAN_CHECKPOINTS");
assert.equal(checkpoints.final_map02_blockout_freeze, false);
assert.equal(checkpoints.count, 12);
assert.equal(checkpoints.checkpoints.length, 12);
assert.equal(checkpoints.checkpoints[0].id, "CP00");
assert.equal(checkpoints.checkpoints[0].is_lap_trigger, true);
assert.equal(Math.max(...checkpoints.gap_m), 255);
for (let index = 0; index < checkpoints.checkpoints.length; index += 1) {
  assert.equal(checkpoints.checkpoints[index].order, index);
  assert.ok(checkpoints.checkpoints[index].half_width_m > 0);
}

assert.equal(gridRecovery.final_map02_blockout_freeze, false);
assert.equal(gridRecovery.grid.slots, 4);
assert.equal(gridRecovery.grid.transforms.length, 4);
assert.deepEqual(
  gridRecovery.grid.transforms.map((entry) => entry.identity),
  ["WORKS 07", "PRIVATEER 13", "NIGHTFORM 24", "NEEDLE 16"],
);
assert.equal(gridRecovery.recovery.detection_window_s, 1.2);
assert.equal(gridRecovery.recovery.rejoin_delay_s, 1.6);
assert.equal(gridRecovery.recovery.rejoin_speed_fraction, 0.35);
assert.equal(gridRecovery.recovery.rejoin_transform_count, 610);
assert.equal(gridRecovery.recovery.transforms.length, 610);
for (let index = 0; index < gridRecovery.recovery.transforms.length; index += 1) {
  assert.equal(gridRecovery.recovery.transforms[index].station_m, index * 5);
}

assert.equal(sectors.final_map02_blockout_freeze, false);
assert.equal(sectors.sectors.length, 3);
assert.equal(sectors.authored_sequences.length, 12);
assert.equal(placements.final_map02_massing_freeze, false);
assert.equal(placements.placements.length, 226);
assert.equal(landmarks.final_map02_massing_freeze, false);
assert.equal(landmarks.landmarks.length, 31);
assert.equal(contract.final_map02_massing_freeze, false);
assert.equal(contract.load_contract.asynchronous_environment_loads, 1);
assert.equal(contract.load_contract.massing_collision, "none authored in this phase");
assert.equal(contract.budget_contract.draw_calls.combined_visible_actual, 20);
assert.equal(contract.budget_contract.triangles.combined_visible_actual, 11_268);

const track = parseGlb(
  loaded.get("../public/assets/map02/models/bitterpan_blockout.glb"),
).json;
assert.equal(track.asset.version, "2.0");
assert.deepEqual(track.nodes.map((node) => node.name), [
  "GW2_TRACK_BLOCKOUT",
  "GW2_COLLISION_PROXY",
]);
assert.equal(track.meshes[0].primitives.length, 5);
assert.equal(track.meshes[1].primitives.length, 1);
const trackVisibleTriangles = track.meshes[0].primitives.reduce(
  (total, primitive) => total + primitiveTriangles(track, primitive),
  0,
);
const collisionTriangles = track.meshes[1].primitives.reduce(
  (total, primitive) => total + primitiveTriangles(track, primitive),
  0,
);
assert.equal(trackVisibleTriangles, 6100);
assert.equal(collisionTriangles, 4880);

const massing = parseGlb(
  loaded.get("../public/assets/map02/models/bitterpan_massing.glb"),
).json;
assert.equal(massing.asset.version, "2.0");
assert.equal(massing.nodes[0].name, "GW2_SITE_MASSING");
assert.equal(massing.meshes[0].primitives.length, 15);
assert.equal(massing.materials.length, 6);
const massingTriangles = massing.meshes[0].primitives.reduce(
  (total, primitive) => total + primitiveTriangles(massing, primitive),
  0,
);
assert.equal(massingTriangles, 5168);
assert.equal(track.meshes[0].primitives.length + massing.meshes[0].primitives.length, 20);
assert.equal(trackVisibleTriangles + massingTriangles, 11_268);

console.log(
  `Map 02 PASS: ${centreline.stations.length} stations, ${checkpoints.count} ordered checkpoints, 20 visible GLB primitives, ${trackVisibleTriangles + massingTriangles} visible triangles.`,
);
