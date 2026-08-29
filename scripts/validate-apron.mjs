import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  accumulateApronTelemetry,
  createApronTelemetry,
  resolveApron,
  resolveApronProfile,
} from "../src/game/apron.js";
import {
  integrateEdgeScrub,
  integrateSurfaceGrip,
  resolveTargetSurfaceGrip,
} from "../src/game/physics.js";

/**
 * P1 authored-apron guard.
 *
 * The lateral boundary used to be two magic numbers in the race loop. It is now
 * a table in `greenwater-blockout.json`, so the failure mode moved: a bad edit
 * to that table silently re-closes a sector, or silently opens the hangar. This
 * validator pins the authored values, proves every station in the route
 * resolves one of them, and proves the hangar interior still walls at the old
 * deck margin.
 */

const blockout = JSON.parse(
  readFileSync(
    new URL("../src/game/data/greenwater-blockout.json", import.meta.url),
    "utf8",
  ),
);

const table = blockout.apron;
const samples = blockout.centreline.samples;
const lapLength = blockout.centreline.lapLength;

assert.ok(table, "greenwater-blockout.json must author an `apron` block.");
assert.equal(table.deckMarginMetres, 2.05, "the deck margin must stay 2.05 m.");

// 1. The authored table itself. These are the P1 design values; changing one is
//    a design decision that has to change this assertion too.
const authored = {
  A: { widthMetres: 5, grip: 0.68, wall: true, wallSpeedMultiplier: 0.88 },
  B: { widthMetres: 2, grip: 0.55, wall: true, wallSpeedMultiplier: 0.6 },
  C: { widthMetres: 5.8, grip: 0.8, wall: false, wallSpeedMultiplier: 0.9 },
};
for (const [edge, expected] of Object.entries(authored)) {
  const profile = table.edges[edge];
  assert.ok(profile, `edge type ${edge} has no authored apron.`);
  for (const [field, value] of Object.entries(expected)) {
    assert.equal(
      profile[field],
      value,
      `edge ${edge} ${field} is ${profile[field]}, expected ${value}.`,
    );
  }
  assert.ok(profile.surface, `edge ${edge} needs a surface treatment key.`);
}

// 2. The hangar override is authored by identity (edge + sector), so prove that
//    identity covers exactly the distance range the design calls out.
const hangar = table.overrides.find((entry) => entry.id === "HANGAR_INTERIOR");
assert.ok(hangar, "the HANGAR_INTERIOR override must exist.");
assert.equal(hangar.widthMetres, 0, "the hangar interior must author no apron.");
assert.equal(hangar.wall, true, "the hangar interior must keep its wall.");
const overrideSectorDistances = samples
  .filter((sample) => hangar.sectors.includes(sample.sector))
  .map((sample) => sample.d);
assert.ok(overrideSectorDistances.length > 0, "the override matched no station.");
assert.ok(
  Math.abs(Math.min(...overrideSectorDistances) - hangar.fromDistance) <= 0.01,
  `override sectors start at ${Math.min(...overrideSectorDistances)} m, `
    + `authored fromDistance is ${hangar.fromDistance} m.`,
);
assert.ok(
  Math.abs(Math.max(...overrideSectorDistances) - hangar.toDistance) <= 0.01,
  `override sectors end at ${Math.max(...overrideSectorDistances)} m, `
    + `authored toDistance is ${hangar.toDistance} m.`,
);

// The roadmap states the closed interior as a distance range; assert the
// authored sector identity covers exactly that range in both directions.
for (const sample of samples) {
  if (sample.d < 588 || sample.d > 816) continue;
  assert.ok(
    hangar.sectors.includes(sample.sector),
    `station ${sample.d} m is inside the authored interior range but sits in `
      + `${sample.sector}, which the override does not cover.`,
  );
}

