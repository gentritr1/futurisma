// P20.5 cloud band probe (review harness, not part of the shipped game).
//
// Two things have to be true of the procedural cloud band and neither can be
// read off a moving frame: it must have STRUCTURE (a flat gradient does not),
// and it must DRIFT with motion on and be frozen with motion reduced. A chase
// camera rotates, and the band is locked to world azimuth, so two frames from a
// moving car differ whether or not the clouds moved.
//
// So this parks the car. `demo=1` is the only thing that starts a race without
// a click, so the run starts under autopilot, then presses the brake once: a
// player control intent drops the autopilot (`resolveRaceInput` in game.ts),
// every key is released, and drag brings the craft to a stop. The phase stays
// `running`, so `phaseRunsContinuousPresentation` keeps the renderer drawing
// every frame — from a camera that is no longer moving. Two screenshots two
// seconds apart then differ only where something in the world animated, and
// inside a crop of empty upper sky that is the cloud band.
//
// Structure is measured DETRENDED: each row's mean is subtracted before the
// stdev. The dome is a vertical gradient, so an 80-row crop of even a perfectly
// flat sky scores 10-16 raw; the residual after removing the vertical ramp is
// the horizontal structure, which is what a cloud is.
//
// Usage: node scripts/visual/cloud-drift.mjs <url> <outDir> [crop x,y,w,h]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const url = process.argv[2];
const outDir = process.argv[3] || "shots/p20.5/cloud-drift";
const crop = (process.argv[4] || "440,150,200,80").split(",").map(Number);

const browser = await chromium.launch({
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 400)));
await page.goto(url, { waitUntil: "networkidle" });
mkdirSync(outDir, { recursive: true });

const deadline = Date.now() + 90_000;
let diag = null;
while (Date.now() < deadline) {
  diag = await page.evaluate(() => {
    const el = document.getElementById("futurisma-diagnostics");
    try {
      const c = JSON.parse(el.textContent || "{}").current || {};
      return { d: c.distanceMeters, phase: c.phase, v: c.speedKph, sky: c.atmosphere?.sky };
    } catch {
      return null;
    }
  });
  if (diag && diag.phase === "running") break;
  await page.waitForTimeout(100);
}
// Drop the autopilot with one brake tap, then coast to a standstill.
await page.evaluate(() => document.querySelector("canvas")?.focus());
await page.keyboard.down("ArrowDown");
await page.waitForTimeout(700);
await page.keyboard.up("ArrowDown");
const stopBy = Date.now() + 40_000;
while (Date.now() < stopBy) {
  diag = await page.evaluate(() => {
    const el = document.getElementById("futurisma-diagnostics");
    try {
      const c = JSON.parse(el.textContent || "{}").current || {};
      return { d: c.distanceMeters, phase: c.phase, v: c.speedKph, sky: c.atmosphere?.sky };
    } catch {
      return null;
    }
  });
  if (diag && diag.v !== undefined && diag.v < 0.5) break;
  await page.waitForTimeout(250);
}
// Let the chase camera settle onto a stationary craft before the first frame.
await page.waitForTimeout(3000);
console.log("parked:", JSON.stringify(diag));

await page.screenshot({ path: `${outDir}/t0.png`, clip: { x: crop[0], y: crop[1], width: crop[2], height: crop[3] } });
await page.screenshot({ path: `${outDir}/t0-full.png` });
await page.waitForTimeout(2000);
await page.screenshot({ path: `${outDir}/t2.png`, clip: { x: crop[0], y: crop[1], width: crop[2], height: crop[3] } });
const after = await page.evaluate(() => {
  const el = document.getElementById("futurisma-diagnostics");
  try {
    const c = JSON.parse(el.textContent || "{}").current || {};
    return { d: c.distanceMeters, v: c.speedKph, sky: c.atmosphere?.sky };
  } catch {
    return null;
  }
});
console.log("after 2 s:", JSON.stringify(after));
console.log(`wrote ${outDir}/t0.png, ${outDir}/t2.png (crop ${crop.join(",")})`);
await browser.close();
