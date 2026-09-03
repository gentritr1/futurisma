// P20.5 sun-disc occlusion probe (review harness, not part of the shipped game).
//
// Answers "why is the additive sun disc visible through the hangar wall" with
// measurements instead of a reading of the shader: it waits for a station
// distance, then reports the disc's material/render state, its distance from
// the camera against camera.far, whether the depth buffer in front of it is
// actually occupied, and an A/B screenshot with the disc forced invisible so
// the pixels it owns can be isolated.
//
// Needs the same temporary `window.__fx` hook shadow-caster-probe.mjs
// documents, added after the renderer.render call in game.ts.
//
// Usage: node scripts/visual/sun-disc-probe.mjs <url> <station-metres> <outDir>
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const url = process.argv[2];
const station = Number(process.argv[3] || 630);
const outDir = process.argv[4] || "shots/p20.5/sun-probe";

const browser = await chromium.launch({
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 400)));
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
mkdirSync(outDir, { recursive: true });

const readD = () =>
  page.evaluate(() => {
    const el = document.getElementById("futurisma-diagnostics");
    if (!el) return null;
    try {
      const c = JSON.parse(el.textContent || "{}").current || {};
      return { d: c.distanceMeters, phase: c.phase, sector: c.sector };
    } catch {
      return null;
    }
  });

const deadline = Date.now() + 120_000;
let diag = null;
while (Date.now() < deadline) {
  diag = await readD();
  if (diag && diag.phase === "running" && diag.d >= station && diag.d < station + 90) break;
  await page.waitForTimeout(30);
}
console.log("at", JSON.stringify(diag));

const state = await page.evaluate(() => {
  const fx = window.__fx;
  if (!fx) return { error: "no window.__fx hook" };
  let disc = null;
  let dome = null;
  const transparentWorld = [];
  fx.s.traverse((o) => {
    if (o.name === "sun_disc") disc = o;
    if (o.name === "sky_backdrop") dome = o;
  });
  const cam = fx.c;
  const p = disc.getWorldPosition(new (disc.position.constructor)());
  const toCam = p.clone().sub(cam.position);
  const forward = cam.getWorldDirection(new (disc.position.constructor)());
  const m = disc.material;
  // What sits in the depth buffer at the disc's screen position?
  const ndc = p.clone().project(cam);
  return {
    cameraFar: cam.far,
    cameraNear: cam.near,
    discDistance: Number(toCam.length().toFixed(2)),
    discDepthAlongView: Number(toCam.dot(forward).toFixed(2)),
    discNdc: [ndc.x, ndc.y, ndc.z].map((v) => Number(v.toFixed(4))),
    discVisible: disc.visible,
    discRenderOrder: disc.renderOrder,
    discFrustumCulled: disc.frustumCulled,
    material: {
      transparent: m.transparent,
      opacity: m.opacity,
      depthTest: m.depthTest,
      depthWrite: m.depthWrite,
      blending: m.blending,
      color: m.color.getHexString(),
    },
    domeRenderOrder: dome ? dome.renderOrder : null,
    domeDepthWrite: dome ? dome.material.depthWrite : null,
    domeDepthTest: dome ? dome.material.depthTest : null,
    domeTransparent: dome ? dome.material.transparent : null,
  };
});
console.log(JSON.stringify(state, null, 1));

// Which meshes actually draw in front of the disc's screen position, and are
// they opaque? Raycast from the camera toward the disc.
const blockers = await page.evaluate(() => {
  const fx = window.__fx;
  const THREEish = fx.s.constructor;
  let disc = null;
  fx.s.traverse((o) => {
    if (o.name === "sun_disc") disc = o;
  });
  const dir = disc.getWorldPosition(new disc.position.constructor())
    .sub(fx.c.position)
    .normalize();
  // Minimal raycast without importing three: walk candidate meshes' bounding
  // spheres along the ray. Good enough to name what is between camera and disc.
  const hits = [];
  const origin = fx.c.position;
  fx.s.traverse((o) => {
    if (!o.isMesh || o === disc || o.name === "sky_backdrop") return;
    if (!o.visible) return;
    if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    const c = o.geometry.boundingSphere.center.clone().applyMatrix4(o.matrixWorld);
    const scale = Math.max(
      o.matrixWorld.elements[0], o.matrixWorld.elements[5], o.matrixWorld.elements[10],
    );
    const r = o.geometry.boundingSphere.radius * Math.abs(scale || 1);
    const oc = c.clone().sub(origin);
    const t = oc.dot(dir);
    if (t <= 0) return;
    const perp = oc.clone().sub(dir.clone().multiplyScalar(t)).length();
    if (perp > r) return;
    hits.push({
      name: o.name || "(unnamed)",
      t: Number(t.toFixed(1)),
      radius: Number(r.toFixed(1)),
      transparent: o.material && o.material.transparent,
      depthWrite: o.material && o.material.depthWrite,
      renderOrder: o.renderOrder,
    });
  });
  hits.sort((a, b) => a.t - b.t);
  return hits.slice(0, 12);
});
console.log("blockers along the camera->disc ray:");
console.log(JSON.stringify(blockers, null, 1));

// A/B the disc against a FROZEN frame. Two screenshots 120 ms apart differ in
// every pixel at 260 km/h, so the loop is stopped first (rAF becomes a no-op,
// which ends the game's self-rescheduling frame) and each variant is drawn by
// hand. What is left in the diff is the disc and nothing else.
await page.evaluate(() => {
  window.__rafOff = true;
  window.requestAnimationFrame = () => 0;
});
await page.waitForTimeout(200);
const shoot = async (name, hidden) => {
  await page.evaluate((hide) => {
    const fx = window.__fx;
    fx.s.traverse((o) => {
      if (o.name === "sun_disc") o.visible = !hide;
    });
    fx.r.render(fx.s, fx.c);
  }, hidden);
  await page.screenshot({ path: `${outDir}/${name}.png` });
};
await shoot("disc-on", false);
await shoot("disc-off", true);
console.log(`wrote ${outDir}/disc-on.png and disc-off.png`);
await browser.close();
