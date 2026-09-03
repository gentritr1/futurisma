// Boost-pad paint probe (review harness, not part of the shipped game).
//
// P20.7 item 1 needs "the pad field is N luma above the deck BESIDE IT IN THE
// SAME FRAME". Fixed pixel crops cannot answer that: shoot-stations.mjs polls a
// 1 Hz diagnostics line, so the craft is anywhere in a 110 m window when the
// shutter fires and the pad lands in a different place in every run. Two builds
// measured that way are not being compared at all.
//
// So this projects the pad instead of guessing where it is. It reads the boost
// pad InstancedMesh out of the live scene, decomposes each instance matrix,
// projects the four corners of the pad's top face through the live camera, and
// fires the shutter only when that quad is fully on screen at a chosen camera
// distance. It writes the quad — and a same-length deck quad offset sideways by
// 2.2 pad half-widths, which is deck, not pad — to JSON in pixel coordinates,
// for scripts/visual/paint-luma.py to mask and measure.
//
// Needs one temporary line in game.ts, immediately after the renderer.render
// call in the frame loop, because the renderer and scene are otherwise private
// (the same hook scripts/visual/shadow-caster-probe.mjs documents):
//
//   (window as any).__fx = { r: this.renderer, s: this.scene, c: this.camera };
//
// Remove it again before committing; validate-module-seams.mjs holds game.ts to
// a line budget and this probe is not worth one of them.
//
// Usage: node scripts/visual/paint-probe.mjs <url> <outDir> [nearM] [farM]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const url = process.argv[2];
const outDir = process.argv[3] || "shots/paint";
const nearM = Number(process.argv[4] || 18);
const farM = Number(process.argv[5] || 46);

const browser = await chromium.launch({
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 400)));
page.on("console", (m) => {
  if (m.type() === "error") console.log("[console.error]", m.text().slice(0, 300));
});
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(3500);
mkdirSync(outDir, { recursive: true });

// Both maps author four boost pads.
const PAD_COUNT = 4;
const hooked = await page.evaluate(() => Boolean(window.__fx));
if (!hooked) {
  await browser.close();
  throw new Error(
    "window.__fx is not present. Add the temporary hook described at the top of "
    + "this file to game.ts, reload, and run again.",
  );
}

