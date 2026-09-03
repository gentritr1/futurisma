/**
 * P21 — the drivable-corridor census.
 *
 * THE RULING IT MEASURES. "Check that we don't have obstacles in the road even
 * though they don't block and we can go inside them — it makes it bad." Every
 * solid, opaque object the craft can pass THROUGH inside the drivable corridor
 * is a defect, whether or not it also collides.
 *
 * WHY THIS IS NOT THE P16 SWEEP. It is the same instrument with a wider gate,
 * and the gate is the entire point. `corridor-sweep.ts` gates on
 * `halfWidth + 0.5` — the racing surface — and P16 drove that count to zero.
 * This gates on `apron.lateralLimit`, the craft's OWN lateral clamp: deck plus
 * the authored run-off (A 5 m gravel, B 2.1 m works stand, C 5.8 m open pan),
 * trimmed wherever `DRIVABLE_LIMITS.json` found the art standing closer. That
 * is everywhere the player can actually put the craft, and the run-off has no
 * collision, so a board bolted 3.4 m into a 5 m shoulder is exactly the thing
 * the ruling names: solid, in the road, and passed straight through.
 *
 * WHY IT READS THE RENDERED SCENE AND NOT THE TABLES. Because the tables were
 * already checked and the defect shipped anyway. `validate-furniture.mjs` and
 * `validate-art-pass.mjs` both resolve AUTHORED coordinates against the
 * centreline; neither can see the 60-mesh Greenwater environment GLB, the
 * Bitterpan massing, the asset kit, the hangar components the runtime
 * relocates, or any mesh whose baked vertices disagree with its placement
 * record. P16 wrote that lesson down after three shipped obstacles. A census
 * that re-derives from the same JSON would inherit all three holes.
 *
 * WHAT COUNTS. A group is an OFFENDER when, at some station, it is
 *
 *   - solid: not a `depthWrite: false` transparent overlay (the sweep's `vfx`
 *     class — steam, scud, sparks, spray, the shadow blob),
 *   - tall: its intruding vertices reach above `FLAT_FURNITURE_MAX_HEIGHT_METRES`
 *     (0.3 m), so it is not painted road or a decal,
 *   - low: it does not sit entirely in the plaque band at or above 3.2 m, where
 *     P13 deliberately parks the boards that have nowhere else to go — and which
 *     the P21 brief itself prescribes as a REMEDY,
 *   - inside: its deepest vertex is more than a 0.1 m seam tolerance inside the
 *     drivable limit at its own station. The tolerance is `BOUNDARY_SEAM_TOLERANCE_METRES`
 *     and exists because the apron and kerb meshes are authored to overlap their
 *     own seam by 45-60 mm so no crack shows.
 *
 * Race entities (craft, rivals, ghost), the superseded Bitterpan blockout, the
 * living-world card layers and `BP_MIDGROUND` are excluded upstream by
 * `CORRIDOR_SWEEP_EXCLUDED_NAMES` in `scene-assets.ts`, each with its own
 * recorded reason. This script does not add exclusions of its own — the ONE
 * class it names is the allowed one below, and the validator asserts the census
 * contains exactly that class and nothing else.
 *
 * THE ONE ALLOWED CLASS. The cable coils, on BOTH maps — `map02_cable_coils` and
 * Greenwater's `cable_trip_hazards`, which the brief's list of the one allowed
 * class named only on Bitterpan. They are collidable trip hazards, authored to
 * be aimed at and missed: `game.ts` reads `course.cableTripSideAt` every physics
 * step and `racing-contact.ts` scores the near miss. The craft does not pass
 * through them, so the ruling does not reach them.
 *
 * USAGE
 *   node scripts/corridor-census.mjs --base http://127.0.0.1:5218 [--out DIR]
 *   node scripts/corridor-census.mjs --capture gw.json --capture bp.json
 *
 * The first form drives a browser (Playwright, a devDependency of the review
 * harness and not of the game). The second re-tables captures already taken, so
 * the classification can be re-read without a browser. Both print the same
 * table. `--out DIR` writes the raw captures beside it, and
 * `--write-baseline <file>` writes the reduced form
 * `scripts/validate-corridor.mjs` gates on.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

/** Matches `FLAT_FURNITURE_MAX_HEIGHT_METRES` in furniture-placement.js. */
export const CENSUS_MIN_HEIGHT_METRES = 0.3;

/** Matches `BOUNDARY_SEAM_TOLERANCE_METRES` in corridor-sweep.ts. */
export const CENSUS_SEAM_TOLERANCE_METRES = 0.1;

