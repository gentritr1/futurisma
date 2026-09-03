/**
 * P16 task 6 — derives the per-span drivable limit from the rendered world.
 *
 * WHY THIS EXISTS. `resolveApron` set `lateralLimit = halfWidth + width` for
 * every edge, and `game.ts` clamped the craft's lateral to it unconditionally —
 * `apron.wall` only gated the impact FX. The art disagreed: at Cradle Bend the
 * trackside wall stands at 10.76 m and the clamp allowed 16.0 m, so the craft
 * could be driven 5.24 m past its own visible boundary into black void. That is
 * the "under the road" report.
 *
 * WHY IT IS A GENERATION SCRIPT AND NOT RUNTIME CODE. The measurement needs the
 * whole rendered scene, which means a browser. Deriving limits at load would
 * make the game's PHYSICS depend on whether an asset finished loading: a failed
 * environment fetch would silently widen the track. So the measurement is taken
 * once, here, and committed as data. The runtime reads a fixed table and cannot
 * disagree with itself between sessions or between players.
 *
 * THE RULE (owner's ruling, P16):
 *   limit = max(halfWidth, min(currentClamp, tallGeometryLateral - HULL_MARGIN))
 *
 * The floor is the deck: the racing surface is always fully drivable, so no
 * derived number can ever narrow the road itself. Only run-off is trimmed.
 *
 * Geometry at or below TALL_MIN (0.5 m) does not bound: a kerb, lip or marker
 * is something the craft runs over, and Bitterpan's open pan run-off depends on
 * exactly that. Honest walls stop you; honest open ground does not.
 *
 * ---------------------------------------------------------------------------
 * DO NOT SHIP THE OUTPUT YET. The attribution is wrong on Bitterpan.
 *
 * The rule above is sound. The MEASUREMENT feeding it is not, and the first run
 * proved it: Bitterpan came back with 525 of 525 side-spans floored to the deck
 * edge — the entire pan run-off deleted — and the meshes named as the bounding
 * geometry were `BITTERPAN_track_blockout`, `_3` and `_4`, i.e. the ROAD ITSELF,
 * 523 times. A road cannot be the wall that bounds it.
 *
 * Ground truth, looked at rather than inferred: at 1250 m the Bitterpan deck
 * edge is a flat painted stripe flush with the surface, opening onto continuous
 * salt pan with no kerb and no wall in sight. There is nothing there at 1.3 m
 * for the sweep to have found.
 *
 * The likely fault is in the span bucket, not the rule: it takes the innermost
 * tall lateral over a 10 m run and the narrowest half-width in it, while
 * Bitterpan's stations are 5 m apart and its half-width swings 11.0-15.0 m. On a
 * curve a vertex at one end of the bucket projects to a lateral that is "inner"
 * only relative to a station 10 m away. Greenwater is less exposed (2 m
 * stations) but uses the same machinery, so its 328-of-457 floor count is under
 * the same doubt.
 *
 * WHY THIS MATTERS MORE THAN A NORMAL BUG: the soak gate cannot catch it. The
 * bounding experiment for this task clamped every limit to `halfWidth` — run-off
 * removed everywhere — and Greenwater's five lap times came back bit-identical,
 * because the autopilot never leaves the racing line. A wrong limit table would
 * therefore pass every automated gate in the repo and only show up as a player
 * hitting an invisible wall over open ground.
 *
 * Fix the bucket first: attribute tall geometry per STATION rather than per 10 m
 * run, or record the distance of the bounding vertex so a mis-projection is
 * visible. Then re-derive and check Bitterpan keeps its pan.
 * ---------------------------------------------------------------------------
 *
 * USAGE. Two steps, deliberately separable: the DERIVATION is dependency-free
 * and hermetic, and only the CAPTURE needs a browser.
 *
 *   node scripts/derive-drivable-limits.mjs \
 *     --greenwater capture-gw.json --bitterpan capture-bp.json
 *
 * where each capture is the diagnostics report emitted by
 * `?diagnostics=1&probe=corridor-sweep&spans=1` on that map — either the raw
 * report object or `{ last: <report> }`. The repo ships no headless-browser
 * dependency, so the capture is taken with whatever driver is to hand and the
 * script that turns measurements into physics stays runnable anywhere, with no
 * network and no install.
 */
import { readFileSync, writeFileSync } from "node:fs";

/** Half the craft's width, so the hull clears the wall and not just the origin. */
const HULL_MARGIN_METRES = 1.6;

/** Matches `TALL_GEOMETRY_SPAN_METRES` in corridor-sweep.ts. */
const SPAN_METRES = 10;

