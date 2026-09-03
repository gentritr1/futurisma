import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { parseGlb } from "./lib/greenwater-package-validator.mjs";
import { resolveApron, resolveApronProfile } from "../src/game/apron.js";
import { AUDIO_ZONE_PROFILES, resolveAudioZone } from "../src/game/audio-space.js";
import { isCircularHazardContact } from "../src/game/race-rules.js";
import { DECK_CLEARANCE_METRES } from "../src/game/furniture-placement.js";

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

/* ------------------------------------------------------------------ */
/* P8 authored production sidecar                                      */
/* ------------------------------------------------------------------ */

/**
 * The accepted route/massing payloads above are hash-pinned and never edited.
 * Everything P8 authors lives in BITTERPAN_PRODUCTION.json, which is *not*
 * hashed — it is meant to change — so it is pinned by shape and by agreement
 * with the accepted data instead. Every assertion below exists because the
 * corresponding table drives runtime behaviour that no type check can catch: an
 * edge span that misses a station silently reopens a wall, a pad authored 30 m
 * from a gate silently rewrites a corner, a music trigger that repeats its
 * predecessor silently costs a transition.
 */
const production = json(
  await readFile(
    new URL("../src/game/data/map02/BITTERPAN_PRODUCTION.json", import.meta.url),
  ),
);
assert.equal(production.format, "FUTURISMA_MAP02_BITTERPAN_PRODUCTION");
assert.equal(production.phase, "P8");

const lapLength = centreline.total_length_m;
const stations = centreline.stations;
const sequenceById = new Map(sectors.authored_sequences.map((q) => [q.id, q]));
const halfWidthAt = (distance) => {
  const index = Math.round(
    ((distance % lapLength) + lapLength) % lapLength / centreline.station_spacing_m,
  ) % stations.length;
  return stations[index].width_m / 2;
};
const lapGap = (a, b) => {
  const raw = Math.abs(a - b) % lapLength;
  return Math.min(raw, lapLength - raw);
};

// 1. Apron table. Bitterpan authors its own edge values rather than importing
//    Greenwater's, so the design numbers are pinned here the way
//    validate-apron.mjs pins Greenwater's.
const apron = production.apron;
assert.equal(apron.deckMarginMetres, 2.05, "Map 02 must keep the 2.05 m deck margin.");
const authoredEdges = {
  A: { label: "SALT_BERM", widthMetres: 4.6, grip: 0.64, wall: true },
  B: { label: "WORKS_STAND", widthMetres: 2.1, grip: 0.52, wall: true },
  C: { label: "OPEN_PAN", widthMetres: 5.8, grip: 0.8, wall: false },
};
for (const [edge, expected] of Object.entries(authoredEdges)) {
  const profile = apron.edges[edge];
  assert.ok(profile, `Map 02 edge type ${edge} has no authored apron.`);
  for (const [field, value] of Object.entries(expected)) {
    assert.equal(
      profile[field],
      value,
      `Map 02 edge ${edge} ${field} is ${profile[field]}, expected ${value}.`,
    );
  }
  assert.ok(profile.surface, `Map 02 edge ${edge} needs a surface treatment key.`);
  assert.ok(
    profile.grip >= apron.gripFloor && profile.grip <= 1,
    `Map 02 edge ${edge} grip ${profile.grip} is outside the authored floor.`,
  );
}

