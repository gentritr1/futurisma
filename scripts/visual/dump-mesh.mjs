// P21 review harness: the point cloud behind one census row.
// Usage: node scripts/visual/dump-mesh.mjs <base> <map> <meshName> <from> <to>
import { chromium } from "playwright";

const [base, map, mesh, from, to] = process.argv.slice(2);
const url = `${base}/?diagnostics=1&probe=corridor-sweep&census=1`
  + `&dumpMesh=${encodeURIComponent(mesh)}&dumpFrom=${from}&dumpTo=${to}`
  + (map === "bitterpan" ? "&map=bitterpan" : "");
const browser = await chromium.launch({
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
await page.goto(url, { waitUntil: "networkidle" });
let report = null;
const deadline = Date.now() + 90_000;
while (Date.now() < deadline) {
  await page.waitForTimeout(500);
  report = await page.evaluate(() => {
    try {
      return JSON.parse(document.getElementById("futurisma-diagnostics")?.textContent || "{}").current;
    } catch { return null; }
  });
  if (report?.corridorSweepRan) break;
}
await browser.close();
const dump = report?.corridorDump ?? [];
console.log(JSON.stringify({ mesh, from, to, points: dump.length }));
// Lateral histogram by 0.5 m, with the height range in each bin: a prop is a
// spike, ground is a ramp.
const bins = new Map();
for (const [distance, lateral, height] of dump) {
  const key = Math.round(lateral * 2) / 2;
  const bin = bins.get(key) ?? { n: 0, hMin: Infinity, hMax: -Infinity, dMin: Infinity, dMax: -Infinity };
  bin.n += 1;
  bin.hMin = Math.min(bin.hMin, height);
  bin.hMax = Math.max(bin.hMax, height);
  bin.dMin = Math.min(bin.dMin, distance);
  bin.dMax = Math.max(bin.dMax, distance);
  bins.set(key, bin);
}
for (const [key, bin] of [...bins].sort((a, b) => a[0] - b[0])) {
  console.log(`lat ${String(key).padStart(7)}  n=${String(bin.n).padStart(4)}`
    + `  h ${bin.hMin.toFixed(2)}..${bin.hMax.toFixed(2)}`
    + `  d ${bin.dMin.toFixed(0)}..${bin.dMax.toFixed(0)}`);
}
