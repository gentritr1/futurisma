// Visual review harness (not part of the shipped game).
//
// The sibling of shoot-stations.mjs, and the one to use when two builds have
// to be compared PIXEL FOR PIXEL rather than station by station.
//
// shoot-stations.mjs fires off #futurisma-diagnostics, which the game refreshes
// at ~1 Hz. At 317 km/h that is 88 m of travel per tick, so which tick lands
// inside a station's 110 m window depends on when the page finished loading:
// two runs of the SAME build can be 70 m apart at the same "station", and a
// build that loads more slowly is systematically offset. Measured on P20.6:
// the base run caught station 574 at d=577 and the changed run at d=645, which
// is a different view of a different part of the pan, not a before/after pair.
//
// The demo lap is deterministic - lap 1 is 38.775 s on every run - so RACE TIME
// is an exact key into the same camera pose. The HUD's #time-value updates every
// frame, which is 88x finer than the diagnostics tick.
//
// Usage: node scripts/visual/shoot-race-times.mjs <url> <outDir> [msList]
//   msList: comma list of race-time milliseconds. Default: 13 marks across lap 1.
// Output: <outDir>/t-<ms>.png + <outDir>/times.json (actual ms + d per shot).
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const url = process.argv[2];
const outDir = process.argv[3] || "shots/race-times";
const DEFAULT_MS = [
  2_500, 5_000, 7_500, 10_000, 12_500, 15_000, 18_000, 21_000,
  24_000, 27_000, 30_000, 33_000, 36_000,
];
const marks = (process.argv[4] ? process.argv[4].split(",").map(Number) : DEFAULT_MS)
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

const readClock = () =>
  page.evaluate(() => {
    const el = document.getElementById("time-value");
    const match = /^(\d+):(\d+)\.(\d+)$/.exec((el?.textContent || "").trim());
    const ms = match
      ? Number(match[1]) * 60_000 + Number(match[2]) * 1_000 + Number(match[3])
      : null;
    let d = null;
    const diag = document.getElementById("futurisma-diagnostics");
    if (diag) {
      try {
        d = (JSON.parse(diag.textContent || "{}").current || {}).distanceMeters ?? null;
      } catch { /* mid-write */ }
    }
    return { ms, d };
  });

const results = [];
let next = 0;
const deadline = Date.now() + 180_000;
while (next < marks.length && Date.now() < deadline) {
  const { ms, d } = await readClock();
  if (typeof ms === "number" && ms >= marks[next]) {
    const file = `${outDir}/t-${String(marks[next]).padStart(5, "0")}.png`;
    await page.screenshot({ path: file });
    results.push({ mark: marks[next], ms, d, file });
    console.log(`t ${marks[next]} ms=${ms} d=${d} -> ${file}`);
    next += 1;
    continue;
  }
  await page.waitForTimeout(8);
}
writeFileSync(`${outDir}/times.json`, JSON.stringify(results, null, 2));
console.log(`${results.length}/${marks.length} marks captured -> ${outDir}`);
await browser.close();