// 2. Every one of the 610 stations resolves an edge type on both sides, and
//    every resolution produces a finite boundary. A span table with a default
//    can only fail by resolving nothing, so prove it never does.
const edgeSpans = production.edges.spans;
for (const span of edgeSpans) {
  const sequence = sequenceById.get(span.sequence);
  assert.ok(sequence, `Edge span ${span.id} names unknown sequence ${span.sequence}.`);
  assert.ok(
    span.fromDistance < span.toDistance,
    `Edge span ${span.id} is inverted.`,
  );
  // A span must sit inside the sequence it claims, or the note is fiction.
  assert.ok(
    span.fromDistance >= Math.floor(sequence.from_m) - 5
      && span.toDistance <= Math.ceil(sequence.to_m) + 5,
    `Edge span ${span.id} (${span.fromDistance}-${span.toDistance} m) escapes `
      + `${span.sequence} (${sequence.from_m.toFixed(1)}-${sequence.to_m.toFixed(1)} m).`,
  );
}
const edgeCounts = { A: 0, B: 0, C: 0 };
let defaultedStations = 0;
for (const station of stations) {
  let left = production.edges.default.edgeLeft;
  let right = production.edges.default.edgeRight;
  let spanned = false;
  for (const span of edgeSpans) {
    if (station.s < span.fromDistance || station.s > span.toDistance) continue;
    left = span.edgeLeft;
    right = span.edgeRight;
    spanned = true;
  }
  if (!spanned) defaultedStations += 1;
  for (const edge of [left, right]) {
    assert.ok(
      Object.hasOwn(authoredEdges, edge),
      `station ${station.s} m resolved unauthored edge type ${edge}.`,
    );
    edgeCounts[edge] += 1;
    const profile = resolveApronProfile(apron, edge, station.sector);
    assert.ok(profile, `station ${station.s} m (${edge}) resolved no apron.`);
    const halfWidth = station.width_m / 2;
    const resolved = resolveApron(
      apron,
      edge,
      station.sector,
      halfWidth,
      halfWidth + 0.5,
    );
    assert.ok(
      Number.isFinite(resolved.lateralLimit) && resolved.lateralLimit > 0,
      `station ${station.s} m resolved a non-finite lateral limit.`,
    );
    assert.equal(
      resolved.lateralLimit,
      halfWidth + authoredEdges[edge].widthMetres,
      `station ${station.s} m (${edge}) resolved the wrong boundary.`,
    );
    // Grip only ever costs outside the deck margin: the racing line is untouched.
    const onDeck = resolveApron(
      apron,
      edge,
      station.sector,
      halfWidth,
      halfWidth - apron.deckMarginMetres,
    );
    assert.equal(onDeck.grip, 1, `grip fell inside the deck at ${station.s} m.`);
  }
}
assert.equal(
  edgeCounts.A + edgeCounts.B + edgeCounts.C,
  stations.length * 2,
  "not every station resolved two edges.",
);
// The sector identity, asserted as a number: Bitterpan is open pan almost
// everywhere, and a future edit that quietly walls the map fails here.
assert.ok(
  edgeCounts.C / (stations.length * 2) >= 0.8,
  `only ${((edgeCounts.C / (stations.length * 2)) * 100).toFixed(1)}% of Map 02 `
    + "edges are open pan; the map is meant to read as exposed emptiness.",
);
assert.ok(edgeCounts.A > 0 && edgeCounts.B > 0, "Map 02 must use every authored edge type.");

// 3. Boost pads. Spacing, checkpoint clearance and ribbon containment are the
//    three ways an authored pad breaks a corner rather than rewarding a line.
const pads = production.boostPads;
assert.ok(pads.pads.length >= 3 && pads.pads.length <= 4, "Map 02 authors 3-4 boost pads.");
for (const pad of pads.pads) {
  const sequence = sequenceById.get(pad.sequence);
  assert.ok(sequence, `Boost pad ${pad.id} names unknown sequence ${pad.sequence}.`);
  assert.ok(
    pad.distance - pads.halfLengthMetres >= sequence.from_m
      && pad.distance + pads.halfLengthMetres <= sequence.to_m,
    `Boost pad ${pad.id} overruns ${pad.sequence}.`,
  );
  // Pads belong on the straights; a pad in a bend is a different game.
  assert.ok(
    sequence.minimum_radius_m === null || sequence.minimum_radius_m >= 1200,
    `Boost pad ${pad.id} sits in ${pad.sequence}, which is not a straight `
      + `(minimum radius ${sequence.minimum_radius_m} m).`,
  );
  const halfWidth = halfWidthAt(pad.distance);
  const outer = Math.abs(pad.lateralFraction) + pads.lateralHalfFraction;
  assert.ok(
    outer <= 1,
    `Boost pad ${pad.id} reaches ${(outer * 100).toFixed(0)}% of the half-width `
      + "and leaves the ribbon.",
  );
  assert.ok(
    outer * halfWidth <= halfWidth,
    `Boost pad ${pad.id} is outside the ribbon at ${pad.distance} m.`,
  );
  for (const checkpoint of checkpoints.checkpoints) {
    const gap = lapGap(pad.distance, checkpoint.station_m);
    assert.ok(
      gap >= pads.minimumCheckpointClearanceMetres,
      `Boost pad ${pad.id} is ${gap.toFixed(1)} m from ${checkpoint.id}, inside `
        + `the authored ${pads.minimumCheckpointClearanceMetres} m clearance.`,
    );
  }
}
for (let index = 0; index < pads.pads.length; index += 1) {
  for (let other = index + 1; other < pads.pads.length; other += 1) {
    const gap = lapGap(pads.pads[index].distance, pads.pads[other].distance);
    assert.ok(
      gap >= pads.minimumSpacingMetres,
      `Boost pads ${pads.pads[index].id} and ${pads.pads[other].id} are `
        + `${gap.toFixed(1)} m apart, inside the authored `
        + `${pads.minimumSpacingMetres} m spacing.`,
    );
  }
}

