import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveApronProfile } from "../src/game/apron.js";
import {
  DECK_CLEARANCE_METRES,
  EDGE_FURNITURE_CLEARANCE_METRES,
  FLAT_FURNITURE_MAX_HEIGHT_METRES,
  GATE_POST_DECK_CLEARANCE_METRES,
  PLACEMENT_EPSILON_METRES,
  PLAQUE_BAND_BOTTOM_METRES,
  WALL_PLAQUE_INSET_METRES,
  TURN_CHEVRON_CLEARANCE_METRES,
  clearsDeck,
  clearsRunOff,
  resolveFurniturePlacement,
  resolveGatePostLateral,
} from "../src/game/furniture-placement.js";

/**
 * P13 road-furniture clearance guard.
 *
 * The rule: **nothing with height above the deck may stand inside the deck.**
 * P11 broke it by accident — its hangar clamp pulled edge furniture back to
 * `halfWidth - 0.35` so it would fit inside the shell, but left its open-air
 * heights alone, so a braking board with a 1.41 m lower edge and a 0.62 m
 * approach arrow ended up drawn on the road at the LINK_APRON approach. That
 * failure was invisible to every check the repo had: the boards are
 * non-interactive, so lap times, fault counts and the soak were all unchanged
 * while the road had signs standing in it.
 *
 * So this validator does not read positions out of the source. It runs every
 * furniture placement through `src/game/furniture-placement.js` — the same
 * module `course.ts` and `bitterpan-course.ts` call — and asserts the rule on
 * the result. A placement the validator passes is the placement the game
 * draws, because the same function produced both.
 *
 * Four classes of thing exist near the deck, and each answers a different
 * question:
 *
 * - EDGE furniture (chevrons, braking boards, their posts and arrows) must
 *   clear the deck AND the drivable run-off, or be a wall plaque above the
 *   band. This is the class P11 broke.
 * - GATE posts mark the gate being scored, so their lateral is authored;
 *   they must clear the deck, but not the run-off — a gate pushed to the
 *   run-off lip would be half again as wide as the plane the player aims at.
 * - FLAT furniture (route lights, guide lights, warning strips, grid chequer,
 *   boost pads) is painted road and is exempt by height. Exempt, but still
 *   enumerated: the exemption is measured here, not assumed.
 * - HAZARDS (steam vents, cable coils and their warning posts) used to be the
 *   one exempt class: a whitelist named seven of them and let them stand on the
 *   racing surface "by design". P15 revoked that. The whitelist is gone, and
 *   there is no shape left in this file for a replacement — every authored
 *   hazard with a lateral, on both maps, is measured against its own station's
 *   half-width like everything else. The check is a named predicate so a
 *   negative test can drive it, because an assertion nobody has ever seen fail
 *   is an assertion nobody has evidence for.
 */

const root = new URL("../", import.meta.url);
const readJson = (path) => JSON.parse(readFileSync(new URL(path, root), "utf8"));

const blockout = readJson("src/game/data/greenwater-blockout.json");
const signage = readJson("src/game/data/FUTURISMA_SIGNAGE_PLACEMENTS.json");
const plaqueBacking = readJson("src/game/data/HANGAR_SIX_PLAQUE_BACKING.json");
const stations = readJson("src/game/data/map02/CENTRELINE_STATIONS.json");
const production = readJson("src/game/data/map02/BITTERPAN_PRODUCTION.json");
const checkpoints02 = readJson("src/game/data/map02/CHECKPOINTS.json");

const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------------------
// Corridor samplers.
//
// These mirror `GreenwaterCourse.sample` / `BitterpanCourse.sample`: index into
// the authored table by PROGRESS, lerp the width across the pair, and take the
// sector and edge types from the lower sample. That mapping only selects the
// pair bracketing the distance while the table is evenly spaced, so both
// samplers assert exactly that on every lookup rather than assuming it.
// ---------------------------------------------------------------------------

function makeSampler(table, length, widthOf, distanceOf, edgesOf) {
  const count = table.length;
  return function sampleAtDistance(distance) {
    const wrapped = ((distance / length % 1) + 1) % 1;
    const scaled = wrapped * count;
    const index = Math.floor(scaled) % count;
    const next = (index + 1) % count;
    const alpha = scaled - Math.floor(scaled);
    const metres = wrapped * length;
    const low = distanceOf(table[index]);
    const high = next === 0 ? length : distanceOf(table[next]);
    assert.ok(
      low <= metres + 1e-6 && metres <= high + 1e-6,
      `Sampler picked entry ${index} (${low}-${high} m) for ${metres.toFixed(3)} m. `
        + "The authored table is no longer evenly spaced, so indexing it by "
        + "progress no longer selects the bracketing pair and every number this "
        + "validator reports is against the wrong station.",
    );
    return {
      halfWidth: lerp(widthOf(table[index]), widthOf(table[next]), alpha) / 2,
      ...edgesOf(table[index], metres),
    };
  };
}

const greenwaterAt = makeSampler(
  blockout.centreline.samples,
  blockout.centreline.lapLength,
  (sample) => sample.w,
  (sample) => sample.d,
  (sample) => ({
    sector: sample.sector,
    apronLeft: resolveApronProfile(blockout.apron, sample.edgeL, sample.sector).widthMetres,
    apronRight: resolveApronProfile(blockout.apron, sample.edgeR, sample.sector).widthMetres,
  }),
);

const bitterpanAt = makeSampler(
  stations.stations,
  stations.total_length_m,
  (station) => station.width_m,
  (station) => station.s,
  (station, metres) => {
    let { edgeLeft, edgeRight } = production.edges.default;
    for (const span of production.edges.spans) {
      if (metres >= span.fromDistance && metres <= span.toDistance) {
        edgeLeft = span.edgeLeft;
        edgeRight = span.edgeRight;
      }
    }
    return {
      sector: station.sector,
      apronLeft: resolveApronProfile(production.apron, edgeLeft, station.sector).widthMetres,
      apronRight: resolveApronProfile(production.apron, edgeRight, station.sector).widthMetres,
    };
  },
);

