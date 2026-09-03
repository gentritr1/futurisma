// Screenshots the HUD the moment the SLIPSTREAM chip is lit, and again while
// it reads LOCK. Polls `#futurisma-diagnostics`, which refreshes at ~1 Hz, and
// falls back to reading the chip's own dataset every frame so a short tow is
// not missed between diagnostics ticks.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const url = process.argv[2];
const outDir = process.argv[3] || "shots/slipstream";
const browser = await chromium.launch({
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
await page.goto(url, { waitUntil: "networkidle" });
mkdirSync(outDir, { recursive: true });

const readChip = () => page.evaluate(() => {
  const chip = document.getElementById("slipstream-chip");
  const fill = document.getElementById("slipstream-fill");
  return chip
    ? {
      active: chip.dataset.active,
      locked: chip.dataset.locked,
      label: chip.textContent?.trim().split("\n")[0] ?? "",
      transform: fill?.style.transform ?? "",
      speed: document.getElementById("speed-value")?.textContent ?? "",
    }
    : null;
});

let active = false;
let locked = false;
const deadline = Date.now() + 200_000;
while (Date.now() < deadline && !(active && locked)) {
  const chip = await readChip();
  if (chip && chip.active === "true" && !active) {
    await page.screenshot({ path: `${outDir}/slipstream-active.png` });
    console.log("active", JSON.stringify(chip));
    active = true;
  }
  if (chip && chip.locked === "true" && !locked) {
    await page.screenshot({ path: `${outDir}/slipstream-lock.png` });
    console.log("lock", JSON.stringify(chip));
    locked = true;
  }
  await page.waitForTimeout(16);
}
if (!active) console.log("TIMEOUT: the chip never lit");
await browser.close();
