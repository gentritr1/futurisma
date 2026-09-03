import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  ASSET_KIT_PROP_PLACEMENTS,
  ASSET_KIT_REQUIRED_PROP_NAMES,
} from "../src/game/asset-kit-layout.js";
import {
  parseGlb,
  readZipArchive,
  validateArchivePath,
} from "./lib/greenwater-package-validator.mjs";
import { readArchive, requireArchivesOrSkip } from "./lib/archive-root.mjs";

// Every accepted art package this validator audits, named relative to the
// archive root. A checkout without them skips provenance instead of failing;
// a checkout that has them keeps the byte-for-byte assertions below.
const REQUIRED_ARCHIVES = [
  "GREENWATER_ENVIRONMENT_v1.0.zip",
  "GREENWATER_VISUAL_IDENTITY_v1.2.zip",
  "GREENWATER_LIVING_WORLD_v1.3.zip",
  "GREENWATER_SURFACE_CHARACTER_v1.4_REVIEW.zip",
  "GREENWATER_SURFACE_CHARACTER_v1.4.zip",
  "GREENWATER_FACILITY_STORY_v1.5_PROVENANCE_GAP.json",
  "quarantine/GREENWATER_FACILITY_STORY_v1.5_REVIEW_REJECTED_4c1f3da4.zip",
  "GREENWATER_FACILITY_STORY_v1.5.zip",
];

const expectedHashes = {
  "models/futurisma_asset_kit.glb": "9cf2346b81ccbe2136fedaa78967d22a38a2017b043b005a2ab040fda1df5226",
  "models/totem_runtime.glb": "4bec092f1c85c78b00a4974532b0dda5f1f89f756d9741535820368e3cfd35ec",
  "textures/totem_decals_1024_needle.png": "2f8b3528845eaa7167062e93ae43fedf74e0d6c2ddc14cea14d565e8ec95dc1c",
  "textures/totem_decals_1024_nightform.png": "cac80bb0ffb70bbd23d2c216efb3a5d44379e5b7674d5badb02a36cc9253e1b4",
  "textures/totem_decals_1024_privateer.png": "98346872ed757bbe8db610ac35f2a6f243e8cfba681fdf5d936a6e0bdd1bd226",
  "textures/totem_decals_1024_works.png": "fbd124bc75286269acfe7a839309e24f1a21600e93ecc1db00b104adc610da73",
  "textures/totem_emissive_512.png": "05268acb88d36c4936f6b4424dd7bdf66eebf1ced217a1f0630b3ca12b53e521",
  "textures/totem_race_presence_fx_256.png": "d5562ae064c9532fd447c89ae013642dc03f72f7354293caa952972ad5af8aa3",
  "logos/kairo-dynamics.svg": "95b446999c52f9e340d25df05537b02ef2d6fcfe62fabcd62881fcf0662388c0",
  "logos/totem-syndicate.svg": "506a73cb8de719bf870d3841d51340265066645a6a87b5088189bd03dcc90b7d",
};

/**
 * Art-pass sheets, under `public/assets/`.
 *
 * These seven are NOT archive-provenanced like the accepted Greenwater
 * packages: they are emitted by `scripts/design/build-futurisma-atlases.mjs`,
 * which is deterministic and ships in the repo, so the builder is the
 * provenance and these are the hashes it printed. Regenerate with
 * `node scripts/design/build-futurisma-atlases.mjs --check --out .` rather than
 * editing a PNG — `scripts/validate-art-pass.mjs` additionally pins each sheet
 * against the sha256 recorded beside its regions in ATLAS_REGIONS.json, so a
 * sheet and its UV rectangles can never drift apart.
 *
 * The first three are P12 (art pass 01); the next four are P15 (art pass 02) —
 * the Bitterpan pan crust tile and its decal sheet, the Hangar Six fixture
 * panels, and the TOTEM livery wear overlay. The last three are P18 (art pass
 * 03) — the world past the barriers.
 *
 * Regenerating: the builder's `--out` defaults to `scripts/`, not the repo
 * root, so it must be run as `--out .` from the repo root or it writes a stray
 * `scripts/public/` tree and leaves the served sheets untouched.
 */
const expectedArtPassHashes = {
  "greenwater/textures/greenwater_runway_1024.png":
    "2a77f5362b7750adc7777423cd1f80a521dc7f875053653d486be3874e034ae3",
  "greenwater/textures/futurisma_signage_1024.png":
    "b1652c713929aae661e6d5ce3a2c47444f322f095f3c4fd22faf7d0d8101614f",
  "greenwater/textures/greenwater_motion_b_512.png":
    "a5b4442a7286b3c597abc42bd7cd4373db85f126478561de6cdf9694e9583dfd",
  "map02/textures/bitterpan_crust_tile_256.png":
    "e16c41b45f24debab80526d2d3fa9bc69005e40b270a8f1f0370483f0f74b6fb",
  "map02/textures/bitterpan_crust_1024.png":
    "59d3ca77abdcdc2550698b6fc1f10b58e8a9f13ccc31d8a356b4b7821c915ac6",
  "greenwater/textures/hangar_fixtures_512.png":
    "296531d9bb2c80b979b2390c28fc097fb3dd2090e887207ca5b7d9baacb6629a",
  "totem/textures/totem_wear_1024.png":
    "093033d86282e20eb0e26dbb638ef9c528fd3942fed5d54559043d84e60fe123",
  // P18 (art pass 03): Bitterpan structure facades, the shared distant
  // silhouette card sheet, and the trim sheet that carries both the signage
  // back panels and the Bitterpan road edge band.
  "map02/textures/bitterpan_facades_1024.png":
    "12883ac673abb34060f3be8c9f224f2e45a0a73689b8d19eb1d3fe560b1be0b8",
  "greenwater/textures/futurisma_horizon_1024.png":
    "0ad6d3efe0511ea0872e7582e0b00f8f146d0cbf2ebd585eee70329079e63ca5",
  "greenwater/textures/futurisma_trim_512.png":
    "b27bcae3f44bd1203c6e935bcacd598af2409526832fa7791bf40013842a9318",
  // H2a. The generated horizon sheet, which is the DEFAULT sheet — the P18 one
  // above stays served as `?art=base`. Its provenance is NOT
  // build-futurisma-atlases.mjs but `python3
  // scripts/prepare-higgsfield-textures.py`, which is deterministic, ships in
  // the repo and takes `--check` to re-derive without writing. The inputs it
  // reads are 5-7 MB Higgsfield generations under `assets-in/higgsfield/batch1/`
  // and are gitignored: they are raw generations, not source art, and this
  // sheet is the artefact.
  "greenwater/textures/futurisma_horizon_hf_1024.png":
    "169c30729904ec20edaa44c33298704bb76ce5c387ba39e8f7f9d6256653c967",
};

/**
 * H2a. The served weight of the art pack, asserted rather than described.
 *
 * The phase was given a 2.5 MB raw ceiling for everything it adds under
 * `public/`. It spends 193.3 KiB of it, on one file:
 *
 *   futurisma_horizon_hf_1024.png   197,939 bytes  (+148,922 over the 49,017
 *                                                   the P18 sheet weighs)
 *
 * The "added" column is the honest one: the P18 sheet stays served as the
 * `?art=base` way back, so this costs its own full weight and not a difference.
 *
 * THREE OTHER CANDIDATES WERE PREPARED AND ARE NOT HERE. A generated pan crust
 * tile (428,926 bytes) and facade sheet (664,721) were built, wired, shot at
 * five Bitterpan stations and rejected on the crops — the crust's macro
 * polygons came out about twice the shipping tile's, which makes the 12 m
 * repeat visible, and the facade skins were tone-matched into their sheet
 * closely enough to be hard to tell apart at 2300 m. A brine tile (441,696) had
 * no texture slot to go into. Together they would have been 1,535,343 bytes,
 * roughly eight times what shipped, for changes the review could not see. They
 * are still emitted by the preparation script into `shots/higgsfield/`, which
 * .gitignore covers, so the rejects stay reproducible without being served.
 *
 * This is a TEXTURE, not shell bytes: it is not in the initial JS/CSS that
 * validate-build.mjs weighs, and it is fetched only when a session loads the
 * living-world layer.
 */
const ART_PACK_BYTES = {
  "greenwater/textures/futurisma_horizon_hf_1024.png": 197939,
};
const ART_PACK_RAW_CEILING = 2.5 * 1000 * 1000;

