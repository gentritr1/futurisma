// Visual review harness (not part of the shipped game).
//
// P20.10 item 2 — captures each of the three track-event chips at full opacity
// and records everything the acceptance needs measured: the chip's own bounding
// box in CSS pixels, its computed colour and font, the fade durations it is
// actually running, and — for the gust — which way the craft went while the
// arrow was up.
//
// SHOOTS ON OPACITY, NOT ON A DELAY AFTER THE TRANSITION. The obvious harness
// waits the authored 1.0 s fade-in after `data-event` turns on and shoots; it
// misses, because a gust that arms while another is still running REPLACES it
// (`track-events.ts`), which restarts `gustSeconds` and drops the chip for the
// length of the new gust's own lead. With 6-7 gusts a lap over 1550 m of open
// sector that is the common case, and the first attempt at this file came back
// with a "gust" frame at opacity 0.000007. So the loop polls
// `getComputedStyle().opacity` at 25 ms and shoots the first frame at 0.98 or
// better — which is the fade-in having completed, measured rather than assumed.
//
// THE ARROW IS CHECKED AGAINST THE CRAFT, NOT AGAINST THE SCHEDULE. `GUST →`
// means "you are about to be pushed to your right", and the only external test
// of that is where the craft went. `lateralMeters` is positive to starboard —
// `game.ts` flashes "LEFT" on impact when it is negative — so the harness
// latches it at every gust chip and again 2.6 s later (past the 1.4 s ramp and
// through the 1.0 s hold) and reports the signed travel per arrow. The demo
// autopilot is steering against the wind the whole time, so this is a
// correlation over many gusts rather than a clean per-gust reading; the
// deterministic half of the argument is the code path, which the report names.
//
// Contrast is computed from the PNGs afterwards by `chip-contrast.py`, off the
// boxes written into `chips.json` here.
//
// Usage: node scripts/visual/shoot-event-chips.mjs <url> <outDir> [maxSeconds]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const url = process.argv[2];
const outDir = process.argv[3] || "shots/p20.10/chips";
const maxSeconds = Number(process.argv[4] || 260);

/** A frame counts as "the fade has finished" at this opacity. */
const LIT_OPACITY = 0.98;
/** How long after a gust chip lights the craft's lateral is read back. */
const GUST_SETTLE_MS = 2_600;

const browser = await chromium.launch({
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
page.on("console", (m) => {
  if (m.type() === "error") console.log("[console.error]", m.text().slice(0, 300));
});
await page.goto(url, { waitUntil: "networkidle" });
mkdirSync(outDir, { recursive: true });

const readChip = () => page.evaluate(() => {
  const chip = document.getElementById("track-event-chip");
  const label = document.getElementById("track-event-label");
  const style = chip ? getComputedStyle(chip) : null;
  const box = label?.getBoundingClientRect();
  const diagnostics = document.getElementById("futurisma-diagnostics");
  let current = {};
  try { current = JSON.parse(diagnostics?.textContent || "{}").current ?? {}; } catch { /* not JSON */ }
  return {
    event: chip?.dataset.event ?? "",
    text: label?.textContent ?? "",
    opacity: style ? Number(style.opacity) : 0,
    color: style?.color ?? "",
    fontSize: style?.fontSize ?? "",
    fontWeight: style?.fontWeight ?? "",
    transitionMs: style?.transitionDuration ?? "",
    reducedMotion: chip?.dataset.reducedMotion ?? "",
    // The label's own box is what a reader sees; the chip element's box is the
    // same number here, because this chip has no bar under it.
    box: box && box.width > 0
      ? { x: box.x, y: box.y, w: box.width, h: box.height }
      : null,
    chipHeight: chip ? chip.getBoundingClientRect().height : 0,
    lateral: current.lateralMeters ?? 0,
    phase: current.phase ?? "",
  };
});

const captured = [];
const seen = new Set();
/** Pending gust readings: [arrow, lateral at chip, due time]. */
const gustPending = [];
const gustTravel = [];
let previousEvent = "";
const deadline = Date.now() + maxSeconds * 1000;

while (Date.now() < deadline) {
  // A Vite HMR reload while this is running destroys the execution context
  // mid-poll, which killed a capture run outright. Skipping the poll and
  // retrying is correct either way: the chip is a DOM read with no state here.
  let state;
  try {
    state = await readChip();
  } catch (error) {
    console.log("[poll]", String(error).slice(0, 120));
    await page.waitForTimeout(250);
    continue;
  }
  if (state.phase === "finished") break;

  if (state.event === "gust" && previousEvent !== "gust") {
    gustPending.push({ arrow: state.text, lateral: state.lateral, due: Date.now() + GUST_SETTLE_MS });
  }
  while (gustPending.length > 0 && gustPending[0].due <= Date.now()) {
    const pending = gustPending.shift();
    gustTravel.push({
      arrow: pending.arrow,
      travel: Number((state.lateral - pending.lateral).toFixed(2)),
    });
  }
  previousEvent = state.event;

  if (state.event && !seen.has(state.event) && state.opacity >= LIT_OPACITY && state.box) {
    seen.add(state.event);
    const path = `${outDir}/${state.event}.png`;
    await page.screenshot({ path });
    captured.push({ ...state, path });
    console.log(
      `captured ${state.event}: "${state.text}" opacity ${state.opacity} `
      + `colour ${state.color} font ${state.fontSize}/${state.fontWeight} `
      + `fade ${state.transitionMs} chip ${state.chipHeight.toFixed(1)} px tall`,
    );
  }
  await page.waitForTimeout(25);
}

// Which way did the craft go under each arrow? Reported as a correlation over
// every gust the race produced, not as a single reading.
const summarise = (arrow) => {
  const rows = gustTravel.filter((row) => row.arrow === arrow);
  if (rows.length === 0) return `${arrow}: none`;
  const mean = rows.reduce((sum, row) => sum + row.travel, 0) / rows.length;
  const agree = rows.filter((row) => (arrow.includes("→") ? row.travel > 0 : row.travel < 0)).length;
  return `${arrow}: ${rows.length} gusts, mean lateral travel ${mean > 0 ? "+" : ""}${mean.toFixed(2)} m, `
    + `${agree}/${rows.length} moved the way the arrow points`;
};
for (const arrow of ["GUST →", "GUST ←"]) console.log(summarise(arrow));

writeFileSync(
  `${outDir}/chips.json`,
  `${JSON.stringify(captured, null, 2)}\n`,
);
writeFileSync(
  `${outDir}/gust-travel.json`,
  `${JSON.stringify(gustTravel, null, 2)}\n`,
);
console.log(`captured ${captured.length} chips -> ${outDir}`);
await browser.close();
