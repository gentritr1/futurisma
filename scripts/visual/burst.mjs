// Visual review harness (not part of the shipped game).
// A plain frame burst between two race times, for A/B-ing a transient artifact.
// Usage: node scripts/visual/burst.mjs <url> <outDir> <fromSeconds> <count> <stepMs>
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const url = process.argv[2];
const outDir = process.argv[3];
const from = Number(process.argv[4]);
const count = Number(process.argv[5] ?? 8);
const stepMs = Number(process.argv[6] ?? 55);

const browser = await chromium.launch({
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(url, { waitUntil: "networkidle" });
mkdirSync(outDir, { recursive: true });

const raceSeconds = () => page.evaluate(() => {
  const el = document.getElementById("futurisma-diagnostics");
  try {
    const c = JSON.parse(el?.textContent || "{}").current ?? {};
    return c.phase === "running" ? (c.elapsedMs ?? 0) / 1000 : -1;
  } catch { return -1; }
});

// `elapsedMs` is not in the report, so fall back to the HUD clock.
const hudSeconds = () => page.evaluate(() => {
  const text = document.getElementById("time-value")?.textContent ?? "";
  const m = /(\d+):(\d+)\.(\d+)/.exec(text);
  return m ? Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 1000 : -1;
});

for (;;) {
  await page.waitForTimeout(20);
  const t = await hudSeconds();
  if (t >= from) break;
  if (t < 0 && (await raceSeconds()) < 0) continue;
}
for (let i = 0; i < count; i += 1) {
  await page.screenshot({ path: `${outDir}/f${i}.png` });
  await page.waitForTimeout(stepMs);
}
console.log("burst done at", await hudSeconds());
await browser.close();
