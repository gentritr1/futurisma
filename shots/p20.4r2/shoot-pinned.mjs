// P20.4 round-2 review harness (not part of the shipped game).
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
// ROUND 2 — HOW IT PINS THE *CLOCK*, WHICH ROUND 1 DID NOT.
// Round 1 waited a fixed 2600 ms of WALL time and shot. The pose was identical
// but the living world's own `elapsedSeconds` was not: page load, shader
// compile and first-frame cost vary run to run, so two captures of the same
// build caught the cards at different points of their motion. Measured on the
// round-1 build, that alone moved 2300 px at station 1080 and 1268 px at 150 —
// which is most of a 6000 px acceptance floor coming out of the harness.
//
// The fix uses the game's own clock instead of the wall clock.
// `livingWorldUpdateSteps` is a monotonic count of 30 Hz card-update steps, and
// diagnostics re-reports on the game clock (`nextReportAt = now + 1`). Polling
// that number at 15 ms gives an observation of the layer's own phase; because
// the reports land ~30 steps apart, the first report past a floor is only good
// to +/- 3 steps (~100 ms of card motion, ~30 px of crossing scud at 30 m).
//
// So the harness does not shoot on the report. It reads the step count, then
// sleeps exactly `(TARGET_STEPS - steps) / 30` seconds and shoots — the layer
// advances at a fixed 30 Hz, so that lands on TARGET_STEPS to within the
// observation latency (one 15 ms poll plus the evaluate round trip) instead of
// within a report interval. Both the observed step count and the computed sleep
// are written into pinned.json, so an A/B pair that did not line up is visible
// in the record rather than silently folded into the diff.
//
// `#countdown` is hidden before the shot: it is the one DOM overlay whose text
// depends on WHEN in the countdown the screenshot lands, so leaving it in would
// put a three-glyph difference into an otherwise clean A/B.
//
// Usage: node shots/p20.4r2/shoot-pinned.mjs <baseUrl> <outDir> <d,d,d...> [steps]
//   baseUrl must already carry ?map=...&diagnostics=1&demo=1 (and &living=0 for
//   the B side).
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const base = process.argv[2];
const outDir = process.argv[3];
const stations = process.argv[4].split(",").map(Number);
/**
 * Target card-update step, and the floor the poll waits for.
 *
 * 90 steps = 3.0 s of living-world time. Measured: the first diagnostics report
 * past 75 steps lands at 83-86, so the sleep that carries it to 90 is 130-230 ms
 * and the shot is still inside the ~3.4 s countdown hold at every station.
 */
const TARGET_STEPS = Number(process.argv[5] ?? 90);
const FLOOR_STEPS = TARGET_STEPS - 15;
const UPDATE_HZ = 30;
const POLL_MS = 15;
const DEADLINE_MS = 25_000;

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
        steps: c.livingWorldUpdateSteps,
      };
    } catch {
      return null;
    }
  });

const urlFor = (station) =>
  `${base}&probe=boundary-hold&probeDistance=${station}&probeLateral=0`;

// Warm-up load. The FIRST navigation of a fresh browser pays shader compile and
// texture upload, which pushes the first diagnostics report past 100 steps and
// makes the sleep-to-target impossible (the target is already behind). Loading
// once and throwing the frame away puts station one on the same footing as the
// rest — measured: 102 steps cold, 85-86 warm.
await page.goto(urlFor(stations[0]), { waitUntil: "networkidle" });
await page.waitForTimeout(3000);

const results = [];
for (const station of stations) {
  let diag = null;
  let observed = 0;
  // An overshoot past the target cannot be undone, so reload instead of
  // shooting a pose whose clock does not match the other side of the A/B.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto(urlFor(station), { waitUntil: "networkidle" });
    // `hidden`, not an injected stylesheet: the page ships `style-src 'self'`,
    // so addStyleTag is refused. ui.ts only ever writes `textContent` on this
    // element, so the attribute stays set for the life of the shot.
    await page.evaluate(() => {
      const el = document.getElementById("countdown");
      if (el) el.hidden = true;
    });
    diag = null;
    const deadline = Date.now() + DEADLINE_MS;
    while (Date.now() < deadline) {
      diag = await readDiag();
      if (diag && typeof diag.steps === "number" && diag.steps >= FLOOR_STEPS) break;
      await page.waitForTimeout(POLL_MS);
    }
    observed = diag?.steps ?? 0;
    if (observed <= TARGET_STEPS) break;
    console.log(`px ${station} overshot to ${observed} steps, reloading`);
  }
  const sleepMs = Math.max(0, Math.round((TARGET_STEPS - observed) / UPDATE_HZ * 1000));
  if (sleepMs > 0) await page.waitForTimeout(sleepMs);
  const file = `${outDir}/px-${String(station).padStart(4, "0")}.png`;
  await page.screenshot({ path: file });
  const after = await readDiag();
  results.push({ station, ...diag, observedSteps: observed, sleepMs, phaseAfter: after?.phase, file });
  console.log(
    `px ${station} d=${diag?.d} ${diag?.phase}/${after?.phase} ${diag?.sector} `
      + `steps=${observed}+${sleepMs}ms->${TARGET_STEPS} calls=${diag?.calls} `
      + `cards=${diag?.cards} visible=${diag?.visible} lwCalls=${diag?.lwCalls}`,
  );
}
writeFileSync(`${outDir}/pinned.json`, JSON.stringify(results, null, 2));
console.log(`${results.length}/${stations.length} pinned poses -> ${outDir}`);
await browser.close();
