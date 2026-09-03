// P16/P21 review harness (not part of the shipped game).
//
// Takes the rendered-scene measurement `scripts/derive-drivable-limits.mjs`
// turns into physics, and writes it to `scripts/data/CORRIDOR_SPANS_<map>.json`
// so the derivation stays reproducible without a browser. Re-run it after ANY
// change to trackside geometry, then re-derive and re-run the census.
//
// Usage: node scripts/visual/capture-corridor-spans.mjs <base> <map> <out> [extraQuery]
//   extraQuery: e.g. "&tallMin=0.30" to measure a different bounding floor
//               before changing one. See TALL_GEOMETRY_MIN_HEIGHT_METRES.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const [base, map, out, extra] = process.argv.slice(2);
const url = `${base}/?diagnostics=1&probe=corridor-sweep&spans=1${extra || ""}${map === "bitterpan" ? "&map=bitterpan" : ""}`;
const b = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 800, height: 450 } });
p.on("pageerror", (e) => console.log("[err]", String(e).slice(0, 200)));
await p.goto(url, { waitUntil: "networkidle" });
let r = null; const dl = Date.now() + 120000;
while (Date.now() < dl) {
  await p.waitForTimeout(500);
  r = await p.evaluate(() => { try { return JSON.parse(document.getElementById("futurisma-diagnostics")?.textContent || "{}").current; } catch { return null; } });
  if (r?.corridorSweepRan) break;
}
await b.close();
if (!r?.corridorSweepRan) { console.log("SWEEP DID NOT RUN"); process.exit(1); }
writeFileSync(out, JSON.stringify(r, null, 2));
console.log(out, "spans", r.corridorSpans.length, "intrusions", r.corridorIntrusions, "gate", r.corridorGate);
