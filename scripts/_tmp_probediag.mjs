import { chromium } from "playwright";
const url = process.argv[2];
const browser = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 400)));
page.on("console", (m) => { if (m.type() === "error") console.log("[err]", m.text().slice(0, 300)); });
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(7000);
const out = await page.evaluate(() => {
  const el = document.getElementById("futurisma-diagnostics");
  const report = JSON.parse(el.textContent || "{}");
  const c = report.current || {};
  const keys = Object.keys(c).filter((k) => /living|phase|calls|distance/i.test(k));
  return Object.fromEntries(keys.map((k) => [k, c[k]]));
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