// 3b. Boost pad PAINT. P20.7 item 1.
//
//     The pads above are a placement contract; this is the look contract, and
//     it needs its own guard because the two are independent and the review
//     history says so. P19 tone-mapped the pad and it still read as an object.
//     P20.2 lifted its field to #909090 and it still read as an object — and,
//     measured, it passed every luma criterion while doing so (field deck+39 to
//     deck+46, two interior tones 56 apart, rim ABOVE the deck). What was
//     actually wrong was chroma and a hard rim: the pad measured 49 HSV
//     saturation against a deck at 11-17, with a one-texel step down to a
//     #565656 border. Luma thresholds alone will not catch that a fourth time,
//     so what is pinned here is the two decisions that fixed it.
//
//     Measured with scripts/visual/paint-probe.mjs + paint-luma.py, which
//     project the pad's own top face out of the live scene rather than cropping
//     a fixed rectangle — the demo lap is only reproducible to about 110 m, so a
//     fixed crop is not measuring the same thing twice. Before -> after, four
//     pads, 1280x720:
//       chroma vs the deck beside it  +32..+38  ->  -4..-10
//       rim vs the pad field          -27..-39  ->  -5..-16
//       field vs the deck             +39..+46  ->  +41..+49  (target +18..+55)
//       interior tones                2, 56 apart -> 2, 61 apart
const bitterpanCourse = readFileSync(
  new URL("../src/game/bitterpan-course.ts", import.meta.url),
  "utf8",
);
assert.ok(
  /const BOOST_PAD_COLOR = new THREE\.Color\(0xffffff\);/.test(bitterpanCourse),
  "The Bitterpan boost pad's material colour must stay white. Every tone in "
    + "createBoostPadTexture is authored as an ABSOLUTE value against a "
    + "measured texel -> frame transfer; a tinted multiplier silently rescales "
    + "all of them and is how the pad became a teal plate twice.",
);
assert.ok(
  /toneMapped: true,/.test(bitterpanCourse.slice(
    bitterpanCourse.indexOf("createBoostPads"),
  )),
  "The Bitterpan boost pad must stay tone-mapped; unmapped it is a glowing "
    + "slab over the deck.",
);
{
  // The soft edge, measured against the WIDEST pad on the lap (4.83 m, at
  // BP_LONG_PAN_EARLY): 3 px of a 64 px sheet is 0.226 m across, and 3 px of
  // 256 along a 16 m pad is 0.188 m. Both inside the phase's 0.25 m ceiling,
  // and near enough to it that the ramp still reads as a fade rather than as a
  // line — which is the failure it exists to avoid.
  const ramp = /const rampPx = (\d+);/.exec(
    bitterpanCourse.slice(bitterpanCourse.indexOf("createBoostPadTexture")),
  );
  assert.ok(ramp, "The Bitterpan boost pad paint has no edge ramp.");
  const rampPx = Number(ramp[1]);
  // The WIDEST pad, not the first one. The pad's width is a fraction of the
  // deck half-width where it sits, so it varies along the lap; checking pad 0
  // and calling it done is how a ramp lands inside the ceiling on one pad and
  // outside it on another. (It also caught the first version of this paint:
  // 4 px reads as 0.25 m on a 3.96 m pad, and the widest pad is 4.83 m.)
  const padWidthMetres = Math.max(
    ...production.boostPads.pads.map((pad) =>
      production.boostPads.lateralHalfFraction * halfWidthAt(pad.distance) * 2),
  );
  const padLengthMetres = production.boostPads.halfLengthMetres * 2;
  const acrossMetres = rampPx / 64 * padWidthMetres;
  const alongMetres = rampPx / 256 * padLengthMetres;
  assert.ok(
    acrossMetres <= 0.25 && alongMetres <= 0.25,
    `The Bitterpan boost pad's edge ramp is ${acrossMetres.toFixed(3)} m across `
      + `and ${alongMetres.toFixed(3)} m along, over the 0.25 m ceiling.`,
  );
  assert.ok(
    rampPx >= 3,
    "An edge ramp under 3 px is a hard border with extra steps.",
  );
}
// The P20.2 rim tone, as a PAINT instruction rather than as a word: the note
// above createBoostPadTexture explains what #565656 used to be and why it went,
// and that explanation is the opposite of a regression.
assert.ok(
  !/(fillStyle|strokeStyle|addColorStop)[^\n]*(#565656|rgb\(86, ?86, ?86\))/i
    .test(bitterpanCourse),
  "The P20.2 hard rim tone is being painted again in the Bitterpan boost pad "
    + "paint. It rendered 16 luma below the field it enclosed at a one-texel "
    + "step, which is the outline that made the pad read as a sunk plate.",
);

const greenwaterCourse = readFileSync(
  new URL("../src/game/course.ts", import.meta.url),
  "utf8",
);
assert.ok(
  /function createGreenwaterBoostPadTexture\(\): THREE\.CanvasTexture/
    .test(greenwaterCourse),
  "Greenwater's boost pads must carry a generated paint map. Before P20.7 they "
    + "were an untextured 0xb9e62e box: measured, ONE interior tone at deck+82 "
    + "to deck+101, i.e. a flat acid-green rectangle filling the lane.",
);
assert.ok(
  !/color: 0xb9e62e/.test(greenwaterCourse),
  "Greenwater's boost pad is back to a flat acid-green multiplier; the colour "
    + "belongs in the paint's core, not on the whole surface.",
);
{
  const paint = greenwaterCourse.slice(
    greenwaterCourse.indexOf("createGreenwaterBoostPadTexture"),
  );
  const ramp = /const rampPx = (\d+);/.exec(paint);
  assert.ok(ramp, "The Greenwater boost pad paint has no edge ramp.");
  // 3 px of 64 across a 4.8 m pad is 0.225 m; 3 px of 256 along an 18 m pad is
  // 0.211 m. Both inside the 0.25 m ceiling.
  const rampPx = Number(ramp[1]);
  assert.ok(
    rampPx / 64 * 4.8 <= 0.25 && rampPx / 256 * 18 <= 0.25 && rampPx >= 3,
    `The Greenwater boost pad's edge ramp is ${rampPx} px, which is outside the `
      + "[3 px, 0.25 m] band the phase allows.",
  );
}

// 4. Hazards. Everything authored has to be reachable inside the ribbon and
//    has to actually cost something, or it is decoration pretending to be risk.
const hazards = production.hazards.entries;
const gripHazards = hazards.filter((hazard) => hazard.type === "salt_drift");
const cableHazards = hazards.filter((hazard) => hazard.type === "cable_coil");
assert.ok(gripHazards.length >= 3, "Map 02 authors at least three salt-drift patches.");
assert.ok(
  cableHazards.length >= 2 && cableHazards.length <= 3,
  "Map 02 authors 2-3 cable coils.",
);
for (const hazard of gripHazards) {
  assert.ok(
    hazard.fromDistance < hazard.toDistance
      && hazard.toDistance <= lapLength,
    `Grip hazard ${hazard.id} has an invalid span.`,
  );
  assert.ok(
    hazard.gripMultiplier > production.apron.gripFloor && hazard.gripMultiplier < 1,
    `Grip hazard ${hazard.id} must cost grip without falling through the floor.`,
  );
  for (const fraction of [hazard.lateralFromFraction, hazard.lateralToFraction]) {
    assert.ok(
      Math.abs(fraction) <= 1,
      `Grip hazard ${hazard.id} band fraction ${fraction} leaves the ribbon.`,
    );
  }
  assert.ok(
    hazard.lateralFromFraction < hazard.lateralToFraction,
    `Grip hazard ${hazard.id} band is inverted.`,
  );
  // A grip patch across a gate turns a checkpoint into a coin toss.
  for (const checkpoint of checkpoints.checkpoints) {
    assert.ok(
      checkpoint.station_m < hazard.fromDistance
        || checkpoint.station_m > hazard.toDistance,
      `Grip hazard ${hazard.id} covers ${checkpoint.id}.`,
    );
  }
}
for (const hazard of cableHazards) {
  const halfWidth = halfWidthAt(hazard.distance);
  // P15: the coil body stands OFF the deck. This check used to read
  // `|lateral| + 3.1 <= halfWidth` — it required the coil's whole contact disc
  // to fit inside the racing surface, which is the on-deck exemption written as
  // geometry. The owner revoked that exemption, so the coil now has to clear
  // the deck like any other object with height. `validate-furniture.mjs` owns
  // the deck rule itself; what is asserted here is that this file's own numbers
  // agree with it rather than pulling the other way.
  assert.ok(
    Math.abs(hazard.lateralOffset) >= halfWidth + DECK_CLEARANCE_METRES,
    `Cable coil ${hazard.id} at lateral ${hazard.lateralOffset} m stands inside `
      + `the ${halfWidth.toFixed(2)} m half-width + ${DECK_CLEARANCE_METRES} m deck `
      + "clearance. Nothing with height stands on the racing surface.",
  );
  // ...and its contact disc still has to touch the drivable ribbon, or the
  // hazard costs nothing and is decoration pretending to be risk. 3.1 m is the
  // lateral contact radius isCircularHazardContact applies.
  assert.ok(
    Math.abs(hazard.lateralOffset) - 3.1 < halfWidth,
    `Cable coil ${hazard.id} at lateral ${hazard.lateralOffset} m is ${(
      Math.abs(hazard.lateralOffset) - 3.1 - halfWidth
    ).toFixed(2)} m outside the ${halfWidth.toFixed(2)} m half-width even at the `
      + "edge of its contact disc, so no car on the deck can ever trip on it.",
  );
  assert.equal(
    isCircularHazardContact(
      hazard.distance,
      hazard.lateralOffset,
      hazard.distance,
      hazard.lateralOffset,
      lapLength,
    ),
    true,
    `Cable coil ${hazard.id} does not register its own contact.`,
  );
  // The centreline must stay clean of every coil.
  assert.equal(
    isCircularHazardContact(hazard.distance, 0, hazard.distance, hazard.lateralOffset, lapLength),
    false,
    `Cable coil ${hazard.id} reaches the centreline.`,
  );
}
// A boost pad that overlaps a grip patch would hand out speed and take away
// grip in the same metre.
for (const pad of pads.pads) {
  const halfWidth = halfWidthAt(pad.distance);
  const padLow = (pad.lateralFraction - pads.lateralHalfFraction) * halfWidth;
  const padHigh = (pad.lateralFraction + pads.lateralHalfFraction) * halfWidth;
  for (const hazard of gripHazards) {
    const alongOverlap = pad.distance + pads.halfLengthMetres >= hazard.fromDistance
      && pad.distance - pads.halfLengthMetres <= hazard.toDistance;
    if (!alongOverlap) continue;
    const bandLow = hazard.lateralFromFraction * halfWidth;
    const bandHigh = hazard.lateralToFraction * halfWidth;
    assert.ok(
      padHigh < bandLow || padLow > bandHigh,
      `Boost pad ${pad.id} overlaps grip hazard ${hazard.id}.`,
    );
  }
  for (const hazard of cableHazards) {
    if (lapGap(pad.distance, hazard.distance) > pads.halfLengthMetres + 3.2) continue;
    assert.ok(
      hazard.lateralOffset < padLow - 3.1 || hazard.lateralOffset > padHigh + 3.1,
      `Boost pad ${pad.id} overlaps cable coil ${hazard.id}.`,
    );
  }
}

// 5. Music. Same 174 BPM / 4-stem / 0-3 schema as Greenwater. The soak gate is
//    musicTransitions >= 20 over five laps, so the authored precondition is
//    that every trigger differs from the one before it, wrap included.
const music = production.music;
assert.equal(music.bpm, 174, "Map 02 must stay on the 174 BPM grid.");
assert.deepEqual(music.stems, ["trance", "jungle", "deep_dnb", "techstep"]);
assert.equal(music.levelScale, "0-3");
const triggers = music.triggers;
assert.ok(triggers.length >= 6, `Map 02 authors ${triggers.length} music triggers, needs 6.`);
assert.equal(triggers[0].distance, 0, "the first music trigger must sit at 0 m.");
for (let index = 0; index < triggers.length; index += 1) {
  const trigger = triggers[index];
  if (index > 0) {
    assert.ok(
      trigger.distance > triggers[index - 1].distance,
      `music trigger ${index} is out of order.`,
    );
  }
  assert.ok(trigger.distance < lapLength, `music trigger ${index} is past the lap.`);
  const sequence = sequenceById.get(trigger.sequence);
  assert.ok(sequence, `music trigger ${index} names unknown sequence ${trigger.sequence}.`);
  // Triggers are cut by the route, not by round numbers.
  assert.ok(
    Math.abs(sequence.from_m - trigger.distance) <= 6,
    `music trigger ${index} at ${trigger.distance} m is not on the `
      + `${trigger.sequence} boundary (${sequence.from_m.toFixed(3)} m).`,
  );
  for (const stem of music.stems) {
    const level = trigger.levels[stem];
    assert.ok(
      Number.isInteger(level) && level >= 0 && level <= 3,
      `music trigger ${index} stem ${stem} is ${level}, outside 0-3.`,
    );
  }
  const previous = triggers[(index - 1 + triggers.length) % triggers.length];
  assert.notDeepEqual(
    trigger.levels,
    previous.levels,
    `music trigger ${index} repeats its predecessor, so it costs a transition.`,
  );
}
const projectedTransitions = triggers.length * 5;
assert.ok(
  projectedTransitions >= 20,
  `five laps would only cross ${projectedTransitions} music boundaries; the soak `
    + "gate is 20.",
);

// 6. Audio. One authored room, pinned to the one authored occlusion event, with
//    a profile that actually exists in audio-space.js.
const audio = production.audio;
assert.equal(audio.defaultZone, "open");
assert.ok(audio.zones.length >= 1, "Map 02 must author at least one reverb zone.");
const underpassEvent = sectors.occlusion_events.find((event) => event.sequence === "Q5");
assert.ok(underpassEvent, "the accepted payload must still describe the Q5 occlusion.");
for (const zone of audio.zones) {
  assert.ok(
    AUDIO_ZONE_PROFILES[zone.name],
    `audio zone ${zone.name} has no profile in audio-space.js.`,
  );
  assert.ok(
    zone.startDistance >= 0 && zone.endDistance <= lapLength
      && zone.startDistance < zone.endDistance,
    `audio zone ${zone.name} (${zone.startDistance}-${zone.endDistance} m) is invalid.`,
  );
}
const underpassProfile = AUDIO_ZONE_PROFILES.underpass;
assert.deepEqual(
  underpassProfile,
  { decaySeconds: 1.05, wet: 0.2, highPassHz: 150 },
  "the underpass room drifted from its authored profile.",
);
// It must be milder than the hangar in every dimension: it is a soffit with
// open sides, not a sealed shed.
assert.ok(
  underpassProfile.decaySeconds < AUDIO_ZONE_PROFILES.hangar.decaySeconds
    && underpassProfile.wet < AUDIO_ZONE_PROFILES.hangar.wet
    && underpassProfile.decaySeconds > AUDIO_ZONE_PROFILES.open.decaySeconds
    && underpassProfile.wet > AUDIO_ZONE_PROFILES.open.wet,
  "the underpass room must sit between open air and the Greenwater hangar.",
);
// The soffit itself has to be inside the zone, and the open pan outside it.
assert.equal(
  resolveAudioZone(3028, audio.zones, audio.defaultZone),
  "underpass",
  "the conveyor span at 3028 m must resolve to the underpass room.",
);
for (const openMetre of [1500, 2500, 200]) {
  assert.equal(
    resolveAudioZone(openMetre, audio.zones, audio.defaultZone),
    "open",
    `${openMetre} m must stay open air.`,
  );
}
const zonedMetres = audio.zones.reduce(
  (total, zone) => total + (zone.endDistance - zone.startDistance),
  0,
);
assert.ok(
  zonedMetres / lapLength <= 0.1,
  `${((zonedMetres / lapLength) * 100).toFixed(1)}% of Bitterpan is enclosed; the `
    + "map is meant to be exposed.",
);

// 7. Lighting. One profile per accepted sector, each with a normalized key
//    direction that agrees with its own authored elevation and azimuth — the
//    numbers in the comment and the numbers in the vector cannot drift apart.
const lighting = production.lighting;
const sectorIds = sectors.sectors.map((sector) => sector.id);
assert.equal(
  lighting.profiles.length,
  sectorIds.length,
  `Map 02 has ${sectorIds.length} sectors but ${lighting.profiles.length} lighting profiles.`,
);
for (const sectorId of sectorIds) {
  const profile = lighting.profiles.find((entry) => entry.sector === sectorId);
  assert.ok(profile, `sector ${sectorId} has no authored lighting profile.`);
  const direction = profile.keyDirection;
  const length = Math.hypot(direction.x, direction.y, direction.z);
  assert.ok(
    Math.abs(length - 1) < 1e-5,
    `sector ${sectorId} key direction has length ${length}, expected 1.`,
  );
  const elevation = (profile.keyElevationDegrees * Math.PI) / 180;
  const azimuth = (profile.keyAzimuthDegrees * Math.PI) / 180;
  const expected = {
    x: Math.cos(elevation) * Math.cos(azimuth),
    y: Math.sin(elevation),
    z: -Math.cos(elevation) * Math.sin(azimuth),
  };
  for (const axis of ["x", "y", "z"]) {
    assert.ok(
      Math.abs(direction[axis] - expected[axis]) < 1e-4,
      `sector ${sectorId} key direction ${axis} is ${direction[axis]}, but its `
        + `authored ${profile.keyElevationDegrees}/${profile.keyAzimuthDegrees} `
        + `degrees give ${expected[axis]}.`,
    );
  }
  // A salt pan at noon: the sun stays high and above the horizon everywhere.
  assert.ok(
    direction.y > 0.8,
    `sector ${sectorId} drops the sun to ${direction.y}; Bitterpan is hard noon light.`,
  );
  assert.ok(profile.fog.density > 0, `sector ${sectorId} authors no fog density.`);
  for (const swatch of [profile.sky, profile.ground, profile.key, profile.rim, profile.fog.color]) {
    assert.match(swatch, /^#[0-9a-f]{6}$/, `sector ${sectorId} has a malformed colour.`);
  }
}
// Every sector the station table actually uses must have a profile, or the
// runtime zone build throws on load.
for (const station of stations) {
  assert.ok(
    lighting.profiles.some((profile) => profile.sector === station.sector),
    `station ${station.s} m is in sector ${station.sector}, which has no lighting.`,
  );
}

// 8. Time of day. Multiplicative ramp, ascending, identity at stop 0 — so
//    reduced motion and the menu collapse to the accepted look.
const stops = production.timeOfDay.stops;
assert.equal(production.timeOfDay.model, "multiplicative");
assert.ok(stops.length >= 5, "Map 02 authors at least five time-of-day stops.");
assert.equal(stops[0].lapProgress, 0);
assert.equal(stops[stops.length - 1].lapProgress, 1);
const tintChannels = ["keyTint", "skyTint", "groundTint", "fogTint"];
for (let index = 0; index < stops.length; index += 1) {
  const stop = stops[index];
  if (index > 0) {
    assert.ok(
      stop.lapProgress > stops[index - 1].lapProgress,
      `time-of-day stop ${index} is out of order.`,
    );
  }
  for (const channel of tintChannels) {
    assert.equal(stop[channel].length, 3, `stop ${index} ${channel} is not RGB.`);
    for (const value of stop[channel]) {
      assert.ok(
        Number.isFinite(value) && value > 0 && value <= 1.2,
        `stop ${index} ${channel} value ${value} is outside a sane multiplier range.`,
      );
    }
  }
  for (const scale of [stop.hemisphereScale, stop.keyScale]) {
    assert.ok(
      scale > 0 && scale <= 1.2,
      `stop ${index} scale ${scale} is outside a sane multiplier range.`,
    );
  }
}
for (const channel of tintChannels) {
  assert.deepEqual(
    stops[0][channel],
    [1, 1, 1],
    `stop 0 ${channel} must be the identity stop.`,
  );
}
assert.equal(stops[0].hemisphereScale, 1);
assert.equal(stops[0].keyScale, 1);
// The ramp has to actually go somewhere, and it has to go amber: blue falls
// furthest, red holds. A ramp that greys out is not a Bitterpan evening.
const finalKey = stops[stops.length - 1].keyTint;
assert.ok(
  finalKey[0] > finalKey[1] && finalKey[1] > finalKey[2] && finalKey[2] <= 0.55,
  `the final key tint ${JSON.stringify(finalKey)} is not a harsh amber.`,
);

// 9. Lap board. It hangs on accepted structure rather than inventing any.
const lapBoard = production.lapBoard;
const boardAnchor = landmarks.landmarks.find(
  (landmark) => landmark.family === lapBoard.anchor,
);
assert.ok(boardAnchor, `the lap board anchor ${lapBoard.anchor} is not in the massing.`);
assert.equal(
  lapBoard.distance,
  boardAnchor.station_m,
  `the lap board sits at ${lapBoard.distance} m but ${lapBoard.anchor} is at `
    + `${boardAnchor.station_m} m.`,
);
assert.ok(
  lapBoard.heightMetres > 4 && lapBoard.heightMetres < boardAnchor.height_m + 15.5,
  "the lap board must hang under the conveyor soffit, not through it.",
);
assert.ok(
  lapBoard.template.includes("{current}") && lapBoard.template.includes("{total}"),
  "the lap board template must be data-driven.",
);
assert.ok(
  lapGap(lapBoard.distance, 0) <= 60,
  "the lap board must be readable on the approach to the line.",
);

// 10. Culling. No cull distance is authored in the accepted payload, so the
//     derivation is the contract; pin it and pin that it can never exceed the
//     Map 02 far plane, which would make it a no-op.
const culling = production.culling;
assert.equal(culling.maximumDistanceMetres, 1800, "Map 02 renders at far = 1800 m.");
assert.ok(
  culling.baseDistanceMetres > 0 && culling.radiusMultiplier > 0,
  "the cull derivation must actually scale with the primitive.",
);
assert.ok(
  culling.baseDistanceMetres < culling.maximumDistanceMetres,
  "the cull base distance must sit inside the far plane.",
);

console.log(
  `Map 02 PASS: ${centreline.stations.length} stations, ${checkpoints.count} ordered `
    + `checkpoints, 20 visible GLB primitives, ${trackVisibleTriangles + massingTriangles} `
    + `visible triangles.\nMap 02 P8 PASS: ${edgeCounts.C} open-pan / ${edgeCounts.A} berm / `
    + `${edgeCounts.B} works edge occurrences over ${stations.length * 2} `
    + `(${defaultedStations} stations on the default), ${pads.pads.length} boost pads, `
    + `${gripHazards.length} salt-drift patches + ${cableHazards.length} cable coils, `
    + `${triggers.length} music triggers (${projectedTransitions} boundaries over 5 laps), `
    + `${lighting.profiles.length} sector lighting profiles, `
    + `${((zonedMetres / lapLength) * 100).toFixed(1)}% of the lap enclosed.`,
);
