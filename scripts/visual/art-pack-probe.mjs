// Visual review harness (not part of the shipped game).
//
// H2a — proves what `?art=hf` actually does, rather than inferring it from
// pixels. Three questions, three observations:
//
//   1. WHICH SHEETS does each flag state fetch? Listens on `response` and
//      reports every crust/facade/horizon texture request with its status. A
//      swap that silently 404s and falls back to a base sheet renders almost
//      identically to a working one at gameplay distance, which is exactly the
//      failure a screenshot cannot catch.
//   2. Does it cost DRAW CALLS OR TEXTURE SLOTS? Reads calls, triangles and
//      `renderer.info.memory` off `#futurisma-diagnostics`, which
//      `diagnostics.ts` already publishes. Note that `memory.textures` is a
//      COUNT, not bytes: three.js does not expose texture bytes, so the byte
//      story is the PNG dimensions, which validate-art-pass.mjs pins.
//   3. Does it move LAP TIME? Runs a 1-lap demo per map per flag state and
//      reads `lapTimesMs`. The art pack is textures and a URL parameter, so the
//      answer has to be no; asserting that from the architecture instead of
//      measuring it is how a texture swap that quietly perturbs load order and
//      therefore the first physics step gets shipped.
//
// Usage: node scripts/visual/art-pack-probe.mjs [origin]
//   origin defaults to http://127.0.0.1:5219
import { chromium } from "playwright";

const origin = process.argv[2] || "http://127.0.0.1:5219";
const browser = await chromium.launch({
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});

const readDiag = (page) =>
  page.evaluate(() => {
    const j = JSON.parse(
      document.getElementById("futurisma-diagnostics")?.textContent || "{}",
    );
    const c = j.current || {};
    return {
      phase: c.phase,
      calls: c.calls,
      triangles: c.triangles,
      p95: c.p95FrameMs,
      textures: c.textures,
      geometries: c.geometries,
      lapTimesMs: c.lapTimesMs,
    };
  });

console.log("== 1+2. sheets fetched, draw calls, texture slots (bitterpan) ==");
for (const [label, art] of [["base", ""], ["hf", "&art=hf"]]) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const seen = new Set();
  page.on("response", (r) => {
    const path = new URL(r.url()).pathname;
    if (/textures\/.*(crust_tile|facades|horizon)/.test(path)) {
      seen.add(`${r.status()} ${path}`);
    }
  });
  await page.goto(
    `${origin}/?map=bitterpan&demo=1&diagnostics=1&autostart=1${art}`,
    { waitUntil: "networkidle" },
  );
  await page.waitForTimeout(14000);
  const diag = await readDiag(page);
  console.log(
    `  ${label.padEnd(4)} calls=${diag.calls} tris=${diag.triangles} `
      + `p95=${diag.p95} textureSlots=${diag.textures} geometries=${diag.geometries}`,
  );
  for (const line of [...seen].sort()) console.log(`         ${line}`);
  await page.close();
}

console.log("== 3. one-lap demo time, both maps, both flag states ==");
for (const map of ["bitterpan", "greenwater"]) {
  for (const [label, art] of [["base", ""], ["hf", "&art=hf"]]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(
      `${origin}/?map=${map}&demo=1&diagnostics=1&autostart=1&laps=1${art}`,
      { waitUntil: "networkidle" },
    );
    let diag = null;
    for (let tick = 0; tick < 120; tick += 1) {
      await page.waitForTimeout(1000);
      diag = await readDiag(page);
      if (diag.phase === "finished") break;
    }
    console.log(
      `  ${map.padEnd(11)} ${label.padEnd(4)} lapTimesMs=${JSON.stringify(diag?.lapTimesMs)}`,
    );
    await page.close();
  }
}

await browser.close();