const apronOn = (sample, side) => (side < 0 ? sample.apronLeft : sample.apronRight);

// ---------------------------------------------------------------------------
// Every item that stands anywhere near either deck.
//
// `class` says which rule it answers to. Geometry is authored here to match the
// builders in course.ts / bitterpan-course.ts exactly: `footprintHalfWidth` is
// the half-extent across the road, and bottom/top are the drawn edges above the
// deck surface.
// ---------------------------------------------------------------------------

const items = [];
/**
 * Every item carries the corridor it was resolved against, flattened onto the
 * item itself so it is the exact shape `clearsDeck` / `clearsRunOff` read. The
 * predicates are the shipped ones; handing them a near-miss shape would make
 * every comparison `NaN` and pass the whole sweep silently.
 */
const add = (item) => {
  const side = item.lateral < 0 ? -1 : 1;
  const resolved = {
    ...item,
    halfWidth: item.sample.halfWidth,
    apronWidth: apronOn(item.sample, side),
  };
  for (const field of ["lateral", "footprintHalfWidth", "bottomHeight", "topHeight", "halfWidth"]) {
    assert.ok(
      Number.isFinite(resolved[field]),
      `${item.map}/${item.id} has a non-finite ${field}.`,
    );
  }
  items.push(resolved);
  return resolved;
};

// --- Greenwater: turn chevrons and braking boards -------------------------

const CHEVRON_BOARD_WIDTH = 3;
const CHEVRON_BOARD_HEIGHT = 1.45;
const CHEVRON_ARROW_HALF_WIDTH = 1.28;
const CHEVRON_ARROW_HEIGHT = 1.16;
const DISTANCE_BOARD_WIDTH = 1.7 * 1.45;
const DISTANCE_BOARD_HEIGHT = 1.28;

let wallPlaques = 0;
let chevronPosts = 0;
let approachArrows = 0;
let chevrons = 0;
let brakingBoards = 0;

/**
 * P15 — the Hangar Six plaque backing panels.
 *
 * These are DERIVED, not authored: `course.ts#recordPlaqueBacking` emits one
 * per group whose placement came back `mode === "wall"`, from the same resolver
 * call, so the sweep below re-derives them the same way rather than reading a
 * position list. They are added to `items` as EDGE furniture and MEASURED, not
 * exempted — a panel is a 3.9 x 1.95 m plate hanging over the hangar, and the
 * only thing keeping it legal is that its lower edge is flush with the plaque
 * band. If a future pass ever gives it a bottom margin it will fail here.
 */
const BACKING_CLASSES = Object.fromEntries(
  plaqueBacking.classes.map((entry) => [
    entry.id === "PLAQUE_BACK_CHEVRON" ? "chevron" : "board",
    entry,
  ]),
);
const BACKING_INSET_METRES = plaqueBacking.placement.BACKING_INSET_METRES;
const backingCounts = { chevron: 0, board: 0 };

/** Adds the backing panel for one wall plaque, or nothing for a verge one. */
const addPlaqueBacking = (placement, sample, klass, side, shared) => {
  if (placement.mode !== "wall") return;
  const backing = BACKING_CLASSES[klass];
  backingCounts[klass] += 1;
  add({
    ...shared,
    class: "edge",
    id: `${shared.id}_BACKING`,
    lateral: side * Math.max(0, sample.halfWidth - BACKING_INSET_METRES),
    mode: placement.mode,
    footprintHalfWidth: backing.widthMetres / 2,
    bottomHeight: backing.bottomHeightMetres,
    topHeight: backing.bottomHeightMetres + backing.heightMetres,
  });
};

