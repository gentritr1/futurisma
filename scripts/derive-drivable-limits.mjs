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
      const raw = Math.min(span.clamp, tall - HULL_MARGIN_METRES);
      const limit = Math.max(span.halfWidth, raw);
      if (raw < span.halfWidth) flooredToDeck += 1;
      if (limit < span.clamp - 1e-6) {
        trimmed += 1;
        maxTrim = Math.max(maxTrim, span.clamp - limit);
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
      "limit = max(halfWidth, min(clamp, tallGeometryLateral - hullMargin)); "
      + "geometry at or below 0.5 m above the local deck plane does not bound.",
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