/**
 * The one class of solid geometry allowed to stand in the drivable corridor.
 *
 * Bitterpan's cable coils are COLLIDABLE. `racing-contact.ts` resolves them as
 * trip hazards with a speed penalty, so the craft does not pass through them and
 * the ruling — which is about geometry you drive INSIDE of — does not apply.
 * Named as mesh names, matched exactly, cross-checked against
 * `COLLIDABLE_HAZARD_MESHES` in `corridor-sweep.ts` (the same decision, seen
 * from the derivation side) and asserted to be the whole of the census by
 * `scripts/validate-corridor.mjs`: a whitelist nobody checks the completeness of
 * is how the DECK_HAZARDS exemption drifted.
 */
export const CENSUS_ALLOWED_MESHES = Object.freeze([
  "map02_cable_coils",
  // Greenwater's own coils, which the brief's list of "the ONE allowed class"
  // forgot and `course.ts` names in its own words: "P20.1. Greenwater's
  // equivalent of the Bitterpan coils; same reason." Both are built from the
  // same authored hazard table and both are read by `game.ts` through
  // `course.cableTripSideAt(progress, lateral)` every physics step.
  "cable_trip_hazards",
]);

/**
 * Solid geometry that is STILL standing in the drivable corridor, one row per
 * object, with the measured depth and the reason it survived.
 *
 * Round 2 emptied Greenwater. The five environment-GLB rows closed without
 * touching the frozen asset, by giving the trackside barrier family its own
 * derivation floor (`BARRIER_CLASS_MESHES` in `corridor-sweep.ts`). One row is
 * left, on Bitterpan, and it is not an object at all.
 *
 * `scripts/validate-corridor.mjs` asserts the census is exactly the allowed
 * hazards plus exactly these rows, in both directions, so a new intrusion fails
 * the build and a row that stops intruding must be deleted.
 */
export const CENSUS_PINNED_RESIDUALS = Object.freeze({
  "bitterpan_surface_layer|BP_PAN_FLOOR":
    "NOT an object in the corridor — it is the pan plane drawn OVER the ribbon, "
    + "and the census row is one symptom of a larger defect this instrument "
    + "found. `GROUND_Y_METRES` is a flat -1.95 m, chosen (its own comment says "
    + "so) as 0.078 m below the ribbon's CENTRELINE low point of -1.872 m. The "
    + "ribbon banks 2.5 deg, so its lowest DRAWN surface is not the centreline: "
    + "the deck edge reaches -2.4916 m and the C-edge run-off lip -2.7446 m, "
    + "both at s=1100. Recomputed from CENTRELINE_STATIONS.json the correct "
    + "value under the author's own rule is -2.8226 m. The consequence, measured "
    + "over all 610 stations: on 53 of 1,220 station-sides the pan plane is "
    + "drawn over part of the RACING SURFACE, up to 12.26 m of a 14 m half-width "
    + "at s=1100, and over deck-or-run-off on 75. Screenshots at (1100, -3) and "
    + "(1076, -8) show the craft sitting on salt three metres from the "
    + "centreline with the road's left half gone. NOT FIXED HERE: "
    + "`GROUND_Y_METRES` also anchors the 705-prop mid-ground layer and the "
    + "254-strip road-edge band's 0.35 m lip threshold, both with pinned "
    + "tables, so moving it is a map-wide art change and not something to slip "
    + "into a corridor commit. `assertPanPlaneOverlapNoWorse` in "
    + "scripts/validate-corridor.mjs pins the defect at its measured size so it "
    + "cannot quietly grow while it waits for that decision.",
});
export const CENSUS_MAPS = Object.freeze([
  { map: "greenwater", query: "" },
  { map: "bitterpan", query: "&map=bitterpan" },
]);

/**
 * True when this sweep entry is an offender under the ruling.
 *
 * Reads the band the sweep already computed rather than recomputing the height
 * test from `heightMin`/`heightMax`: the sweep classifies from the RENDERED
 * vertices with a millimetre of float slack, and a second copy of 0.3 and 3.2
 * here is exactly the drift P16 wrote up.
 */
export function censusKey(entry) {
  return `${entry.root}|${entry.mesh}`;
}

export function isCensusOffender(entry) {
  if (entry.band !== "obstacle") return false;
  return !CENSUS_ALLOWED_MESHES.includes(entry.mesh);
}

function argValues(flag) {
  const out = [];
  for (let i = 2; i < process.argv.length; i += 1) {
    if (process.argv[i] === flag && process.argv[i + 1]) out.push(process.argv[i + 1]);
  }
  return out;
}

function argValue(flag, fallback = null) {
  return argValues(flag)[0] ?? fallback;
}

