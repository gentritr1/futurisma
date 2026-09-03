// Screen-bay panel probe (review harness, not part of the shipped game).
//
// P20.3 shipped 147 `BP_MIDGROUND_SCREEN_BAY` instances and its own crops
// flagged the risk: the road-facing side of a vertical panel under one key
// light and a thin hemisphere term renders near-black, so the fence line reads
// as a row of black rectangles at the roadside. P20.7 item 2 has to show that
// the shadow side came up WITHOUT the sun side moving — which means measuring
// the two sides separately, per panel, in the same frame.
//
// A fixed crop cannot do that: which bays are in frame, and which of their two
// faces is turned to the camera, changes with every metre of travel. So this
// projects them. It reads the instanced mesh out of the live scene, takes the
// middle segment of each bay's panel, works out which of its two faces the
// camera can see, classifies that face as SUN or SHADOW by its own world normal
// against the live key light, and writes the projected quad to JSON for
// scripts/visual/panel-luma.py to mask and measure.
//
// Needs the same one temporary line in game.ts that
// scripts/visual/shadow-caster-probe.mjs and paint-probe.mjs document:
//
//   (window as any).__fx = { r: this.renderer, s: this.scene, c: this.camera };
//
// Remove it again before committing.
//
// Usage: node scripts/visual/panel-probe.mjs <url> <outDir> [stations]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const url = process.argv[2];
const outDir = process.argv[3] || "shots/panels";
const stations = (process.argv[4] || "830,1343,2300").split(",").map(Number);

const browser = await chromium.launch({
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 400)));
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(3500);
mkdirSync(outDir, { recursive: true });

const hooked = await page.evaluate(() => Boolean(window.__fx));
if (!hooked) {
  await browser.close();
  throw new Error("window.__fx is not present; add the temporary game.ts hook.");
}

const probe = () =>
  page.evaluate(() => {
    const fx = window.__fx;
    let mesh = null;
    let key = null;
    const lights = [];
    fx.s.traverse((o) => {
      if (o.isInstancedMesh && o.name === "BP_MIDGROUND_SCREEN_BAY") mesh = o;
      if (o.isDirectionalLight && o.intensity > 0) {
        lights.push(o);
        // The KEY is the strongest directional light, not the first one the
        // traversal happens to reach. The scene carries a rim light as well,
        // and classifying panels against the rim would label the sun side
        // shadow and the shadow side sun — a silent, total inversion of the
        // measurement.
        if (!key || o.intensity > key.intensity) key = o;
      }
    });
    if (!mesh) return { error: "BP_MIDGROUND_SCREEN_BAY is not in the scene" };
    if (!key) return { error: "no DirectionalLight found for the sun/shadow split" };
    mesh.updateWorldMatrix(true, false);
    const cam = fx.c;
    const w = 1280;
    const h = 720;
    const mul = (a, b) => {
      const r = new Array(16).fill(0);
      for (let c = 0; c < 4; c += 1) {
        for (let rw = 0; rw < 4; rw += 1) {
          let s = 0;
          for (let k = 0; k < 4; k += 1) s += a[k * 4 + rw] * b[c * 4 + k];
          r[c * 4 + rw] = s;
        }
      }
      return r;
    };
    // A DirectionalLight shines from its position toward its target, so the
    // vector a surface must face to be lit is position - target.
    const toLight = {
      x: key.position.x - key.target.position.x,
      y: key.position.y - key.target.position.y,
      z: key.position.z - key.target.position.z,
    };
    const ln = Math.hypot(toLight.x, toLight.y, toLight.z) || 1;
    toLight.x /= ln; toLight.y /= ln; toLight.z /= ln;
    const mvp = mul(cam.projectionMatrix.elements, cam.matrixWorldInverse.elements);
    const world = mesh.matrixWorld.elements;
    const out = [];
    for (let i = 0; i < mesh.count; i += 1) {
      const e = [];
      for (let k = 0; k < 16; k += 1) e.push(mesh.instanceMatrix.array[i * 16 + k]);
      const M = mul(world, e);
      const apply = (x, y, z) => ({
        x: M[0] * x + M[4] * y + M[8] * z + M[12],
        y: M[1] * x + M[5] * y + M[9] * z + M[13],
        z: M[2] * x + M[6] * y + M[10] * z + M[14],
      });
      const origin = apply(0, 0, 0);
      const zAxisPoint = apply(0, 0, 1);
      const normal = {
        x: zAxisPoint.x - origin.x,
        y: zAxisPoint.y - origin.y,
        z: zAxisPoint.z - origin.z,
      };
      const nn = Math.hypot(normal.x, normal.y, normal.z) || 1;
      normal.x /= nn; normal.y /= nn; normal.z /= nn;
      // The sample patch: the MIDDLE segment of the bay only. Local x is the
      // span (scale.x is the bay length in metres, so +-0.06 is ~1.1 m either
      // side of the midpoint), and local y/z are metres because scale.y and
      // scale.z stay 1. The panel is 1.05 m tall hanging from a top edge that
      // sags to -0.34 at the midpoint, so its middle segment spans y in
      // [-1.39, -0.34]; [-1.16, -0.58] is well inside it on both edges. The x
      // half-width is 0.14 of the SPAN, i.e. ~2.5 m of a typical 18 m bay,
      // which still sits inside the two middle segments (each 1/6 of the span)
      // either side of the midpoint.
      const centre = apply(0, -0.87, 0);
      const dx = centre.x - cam.position.x;
      const dy = centre.y - cam.position.y;
      const dz = centre.z - cam.position.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist < 14 || dist > 120) continue;
      // Which face the camera can see: the one whose outward normal opposes the
      // camera's line of sight. That is the ROAD-FACING side by construction —
      // the camera is on the road.
      const facing = (normal.x * dx + normal.y * dy + normal.z * dz) < 0 ? 1 : -1;
      const faceNormal = {
        x: normal.x * facing, y: normal.y * facing, z: normal.z * facing,
      };
      const sun = faceNormal.x * toLight.x + faceNormal.y * toLight.y
        + faceNormal.z * toLight.z;
      const z = 0.026 * facing;
      const project = (p) => {
        const cx = mvp[0] * p.x + mvp[4] * p.y + mvp[8] * p.z + mvp[12];
        const cy = mvp[1] * p.x + mvp[5] * p.y + mvp[9] * p.z + mvp[13];
        const cw = mvp[3] * p.x + mvp[7] * p.y + mvp[11] * p.z + mvp[15];
        return { x: (cx / cw * 0.5 + 0.5) * w, y: (-cy / cw * 0.5 + 0.5) * h, w: cw };
      };
      const quad = [
        project(apply(-0.14, -0.58, z)),
        project(apply(0.14, -0.58, z)),
        project(apply(0.14, -1.16, z)),
        project(apply(-0.14, -1.16, z)),
      ];
      const margin = 30; // keep the HUD's own pixels out of every sample
      if (!quad.every((p) => p.w > 0 && p.x > margin && p.x < w - margin
        && p.y > margin && p.y < h - margin)) continue;
      const area = Math.abs(
        (quad[0].x * (quad[1].y - quad[3].y) + quad[1].x * (quad[2].y - quad[0].y)
          + quad[2].x * (quad[3].y - quad[1].y) + quad[3].x * (quad[0].y - quad[2].y)) / 2,
      );
      if (area < 60) continue; // too few pixels to average honestly
      out.push({
        index: i,
        dist,
        areaPx: area,
        sunDot: sun,
        // Lambert clamps N.L at zero, so the split is AT zero: a face with a
        // negative dot receives literally none of the key. The +-0.02 band is
        // numerical safety, not a lighting judgement. It has to be this tight
        // because the sun sits 56-74 degrees up and these panels are vertical,
        // so a fully sunlit face still only reaches N.L ~ 0.5 and a +-0.15
        // band would file most of the layer as "EDGE".
        side: sun > 0.02 ? "SUN" : sun < -0.02 ? "SHADOW" : "EDGE",
        quad,
      });
    }
    const el = document.getElementById("futurisma-diagnostics");
    let d = null;
    let phase = null;
    try {
      const c = JSON.parse(el.textContent || "{}").current;
      d = c.distanceMeters;
      phase = c.phase;
    } catch { /* diagnostics not up yet */ }
    return {
      panels: out,
      d,
      phase,
      // Reported so a reader can check the key/rim split rather than trust it.
      lights: lights.map((l) => ({
        name: l.name || "(unnamed)",
        intensity: Number(l.intensity.toFixed(3)),
        castShadow: Boolean(l.castShadow),
        isKey: l === key,
      })),
    };
  });