let artPackRawBytes = 0;
for (const [relativePath, expectedHash] of Object.entries(expectedArtPassHashes)) {
  const bytes = await readFile(
    new URL(`../public/assets/${relativePath}`, import.meta.url),
  );
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  assert.equal(
    actualHash,
    expectedHash,
    `${relativePath} is not the sheet the atlas builder emitted.`,
  );
  const expectedBytes = ART_PACK_BYTES[relativePath];
  if (expectedBytes === undefined) continue;
  assert.equal(
    bytes.byteLength,
    expectedBytes,
    `${relativePath} is ${bytes.byteLength} bytes against a pinned `
      + `${expectedBytes}. Re-run \`python3 scripts/prepare-higgsfield-textures.py\` `
      + "and move the pin WITH the measurement, not ahead of it.",
  );
  artPackRawBytes += bytes.byteLength;
}
assert.equal(
  Object.keys(ART_PACK_BYTES).length,
  1,
  "The art pack is ONE sheet. Round 2 of the review cut it from three; a "
    + "second needs its own budget line and its own crop, not a quiet addition "
    + "to a total.",
);
assert.ok(
  artPackRawBytes <= ART_PACK_RAW_CEILING,
  `The H2a art pack adds ${(artPackRawBytes / 1024).toFixed(1)} KiB raw under `
    + `public/, over its ${(ART_PACK_RAW_CEILING / 1024).toFixed(1)} KiB ceiling.`,
);

let assetKitBytes;
for (const [relativePath, expectedHash] of Object.entries(expectedHashes)) {
  const bytes = await readFile(
    new URL(`../public/assets/totem/${relativePath}`, import.meta.url),
  );
  if (relativePath === "models/futurisma_asset_kit.glb") assetKitBytes = bytes;
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  assert.equal(actualHash, expectedHash, `${relativePath} differs from the accepted package.`);
}

assert.ok(assetKitBytes, "The accepted asset-kit GLB must be present.");
assert.equal(assetKitBytes.subarray(0, 4).toString("utf8"), "glTF");
assert.equal(assetKitBytes.readUInt32LE(4), 2, "The asset kit must be glTF 2.0.");
let assetKitJson;
let offset = 12;
while (offset < assetKitBytes.length) {
  const chunkLength = assetKitBytes.readUInt32LE(offset);
  const chunkType = assetKitBytes.toString("utf8", offset + 4, offset + 8);
  if (chunkType === "JSON") {
    assetKitJson = JSON.parse(
      assetKitBytes.subarray(offset + 8, offset + 8 + chunkLength).toString("utf8").trim(),
    );
    break;
  }
  offset += 8 + chunkLength;
}
assert.ok(assetKitJson, "The accepted asset kit must contain a JSON chunk.");
const assetKitNodeNames = new Set(assetKitJson.nodes?.map((node) => node.name));
for (const name of ASSET_KIT_REQUIRED_PROP_NAMES) {
  assert.ok(assetKitNodeNames.has(name), `The accepted asset kit is missing ${name}.`);
}
for (const placement of ASSET_KIT_PROP_PLACEMENTS) {
  assert.ok(Number.isFinite(placement.distance) && placement.distance >= 0);
  assert.ok(Number.isFinite(placement.lateral));
  assert.ok(Number.isFinite(placement.yaw));
  assert.ok(Number.isFinite(placement.scale) && placement.scale > 0);
}

const archives = requireArchivesOrSkip(REQUIRED_ARCHIVES);

const environmentPackageBytes = await readArchive("GREENWATER_ENVIRONMENT_v1.0.zip");
assert.equal(
  createHash("sha256").update(environmentPackageBytes).digest("hex"),
  "a773bf7f6f7e6ab160dfba385d67455e2ff7a9ade57369fafd416310825564af",
  "The preserved Greenwater v1.0 archive differs from the accepted package.",
);

const finalGreenwaterPackageBytes = await readArchive("GREENWATER_VISUAL_IDENTITY_v1.2.zip");
assert.equal(
  createHash("sha256").update(finalGreenwaterPackageBytes).digest("hex"),
  "13da5c6212ab98e95956db063fa671cb0f484a9e3861abf0e40cf973de07782a",
  "The preserved Greenwater v1.2 final freeze differs from the accepted package.",
);
const finalGreenwaterArchive = readZipArchive(finalGreenwaterPackageBytes);
assert.equal(finalGreenwaterArchive.size, 59, "The final Greenwater archive must contain 59 files.");
const finalGreenwaterRoot = "GREENWATER_VISUAL_IDENTITY_v1.2/";
const finalGreenwaterFiles = new Map();
for (const [archivePath, bytes] of finalGreenwaterArchive) {
  assert.ok(
    archivePath.startsWith(finalGreenwaterRoot),
    `The final Greenwater archive contains a file outside ${finalGreenwaterRoot}.`,
  );
  const logicalPath = validateArchivePath(archivePath.slice(finalGreenwaterRoot.length));
  assert.ok(!finalGreenwaterFiles.has(logicalPath), `The final Greenwater archive repeats ${logicalPath}.`);
  finalGreenwaterFiles.set(logicalPath, bytes);
}
const finalGreenwaterManifest = JSON.parse(
  finalGreenwaterFiles.get("MANIFEST.json").toString("utf8"),
);
assert.equal(finalGreenwaterManifest.format, "GREENWATER_VISUAL_IDENTITY_V12_MANIFEST");
assert.equal(finalGreenwaterManifest.version, "v1.2-final");
assert.equal(finalGreenwaterManifest.package, "GREENWATER_VISUAL_IDENTITY_v1.2.zip");
assert.equal(finalGreenwaterManifest.final_v12_freeze, true);
assert.equal(
  finalGreenwaterManifest.accepted_review?.sha256,
  "89c31d61e727ea11bee05694ee9374c91952c0871a1c403fecca3142be88b7e2",
);
assert.equal(finalGreenwaterManifest.accepted_review?.assets_identical, true);
assert.ok(finalGreenwaterManifest.source_snapshot?.complete);
assert.ok(finalGreenwaterManifest.gates.every((gate) => gate.pass));
assert.deepEqual(finalGreenwaterManifest.totals, {
  upgrade_placements: 134,
  total_placements: 2401,
  merged_meshes: 63,
  authored_triangles: 60_138,
  worst_visible_draw_calls: 19,
  worst_visible_triangles: 26_028,
  materials: 6,
  textures: 6,
});
assert.equal(finalGreenwaterManifest.files.length, 58);
const declaredFinalGreenwaterPaths = new Set();
for (const record of finalGreenwaterManifest.files) {
  const logicalPath = validateArchivePath(record.path);
  assert.notEqual(logicalPath, "MANIFEST.json", "The final manifest cannot hash itself.");
  assert.ok(!declaredFinalGreenwaterPaths.has(logicalPath), `The final manifest repeats ${logicalPath}.`);
  const bytes = finalGreenwaterFiles.get(logicalPath);
  assert.ok(bytes, `The final manifest declares missing file ${logicalPath}.`);
  assert.equal(bytes.length, record.bytes, `${logicalPath} differs from the final manifest byte count.`);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    record.sha256,
    `${logicalPath} differs from the final manifest hash.`,
  );
  declaredFinalGreenwaterPaths.add(logicalPath);
}
assert.equal(declaredFinalGreenwaterPaths.size + 1, finalGreenwaterFiles.size);
for (const logicalPath of finalGreenwaterFiles.keys()) {
  assert.ok(
    logicalPath === "MANIFEST.json" || declaredFinalGreenwaterPaths.has(logicalPath),
    `The final Greenwater archive contains undeclared file ${logicalPath}.`,
  );
}
const finalFreezeNotes = finalGreenwaterFiles.get("V12_FREEZE_NOTES.md")?.toString("utf8");
assert.match(finalFreezeNotes, /accepted final v1\.2 freeze/i);
assert.doesNotMatch(finalFreezeNotes, /not the final v1\.2 freeze/i);

