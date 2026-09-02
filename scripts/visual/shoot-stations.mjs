// Visual review harness (not part of the shipped game).
//
// Drives a demo lap and screenshots at FIXED course distances, so two builds
// can be compared station by station. Polls #futurisma-diagnostics at 40 ms
// (~3.5 m of travel at top speed) and fires when distanceMeters crosses the
// next station. Requires `demo=1&diagnostics=1&autostart=1` on the URL.
//
// Usage: node scripts/visual/shoot-stations.mjs <url> <outDir> [stations]
//   stations: comma list of metres, default per map (read from the URL).
// Output: <outDir>/st-<metres>.png + <outDir>/stations.json (actual d per shot).
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const url = process.argv[2];
const outDir = process.argv[3] || "shots/stations";
const DEFAULTS = {
  bitterpan: [150, 310, 574, 830, 1080, 1343, 1600, 1784, 2050, 2300, 2512, 2660, 2900],
  greenwater: [60, 180, 400, 630, 815, 1045, 1210, 1450, 1660, 1915, 2145, 2355],
};
const map = /map=bitterpan/.test(url) ? "bitterpan" : "greenwater";
const stations = (process.argv[4] ? process.argv[4].split(",").map(Number) : DEFAULTS[map])
  .slice()
  .sort((a, b) => a - b);

const browser = await chromium.launch({
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
page.on("console", (m) => {
  if (m.type() === "error") console.log("[console.error]", m.text().slice(0, 300));
});
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
mkdirSync(outDir, { recursive: true });

const readDiag = () =>
  page.evaluate(() => {
    const el = document.getElementById("futurisma-diagnostics");
    if (!el) return null;
    try {
      const c = JSON.parse(el.textContent || "{}").current || {};
      return { d: c.distanceMeters, phase: c.phase, v: c.speedKph, calls: c.calls, tris: c.triangles, p95: c.p95FrameMs, sector: c.sector };
    } catch {
      return null;
    }
  });

const results = [];
let next = 0;
let lastD = -1;
const deadline = Date.now() + 180_000;
while (next < stations.length && Date.now() < deadline) {
  const diag = await readDiag();
  if (diag && typeof diag.d === "number" && diag.phase === "running") {
    // A lap wrap (d drops) means the station was missed; keep going on lap 2.
    if (diag.d < lastD - 500) {
      console.log(`lap wrap at ${lastD} -> ${diag.d}, ${stations.length - next} stations left`);
    }
    lastD = diag.d;
    if (diag.d >= stations[next] && diag.d < stations[next] + 60) {
      const file = `${outDir}/st-${String(stations[next]).padStart(4, "0")}.png`;
      await page.screenshot({ path: file });
      results.push({ station: stations[next], ...diag, file });
      console.log(`st ${stations[next]} d=${diag.d} ${diag.sector} v=${diag.v} calls=${diag.calls} tris=${diag.tris} p95=${diag.p95}`);
      next += 1;
      continue;
    }
    // Overshot (e.g. spawn past the station): skip it rather than wait a lap.
    while (next < stations.length && diag.d >= stations[next] + 60 && diag.d - stations[next] < 500) {
      console.log(`skip station ${stations[next]} (already at ${diag.d})`);
      next += 1;
    }
  }
  await page.waitForTimeout(40);
}
writeFileSync(`${outDir}/stations.json`, JSON.stringify(results, null, 2));
console.log(`${results.length}/${stations.length} stations captured -> ${outDir}`);
await browser.close();
