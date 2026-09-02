// Dump diagnostics line after corridor sweep runs.
// Usage: node scripts/diag.mjs <url>
import { chromium } from "playwright";

const url = process.argv[2];
const browser = await chromium.launch({
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
await page.goto(url, { waitUntil: "networkidle" });

let last = "";
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(1000);
  const text = await page.evaluate(() => {
    const el = document.getElementById("futurisma-diagnostics");
    return el ? el.textContent || "" : "";
  });
  if (text && text !== last) last = text;
  if (/corridorSweepRan[=:]1|corridorSweepRan[=:]true|"corridorSweepRan":1/.test(text)) {
    console.log(text);
    break;
  }
  if (i === 59) console.log("TIMEOUT, last diagnostics:\n" + last);
}
await browser.close();