const finalLivingWorldPackageBytes = await readArchive("GREENWATER_LIVING_WORLD_v1.3.zip");
assert.equal(
  createHash("sha256").update(finalLivingWorldPackageBytes).digest("hex"),
  "72984328ef3005619e4c69991da46c1c9e21282a113d1b3ffc873a57e9b3191c",
  "The preserved Greenwater Living World v1.3 freeze differs from the accepted package.",
);
const finalLivingWorldArchive = readZipArchive(finalLivingWorldPackageBytes);
assert.equal(
  finalLivingWorldArchive.size,
  70,
  "The final Greenwater Living World archive must contain 70 files.",
);
const finalLivingWorldRoot = "GREENWATER_LIVING_WORLD_v1.3/";
const finalLivingWorldFiles = new Map();
for (const [archivePath, bytes] of finalLivingWorldArchive) {
  assert.ok(
    archivePath.startsWith(finalLivingWorldRoot),
    `The final Living World archive contains a file outside ${finalLivingWorldRoot}.`,
  );
  const logicalPath = validateArchivePath(
    archivePath.slice(finalLivingWorldRoot.length),
  );
  assert.ok(
    !finalLivingWorldFiles.has(logicalPath),
    `The final Living World archive repeats ${logicalPath}.`,
  );
  finalLivingWorldFiles.set(logicalPath, bytes);
}
const finalLivingWorldManifest = JSON.parse(
  finalLivingWorldFiles.get("MANIFEST.json").toString("utf8"),
);
assert.equal(
  finalLivingWorldManifest.format,
  "GREENWATER_LIVING_WORLD_V13_FREEZE_MANIFEST",
);
assert.equal(finalLivingWorldManifest.version, "v1.3-final");
assert.equal(finalLivingWorldManifest.package, "GREENWATER_LIVING_WORLD_v1.3.zip");
assert.equal(finalLivingWorldManifest.final_v13_freeze, true);
assert.equal(finalLivingWorldManifest.final_v12_freeze, true);
assert.equal(
  finalLivingWorldManifest.built_on?.sha256,
  "13da5c6212ab98e95956db063fa671cb0f484a9e3861abf0e40cf973de07782a",
);
assert.equal(finalLivingWorldManifest.built_on?.altered, false);
assert.equal(finalLivingWorldManifest.built_on?.re_baselined, false);
assert.equal(
  finalLivingWorldManifest.accepted_review?.sha256,
  "73acf9125abd34389c74b3e4b6dfa972e5393163feaecce47571d6bcc58ce56f",
);
assert.equal(
  finalLivingWorldManifest.accepted_review?.production_assets_identical,
  true,
);
assert.deepEqual(finalLivingWorldManifest.integration_measurement?.render, {
  internal_resolution: "1600x900",
  mode: "forced high-quality",
});
assert.equal(finalLivingWorldManifest.integration_measurement?.lap_s, 34.483);
assert.equal(finalLivingWorldManifest.integration_measurement?.frame_time_p95_ms, 10);
assert.equal(finalLivingWorldManifest.integration_measurement?.frame_time_max_ms, 15.8);
assert.deepEqual(finalLivingWorldManifest.integration_measurement?.peak_complete_scene, {
  draw_calls: 76,
  triangles: 43_766,
});
assert.deepEqual(finalLivingWorldManifest.integration_measurement?.peak_authored_environment, {
  groups: 18,
  triangles: 26_028,
});
assert.deepEqual(finalLivingWorldManifest.integration_measurement?.living_layer, {
  draw_calls: 4,
  triangles: 310,
  cards: 155,
  updaters: 1,
  update_hz: 30,
});
assert.ok(finalLivingWorldManifest.source_snapshot?.complete);
assert.deepEqual(
  finalLivingWorldManifest.source_snapshot?.dependency_closure?.unresolved,
  [],
);
assert.equal(finalLivingWorldManifest.gates.length, 47);
assert.ok(finalLivingWorldManifest.gates.every((gate) => gate.pass));
assert.deepEqual(finalLivingWorldManifest.totals, {
  upgrade_placements: 134,
  total_placements: 2401,
  merged_meshes: 63,
  authored_triangles: 60_138,
  worst_visible_draw_calls: 19,
  worst_visible_triangles: 26_028,
  materials: 6,
  textures: 6,
});
assert.equal(finalLivingWorldManifest.files.length, 69);
const declaredFinalLivingWorldPaths = new Set();
for (const record of finalLivingWorldManifest.files) {
  const logicalPath = validateArchivePath(record.path);
  assert.notEqual(logicalPath, "MANIFEST.json", "The v1.3 manifest cannot hash itself.");
  assert.ok(
    !declaredFinalLivingWorldPaths.has(logicalPath),
    `The v1.3 manifest repeats ${logicalPath}.`,
  );
  const bytes = finalLivingWorldFiles.get(logicalPath);
  assert.ok(bytes, `The v1.3 manifest declares missing file ${logicalPath}.`);
  assert.equal(bytes.length, record.bytes, `${logicalPath} differs from its v1.3 byte count.`);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    record.sha256,
    `${logicalPath} differs from its v1.3 manifest hash.`,
  );
  declaredFinalLivingWorldPaths.add(logicalPath);
}
assert.equal(declaredFinalLivingWorldPaths.size + 1, finalLivingWorldFiles.size);
for (const logicalPath of finalLivingWorldFiles.keys()) {
  assert.ok(
    logicalPath === "MANIFEST.json" || declaredFinalLivingWorldPaths.has(logicalPath),
    `The final Living World archive contains undeclared file ${logicalPath}.`,
  );
}
const finalLivingWorldNotes = finalLivingWorldFiles
  .get("V13_FREEZE_NOTES.md")
  ?.toString("utf8");
assert.match(finalLivingWorldNotes, /deterministic final v1\.3 freeze/i);
assert.match(finalLivingWorldNotes, /nothing here claims final acceptance/i);

const finalMotionManifest = JSON.parse(
  finalLivingWorldFiles.get("data/GW_MOTION_MANIFEST.json").toString("utf8"),
);
assert.equal(finalMotionManifest.format, "GREENWATER_MOTION_MANIFEST");
assert.equal(finalMotionManifest.update_hz, 30);
assert.equal(finalMotionManifest.effects.length, 11);
assert.equal(finalMotionManifest.budget?.added_draw_calls, 4);
assert.equal(finalMotionManifest.budget?.per_object_loops, 0);
assert.deepEqual(finalMotionManifest.measured?.per_batch, [
  { name: "GW_LIVING_AIR", cards: 58, triangles: 116, draw_calls: 1 },
  { name: "GW_LIVING_WATER", cards: 44, triangles: 88, draw_calls: 1 },
  { name: "GW_LIVING_FOLIAGE", cards: 36, triangles: 72, draw_calls: 1 },
  { name: "GW_LIVING_LAMPS", cards: 17, triangles: 34, draw_calls: 1 },
]);
assert.equal(finalMotionManifest.measured?.cards, 155);
assert.equal(finalMotionManifest.measured?.triangles, 310);

const finalProjectedReadability = JSON.parse(
  finalLivingWorldFiles.get("data/GW_PROJECTED_READABILITY.json").toString("utf8"),
);
assert.equal(finalProjectedReadability.fog_mode, "FogExp2");
assert.equal(finalProjectedReadability.stations.length, 8);
assert.equal(finalProjectedReadability.rows.length, 34);
assert.equal(finalProjectedReadability.fuel.length, 26);
assert.equal(finalProjectedReadability.route_obstructed, 0);
assert.equal(finalProjectedReadability.obstruction_px, 0);
assert.ok(
  finalProjectedReadability.fuel.every(
    (row) => row.living_obstruction_px === 0 && row.route_obstructed === false,
  ),
  "Every v1.3 Fuel Row chase sample must preserve the projected route opening.",
);

const finalSectorPalette = JSON.parse(
  finalLivingWorldFiles.get("data/GW_SECTOR_PALETTE.json").toString("utf8"),
);
assert.equal(finalSectorPalette.fog_mode, "FogExp2");
assert.equal(finalSectorPalette.route_opening_m, 105);
assert.equal(finalSectorPalette.sectors.length, 12);
assert.ok(finalSectorPalette.fog.every((entry) => entry.fog_mode === "FogExp2"));

const finalAtlasDiff = JSON.parse(
  finalLivingWorldFiles.get("data/GW_ATLAS_SLOT_DIFF.json").toString("utf8"),
);
assert.equal(finalAtlasDiff.slots_changed, 4);
assert.equal(finalAtlasDiff.slots_identical, 12);
assert.deepEqual(finalAtlasDiff.unexpected_differences, []);

const finalUpgradePlacements = JSON.parse(
  finalLivingWorldFiles
    .get("data/GW_VISUAL_UPGRADE_PLACEMENTS.json")
    .toString("utf8"),
);
assert.equal(finalUpgradePlacements.upgrades.length, 7);
assert.equal(finalUpgradePlacements.totals?.upgrade_placements, 134);
assert.equal(finalUpgradePlacements.clearance_rule?.minimum_structural_clearance_measured_m, 9);
assert.equal(finalUpgradePlacements.clearance_rule?.overhead_span_height_m, 13);
assert.equal(finalUpgradePlacements.clearance_rule?.lowest_overhead_element_m, 11);
assert.equal(finalUpgradePlacements.projected_camera_overlap_test?.samples, 26);
assert.equal(finalUpgradePlacements.projected_camera_overlap_test?.upgrade_px_on_projected_deck, 0);
assert.equal(finalUpgradePlacements.projected_camera_overlap_test?.opening_blocked_samples, 0);

