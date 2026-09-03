// Visual review harness (not part of the shipped game).
//
// P20.10 item 1 — "does a living-world card ever black out the frame?", as a
// number rather than as a look at four screenshots.
//
// THE PAIRING IS THE WHOLE DESIGN. The acceptance is "world-crop pixels
// darkened by >= 25 luma RELATIVE TO A `?living=0` FRAME AT THE SAME RACE
// TIME", which needs two runs photographed at the same instant of the race,
// and the project's existing station harnesses cannot do that: they pair on
// `#futurisma-diagnostics`, which is rewritten once a SECOND and at 300 km/h is
// up to 85 m of travel.
//
// `game.ts` integrates the race clock inside the fixed-step loop
// (`this.elapsedMs += delta * 1000` at FIXED_STEP = 1/120), so the craft's pose
// is a pure function of `elapsedMs` and NOT of the wall clock. `#time-value` is
// that number, rendered to the millisecond, and the HUD rewrites it every
// frame. So both passes sample on the RACE clock and are paired on it
// afterwards, nearest-neighbour. The residual is one presentation sub-step
// (<= 8.3 ms, ~0.7 m at race speed) of camera interpolation, and the run
// measures that residual instead of assuming it away — see NOISE FLOOR below.
//
// THE READBACK IS IN A rAF CALLBACK, on purpose. The renderer is built without
// `preserveDrawingBuffer`, so a `drawImage(gameCanvas, ...)` issued from an
// ordinary `page.evaluate` task reads a cleared buffer. Issued from inside a
// `requestAnimationFrame` callback it reads the frame the game just drew, which
// is what makes a 60 Hz sample cheap enough to take on every frame of a five
// lap race — `page.screenshot` at that rate would cost more than the race.
//
// NOISE FLOOR. A pass is additionally differenced against ITSELF shifted by one
// sample, which is the same pairing error the A/B carries plus one frame of
// world motion. Any A/B share at or under that number is measurement, not card.
//
// Usage:
//   node scripts/visual/slab-census.mjs <baseUrl> <outDir> [maxSeconds]
// e.g. node scripts/visual/slab-census.mjs \
//        "http://127.0.0.1:5215/?map=bitterpan&laps=5&demo=1&diagnostics=1" \
//        shots/p20.10/census 260
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const baseUrl = process.argv[2];
const outDir = process.argv[3] || "shots/p20.10/census";
const maxSeconds = Number(process.argv[4] || 260);

/** The acceptance crop, in CSS pixels of the 1280x720 viewport. */
const CROP = { x: 0, y: 130, w: 1100, h: 430 };
/** Downscale factor for the readback. 1100x430 -> 137x53 = 7261 samples. */
const SCALE = 8;
/** A pixel counts as darkened at this much luma below the reference. */
const DARK_LUMA = 25;

const GRID_W = Math.floor(CROP.w / SCALE);
const GRID_H = Math.floor(CROP.h / SCALE);

mkdirSync(outDir, { recursive: true });

/**
 * Runs one pass and returns { times: number[], frames: Uint8Array[] }.
 * `frames[i]` is GRID_W * GRID_H luma bytes for race time `times[i]`.
 */
async function pass(browser, url, label, minStepMs) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("pageerror", (e) => console.log(`[${label} pageerror]`, String(e).slice(0, 300)));
  page.on("console", (m) => {
    if (m.type() === "error") console.log(`[${label} console.error]`, m.text().slice(0, 300));
  });
  await page.goto(url, { waitUntil: "networkidle" });

  await page.evaluate(({ crop, gw, gh, minStepMs }) => {
    const canvas = document.getElementById("game-canvas");
    const timeEl = document.getElementById("time-value");
    const small = document.createElement("canvas");
    small.width = gw;
    small.height = gh;
    const ctx = small.getContext("2d", { willReadFrequently: true });
    const out = [];
    globalThis.__slab = { out, done: false, frames: 0 };
    const parse = (text) => {
      const m = /^(\d+):(\d+)\.(\d+)$/.exec(text || "");
      if (!m) return -1;
      return Number(m[1]) * 60_000 + Number(m[2]) * 1_000 + Number(m[3]);
    };
    let lastMs = -1;
    const tick = () => {
      requestAnimationFrame(tick);
      const ms = parse(timeEl?.textContent ?? "");
      // Only while the race clock is actually running, never twice for the same
      // millisecond (the HUD holds its last value on the results screen), and no
      // faster than the pass's own race-clock cadence.
      if (ms <= 0 || ms === lastMs) return;
      if (lastMs >= 0 && ms - lastMs < minStepMs) return;
      lastMs = ms;
      globalThis.__slab.frames += 1;
      // The device-pixel ratio of the backing store vs the CSS box.
      const sx = canvas.width / canvas.clientWidth;
      const sy = canvas.height / canvas.clientHeight;
      ctx.drawImage(
        canvas,
        crop.x * sx, crop.y * sy, crop.w * sx, crop.h * sy,
        0, 0, gw, gh,
      );
      const data = ctx.getImageData(0, 0, gw, gh).data;
      // Packed to base64 rather than handed over as an array of numbers: a
      // five-lap reference pass is ~5500 samples of 7261 bytes, and the JSON
      // encoding of that many numbers costs more than the race does.
      let binary = "";
      for (let i = 0, p = 0; i < gw * gh; i += 1, p += 4) {
        binary += String.fromCharCode(Math.round(
          0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2],
        ));
      }
      out.push([ms, btoa(binary)]);
    };
    requestAnimationFrame(tick);
  }, { crop: CROP, gw: GRID_W, gh: GRID_H, minStepMs });

  const times = [];
  const frames = [];
  const started = Date.now();
  let finished = false;
  while ((Date.now() - started) / 1000 < maxSeconds && !finished) {
    await page.waitForTimeout(1500);
    const batch = await page.evaluate(() => {
      const taken = globalThis.__slab.out.splice(0, globalThis.__slab.out.length);
      const el = document.getElementById("futurisma-diagnostics");
      let phase = "";
      try { phase = JSON.parse(el?.textContent || "{}").current?.phase ?? ""; } catch { /* not JSON */ }
      return { taken, phase };
    });
    for (const [ms, packed] of batch.taken) {
      times.push(ms);
      frames.push(Buffer.from(packed, "base64"));
    }
    if (batch.phase === "finished" && batch.taken.length === 0) finished = true;
  }
  console.log(`${label}: ${frames.length} samples, race ${times.at(0)}..${times.at(-1)} ms`);
  await page.close();
  return { times, frames };
}