// 3. Every station resolves an authored entry, and each edge type resolves the
//    value the design table promises.
let apronedEdgeOccurrences = 0;
let walledEdgeOccurrences = 0;
for (const sample of samples) {
  const halfWidth = sample.w / 2;
  for (const [edge, lateral] of [
    [sample.edgeL, -(halfWidth + 0.5)],
    [sample.edgeR, halfWidth + 0.5],
  ]) {
    const profile = resolveApronProfile(table, edge, sample.sector);
    assert.ok(profile, `station ${sample.d} m (${edge}) resolved no apron.`);
    const apron = resolveApron(table, edge, sample.sector, halfWidth, lateral);
    assert.ok(
      Number.isFinite(apron.lateralLimit) && apron.lateralLimit > 0,
      `station ${sample.d} m resolved a non-finite lateral limit.`,
    );

    const inHangar = hangar.sectors.includes(sample.sector);
    if (inHangar) {
      assert.equal(edge, "B", `station ${sample.d} m should be a B edge.`);
      assert.equal(apron.width, 0, `station ${sample.d} m must keep its wall.`);
      assert.equal(apron.wall, true, `station ${sample.d} m lost its wall.`);
      assert.equal(
        apron.lateralLimit,
        halfWidth - table.deckMarginMetres,
        `station ${sample.d} m moved the hangar wall.`,
      );
      assert.equal(apron.grip, 1, `station ${sample.d} m changed hangar grip.`);
      walledEdgeOccurrences += 1;
      continue;
    }

    assert.ok(apron.width > 0, `station ${sample.d} m (${edge}) has no run-off.`);
    assert.equal(
      apron.lateralLimit,
      halfWidth + authored[edge].widthMetres,
      `station ${sample.d} m (${edge}) resolved the wrong boundary.`,
    );
    assert.equal(
      apron.grip,
      authored[edge].grip,
      `station ${sample.d} m (${edge}) resolved the wrong apron grip.`,
    );
    if (edge === "A") {
      assert.equal(apron.width, 5, "an A edge must author a 5.0 m apron.");
      assert.equal(apron.grip, 0.68, "an A apron must resolve 0.68 grip.");
    }
    apronedEdgeOccurrences += 1;
  }
}
assert.ok(
  apronedEdgeOccurrences > 2000,
  `only ${apronedEdgeOccurrences} edge occurrences opened; the map has 1258 `
    + "stations, so the great majority of the boundary must be run-off now.",
);
assert.equal(
  walledEdgeOccurrences,
  230,
  `expected 230 walled hangar edge occurrences, got ${walledEdgeOccurrences}.`,
);

// 4. Grip only exists outside the deck margin. This is what keeps the demo
//    racing line untouched: the autopilot never leaves halfWidth - 2.05 m.
for (const sample of samples.slice(0, 200)) {
  const halfWidth = sample.w / 2;
  const inside = resolveApron(
    table,
    sample.edgeR,
    sample.sector,
    halfWidth,
    halfWidth - table.deckMarginMetres,
  );
  assert.equal(inside.grip, 1, `grip fell inside the deck at ${sample.d} m.`);
  assert.equal(inside.onApron, false, `apron began inside the deck at ${sample.d} m.`);
}

// 5. Purity. Same inputs, same outputs, and the authored table is never mutated
//    by ten thousand resolutions across the whole progress/lateral domain.
const tableSnapshot = JSON.stringify(table);
let reference = null;
for (let step = 0; step < 10_000; step += 1) {
  const sample = samples[step % samples.length];
  const halfWidth = sample.w / 2;
  const lateral = -halfWidth * 2 + (step % 401) * (halfWidth / 100);
  const edge = step % 2 === 0 ? sample.edgeL : sample.edgeR;
  const first = resolveApron(table, edge, sample.sector, halfWidth, lateral);
  const second = resolveApron(table, edge, sample.sector, halfWidth, lateral);
  assert.deepEqual(first, second, `apronAt is not pure at step ${step}.`);
  assert.notEqual(first, second, `apronAt returned a shared object at ${step}.`);
  for (const [field, value] of Object.entries(first)) {
    if (typeof value !== "number") continue;
    assert.ok(
      Number.isFinite(value),
      `apronAt produced a non-finite ${field} at step ${step}.`,
    );
  }
  if (step === 4242) reference = first;
}
assert.equal(JSON.stringify(table), tableSnapshot, "the apron table was mutated.");
const replay = resolveApron(
  table,
  samples[4242 % samples.length].edgeL,
  samples[4242 % samples.length].sector,
  samples[4242 % samples.length].w / 2,
  -samples[4242 % samples.length].w + (4242 % 401) * (samples[4242 % samples.length].w / 200),
);
assert.deepEqual(replay, reference, "apronAt is not replayable from its inputs.");