for (const logicalPath of [
  "models/greenwater_environment_runtime.glb",
  "textures/greenwater_signage_1024.png",
  "textures/greenwater_concrete_1024.png",
  "textures/greenwater_metal_1024.png",
  "textures/greenwater_jungle_1024.png",
  "textures/greenwater_water_1024.png",
  "textures/greenwater_emissive_512.png",
]) {
  assert.ok(
    finalLivingWorldFiles.get(logicalPath).equals(finalGreenwaterFiles.get(logicalPath)),
    `The v1.3 freeze changed the accepted v1.2 asset ${logicalPath}.`,
  );
}

const surfaceReviewPackageBytes = await readArchive(
  "GREENWATER_SURFACE_CHARACTER_v1.4_REVIEW.zip",
);
assert.equal(
  createHash("sha256").update(surfaceReviewPackageBytes).digest("hex"),
  "3d92dc8fc69425eb71e8a1072469e2ec5756911163c912432438d9b25e3d12c3",
  "The accepted Greenwater Surface Character v1.4 review differs from the audited package.",
);
const surfaceReviewArchive = readZipArchive(surfaceReviewPackageBytes);
assert.equal(
  surfaceReviewArchive.size,
  111,
  "The Greenwater Surface Character review must contain 111 files.",
);
const surfaceReviewRoot = "GREENWATER_SURFACE_CHARACTER_v1.4_REVIEW/";
const surfaceReviewFiles = new Map();
for (const [archivePath, bytes] of surfaceReviewArchive) {
  assert.ok(
    archivePath.startsWith(surfaceReviewRoot),
    "The Surface Character review contains a file outside " + surfaceReviewRoot + ".",
  );
  const logicalPath = validateArchivePath(archivePath.slice(surfaceReviewRoot.length));
  assert.ok(
    !surfaceReviewFiles.has(logicalPath),
    "The Surface Character review repeats " + logicalPath + ".",
  );
  surfaceReviewFiles.set(logicalPath, bytes);
}
const surfaceReviewManifest = JSON.parse(
  surfaceReviewFiles.get("MANIFEST.json").toString("utf8"),
);
assert.equal(surfaceReviewManifest.format, "GREENWATER_SURFACE_CHARACTER_V14_MANIFEST");
assert.equal(surfaceReviewManifest.version, "v1.4-review");
assert.equal(surfaceReviewManifest.package, "GREENWATER_SURFACE_CHARACTER_v1.4_REVIEW.zip");
assert.equal(surfaceReviewManifest.final_v12_freeze, true);
assert.equal(surfaceReviewManifest.final_v13_freeze, true);
assert.equal(surfaceReviewManifest.final_v14_freeze, false);
assert.equal(
  surfaceReviewManifest.built_on?.sha256,
  "13da5c6212ab98e95956db063fa671cb0f484a9e3861abf0e40cf973de07782a",
);
assert.equal(surfaceReviewManifest.built_on?.altered, false);
assert.equal(surfaceReviewManifest.built_on?.re_baselined, false);
assert.ok(surfaceReviewManifest.source_snapshot?.complete);
assert.ok(surfaceReviewManifest.gates.every((gate) => gate.pass));
assert.equal(surfaceReviewManifest.files.length, 110);
const declaredSurfaceReviewPaths = new Set();
for (const record of surfaceReviewManifest.files) {
  const logicalPath = validateArchivePath(record.path);
  assert.notEqual(logicalPath, "MANIFEST.json", "The v1.4 manifest cannot hash itself.");
  assert.ok(
    !declaredSurfaceReviewPaths.has(logicalPath),
    "The v1.4 manifest repeats " + logicalPath + ".",
  );
  const bytes = surfaceReviewFiles.get(logicalPath);
  assert.ok(bytes, "The v1.4 manifest declares missing file " + logicalPath + ".");
  assert.equal(bytes.length, record.bytes, logicalPath + " differs from its v1.4 byte count.");
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    record.sha256,
    logicalPath + " differs from its v1.4 manifest hash.",
  );
  declaredSurfaceReviewPaths.add(logicalPath);
}
assert.equal(declaredSurfaceReviewPaths.size + 1, surfaceReviewFiles.size);
for (const logicalPath of surfaceReviewFiles.keys()) {
  assert.ok(
    logicalPath === "MANIFEST.json" || declaredSurfaceReviewPaths.has(logicalPath),
    "The Surface Character review contains undeclared file " + logicalPath + ".",
  );
}

const finalSurfacePackageBytes = await readArchive("GREENWATER_SURFACE_CHARACTER_v1.4.zip");
assert.equal(
  createHash("sha256").update(finalSurfacePackageBytes).digest("hex"),
  "3e5f21868be3274116e096dc6b4a3bcc5c0011a7c7a5d8ef9ee93b759740458b",
  "The preserved Greenwater Surface Character v1.4 final freeze differs from the accepted package.",
);
const finalSurfaceArchive = readZipArchive(finalSurfacePackageBytes);
assert.equal(
  finalSurfaceArchive.size,
  111,
  "The final Greenwater Surface Character archive must contain 111 files.",
);
const finalSurfaceRoot = "GREENWATER_SURFACE_CHARACTER_v1.4/";
const finalSurfaceFiles = new Map();
for (const [archivePath, bytes] of finalSurfaceArchive) {
  assert.ok(
    archivePath.startsWith(finalSurfaceRoot),
    "The final Surface Character archive contains a file outside " + finalSurfaceRoot + ".",
  );
  const logicalPath = validateArchivePath(archivePath.slice(finalSurfaceRoot.length));
  assert.ok(
    !finalSurfaceFiles.has(logicalPath),
    "The final Surface Character archive repeats " + logicalPath + ".",
  );
  finalSurfaceFiles.set(logicalPath, bytes);
}
const finalSurfaceManifest = JSON.parse(
  finalSurfaceFiles.get("MANIFEST.json").toString("utf8"),
);
assert.equal(
  finalSurfaceManifest.format,
  "GREENWATER_SURFACE_CHARACTER_V14_FREEZE_MANIFEST",
);
assert.equal(finalSurfaceManifest.version, "v1.4-final");
assert.equal(finalSurfaceManifest.package, "GREENWATER_SURFACE_CHARACTER_v1.4.zip");
assert.equal(finalSurfaceManifest.final_v12_freeze, true);
assert.equal(finalSurfaceManifest.final_v13_freeze, true);
assert.equal(finalSurfaceManifest.final_v14_freeze, true);
assert.equal(
  finalSurfaceManifest.accepted_review?.sha256,
  "3d92dc8fc69425eb71e8a1072469e2ec5756911163c912432438d9b25e3d12c3",
);
assert.equal(finalSurfaceManifest.accepted_review?.production_assets_identical, true);
assert.equal(finalSurfaceManifest.integration_measurement?.recorded_verbatim, true);
assert.deepEqual(finalSurfaceManifest.integration_measurement?.render, {
  internal_resolution: "1600x900",
  mode: "forced high quality",
  pixel_ratio: 1,
});
assert.equal(finalSurfaceManifest.integration_measurement?.lap_s, 34.483);
assert.equal(finalSurfaceManifest.integration_measurement?.frame_time_p95_ms, 9.2);
assert.equal(finalSurfaceManifest.integration_measurement?.frame_time_max_ms, 10.7);
assert.deepEqual(finalSurfaceManifest.integration_measurement?.peak_complete_scene, {
  draw_calls: 82,
  triangles: 44_368,
});
assert.deepEqual(finalSurfaceManifest.integration_measurement?.surface_character, {
  draw_calls: 1,
  meshes: 1,
  triangles: 776,
  materials: 1,
  textures: 1,
  unlit: true,
  static: true,
});
assert.ok(finalSurfaceManifest.source_snapshot?.complete);
assert.ok(finalSurfaceManifest.gates.every((gate) => gate.pass));
assert.equal(finalSurfaceManifest.files.length, 110);
const declaredFinalSurfacePaths = new Set();
for (const record of finalSurfaceManifest.files) {
  const logicalPath = validateArchivePath(record.path);
  assert.notEqual(logicalPath, "MANIFEST.json", "The final v1.4 manifest cannot hash itself.");
  assert.ok(
    !declaredFinalSurfacePaths.has(logicalPath),
    "The final v1.4 manifest repeats " + logicalPath + ".",
  );
  const bytes = finalSurfaceFiles.get(logicalPath);
  assert.ok(bytes, "The final v1.4 manifest declares missing file " + logicalPath + ".");
  assert.equal(bytes.length, record.bytes, logicalPath + " differs from its final v1.4 byte count.");
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    record.sha256,
    logicalPath + " differs from its final v1.4 manifest hash.",
  );
  declaredFinalSurfacePaths.add(logicalPath);
}
assert.equal(declaredFinalSurfacePaths.size + 1, finalSurfaceFiles.size);
for (const logicalPath of finalSurfaceFiles.keys()) {
  assert.ok(
    logicalPath === "MANIFEST.json" || declaredFinalSurfacePaths.has(logicalPath),
    "The final Surface Character archive contains undeclared file " + logicalPath + ".",
  );
}

