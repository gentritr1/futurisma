import { chromium } from "playwright";
const url = process.argv[2];
const browser = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 400)));
await page.goto(url, { waitUntil: "networkidle" });
for (let i = 0; i < 60; i++) {
  const o = await page.evaluate(() => {
    const el = document.getElementById("futurisma-diagnostics");
    if (!el) return null;
    try {
      const c = JSON.parse(el.textContent || "{}").current || {};
      return [c.phase, c.distanceMeters, c.speedKph, c.livingWorldUpdateSteps, c.livingWorldVisibleCards];
    } catch { return null; }
  });
  console.log(i * 200, JSON.stringify(o));
  await page.waitForTimeout(200);
}
await browser.close();