const MAPS = [
  { map: "greenwater", flag: "--greenwater", out: "src/game/data/DRIVABLE_LIMITS.json" },
  { map: "bitterpan", flag: "--bitterpan", out: "src/game/data/map02/DRIVABLE_LIMITS.json" },
];

function captureFor(flag, map) {
  const index = process.argv.indexOf(flag);
  if (index < 0 || !process.argv[index + 1]) {
    throw new Error(`${map}: pass ${flag} <capture.json>. See the header.`);
  }
  const parsed = JSON.parse(readFileSync(process.argv[index + 1], "utf8"));
  const report = parsed.last ?? parsed;
  if (!report.corridorSweepRan) {
    throw new Error(
      `${map}: the capture reports corridorSweepRan false, so its zeroes mean `
      + "\"not measured\" and not \"nothing found\". Re-capture.",
    );
  }
  if (report.corridorIntrusions !== 0) {
    throw new Error(
      `${map}: the capture still has ${report.corridorIntrusions} obstacles on `
      + "the racing surface. Derive limits from a clean scene, or the limit "
      + "will be set by something that should have been moved.",
    );
  }
  return report;
}

function derive(report, map) {
  const spans = report.corridorSpans ?? [];
  if (spans.length === 0) throw new Error(`${map}: the sweep collected no spans.`);

  const entries = [];
  let trimmed = 0;
  let flooredToDeck = 0;
  let maxTrim = 0;

  for (const span of spans) {
    const sides = {};
    for (const side of ["left", "right"]) {
      const tall = span[side];
      if (tall === null) continue;
      // P21 — capped and tested against the span's WIDEST clamp, not its
      // narrowest. `resolveApron` re-applies `min(authoredLimit, derived)` at
      // every station, so a limit derived against the wide end can never
      // over-narrow the narrow end; reading the narrow end, however, silently
      // dropped the entry wherever the edge type changed mid-bucket and left the
      // wide end running at the full authored clamp. See `TallGeometrySpan.clampMax`.
      const cap = span.clampMax ?? span.clamp;
      const raw = Math.min(cap, tall - HULL_MARGIN_METRES);
      const limit = Math.max(span.halfWidth, raw);
      if (raw < span.halfWidth) flooredToDeck += 1;
      if (limit < cap - 1e-6) {
        trimmed += 1;
        maxTrim = Math.max(maxTrim, cap - limit);
        sides[side] = {
          limit: Number(limit.toFixed(3)),
          setBy: span[`${side}Mesh`],
          tall: Number(tall.toFixed(3)),
        };
      }
    }
    if (Object.keys(sides).length > 0) {
      entries.push({
        distance: span.distance,
        halfWidth: span.halfWidth,
        clamp: span.clamp,
        // P21 — the cap the limit was actually derived against: the clamp at
        // this span's WIDEST station. `clamp` above stays the narrowest, which
        // is the number the deck-floor and run-off assertions want.
        clampMax: span.clampMax ?? span.clamp,
        ...sides,
      });
    }
  }

  return {
    entries,
    summary: {
      spans: spans.length,
      trimmedSides: trimmed,
      flooredToDeckEdge: flooredToDeck,
      maxTrimMetres: Number(maxTrim.toFixed(3)),
    },
  };
}

const results = [];
for (const { map, flag, out } of MAPS) {
  const report = captureFor(flag, map);
  const { entries, summary } = derive(report, map);
  const document = {
    $generatedBy: "scripts/derive-drivable-limits.mjs",
    $doNotEditByHand:
      "Measured from the rendered scene. Re-run the script after any change to "
      + "trackside geometry; do not hand-tune a number to make a test pass.",
    map,
    spanMetres: SPAN_METRES,
    hullMarginMetres: HULL_MARGIN_METRES,
    rule:
      "limit = max(halfWidth, min(clampMax, tallGeometryLateral - hullMargin)); "
      + "geometry at or below TALL_GEOMETRY_MIN_HEIGHT_METRES (0.6 m, the "
      + "measured hull-bottom clearance) above the local deck plane does not "
      + "bound, and neither does a collidable hazard.",
    summary,
    entries,
  };
  writeFileSync(
    new URL(`../${out}`, import.meta.url),
    `${JSON.stringify(document, null, 2)}\n`,
  );
  results.push({ map, out, ...summary, entries: entries.length });
}

for (const result of results) {
  console.log(
    `${result.map}: ${result.entries} spans limited of ${result.spans} `
    + `(${result.trimmedSides} sides trimmed, ${result.flooredToDeckEdge} floored `
    + `to the deck edge, largest trim ${result.maxTrimMetres} m) -> ${result.out}`,
  );
}
