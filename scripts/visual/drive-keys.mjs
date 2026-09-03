// Review harness: a keyboard-driven lap. Holds W from the start; holds an extra
// key from distance `steerFrom` on; screenshots every `stepMs` between two distances.
// Usage: node scripts/visual/drive-keys.mjs <url> <outDir> <steerKey> <steerFrom> <shotFrom> <shotTo> [stepMs]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const [url, outDir, steerKey, steerFrom, shotFrom, shotTo] = [process.argv[2], process.argv[3], process.argv[4], Number(process.argv[5]), Number(process.argv[6]), Number(process.argv[7])];
const stepMs = Number(process.argv[8] || 250);
const browser = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 200)));
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
mkdirSync(outDir, { recursive: true });
await page.click("#start-button").catch(() => page.evaluate(() => document.getElementById("start-button")?.click()));
await page.waitForTimeout(500);
await page.keyboard.down("KeyW");
const read = () => page.evaluate(() => { try { const c = JSON.parse(document.getElementById("futurisma-diagnostics")?.textContent || "{}").current || {}; return { d: c.distanceMeters, lat: c.lateralMeters, v: c.speedKph, sector: c.sector, phase: c.phase, apron: c.onApron, grip: c.surfaceGrip }; } catch { return null; } });
let steering = false, shots = 0, last = null;
for (let i = 0; i < 1200; i++) {
  const r = await read();
  if (r && r.phase === "running") {
    if (!steering && r.d >= steerFrom) { await page.keyboard.down(steerKey); steering = true; console.log("steer on at", r.d); }
    if (r.d >= shotFrom && r.d <= shotTo) {
      await page.screenshot({ path: `${outDir}/s${String(shots).padStart(2, "0")}.png` }); shots++;
      console.log(`shot ${shots}`, JSON.stringify(r));
      await page.waitForTimeout(stepMs); continue;
    }
    if (r.d > shotTo) break;
    last = r;
  }
  await page.waitForTimeout(40);
}
console.log("done", shots, "shots", JSON.stringify(last));
await browser.close();
