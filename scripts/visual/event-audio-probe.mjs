// Audio harness (review harness, not part of the shipped game).
//
// P20.10 item 3 — the half of "the events are audible" that neither node nor an
// OfflineAudioContext can answer: does a LIVE race actually drive the ambience
// latch, and does the graph move when it does?
//
// `scripts/validate-audio-ambience.mjs` asserts the plan (a full windGust is a
// +5.11 dB swell on `dry_wind`) and `audio-probe.mjs` renders each bed at
// event 1 offline (-25.99 -> -20.26 dBFS). Both of those drive `setEventLevels`
// THEMSELVES, so both passed for the whole time nothing in the game ever called
// it. This one never touches the latch: it starts a real race with the context
// RUNNING and reads back, from the same diagnostics snapshot,
//
//   trackEvents.gustNow        the published gust level, 0..1
//   audio.ambience.eventLevels the latch the beds read
//   audio.ambience.bedLevels   the LIVE GainNode values, read off the nodes
//
// The third is the acceptance. The first two agreeing proves the wire is
// connected; `dry_wind` rising above its authored 0.30 while a gust is live
// proves the sound changed, which is the thing a driver would notice.
//
// Chromium will not start an AudioContext without a gesture, so this launches
// with --autoplay-policy=no-user-gesture-required and additionally resumes it,
// the `audio-probe.mjs` idiom; if the context is not "running" the run aborts
// rather than reporting zeros.
//
// Usage: node scripts/visual/event-audio-probe.mjs <baseUrl> [map] [laps]
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://127.0.0.1:5215";
const map = process.argv[3] ?? "bitterpan";
const laps = Number(process.argv[4] ?? 5);
const url = `${base}/?map=${map}&laps=${laps}&demo=1&diagnostics=1`;

/** The bed each event is authored to drive, and its resting level. */
const EVENT_BED = {
  bitterpan: { windGust: "dry_wind", saltDrop: "salt_patter" },
  greenwater: { squall: "rain_patter", windGust: "wetland" },
};

const browser = await chromium.launch({
  args: [
    "--autoplay-policy=no-user-gesture-required",
    "--use-angle=metal",
    "--enable-gpu",
    "--ignore-gpu-blocklist",
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
await page.goto(url, { waitUntil: "networkidle" });
await page.evaluate(() => {
  document.getElementById("start-button")?.click();
});

const read = () => page.evaluate(() => {
  const element = document.getElementById("futurisma-diagnostics");
  let report = {};
  try { report = JSON.parse(element?.textContent || "{}"); } catch { /* not JSON yet */ }
  // `diagnostics.ts` spreads the track-event contributor into `current` and
  // nests the sound field under `current.audio`, so both halves of the check
  // come out of ONE snapshot — which is what makes "the latch agrees with the
  // published level" a statement about the same tick rather than about two.
  const current = report.current ?? {};
  const audio = current.audio ?? {};
  return {
    phase: current.phase ?? "",
    contextState: current.audioContextState ?? "",
    gustNow: current.gustNow ?? 0,
    saltNow: current.saltNow ?? 0,
    squallNow: current.squallNow ?? 0,
    eventLevels: audio.eventLevels ?? {},
    bedLevels: audio.bedLevels ?? {},
  };
});

const samples = [];
const started = Date.now();
let sawRunningContext = false;
while ((Date.now() - started) / 1000 < 260) {
  const state = await read();
  if (state.contextState === "running") sawRunningContext = true;
  if (state.phase === "running") samples.push(state);
  if (state.phase === "finished") break;
  await page.waitForTimeout(120);
}
await browser.close();

if (!sawRunningContext) {
  console.log("FAIL: the AudioContext never reached \"running\"; every level below would be a zero.");
  process.exit(1);
}

const beds = EVENT_BED[map] ?? {};
let report = "";
let failures = 0;
for (const [event, bedId] of Object.entries(beds)) {
  const source = { windGust: "gustNow", saltDrop: "saltNow", squall: "squallNow" }[event];
  const live = samples.filter((row) => (row[source] ?? 0) > 0.05);
  // Distinct events, not distinct samples: consecutive samples inside one gust
  // are one gust. A gap of more than one sampling interval starts a new one.
  let episodes = 0;
  let previousIndex = -10;
  for (const row of live) {
    const index = samples.indexOf(row);
    if (index - previousIndex > 2) episodes += 1;
    previousIndex = index;
  }
  // 1e-3, not an exact compare: `diagnostics.ts` emits the published level as
  // `Number(published.gust.toFixed(3))` while the latch is copied out at full
  // precision, so the two differ by up to half a thousandth by construction.
  // An exact compare here reported 104/581 on a wire that was working.
  const agreed = live.filter(
    (row) => Math.abs((row.eventLevels[event] ?? -1) - row[source]) <= 1e-3,
  ).length;
  const rest = Math.min(...samples.map((row) => row.bedLevels[bedId] ?? 0));
  const peak = Math.max(...live.map((row) => row.bedLevels[bedId] ?? 0), 0);
  const restingPeak = Math.max(
    ...samples
      .filter((row) => (row[source] ?? 0) <= 0.001)
      .map((row) => row.bedLevels[bedId] ?? 0),
    0,
  );
  // THE GATE IS THE BED'S OWN FLOOR, NOT ITS LEVEL BETWEEN EVENTS. A first
  // version compared the peak during gusts with the peak between them and
  // reported FAIL on a working wire: `AMBIENCE_SMOOTHING_SECONDS` is 2/3 s and
  // Bitterpan runs 6-7 gusts a lap, so `dry_wind` never gets back to rest
  // between them (0.4964 between, 0.5203 during, on the run that failed). The
  // floor over the race IS the authored level for an unwindowed bed and zero
  // for an event-only one, so "the event lifts the bed 15% over its own floor"
  // is the statement that survives overlapping events.
  const ok = live.length > 0 && agreed === live.length && peak > rest * 1.15;
  if (!ok && live.length > 0) failures += 1;
  report += `\n  ${event} -> ${bedId}: ${episodes} episodes over ${live.length} samples; `
    + `latch matched the published level in ${agreed}/${live.length}; `
    + `bed ${rest.toFixed(4)} at rest, ${restingPeak.toFixed(4)} peak between events, `
    + `${peak.toFixed(4)} during them  ${live.length === 0 ? "(none in this race)" : (ok ? "PASS" : "FAIL")}`;
}

console.log(`event-audio-probe ${map}, ${laps} laps, ${samples.length} samples, context running:${report}`);
process.exit(failures > 0 ? 1 : 0);