const browser = await chromium.launch({
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const join = (url, extra) => (url.includes("?") ? `${url}&${extra}` : `${url}?${extra}`);
// The reference is sampled four times as densely as the live pass, so every
// live frame has a race-time neighbour within half a sampling interval.
const reference = await pass(browser, join(baseUrl, "living=0"), "living=0", 31);
const live = await pass(browser, baseUrl, "living=1", 125);
await browser.close();

/** Nearest reference sample to a race time, by binary search. */
function nearest(times, target) {
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  const a = Math.max(0, lo - 1);
  return Math.abs(times[a] - target) <= Math.abs(times[lo] - target) ? a : lo;
}

function darkShare(live, ref) {
  let dark = 0;
  for (let i = 0; i < live.length; i += 1) if (ref[i] - live[i] >= DARK_LUMA) dark += 1;
  return dark / live.length;
}

// The A/B census.
const rows = [];
for (let i = 0; i < live.frames.length; i += 1) {
  const j = nearest(reference.times, live.times[i]);
  rows.push({
    raceMs: live.times[i],
    pairMs: reference.times[j],
    driftMs: live.times[i] - reference.times[j],
    share: darkShare(live.frames[i], reference.frames[j]),
  });
}
rows.sort((a, b) => b.share - a.share);

// The noise floor: the same statistic computed inside the reference pass
// against its own neighbour, which carries the pairing residual and one frame
// of camera motion but no cards at all.
const noise = [];
for (let i = 1; i < reference.frames.length; i += 1) {
  noise.push(darkShare(reference.frames[i], reference.frames[i - 1]));
}
noise.sort((a, b) => b - a);

const pct = (v) => `${(v * 100).toFixed(2)}%`;
const summary = {
  crop: CROP,
  scale: SCALE,
  darkLuma: DARK_LUMA,
  liveSamples: live.frames.length,
  referenceSamples: reference.frames.length,
  maxShare: rows[0]?.share ?? 0,
  maxShareRaceMs: rows[0]?.raceMs ?? 0,
  maxShareDriftMs: rows[0]?.driftMs ?? 0,
  p999Share: rows[Math.floor(rows.length * 0.001)]?.share ?? 0,
  p99Share: rows[Math.floor(rows.length * 0.01)]?.share ?? 0,
  medianShare: rows[Math.floor(rows.length * 0.5)]?.share ?? 0,
  framesOver25: rows.filter((r) => r.share > 0.25).length,
  framesOver15: rows.filter((r) => r.share > 0.15).length,
  noiseFloorMax: noise[0] ?? 0,
  noiseFloorP99: noise[Math.floor(noise.length * 0.01)] ?? 0,
  worst: rows.slice(0, 12),
};
writeFileSync(`${outDir}/census.json`, `${JSON.stringify(summary, null, 2)}\n`);
console.log(
  `max ${pct(summary.maxShare)} at race ${summary.maxShareRaceMs} ms `
  + `(pair drift ${summary.maxShareDriftMs} ms); p99 ${pct(summary.p99Share)}; `
  + `median ${pct(summary.medianShare)}; over 25%: ${summary.framesOver25}; `
  + `over 15%: ${summary.framesOver15}; noise floor max ${pct(summary.noiseFloorMax)}`,
);
console.log(`worst frames: ${summary.worst.map((r) => `${r.raceMs}ms=${pct(r.share)}`).join(", ")}`);
