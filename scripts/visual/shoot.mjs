// Visual review harness (not part of the shipped game).
// Time-based burst: N screenshots at a fixed interval, with the diagnostics
// line per shot. For motion checks (shimmer, crawl); use shoot-stations.mjs
// when frames must be comparable between builds.
// Usage: node scripts/visual/shoot.mjs <url> <outDir> [count] [intervalMs]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const url = process.argv[2];
const outDir = process.argv[3] || "shots/burst";
const count = Number(process.argv[4] || 8);
const interval = Number(process.argv[5] || 3000);

const browser = await chromium.launch({
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("console", (m) => {
  if (m.type() === "error") console.log("[console.error]", m.text().slice(0, 300));
});
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
mkdirSync(outDir, { recursive: true });

for (let i = 0; i < count; i++) {
  await page.screenshot({ path: `${outDir}/shot-${String(i).padStart(2, "0")}.png` });
  const diag = await page.evaluate(() => {
    const el = document.getElementById("futurisma-diagnostics");
    if (!el) return "";
    try {
      const c = (JSON.parse(el.textContent || "{}")).current || {};
      return `d=${c.distanceMeters} sector=${c.sector} v=${c.speedKph} lat=${c.lateralMeters} phase=${c.phase}`;
    } catch { return ""; }
  });
  console.log(`shot ${i} ${diag}`);
  if (i < count - 1) await page.waitForTimeout(interval);
}
await browser.close();