/**
 * Drives one map to a settled scene and returns its diagnostics report.
 *
 * `probe=corridor-sweep` arms the sweep and `census=1` selects the drivable
 * gate; the sweep itself fires only once the scene graph stops growing (two
 * identical descendant counts a second apart, environment ready), which is why
 * this polls for `corridorSweepRan` instead of sleeping. `ran: false` is
 * load-bearing — every zero in the report means "not measured" until it flips.
 */
async function capture(base, map, query) {
  const { chromium } = await import("playwright");
  const url = `${base}/?diagnostics=1&probe=corridor-sweep&census=1${query}`;
  const browser = await chromium.launch({
    args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error).slice(0, 300)));
    await page.goto(url, { waitUntil: "networkidle" });
    const deadline = Date.now() + 120_000;
    let report = null;
    while (Date.now() < deadline) {
      await page.waitForTimeout(500);
      report = await page.evaluate(() => {
        const element = document.getElementById("futurisma-diagnostics");
        if (!element) return null;
        try {
          const parsed = JSON.parse(element.textContent || "{}");
          return parsed.current ?? parsed.last ?? parsed;
        } catch {
          return null;
        }
      });
      if (report && report.corridorSweepRan) break;
    }
    if (!report || !report.corridorSweepRan) {
      throw new Error(
        `${map}: the sweep never ran within 120 s. Its zeroes would mean `
        + `"not measured", not "clean". Errors: ${errors.join(" | ") || "none"}`,
      );
    }
    if (report.corridorGate !== "drivable") {
      throw new Error(
        `${map}: the capture reports gate "${report.corridorGate}". This census `
        + "is only meaningful against the drivable gate; check `census=1` reached "
        + "the sweep.",
      );
    }
    return { ...report, $map: map, $url: url, $pageErrors: errors };
  } finally {
    await browser.close();
  }
}

/**
 * Groups a capture's entries into a per-object census.
 *
 * The sweep already groups per mesh per 20 m of lap, which is the resolution a
 * fix acts at. This folds those runs back into one row per (root, mesh) with a
 * station RANGE, because "GW_SIGNAGE_POSTS intrudes at 40, 60 and 80 m" is one
 * decision, not three.
 */
export function tabulate(report) {
  const offenders = (report.corridorIntrusionList ?? []).filter(isCensusOffender);
  const rows = new Map();
  for (const entry of offenders) {
    const key = `${entry.root} ${entry.mesh}`;
    let row = rows.get(key);
    if (!row) {
      row = {
        root: entry.root,
        mesh: entry.mesh,
        sectors: new Set(),
        from: Infinity,
        to: -Infinity,
        maxDepth: 0,
        maxHeight: 0,
        minHeight: Infinity,
        limitAtWorst: 0,
        lateralAtWorst: 0,
        distanceAtWorst: 0,
        groups: 0,
        vertices: 0,
        hidden: 0,
      };
      rows.set(key, row);
    }
    row.groups += 1;
    row.vertices += entry.vertices;
    if (!entry.visible) row.hidden += 1;
    row.sectors.add(entry.sector);
    row.from = Math.min(row.from, entry.distance);
    row.to = Math.max(row.to, entry.distance);
    row.minHeight = Math.min(row.minHeight, entry.heightMin);
    row.maxHeight = Math.max(row.maxHeight, entry.heightMax);
    if (entry.depth > row.maxDepth) {
      row.maxDepth = entry.depth;
      row.limitAtWorst = entry.limit;
      row.lateralAtWorst = entry.lateral;
      row.distanceAtWorst = entry.distance;
    }
  }
  return [...rows.values()]
    .map((row) => ({ ...row, sectors: [...row.sectors].sort() }))
    .sort((a, b) => b.maxDepth - a.maxDepth);
}

function formatTable(map, report, rows) {
  const lines = [];
  lines.push(`## ${map}  (gate=${report.corridorGate}, sweep ${report.corridorSweepMs} ms,`
    + ` ${report.corridorSweepMeshes} meshes / ${report.corridorSweepVertices} vertices)`);
  const total = (report.corridorIntrusionList ?? []).length;
  lines.push(`   bands: obstacle ${report.corridorIntrusions}, flush ${report.corridorFlush},`
    + ` overhead ${report.corridorOverhead}, boundary ${report.corridorBoundary},`
    + ` vfx ${report.corridorVfx}, hidden ${report.corridorHiddenIntrusions}`
    + ` (list carries ${total} groups)`);
  if (rows.length === 0) {
    lines.push("   CENSUS EMPTY — no solid geometry inside the drivable corridor "
      + `outside the allowed class (${CENSUS_ALLOWED_MESHES.join(", ")}).`);
    return lines.join("\n");
  }
  const header = ["root", "mesh", "stations m", "depth m", "height m", "limit m", "lat m", "grp"];
  const body = rows.map((row) => [
    row.root,
    row.mesh,
    row.from === row.to ? `${row.from.toFixed(0)}` : `${row.from.toFixed(0)}-${row.to.toFixed(0)}`,
    row.maxDepth.toFixed(2),
    `${row.minHeight.toFixed(2)}-${row.maxHeight.toFixed(2)}`,
    row.limitAtWorst.toFixed(2),
    row.lateralAtWorst.toFixed(2),
    String(row.groups),
  ]);
  const widths = header.map((cell, index) => Math.max(
    cell.length,
    ...body.map((line) => line[index].length),
  ));
  const render = (cells) => `   ${cells.map((cell, index) => cell.padEnd(widths[index])).join("  ")}`.trimEnd();
  lines.push(render(header));
  lines.push(render(widths.map((width) => "-".repeat(width))));
  for (const line of body) lines.push(render(line));
  lines.push(`   ${rows.length} offending object(s), `
    + `${rows.reduce((sum, row) => sum + row.groups, 0)} station group(s).`);
  return lines.join("\n");
}

