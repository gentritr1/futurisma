// P20.4 review harness (not part of the shipped game).
//
// WHY THIS EXISTS. scripts/visual/shoot-stations.mjs fires off the ~1 Hz
// diagnostics element, so at 317 km/h two runs of the same build capture a
// station up to ~60 m apart. That jitter is fine for the medians the frame
// metrics report and fatal for a pixel diff: differencing two frames taken 60 m
// apart measures the road moving, not the living world.
//
// HOW THIS PINS THE POSE. The HUD race clock (`#time-value`) is written every
// frame and the simulation is a FIXED_STEP accumulator, so the clock is
// quantised to the step and "the same race time" means "the same number of
// physics steps" — the same pose, exactly, in every run of the same build with
// the same deterministic demo autopilot. Firing on the clock instead of on the
// distance poll takes the A/B mismatch from ~60 m to under one physics step.
//
// `#countdown` is hidden before shooting: its glyph depends on WHEN in the
// countdown the page settled, which is the one overlay that would put a
// difference into an otherwise clean A/B.
//
// Usage:
//   node shots/p20.4/shoot-timed.mjs <baseUrl> <outDir> <ms,ms,ms...>
//   node shots/p20.4/shoot-timed.mjs <baseUrl> --trace <durationMs>
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const base = process.argv[2];
const outDir = process.argv[3];
const trace = outDir === "--trace";
const targets = trace ? [] : process.argv[4].split(",").map(Number);

const browser = await chromium.launch({
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
await page.goto(base, { waitUntil: "networkidle" });
await page.evaluate(() => {
  const el = document.getElementById("countdown");
  if (el) el.hidden = true;
});

/** `mm:ss.mmm` off the HUD clock, in milliseconds, or null before the race. */
const readClock = () =>
  page.evaluate(() => {
    const el = document.getElementById("time-value");
    const text = el ? (el.textContent || "").trim() : "";
    const match = /^(\d+):(\d+)\.(\d+)$/.exec(text);
    if (!match) return null;
    const ms = Number(match[1]) * 60000 + Number(match[2]) * 1000 + Number(match[3]);
    const diag = document.getElementById("futurisma-diagnostics");
    let extra = {};
    try {
      const c = JSON.parse(diag.textContent || "{}").current || {};
      extra = {
        d: c.distanceMeters,
        v: c.speedKph,
        phase: c.phase,
        sector: c.sector,
        calls: c.calls,
        tris: c.triangles,
        p95: c.p95FrameMs,
        cards: c.livingWorldCards,
        visible: c.livingWorldVisibleCards,
        lwCalls: c.livingWorldDrawCalls,
      };
    } catch {
      extra = {};
    }
    return { ms, ...extra };
  });

if (trace) {
  const until = Date.now() + Number(process.argv[4]);
  while (Date.now() < until) {
    const now = await readClock();
    if (now && now.phase === "running") console.log(`${now.ms} ${now.d} ${now.v}`);
    await page.waitForTimeout(200);
  }
  await browser.close();
} else {
  mkdirSync(outDir, { recursive: true });
  const results = [];
  let next = 0;
  const deadline = Date.now() + 180_000;
  while (next < targets.length && Date.now() < deadline) {
    const now = await readClock();
    if (now && now.phase === "running" && now.ms >= targets[next]) {
      const file = `${outDir}/t-${String(targets[next]).padStart(6, "0")}.png`;
      await page.screenshot({ path: file });
      results.push({ target: targets[next], ...now, file });
      console.log(
        `t ${targets[next]} clock=${now.ms} d=${now.d} ${now.sector} v=${now.v} `
          + `calls=${now.calls} tris=${now.tris} p95=${now.p95} `
          + `visible=${now.visible} lwCalls=${now.lwCalls}`,
      );
      next += 1;
      continue;
    }
    await page.waitForTimeout(15);
  }
  writeFileSync(`${outDir}/timed.json`, JSON.stringify(results, null, 2));
  console.log(`${results.length}/${targets.length} timed poses -> ${outDir}`);
  await browser.close();
}
