// P21 review harness (not part of the shipped game).
//
// Parks the craft at a chosen station and lateral with the boundary-hold probe
// (20 m/s, so a 60 m run is three seconds) and screenshots every `stepMs` while
// it passes the station. That is how a census row is turned into something a
// person can look at: the row says "solid geometry at 848 m, lateral +12.85,
// 0.78 m tall", and the sheet says whether that is a rail the craft flies
// through or the ground rising under it.
//
// Usage: node scripts/visual/shoot-corridor.mjs <base> <outDir> <map> <spec...>
//   spec: distance:lateral[:label]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const [base, outDir, map] = [process.argv[2], process.argv[3], process.argv[4]];
// Any argument beginning with "&" is extra query string (e.g. "&panfix=a").
const rest = process.argv.slice(5);
const extraQuery = rest.filter((raw) => raw.startsWith("&")).join("");
const specs = rest.filter((raw) => !raw.startsWith("&")).map((raw) => {
  const [distance, lateral, label] = raw.split(":");
  return { distance: Number(distance), lateral: Number(lateral), label: label || raw };
});
const LEAD_METRES = 45;
const STEP_MS = 220;
const SHOTS = 12;

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const log = [];
for (const spec of specs) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 200)));
  const url = `${base}/?diagnostics=1&autostart=1&probe=boundary-hold`
    + `&probeDistance=${Math.max(0, spec.distance - LEAD_METRES)}`
    + `&probeLateral=${spec.lateral}`
    + (map === "bitterpan" ? "&map=bitterpan" : "")
    + extraQuery;
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.click("#start-button").catch(() => page.evaluate(
    () => document.getElementById("start-button")?.click(),
  ));
  await page.waitForTimeout(1200);
  for (let shot = 0; shot < SHOTS; shot += 1) {
    const read = await page.evaluate(() => {
      try {
        const current = JSON.parse(
          document.getElementById("futurisma-diagnostics")?.textContent || "{}",
        ).current || {};
        return {
          d: current.distanceMeters,
          lat: current.lateralMeters,
          v: current.speedKph,
          phase: current.phase,
        };
      } catch { return null; }
    });
    const file = `${outDir}/${spec.label}-${String(shot).padStart(2, "0")}.png`;
    await page.screenshot({ path: file });
    log.push({ ...spec, shot, file, ...read });
    await page.waitForTimeout(STEP_MS);
  }
  console.log(spec.label, JSON.stringify(log.filter((row) => row.label === spec.label)
    .map((row) => `${Math.round(row.d)}@${row.lat?.toFixed?.(1)}`)));
  await page.close();
}
writeFileSync(`${outDir}/shots.json`, `${JSON.stringify(log, null, 2)}\n`);
await browser.close();