const permittedSurfaceFreezeDifferences = new Set([
  "MANIFEST.json",
  "VALIDATION.json",
  "V14_FREEZE_NOTES.md",
  "V14_REVIEW_NOTES.md",
  "data/GW_MOTION_MANIFEST.json",
  "data/GW_SURFACE_BUDGET.json",
  "source/greenwater-surface-character.html",
]);
const allSurfacePackagePaths = new Set([
  ...surfaceReviewFiles.keys(),
  ...finalSurfaceFiles.keys(),
]);
for (const logicalPath of allSurfacePackagePaths) {
  if (permittedSurfaceFreezeDifferences.has(logicalPath)) continue;
  assert.ok(
    surfaceReviewFiles.get(logicalPath)?.equals(finalSurfaceFiles.get(logicalPath)),
    "The final v1.4 freeze changed unapproved review file " + logicalPath + ".",
  );
}
assert.ok(surfaceReviewFiles.has("V14_REVIEW_NOTES.md"));
assert.ok(!surfaceReviewFiles.has("V14_FREEZE_NOTES.md"));
assert.ok(finalSurfaceFiles.has("V14_FREEZE_NOTES.md"));
assert.ok(!finalSurfaceFiles.has("V14_REVIEW_NOTES.md"));

const surfaceValidation = JSON.parse(
  finalSurfaceFiles.get("VALIDATION.json").toString("utf8"),
);
assert.equal(surfaceValidation.surface_runtime?.pass, true);
assert.equal(surfaceValidation.surface_runtime?.triangles, 776);
assert.equal(surfaceValidation.surface_runtime?.decoded_triangles, 776);
assert.equal(surfaceValidation.surface_runtime?.decoded_meshes, 1);
assert.equal(surfaceValidation.surface_runtime?.material_matches, true);
assert.equal(surfaceValidation.surface_runtime?.binary_pass, true);
assert.equal(surfaceValidation.surface_runtime?.texture?.differing_px, 0);
assert.equal(surfaceValidation.surface_runtime?.round_trip_parity?.all_identical, true);
assert.ok(surfaceValidation.gates.every((gate) => gate.pass));

const surfaceReadability = JSON.parse(
  finalSurfaceFiles.get("data/GW_SURFACE_READABILITY.json").toString("utf8"),
);
assert.equal(surfaceReadability.rows.length, 34);
assert.equal(surfaceReadability.fuel.length, 26);
assert.equal(surfaceReadability.stations.length, 8);
assert.equal(surfaceReadability.route_illegible, 0);
assert.equal(surfaceReadability.route_discontinuous, 0);
assert.equal(surfaceReadability.route_covered, 0);
assert.equal(surfaceReadability.route_obstructed, 0);
assert.equal(surfaceReadability.overlay_enabled, true);
assert.equal(surfaceReadability.living_enabled, true);

const acceptedSurfaceModelBytes = finalSurfaceFiles.get(
  "models/greenwater_surface_character_runtime.glb",
);
const acceptedSurfaceAtlasBytes = finalSurfaceFiles.get(
  "textures/greenwater_surface_character_512.png",
);
assert.equal(
  createHash("sha256").update(acceptedSurfaceModelBytes).digest("hex"),
  "620417aaa6e512314e98b8758f93c7f9290e01ffc16d5cfc842979c79c65df7b",
);
assert.equal(
  createHash("sha256").update(acceptedSurfaceAtlasBytes).digest("hex"),
  "f6438ee0614671aa0c3cac525081d16cfba984d3860703677a39285b9a103e68",
);
const acceptedSurfaceModel = parseGlb(
  acceptedSurfaceModelBytes,
  "accepted Greenwater Surface Character runtime",
);
assert.equal(acceptedSurfaceModel.json.meshes?.length, 1);
assert.equal(acceptedSurfaceModel.json.materials?.length, 1);
assert.equal(acceptedSurfaceModel.json.textures?.length, 1);
assert.equal(acceptedSurfaceModel.json.images?.length, 1);
const acceptedSurfaceMaterial = acceptedSurfaceModel.json.materials[0];
assert.equal(acceptedSurfaceMaterial.name, "GW_SURFACE_CHARACTER");
assert.equal(acceptedSurfaceMaterial.alphaMode, "BLEND");
assert.ok(acceptedSurfaceMaterial.extensions?.KHR_materials_unlit);
const acceptedSurfacePrimitive = acceptedSurfaceModel.json.meshes[0].primitives[0];
assert.equal(acceptedSurfacePrimitive.mode, 4);
assert.ok(Number.isInteger(acceptedSurfacePrimitive.attributes?.POSITION));
assert.ok(Number.isInteger(acceptedSurfacePrimitive.attributes?.TEXCOORD_0));
assert.ok(Number.isInteger(acceptedSurfacePrimitive.attributes?.COLOR_0));
assert.equal(acceptedSurfacePrimitive.attributes?.NORMAL, undefined);
assert.equal(
  acceptedSurfaceModel.json.accessors[acceptedSurfacePrimitive.indices].count / 3,
  776,
);
const acceptedSurfaceSampler = acceptedSurfaceModel.json.samplers[0];
assert.equal(acceptedSurfaceSampler.magFilter, 9728);
assert.equal(acceptedSurfaceSampler.minFilter, 9728);
const acceptedSurfaceImage = acceptedSurfaceModel.json.images[0];
assert.equal(acceptedSurfaceImage.mimeType, "image/png");
assert.ok(Number.isInteger(acceptedSurfaceImage.bufferView));
const acceptedSurfaceImageView = acceptedSurfaceModel.json.bufferViews[
  acceptedSurfaceImage.bufferView
];
const acceptedSurfaceImageStart = acceptedSurfaceImageView.byteOffset ?? 0;
const acceptedEmbeddedSurfaceAtlas = acceptedSurfaceModel.binary.subarray(
  acceptedSurfaceImageStart,
  acceptedSurfaceImageStart + acceptedSurfaceImageView.byteLength,
);
assert.ok(
  acceptedEmbeddedSurfaceAtlas.equals(acceptedSurfaceAtlasBytes),
  "The embedded and external v1.4 surface atlases differ.",
);

const facilityStoryAcceptedReviewSha256 =
  "4c1b2ddd9cd5fc1fd50899c5caa5f1cc3440d6d4a824acd17c235f2e61723123";
