// Soundtrack harness (review harness, not part of the shipped game).
//
// M1 — the half of "a real mix actually plays" that Node cannot answer.
//
// `scripts/validate-soundtrack.mjs` attacks the slug, the upsert, the shuffle,
// the start-offset window and the `?music=` parse as pure functions, and every
// one of them passes whether or not a single byte of audio ever reaches a
// speaker. This one never touches those functions: it runs a real demo lap with
// the AudioContext RUNNING and reads back, off the emitted diagnostics line,
//
//   soundtrack.source       "track" | "stems" | "off"
//   soundtrack.state        "idle" | "playing" | "paused" | "ended"
//   soundtrack.currentTime  the media element's own clock
//   busMeters.musicDb       ~1 s RMS of the music bus, dBFS
//   busMeters.otherDb       ~1 s RMS of everything else, dBFS
//   musicProfileKey         the stem profile the sector asked for
//
// Chromium will not start an AudioContext or a media element without a gesture,
// so this launches with --autoplay-policy=no-user-gesture-required, and the run
// ABORTS rather than reporting a zero if the context never reaches "running".
//
// Usage: node scripts/visual/soundtrack-probe.mjs <baseUrl> <case> [extraQuery]
//   case: play | ended | absent | synth | off | pause | gain
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://127.0.0.1:5222";
const scenario = process.argv[3] ?? "play";
const extra = process.argv[4] ?? "";

