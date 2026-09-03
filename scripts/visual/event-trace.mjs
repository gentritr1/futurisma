// G3 — per-second trace of the live track event state during a soak.
// Usage: node scripts/visual/event-trace.mjs <url> <seconds>
import { chromium } from "playwright";

const url = process.argv[2];
const seconds = Number(process.argv[3] ?? 200);
const browser = await chromium.launch({
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
await page.goto(url, { waitUntil: "networkidle" });

for (let index = 0; index < seconds; index += 1) {
  await page.waitForTimeout(1000);
  const text = await page.evaluate(() => {
    const el = document.getElementById("futurisma-diagnostics");
    return el ? el.textContent || "" : "";
  });
  if (!text) continue;
  let c;
  try { c = JSON.parse(text).current; } catch { continue; }
  console.log(JSON.stringify({
    t: index,
    d: c.distanceMeters,
    grip: c.surfaceGrip,
    minGrip: c.minimumSurfaceGrip,
    gust: c.gustNow,
    salt: c.saltNow,
    squall: c.squallNow,
    chip: c.trackEventChip,
    gusts: c.gusts,
    lat: c.lateralMeters,
    gustM: c.gustLateralMetres,
    calls: c.calls,
    phase: c.phase,
  }));
  if (c.phase === "finished") break;
}
await browser.close();
