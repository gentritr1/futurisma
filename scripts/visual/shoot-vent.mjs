// H3 review harness: park the craft on the LINK_APRON approach to Hangar Six
// and shoot a burst while the HZ_STEAM_1 vent cycles.
// Usage: node vent-burst.mjs <base> <outDir> <count> <stepMs> [extraQuery] [leadMs]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const [base, outDir] = [process.argv[2], process.argv[3]];
const count = Number(process.argv[4] ?? 8);
const stepMs = Number(process.argv[5] ?? 250);
const extra = process.argv[6] ?? "";
const leadMs = Number(process.argv[7] ?? 1800);
const spawnDistance = Number(process.argv[8] ?? 560);
const spawnLateral = Number(process.argv[9] ?? 0);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
page.on("console", (m) => { if (m.type() === "error") console.log("[console]", m.text().slice(0, 200)); });
const url = `${base}/?diagnostics=1&autostart=1&probe=boundary-hold`
  + `&probeDistance=${spawnDistance}&probeLateral=${spawnLateral}${extra}`;
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForSelector("#start-button", { timeout: 60000 });
await page.waitForTimeout(1500);
for (let a = 0; a < 40; a += 1) {
  const p = await page.evaluate(() => { try { return JSON.parse(document.getElementById("futurisma-diagnostics")?.textContent || "{}").current?.phase ?? null; } catch { return null; } });
  if (p && p !== "standby") break;
  await page.evaluate(() => document.getElementById("start-button")?.click());
  await page.waitForTimeout(400);
}
await page.waitForTimeout(leadMs);
const rows = [];
for (let i = 0; i < count; i += 1) {
  const read = await page.evaluate(() => {
    try {
      const c = JSON.parse(document.getElementById("futurisma-diagnostics")?.textContent || "{}").current || {};
      return { d: c.distanceMeters, lat: c.lateralMeters, v: c.speedKph, phase: c.phase, calls: c.calls, tris: c.triangles, p95: c.p95FrameMs };
    } catch { return null; }
  });
  const file = `${outDir}/f${String(i).padStart(2, "0")}.png`;
  await page.screenshot({ path: file });
  rows.push({ i, file, ...read });
  console.log(i, JSON.stringify(read));
  await page.waitForTimeout(stepMs);
}
writeFileSync(`${outDir}/shots.json`, `${JSON.stringify(rows, null, 2)}\n`);
await browser.close();