// 6. Frame-rate independence of everything the clamp integrates. A boundary
//    that scrubs more speed at 60 Hz than at 120 Hz would make the apron a
//    machine-dependent penalty.
for (const scrub of [12, 22]) {
  let coarse = 90;
  let fine = 90;
  for (let step = 0; step < 60; step += 1) coarse = integrateEdgeScrub(coarse, scrub, 1 / 60);
  for (let step = 0; step < 120; step += 1) fine = integrateEdgeScrub(fine, scrub, 1 / 120);
  assert.ok(
    Math.abs(coarse - fine) < 1e-9,
    `edge scrub at ${scrub} m/s² differs between 60 Hz and 120 Hz.`,
  );
}
let gripCoarse = 1;
let gripFine = 1;
const apronTargetGrip = resolveTargetSurfaceGrip(1, table.edges.A.grip);
assert.equal(apronTargetGrip, 0.68, "an A apron must target 0.68 grip.");
assert.equal(
  resolveTargetSurfaceGrip(0.8, 1),
  0.8,
  "standing water must be unchanged where no apron applies.",
);
for (let step = 0; step < 60; step += 1) {
  gripCoarse = integrateSurfaceGrip(gripCoarse, apronTargetGrip, 0.8, 1 / 60);
}
for (let step = 0; step < 120; step += 1) {
  gripFine = integrateSurfaceGrip(gripFine, apronTargetGrip, 0.8, 1 / 120);
}
assert.ok(
  Math.abs(gripCoarse - gripFine) < 0.002,
  `apron grip settles differently at 60 Hz (${gripCoarse}) and 120 Hz (${gripFine}).`,
);
assert.ok(
  gripCoarse <= 0.7,
  `one second on an A apron must drop grip to 0.70 or below, got ${gripCoarse}.`,
);

// 7. Telemetry. It must stay allocation-free on the racing line and count one
//    entry per crossing, or the soak proof "apronSeconds === 0" means nothing.
const deck = resolveApron(table, "A", "FUEL_ROW", 12, 0);
const runOff = resolveApron(table, "A", "FUEL_ROW", 12, 13.5);
let telemetry = createApronTelemetry();
const onDeck = accumulateApronTelemetry(telemetry, deck, 1 / 120);
assert.equal(onDeck, telemetry, "deck laps must not allocate telemetry state.");
for (let step = 0; step < 120; step += 1) {
  telemetry = accumulateApronTelemetry(telemetry, runOff, 1 / 120);
}
telemetry = accumulateApronTelemetry(telemetry, deck, 1 / 120);
for (let step = 0; step < 120; step += 1) {
  telemetry = accumulateApronTelemetry(telemetry, runOff, 1 / 120);
}
assert.equal(telemetry.entries, 2, "two apron crossings must count as two entries.");
assert.ok(
  Math.abs(telemetry.seconds - 2) < 1e-9,
  `two seconds on the apron recorded as ${telemetry.seconds} s.`,
);
assert.equal(telemetry.minimumGrip, 0.68, "telemetry lost the apron grip floor.");
assert.ok(
  Math.abs(telemetry.maxDepthMetres - (13.5 - (12 - 2.05))) < 1e-9,
  `apron depth recorded as ${telemetry.maxDepthMetres} m.`,
);

// 8. The three authored probe scenarios, resolved against the real stations the
//    browser probe spawns at.
function stationAt(distanceMeters) {
  return samples.reduce((best, sample) => (
    Math.abs(sample.d - distanceMeters) < Math.abs(best.d - distanceMeters) ? sample : best
  ));
}
const fuelRow = stationAt(1700);
assert.equal(fuelRow.sector, "FUEL_ROW", "the apron probe must spawn in FUEL_ROW.");
const fuelRowHalfWidth = fuelRow.w / 2;
const onApron = resolveApron(table, fuelRow.edgeR, fuelRow.sector, fuelRowHalfWidth, 13.5);
assert.equal(onApron.onApron, true, "the probe must spawn on the FUEL_ROW apron.");
assert.ok(
  13.5 < onApron.lateralLimit,
  `a 13.5 m spawn must stay inside the ${onApron.lateralLimit} m boundary.`,
);
const pastWall = resolveApron(table, fuelRow.edgeR, fuelRow.sector, fuelRowHalfWidth, 17.5);
assert.ok(
  17.5 > pastWall.lateralLimit && pastWall.wall,
  `a 17.5 m spawn must be outside the ${pastWall.lateralLimit} m soft wall.`,
);
const hangarStation = stationAt(700);
assert.equal(hangarStation.sector, "HANGAR_SIX", "700 m must be inside HANGAR_SIX.");
const hangarApron = resolveApron(
  table,
  hangarStation.edgeR,
  hangarStation.sector,
  hangarStation.w / 2,
  11,
);
assert.ok(
  11 > hangarApron.lateralLimit && hangarApron.wall && hangarApron.width === 0,
  `an 11 m lateral in HANGAR_SIX must still hit the wall at ${hangarApron.lateralLimit} m.`,
);