for (const turn of blockout.turns) {
  const outside = turn.direction === "left" ? 1 : -1;
  for (let index = 0; index < turn.chevronCount; index += 1) {
    const distance = turn.apexDistance + (index - (turn.chevronCount - 1) / 2) * 7;
    const sample = greenwaterAt(distance);
    const placement = resolveFurniturePlacement({
      halfWidth: sample.halfWidth,
      apronWidth: apronOn(sample, outside),
      side: outside,
      clearance: TURN_CHEVRON_CLEARANCE_METRES,
      footprintHalfWidth: CHEVRON_BOARD_WIDTH / 2,
      centreHeight: 2.3,
      extentHeight: CHEVRON_BOARD_HEIGHT,
    });
    chevrons += 1;
    if (placement.mode === "wall") wallPlaques += 1;
    const shared = {
      map: "greenwater",
      class: "edge",
      distance,
      sample,
      lateral: placement.lateral,
      mode: placement.mode,
    };
    add({
      ...shared,
      id: `${turn.id}_CHEVRON_${index}_BOARD`,
      footprintHalfWidth: CHEVRON_BOARD_WIDTH / 2,
      bottomHeight: placement.centreHeight - CHEVRON_BOARD_HEIGHT / 2,
      topHeight: placement.centreHeight + CHEVRON_BOARD_HEIGHT / 2,
    });
    add({
      ...shared,
      id: `${turn.id}_CHEVRON_${index}_ARROW`,
      footprintHalfWidth: CHEVRON_ARROW_HALF_WIDTH,
      bottomHeight: placement.centreHeight - CHEVRON_ARROW_HEIGHT / 2,
      topHeight: placement.centreHeight + CHEVRON_ARROW_HEIGHT / 2,
    });
    addPlaqueBacking(placement, sample, "chevron", outside, {
      ...shared,
      id: `${turn.id}_CHEVRON_${index}`,
    });
    // The post is what would hold the panel up on a verge. On a wall plaque it
    // is a 2.1 m pole standing on the racing surface, so it is not built.
    if (placement.groundMounted) {
      chevronPosts += 1;
      add({
        ...shared,
        id: `${turn.id}_CHEVRON_${index}_POST`,
        footprintHalfWidth: 0.09,
        bottomHeight: 0,
        topHeight: 2.1,
      });
    }
  }

  for (const boardDistance of turn.boards) {
    const lapLength = blockout.centreline.lapLength;
    const distance = ((turn.entryDistance - boardDistance) % lapLength + lapLength) % lapLength;
    const sample = greenwaterAt(distance);
    const side = turn.direction === "left" ? 1 : -1;
    const placement = resolveFurniturePlacement({
      halfWidth: sample.halfWidth,
      apronWidth: apronOn(sample, side),
      side,
      clearance: EDGE_FURNITURE_CLEARANCE_METRES,
      footprintHalfWidth: DISTANCE_BOARD_WIDTH / 2,
      centreHeight: 2.05,
      extentHeight: DISTANCE_BOARD_HEIGHT,
    });
    brakingBoards += 1;
    if (placement.mode === "wall") wallPlaques += 1;
    const shared = {
      map: "greenwater",
      class: "edge",
      distance,
      sample,
      lateral: placement.lateral,
      mode: placement.mode,
    };
    add({
      ...shared,
      id: `${turn.id}_BOARD_${boardDistance}M_FACE`,
      footprintHalfWidth: DISTANCE_BOARD_WIDTH / 2,
      bottomHeight: placement.centreHeight - DISTANCE_BOARD_HEIGHT / 2,
      topHeight: placement.centreHeight + DISTANCE_BOARD_HEIGHT / 2,
    });
    addPlaqueBacking(placement, sample, "board", side, {
      ...shared,
      id: `${turn.id}_BOARD_${boardDistance}M`,
    });
    // The low approach arrow is deck paint stood on end. A wall plaque drops it.
    if (placement.groundMounted) {
      approachArrows += 1;
      add({
        ...shared,
        id: `${turn.id}_BOARD_${boardDistance}M_ARROW`,
        footprintHalfWidth: 0.78 * CHEVRON_ARROW_HALF_WIDTH,
        bottomHeight: 0.62 - 0.58 * CHEVRON_ARROW_HEIGHT / 2,
        topHeight: 0.62 + 0.58 * CHEVRON_ARROW_HEIGHT / 2,
      });
    }
  }
}

// --- Greenwater: checkpoint gates and the Cradle --------------------------

for (const checkpoint of blockout.checkpoints) {
  const sample = greenwaterAt(checkpoint.distance);
  const lateral = resolveGatePostLateral(
    sample.halfWidth,
    checkpoint.gateWidth / 2 + 0.7,
    1,
  );
  const shared = { map: "greenwater", class: "gate", distance: checkpoint.distance, sample, lateral };
  add({ ...shared, id: `${checkpoint.id}_POST`, footprintHalfWidth: 0.275, bottomHeight: 0, topHeight: checkpoint.mastHeight });
  add({ ...shared, id: `${checkpoint.id}_INDICATOR`, footprintHalfWidth: 0.39, bottomHeight: checkpoint.mastHeight - 3.6, topHeight: checkpoint.mastHeight - 0.4 });
  add({ ...shared, id: `${checkpoint.id}_LABEL`, footprintHalfWidth: 0.95, bottomHeight: checkpoint.mastHeight - 1.5, topHeight: checkpoint.mastHeight - 0.3 });
}

{
  const sample = greenwaterAt(0);
  const span = blockout.startFinish.clearSpan;
  const height = blockout.startFinish.structureHeight;
  const shared = { map: "greenwater", class: "gate", distance: 0, sample, lateral: span / 2 };
  add({ ...shared, id: "SF_THE_CRADLE_COLUMN", footprintHalfWidth: 0.6, bottomHeight: 0, topHeight: height });
  add({ ...shared, id: "SF_THE_CRADLE_VERTICAL", footprintHalfWidth: 0.17, bottomHeight: 2, topHeight: height });
  add({ ...shared, id: "SF_THE_CRADLE_BEACON", footprintHalfWidth: 0.65, bottomHeight: height + 0.45, topHeight: height + 1.75 });
  add({ ...shared, class: "structure", id: "SF_THE_CRADLE_BEAM", lateral: 0, footprintHalfWidth: (span + 1.2) / 2, bottomHeight: height - 1.3, topHeight: height });
  add({ ...shared, class: "structure", id: "SF_THE_CRADLE_LAP_BOARD", lateral: 0, footprintHalfWidth: 4.75, bottomHeight: height - 4.975, topHeight: height - 1.425 });
}

// --- Greenwater: structure and flat furniture -----------------------------
//
// Sampled where each is built. The hangar frame and the route lights run the
// whole length of their sectors, so they are checked at every authored station
// in range rather than at one flattering point.

for (let distance = 616.519; distance <= 816.239; distance += 10) {
  const sample = greenwaterAt(distance);
  const shared = { map: "greenwater", class: "structure", distance, sample };
  add({ ...shared, id: "HANGAR_PILLAR", lateral: sample.halfWidth + 0.9, footprintHalfWidth: 0.35, bottomHeight: 0, topHeight: 16 });
  add({ ...shared, id: "HANGAR_ROOF", lateral: 0, footprintHalfWidth: (sample.halfWidth * 2 + 2.5) / 2, bottomHeight: 15.65, topHeight: 16.35 });
  add({ ...shared, id: "HANGAR_LAMP", lateral: 0, footprintHalfWidth: 1.6, bottomHeight: 15.44, topHeight: 15.56 });
}