/**
 * The committed shape of one map's census.
 *
 * Only the obstacle-band rows and the sweep's own counters. The full report is
 * ~1,000 groups a map and almost all of it is painted road; what has to be
 * reviewable in a diff is the list that must stay empty, plus enough of the
 * instrument's own numbers that a baseline recorded from a broken run cannot
 * pass for a clean one (`ran`, the gate, and the mesh/vertex counts — every
 * zero in a census means "not measured" until those say otherwise).
 */
export function baselineOf(map, report) {
  return {
    map,
    gate: report.corridorGate,
    ran: report.corridorSweepRan === true,
    meshesSwept: report.corridorSweepMeshes,
    verticesSwept: report.corridorSweepVertices,
    groups: (report.corridorIntrusionList ?? []).length,
    bands: {
      obstacle: report.corridorIntrusions,
      flush: report.corridorFlush,
      overhead: report.corridorOverhead,
      boundary: report.corridorBoundary,
      vfx: report.corridorVfx,
    },
    obstacles: (report.corridorIntrusionList ?? [])
      .filter((entry) => entry.band === "obstacle")
      .map((entry) => ({
        root: entry.root,
        mesh: entry.mesh,
        distance: entry.distance,
        lateral: entry.lateral,
        depth: entry.depth,
        heightMin: entry.heightMin,
        heightMax: entry.heightMax,
        limit: entry.limit,
        innerExtent: entry.innerExtent,
        vertices: entry.vertices,
        visible: entry.visible,
        sector: entry.sector,
      }))
      .sort((a, b) => a.root.localeCompare(b.root)
        || a.mesh.localeCompare(b.mesh)
        || a.distance - b.distance),
  };
}

export async function runCensus({ base, captures, out }) {
  const results = [];
  for (const [index, { map, query }] of CENSUS_MAPS.entries()) {
    const report = captures
      ? (() => {
        const parsed = JSON.parse(readFileSync(captures[index], "utf8"));
        return parsed.current ?? parsed.last ?? parsed;
      })()
      : await capture(base, map, query);
    const rows = tabulate(report);
    results.push({ map, report, rows });
    if (out) {
      mkdirSync(out, { recursive: true });
      writeFileSync(`${out}/census-${map}.json`, `${JSON.stringify(report, null, 2)}\n`);
    }
  }
  return results;
}

const isMain = process.argv[1]
  && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (isMain) {
  const captures = argValues("--capture");
  const results = await runCensus({
    base: argValue("--base", "http://127.0.0.1:5218"),
    captures: captures.length === CENSUS_MAPS.length ? captures : null,
    out: argValue("--out", null),
  });
  for (const { map, report, rows } of results) {
    console.log(formatTable(map, report, rows));
    console.log("");
  }
  const baselinePath = argValue("--write-baseline", null);
  if (baselinePath) {
    writeFileSync(baselinePath, `${JSON.stringify({
      $generatedBy: "scripts/corridor-census.mjs --write-baseline",
      $doNotEditByHand:
        "Measured from the rendered scene with ?probe=corridor-sweep&census=1. "
        + "Re-run the census against a dev server after any change to trackside "
        + "geometry or to DRIVABLE_LIMITS.json; do not hand-edit a row to make "
        + "scripts/validate-corridor.mjs pass.",
      maps: results.map(({ map, report }) => baselineOf(map, report)),
    }, null, 2)}\n`);
    console.log(`baseline -> ${baselinePath}`);
  }
  const offending = results.reduce((sum, result) => sum + result.rows.length, 0);
  console.log(offending === 0
    ? "CENSUS CLEAN on both maps."
    : `CENSUS: ${offending} offending object(s) across both maps.`);
}