const browser = await chromium.launch({
  args: [
    "--autoplay-policy=no-user-gesture-required",
    "--use-angle=metal",
    "--enable-gpu",
    "--ignore-gpu-blocklist",
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const console_ = [];
page.on("console", (message) => {
  // `location` is what separates "our code logged this" from "the browser
  // reported a failed subresource": the latter has no source file of ours.
  console_.push({
    type: message.type(),
    text: message.text().slice(0, 240),
    location: message.location?.() ?? null,
  });
});
const failedRequests = [];
page.on("requestfailed", (request) => {
  failedRequests.push({ url: request.url(), failure: request.failure()?.errorText ?? "" });
});
page.on("response", (response) => {
  if (!response.ok() && response.url().includes("/assets/audio/")) {
    failedRequests.push({ url: response.url(), status: response.status() });
  }
});
page.on("pageerror", (error) => {
  console_.push({ type: "pageerror", text: String(error).slice(0, 240) });
});

const url = `${base}/?demo=1&autostart=1&diagnostics=1${extra}`;
await page.goto(url, { waitUntil: "domcontentloaded" });
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
  const chip = document.getElementById("soundtrack-chip");
  return {
    phase: current.phase ?? "",
    contextState: current.audioContextState ?? "",
    musicProfileKey: current.musicProfileKey ?? -1,
    musicStemGains: current.musicStemGains ?? {},
    soundtrack: current.soundtrack ?? {},
    busMeters: current.busMeters ?? {},
    musicVolume: current.musicVolume ?? 0,
    distanceMeters: current.distanceMeters ?? 0,
    sector: current.sector ?? "",
    speedKph: current.speedKph ?? 0,
    chip: {
      active: chip?.dataset.active ?? "",
      hidden: chip?.getAttribute("aria-hidden") ?? "",
      text: chip?.textContent?.trim() ?? "",
      // The computed box, so "visible" is a rendered fact rather than an
      // attribute the CSS might be ignoring.
      opacity: chip ? getComputedStyle(chip).opacity : "",
      rect: chip ? JSON.parse(JSON.stringify(chip.getBoundingClientRect())) : null,
    },
  };
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls until `predicate` holds or the budget runs out. */
async function until(predicate, seconds, label) {
  const started = Date.now();
  let sample = await read();
  while ((Date.now() - started) / 1000 < seconds) {
    if (predicate(sample)) return { sample, seconds: (Date.now() - started) / 1000 };
    await wait(200);
    sample = await read();
  }
  return { sample, seconds: (Date.now() - started) / 1000, timedOut: true, label };
}

const out = (label, value) => process.stdout.write(`${label}: ${
  typeof value === "string" ? value : JSON.stringify(value)}\n`);

const running = await until((s) => s.contextState === "running", 20, "context running");
if (running.timedOut) {
  out("ABORT", "the AudioContext never reached \"running\"; nothing below would mean anything");
  out("last", running.sample);
  await browser.close();
  process.exit(2);
}
out("contextState", running.sample.contextState);

if (scenario === "play") {
  const started = await until(
    (s) => s.soundtrack.source === "track" && s.soundtrack.state === "playing",
    5,
    "track playing within 5 s",
  );
  out("reachedTrackAfterSeconds", Number(started.seconds.toFixed(2)));
  out("timedOut", Boolean(started.timedOut));
  out("soundtrack", started.sample.soundtrack);
  const first = await read();
  await wait(3000);
  const second = await read();
  out("currentTimeFirst", first.soundtrack.currentTime);
  out("currentTimeSecond", second.soundtrack.currentTime);
  out(
    "currentTimeDelta",
    Number((second.soundtrack.currentTime - first.soundtrack.currentTime).toFixed(2)),
  );
  // The proof the stems are held: every stem gain read back off the live
  // automation. `musicProfileKey` says which profile the sector asked for, so a
  // non-zero key with four zero gains is exactly "asked for, held silent".
  out("stemEvidence", {
    musicProfileKey: second.musicProfileKey,
    musicStemGains: second.musicStemGains,
    busMeters: second.busMeters,
    musicVolume: second.musicVolume,
  });
} else if (scenario === "ended") {
  const first = await until((s) => s.soundtrack.state === "playing", 8, "first track");
  out("firstTitle", first.sample.soundtrack.title);
  out("firstChip", first.sample.chip);
  await wait(4600);
  const afterChip = await read();
  out("chipAfter4600ms", afterChip.chip);
  // The 1 s acceptance is a GAP, so it is measured as one: poll tightly and
  // record the last moment the first track was still playing and the first
  // moment the second one was. A single `until` would time from when the poll
  // started, which is not the same thing.
  let lastOfFirst = null;
  let firstOfSecond = null;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const at = Date.now();
    const sample = await read();
    if (sample.soundtrack.title === first.sample.soundtrack.title
      && sample.soundtrack.state === "playing") {
      lastOfFirst = { at, currentTime: sample.soundtrack.currentTime };
    }
    if (sample.soundtrack.title !== first.sample.soundtrack.title
      && sample.soundtrack.state === "playing") {
      firstOfSecond = { at, sample };
      break;
    }
    await wait(100);
  }
  out("secondTitle", firstOfSecond?.sample.soundtrack.title ?? "");
  out("secondState", firstOfSecond?.sample.soundtrack.state ?? "");
  out("secondChip", firstOfSecond?.sample.chip ?? null);
  out("lastSampleOfFirstTrack", lastOfFirst);
  out(
    "advanceGapSeconds",
    lastOfFirst && firstOfSecond
      ? Number(((firstOfSecond.at - lastOfFirst.at) / 1000).toFixed(3))
      : null,
  );
  out("timedOut", firstOfSecond === null);
} else if (scenario === "pause") {
  await until((s) => s.soundtrack.state === "playing", 8, "playing");
  await page.keyboard.press("Escape");
  // The diagnostics line is published about once a second, so "read it 600 ms
  // after the keypress" measures the publish interval rather than the pause.
  // Poll for the transition, then measure the freeze from there.
  const reached = await until((s) => s.soundtrack.state === "paused", 6, "paused");
  out("pausedAfterSeconds", Number(reached.seconds.toFixed(2)));
  out("pauseTimedOut", Boolean(reached.timedOut));
  const paused = await read();
  out("stateAfterEscape", paused.soundtrack.state);
  out("currentTimeAtPause", paused.soundtrack.currentTime);
  await wait(2000);
  const stillPaused = await read();
  out("stateAfter2s", stillPaused.soundtrack.state);
  out("currentTimeAfter2s", stillPaused.soundtrack.currentTime);
  out(
    "frozenDelta",
    Number((stillPaused.soundtrack.currentTime - paused.soundtrack.currentTime).toFixed(2)),
  );
  await page.keyboard.press("Escape");
  const resumed = await until((s) => s.soundtrack.state === "playing", 8, "resume");
  out("stateAfterSecondEscape", resumed.sample.soundtrack.state);
  out("timedOut", Boolean(resumed.timedOut));
} else if (scenario === "gain") {
  // Five stations around the demo lap, sampled at cruise. `progress` is the lap
  // fraction the race loop publishes, so the stations are places on the circuit
  // rather than moments on a clock.
  const playing = await until((s) => s.soundtrack.state === "playing", 10, "playing");
  if (playing.timedOut) {
    out("ABORT", "no track is playing; a gain measured off the stems would be a lie");
    await browser.close();
    process.exit(2);
  }
  const samples = [];
  // Five stations by distance down the lap rather than by clock, so the same
  // five places are sampled on every run. `sector` names each one.
  for (const station of [150, 350, 550, 750, 950]) {
    const at = await until((s) => s.distanceMeters >= station, 120, `distance ${station}`);
    samples.push({
      stationMeters: station,
      reachedMeters: at.sample.distanceMeters,
      sector: at.sample.sector,
      speedKph: at.sample.speedKph,
      musicDb: at.sample.busMeters.musicDb,
      otherDb: at.sample.busMeters.otherDb,
      deltaDb: Number((at.sample.busMeters.musicDb - at.sample.busMeters.otherDb).toFixed(2)),
      trackGain: at.sample.soundtrack.trackGain,
      musicVolume: at.sample.musicVolume,
      source: at.sample.soundtrack.source,
      stems: at.sample.musicStemGains,
      timedOut: Boolean(at.timedOut),
    });
  }
  const deltas = samples.map((s) => s.deltaDb).sort((a, b) => a - b);
  out("stations", samples);
  out("medianDeltaDb", deltas[Math.floor(deltas.length / 2)]);
} else {
  // absent | synth | off — all three are "what score is running", read once the
  // decision has had time to settle.
  const settled = await until(
    (s) => s.soundtrack.source !== "" && s.musicProfileKey >= 0,
    12,
    "a settled score",
  );
  await wait(2500);
  const sample = await read();
  out("source", sample.soundtrack.source);
  out("state", sample.soundtrack.state);
  out("busMeters", sample.busMeters);
  out("musicProfileKey", sample.musicProfileKey);
  out("musicStemGains", sample.musicStemGains);
  out("settledAfterSeconds", Number(settled.seconds.toFixed(2)));
}

out("consoleErrorsAndWarnings", console_.filter(
  (entry) => entry.type === "error" || entry.type === "warning" || entry.type === "pageerror",
));
out("networkAudioFailures", failedRequests);
out("consoleAll", console_);
await browser.close();
