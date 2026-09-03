// Long-soak diagnostics dump (not part of the shipped game).
//
// `diag.mjs` waits for a corridor sweep and gives up after 60 s. This one waits
// for the race itself to finish, which a five-lap run needs about 185 s
// (Bitterpan) to 200 s (Greenwater) of wall clock to do, and prints the last
// `#futurisma-diagnostics` line either way.
//
// Usage: node scripts/visual/diag-long.mjs <url>
//   e.g. "http://127.0.0.1:5205/?map=bitterpan&laps=5&demo=1&diagnostics=1&headless=1"
import { chromium } from "playwright";

const url = process.argv[2];
const browser = await chromium.launch({
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
page.on("console", (m) => {
  if (m.type() === "error") console.log("[console.error]", m.text().slice(0, 300));
});
await page.goto(url, { waitUntil: "networkidle" });

let last = "";
for (let index = 0; index < 340; index += 1) {
  await page.waitForTimeout(1000);
  const text = await page.evaluate(() => {
    const element = document.getElementById("futurisma-diagnostics");
    return element ? element.textContent || "" : "";
  });
  if (text && text !== last) last = text;
  let done = false;
  try {
    const parsed = JSON.parse(last || "{}").current || {};
    done = parsed.phase === "finished"
      && Array.isArray(parsed.finalClassification)
      && parsed.finalClassification.length > 0;
  } catch { /* the diagnostics line is not JSON yet */ }
  if (done) {
    console.log(last);
    break;
  }
  if (index === 339) console.log("TIMEOUT, last diagnostics:\n" + last);
}
await browser.close();