for (let index = 0; index < blockout.centreline.samples.length; index += 6) {
  const raw = blockout.centreline.samples[index];
  const sample = greenwaterAt(raw.d);
  const shared = { map: "greenwater", distance: raw.d, sample };
  add({ ...shared, class: "flat", id: "ROUTE_EDGE_LIGHT", lateral: sample.halfWidth - 0.14, footprintHalfWidth: 0.09, bottomHeight: 0.06, topHeight: 0.18 });
  for (const side of [-1, 1]) {
    const edge = side < 0 ? raw.edgeL : raw.edgeR;
    if (edge !== "C") continue;
    add({ ...shared, class: "flat", id: "OPEN_EDGE_WARNING_STRIP", lateral: side * (sample.halfWidth - 0.2), footprintHalfWidth: 0.29, bottomHeight: 0.06, topHeight: 0.12 });
    add({ ...shared, class: "structure", id: "OPEN_EDGE_MARKER", lateral: side * (sample.halfWidth + 5.8), footprintHalfWidth: 0.14, bottomHeight: 0, topHeight: 1.4 });
  }
}

for (const turn of blockout.turns) {
  if (turn.radius >= 300) continue;
  const inside = turn.direction === "left" ? -1 : 1;
  for (let distance = turn.entryDistance; distance <= turn.exitDistance + 0.001; distance += 7) {
    const sample = greenwaterAt(distance);
    add({
      map: "greenwater", class: "flat", id: "TURN_GUIDE_LIGHT", distance, sample,
      lateral: inside * (sample.halfWidth - 0.9),
      footprintHalfWidth: 0.12, bottomHeight: 0.065, topHeight: 0.105,
    });
  }
}

for (const distance of [1705, 1815, 1925, 2035]) {
  const sample = greenwaterAt(distance);
  add({
    map: "greenwater", class: "flat", id: "BOOST_PAD", distance, sample,
    lateral: sample.halfWidth * 0.44,
    footprintHalfWidth: 2.4, bottomHeight: 0.0425, topHeight: 0.0775,
  });
}

{
  const sample = greenwaterAt(0);
  add({ map: "greenwater", class: "flat", id: "GRID_CHEQUER", distance: 0, sample, lateral: 11, footprintHalfWidth: 0.5, bottomHeight: 0.0325, topHeight: 0.0675 });
  for (let index = 0; index < blockout.startFinish.gridPads; index += 1) {
    const lapLength = blockout.centreline.lapLength;
    const distance = ((blockout.startFinish.gridOffset + index * 9) % lapLength + lapLength) % lapLength;
    add({ map: "greenwater", class: "flat", id: `GRID_PAD_${index}`, distance, sample: greenwaterAt(distance), lateral: index % 2 === 0 ? -3.2 : 3.2, footprintHalfWidth: 1.65, bottomHeight: 0.035, topHeight: 0.075 });
  }
}

// --- Bitterpan ------------------------------------------------------------

for (const checkpoint of checkpoints02.checkpoints) {
  const sample = bitterpanAt(checkpoint.station_m);
  const lateral = resolveGatePostLateral(sample.halfWidth, checkpoint.half_width_m, 1);
  const shared = { map: "bitterpan", class: "gate", distance: checkpoint.station_m, sample };
  add({ ...shared, id: `BP_${checkpoint.id}_PYLON`, lateral, footprintHalfWidth: 0.26, bottomHeight: 0, topHeight: checkpoint.height_m });
  add({ ...shared, class: "structure", id: `BP_${checkpoint.id}_CROSSBAR`, lateral: 0, footprintHalfWidth: checkpoint.half_width_m, bottomHeight: checkpoint.height_m - 0.32, topHeight: checkpoint.height_m - 0.04 });
}

for (const pad of production.boostPads.pads) {
  const sample = bitterpanAt(pad.distance);
  add({
    map: "bitterpan", class: "flat", id: `BP_BOOST_PAD_${pad.distance}`, distance: pad.distance, sample,
    lateral: pad.lateralFraction * sample.halfWidth,
    footprintHalfWidth: production.boostPads.lateralHalfFraction * sample.halfWidth,
    bottomHeight: 0.05, topHeight: 0.12,
  });
}

{
  const board = production.lapBoard;
  const sample = bitterpanAt(board.distance);
  add({
    map: "bitterpan", class: "structure", id: "BP_LAP_BOARD", distance: board.distance, sample,
    lateral: board.lateralOffset,
    footprintHalfWidth: board.widthMetres / 2,
    bottomHeight: board.heightMetres - board.boardHeightMetres / 2,
    topHeight: board.heightMetres + board.boardHeightMetres / 2,
  });
}

// P20.2: the dash is a zero-thickness quad, not a box.
//
// It was `BoxGeometry(0.34, 0.055, 7.5)` centred at 0.075 m of lift, so it
// occupied 0.0475..0.1025 m and showed a lit 5.5 cm wall edge-on to the chase
// camera — a cream plank in the lane. It is now a flat plane at 0.055 m of
// lift, which has no vertical extent at all: bottom and top are the same
// number, and that number is the lift. The footprint half-width is unchanged
// (the dash is still 0.34 m across); only the length and the height moved, and
// the length is not modelled here.
for (let distance = 12.5; distance < stations.total_length_m; distance += 25) {
  add({
    map: "bitterpan", class: "flat", id: "BP_CENTRE_DASH", distance, sample: bitterpanAt(distance),
    lateral: 0, footprintHalfWidth: 0.17, bottomHeight: 0.055, topHeight: 0.055,
  });
}

// ---------------------------------------------------------------------------
// Designed hazards.
//
// There is no whitelist here any more. Until P15 this file carried a
// `DECK_HAZARDS` table naming seven hazards that were allowed to stand on the
// racing surface, and the loop below checked a hazard AGAINST that table rather
// than against the road. That is the failure mode the whole file exists to
// prevent, running as a feature: the exemption was the thing being verified, so
// no measurement of the deck could ever fail for those seven.
//
// The rule now has no class of thing outside it. A hazard is measured at its
// own sampled station — half-widths vary 9.5-12.0 m on Greenwater and
// 11.0-15.0 m on Bitterpan, so a single constant would be measuring most
// hazards against the wrong road.
// ---------------------------------------------------------------------------

