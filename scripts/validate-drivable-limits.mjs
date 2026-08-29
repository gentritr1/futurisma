/**
 * P16 task 6 — the invariant that makes the user's bug class structurally
 * impossible, plus two sanity assertions on the table itself.
 *
 * The bug: `resolveApron` let the craft's clamp run past the visible boundary,
 * so at Cradle Bend it could be driven 5.24 m through a wall into black void.
 * The fix derives the limit from measured geometry. This file is what stops the
 * fix from rotting — and, just as importantly, what catches the ATTRIBUTION
 * regressing, because a wrong table cannot be caught by anything else in the
 * repo:
 *
 *   - the soaks cannot see it. Clamping every limit to `halfWidth` — run-off
 *     removed entirely — left all five Greenwater lap times bit-identical,
 *     because the autopilot never leaves the racing line.
 *   - `validate-race.mjs` cannot see it. It runs its own model of the course and
 *     never loads the table; it stayed green while the gate-miss probe silently
 *     stopped missing its gate.
 *
 * So the table gets asserted directly, against the meshes the sweep named.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function readJson(relativePath) {
  return JSON.parse(readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8"));
}

const greenwater = readJson("src/game/data/DRIVABLE_LIMITS.json");
const bitterpan = readJson("src/game/data/map02/DRIVABLE_LIMITS.json");
const blockout = readJson("src/game/data/greenwater-blockout.json");

const HULL_MARGIN_METRES = 1.6;
const EPSILON = 1e-6;

// ---------------------------------------------------------------------------
// THE INVARIANT: no tall geometry inside the final drivable reach.
//
// For every limited span, on every side, the geometry that set the limit must
// end up OUTSIDE the limit by at least the hull margin. This is the property
// that makes "driven into a wall the game let me reach" unrepresentable.
// ---------------------------------------------------------------------------
for (const table of [greenwater, bitterpan]) {
  assert.ok(
    table.entries.length > 0,
    `${table.map}: the derived limit table is empty. An empty table silently `
      + "restores the old clamp everywhere, which is the bug this phase fixed.",
  );
  assert.equal(
    table.hullMarginMetres,
    HULL_MARGIN_METRES,
    `${table.map}: hull margin drifted from the ruled ${HULL_MARGIN_METRES} m.`,
  );

  for (const entry of table.entries) {
    for (const side of ["left", "right"]) {
      const measured = entry[side];
      if (!measured) continue;

      assert.ok(
        measured.tall - measured.limit >= HULL_MARGIN_METRES - EPSILON
          || measured.limit <= entry.halfWidth + EPSILON,
        `${table.map} @${entry.distance} m ${side}: the ${measured.setBy} that `
          + `set this span stands at ${measured.tall} m and the limit is `
          + `${measured.limit} m — only ${(measured.tall - measured.limit).toFixed(3)} m `
          + `of hull clearance, under the ${HULL_MARGIN_METRES} m margin. The craft `
          + "would reach geometry it can see.",
      );
      assert.ok(
        measured.limit >= entry.halfWidth - EPSILON,
        `${table.map} @${entry.distance} m ${side}: limit ${measured.limit} m is `
          + `inside the ${entry.halfWidth} m deck edge. The racing surface must `
          + "stay fully drivable; the table may only ever trim run-off.",
      );
      assert.ok(
        measured.limit <= entry.clamp + EPSILON,
        `${table.map} @${entry.distance} m ${side}: limit ${measured.limit} m is `
          + `wider than the authored clamp ${entry.clamp} m. The table may only `
          + "narrow.",
      );
      assert.ok(
        measured.setBy,
        `${table.map} @${entry.distance} m ${side}: no bounding mesh recorded. A `
          + "derived physics limit must be able to say what put it there.",
      );
    }
  }
}

// ---------------------------------------------------------------------------
// SANITY (a): Bitterpan's open pan keeps its run-off.
//
// Sampled by the MESH the sweep named rather than by hand-picked distances, so
// this fails if attribution regresses. The first derivation had the Bitterpan
// ROAD bounding itself — `BITTERPAN_track_blockout` on 523 of 525 span-sides —
// which would have deleted the pan run-off across the whole map.
// ---------------------------------------------------------------------------
const PAN_SPAN_START = 1000;
const PAN_SPAN_END = 1500;
const panEntries = bitterpan.entries.filter(
  (entry) => entry.distance >= PAN_SPAN_START && entry.distance <= PAN_SPAN_END,
);
assert.equal(
  panEntries.length,
  0,
  `Bitterpan limits ${panEntries.length} spans between ${PAN_SPAN_START} and `
    + `${PAN_SPAN_END} m, over the open salt pan. Nothing tall stands there — it `
    + "is a flat painted edge onto drivable ground — so nothing should bound it. "
    + `Bounded by: ${panEntries.map((e) => e.left?.setBy ?? e.right?.setBy).join(", ")}. `
    + "If this names a track mesh, the sweep is measuring the superseded blockout "
    + "GLB again rather than the ribbon the player drives.",
);
const bitterpanBounders = new Set(
  bitterpan.entries.flatMap((entry) => [entry.left?.setBy, entry.right?.setBy])
    .filter(Boolean),
);
for (const mesh of bitterpanBounders) {
  assert.ok(
    !/track_blockout|COLLISION_PROXY/i.test(mesh),
    `Bitterpan span limited by ${mesh}: the road cannot be the wall that bounds `
      + "it. The blockout GLB is a superseded duplicate of the procedural ribbon "
      + "and is excluded from the sweep by construction; if it is back in the "
      + "table, that exclusion has broken.",
  );
}

// ---------------------------------------------------------------------------
// SANITY (a2): nothing the craft flies over may bound it.
//
// The derivation threshold is 0.85 m, just under the 0.89 m minimum hover. A
// cable coil topping out at 0.78 m is cleared by 0.11 m, so putting an
// invisible wall at one recreates the exact "invisible boundary" feel this
// phase exists to kill — while the coil itself, being 0.78 m of obstacle on the
// racing surface, still has to clear the deck and still trips you if you skim
// it. Those are different questions and the two thresholds answer them
// separately.
//
// Three Bitterpan spans were freed by the change, all coil-bounded. Asserted by
// distance AND by the mesh that used to bound them, so a regression that
// re-lowers the derivation threshold fails here by name.
// ---------------------------------------------------------------------------
const FREED_BY_HOVER_CLEARANCE = [2460, 3020, 3020];
for (const distance of new Set(FREED_BY_HOVER_CLEARANCE)) {
  const entry = bitterpan.entries.find((e) => e.distance === distance);
  const bounder = entry?.left?.setBy ?? entry?.right?.setBy ?? null;
  assert.ok(
    !bounder || !/cable_coils/i.test(bounder),
    `Bitterpan @${distance} m is limited by ${bounder}. That coil tops out below `
      + "the craft's 0.89 m minimum hover, so the craft flies over it: a derived "
      + "limit there is an invisible wall at a hazard you can visibly clear. The "
      + "derivation threshold has regressed below 0.85 m.",
  );
}

// ---------------------------------------------------------------------------
// SANITY (b): Greenwater's walled corner trims.
//
// T1_CRADLE_BEND is where the report came from — 5.24 m of overshoot past a
// wall. Sampled by bounding mesh, not by distance, for the same reason as (a).
// ---------------------------------------------------------------------------
const cradle = blockout.sectors.find((sector) => sector.id === "T1_CRADLE_BEND")
  ?? { startDistance: 220, endDistance: 377.08 };
const cradleEntries = greenwater.entries.filter(
  (entry) => entry.distance >= cradle.startDistance
    && entry.distance <= cradle.endDistance,
);
assert.ok(
  cradleEntries.length >= 10,
  `Cradle Bend has only ${cradleEntries.length} limited spans; expected the `
    + "walled corner to be trimmed along its length.",
);
const cradleTrims = cradleEntries.flatMap((entry) => (
  ["left", "right"].filter((side) => entry[side])
    .map((side) => entry.clamp - entry[side].limit)
));
const deepestCradleTrim = Math.max(...cradleTrims);
assert.ok(
  deepestCradleTrim >= 1,
  `Cradle Bend's deepest trim is ${deepestCradleTrim.toFixed(2)} m; expected at `
    + "least 1 m. The walls there stand 0.24 m inside the deck edge against a "
    + "5 m authored shoulder — if nothing trims, the clamp is back to letting "
    + "the craft through them.",
);
const cradleBounders = new Set(
  cradleEntries.flatMap((entry) => [entry.left?.setBy, entry.right?.setBy])
    .filter(Boolean),
);

console.log(
  `Drivable limits PASS: ${greenwater.entries.length} Greenwater spans and `
  + `${bitterpan.entries.length} Bitterpan spans limited, every one clearing its `
  + `own bounding geometry by ${HULL_MARGIN_METRES} m and never crossing the deck `
  + `edge; Bitterpan's open pan (${PAN_SPAN_START}-${PAN_SPAN_END} m) keeps its `
  + `full authored run-off and no span is bounded by the superseded blockout; `
  + `Cradle Bend trims ${deepestCradleTrim.toFixed(2)} m across `
  + `${cradleEntries.length} spans, set by ${[...cradleBounders].join(", ")}.`,
);
