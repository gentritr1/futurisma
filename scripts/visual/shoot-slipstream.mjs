// Screenshots the HUD while the SLIPSTREAM chip is lit (not part of the game).
//
// Polls the chip's own dataset every frame rather than the diagnostics line,
// which only refreshes at ~1 Hz - a tow can come and go between two ticks. When
// the chip reads LOCK it takes a burst of frames rather than one, because the
// craft supplying the tow is 4-16 m ahead and whether it is clear of the
// player's own hull in the chase framing depends on where in that band it is.
//
// Usage: node scripts/visual/shoot-slipstream.mjs <url> [outDir]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const url = process.argv[2];
const outDir = process.argv[3] || "shots/slipstream";
const browser = await chromium.launch({
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
await page.goto(url, { waitUntil: "networkidle" });
mkdirSync(outDir, { recursive: true });

const read = () => page.evaluate(() => {
  const chip = document.getElementById("slipstream-chip");
  const fill = document.getElementById("slipstream-fill");
  const diagnostics = document.getElementById("futurisma-diagnostics");
  let tow = null;
  try {
    const current = JSON.parse(diagnostics?.textContent || "{}").current || {};
    tow = {
      rival: current.slipstreamRival,
      ahead: current.slipstreamAheadMeters,
      lateral: current.slipstreamLateralMeters,
      world: current.slipstreamWorldMeters,
      mismatch: current.slipstreamMaxPositionMismatchMeters,
      distance: current.distanceMeters,
    };
  } catch { /* the diagnostics line is not JSON yet */ }
  return chip
    ? {
      active: chip.dataset.active,
      locked: chip.dataset.locked,
      label: chip.textContent?.trim().split("\n")[0] ?? "",
      fill: fill?.style.transform ?? "",
      speed: document.getElementById("speed-value")?.textContent ?? "",
      tow,
    }
    : null;
});

const shots = [];
let active = false;
let locks = 0;
const deadline = Date.now() + 220_000;
while (Date.now() < deadline && locks < 6) {
  const chip = await read();
  if (chip && chip.active === "true" && !active) {
    await page.screenshot({ path: `${outDir}/slipstream-active.png` });
    console.log("active", JSON.stringify(chip));
    active = true;
  }
  if (chip && chip.locked === "true") {
    const file = `${outDir}/slipstream-lock-${locks}.png`;
    await page.screenshot({ path: file });
    shots.push({ file, ...chip });
    console.log("lock", locks, JSON.stringify(chip));
    locks += 1;
    // Space the burst so the six frames are six different moments in the tow.
    await page.waitForTimeout(220);
    continue;
  }
  await page.waitForTimeout(16);
}
writeFileSync(`${outDir}/slipstream.json`, JSON.stringify(shots, null, 2));
if (!active) console.log("TIMEOUT: the chip never lit");
await browser.close();