/**
 * The deck predicate for hazards, as a pure function of one record so the
 * negative test below can run the SAME code over a synthetic hazard pinned back
 * onto the road. Returns the measurement; `assertHazardOffDeck` turns a failure
 * into the message.
 */
function measureHazardClearance({ lateral, halfWidth }) {
  const required = halfWidth + DECK_CLEARANCE_METRES;
  const reach = Math.abs(lateral);
  return { required, reach, shortfall: required - reach, clears: reach >= required };
}

function assertHazardOffDeck({ id, map, distance, lateral, halfWidth }) {
  const { required, reach, shortfall } = measureHazardClearance({ lateral, halfWidth });
  assert.ok(
    Number.isFinite(lateral) && Number.isFinite(halfWidth),
    `${map}/${id} has a non-finite lateral or half-width, so its clearance is `
      + "NaN and every comparison against it passes silently.",
  );
  assert.ok(
    reach >= required,
    `${map}/${id} at ${distance} m stands ${reach.toFixed(3)} m from the `
      + `centreline against a ${halfWidth.toFixed(3)} m half-width. It needs `
      + `${required.toFixed(3)} m (half-width + ${DECK_CLEARANCE_METRES} m deck `
      + `clearance) and falls ${shortfall.toFixed(3)} m short, so it is an `
      + "obstacle standing on the racing surface. Nothing stands on the deck — "
      + "move it outboard. There is no exemption list to add it to.",
  );
}

// The cargo hook is authored as a hazard but is not one: it swings from the
// hangar ceiling as a cosmetic near-miss and is explicitly `collision: false`.
// It is swept as overhead structure with the rest of the frame below rather
// than filtered out here — an exemption by `continue` is an exemption nobody
// ever reads again.
{
  const hook = blockout.hazards.find((hazard) => hazard.type === "swinging_hook");
  const sample = greenwaterAt(hook.distance);
  // Pivot at 15.2 m; the cable hangs 7.4 m and the hook ring 0.78 m below that.
  add({
    map: "greenwater", class: "structure", id: hook.id, distance: hook.distance, sample,
    lateral: hook.lateralOffset ?? 0,
    footprintHalfWidth: 0.96,
    bottomHeight: 15.2 - 7.55 - 0.96,
    topHeight: 15.2,
  });
}

const authoredHazards = [
  ...blockout.hazards
    .filter((hazard) => hazard.lateralOffset !== undefined)
    .map((hazard) => ({
      id: hazard.id,
      map: "greenwater",
      distance: hazard.distance,
      lateral: hazard.lateralOffset,
      halfWidth: greenwaterAt(hazard.distance).halfWidth,
    })),
  ...production.hazards.entries
    .filter((hazard) => hazard.lateralOffset !== undefined)
    .map((hazard) => ({
      id: hazard.id,
      map: "bitterpan",
      distance: hazard.distance,
      lateral: hazard.lateralOffset,
      halfWidth: bitterpanAt(hazard.distance).halfWidth,
    })),
];

// The sweep is only worth its assertion if it found the hazards. Seven laterals
// are authored across the two maps; a filter that silently matched none would
// make the loop below a no-op that reports PASS.
assert.equal(
  authoredHazards.length,
  7,
  `The hazard sweep collected ${authoredHazards.length} authored laterals, not the `
    + "7 the two maps author. Either a hazard was added or removed without this "
    + "count being re-argued, or the filter stopped matching and the deck rule "
    + "below is asserting nothing.",
);

let tightestHazard = Number.POSITIVE_INFINITY;
for (const hazard of authoredHazards) {
  assertHazardOffDeck(hazard);
  tightestHazard = Math.min(tightestHazard, -measureHazardClearance(hazard).shortfall);
}

// ---------------------------------------------------------------------------
// Negative test: prove the rule above can fail.
//
// The seven authored hazards all pass, so running them proves only that the
// loop executes — not that the predicate binds. So re-pin one onto the deck
// IN MEMORY, at the centreline, and assert that the SAME function throws, with
// a message naming the hazard, its lateral, the half-width it was measured
// against and the shortfall. The real JSON is never touched: the synthetic
// record is built from the real half-width of a real station so it is measured
// against the same road, and thrown away.
// ---------------------------------------------------------------------------

{
  const victim = authoredHazards[0];
  const repinned = { ...victim, id: `${victim.id}__SYNTHETIC_REPIN`, lateral: 0 };
  const measured = measureHazardClearance(repinned);
  assert.equal(
    measured.clears,
    false,
    "The synthetic re-pin at lateral 0 was measured as clearing the deck, so the "
      + "negative test is not testing anything.",
  );
  assert.throws(
    () => assertHazardOffDeck(repinned),
    (error) => {
      assert.ok(error instanceof assert.AssertionError, "The deck rule threw the wrong error type.");
      const message = String(error.message);
      for (const fragment of [
        repinned.id,
        "0.000 m from the centreline",
        `${victim.halfWidth.toFixed(3)} m half-width`,
        `falls ${measured.shortfall.toFixed(3)} m short`,
      ]) {
        assert.ok(
          message.includes(fragment),
          `The deck-rule failure message does not name "${fragment}". A failure `
            + "nobody can read is a failure nobody acts on. Got: " + message,
        );
      }
      return true;
    },
    "A hazard re-pinned onto the centreline did NOT fail the deck rule. The rule "
      + "cannot fail, so it has never proved anything about the seven that pass.",
  );
  // And the failure has to come from the re-pin, not from the record shape:
  // the untouched original must still pass through the same function.
  assert.doesNotThrow(
    () => assertHazardOffDeck(victim),
    `${victim.map}/${victim.id} fails the deck rule unchanged, so the negative `
      + "test above proved nothing about the re-pin.",
  );
}

