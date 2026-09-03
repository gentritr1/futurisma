// Visual review harness (not part of the shipped game).
//
// G3 — captures each live track event the moment it is actually on screen,
// rather than hoping a timed burst lands on one.
//
// Every one of the three is short and none happens at a time anybody can
// predict from outside the race: a gust's hold is 1.0 s, the salt patch is live
// for 6 s two or three times in a five-lap race, and the squall's 25 s starts
// at a distance the seed picks. So this follows the `shoot-contact.mjs` idiom —
// poll fast, shoot on the transition INTO the state.
//
// TRIGGERED OFF THE HUD CHIP, NOT OFF DIAGNOSTICS, and that distinction is the
// whole reason this file has a second version. `#futurisma-diagnostics` is
// rewritten once a SECOND; the first version of this harness scored frames on
// `saltNow` read from it and captured the salt patch from 2 m PAST the span,
// because the number it was scoring on was up to a second stale. The chip's
// `data-event` is written by the HUD at 30 Hz on the state change itself, so
// the transition is accurate to a frame — and the phase's own authored offsets
// then say exactly how long to wait from it:
//
//   gust    shoot AT the transition. The chip lights 1.0 s before the hold and
//           the crossing scud is on the centreline 1.2 s before it, so the card
//           is still over the deck for ~0.24 s after the chip appears. That
//           overlap IS the frame the acceptance asks for, and it is the only
//           one where both are true at once.
//   salt    shoot 2.05 s after the transition. The lamps go solid at the
//           transition and the salt lands SALT_WARNING_SECONDS later, so this
//           is the freshest the patch ever is, with the craft on it.
//   squall  shoot 4 s after the transition, past the 2 s ramp, so the rain is
//           at full strength and the grip cost is in the frame.
//
// Usage: node scripts/visual/shoot-track-events.mjs <url> <outDir> [maxSeconds]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const url = process.argv[2];
const outDir = process.argv[3] || "shots/g3-track-events";
const maxSeconds = Number(process.argv[4] || 240);

/** Milliseconds to wait after the chip lights before shooting, per event. */
const DELAY_MS = { gust: 0, salt: 2_050, squall: 4_000 };

const browser = await chromium.launch({
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (event) => console.log("[pageerror]", String(event).slice(0, 300)));
page.on("console", (message) => {
  if (message.type() === "error") console.log("[console.error]", message.text().slice(0, 300));
});
await page.goto(url, { waitUntil: "networkidle" });
mkdirSync(outDir, { recursive: true });

const readState = () => page.evaluate(() => {
  const chipEl = document.getElementById("track-event-chip");
  const diagnostics = document.getElementById("futurisma-diagnostics");
  let current = {};
  try {
    current = JSON.parse(diagnostics?.textContent || "{}").current ?? {};
  } catch { /* not JSON yet */ }
  return {
    // 30 Hz, written on the state change. Everything below it is once a second.
    chip: document.getElementById("track-event-label")?.textContent ?? "",
    chipEvent: chipEl?.dataset.event ?? "",
    phase: current.phase ?? "",
    distance: current.distanceMeters ?? 0,
    sector: current.sector ?? "",
    grip: current.surfaceGrip ?? 1,
    gusts: current.gusts ?? 0,
    saltDrops: current.saltDrops ?? 0,
    squalls: current.squalls ?? 0,
    calls: current.calls ?? 0,
  };
});

const captured = new Set();
let previousEvent = "";
const started = Date.now();

while ((Date.now() - started) / 1000 < maxSeconds) {
  await page.waitForTimeout(30);
  let state;
  try {
    state = await readState();
  } catch {
    break;
  }
  if (state.phase === "finished") break;
  const event = state.chipEvent;
  const rising = event !== "" && event !== previousEvent;
  previousEvent = event;
  if (!rising || captured.has(event)) continue;
  const delay = DELAY_MS[event] ?? 0;
  if (delay > 0) await page.waitForTimeout(delay);
  const at = await readState();
  // The gust is shot as a short BURST rather than a single frame. The crossing
  // card leaves the deck about 240 ms after the chip lights (it is on the
  // centreline 1.2 s before the hold and the chip lights 1.0 s before it, and
  // the card clears the 23 m deck at the traverse's 26 m/s), so the frame that
  // shows both is inside a quarter of a second that no single screenshot can be
  // aimed at. Six frames at 55 ms cover it; the reviewer keeps the one that
  // has the card over the road.
  const burst = event === "gust" ? 6 : 1;
  for (let frame = 0; frame < burst; frame += 1) {
    const name = burst === 1 ? event : `${event}-${frame}`;
    await page.screenshot({ path: `${outDir}/${name}.png` });
    if (frame + 1 < burst) await page.waitForTimeout(55);
  }
  captured.add(event);
  console.log(`shot ${event}`, JSON.stringify({ trigger: state, at }));
}

console.log("captured", [...captured].join(", ") || "(nothing)");
await browser.close();
