// P20.5 frame-layer probe (review harness, not part of the shipped game).
//
// Three of the P20.5 acceptance criteria are about ONE layer of the frame and
// cannot be read off the composite:
//
//   * "the upper sky is darker than the horizon band, and the horizon band is
//     not darker than the ground" — in the off-road gutters of a real frame
//     those rows are full of works structures, which is what the number ends up
//     measuring.
//   * "the cloud band has structure" — same problem, plus the vertical gradient.
//   * "the speed lines stopped reading as near-white scratches" — the streaks
//     are thin and additive and share the frame with everything else.
//
// So this freezes one frame and renders it three times with different layers
// switched on. Nothing in the world moves between them, so the differences are
// exactly the layer:
//
//   full        the frame as shipped
//   sky-only    every object hidden except the sky dome
//   sky-nocloud the same dome with the cloud contrast set to zero
//   no-streaks  the camera's speed-line LineSegments hidden
//
// sky-only minus sky-nocloud is the cloud band's OWN contribution, which is the
// only honest way to measure its contrast: the detrended peak-to-peak of a bare
// upper-sky crop is 11-17 luma on a build with NO clouds at all, because the
// dome is a sphere and a row of pixels off-centre is also a slow elevation ramp.
// Differencing two renders of one frozen pose removes the curvature, the
// gradient and the dither together.
//
// Needs the same temporary `window.__fx` hook shadow-caster-probe.mjs
// documents, added after the renderer.render call in game.ts.
//
// The speed gate matters more than the distance one for anything that measures
// the speed lines: their opacity ramp is speed-driven, so two frames from the
// same metre at 270 and 317 km/h are not comparable. Pass `speed=<kph>` and a
// station only fires within 3 km/h of it.
//
// Usage: node scripts/visual/frame-layers.mjs <url> <outDir> [speed=<kph>] <station-metres...>
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const url = process.argv[2];
const outDir = process.argv[3] || "shots/p20.5/layers";
const rest = process.argv.slice(4);
const speedArgument = rest.find((value) => value.startsWith("speed="));
const targetSpeed = speedArgument ? Number(speedArgument.slice(6)) : null;
const stations = rest.filter((value) => !value.startsWith("speed=")).map(Number);

const browser = await chromium.launch({
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 400)));
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
mkdirSync(outDir, { recursive: true });

const readDiag = () =>
  page.evaluate(() => {
    const el = document.getElementById("futurisma-diagnostics");
    try {
      const c = JSON.parse(el.textContent || "{}").current || {};
      return { d: c.distanceMeters, phase: c.phase, sector: c.sector, v: c.speedKph };
    } catch {
      return null;
    }
  });

const captured = [];
const pending = new Set(stations);
const deadline = Date.now() + 300_000;
while (pending.size > 0 && Date.now() < deadline) {
  const diag = await readDiag();
  if (diag && diag.phase === "running" && typeof diag.d === "number") {
    let hit = null;
    for (const station of pending) {
      if (diag.d < station || diag.d >= station + 45) continue;
      if (targetSpeed !== null && Math.abs((diag.v ?? 0) - targetSpeed) > 3) continue;
      hit = station;
    }
    if (hit !== null) {
      pending.delete(hit);
      const tag = String(hit).padStart(4, "0");
      // Freeze: the game reschedules itself through rAF, so a no-op rAF ends the
      // loop and every render below draws the identical world state.
      await page.evaluate(() => {
        // Park the game's next frame instead of dropping it: the loop schedules
        // itself from inside its own callback, so a no-op rAF stops it for good
        // and there is nothing left to restart. Holding the callback lets the
        // run continue to the next station after the layers are captured.
        window.__rafSaved = window.requestAnimationFrame.bind(window);
        window.__pendingRaf = null;
        window.requestAnimationFrame = (callback) => {
          window.__pendingRaf = callback;
          return 0;
        };
      });
      await page.waitForTimeout(150);
      const shoot = async (name, mode) => {
        await page.evaluate((m) => {
          const fx = window.__fx;
          if (!window.__shown) {
            window.__shown = [];
            fx.s.traverse((o) => window.__shown.push([o, o.visible]));
            fx.c.traverse((o) => window.__shown.push([o, o.visible]));
          }
          for (const [object, visible] of window.__shown) object.visible = visible;
          if (m === "sky-only") {
            for (const child of fx.s.children) {
              child.visible = child.name === "sky_backdrop";
            }
            fx.c.traverse((o) => {
              if (o !== fx.c) o.visible = false;
            });
          }
          if (m === "sky-nocloud") {
            for (const child of fx.s.children) {
              child.visible = child.name === "sky_backdrop";
              if (child.name !== "sky_backdrop") continue;
              const shape = child.material.uniforms.cloudShape.value;
              window.__cloudStrength = shape.z;
              shape.z = 0;
            }
            fx.c.traverse((o) => {
              if (o !== fx.c) o.visible = false;
            });
          } else if (window.__cloudStrength !== undefined) {
            fx.s.traverse((o) => {
              if (o.name !== "sky_backdrop") return;
              o.material.uniforms.cloudShape.value.z = window.__cloudStrength;
            });
          }
          if (m === "no-streaks") {
            fx.c.traverse((o) => {
              if (o.isLineSegments) o.visible = false;
            });
          }
          fx.r.render(fx.s, fx.c);
        }, mode);
        await page.screenshot({ path: `${outDir}/st-${tag}-${name}.png` });
      };
      await shoot("full", "full");
      await shoot("sky-only", "sky-only");
      await shoot("sky-nocloud", "sky-nocloud");
      await shoot("no-streaks", "no-streaks");
      await page.evaluate(() => {
        for (const [object, visible] of window.__shown) object.visible = visible;
        window.requestAnimationFrame = window.__rafSaved;
        if (window.__pendingRaf) window.requestAnimationFrame(window.__pendingRaf);
      });
      captured.push({ station: hit, ...diag });
      console.log(`st ${hit} d=${diag.d} ${diag.sector} -> 3 layers`);
    }
  }
  await page.waitForTimeout(40);
}
if (pending.size > 0) console.log(`MISSED ${[...pending].join(", ")}`);
writeFileSync(`${outDir}/layers.json`, JSON.stringify(captured, null, 2));
await browser.close();