// ---------------------------------------------------------------------------
// The rule.
// ---------------------------------------------------------------------------

assert.ok(items.length > 0, "The sweep collected nothing, so it asserts nothing.");

const seenClasses = new Set();
let tightestGate = Number.POSITIVE_INFINITY;
for (const item of items) {
  seenClasses.add(item.class);
  const where = `${item.map}/${item.id} at ${item.distance.toFixed(1)} m`;
  const inner = Math.abs(item.lateral) - item.footprintHalfWidth;

  assert.ok(
    item.topHeight >= item.bottomHeight,
    `${where} is drawn upside down: bottom ${item.bottomHeight}, top ${item.topHeight}.`,
  );

  // HARD, every class except the pinned hazards above: nothing below the plaque
  // band may stand over the racing surface. A gate mast IS the gate and stands
  // at the track edge by design, so it answers to the measured mast floor
  // rather than the wider furniture one — a different number for the same rule,
  // never an exemption from it.
  const clearance = item.class === "gate"
    ? GATE_POST_DECK_CLEARANCE_METRES
    : DECK_CLEARANCE_METRES;
  assert.ok(
    clearsDeck(item, clearance),
    `${where} reaches ${inner.toFixed(2)} m from the centreline against a `
      + `${item.halfWidth.toFixed(2)} m half-width, with its lower edge at `
      + `${item.bottomHeight.toFixed(2)} m. That is inside the deck and below the `
      + `${PLAQUE_BAND_BOTTOM_METRES} m plaque band, so it is an obstacle drawn `
      + `on the road. This class needs ${clearance} m of deck clearance, or a `
      + "lower edge above the band.",
  );

  if (item.class === "flat") {
    assert.ok(
      item.topHeight <= FLAT_FURNITURE_MAX_HEIGHT_METRES,
      `${where} is classed as flat furniture but its top edge is at `
        + `${item.topHeight.toFixed(3)} m, above the `
        + `${FLAT_FURNITURE_MAX_HEIGHT_METRES} m ceiling. Painted road that grows `
        + "into an obstacle has to answer to the lateral rule instead.",
    );
  }

  if (item.class === "edge") {
    // Edge furniture also clears the drivable run-off. The run-off is a cost,
    // not a stop: a player who slides wide drives across it, so a board
    // standing in it is an object they pass through.
    assert.ok(
      clearsRunOff(item),
      `${where} stands ${inner.toFixed(2)} m out, inside a drivable corridor `
        + `reaching ${(item.halfWidth + item.apronWidth).toFixed(2)} m. `
        + "Edge furniture clears the run-off too, or mounts on the wall.",
    );
    // A wall plaque exists only where there is no verge to stand on, and a
    // verge placement exists only where there is one. Nothing in between.
    assert.equal(
      item.mode,
      item.apronWidth > 0 ? "verge" : "wall",
      `${where} resolved to "${item.mode}" against an apron of ${item.apronWidth} m.`,
    );
  }

  if (item.class === "gate" && item.bottomHeight < PLAQUE_BAND_BOTTOM_METRES) {
    // Gate masts are not held to the run-off rule — a gate pushed to the
    // run-off lip would be half again as wide as the plane being scored — but
    // they are held to the deck, and the floor above is the whole of it.
    //
    // Only the parts the lateral rule binds on are measured. A gate's number
    // plate is a wide plane 7.5 m up and DOES overhang the deck edge by a
    // quarter of a metre; it is legal because it is overhead, and folding it
    // into the mast measurement would make the floor look tighter than the
    // thing it is a floor for.
    tightestGate = Math.min(tightestGate, inner - item.halfWidth);
  }
}

assert.deepEqual(
  [...seenClasses].sort(),
  ["edge", "flat", "gate", "structure"],
  "The sweep no longer covers all four furniture classes.",
);

// GATE_POST_DECK_CLEARANCE_METRES is derived from the authored gates, so it has
// to keep tracking them. Pinning the measurement stops the constant drifting
// into a number nothing was measured against — and stops it being quietly
// lowered to make a future gate fit.
assert.equal(
  Number(tightestGate.toFixed(3)),
  0.425,
  `The tightest gate mast now clears the deck by ${tightestGate.toFixed(3)} m, `
    + "not the 0.425 m GATE_POST_DECK_CLEARANCE_METRES was measured against. "
    + "Re-measure and re-argue the floor rather than moving it to fit.",
);
assert.ok(
  GATE_POST_DECK_CLEARANCE_METRES < tightestGate,
  "The gate floor is at or above the tightest authored gate, so it is asserting "
    + "nothing about the gate that actually binds.",
);

// ---------------------------------------------------------------------------
// The P13 outcome, pinned.
//
// Counts rather than positions, because the positions are already asserted
// above. If a future phase re-authors the hangar with a verge, these numbers
// move and the change has to be argued for rather than absorbed.
// ---------------------------------------------------------------------------

assert.equal(chevrons, 23, "Greenwater authors 23 turn chevrons.");
assert.equal(brakingBoards, 19, "Greenwater authors 19 braking boards.");
assert.equal(
  wallPlaques,
  13,
  "13 placements fall in the hangar's barrier span and become wall plaques: "
    + "7 chevrons (T4, T5) and 6 braking boards (T4/T5/T6). This is the count "
    + "P11 left standing on the road.",
);
assert.equal(
  chevronPosts,
  16,
  "A chevron post is built only on a verge; the 7 hangar chevrons drop theirs.",
);
assert.equal(
  approachArrows,
  13,
  "A low approach arrow is built only on a verge; the 6 hangar boards drop "
    + "theirs. These are the deck-level arrows in the player report.",
);