const shots = [];
let best = null;
let next = 0;
let lastD = -1;
const deadline = Date.now() + 240_000;
while (next < stations.length && Date.now() < deadline) {
  const result = await probe();
  if (result?.error) {
    await browser.close();
    throw new Error(result.error);
  }
  const d = result?.d;
  if (typeof d === "number" && result.phase === "running") {
    if (d < lastD - 500) console.log(`lap wrap at ${lastD} -> ${d}`);
    lastD = d;
    if (d >= stations[next] && d < stations[next] + 110) {
      // Keep the RICHEST frame in the window, not the first one in it. The
      // first frame past a station boundary routinely has one bay in view;
      // averaging a side over one panel is not a measurement.
      if (result.panels.length > (best?.panels.length ?? 0)) {
        const file = `${outDir}/st-${String(stations[next]).padStart(4, "0")}.png`;
        await page.screenshot({ path: file });
        best = {
          station: stations[next],
          d,
          file,
          panels: result.panels,
          lights: result.lights,
        };
      }
      await page.waitForTimeout(40);
      continue;
    }
    if (best && d >= best.station) {
      const sun = best.panels.filter((p) => p.side === "SUN").length;
      const shadow = best.panels.filter((p) => p.side === "SHADOW").length;
      console.log(`st ${best.station} d=${best.d} panels=${best.panels.length} `
        + `(SUN ${sun}, SHADOW ${shadow}) -> ${best.file}`);
      shots.push(best);
      if (shots.length === 1) {
        console.log(`lights: ${JSON.stringify(best.lights)}`);
      }
      best = null;
      next += 1;
      continue;
    }
    while (next < stations.length && d >= stations[next] + 110 && d - stations[next] < 600) {
      console.log(`skip station ${stations[next]} (already at ${d})`);
      next += 1;
    }
  }
  await page.waitForTimeout(40);
}
writeFileSync(`${outDir}/panels.json`, JSON.stringify(shots, null, 2));
console.log(`${shots.length}/${stations.length} stations captured -> ${outDir}`);
await browser.close();
