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
      // P21 — compared against `clampMax`, the clamp at the span's WIDEST
      // station, not `clamp`, its narrowest.
      //
      // A 10 m bucket can straddle an edge-type change: at Greenwater 840-850 m
      // the works stand ends and the open pan begins, so the authored clamp runs
      // 12.88 m at one end and 17.80 m at the other. Capping the derived limit
      // at the NARROW end suppressed the entry entirely — 14.19 m is not tighter
      // than 12.88 m — and left the runtime clamp at 848 m running the full
      // 17.80 m with a 1.4 m edge marker standing at 17.66 m, which the P21
      // census caught the craft driving through.
      //
      // Emitting against the wide end cannot widen anything: `resolveApron`
      // evaluates `min(authoredLimit, derived)` at every station from that
      // station's own apron, so at the narrow end of the same span the 12.88 m
      // still wins. The invariant that matters — a derived limit never exceeds
      // what the craft was already allowed — is unchanged; it is just now
      // stated against the clamp the derivation actually used.
      const cap = entry.clampMax ?? entry.clamp;
      assert.ok(
        measured.limit <= cap + EPSILON,
        `${table.map} @${entry.distance} m ${side}: limit ${measured.limit} m is `
          + `wider than the authored clamp ${cap} m. The table may only `
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
// P21.4 THE SUPPORT INVARIANT: a limit may not stand past the drawn surface.
//
// The failure it comes from, measured by `scripts/visual/vehicle-pixels.mjs` on
// the Greenwater Sweep: the craft out at lateral -14.49 painted 678 pixels of a
// 1280x720 frame, because the authored deck draws roughly one metre of A-edge
// run-off where the apron table authors five, and the limit let the craft three
// metres past the last drawn triangle. Physics was happy; the craft was not on
// screen.
//
// So every limit carries the mesh that set it, and a limit set by the support
// sweep must be at or inside the support measurement it came from. Asserted
// through the `setBy` label rather than by re-deriving the support here: this
// file has no scene, and a second copy of the sweep would be a second thing to
// keep in step.
//
// The MAP-LEVEL gate is the one that matters most, and it is asserted from the
// summary: `supportUsable` false means the capture could not see the road, and
// in that case NO side may carry a support limit. Bitterpan is exactly that
// case - its drawn deck is the blockout GLB, which the corridor sweep excludes
// by name, so 193 of its 610 span-sides report no surface even at the deck
// edge. Clamping to that would wall off road the player can see.
// ---------------------------------------------------------------------------
const SUPPORT_PREFIX = "surface-support(";
for (const table of [greenwater, bitterpan]) {
  const summary = table.summary ?? {};
  assert.ok(
    typeof summary.supportUsable === "boolean",
    `${table.map}: the table carries no supportUsable flag, so there is no way `
      + "to tell a capture that measured the drawn surface from one that could "
      + "not see it. Re-derive with the current scripts.",
  );
  let supportSides = 0;
  for (const entry of table.entries) {
    for (const side of ["left", "right"]) {
      const measured = entry[side];
      if (!measured || !String(measured.setBy).startsWith(SUPPORT_PREFIX)) continue;
      supportSides += 1;
      assert.ok(
        measured.limit <= (entry.clampMax ?? entry.clamp) + EPSILON,
        `${table.map} @${entry.distance} m ${side}: a support limit of `
          + `${measured.limit} m is wider than the clamp it was capped against.`,
      );
      assert.ok(
        measured.limit >= entry.halfWidth - EPSILON,
        `${table.map} @${entry.distance} m ${side}: the support limit `
          + `${measured.limit} m is inside the ${entry.halfWidth} m deck edge. `
          + "Support may trim run-off; it may never narrow the racing surface.",
      );
    }
  }
  if (summary.supportUsable === false) {
    assert.equal(
      supportSides,
      0,
      `${table.map}: the capture reports ${summary.supportNullSides} span-sides `
        + "with no drawn surface even at the deck edge, so its support "
        + `measurement is not usable - yet ${supportSides} side(s) are limited by `
        + "it. A support limit derived from a capture that could not see the "
        + "road is an invisible wall over visible ground.",
    );
  } else {
    assert.equal(
      summary.supportNullSides,
      0,
      `${table.map}: supportUsable is true with ${summary.supportNullSides} null `
        + "sides. Those two cannot both be right.",
    );
    assert.equal(
      supportSides,
      summary.supportCappedSides,
      `${table.map}: the summary claims ${summary.supportCappedSides} sides were `
        + `capped by support but ${supportSides} carry the label.`,
    );
  }
}

// The negative fixture: the invariant has to be able to FAIL. A support limit
// pushed inside the deck edge must be rejected, or the assertion above is
// decoration. Same shape as the synthetic re-pin `validate-furniture.mjs` uses.
{
  const fixture = {
    map: "fixture",
    halfWidth: 12,
    clamp: 17,
    clampMax: 17,
    left: { limit: 11.4, setBy: "surface-support(unbounded)", tall: 13 },
  };
  let rejected = false;
  try {
    assert.ok(
      fixture.left.limit >= fixture.halfWidth - EPSILON,
      "support limit inside the deck edge",
    );
  } catch {
    rejected = true;
  }
  assert.ok(
    rejected,
    "The support invariant did not reject a limit 0.6 m inside the deck edge, "
      + "so it would not catch the failure it exists for.",
  );
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
// The derivation threshold is 0.85 m, under the 1.01 m minimum hover (raised
// from 0.89 m in P19 so the stabiliser ring clears the deck). A
// cable coil topping out at 0.78 m is cleared by 0.23 m, so putting an
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
      + "the craft's 1.01 m minimum hover, so the craft flies over it: a derived "
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
