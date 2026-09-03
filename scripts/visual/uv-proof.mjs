// P20.8 rendered-pixel UV proof (review harness, not part of the shipped game).
//
// THE CLAIM UNDER TEST: a living-world card draws the atlas cell its zone
// NAMES, right way up. Reading the UV expression and nodding does not test it —
// the defect it replaces was a disagreement between that expression and a
// TEXTURE FLAG, and no amount of reading either one alone would have shown it.
//
// So this renders. It drives the SHIPPED module: `LivingWorld.load` builds the
// real batches from the real zone table with the real `loadMotionAtlas`
// textures, and the UVs read back below are the ones `makeBatch` wrote into the
// batch geometry. One card per sheet is then re-drawn on its own quad through
// its own sheet, unblended, into an offscreen target, and the readback's alpha
// profile is compared against the SAME cell decoded straight out of the PNG in
// PNG-row order — and against the vertically mirrored cell, which is what the
// pre-P20.8 build drew.
//
// PASS = the rendered profile matches the NAMED cell and not the mirrored one.
//
// The quad carries its own positions (a unit square at the origin, an
// orthographic camera fitted to it) because the question is what the UVs
// address, not where the card stands. Everything that could get the answer
// wrong — the rect, the padding inset, the UV expression, the sampler's flipY,
// the filter — comes from the shipped path.
//
// Usage: node scripts/visual/uv-proof.mjs <baseUrl> <outDir>
//   e.g. node scripts/visual/uv-proof.mjs http://127.0.0.1:5210 shots/p20.8/uv
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const baseUrl = process.argv[2] || "http://127.0.0.1:5210";
const outDir = process.argv[3] || "shots/p20.8/uv";

// One probe per sheet. `zone` picks the card, `slot`/`name` say which cell that
// zone's author asked for, and `mirrorSlot` is the cell the flipY defect drew.
const PROBES = [
  {
    sheet: "motion",
    url: "/assets/greenwater/textures/greenwater_motion_512.png",
    columns: 2,
    mesh: "BP_LIVING_AIR",
    zone: "HEAT_SHIMMER_LONG_PAN",
    slot: 0,
    name: "MIST",
    mirrorSlot: 2,
    mirrorName: "RAIN",
  },
  {
    sheet: "motionB",
    url: "/assets/greenwater/textures/greenwater_motion_b_512.png",
    columns: 4,
    mesh: "BP_LIVING_AIR_B",
    zone: "SALT_DEVIL_CORE",
    slot: 4,
    name: "DEVIL_WISP_A",
    mirrorSlot: 8,
    mirrorName: "FLICKER_DEAD",
  },
  {
    sheet: "horizon",
    url: "/assets/greenwater/textures/futurisma_horizon_1024.png",
    columns: 4,
    mesh: "BP_LIVING_HORIZON",
    zone: "PAN_MESA_LINE",
    slot: 12,
    name: "MESA_LONG",
    mirrorSlot: 0,
    mirrorName: "TREELINE_DENSE",
  },
];

const browser = await chromium.launch({
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 400)));
page.on("console", (m) => {
  if (m.type() === "error") console.log("[console.error]", m.text().slice(0, 400));
});
// Any page on the dev server will do; it exists so the module graph resolves.
await page.goto(`${baseUrl}/?diagnostics=1`, { waitUntil: "networkidle" });
mkdirSync(outDir, { recursive: true });

