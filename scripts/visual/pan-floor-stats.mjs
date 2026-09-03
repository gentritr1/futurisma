// P21.3 review harness (not part of the shipped game).
//
// Prints Bitterpan's pan-floor block from the live diagnostics, plus the frame's
// draw calls and triangles. The number that matters is `coveredSides` — station
// -sides where the built floor is still drawn ABOVE the lowest drawn surface of
// the road — measured on the geometry that was built rather than on the function
// that displaced it. `reliefVertices` is its companion: 0 covered sides from a
// floor that never loaded is not a clean reading.
//
// Usage: node scripts/visual/pan-floor-stats.mjs <base> ["&panfix=off|a|b"]
//   off  the pre-P21.3 flat plane      -> 186 covered sides, worst 0.79 m
//   a    the global datum drop         -> 0, but the props and edge-band lips
//                                         are NOT re-derived under the flag
//   b    the local relief (shipped)    -> 0, with 82 vertices carved <= 0.87 m
import { chromium } from "playwright";
const [base, extra = ""] = process.argv.slice(2);
const b = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 800, height: 450 } });
p.on("pageerror", (e) => console.log("[err]", String(e).slice(0, 300)));
await p.goto(`${base}/?map=bitterpan&diagnostics=1${extra}`, { waitUntil: "networkidle" });
let r = null;
for (let i = 0; i < 40; i += 1) {
  await p.waitForTimeout(500);
  r = await p.evaluate(() => { try { return JSON.parse(document.getElementById("futurisma-diagnostics")?.textContent || "{}").current; } catch { return null; } });
  if (r?.panFloor?.segments) break;
}
console.log(JSON.stringify(r?.panFloor ?? null));
console.log("drawCalls", r?.calls, "triangles", r?.triangles);
await b.close();
