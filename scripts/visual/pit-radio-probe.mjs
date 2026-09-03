// Pit-radio harness (review harness, not part of the shipped game).
//
// H2b — the half of "the radio speaks" that Node cannot answer.
//
// `scripts/validate-audio-ambience.mjs` attacks the table, the queue and the
// five HUD-frame edges as pure functions, and it will pass whether or not a
// single AudioBufferSourceNode ever starts. This one never touches those
// functions: it runs a real demo lap with the AudioContext RUNNING and reads
// back, from the emitted diagnostics line,
//
//   pitRadio.loaded       how many of the 17 clips decoded
//   pitRadio.lastLine     the id of the line that most recently STARTED
//   pitRadio.linesPlayed  how many actually started
//   pitRadio.linesDropped how many were queued and never spoke
//
// `linesPlayed` is the acceptance, and `lastLine` is what makes it a
// measurement of the trigger table rather than of a counter: a run that reports
// four lines and never names `gate_clear` has not proved that a gate speaks.
//
// Chromium will not start an AudioContext without a gesture, so this launches
// with --autoplay-policy=no-user-gesture-required and additionally asserts the
// context reached "running"; if it did not, the run ABORTS rather than
// reporting a zero that would read as a broken radio.
//
// Usage: node scripts/visual/pit-radio-probe.mjs <baseUrl> [map] [laps] [voice]
//   node scripts/visual/pit-radio-probe.mjs http://127.0.0.1:5220 bitterpan 1
//   node scripts/visual/pit-radio-probe.mjs http://127.0.0.1:5220 bitterpan 1 0
//
// The fourth argument is `?voice=`, so the kill switch is verified by the same
// harness that verifies the radio: `voice=0` must report loaded 0, played 0 and
// a lap time identical to the run above it.
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://127.0.0.1:5220";
const map = process.argv[3] ?? "bitterpan";
const laps = Number(process.argv[4] ?? 1);
const voice = process.argv[5];
const url = `${base}/?map=${map}&laps=${laps}&demo=1&diagnostics=1`
  + (voice === undefined ? "" : `&voice=${voice}`);

/** The acceptance for a single lap of Bitterpan with the voice on. */
const MINIMUM_LINES_PER_LAP = 4;

const browser = await chromium.launch({
  args: [
    "--autoplay-policy=no-user-gesture-required",
    "--use-angle=metal",
    "--enable-gpu",
    "--ignore-gpu-blocklist",
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 300)));
const missing = [];
page.on("response", (response) => {
  if (response.url().includes("/assets/audio/") && !response.ok()) {
    missing.push(`${response.status()} ${response.url()}`);
  }
});
await page.goto(url, { waitUntil: "networkidle" });
await page.evaluate(() => {
  document.getElementById("start-button")?.click();
});

const read = () => page.evaluate(() => {
  const element = document.getElementById("futurisma-diagnostics");
  let report = {};
  try {
    report = JSON.parse(element?.textContent || "{}");
  } catch {
    // The first frames emit nothing; an empty object is the correct reading.
  }
  const current = report.current ?? {};
  return {
    phase: current.phase ?? "",
    contextState: current.audioContextState ?? "",
    lap: current.lap ?? 0,
    lapMs: current.lastLapMs ?? 0,
    elapsedMs: current.elapsedMs ?? 0,
    radio: current.pitRadio ?? {},
  };
});

const spoken = new Map();
let sawRunningContext = false;
let last = null;
let peakLoaded = 0;
const started = Date.now();
while ((Date.now() - started) / 1000 < 180) {
  const sample = await read();
  if (sample.contextState === "running") sawRunningContext = true;
  peakLoaded = Math.max(peakLoaded, sample.radio.loaded ?? 0);
  // `lastLine` only changes when a line STARTS, so a change in it is one
  // playback. Counting transitions rather than trusting `linesPlayed` is what
  // makes the id list independent of the counter it is reported beside.
  if (sample.radio.lastLine && sample.radio.lastLine !== last) {
    spoken.set(sample.radio.lastLine, (spoken.get(sample.radio.lastLine) ?? 0) + 1);
    last = sample.radio.lastLine;
  }
  if (sample.phase === "finished") {
    const final = await read();
    console.log(JSON.stringify({
      url,
      contextState: final.contextState,
      loaded: peakLoaded,
      linesPlayed: final.radio.linesPlayed,
      linesDropped: final.radio.linesDropped,
      queueDepth: final.radio.queueDepth,
      distinctLines: [...spoken.keys()],
      spoken: Object.fromEntries(spoken),
      lapMs: final.lapMs,
      elapsedMs: final.elapsedMs,
      missingAudioResponses: missing,
    }, null, 2));
    await browser.close();
    if (!sawRunningContext) {
      console.error("ABORT: the AudioContext never reached \"running\".");
      process.exit(2);
    }
    if (voice === "0") {
      if (peakLoaded !== 0 || (final.radio.linesPlayed ?? 0) !== 0) {
        console.error("FAIL: ?voice=0 still loaded or played the pit radio.");
        process.exit(1);
      }
      console.log("PASS: ?voice=0 loaded nothing and spoke nothing.");
      process.exit(0);
    }
    if (missing.length > 0) {
      console.error(`FAIL: ${missing.length} audio response(s) did not 200.`);
      process.exit(1);
    }
    if (peakLoaded !== 17) {
      console.error(`FAIL: ${peakLoaded} of 17 clips decoded.`);
      process.exit(1);
    }
    if (!spoken.has("gate_clear")) {
      console.error("FAIL: no gate_clear on a full lap; the first gate is silent.");
      process.exit(1);
    }
    const perLap = (final.radio.linesPlayed ?? 0) / Math.max(1, laps);
    if (perLap < MINIMUM_LINES_PER_LAP) {
      console.error(
        `FAIL: ${perLap.toFixed(1)} lines per lap, below the ${
          MINIMUM_LINES_PER_LAP} the phase accepts.`,
      );
      process.exit(1);
    }
    console.log(
      `PASS: ${final.radio.linesPlayed} line(s) over ${laps} lap(s) `
        + `(${perLap.toFixed(1)}/lap, floor ${MINIMUM_LINES_PER_LAP}), `
        + `${spoken.size} distinct, ${peakLoaded}/17 decoded.`,
    );
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, 150));
}

await browser.close();
console.error("ABORT: the race never finished inside 180 s.");
process.exit(2);
