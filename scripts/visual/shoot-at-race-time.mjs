// Visual review harness (not part of the shipped game).
//
// P20.10 — shoots the first frame at or past a given RACE time, in milliseconds,
// read off `#time-value` (which the HUD rewrites every frame) rather than off
// `#futurisma-diagnostics` (once a second, up to 85 m of travel at race speed).
//
// `game.ts` integrates `elapsedMs` inside the fixed-step loop, so a pose is a
// pure function of the race clock: two builds, or a `?living=0` pair, shot at
// the same race time are the same pose to within one presentation sub-step.
//
// Usage: node scripts/visual/shoot-at-race-time.mjs <url> <out.png> <raceMs>
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const url = process.argv[2];
const out = process.argv[3];
const targetMs = Number(process.argv[4]);

const browser = await chromium.launch({
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
await page.goto(url, { waitUntil: "networkidle" });
mkdirSync(dirname(out), { recursive: true });

const read = () => page.evaluate(() => {
  const m = /^(\d+):(\d+)\.(\d+)$/.exec(document.getElementById("time-value")?.textContent ?? "");
  const ms = m ? Number(m[1]) * 60_000 + Number(m[2]) * 1_000 + Number(m[3]) : -1;
  const el = document.getElementById("futurisma-diagnostics");
  let current = {};
  try { current = JSON.parse(el?.textContent || "{}").current ?? {}; } catch { /* not JSON */ }
  return {
    ms,
    d: current.distanceMeters ?? 0,
    sector: current.sector ?? "",
    phase: current.phase ?? "",
    chip: document.getElementById("track-event-label")?.textContent ?? "",
  };
});

const started = Date.now();
let shot = null;
while ((Date.now() - started) / 1000 < 300) {
  const state = await read();
  if (state.phase === "finished") break;
  if (state.ms >= targetMs) {
    await page.screenshot({ path: out });
    shot = state;
    break;
  }
  await page.waitForTimeout(4);
}
console.log(shot ? `shot ${out} ${JSON.stringify(shot)}` : "no frame captured");
await browser.close();
