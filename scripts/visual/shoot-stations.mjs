// Visual review harness (not part of the shipped game).
//
// Drives a demo lap and screenshots at FIXED course distances, so two builds
// can be compared station by station. Polls #futurisma-diagnostics, which the
// game refreshes at ~1 Hz (up to ~90 m of travel), and fires when
// distanceMeters lands inside [station, station + 110 m). Space stations at
// least 150 m apart; compare frames by station, not by exact metre. Requires `demo=1&diagnostics=1&autostart=1` on the URL.
//
// Usage: node scripts/visual/shoot-stations.mjs <url> <outDir> [stations] [window]
//   stations: comma list of metres, default per map (read from the URL).
//   window:   metres past the station a shot still counts, default 110.
//
// P20.5: the window is a parameter because 110 m is too loose for a before/after
// comparison. The diagnostics line only refreshes at ~1 Hz, which at 300 km/h is
// ~85 m of travel, so a station can fire anywhere in its window and two builds
// end up photographed from poses 70 m apart — enough to change what geometry is
// in a sky band. Pair a tighter window with more laps: at `window=45` each lap
// gives roughly a coin-flip per station, so `laps=4` catches nearly all of them,
// and `stations.json` records the actual `d` for every shot so any station that
// still landed far apart can be excluded from the comparison rather than
// silently compared.
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
const windowMetres = Number(process.argv[5] || 110);

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

// Every station is still outstanding until it fires, and each poll is checked
// against ALL of them. A linear cursor had to skip a station the sample jumped
// past, which with a tight window meant losing it for the whole run; stations
// are at least 150 m apart, so there is never any ambiguity about which one a
// given distance belongs to, and a missed station simply comes round next lap.
const results = [];
const pending = new Set(stations);
let lastD = -1;
const deadline = Date.now() + 300_000;
while (pending.size > 0 && Date.now() < deadline) {
  const diag = await readDiag();
  if (diag && typeof diag.d === "number" && diag.phase === "running") {
    if (diag.d < lastD - 500) {
      console.log(`lap wrap at ${lastD} -> ${diag.d}, ${pending.size} stations left`);
    }
    lastD = diag.d;
    for (const station of pending) {
      if (diag.d < station || diag.d >= station + windowMetres) continue;
      const file = `${outDir}/st-${String(station).padStart(4, "0")}.png`;
      await page.screenshot({ path: file });
      results.push({ station, ...diag, file });
      console.log(`st ${station} d=${diag.d} ${diag.sector} v=${diag.v} calls=${diag.calls} tris=${diag.tris} p95=${diag.p95}`);
      pending.delete(station);
      break;
    }
  }
  await page.waitForTimeout(40);
}
if (pending.size > 0) {
  console.log(`MISSED ${[...pending].join(", ")} — raise the window or the lap count`);
}
results.sort((a, b) => a.station - b.station);
writeFileSync(`${outDir}/stations.json`, JSON.stringify(results, null, 2));
console.log(`${results.length}/${stations.length} stations captured -> ${outDir} (window ${windowMetres} m)`);
await browser.close();