const facilityStoryProvenanceGap = JSON.parse(
  (await readArchive("GREENWATER_FACILITY_STORY_v1.5_PROVENANCE_GAP.json")).toString("utf8"),
);
assert.equal(
  facilityStoryProvenanceGap.format,
  "GREENWATER_FACILITY_STORY_V15_PROVENANCE_GAP",
);
assert.equal(facilityStoryProvenanceGap.status, "accepted_review_bytes_unavailable");
assert.equal(
  facilityStoryProvenanceGap.accepted_review.sha256,
  facilityStoryAcceptedReviewSha256,
);
assert.equal(facilityStoryProvenanceGap.accepted_review.available_locally, false);
assert.equal(facilityStoryProvenanceGap.quarantined_candidate.accepted, false);
assert.equal(
  facilityStoryProvenanceGap.policy.accepted_review_hash_re_baselined,
  false,
);
assert.equal(
  facilityStoryProvenanceGap.policy.quarantined_candidate_must_not_be_presented_as_accepted,
  true,
);
const facilityStoryQuarantinedPackageBytes = await readArchive(
  "quarantine/GREENWATER_FACILITY_STORY_v1.5_REVIEW_REJECTED_4c1f3da4.zip",
);
assert.equal(
  createHash("sha256").update(facilityStoryQuarantinedPackageBytes).digest("hex"),
  "4c1f3da466d6ffdbe58e6990f78cd74a27946aec90b0a1b3d91a29359768c955",
  "The quarantined Facility Story candidate differs from its rejected evidence record.",
);
assert.notEqual(
  createHash("sha256").update(facilityStoryQuarantinedPackageBytes).digest("hex"),
  facilityStoryAcceptedReviewSha256,
  "The quarantined Facility Story candidate must never be treated as the accepted review.",
);
const facilityStoryQuarantinedArchive = readZipArchive(
  facilityStoryQuarantinedPackageBytes,
);
assert.equal(
  facilityStoryQuarantinedArchive.size,
  185,
  "The quarantined Facility Story candidate must contain 185 files.",
);
const facilityStoryReviewRoot = "GREENWATER_FACILITY_STORY_v1.5_REVIEW/";
const facilityStoryQuarantinedFiles = new Map();
for (const [archivePath, bytes] of facilityStoryQuarantinedArchive) {
  assert.ok(
    archivePath.startsWith(facilityStoryReviewRoot),
    `The quarantined Facility Story candidate contains a file outside ${facilityStoryReviewRoot}.`,
  );
  const logicalPath = validateArchivePath(
    archivePath.slice(facilityStoryReviewRoot.length),
  );
  assert.ok(
    !facilityStoryQuarantinedFiles.has(logicalPath),
    `The quarantined Facility Story candidate repeats ${logicalPath}.`,
  );
  facilityStoryQuarantinedFiles.set(logicalPath, bytes);
}
const facilityStoryQuarantinedManifest = JSON.parse(
  facilityStoryQuarantinedFiles.get("MANIFEST.json").toString("utf8"),
);
assert.equal(
  facilityStoryQuarantinedManifest.format,
  "GREENWATER_FACILITY_STORY_V15_MANIFEST",
);
assert.equal(facilityStoryQuarantinedManifest.version, "v1.5-review");
assert.equal(
  facilityStoryQuarantinedManifest.package,
  "GREENWATER_FACILITY_STORY_v1.5_REVIEW.zip",
);
assert.equal(facilityStoryQuarantinedManifest.final_v12_freeze, true);
assert.equal(facilityStoryQuarantinedManifest.final_v13_freeze, true);
assert.equal(facilityStoryQuarantinedManifest.final_v14_freeze, true);
assert.equal(facilityStoryQuarantinedManifest.final_v15_freeze, false);
assert.equal(
  facilityStoryQuarantinedManifest.built_on?.sha256,
  "13da5c6212ab98e95956db063fa671cb0f484a9e3861abf0e40cf973de07782a",
);
assert.equal(facilityStoryQuarantinedManifest.built_on?.altered, false);
assert.equal(facilityStoryQuarantinedManifest.built_on?.re_baselined, false);
assert.ok(facilityStoryQuarantinedManifest.source_snapshot?.complete);
assert.deepEqual(
  facilityStoryQuarantinedManifest.source_snapshot?.dependency_closure?.unresolved,
  [],
);
assert.ok(facilityStoryQuarantinedManifest.gates.every((gate) => gate.pass));
assert.equal(facilityStoryQuarantinedManifest.gates.length, 94);
assert.deepEqual(facilityStoryQuarantinedManifest.totals, {
  upgrade_placements: 134,
  total_placements: 2423,
  merged_meshes: 60,
  authored_triangles: 61_798,
  worst_visible_draw_calls: 18,
  worst_visible_triangles: 27_130,
  materials: 6,
  textures: 6,
});
assert.equal(facilityStoryQuarantinedManifest.files.length, 184);
const declaredFacilityStoryQuarantinedPaths = new Set();
for (const record of facilityStoryQuarantinedManifest.files) {
  const logicalPath = validateArchivePath(record.path);
  assert.notEqual(logicalPath, "MANIFEST.json", "The v1.5 manifest cannot hash itself.");
  assert.ok(
    !declaredFacilityStoryQuarantinedPaths.has(logicalPath),
    `The quarantined v1.5 manifest repeats ${logicalPath}.`,
  );
  const bytes = facilityStoryQuarantinedFiles.get(logicalPath);
  assert.ok(bytes, `The quarantined v1.5 manifest declares missing file ${logicalPath}.`);
  assert.equal(bytes.length, record.bytes, `${logicalPath} differs from its v1.5 byte count.`);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    record.sha256,
    `${logicalPath} differs from its v1.5 manifest hash.`,
  );
  declaredFacilityStoryQuarantinedPaths.add(logicalPath);
}
assert.equal(
  declaredFacilityStoryQuarantinedPaths.size + 1,
  facilityStoryQuarantinedFiles.size,
);
for (const logicalPath of facilityStoryQuarantinedFiles.keys()) {
  assert.ok(
    logicalPath === "MANIFEST.json" || declaredFacilityStoryQuarantinedPaths.has(logicalPath),
    `The quarantined Facility Story candidate contains undeclared file ${logicalPath}.`,
  );
}

const facilityStoryFinalPackageBytes = await readArchive("GREENWATER_FACILITY_STORY_v1.5.zip");
assert.equal(
  facilityStoryProvenanceGap.accepted_final.sha256,
  "118bc6f00f4db5d5ec18ec805d0738aa672765a849b2f2169ccb1a47ad8ca2a9",
);
assert.equal(facilityStoryProvenanceGap.accepted_final.available_locally, true);
assert.equal(
  createHash("sha256").update(facilityStoryFinalPackageBytes).digest("hex"),
  "118bc6f00f4db5d5ec18ec805d0738aa672765a849b2f2169ccb1a47ad8ca2a9",
  "The preserved Greenwater Facility Story v1.5 final freeze differs from the accepted package.",
);
const facilityStoryFinalArchive = readZipArchive(facilityStoryFinalPackageBytes);
assert.equal(
  facilityStoryFinalArchive.size,
  185,
  "The final Greenwater Facility Story archive must contain 185 files.",
);
const facilityStoryFinalRoot = "GREENWATER_FACILITY_STORY_v1.5/";
const facilityStoryFinalFiles = new Map();
for (const [archivePath, bytes] of facilityStoryFinalArchive) {
  assert.ok(
    archivePath.startsWith(facilityStoryFinalRoot),
    `The Facility Story final freeze contains a file outside ${facilityStoryFinalRoot}.`,
  );
  const logicalPath = validateArchivePath(
    archivePath.slice(facilityStoryFinalRoot.length),
  );
  assert.ok(
    !facilityStoryFinalFiles.has(logicalPath),
    `The Facility Story final freeze repeats ${logicalPath}.`,
  );
  facilityStoryFinalFiles.set(logicalPath, bytes);
}
const facilityStoryFinalManifest = JSON.parse(
  facilityStoryFinalFiles.get("MANIFEST.json").toString("utf8"),
);
assert.equal(
  facilityStoryFinalManifest.format,
  "GREENWATER_FACILITY_STORY_V15_MANIFEST",
);
assert.equal(facilityStoryFinalManifest.version, "v1.5-final");
assert.equal(
  facilityStoryFinalManifest.package,
  "GREENWATER_FACILITY_STORY_v1.5.zip",
);
assert.equal(facilityStoryFinalManifest.final_v12_freeze, true);
assert.equal(facilityStoryFinalManifest.final_v13_freeze, true);
assert.equal(facilityStoryFinalManifest.final_v14_freeze, true);
assert.equal(facilityStoryFinalManifest.final_v15_freeze, true);
assert.equal(
  facilityStoryFinalManifest.accepted_review?.sha256,
  facilityStoryAcceptedReviewSha256,
);
assert.equal(
  facilityStoryFinalManifest.accepted_review?.production_assets_byte_identical,
  true,
);
assert.equal(
  facilityStoryFinalManifest.accepted_review?.runtime_glb_sha256,
  "5b711fb7bc46533fa6eb6a4ce9b455efe7866061e4f6ea10f82eb0996da20177",
);
assert.equal(
  facilityStoryFinalManifest.accepted_review?.runtime_glb_matches_accepted_review,
  true,
);
assert.deepEqual(
  facilityStoryFinalManifest.accepted_review?.production_scope,
  ["models/", "textures/", "data/", "previews/", "VALIDATION.json"],
);
assert.equal(facilityStoryFinalManifest.built_on?.altered, false);
assert.equal(facilityStoryFinalManifest.built_on?.re_baselined, false);
assert.ok(facilityStoryFinalManifest.source_snapshot?.complete);
assert.deepEqual(
  facilityStoryFinalManifest.source_snapshot?.dependency_closure?.unresolved,
  [],
);
assert.ok(facilityStoryFinalManifest.gates.every((gate) => gate.pass));
assert.equal(facilityStoryFinalManifest.gates.length, 94);
assert.deepEqual(
  facilityStoryFinalManifest.totals,
  facilityStoryQuarantinedManifest.totals,
);
assert.deepEqual(facilityStoryFinalManifest.native_integration_accepted, {
  source: "accepted native integration run, supplied with the freeze instruction and recorded verbatim; not measured by this review page",
  resolution: "1600 × 900, forced high quality",
  laps: 5,
  total_time: "02:52.800",
  lap_times_s: [34.483, 34.433, 34.517, 34.683, 34.683],
  frame_time_p95_ms: 9.2,
  frame_time_max_ms: 9.5,
  peak_scene_draw_calls: 90,
  peak_scene_triangles: 63_830,
  peak_environment_groups: 18,
  environment_triangles: 27_130,
  geometries: 130,
  textures: 27,
  impacts: 0,
  missed_gates: 0,
  recoveries: 0,
  wrong_way_entries: 0,
  load_failures: 0,
  warnings: 0,
  errors: 0,
  webgl_faults: 0,
  clean_run: true,
});
assert.equal(facilityStoryFinalManifest.files.length, 184);
const declaredFacilityStoryFinalPaths = new Set();
for (const record of facilityStoryFinalManifest.files) {
  const logicalPath = validateArchivePath(record.path);
  assert.notEqual(
    logicalPath,
    "MANIFEST.json",
    "The final v1.5 manifest cannot hash itself.",
  );
  assert.ok(
    !declaredFacilityStoryFinalPaths.has(logicalPath),
    `The final v1.5 manifest repeats ${logicalPath}.`,
  );
  const bytes = facilityStoryFinalFiles.get(logicalPath);
  assert.ok(bytes, `The final v1.5 manifest declares missing file ${logicalPath}.`);
  assert.equal(
    bytes.length,
    record.bytes,
    `${logicalPath} differs from its final v1.5 byte count.`,
  );
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    record.sha256,
    `${logicalPath} differs from its final v1.5 manifest hash.`,
  );
  declaredFacilityStoryFinalPaths.add(logicalPath);
}
assert.equal(
  declaredFacilityStoryFinalPaths.size + 1,
  facilityStoryFinalFiles.size,
);
for (const logicalPath of facilityStoryFinalFiles.keys()) {
  assert.ok(
    logicalPath === "MANIFEST.json" || declaredFacilityStoryFinalPaths.has(logicalPath),
    `The Facility Story final freeze contains undeclared file ${logicalPath}.`,
  );
}