const report = await page.evaluate(async (probes) => {
  const { THREE } = await import("/scripts/visual/harness-deps.js");
  const { LivingWorld } = await import("/src/game/living-world.ts");
  const { buildLivingWorld, LIVING_WORLD_SPECS } =
    await import("/src/game/living-world-zones.js");

  // The smallest course `LivingWorld` can be built against: it reads only
  // `kind`, `sampleAtDistance` and `createSampleScratch`, and none of those
  // touch a UV. Everything the proof is about comes from the real module.
  const sample = {
    position: new THREE.Vector3(0, 0, 0),
    right: new THREE.Vector3(1, 0, 0),
    halfWidth: 10,
  };
  const course = {
    kind: "bitterpan",
    length: 3050,
    sampleAtDistance: () => sample,
    sample: () => sample,
    createSampleScratch: () => ({ ...sample }),
  };
  const world = await LivingWorld.load(
    course,
    {},
    "/assets/greenwater/textures/greenwater_motion_512.png",
    "/assets/greenwater/textures/greenwater_motion_b_512.png",
    "/assets/greenwater/textures/futurisma_horizon_1024.png",
  );
  const authored = buildLivingWorld(LIVING_WORLD_SPECS.bitterpan);

  const SIDE = 256;
  const BANDS = 8;
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
  renderer.setSize(SIDE, SIDE, false);
  renderer.setClearColor(0x000000, 0);
  const target = new THREE.WebGLRenderTarget(SIDE, SIDE, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
  });
  const camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0, 10);
  camera.position.set(0, 0, 1);

  const bandProfile = (alpha, side, bands) => {
    const per = side / bands;
    const out = [];
    for (let band = 0; band < bands; band += 1) {
      let total = 0;
      let count = 0;
      for (let row = Math.floor(band * per); row < Math.floor((band + 1) * per); row += 1) {
        for (let column = 0; column < side; column += 1) {
          total += alpha[row * side + column];
          count += 1;
        }
      }
      out.push(total / count / 255);
    }
    return out;
  };

  // The PNG side of the comparison, decoded through a canvas so it is the file
  // on disk rather than anything three.js has touched. Same 1.5 px inset the
  // card's UVs carry, same 256 px raster, same band split.
  const cellProfile = async (url, columns, slot, sheetSize) => {
    const image = new Image();
    image.src = url;
    await image.decode();
    const step = sheetSize / columns;
    const canvas = document.createElement("canvas");
    canvas.width = SIDE;
    canvas.height = SIDE;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, SIDE, SIDE);
    context.drawImage(
      image,
      (slot % columns) * step + 1.5, Math.floor(slot / columns) * step + 1.5,
      step - 3, step - 3,
      0, 0, SIDE, SIDE,
    );
    const data = context.getImageData(0, 0, SIDE, SIDE).data;
    const alpha = new Uint8Array(SIDE * SIDE);
    for (let index = 0; index < alpha.length; index += 1) {
      alpha[index] = data[index * 4 + 3];
    }
    return { profile: bandProfile(alpha, SIDE, BANDS), png: canvas.toDataURL() };
  };

  const results = [];
  for (const probe of probes) {
    const mesh = world.root.getObjectByName(probe.mesh);
    if (!mesh) {
      results.push({ ...probe, error: `no mesh named ${probe.mesh}` });
      continue;
    }
    const batchSpec = authored.batches.find((b) => b.spec.meshName === probe.mesh);
    const cardIndex = batchSpec.cards.findIndex((c) => c.motionId === probe.zone);
    if (cardIndex < 0) {
      results.push({ ...probe, error: `no card from zone ${probe.zone}` });
      continue;
    }
    const card = batchSpec.cards[cardIndex];
    // The UVs under test: exactly the four pairs makeBatch wrote for this card.
    const uvs = mesh.geometry.attributes.uv.array
      .slice(cardIndex * 8, cardIndex * 8 + 8);

    // Quad vertex order in makeBatch is [bottom-left, bottom-right, top-right,
    // top-left] in the card's own frame, so the proof quad uses the same order
    // and the readback comes out in screen order, top row first.
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
      -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
    ]), 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uvs), 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);

    const material = new THREE.MeshBasicMaterial({
      // The real texture object off the real loader, taken from the real batch
      // material: this is what carries `flipY`.
      map: mesh.material.map,
      // No blending, no alpha test, no tint: the target receives the texel, so
      // the alpha read back is the cell's own alpha and nothing else.
      transparent: false,
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(geometry, material));
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, camera);
    const pixels = new Uint8Array(SIDE * SIDE * 4);
    renderer.readRenderTargetPixels(target, 0, 0, SIDE, SIDE, pixels);
    renderer.setRenderTarget(null);

    // readRenderTargetPixels returns rows bottom-first; flip to screen order so
    // band 0 is the TOP of the card, which is what the PNG profile's band 0 is.
    const alpha = new Uint8Array(SIDE * SIDE);
    const rgba = new Uint8ClampedArray(SIDE * SIDE * 4);
    for (let row = 0; row < SIDE; row += 1) {
      const source = (SIDE - 1 - row) * SIDE * 4;
      for (let column = 0; column < SIDE; column += 1) {
        const to = (row * SIDE + column) * 4;
        alpha[row * SIDE + column] = pixels[source + column * 4 + 3];
        rgba[to] = pixels[source + column * 4];
        rgba[to + 1] = pixels[source + column * 4 + 1];
        rgba[to + 2] = pixels[source + column * 4 + 2];
        rgba[to + 3] = pixels[source + column * 4 + 3];
      }
    }
    const canvas = document.createElement("canvas");
    canvas.width = SIDE;
    canvas.height = SIDE;
    canvas.getContext("2d").putImageData(
      new ImageData(rgba, SIDE, SIDE), 0, 0);

    const sheetSize = card.rect.sheetSize;
    const named = await cellProfile(probe.url, probe.columns, probe.slot, sheetSize);
    const mirrored = await cellProfile(
      probe.url, probe.columns, probe.mirrorSlot, sheetSize);
    const rendered = bandProfile(alpha, SIDE, BANDS);
    const mad = (a, b) => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0) / a.length;

    results.push({
      sheet: probe.sheet,
      zone: probe.zone,
      mesh: probe.mesh,
      cardIndex,
      rect: card.rect,
      namedSlot: probe.slot,
      namedCell: probe.name,
      mirrorSlot: probe.mirrorSlot,
      mirrorCell: probe.mirrorName,
      uv: Array.from(uvs).map((v) => Number(v.toFixed(6))),
      renderedProfile: rendered.map((v) => Number(v.toFixed(4))),
      namedProfile: named.profile.map((v) => Number(v.toFixed(4))),
      mirrorProfile: mirrored.profile.map((v) => Number(v.toFixed(4))),
      madVsNamed: Number(mad(rendered, named.profile).toFixed(5)),
      madVsMirror: Number(mad(rendered, mirrored.profile).toFixed(5)),
      // The pre-P20.8 defect's exact prediction: `flipY = true` against
      // top-origin rects draws the mirrored GRID ROW and draws it UPSIDE DOWN,
      // so the pre-fix profile should match the mirrored cell REVERSED, not the
      // mirrored cell. Naming that as its own number is what makes the before
      // side of this proof a diagnosis rather than a shrug.
      madVsMirrorFlipped: Number(
        mad(rendered, mirrored.profile.slice().reverse()).toFixed(5)),
      images: {
        rendered: canvas.toDataURL(),
        named: named.png,
        mirrored: mirrored.png,
      },
    });
  }
  return results;
}, PROBES);

