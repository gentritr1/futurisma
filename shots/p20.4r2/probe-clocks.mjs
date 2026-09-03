// P20.4 round-2 review harness (not part of the shipped game).
// Prints the candidate clocks the pinned A/B could anchor on, so the anchor is
// chosen from what the game actually publishes rather than from a guess.
import { chromium } from "playwright";

const browser = await chromium.launch({
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(
  "http://127.0.0.1:5206/?map=bitterpan&laps=1&demo=1&diagnostics=1"
    + "&probe=boundary-hold&probeDistance=1080&probeLateral=0",
  { waitUntil: "networkidle" },
);
for (let i = 0; i < 14; i += 1) {
  await page.waitForTimeout(400);
  const row = await page.evaluate(() => {
    const el = document.getElementById("futurisma-diagnostics");
    if (!el) return null;
    try {
      const c = JSON.parse(el.textContent || "{}").current || {};
      return {
        phase: c.phase,
        lw: c.livingWorldUpdateSteps,
        rv: c.rivalUpdateSteps,
        atmo: c.atmosphereUpdates,
        ready: c.startupReadyMs,
        lwLoad: c.livingWorldLoadMs,
        raceTime: c.raceTimeMs,
        audio: c.audioControlUpdates,
        atmoHz: c.atmosphereHz,
        frameMs: c.frameMs,
        d: c.distanceMeters,
      };
    } catch {
      return null;
    }
  });
  console.log(i, JSON.stringify(row));
}
await browser.close();
