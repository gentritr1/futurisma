// P21 review harness (not part of the shipped game).
//
// THE MEASUREMENT BEHIND THE NUMBER. `TALL_GEOMETRY_MIN_HEIGHT_METRES` moved
// 0.85 -> 0.60, and a threshold nobody measured the cost of is how this repo has
// shipped unreachable goals before. This prints what a candidate floor does to a
// committed table: how many span-sides move, the largest extra trim, roughly how
// much run-off it deletes, and — the line that decides it — WHICH MESHES set the
// new limits. At 0.30 that list is `GW_SECTOR_GREENWATER_SWEEP_water` and two
// `_concrete` sector meshes, i.e. the water and the ground, which is the P16
// "invisible wall over open ground" failure and is why 0.30 was rejected.
//
// Usage: node scripts/visual/corridor-limit-delta.mjs <committed.json> <capture.json> <label>
// Usage: node scripts/visual/_p21-delta.mjs <committed.json> <capture.json> <label>
import { readFileSync } from "node:fs";

const [committedPath, capturePath, label] = process.argv.slice(2);
const HULL = 1.6;
const committed = JSON.parse(readFileSync(committedPath, "utf8"));
const capture = JSON.parse(readFileSync(capturePath, "utf8"));

function derive(spans) {
  const out = new Map();
  for (const span of spans) {
    const sides = {};
    for (const side of ["left", "right"]) {
      const tall = span[side];
      if (tall === null) continue;
      const raw = Math.min(span.clamp, tall - HULL);
      const limit = Math.max(span.halfWidth, raw);
      if (limit < span.clamp - 1e-6) {
        sides[side] = { limit: Number(limit.toFixed(3)), setBy: span[`${side}Mesh`] };
      }
    }
    if (Object.keys(sides).length > 0) {
      out.set(span.distance, { clamp: span.clamp, ...sides });
    }
  }
  return out;
}

const now = new Map(committed.entries.map((entry) => [entry.distance, entry]));
const next = derive(capture.corridorSpans);
const clampOf = new Map(capture.corridorSpans.map((span) => [span.distance, span.clamp]));
let changed = 0; let lost = 0; let maxExtra = 0;
const bySetter = new Map();
for (const distance of new Set([...now.keys(), ...next.keys(), ...clampOf.keys()])) {
  const clamp = clampOf.get(distance) ?? now.get(distance)?.clamp ?? next.get(distance)?.clamp;
  if (clamp === undefined) continue;
  for (const side of ["left", "right"]) {
    const before = now.get(distance)?.[side]?.limit ?? clamp;
    const after = next.get(distance)?.[side]?.limit ?? clamp;
    const delta = before - after;
    if (Math.abs(delta) < 1e-6) continue;
    changed += 1;
    lost += Math.max(0, delta) * 10;
    maxExtra = Math.max(maxExtra, delta);
    const setter = next.get(distance)?.[side]?.setBy ?? "(widened)";
    bySetter.set(setter, (bySetter.get(setter) ?? 0) + 1);
  }
}
console.log(`${label}: ${changed} side(s) changed, max extra trim ${maxExtra.toFixed(3)} m, `
  + `~${Math.round(lost)} m2 of run-off removed; spans ${now.size} -> ${next.size}`);
for (const [setter, count] of [...bySetter].sort((a, b) => b[1] - a[1])) {
  console.log(`   ${String(count).padStart(4)}  ${setter}`);
}