const facilityStoryQuarantineDifferences = [];
const facilityStoryLogicalPaths = new Set([
  ...facilityStoryQuarantinedFiles.keys(),
  ...facilityStoryFinalFiles.keys(),
]);
for (const logicalPath of facilityStoryLogicalPaths) {
  const quarantinedBytes = facilityStoryQuarantinedFiles.get(logicalPath);
  const finalBytes = facilityStoryFinalFiles.get(logicalPath);
  if (!quarantinedBytes || !finalBytes || !quarantinedBytes.equals(finalBytes)) {
    facilityStoryQuarantineDifferences.push(logicalPath);
  }
}
assert.deepEqual(facilityStoryQuarantineDifferences.sort(), [
  "MANIFEST.json",
  "V15_REVIEW_NOTES.md",
]);
assert.ok(
  facilityStoryQuarantinedFiles
    .get("source/greenwater-facility-story.html")
    .equals(facilityStoryFinalFiles.get("source/greenwater-facility-story.html")),
  "The quarantined v1.5 candidate must retain its documented final-source defect.",
);
const facilityStoryProductionPaths = [...facilityStoryFinalFiles.keys()].filter(
  (logicalPath) => logicalPath.startsWith("models/")
    || logicalPath.startsWith("textures/")
    || logicalPath.startsWith("data/")
    || logicalPath.startsWith("previews/")
    || logicalPath === "VALIDATION.json",
);
assert.ok(
  facilityStoryProductionPaths.every(
    (logicalPath) => facilityStoryFinalFiles
      .get(logicalPath)
      .equals(facilityStoryQuarantinedFiles.get(logicalPath)),
  ),
  "The quarantined v1.5 candidate production bytes differ from the accepted final freeze.",
);
const facilityStoryFreezeNotes = facilityStoryFinalFiles
  .get("V15_REVIEW_NOTES.md")
  .toString("utf8");
assert.match(facilityStoryFreezeNotes, /Facility Story v1\.5 \(final freeze\)/i);
assert.match(facilityStoryFreezeNotes, /final_v15_freeze is true/i);
assert.doesNotMatch(facilityStoryFreezeNotes, /Not a freeze/i);

const facilityStoryValidation = JSON.parse(
  facilityStoryFinalFiles.get("VALIDATION.json").toString("utf8"),
);
assert.equal(facilityStoryValidation.runtime?.binary?.pass, true);
assert.equal(facilityStoryValidation.runtime?.meshes, 60);
assert.equal(facilityStoryValidation.runtime?.triangles, 61_798);
assert.equal(facilityStoryValidation.surface_runtime?.pass, true);
assert.ok(facilityStoryValidation.gates.every((gate) => gate.pass));
assert.equal(facilityStoryValidation.gates.length, 94);
const storyCullPlacements = [
  ...facilityStoryValidation.story.cull_contract.landmarks,
  ...facilityStoryValidation.story.cull_contract.ordinary_capped,
];
assert.equal(storyCullPlacements.length, 20);
assert.ok(
  storyCullPlacements.every(
    (placement) => placement.useful
      && placement.cull_effective_m <= placement.cull_requested_m
      && placement.route_visibility.seconds_at_race_speed_261kmh >= 1
      && placement.route_visibility.px_height_at_max_distance >= 6,
  ),
  "Every capped v1.5 placement must remain useful under its effective runtime cull.",
);
assert.equal(facilityStoryValidation.story.module_frames.length, 27);
assert.equal(facilityStoryValidation.story.iso_frames.length, 10);
assert.equal(facilityStoryValidation.story.horizon_views.length, 3);

const facilityStoryReadability = JSON.parse(
  facilityStoryFinalFiles.get("data/GW_PROJECTED_READABILITY.json").toString("utf8"),
);
assert.equal(facilityStoryReadability.depth_test.samples, 26);
assert.equal(facilityStoryReadability.depth_test.per_sample.length, 26);
assert.equal(facilityStoryReadability.depth_test.per_sample[0].station, 1900);
assert.equal(facilityStoryReadability.depth_test.per_sample.at(-1).station, 2100);
assert.equal(facilityStoryReadability.depth_test.story_px_on_projected_deck, 0);
assert.equal(facilityStoryReadability.depth_test.opening_blocked_samples, 0);
assert.ok(
  facilityStoryReadability.depth_test.per_sample.every(
    (sample) => sample.story_px_in_frame > 0
      && sample.overlap_px === 0
      && sample.opening_blocked_px === 0,
  ),
  "Every v1.5 Fuel Row depth sample must show story geometry without covering the route.",
);
assert.equal(facilityStoryReadability.pixel_test.rows.length, 34);
assert.equal(facilityStoryReadability.pixel_test.fuel.length, 26);
assert.equal(facilityStoryReadability.pixel_test.stations.length, 8);
assert.equal(facilityStoryReadability.pixel_test.obstruction_px, 0);
assert.equal(facilityStoryReadability.pixel_test.route_obstructed, 0);
assert.equal(facilityStoryReadability.pixel_test.route_illegible, 0);
assert.equal(facilityStoryReadability.pixel_test.route_discontinuous, 0);
assert.equal(facilityStoryReadability.pixel_test.route_covered, 0);

const facilityStorySlotDiff = JSON.parse(
  facilityStoryFinalFiles.get("data/GW_STORY_SLOT_DIFF.json").toString("utf8"),
);
assert.deepEqual(
  facilityStorySlotDiff.painted.map(({ sheet, slot }) => ({ sheet, slot })),
  [
    { sheet: "metal", slot: "reserved_m15" },
    { sheet: "concrete", slot: "reserved_c15" },
  ],
);
assert.ok(
  facilityStorySlotDiff.sheets.every(
    (sheet) => sheet.changed === 1 && sheet.unexpected.length === 0,
  ),
  "The v1.5 texture pass must change only its two reserved atlas slots.",
);