// ---------------------------------------------------------------------------
// P15's backing panels, tied to the count above rather than declared beside it.
//
// One panel per wall plaque, and the same 7/6 split — the two numbers come from
// the same resolver pass, so they cannot drift. `HANGAR_SIX_PLAQUE_BACKING.json`
// declares what it expects, and that declaration is checked against what the
// resolver actually produced rather than trusted.
// ---------------------------------------------------------------------------

const backingPanels = backingCounts.chevron + backingCounts.board;
assert.equal(
  backingPanels,
  wallPlaques,
  `${backingPanels} backing panels for ${wallPlaques} wall plaques. Every plaque `
    + "bolts to a panel and every panel backs a plaque; a spare panel is a plate "
    + "on an empty wall and a missing one is a plaque floating in a pillar gap.",
);
assert.equal(backingCounts.chevron, 7, "7 chevron plaques take a PANEL_CHEVRON.");
assert.equal(backingCounts.board, 6, "6 braking boards take a PANEL_BOARD.");
assert.equal(
  plaqueBacking.derivation.expected.panels,
  backingPanels,
  "The backing spec's declared panel count disagrees with the resolver.",
);
assert.equal(plaqueBacking.derivation.expected.chevronPanels, backingCounts.chevron);
assert.equal(plaqueBacking.derivation.expected.boardPanels, backingCounts.board);

// Every panel went through the sweep above as EDGE furniture, so it has already
// been measured against `clearsDeck` and `clearsRunOff` with the rest. What is
// asserted here is the reason it passes: the lower edge is flush with the band,
// nothing hangs below it, and the panel really is behind its plaque.
const backingItems = items.filter((item) => item.id.endsWith("_BACKING"));
assert.equal(backingItems.length, backingPanels, "The sweep lost a backing panel.");
for (const item of backingItems) {
  assert.ok(
    item.bottomHeight >= PLAQUE_BAND_BOTTOM_METRES,
    `${item.id} hangs to ${item.bottomHeight} m, below the `
      + `${PLAQUE_BAND_BOTTOM_METRES} m plaque band. A backing panel grows upward `
      + "only; a symmetric margin would put structure over the deck, which is "
      + "the precise P13 failure this phase must not reintroduce.",
  );
  assert.equal(
    item.mode,
    "wall",
    `${item.id} was emitted for a ${item.mode} placement; only a wall plaque has `
      + "anything to be bolted to.",
  );
  // Outboard of the plaque it backs, by exactly the 60 mm the sheet's shadow
  // recess is drawn for. Inboard would put the panel in front of the plaque.
  assert.equal(
    Number((Math.abs(item.lateral) - (item.halfWidth - WALL_PLAQUE_INSET_METRES)).toFixed(4)),
    Number((WALL_PLAQUE_INSET_METRES - BACKING_INSET_METRES).toFixed(4)),
    `${item.id} does not stand ${WALL_PLAQUE_INSET_METRES - BACKING_INSET_METRES} m `
      + "outboard of its plaque.",
  );
}

// ---------------------------------------------------------------------------
// H1 — the wall-span rule, asserted DIRECTLY instead of only as a side effect.
//
// Honest scope first. A hangar plaque that lost its height ALREADY fails the
// sweep above, because `clearsDeck` passes an item either for being far enough
// outboard or for clearing the plaque band, and a plaque pinned 0.35 m inside
// the wall line can never satisfy the first. Verified by re-pinning the
// resolver to the authored 2.05 m centre: the sweep fails on
// `T4_CHEVRON_0_BOARD`. So the loop below is not the thing that catches a
// regression — it is the thing that NAMES it. What it adds on top:
//
//   - the failure message says "barrier span, below the plaque band" instead of
//     "inside the deck", which is the difference between a reader reaching for
//     the lateral and reaching for the height;
//   - a wall plaque must also be INSIDE its wall line, which nothing checked;
//   - the count guard, so the rule cannot quietly sweep zero items if a future
//     edit stops authoring `widthMetres: 0`;
//   - the 50M board's lower edge is pinned to the band EXACTLY, at the station
//     the H1 report names, rather than only "somewhere at or above it".
// ---------------------------------------------------------------------------

const wallItems = items.filter((item) => item.mode === "wall");
assert.ok(
  wallItems.length >= 26,
  `only ${wallItems.length} placements resolved as wall plaques, so this rule `
    + "swept almost nothing. LINK_APRON and HANGAR_SIX author widthMetres: 0 "
    + "for 13 plaques and their 13 backing panels.",
);
for (const item of wallItems) {
  assert.ok(
    item.bottomHeight >= PLAQUE_BAND_BOTTOM_METRES - PLACEMENT_EPSILON_METRES,
    `${item.map}/${item.id} stands in a BARRIER span (apronWidth 0) at lateral `
      + `${item.lateral.toFixed(2)} m against a ${item.halfWidth.toFixed(2)} m `
      + `half-width, with its lower edge at ${item.bottomHeight.toFixed(2)} m — `
      + `below the ${PLAQUE_BAND_BOTTOM_METRES} m plaque band. There is no verge `
      + "to stand on inside a wall span, so a board that keeps its open-air "
      + "height is an obstacle at the chase camera's eye line, in the road, for "
      + "a player pinned against that wall.",
  );
  assert.ok(
    Math.abs(item.lateral) <= item.halfWidth + PLACEMENT_EPSILON_METRES,
    `${item.map}/${item.id} is a wall plaque at lateral `
      + `${item.lateral.toFixed(2)} m, OUTSIDE the ${item.halfWidth.toFixed(2)} m `
      + "wall line it is supposed to be bolted to.",
  );
}