/* ------------------------------------------------------------------ */
/* P11: every authored run-off has to be DRAWN, not only simulated      */
/* ------------------------------------------------------------------ */

// `C` authored 5.8 m of open run-off and `createApronDecks` only ever emitted
// strips for A and B, so the open edge had grip, a lateral limit and marker
// posts standing at halfWidth + 5.8 m over nothing at all. The surface table is
// scraped rather than restated: a new edge type in the JSON now fails here
// until it is given a strip.
const courseSource = readFileSync(
  new URL("../src/game/course.ts", import.meta.url),
  "utf8",
);
const decksStart = courseSource.indexOf("private createApronDecks(): THREE.Group {");
assert.ok(decksStart >= 0, "course.ts must declare createApronDecks.");
const surfaceTable = courseSource.slice(
  decksStart,
  courseSource.indexOf("for (const surface of surfaces)", decksStart),
);
const drawnEdges = [...surfaceTable.matchAll(/type: "([A-Z])",/g)].map(
  (match) => match[1],
);
for (const [edge, profile] of Object.entries(table.edges)) {
  if (profile.widthMetres <= 0) continue;
  assert.ok(
    drawnEdges.includes(edge),
    `edge ${edge} authors ${profile.widthMetres} m of run-off but `
      + `createApronDecks draws no surface for it (draws: ${drawnEdges.join(", ")}).`,
  );
}
assert.equal(
  new Set(drawnEdges).size,
  drawnEdges.length,
  "createApronDecks lists an edge type twice; the strips would z-fight.",
);

// The A gravel's outward fall. Re-baselined in P11 from -0.35 m to -0.12 m: at
// a hover height of 0.89-1.31 m a 0.35 m step read as a cliff at the deck edge.
// It must still fall away — that cross-section is how gravel is told from the
// rumble strip without colour — and it must stay clear of the 0.55 m
// understructure the deck sits on.
// P12 moved these numbers out of `createApronDecks` into the exported
// `APRON_EDGE_CROSS_SECTION`, because a second system now has to agree with
// them: the opening-surface decals lie on these surfaces, and a shoulder
// chevron that ignored the fall would float over an A apron by 0.12 m. So the
// cross-section is scraped from the exported table — the real source of truth —
// and `createApronDecks` is separately asserted to consume it rather than
// carrying its own copy.
const crossSectionStart = courseSource.indexOf("export const APRON_EDGE_CROSS_SECTION");
assert.ok(crossSectionStart >= 0, "course.ts must export APRON_EDGE_CROSS_SECTION.");
const crossSectionTable = courseSource.slice(
  crossSectionStart,
  courseSource.indexOf("});", crossSectionStart),
);
const outerRises = Object.fromEntries(
  [...crossSectionTable.matchAll(/([A-Z]): Object\.freeze\(\{ outerRise: (-?[0-9.]+),/g)]
    .map((match) => [match[1], Number(match[2])]),
);
for (const edge of drawnEdges) {
  assert.ok(
    new RegExp(`outerRise: APRON_EDGE_CROSS_SECTION\\.${edge}\\.outerRise`)
      .test(surfaceTable),
    `createApronDecks restates edge ${edge}'s outward fall instead of reading `
      + "APRON_EDGE_CROSS_SECTION. The drawn surface and the decal layer must "
      + "not be able to drift apart.",
  );
}
assert.equal(
  outerRises.A,
  -0.12,
  `The A gravel's outward fall is ${outerRises.A} m, expected -0.12 m (P11).`,
);
assert.ok(
  outerRises.B > 0,
  "The B rumble must still step UP; the falling/rising pair is the colour-free cue.",
);
assert.equal(
  outerRises.C,
  0,
  "The C open run-off must stay flush with the deck: what follows it is the drop.",
);

console.log(
  `Apron PASS: ${apronedEdgeOccurrences} of ${samples.length * 2} edge `
    + `occurrences opened to authored run-off, ${walledEdgeOccurrences} hangar `
    + `occurrences still walled, A=${table.edges.A.widthMetres} m @ `
    + `${table.edges.A.grip} grip, boundary at `
    + `${onApron.lateralLimit.toFixed(2)} m in FUEL_ROW over a `
    + `${lapLength.toFixed(3)} m lap; run-off drawn for ${drawnEdges.join("/")} `
    + `(A falls ${outerRises.A} m, B rises ${outerRises.B} m, C flush).`,
);
