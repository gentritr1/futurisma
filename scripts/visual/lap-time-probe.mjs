// Review harness (not part of the shipped game).
//
// One demo lap, reported as `lapTimesMs`, so a phase that claims "lap times
// unchanged" can show the number rather than assert it. Reads the same emitted
// diagnostics line every other harness does.
//
// A fifth argument of `suspended` drops the autoplay exemption, which is how a
// headless soak actually runs: the AudioContext never leaves "suspended", so
// the lap it reports is the one every existing baseline was measured against
// and every audio counter must read zero without throwing.
//
// Usage: node scripts/visual/lap-time-probe.mjs <baseUrl> <map> [laps] [extra] [suspended]
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://127.0.0.1:5220";
const map = process.argv[3] ?? "bitterpan";
const laps = Number(process.argv[4] ?? 1);
const extra = process.argv[5] ?? "";
const url = `${base}/?map=${map}&laps=${laps}&demo=1&diagnostics=1${extra}`;

const suspended = process.argv[6] === "suspended";
const browser = await chromium.launch({
  args: [
    ...(suspended ? [] : ["--autoplay-policy=no-user-gesture-required"]),
    "--use-angle=metal",
    "--enable-gpu",
    "--ignore-gpu-blocklist",
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(String(error).slice(0, 200)));
page.on("console", (message) => {
  if (message.type() === "error") pageErrors.push(`[console] ${message.text().slice(0, 200)}`);
});
await page.goto(url, { waitUntil: "networkidle" });
await page.evaluate(() => document.getElementById("start-button")?.click());

const read = () => page.evaluate(() => {
  try {
    const current = JSON.parse(
      document.getElementById("futurisma-diagnostics")?.textContent || "{}",
    ).current || {};
    return {
      phase: current.phase ?? "",
      lapTimesMs: current.lapTimesMs ?? [],
      elapsedMs: current.elapsedMs ?? 0,
      rivalFinishMs: current.rivalFinishTimesMs ?? current.rivalLapTimesMs ?? null,
      contextState: current.audioContextState ?? "",
      pitRadio: current.pitRadio ?? null,
    };
  } catch {
    return null;
  }
});

const started = Date.now();
while ((Date.now() - started) / 1000 < 180) {
  const sample = await read();
  if (sample && sample.phase === "finished") {
    console.log(JSON.stringify({ url, suspended, ...sample, pageErrors }));
    await browser.close();
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, 120));
}
await browser.close();
console.error("ABORT: never finished.");
process.exit(2);
