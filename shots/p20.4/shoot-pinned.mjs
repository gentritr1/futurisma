// P20.4 review harness (not part of the shipped game).
//
// WHY THIS EXISTS. scripts/visual/shoot-stations.mjs fires when the ~1 Hz
// diagnostics poll lands inside a 110 m window, so at 317 km/h two runs of the
// SAME build capture the same station up to ~60 m apart. That jitter is fine
// for medians and fatal for a pixel diff: differencing two frames taken 60 m
// apart measures the road moving, not the living world.
//
// HOW IT PINS THE POSE. `probe=boundary-hold&probeDistance=D` spawns the craft
// at D, and the COUNTDOWN phase holds it there for ~3.4 s while
// `phaseRunsContinuousPresentation` is already true — so the living world is
// updating against the real chase camera, cards are camera-facing, and the pose
// is byte-identical run to run. (Standby is NOT usable for this: it freezes the
// presentation update entirely, so the cards sit at the constructor pose with
// cameraRight = world X and every camera-facing card is mis-oriented.)
//
// `#countdown` is hidden before the shot: it is the one DOM overlay whose text
// depends on WHEN in the countdown the screenshot lands, so leaving it in would
// put a three-glyph difference into an otherwise clean A/B.
//
// Usage: node shots/p20.4/shoot-pinned.mjs <baseUrl> <outDir> <d,d,d...>
//   baseUrl must already carry ?map=...&diagnostics=1&demo=1 (and &living=0 for
//   the B side).
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const base = process.argv[2];
const outDir = process.argv[3];
const stations = process.argv[4].split(",").map(Number);
/** Long enough for the countdown to be running and the fog/atmosphere to settle. */
const SETTLE_MS = 2600;

const browser = await chromium.launch({
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
mkdirSync(outDir, { recursive: true });

const readDiag = () =>
  page.evaluate(() => {
    const el = document.getElementById("futurisma-diagnostics");
    if (!el) return null;
    try {
      const c = JSON.parse(el.textContent || "{}").current || {};
      return {
        d: c.distanceMeters,
        phase: c.phase,
        calls: c.calls,
        tris: c.triangles,
        sector: c.sector,
        cards: c.livingWorldCards,
        visible: c.livingWorldVisibleCards,
        lwCalls: c.livingWorldDrawCalls,
      };
    } catch {
      return null;
    }
  });

const results = [];
for (const station of stations) {
  const url = `${base}&probe=boundary-hold&probeDistance=${station}&probeLateral=0`;
  await page.goto(url, { waitUntil: "networkidle" });
  // `hidden`, not an injected stylesheet: the page ships `style-src 'self'`, so
  // addStyleTag is refused. ui.ts only ever writes `textContent` on this
  // element, so the attribute stays set for the life of the shot.
  await page.evaluate(() => {
    const el = document.getElementById("countdown");
    if (el) el.hidden = true;
  });
  await page.waitForTimeout(SETTLE_MS);
  const diag = await readDiag();
  const file = `${outDir}/px-${String(station).padStart(4, "0")}.png`;
  await page.screenshot({ path: file });
  results.push({ station, ...diag, file });
  console.log(
    `px ${station} d=${diag?.d} ${diag?.phase} ${diag?.sector} calls=${diag?.calls} `
      + `cards=${diag?.cards} visible=${diag?.visible} lwCalls=${diag?.lwCalls}`,
  );
}
writeFileSync(`${outDir}/pinned.json`, JSON.stringify(results, null, 2));
console.log(`${results.length}/${stations.length} pinned poses -> ${outDir}`);
await browser.close();
