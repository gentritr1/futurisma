// P20.5 sun-disc occlusion sweep (review harness, not part of the shipped game).
//
// Drives a lap and, ~4x a second, asks where the additive sun disc actually is
// in clip space and whether opaque geometry stands between it and the camera.
// When it finds a frame where the disc is BOTH on screen AND behind something,
// it freezes the frame loop and renders three variants of that exact frame:
//
//   on            disc as shipped (depthTest true)
//   off           disc hidden        -> the diff against `on` is the disc's pixels
//   no-depth-test disc with depthTest false -> the disc's pixels if nothing occluded it
//
// `on == off` means the disc contributes nothing. `on == no-depth-test` with a
// non-empty diff against `off` means the depth test is NOT occluding it — the
// leak the brief describes. `on` smaller than `no-depth-test` means the depth
// test is doing its job.
//
// Needs the temporary `window.__fx` hook documented in shadow-caster-probe.mjs.
//
// Usage: node scripts/visual/sun-disc-sweep.mjs <url> <outDir>
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const url = process.argv[2];
const outDir = process.argv[3] || "shots/p20.5/sun-sweep";

const browser = await chromium.launch({
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 400)));
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
mkdirSync(outDir, { recursive: true });

const sample = () =>
  page.evaluate(() => {
    const fx = window.__fx;
    if (!fx) return { error: "no window.__fx" };
    let disc = null;
    fx.s.traverse((o) => {
      if (o.name === "sun_disc") disc = o;
    });
    if (!disc) return { error: "no sun_disc" };
    const V = disc.position.constructor;
    const world = disc.getWorldPosition(new V());
    const ndc = world.clone().project(fx.c);
    const dir = world.clone().sub(fx.c.position);
    const distance = dir.length();
    dir.normalize();
    let nearestOpaque = Infinity;
    let nearestName = null;
    fx.s.traverse((o) => {
      if (!o.isMesh || o === disc || o.name === "sky_backdrop" || !o.visible) return;
      const mat = o.material;
      if (!mat || mat.transparent || mat.depthWrite === false) return;
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      const c = o.geometry.boundingSphere.center.clone().applyMatrix4(o.matrixWorld);
      const e = o.matrixWorld.elements;
      const scale = Math.max(Math.abs(e[0]), Math.abs(e[5]), Math.abs(e[10])) || 1;
      const r = o.geometry.boundingSphere.radius * scale;
      const oc = c.clone().sub(fx.c.position);
      const t = oc.dot(dir);
      if (t <= 0) return;
      if (oc.clone().sub(dir.clone().multiplyScalar(t)).length() > r) return;
      const entry = t - r;
      if (entry < nearestOpaque && entry > 0) {
        nearestOpaque = entry;
        nearestName = o.name || "(unnamed)";
      }
    });
    const el = document.getElementById("futurisma-diagnostics");
    let d = null;
    let sector = null;
    try {
      const c = JSON.parse(el.textContent || "{}").current || {};
      d = c.distanceMeters;
      sector = c.sector;
    } catch { /* diagnostics not up yet */ }
    const onScreen = Math.abs(ndc.x) < 1.25 && Math.abs(ndc.y) < 1.25 && ndc.z < 1;
    return {
      d,
      sector,
      ndc: [ndc.x, ndc.y, ndc.z].map((v) => Number(v.toFixed(3))),
      onScreen,
      distance: Number(distance.toFixed(1)),
      nearestOpaque: Number.isFinite(nearestOpaque) ? Number(nearestOpaque.toFixed(1)) : null,
      nearestName,
    };
  });

const trace = [];
let found = null;
const deadline = Date.now() + 150_000;
while (Date.now() < deadline) {
  const s = await sample();
  if (s.error) {
    console.log(s.error);
    break;
  }
  if (s.d !== null) trace.push(s);
  if (!found && s.onScreen && s.nearestOpaque !== null && s.nearestOpaque < s.distance) {
    found = s;
    break;
  }
  await page.waitForTimeout(250);
}
writeFileSync(`${outDir}/trace.json`, JSON.stringify(trace, null, 1));
const onScreenSamples = trace.filter((s) => s.onScreen);
console.log(
  `${trace.length} samples, ${onScreenSamples.length} with the disc on screen`,
);
console.log("occluded-and-on-screen frame:", JSON.stringify(found));

if (found) {
  await page.evaluate(() => {
    window.requestAnimationFrame = () => 0;
  });
  await page.waitForTimeout(200);
  const shoot = async (name, mode) => {
    await page.evaluate((m) => {
      const fx = window.__fx;
      fx.s.traverse((o) => {
        if (o.name !== "sun_disc") return;
        o.visible = m !== "off";
        o.material.depthTest = m !== "no-depth-test";
        o.material.needsUpdate = true;
      });
      fx.r.render(fx.s, fx.c);
    }, mode);
    await page.screenshot({ path: `${outDir}/${name}.png` });
  };
  await shoot("disc-on", "on");
  await shoot("disc-off", "off");
  await shoot("disc-no-depth-test", "no-depth-test");
  console.log(`wrote 3 frozen variants to ${outDir}`);
}
await browser.close();