// The negative fixture. This is the placement P11 shipped and P13 fixed: the
// hangar clamp pulled the board inside the wall line and left its authored
// open-air centre height alone. If the loop above cannot fail on it, it is not
// testing anything.
const hangarSample = greenwaterAt(664.1);
assert.equal(
  apronOn(hangarSample, -1),
  0,
  "HANGAR_SIX no longer authors a zero-width apron on the left, so the fixture "
    + "below is not standing in a barrier span any more.",
);
const brokenBoard = {
  map: "greenwater",
  id: "H1_FIXTURE_HANGAR_BOARD_AT_VERGE_HEIGHT",
  mode: "wall",
  lateral: -Math.max(0, hangarSample.halfWidth - WALL_PLAQUE_INSET_METRES),
  halfWidth: hangarSample.halfWidth,
  apronWidth: 0,
  footprintHalfWidth: DISTANCE_BOARD_WIDTH / 2,
  // The authored open-air geometry: centre 2.05 m, 1.28 m tall.
  bottomHeight: 2.05 - DISTANCE_BOARD_HEIGHT / 2,
  topHeight: 2.05 + DISTANCE_BOARD_HEIGHT / 2,
};
assert.ok(
  brokenBoard.bottomHeight < PLAQUE_BAND_BOTTOM_METRES - PLACEMENT_EPSILON_METRES,
  "the fixture's lower edge is no longer below the plaque band, so it has "
    + "stopped reproducing the P11 failure.",
);
assert.ok(
  !clearsDeck(brokenBoard),
  "the fixture also has to fail the older deck predicate; if it passes both, "
    + "the two rules disagree about the same geometry.",
);
// And the shipped resolver must never produce it: same corridor, same authored
// geometry, in through the front door.
const hangarPlacement = resolveFurniturePlacement({
  halfWidth: hangarSample.halfWidth,
  apronWidth: apronOn(hangarSample, -1),
  side: -1,
  clearance: EDGE_FURNITURE_CLEARANCE_METRES,
  footprintHalfWidth: DISTANCE_BOARD_WIDTH / 2,
  centreHeight: 2.05,
  extentHeight: DISTANCE_BOARD_HEIGHT,
});
assert.equal(hangarPlacement.mode, "wall");
assert.equal(
  Number((hangarPlacement.centreHeight - DISTANCE_BOARD_HEIGHT / 2).toFixed(6)),
  PLAQUE_BAND_BOTTOM_METRES,
  "the HANGAR_SIX 50M board's lower edge must land exactly on the plaque band.",
);
assert.equal(
  hangarPlacement.groundMounted,
  false,
  "a wall plaque must not keep the post and approach arrow that would stand on "
    + "the racing surface under it.",
);

// ---------------------------------------------------------------------------
// P12's trackside signage answers to the same deck rule.
//
// Its 13 pinned run-off intrusions stay pinned — validate-art-pass.mjs owns
// that table and the reasoning behind it. What is asserted here is only that
// the two layers agree about the DECK, through one shared predicate rather
// than two hand-written comparisons.
// ---------------------------------------------------------------------------

let signageChecked = 0;
for (const [map, spec] of [["greenwater", signage.greenwater], ["bitterpan", signage.bitterpan]]) {
  for (const placement of spec.placements) {
    const sample = map === "greenwater"
      ? greenwaterAt(placement.distance)
      : bitterpanAt(placement.distance);
    const item = {
      halfWidth: sample.halfWidth,
      lateral: placement.lateral,
      footprintHalfWidth: 0,
      bottomHeight: placement.height - placement.heightMetres / 2,
      topHeight: placement.height + placement.heightMetres / 2,
    };
    assert.ok(
      clearsDeck(item),
      `${map}/${placement.id} stands at ${placement.lateral} m against a `
        + `${sample.halfWidth.toFixed(2)} m half-width with its lower edge at `
        + `${item.bottomHeight.toFixed(2)} m — a board on the racing surface.`,
    );
    signageChecked += 1;
  }
}

assert.equal(signageChecked, 34, "Both maps' signage is 34 boards.");

const counts = items.reduce((tally, item) => {
  tally[item.class] = (tally[item.class] ?? 0) + 1;
  return tally;
}, {});

console.log(
  `Furniture PASS: ${items.length} placements swept through the shipped `
    + `resolution helper (${counts.edge} edge, ${counts.gate} gate, `
    + `${counts.structure} structure, ${counts.flat} flat) across both maps; `
    + `every one clears the deck by ${DECK_CLEARANCE_METRES} m+ `
    + `(${GATE_POST_DECK_CLEARANCE_METRES} m for gate masts, tightest `
    + `${tightestGate.toFixed(3)} m) or sits above the `
    + `${PLAQUE_BAND_BOTTOM_METRES} m plaque band. ${wallPlaques} hangar `
    + `placements resolve as wall plaques, dropping 7 posts and 6 deck-level `
    + `approach arrows; ${authoredHazards.length} authored hazards measured off `
    + `the deck with no exemption list (tightest ${tightestHazard.toFixed(3)} m `
    + `spare), the rule proved failable by a synthetic re-pin at lateral 0; `
    + `${signageChecked} P12 boards re-checked against `
    + `the same deck predicate. H1: ${wallItems.length} barrier-span `
    + `placements asserted directly against the `
    + `${PLAQUE_BAND_BOTTOM_METRES} m plaque band and inside their wall `
    + "line, the rule proved failable by a board re-pinned at its authored "
    + "1.41 m open-air height in HANGAR_SIX. "
    + `P15: ${backingPanels} plaque backings `
    + `(${backingCounts.chevron} chevron + ${backingCounts.board} board) derived `
    + `from those same wall placements, measured not exempted — every lower edge `
    + `flush at ${PLAQUE_BAND_BOTTOM_METRES} m and every panel `
    + `${WALL_PLAQUE_INSET_METRES - BACKING_INSET_METRES} m outboard of the plaque `
    + "it backs.",
);
