// Review harness: load a probe URL, press start, screenshot at given race-times.
// Usage: node scripts/visual/probe-drive.mjs <url> <outPrefix> <t1,t2,...>
import { chromium } from "playwright";
const [url, prefix, times] = [process.argv[2], process.argv[3], (process.argv[4] || "4,6").split(",").map(Number)];
const browser = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 200)));
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.evaluate(() => document.getElementById("start-button")?.click());
const read = () => page.evaluate(() => { try { const c = JSON.parse(document.getElementById("futurisma-diagnostics")?.textContent || "{}").current || {}; return { t: (c.elapsedMs ?? 0) / 1000, d: c.distanceMeters, lat: c.lateralMeters, v: c.speedKph, sector: c.sector, phase: c.phase, apron: c.onApron, grip: c.surfaceGrip, hover: c.hoverHeightMeters ?? c.hover ?? null }; } catch { return null; } });
for (const t of times) {
  for (let i = 0; i < 400; i++) { const r = await read(); if (r && r.phase === "running" && r.t >= t) break; await page.waitForTimeout(50); }
  await page.screenshot({ path: `${prefix}-t${t}.png` });
  console.log(`t${t}`, JSON.stringify(await read()));
}
await browser.close();