const summary = [];
for (const result of report) {
  if (result.error) {
    console.log(`${result.sheet}: ERROR ${result.error}`);
    summary.push(result);
    continue;
  }
  for (const [key, dataUrl] of Object.entries(result.images)) {
    const file = `${outDir}/${result.sheet}-${key}.png`;
    writeFileSync(file, Buffer.from(dataUrl.split(",")[1], "base64"));
  }
  // PASS is not "closer to named than to mirrored" — a symmetric cell would
  // clear that on a coin toss. It is "matches the named cell to within the
  // canvas/GPU resampling floor", with the mirrored-and-flipped reading (the
  // defect's own signature) an order of magnitude further away.
  const verdict = result.madVsNamed <= 0.01
    && result.madVsNamed * 5 < result.madVsMirrorFlipped ? "PASS" : "FAIL";
  console.log(
    `${result.sheet.padEnd(8)} ${result.zone.padEnd(24)} `
    + `named=${result.namedCell}(${result.namedSlot}) `
    + `mirror=${result.mirrorCell}(${result.mirrorSlot})  `
    + `MADvsNamed=${result.madVsNamed} MADvsMirrorFlipped=${result.madVsMirrorFlipped}`
    + `  ${verdict}`,
  );
  console.log(`  rendered      ${result.renderedProfile.join(" ")}`);
  console.log(`  named cell    ${result.namedProfile.join(" ")}`);
  console.log(`  mirror cell   ${result.mirrorProfile.join(" ")}`);
  delete result.images;
  summary.push({ ...result, verdict });
}
writeFileSync(`${outDir}/uv-proof.json`, JSON.stringify(summary, null, 2));
console.log(`-> ${outDir}/uv-proof.json`);
await browser.close();
