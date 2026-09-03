// P21.4 review harness (not part of the shipped game).
//
// The support rule and the span-sample fix landed in one capture, and a single
// before/after diff cannot say which of them moved a limit. This re-derives the
// same capture twice - once with the support cap and once without - so the two
// can be reported separately. On the Greenwater capture that is 114 sides /
// ~1509 m2 from the span sample and 54 more / ~1777 m2 from the support cap.
//
// Usage: node scripts/visual/corridor-support-delta.mjs <capture.json> <before-table.json>

// Isolates the two P21.4 causes on the same capture:
//   (1) touchSpan widening the span sample (halfWidth/clamp now read at every
//       station, not only where tall geometry happened to be found)
//   (2) the surface-support cap
import { readFileSync } from "node:fs";

const HULL = 1.6;
const spans = JSON.parse(readFileSync(process.argv[2], "utf8")).corridorSpans;
const before = JSON.parse(readFileSync(process.argv[3], "utf8"));

function derive(withSupport) {
  const out = new Map();
  for (const span of spans) {
    const sides = {};
    for (const side of ["left", "right"]) {
      const tall = span[side];
      if (tall === null) continue;
      const cap = span.clampMax ?? span.clamp;
      const limit = Math.max(span.halfWidth, Math.min(cap, tall - HULL));
      if (limit < cap - 1e-6) sides[side] = limit;
    }
    if (withSupport) {
      for (const side of ["left", "right"]) {
        const support = span[`${side}Support`];
        if (support === null || support === undefined) continue;
        const cap = span.clampMax ?? span.clamp;
        const capped = Math.max(span.halfWidth, Math.min(cap, support));
        const already = sides[side] ?? cap;
        if (capped < already - 1e-6) sides[side] = capped;
      }
    }
    out.set(span.distance, { cap: span.clampMax ?? span.clamp, sides });
  }
  return out;
}

const capOf = new Map(spans.map((s) => [s.distance, s.clampMax ?? s.clamp]));
const oldTable = new Map(before.entries.map((e) => [e.distance, e]));
const compare = (label, table) => {
  let narrowed = 0; let widened = 0; let lost = 0; let worst = 0;
  const wide = [];
  for (const [distance, cap] of capOf) {
    const old = oldTable.get(distance);
    for (const side of ["left", "right"]) {
      const x = old?.[side]?.limit ?? old?.clampMax ?? cap;
      const y = table.get(distance)?.sides[side] ?? cap;
      if (y < x - 1e-6) { narrowed += 1; lost += (x - y) * 10; worst = Math.max(worst, x - y); }
      else if (y > x + 1e-6) { widened += 1; wide.push(`${distance} ${side} ${x.toFixed(3)} -> ${y.toFixed(3)}`); }
    }
  }
  console.log(`${label}: ${narrowed} narrowed, ${widened} widened, ~${Math.round(lost)} m2, worst ${worst.toFixed(3)} m`);
  for (const w of wide.slice(0, 6)) console.log("    WIDER", w);
};

compare("span-sample only (no support cap)", derive(false));
compare("span-sample + support cap       ", derive(true));
