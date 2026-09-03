// Visual review harness (not part of the shipped game).
//
// Shoots the first frame at or past a given course distance on a given lap, so
// two builds can be compared at the same place rather than at the same second.
// Usage: node scripts/visual/shoot-at-distance.mjs <url> <out.png> <metres> [lap]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const url = process.argv[2];
const out = process.argv[3];
const target = Number(process.argv[4]);
const wantLap = Number(process.argv[5] ?? 1);

const browser = await chromium.launch({
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(url, { waitUntil: "networkidle" });
mkdirSync(dirname(out), { recursive: true });

const started = Date.now();
let shot = false;
while ((Date.now() - started) / 1000 < 200) {
  await page.waitForTimeout(30);
  const state = await page.evaluate(() => {
    const el = document.getElementById("futurisma-diagnostics");
    try {
      const c = JSON.parse(el?.textContent || "{}").current ?? {};
      return { d: c.distanceMeters ?? 0, lap: c.lapTimesMs?.length ?? 0, phase: c.phase, chip: document.getElementById("track-event-label")?.textContent ?? "" };
    } catch { return null; }
  });
  if (!state) continue;
  if (state.phase === "finished") break;
  if (state.phase !== "running") continue;
  if (state.lap + 1 === wantLap && state.d >= target && state.d < target + 120) {
    await page.screenshot({ path: out });
    console.log("shot", JSON.stringify(state));
    shot = true;
    break;
  }
}
if (!shot) console.log("no frame captured");
await browser.close();