const facilityStoryRuntimeCorrections = JSON.parse(
  facilityStoryFinalFiles.get("data/GW_V15_RUNTIME_CORRECTIONS.json").toString("utf8"),
);
const sweepWeirCorrection = facilityStoryRuntimeCorrections.correction_7_sweep_weir;
assert.equal(sweepWeirCorrection.runs_longitudinally, true);
assert.equal(sweepWeirCorrection.wall_bay_count, 10);
assert.equal(sweepWeirCorrection.water_bay_count, 10);
assert.ok(sweepWeirCorrection.min_wall_clearance_from_edge_m >= 9);
assert.equal(sweepWeirCorrection.wall_triangles_within_structural_margin, 0);
assert.equal(sweepWeirCorrection.wall_triangles_in_driving_core, 0);
assert.equal(sweepWeirCorrection.water_triangles_within_structural_margin, 0);
assert.ok(
  sweepWeirCorrection.wall_bays.every(
    (bay) => bay.clearance_from_edge_m >= 9
      && bay.triangles_within_structural_margin === 0
      && bay.triangles_in_driving_core === 0,
  ),
  "Every Sweep Weir wall bay must remain outside the structural margin.",
);
const sweepWeirGlbAudit = sweepWeirCorrection.baked_glb_corridor_audit;
assert.equal(sweepWeirGlbAudit.pass, true);
assert.equal(sweepWeirGlbAudit.detector_ok, true);
assert.equal(sweepWeirGlbAudit.weir_placements_audited, 20);
assert.equal(sweepWeirGlbAudit.weir_triangles_in_envelope, 0);
assert.equal(sweepWeirGlbAudit.weir_triangles_located_in_merged_buffers, 440);
assert.equal(
  sweepWeirGlbAudit.weir_triangles_located_in_merged_buffers,
  sweepWeirGlbAudit.weir_triangles_expected,
);
assert.deepEqual(
  sweepWeirCorrection.chase_frames.map((frame) => frame.station_m),
  [874, 986.239, 1003, 1149],
);
assert.ok(
  sweepWeirCorrection.chase_frames.every(
    (frame) => frame.pixel_test.weir_px_on_projected_corridor === 0,
  ),
  "The Sweep Weir must not overlap the projected route in any chase frame.",
);

const acceptedFacilityStoryModelBytes = facilityStoryFinalFiles.get(
  "models/greenwater_environment_runtime.glb",
);
assert.ok(
  acceptedFacilityStoryModelBytes.equals(
    facilityStoryQuarantinedFiles.get("models/greenwater_environment_runtime.glb"),
  ),
  "The quarantined v1.5 runtime differs from the accepted final runtime.",
);
assert.equal(
  createHash("sha256").update(acceptedFacilityStoryModelBytes).digest("hex"),
  "5b711fb7bc46533fa6eb6a4ce9b455efe7866061e4f6ea10f82eb0996da20177",
);

const environmentBytes = await readFile(
  new URL(
    "../public/assets/greenwater/models/greenwater_environment_runtime.glb",
    import.meta.url,
  ),
);
assert.equal(
  createHash("sha256").update(environmentBytes).digest("hex"),
  "5b711fb7bc46533fa6eb6a4ce9b455efe7866061e4f6ea10f82eb0996da20177",
  "The served Greenwater runtime differs from the accepted Facility Story final freeze.",
);
assert.ok(
  acceptedFacilityStoryModelBytes.equals(environmentBytes),
  "The served Greenwater runtime differs from the accepted v1.5 final bytes.",
);
const environment = parseGlb(environmentBytes, "served Greenwater runtime");
const environmentRoot = environment.json.nodes?.find(
  (node) => node.name === "GW_ENVIRONMENT_RUNTIME",
);
assert.ok(environmentRoot, "The served Greenwater runtime root is missing.");
const environmentMeshNodes = environment.json.nodes.filter(
  (node) => node.mesh !== undefined,
);
assert.equal(environmentMeshNodes.length, 60, "The served environment must contain 60 meshes.");
assert.ok(
  environmentMeshNodes.every(
    (node) => Number.isFinite(node.extras?.cull) && node.extras.cull > 0,
  ),
  "Every served environment mesh must carry a finite cull distance.",
);
const environmentTriangles = environmentMeshNodes.reduce((total, node) => {
  const mesh = environment.json.meshes[node.mesh];
  return total + mesh.primitives.reduce(
    (meshTotal, primitive) => meshTotal
      + environment.json.accessors[primitive.indices].count / 3,
    0,
  );
}, 0);
assert.equal(environmentTriangles, 61_798, "The served environment triangle total is wrong.");

const environmentSignageBytes = await readFile(
  new URL(
    "../public/assets/greenwater/textures/greenwater_signage_1024.png",
    import.meta.url,
  ),
);
const environmentSignageHash = createHash("sha256")
  .update(environmentSignageBytes)
  .digest("hex");
assert.equal(
  environmentSignageHash,
  "5c31ab60627e1fdc188810bc87780a1f5187d9baa2d9c1cc4b85078403a484a6",
  "The served Greenwater signage atlas differs from accepted Production Pass 1.",
);
assert.ok(
  finalGreenwaterFiles.get("textures/greenwater_signage_1024.png").equals(environmentSignageBytes),
  "The served Greenwater signage atlas differs from the final v1.2 freeze.",
);
assert.ok(
  finalLivingWorldFiles
    .get("textures/greenwater_signage_1024.png")
    .equals(environmentSignageBytes),
  "The served Greenwater signage atlas differs from the final v1.3 freeze.",
);
const signageTexture = environment.json.textures?.find(
  (texture) => texture.name === "GW_TEX_signage",
);
assert.ok(signageTexture, "The served environment has no signage texture.");
const signageImage = environment.json.images?.[signageTexture.source];
assert.equal(signageImage?.mimeType, "image/png", "The embedded signage image is not a PNG.");
assert.ok(
  Number.isInteger(signageImage?.bufferView),
  "The embedded signage image has no buffer view.",
);
const signageView = environment.json.bufferViews?.[signageImage.bufferView];
assert.ok(signageView, "The embedded signage image points at a missing buffer view.");
const signageStart = signageView.byteOffset ?? 0;
const embeddedSignageBytes = environment.binary.subarray(
  signageStart,
  signageStart + signageView.byteLength,
);
assert.ok(
  embeddedSignageBytes.length - environmentSignageBytes.length >= 0
    && embeddedSignageBytes.length - environmentSignageBytes.length <= 3,
  "The embedded signage PNG has invalid GLB alignment padding.",
);
assert.equal(
  createHash("sha256")
    .update(embeddedSignageBytes.subarray(0, environmentSignageBytes.length))
    .digest("hex"),
  environmentSignageHash,
  "The embedded and external Production Pass 1 signage atlases differ.",
);

const livingWorldMotionBytes = await readFile(
  new URL(
    "../public/assets/greenwater/textures/greenwater_motion_512.png",
    import.meta.url,
  ),
);
assert.equal(
  createHash("sha256").update(livingWorldMotionBytes).digest("hex"),
  "8822d0178e34b8a0befed6fa1ace5b63ac40b097b7301f49cacb261415c2157b",
  "The served living-world motion atlas differs from the approved v1.3 review.",
);
assert.ok(
  finalLivingWorldFiles
    .get("textures/greenwater_motion_512.png")
    .equals(livingWorldMotionBytes),
  "The served motion atlas differs from the final v1.3 freeze.",
);
assert.equal(livingWorldMotionBytes.readUInt32BE(16), 512);
assert.equal(livingWorldMotionBytes.readUInt32BE(20), 512);
assert.equal(livingWorldMotionBytes[24], 8, "The motion atlas must use 8-bit channels.");
assert.equal(livingWorldMotionBytes[25], 6, "The motion atlas must be RGBA.");

const servedSurfaceModelBytes = await readFile(
  new URL(
    "../public/assets/greenwater/models/greenwater_surface_character_runtime.glb",
    import.meta.url,
  ),
);
assert.ok(
  servedSurfaceModelBytes.equals(acceptedSurfaceModelBytes),
  "The served Surface Character runtime differs from the final v1.4 freeze.",
);
const servedSurfaceAtlasBytes = await readFile(
  new URL(
    "../public/assets/greenwater/textures/greenwater_surface_character_512.png",
    import.meta.url,
  ),
);
assert.ok(
  servedSurfaceAtlasBytes.equals(acceptedSurfaceAtlasBytes),
  "The served Surface Character atlas differs from the final v1.4 freeze.",
);
assert.equal(servedSurfaceAtlasBytes.readUInt32BE(16), 512);
assert.equal(servedSurfaceAtlasBytes.readUInt32BE(20), 512);
assert.equal(servedSurfaceAtlasBytes[24], 8, "The surface atlas must use 8-bit channels.");
assert.equal(servedSurfaceAtlasBytes[25], 6, "The surface atlas must be RGBA.");

console.log(
  `Assets PASS: ${Object.keys(expectedHashes).length} served files match the accepted Phase 1 bytes; ${ASSET_KIT_PROP_PLACEMENTS.length} fallback prop placements resolve; the preserved Greenwater v1.0 archive remains locked; the 59-file v1.2, 70-file Living World v1.3, 111-file Surface Character v1.4, and 185-file Facility Story v1.5 final freezes are byte-locked with every manifest entry; the v1.5 accepted-review hash remains recorded as unavailable and is not re-baselined, while the rejected candidate is quarantined and its final-source defect is verified; the served 60-mesh / 61,798-triangle environment, baked signage, living-world motion, and one-mesh / 776-triangle surface-character assets match their accepted final packages. Archive root: ${archives.root}.`,
);
