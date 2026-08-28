import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  parseGlb,
  readZipArchive,
  validateArchivePath,
} from "./lib/greenwater-package-validator.mjs";
import { archiveAvailability, readArchive, skipArchives } from "./lib/archive-root.mjs";
import { LIVERY_ATLAS_ORDER, liveryFor } from "../src/game/liveries.js";

const RACE_PRESENCE_ARCHIVE = "GREENWATER_RACE_PRESENCE_v1.6.zip";

const EXPECTED = Object.freeze({
  runtimeGlb: "4bec092f1c85c78b00a4974532b0dda5f1f89f756d9741535820368e3cfd35ec",
  effectsAtlas: "d5562ae064c9532fd447c89ae013642dc03f72f7354293caa952972ad5af8aa3",
  needleLivery: "2f8b3528845eaa7167062e93ae43fedf74e0d6c2ddc14cea14d565e8ec95dc1c",
  finalArchive: "2bd5adfd1350b2fd2a9302a8f4139918d1e1d0fe3a1b88b4b80f4cffeb4a6b8a",
  finalArchiveBytes: 14_380_913,
  reviewArchive: "94c0b7d58dbb5f4e8cb549259ceabcbacee84cbadcc3393a93ebe4530cd395b9",
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertPng(bytes, width, height, label) {
  assert.equal(
    bytes.subarray(0, 8).toString("hex"),
    "89504e470d0a1a0a",
    `${label} is not a PNG.`,
  );
  assert.equal(bytes.readUInt32BE(8), 13, `${label} has an invalid IHDR length.`);
  assert.equal(bytes.subarray(12, 16).toString("ascii"), "IHDR");
  assert.equal(bytes.readUInt32BE(16), width, `${label} width is wrong.`);
  assert.equal(bytes.readUInt32BE(20), height, `${label} height is wrong.`);
  assert.equal(bytes.readUInt8(24), 8, `${label} must use 8-bit channels.`);
  assert.equal(bytes.readUInt8(25), 6, `${label} must be RGBA.`);
}

const runtimeBytes = await readFile(
  new URL("../public/assets/totem/models/totem_runtime.glb", import.meta.url),
);
assert.equal(sha256(runtimeBytes), EXPECTED.runtimeGlb);
const runtime = parseGlb(runtimeBytes, "Greenwater Race Presence v1.6 TOTEM");
const { json } = runtime;
assert.equal(json.nodes?.length, 53);
assert.equal(json.meshes?.length, 18);
assert.equal(json.materials?.length, 4);
assert.equal(json.textures?.length, 2);
assert.equal(json.images?.length, 2);
assert.equal(json.animations, undefined);
assert.equal(json.skins, undefined);

const primitives = json.meshes.flatMap((mesh) => mesh.primitives ?? []);
assert.equal(primitives.length, 18);
const materialByName = new Map(json.materials.map((material) => [material.name, material]));
const body = materialByName.get("TOTEM_body");
assert.equal(body?.pbrMetallicRoughness?.roughnessFactor, 0.78);
assert.equal(body?.pbrMetallicRoughness?.metallicFactor, 0.14);
const emissive = materialByName.get("TOTEM_emissive");
assert.equal(
  emissive?.extensions?.KHR_materials_emissive_strength?.emissiveStrength,
  0.78,
);
const glass = materialByName.get("TOTEM_glass");
assert.equal(glass?.pbrMetallicRoughness?.roughnessFactor, 0.3);
assert.equal(glass?.pbrMetallicRoughness?.metallicFactor, 0.08);

for (const name of ["steering_fin_L_pivot", "steering_fin_R_pivot"]) {
  const node = json.nodes.find((candidate) => candidate.name === name);
  assert.ok(node, `The v1.6 runtime is missing ${name}.`);
  assert.equal(node.matrix?.[13], 0.02, `${name} is not baked onto its boom.`);
}

let visibleTriangles = 0;
let collisionLineSegments = 0;
for (const primitive of primitives) {
  const vertexOrIndexCount = primitive.indices === undefined
    ? json.accessors[primitive.attributes.POSITION].count
    : json.accessors[primitive.indices].count;
  const material = json.materials[primitive.material];
  if (material.name === "TOTEM_collision") {
    assert.equal(primitive.mode, 1, "The collision proxy must remain line-only at runtime.");
    collisionLineSegments += vertexOrIndexCount / 2;
  } else {
    assert.ok(primitive.mode === undefined || primitive.mode === 4);
    visibleTriangles += vertexOrIndexCount / 3;
  }
}
assert.equal(visibleTriangles, 6114);
assert.equal(collisionLineSegments, 108);

const effectsAtlasBytes = await readFile(
  new URL("../public/assets/totem/textures/totem_race_presence_fx_256.png", import.meta.url),
);
assert.equal(sha256(effectsAtlasBytes), EXPECTED.effectsAtlas);
assertPng(effectsAtlasBytes, 256, 256, "Race-presence effects atlas");

const needleBytes = await readFile(
  new URL("../public/assets/totem/textures/totem_decals_1024_needle.png", import.meta.url),
);
assert.equal(sha256(needleBytes), EXPECTED.needleLivery);
assertPng(needleBytes, 1024, 1024, "NEEDLE 16 livery");

const raceArchive = archiveAvailability([RACE_PRESENCE_ARCHIVE]);
let provenanceSummary;
if (!raceArchive.available) {
  // Provenance payloads are not part of a code-only checkout. Skip the
  // archive audit instead of gating every feature branch on it; the served
  // asset hashes above and the source contracts below still run.
  skipArchives(`${raceArchive.reason} — Race Presence provenance not audited`);
  provenanceSummary = "the v1.6 final freeze was NOT audited (archive absent)";
} else {
  const finalArchiveBytes = await readArchive("GREENWATER_RACE_PRESENCE_v1.6.zip");
  assert.equal(finalArchiveBytes.length, EXPECTED.finalArchiveBytes);
  assert.equal(
    sha256(finalArchiveBytes),
    EXPECTED.finalArchive,
    "The preserved Race Presence v1.6 final freeze differs from the accepted archive.",
  );

  const archivedFiles = readZipArchive(finalArchiveBytes);
  assert.equal(archivedFiles.size, 65, "The v1.6 final freeze must contain 65 entries.");
  const finalRoot = "GREENWATER_RACE_PRESENCE_v1.6/";
  const finalFiles = new Map();
  for (const [archivePath, bytes] of archivedFiles) {
    assert.ok(
      archivePath.startsWith(finalRoot),
      `The v1.6 final freeze contains a file outside ${finalRoot}.`,
    );
    const logicalPath = validateArchivePath(archivePath.slice(finalRoot.length));
    assert.ok(!finalFiles.has(logicalPath), `The v1.6 final freeze repeats ${logicalPath}.`);
    finalFiles.set(logicalPath, bytes);
  }

  const finalManifest = JSON.parse(finalFiles.get("MANIFEST.json").toString("utf8"));
  assert.equal(finalManifest.format, "GREENWATER_RACE_PRESENCE_V16_MANIFEST");
  assert.equal(finalManifest.version, "v1.6-final");
  assert.equal(finalManifest.package, "GREENWATER_RACE_PRESENCE_v1.6.zip");
  assert.equal(finalManifest.root_folder, finalRoot);
  assert.equal(finalManifest.final_v16_freeze, true);
  assert.equal(finalManifest.production_assets_identical, true);
  assert.equal(finalManifest.re_baselined, false);
  assert.equal(finalManifest.map_02_started, false);
  assert.equal(finalManifest.accepted_review.sha256, EXPECTED.reviewArchive);
  assert.equal(finalManifest.accepted_review.bytes, 12_023_478);
  assert.equal(finalManifest.accepted_review.zip_entries, 62);
  assert.equal(finalManifest.accepted_review.manifest_records, 61);
  assert.equal(finalManifest.entry_count, 65);
  assert.equal(finalManifest.manifest_record_count, 64);
  assert.equal(finalManifest.files.length, 64);
  assert.deepEqual(finalManifest.prior_freeze_flags, {
    final_v12_freeze: true,
    final_v13_freeze: true,
    final_v14_freeze: true,
    final_v15_freeze: true,
  });
  assert.equal(finalManifest.integration_measurement.recorded_verbatim, true);
  assert.equal(finalManifest.integration_measurement.measured_by, "Codex");
  assert.equal(finalManifest.integration_measurement.measured_by_design_agent, false);
  assert.equal(finalManifest.integration_measurement.integration_gates.length, 8);
  assert.ok(
    finalManifest.integration_measurement.integration_gates.every((gate) => gate.status === "PASS"),
    "Every v1.6 integration gate must remain passing.",
  );

  const declaredFinalPaths = new Set();
  for (const record of finalManifest.files) {
    const logicalPath = validateArchivePath(record.path);
    assert.notEqual(logicalPath, "MANIFEST.json", "The v1.6 manifest cannot hash itself.");
    assert.ok(!declaredFinalPaths.has(logicalPath), `The v1.6 manifest repeats ${logicalPath}.`);
    const bytes = finalFiles.get(logicalPath);
    assert.ok(bytes, `The v1.6 manifest declares missing file ${logicalPath}.`);
    assert.equal(bytes.length, record.bytes, `${logicalPath} differs from its v1.6 byte count.`);
    assert.equal(sha256(bytes), record.sha256, `${logicalPath} differs from its v1.6 hash.`);
    declaredFinalPaths.add(logicalPath);
  }
  assert.equal(finalFiles.size, declaredFinalPaths.size + 1);
  for (const logicalPath of finalFiles.keys()) {
    assert.ok(
      logicalPath === "MANIFEST.json" || declaredFinalPaths.has(logicalPath),
      `The v1.6 final freeze contains undeclared file ${logicalPath}.`,
    );
  }

  const archivedRuntime = finalFiles.get("models/totem_runtime.glb");
  const archivedEffects = finalFiles.get("textures/totem_race_presence_fx_256.png");
  const archivedNeedle = finalFiles.get("textures/totem_decals_1024_needle.png");
  assert.ok(archivedRuntime.equals(runtimeBytes), "The served TOTEM differs from the v1.6 freeze.");
  assert.ok(archivedEffects.equals(effectsAtlasBytes), "The served effects atlas differs from the v1.6 freeze.");
  assert.ok(archivedNeedle.equals(needleBytes), "The served NEEDLE 16 livery differs from the v1.6 freeze.");
  provenanceSummary = "the 65-entry final freeze and all 64 manifest records are byte-locked";
}

const [
  totemSource,
  presenceSource,
  rivalsSource,
  profilesSource,
  liveriesSource,
] = await Promise.all([
  readFile(new URL("../src/game/totem.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/game/race-presence.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/game/rivals.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/game/rival-race.js", import.meta.url), "utf8"),
  readFile(new URL("../src/game/liveries.js", import.meta.url), "utf8"),
]);
assert.doesNotMatch(totemSource, /STEERING_FIN_VERTICAL_CORRECTION_METERS/);
assert.doesNotMatch(totemSource, /seatSteeringFinsOnBooms/);
// P7 moved the decal-sheet table out of rivals.ts into liveries.js, which the
// player's livery select and the rival atlas now both read. The served NEEDLE
// sheet must still reach the field, so assert the table names it and that
// rivals.ts still builds its atlas from that table.
assert.equal(
  liveryFor("needle").texture,
  "/assets/totem/textures/totem_decals_1024_needle.png",
  "The NEEDLE 16 livery must resolve to the served decal sheet.",
);
assert.equal(liveryFor("needle").label, "NEEDLE 16");
assert.deepEqual(
  LIVERY_ATLAS_ORDER,
  ["privateer", "nightform", "needle", "works"],
  "The atlas quadrant order is what decides which decal each rival wears.",
);
assert.match(
  rivalsSource,
  /LIVERY_ATLAS_ORDER\.map\(\(code\) => liveryFor\(code\)\.texture\)/,
  "rivals.ts must build its livery atlas from the shared livery table.",
);
assert.doesNotMatch(
  liveriesSource,
  /https?:\/\//,
  "The livery table must reference served paths, never a remote host.",
);
assert.match(profilesSource, /id: "rival-needle"/);
assert.match(profilesSource, /name: "NEEDLE 16"/);
assert.match(profilesSource, /engineTint: "#d2c8ad"/);

for (const slot of [
  "idle_hover_discharge",
  "acceleration_exhaust",
  "boost_core_flare",
  "braking_energy",
  "wet_deck_spray",
  "shallow_water_mist",
  "impact_spark",
  "ion_distortion_mask",
]) {
  assert.match(presenceSource, new RegExp(`\\b${slot}\\b`), `Missing effect slot ${slot}.`);
}
assert.match(presenceSource, /maximumDrawCalls: 3/);
assert.match(presenceSource, /maximumInstances: 11/);
assert.match(presenceSource, /NearestMipmapNearestFilter/);
assert.match(presenceSource, /depthWrite: false/);
assert.match(presenceSource, /THREE\.AdditiveBlending/);
assert.match(presenceSource, /THREE\.NormalBlending/);

// Rivals articulate a left/right pair from one instanced mesh, which only works
// while (a) each pivot is a rigid unit-scale transform — otherwise
// `pose * pivot * rotation(axis, angle)` stops matching what the player's node
// hierarchy does — and (b) both sides carry byte-identical pivot-local
// geometry, which is what lets them share it. Re-exported art that breaks
// either falls back to a welded hull, so assert it at the asset instead.
const meshIndexByNodeName = new Map(
  json.nodes.filter((node) => node.mesh !== undefined).map((node) => [node.name, node.mesh]),
);
const floatAttribute = (meshIndex, name) => {
  const primitive = json.meshes[meshIndex].primitives[0];
  const accessor = json.accessors[primitive.attributes[name]];
  assert.ok(accessor, `TOTEM primitive is missing ${name}.`);
  assert.equal(accessor.componentType, 5126, `TOTEM ${name} must be float32.`);
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type];
  const view = json.bufferViews[accessor.bufferView];
  assert.equal(
    view.byteStride ?? components * 4,
    components * 4,
    `TOTEM ${name} must be tightly packed.`,
  );
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const values = new Float32Array(accessor.count * components);
  for (let index = 0; index < values.length; index += 1) {
    values[index] = runtime.binary.readFloatLE(start + index * 4);
  }
  return values;
};
const maximumDifference = (left, right) => {
  assert.equal(left.length, right.length, "Attribute lengths differ.");
  let worst = 0;
  for (let index = 0; index < left.length; index += 1) {
    worst = Math.max(worst, Math.abs(left[index] - right[index]));
  }
  return worst;
};
/**
 * Measured on the v1.6 freeze: the sides' baked shading diverges by at most
 * 0.162 (steering fins) because the panel variation is hashed per part name.
 * The runtime restores each side's mean brightness through the instance colour
 * and accepts the finer variation of the reference side; this ceiling exists so
 * a genuinely different right-hand side gets caught rather than silently
 * inheriting the left's shading.
 */
const MAXIMUM_SIDE_SHADING_DIVERGENCE = 0.25;

// The rival draw-call and triangle budget is computed from this split, so pin
// it: 5 body/emissive/glass batches plus the engine glow and the shared shadow
// blobs is 7 rival draw calls, and 6,114 visible triangles per craft is 18,342
// across the field however they are partitioned.
const parentByChild = new Map();
json.nodes.forEach((node, index) => {
  for (const child of node.children ?? []) parentByChild.set(child, index);
});
const ARTICULATED_PIVOTS = new Set([
  "steering_fin_L_pivot", "steering_fin_R_pivot",
  "airbrake_L_pivot", "airbrake_R_pivot",
]);
const rivalBatchTriangles = new Map();
json.nodes.forEach((node, index) => {
  if (node.mesh === undefined) return;
  for (const primitive of json.meshes[node.mesh].primitives) {
    const material = json.materials[primitive.material]?.name;
    if (material === "TOTEM_collision") continue;
    let group = "hull";
    for (let cursor = index; cursor !== undefined; cursor = parentByChild.get(cursor)) {
      const name = json.nodes[cursor].name;
      if (ARTICULATED_PIVOTS.has(name)) {
        group = name.startsWith("steering_fin") ? "steering_fins" : "airbrakes";
        break;
      }
    }
    const key = `${material}/${group}`;
    const accessor = json.accessors[
      primitive.indices ?? primitive.attributes.POSITION
    ];
    rivalBatchTriangles.set(key, (rivalBatchTriangles.get(key) ?? 0) + accessor.count / 3);
  }
});
assert.deepEqual(
  Object.fromEntries([...rivalBatchTriangles.entries()].sort()),
  {
    "TOTEM_body/airbrakes": 56,
    "TOTEM_body/hull": 5794,
    "TOTEM_body/steering_fins": 56,
    "TOTEM_emissive/hull": 108,
    "TOTEM_glass/hull": 100,
  },
  "The rival batch split changed; the P2 draw-call and triangle budget is "
    + "derived from it.",
);
for (const [left, right] of [
  ["steering_fin_L", "steering_fin_R"],
  ["airbrake_L", "airbrake_R"],
]) {
  for (const side of [left, right]) {
    const node = json.nodes.find((candidate) => candidate.name === `${side}_pivot`);
    assert.ok(node?.matrix, `${side}_pivot must carry a baked matrix.`);
    for (const [index, label] of [[0, "x"], [4, "y"], [8, "z"]]) {
      const length = Math.hypot(
        node.matrix[index],
        node.matrix[index + 1],
        node.matrix[index + 2],
      );
      assert.ok(
        Math.abs(length - 1) < 1e-6,
        `${side}_pivot ${label} basis is scaled (${length}); instanced rival `
          + "articulation requires a rigid pivot.",
      );
    }
  }
  const leftMesh = meshIndexByNodeName.get(`${left}_body`);
  const rightMesh = meshIndexByNodeName.get(`${right}_body`);
  for (const attribute of ["POSITION", "NORMAL", "TEXCOORD_0"]) {
    assert.ok(
      maximumDifference(
        floatAttribute(leftMesh, attribute),
        floatAttribute(rightMesh, attribute),
      ) < 1e-6,
      `${left}_body and ${right}_body no longer share pivot-local ${attribute}; `
        + "the rival pair would cost two draw calls instead of one.",
    );
  }
  const shadingDivergence = maximumDifference(
    floatAttribute(leftMesh, "COLOR_0"),
    floatAttribute(rightMesh, "COLOR_0"),
  );
  assert.ok(
    shadingDivergence <= MAXIMUM_SIDE_SHADING_DIVERGENCE,
    `${left}_body and ${right}_body baked shading now diverges by `
      + `${shadingDivergence.toFixed(3)}, past the ${MAXIMUM_SIDE_SHADING_DIVERGENCE} `
      + "ceiling for sharing one geometry between the sides.",
  );
}

console.log(
  `Race Presence v1.6 PASS: ${provenanceSummary}; baked steering pivots, 6,114 visible triangles, 108 collision lines, one 256px eight-slot effects atlas, three blend-family batches, and NEEDLE 16 rival identity match ${raceArchive.available ? "the accepted archive" : "the served bytes and source contracts"}.`,
);