// Projects every boost-pad instance. Returns, per instance, the on-screen quad
// of its top face, a deck quad beside it, and the camera distance.
const probe = async (near, far) =>
  page.evaluate(([near, far]) => {
    const fx = window.__fx;
    let mesh = null;
    fx.s.traverse((o) => {
      if (o.isInstancedMesh && /boost_pads$/.test(o.name)) mesh = o;
    });
    if (!mesh) return { error: "no boost pad InstancedMesh named *_boost_pads" };
    mesh.updateWorldMatrix(true, false);
    const cam = fx.c;
    // Top face of a unit box is y = +halfHeight in geometry space; read it off
    // the geometry rather than assuming, because the two maps author different
    // box heights (Bitterpan 0.07 tall, Greenwater 1.0 scaled down by the
    // instance matrix).
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox;
    const topY = bb.max.y;
    const out = [];
    const w = 1280;
    const h = 720;
    for (let i = 0; i < mesh.count; i += 1) {
      // three is not reachable from the page, so the matrix maths is done on
      // the raw arrays here rather than with Matrix4/Vector3.
      const e = [];
      for (let k = 0; k < 16; k += 1) e.push(mesh.instanceMatrix.array[i * 16 + k]);
      const world = mesh.matrixWorld.elements;
      // instance -> world
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
      const M = mul(world, e);
      const apply = (x, y, z) => ({
        x: M[0] * x + M[4] * y + M[8] * z + M[12],
        y: M[1] * x + M[5] * y + M[9] * z + M[13],
        z: M[2] * x + M[6] * y + M[10] * z + M[14],
      });
      const centre = apply(0, topY, 0);
      const dx = centre.x - cam.position.x;
      const dy = centre.y - cam.position.y;
      const dz = centre.z - cam.position.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist < near || dist > far) continue;
      const project = (p) => {
        const v = { x: p.x, y: p.y, z: p.z };
        // world -> ndc via camera matrices
        const mvp = mul(
          cam.projectionMatrix.elements,
          cam.matrixWorldInverse.elements,
        );
        const cx = mvp[0] * v.x + mvp[4] * v.y + mvp[8] * v.z + mvp[12];
        const cy = mvp[1] * v.x + mvp[5] * v.y + mvp[9] * v.z + mvp[13];
        const cw = mvp[3] * v.x + mvp[7] * v.y + mvp[11] * v.z + mvp[15];
        return { x: (cx / cw * 0.5 + 0.5) * w, y: (-cy / cw * 0.5 + 0.5) * h, w: cw };
      };
      // The pad quad, inset 12% on both axes so the mask never bleeds onto the
      // deck through a half-covered edge pixel; and the border ring, sampled as
      // the 0..8% band, which is where the rim tone lives.
      const quad = (ix, iz) => [
        project(apply(-ix, topY, -iz)),
        project(apply(ix, topY, -iz)),
        project(apply(ix, topY, iz)),
        project(apply(-ix, topY, iz)),
      ];
      const inner = quad(0.38, 0.44);
      const full = quad(0.5, 0.5);
      // Deck beside the pad: same longitudinal extent, offset 2.2 pad widths to
      // the side that is further from the frame edge.
      const deckQuad = (sign) => [
        project(apply(sign * 1.7, topY, -0.44)),
        project(apply(sign * 2.7, topY, -0.44)),
        project(apply(sign * 2.7, topY, 0.44)),
        project(apply(sign * 1.7, topY, 0.44)),
      ];
      const onScreen = (poly) =>
        poly.every((p) => p.w > 0 && p.x > 2 && p.x < w - 2 && p.y > 2 && p.y < h - 2);
      if (!onScreen(full)) continue;
      const left = deckQuad(-1);
      const right = deckQuad(1);
      const deck = onScreen(left) && onScreen(right)
        ? (Math.min(...left.map((p) => p.x)) > w - Math.max(...right.map((p) => p.x))
          ? left : right)
        : onScreen(left) ? left : onScreen(right) ? right : null;
      if (!deck) continue;
      const area = Math.abs(
        (full[0].x * (full[1].y - full[3].y)
          + full[1].x * (full[2].y - full[0].y)
          + full[2].x * (full[3].y - full[1].y)
          + full[3].x * (full[0].y - full[2].y)) / 2,
      );
      out.push({ index: i, dist, areaPx: area, inner, full, deck });
    }
    const el = document.getElementById("futurisma-diagnostics");
    let d = null;
    try { d = JSON.parse(el.textContent || "{}").current.distanceMeters; } catch {}
    return { pads: out, d };
  }, [near, far]);

// The pads are only sampled where the demo line happens to bring the craft, so
// the run does NOT stop at "one frame of each": it keeps going until every pad
// has been caught at a workable on-screen size, or the deadline expires. A pad
// measured at 1,500 px and one measured at 9,000 px are not comparable
// samples, and stopping at first sight guarantees the small one.
const AREA_FLOOR_PX = 4_000;
const seen = new Map();
const deadline = Date.now() + 240_000;
const done = () => seen.size >= PAD_COUNT
  && [...seen.values()].every((p) => p.areaPx >= AREA_FLOOR_PX);
while (!done() && Date.now() < deadline) {
  const result = await probe(nearM, farM);
  if (result && result.error) {
    await browser.close();
    throw new Error(result.error);
  }
  for (const pad of result?.pads ?? []) {
    const previous = seen.get(pad.index);
    // Keep the LARGEST on-screen presentation of each pad, so the mask has the
    // most pixels to average and the measurement is least sensitive to the
    // exact frame.
    if (previous && previous.areaPx >= pad.areaPx) continue;
    const file = `${outDir}/pad-${pad.index}.png`;
    await page.screenshot({ path: file });
    seen.set(pad.index, { ...pad, file, d: result.d });
  }
  await page.waitForTimeout(45);
}

const pads = [...seen.values()].sort((a, b) => a.index - b.index);
const small = pads.filter((p) => p.areaPx < AREA_FLOOR_PX);
if (small.length > 0) {
  console.log(
    `WARNING: ${small.length} pad(s) never reached ${AREA_FLOOR_PX} px on screen `
    + `(${small.map((p) => `${p.index}:${Math.round(p.areaPx)}`).join(", ")}). `
    + `Their numbers are over fewer pixels than the rest — say so when quoting them.`,
  );
}
writeFileSync(`${outDir}/pads.json`, JSON.stringify(pads, null, 2));
for (const pad of pads) {
  console.log(`pad ${pad.index} d=${pad.d} dist=${pad.dist.toFixed(1)}m area=${pad.areaPx.toFixed(0)}px -> ${pad.file}`);
}
console.log(`${pads.length} pads captured -> ${outDir}`);
await browser.close();
