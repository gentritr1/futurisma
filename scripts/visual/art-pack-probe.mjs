// Visual review harness (not part of the shipped game).
//
// H2a — proves which horizon sheet a load actually gets, rather than inferring
// it from pixels. Three questions, three observations:
//
//   1. WHICH SHEET does a plain load fetch, and which does `?art=base` fetch?
//      Listens on `response` and reports every horizon texture request with its
//      status. The generated sheet is the DEFAULT now, so a 404 on it is every
//      player's horizon — and a card sheet that fails to load renders as the
//      layer quietly missing, which at 1784 m under fog is exactly the failure
//      a screenshot cannot catch.
//   2. Does it cost DRAW CALLS OR TEXTURE SLOTS? Reads calls, triangles and
//      `renderer.info.memory` off `#futurisma-diagnostics`, which
//      `diagnostics.ts` already publishes. Note that `memory.textures` is a
//      COUNT, not bytes: three.js does not expose texture bytes, so the byte
//      story is the PNG dimensions, which validate-art-pass.mjs pins.
//   3. Does it move LAP TIME? Runs a 1-lap demo per map per state and reads
//      `lapTimesMs`. The swap is a texture and a URL parameter, so the answer
//      has to be no; asserting that from the architecture instead of
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

console.log("== 1+2. horizon sheet fetched, draw calls, texture slots (bitterpan) ==");
for (const [label, art] of [["default", ""], ["?art=base", "&art=base"]]) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const seen = new Set();
  page.on("response", (r) => {
    const path = new URL(r.url()).pathname;
    if (/textures\/.*horizon/.test(path)) {
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
    `  ${label.padEnd(9)} calls=${diag.calls} tris=${diag.triangles} `
      + `p95=${diag.p95} textureSlots=${diag.textures} geometries=${diag.geometries}`,
  );
  for (const line of [...seen].sort()) console.log(`         ${line}`);
  await page.close();
}

console.log("== 3. one-lap demo time, both maps, both sheet states ==");
for (const map of ["bitterpan", "greenwater"]) {
  for (const [label, art] of [["default", ""], ["?art=base", "&art=base"]]) {
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
      `  ${map.padEnd(11)} ${label.padEnd(9)} lapTimesMs=${JSON.stringify(diag?.lapTimesMs)}`,
    );
    await page.close();
  }
}

await browser.close();
