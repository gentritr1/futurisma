// P20.8 pinned-pose shooter (review harness, not part of the shipped game).
//
// shoot-stations.mjs polls a 1 Hz diagnostics line, so the craft is anywhere in
// a 110 m window when the shutter fires; two builds shot that way cannot be
// diffed per pixel. This spawns the craft at an EXACT course distance with the
// boundary-hold probe, never starts the race, and adds `motion=reduce`, which
// game.ts passes to LivingWorld.update as `advanceMotion = false` — the card
// clock stops, the atmosphere clock stops, and every frame after settling is
// the same frame. Two builds shot at the same pose are then comparable per
// pixel, and the run's own repeat shot is the control noise for that claim.
//
// Usage:
//   node scripts/visual/shoot-poses.mjs <urlBase> <outDir> <d1,d2,...> [lateral] [repeats]
//
// <urlBase> is everything before the probe parameters, e.g.
//   "http://127.0.0.1:5210/?map=bitterpan&diagnostics=1"
// Extra parameters (e.g. &living=0) can be appended to it and are preserved.
//
// Output: <outDir>/pose-<metres>.png, plus -r<n>.png for each repeat, and
// poses.json with the diagnostics line each shutter fired on.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const urlBase = process.argv[2];
const outDir = process.argv[3] || "shots/poses";
const distances = (process.argv[4] || "310").split(",").map(Number);
const lateral = Number(process.argv[5] ?? 0);
const repeats = Number(process.argv[6] ?? 0);
// "reduce" (default) adds `motion=reduce`, which stops the card clock and makes
// two builds comparable per pixel. "live" leaves it out: the pose is still
// pinned — the probe holds the race in standby and the craft does not move —
// but the cards animate, so a burst of repeats samples the alpha ENVELOPES
// instead of freezing them at one arbitrary phase. Use "live" for any census
// that asks "is this layer visible", and "reduce" for any A/B.
const motionMode = process.argv[7] ?? "reduce";

const SETTLE_MS = 5000;

const browser = await chromium.launch({
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
mkdirSync(outDir, { recursive: true });
const results = [];

for (const distance of distances) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
  page.on("console", (m) => {
    if (m.type() === "error") console.log("[console.error]", m.text().slice(0, 300));
  });
  const url = `${urlBase}&probe=boundary-hold&probeDistance=${distance}`
    + `&probeLateral=${lateral}`
    + (motionMode === "reduce" ? "&motion=reduce" : "");
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(SETTLE_MS);
  // The probe holds the race in `standby`, which is what pins the pose — and
  // standby is also when the dispatch panel covers the left half of the frame.
  // Hiding the HUD and the dispatch panel uncovers the frame the renderer
  // already drew; none of it is part of the WebGL render.
  //
  // `.image-treatment` IS KEPT, and that is not an oversight. It is a DOM layer
  // but it is a SHIPPED one — the image pipeline's grade sits on top of the
  // canvas, and hiding it moves the world crop's mean luma by +36.9 (measured:
  // shots/p20.8/ctrl-nochrome vs the same pose with it in place). Measuring the
  // living-world layer through anything other than the grade the player sees
  // would be measuring a different game.
  await page.evaluate(() => {
    for (const node of document.querySelectorAll("#app > *")) {
      if (node.id === "game-canvas") continue;
      if (node.classList.contains("image-treatment")) continue;
      node.style.display = "none";
    }
  });
  await page.waitForTimeout(400);
  const name = `${outDir}/pose-${String(distance).padStart(4, "0")}`;
  await page.screenshot({ path: `${name}.png` });
  for (let repeat = 1; repeat <= repeats; repeat += 1) {
    await page.waitForTimeout(900);
    if (motionMode === "live") {
      // THE CARD CLOCK RUNS IN STANDBY BUT THE RENDERER DOES NOT.
      //
      // `shouldRenderGameFrame` skips the draw when the craft is not moving and
      // nothing has asked for a frame, so a burst of screenshots at a held pose
      // returns the SAME frame every time — one arbitrary phase of every alpha
      // envelope, not a sample of them. `LivingWorld.update` is still called
      // every frame, so `elapsedSeconds` has moved; only the picture has not.
      //
      // A viewport nudge and back sets `renderRequested`, which forces one
      // fresh draw at the current card phase and returns the camera to exactly
      // the pose it held. Verified: with `?living=0` — the same nudge, the same
      // waits, no card layer — every frame of the burst is byte-identical, so
      // the nudge itself moves nothing.
      await page.setViewportSize({ width: 1281, height: 720 });
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.waitForTimeout(120);
    }
    await page.screenshot({ path: `${name}-r${repeat}.png` });
  }
  const diag = await page.evaluate(() => {
    const el = document.getElementById("futurisma-diagnostics");
    if (!el) return null;
    try {
      const c = JSON.parse(el.textContent || "{}").current || {};
      return {
        d: c.distanceMeters,
        phase: c.phase,
        v: c.speedKph,
        calls: c.calls,
        tris: c.triangles,
        sector: c.sector,
        livingCalls: c.livingWorld?.drawCalls,
        livingCards: c.livingWorld?.cards,
        visibleCards: c.livingWorld?.visibleCards,
      };
    } catch {
      return null;
    }
  });
  console.log(`pose ${distance} ${JSON.stringify(diag)}`);
  results.push({ distance, lateral, url, file: `${name}.png`, ...diag });
  await page.close();
}

writeFileSync(`${outDir}/poses.json`, JSON.stringify(results, null, 2));
console.log(`${results.length} poses -> ${outDir}`);
await browser.close();
