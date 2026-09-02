// Shadow-pass draw counter (review harness, not part of the shipped game).
//
// `renderer.info.render.calls` CANNOT see the shadow pass: in three r184
// `shadowMap.render()` runs before `this.info.reset()` inside
// `WebGLRenderer.render`, so every `calls` figure in the diagnostics line and in
// docs/PERFORMANCE_BASELINE.md is the main pass only. This hooks
// `Object3D.onBeforeShadow` on every caster instead and counts what is actually
// rasterised into the shadow map, which is the number the amended draw-call
// ceiling in that document is built from.
//
// Needs one temporary line in game.ts, immediately after the renderer.render
// call in the frame loop, because the renderer and scene are otherwise private:
//
//   (window as any).__fx = { r: this.renderer, s: this.scene, c: this.camera };
//
// Remove it again before committing; validate-module-seams.mjs holds game.ts to
// a line budget and this probe is not worth one of them.
//
// Usage: node scripts/visual/shadow-caster-probe.mjs <url>
import { chromium } from "playwright";

const browser = await chromium.launch({
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 800)));
await page.goto(process.argv[2], { waitUntil: "networkidle" });
await page.waitForTimeout(11000);
const hooked = await page.evaluate(() => {
  if (!window.__fx) return false;
  window.__shadowHits = {};
  window.__fx.s.traverse((o) => {
    if (!o.isMesh || !o.castShadow) return;
    o.onBeforeShadow = () => {
      const key = o.name || "(unnamed)";
      window.__shadowHits[key] = (window.__shadowHits[key] || 0) + 1;
    };
  });
  return true;
});
if (!hooked) {
  await browser.close();
  throw new Error(
    "window.__fx is not present. Add the temporary hook described at the top of "
    + "this file to game.ts, reload, and run again — without it this probe "
    + "cannot see the shadow pass at all.",
  );
}
await page.waitForTimeout(1500);
const out = await page.evaluate(() => {
  const fx = window.__fx;
  let key = null;
  fx.s.traverse((o) => { if (o.isDirectionalLight && o.castShadow) key = o; });
  return {
    hits: window.__shadowHits,
    shadowMapUpdated: key ? !!key.shadow.map : null,
    shadowMatrix: key && key.shadow.matrix.elements.map((v) => Number(v.toFixed(4))),
  };
});
const hits = Object.values(out.hits);
const frames = hits.length > 0 ? Math.max(...hits) : 0;
const total = hits.reduce((sum, v) => sum + v, 0);
console.log(
  `${hits.length} distinct casters over ${frames} frames, ${total} shadow draws`
  + ` -> ${frames > 0 ? (total / frames).toFixed(1) : 0} draws/frame`,
);
console.log(JSON.stringify(out, null, 1));
await browser.close();
