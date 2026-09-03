// P20.5 sun-disc occlusion test (review harness, not part of the shipped game).
//
// The shipped disc rides `keyDirection`, which on both maps sits 56-74 degrees
// above the horizon — far outside a chase camera's frame — so it never draws
// and "is it occluded?" cannot be answered by looking at a normal frame. This
// forces the question: it freezes a frame inside GREENWATER's HANGAR_SIX shell,
// moves the disc to a point straight down the view axis and BEHIND the shell
// wall, and renders three variants of that same frozen frame:
//
//   forced-on             disc where the wall should hide it
//   forced-off            disc hidden
//   forced-no-depth-test  disc with depthTest disabled
//
// forced-on == forced-off  => the wall occludes the disc (depth test works).
// forced-on == forced-no-depth-test, both != forced-off => the leak is real.
//
// Needs the temporary `window.__fx` hook documented in shadow-caster-probe.mjs.
//
// Usage: node scripts/visual/sun-disc-occlusion.mjs <url> <sector> <outDir>
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const url = process.argv[2];
const wantSector = process.argv[3] || "HANGAR SIX";
const outDir = process.argv[4] || "shots/p20.5/sun-occlusion";

const browser = await chromium.launch({
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 400)));
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
mkdirSync(outDir, { recursive: true });

const deadline = Date.now() + 120_000;
let at = null;
while (Date.now() < deadline) {
  at = await page.evaluate(() => {
    const el = document.getElementById("futurisma-diagnostics");
    try {
      const c = JSON.parse(el.textContent || "{}").current || {};
      return { d: c.distanceMeters, sector: c.sector, phase: c.phase };
    } catch {
      return null;
    }
  });
  if (at && at.phase === "running" && at.sector === wantSector) break;
  await page.waitForTimeout(40);
}
console.log("frozen at", JSON.stringify(at));

await page.evaluate(() => {
  window.requestAnimationFrame = () => 0;
});
await page.waitForTimeout(200);

// Two builds, one test. Before P20.5 the sun was a `sun_disc` mesh that could
// be moved and hidden; after it, it is a term in the dome's fragment shader
// aimed by the `sunDirection` uniform and switched off by `sunShape.z`. Both
// are forced to look straight down the view axis, where the shell wall is.
const placement = await page.evaluate(() => {
  const fx = window.__fx;
  let disc = null;
  let dome = null;
  fx.s.traverse((o) => {
    if (o.name === "sun_disc") disc = o;
    if (o.name === "sky_backdrop") dome = o;
  });
  const V = fx.c.position.constructor;
  const forward = fx.c.getWorldDirection(new V());
  window.__forcedDir = forward.clone();
  window.__mode = disc ? "mesh" : "shader";
  if (disc) {
    // 300 m straight ahead: inside the shell that is 30-60 m away, so anything
    // with a depth test on cannot show through it.
    const target = fx.c.position.clone().addScaledVector(forward, 300);
    window.__forcedSun = target;
    disc.position.copy(target);
    disc.lookAt(fx.c.position);
    disc.updateMatrixWorld(true);
    const ndc = target.clone().project(fx.c);
    return { mode: "mesh", ndc: [ndc.x, ndc.y, ndc.z].map((v) => Number(v.toFixed(3))) };
  }
  const u = dome.material.uniforms;
  window.__sunShape = u.sunShape.value.clone();
  u.sunDirection.value.copy(forward);
  return {
    mode: "shader",
    sunShape: [u.sunShape.value.x, u.sunShape.value.y, u.sunShape.value.z],
    direction: [forward.x, forward.y, forward.z].map((v) => Number(v.toFixed(3))),
  };
});
console.log("forced sun:", JSON.stringify(placement));

// `sun` says whether the sun is drawn at all; `overlay` draws it over the whole
// frame regardless of depth, which is how the disc's FULL footprint is measured.
// forced-on vs forced-off  = what the sun actually contributes to the frame.
// overlay-on vs overlay-off = what it would contribute if nothing occluded it.
const shoot = async (name, sun, overlay) => {
  await page.evaluate(({ sunOn, over }) => {
    const fx = window.__fx;
    if (window.__mode === "mesh") {
      fx.s.traverse((o) => {
        if (o.name !== "sun_disc") return;
        o.visible = sunOn;
        o.material.depthTest = !over;
        o.material.needsUpdate = true;
        o.position.copy(window.__forcedSun);
        o.lookAt(fx.c.position);
        o.updateMatrixWorld(true);
      });
    } else {
      fx.s.traverse((o) => {
        if (o.name !== "sky_backdrop") return;
        const u = o.material.uniforms;
        u.sunDirection.value.copy(window.__forcedDir);
        u.sunShape.value.z = sunOn ? window.__sunShape.z : 0;
        // The shader sun is painted WITH the dome, before anything else in the
        // frame. Drawing the dome last with no depth test is the equivalent of
        // the old mesh's "nothing can stop me", so the two builds are compared
        // like for like — but it moves the whole sky too, which is why the
        // overlay pair is differenced against its own sun-off twin rather than
        // against the in-order frame.
        o.renderOrder = over ? 9999 : -1000;
        o.material.depthTest = !over;
        o.material.needsUpdate = true;
      });
    }
    fx.r.render(fx.s, fx.c);
  }, { sunOn: sun, over: overlay });
  await page.screenshot({ path: `${outDir}/${name}.png` });
};
await shoot("forced-on", true, false);
await shoot("forced-off", false, false);
await shoot("overlay-on", true, true);
await shoot("overlay-off", false, true);
await shoot("forced-on", true, false);
// Fourth variant: no disc AND no dome. Every pixel that is NOT geometry falls
// back to the clear colour, which is what tells a leak ("the disc drew over a
// wall") apart from correct behaviour ("the disc drew in a gap of open sky").
await page.evaluate(() => {
  const fx = window.__fx;
  fx.s.traverse((o) => {
    if (o.name === "sky_backdrop") o.visible = false;
    if (o.name === "sun_disc") o.visible = false;
  });
  fx.s.background = null;
  fx.r.setClearColor(0xff00ff, 1);
  fx.r.render(fx.s, fx.c);
});
await page.screenshot({ path: `${outDir}/geometry-only.png` });
console.log(`wrote 3 forced variants to ${outDir}`);
await browser.close();
