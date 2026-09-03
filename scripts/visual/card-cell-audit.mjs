// P20.8 per-zone cell audit (review harness, not part of the shipped game).
//
// uv-proof.mjs proves three named cells draw themselves. This answers the same
// question for EVERY zone on a map, mechanically, so the art review's first
// column ("now draws <cell>") is measured rather than deduced from the mirror
// arithmetic.
//
// For each zone, and for each distinct atlas rect that zone's author uses, it
// takes the first card, renders it through the SHIPPED batch material and the
// SHIPPED `makeBatch` UVs onto its own unblended quad, reads the pixels back,
// and identifies what it drew by matching the readback against every cell of
// that sheet's grid — in both orientations — taken from the TEXTURE'S OWN
// IMAGE. Nothing here needs to know the flipY convention: the image is
// top-origin by definition, the rect is top-origin by definition, and a card
// that draws the cell it names right way up is the one that matches its own
// rect at orientation "upright".
//
// The readback is also written out per zone/rect, so two builds can be diffed
// per pixel per zone (that is the P20.4-zones-unchanged acceptance).
//
// Usage: node scripts/visual/card-cell-audit.mjs <baseUrl> <map> <outDir>
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const baseUrl = process.argv[2] || "http://127.0.0.1:5210";
const map = process.argv[3] || "bitterpan";
const outDir = process.argv[4] || `shots/p20.8/cells-${map}`;

// Cell names per SHEET NAME — keyed by `batch.spec.texture`, not by sheet size,
// because the jungle atlas and the horizon atlas are both 1024/4 and a size key
// silently labels one with the other's vocabulary.
//
// `jungle` and `emissive` are the GLB's own atlases and only the slots the zone
// table names are labelled; the rest are `slotN`, which is enough for a match.
const CELL_NAMES = {
  motion: ["MIST", "STEAM", "RAIN", "GLINT"],
  jungle: [
    "slot0", "slot1", "slot2", "FERN", "VINE", "slot5", "slot6", "slot7",
    "slot8", "slot9", "slot10", "slot11", "slot12", "slot13", "slot14", "slot15",
  ],
  emissive: [
    "AMBER_LAMP", "slot1", "RED_LAMP", "slot3",
    "slot4", "slot5", "slot6", "slot7",
    "slot8", "slot9", "slot10", "slot11",
    "slot12", "slot13", "slot14", "slot15",
  ],
  motionB: [
    "BIRDS_A", "BIRDS_B", "BIRDS_C", "GULL",
    "DEVIL_WISP_A", "DEVIL_WISP_B", "FLICKER_FULL", "FLICKER_HALF",
    "FLICKER_DEAD", "WRECK_FUSELAGE", "WRECK_TAILFIN", "WRECK_NACELLE",
    "WRECK_GANTRY", "DUST_SCUD", "VAPOR_THIN", "CRATE_STACK",
  ],
  horizon: [
    "TREELINE_DENSE", "TREELINE_BROKEN", "TREELINE_SNAG", "PYLON_RUN",
    "GANTRY_FAR", "HANGAR_MASS", "SILO_PAIR", "TANK_FARM_FAR",
    "STACK_CLUSTER", "STACK_SINGLE", "PLANT_MASS", "RIG_FAR",
    "MESA_LONG", "MESA_BLUFF", "SHIMMER_BAND", "HAZE_BAND",
  ],
};

const browser = await chromium.launch({
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 400)));
page.on("console", (m) => {
  if (m.type() === "error") console.log("[console.error]", m.text().slice(0, 400));
});
await page.goto(`${baseUrl}/?diagnostics=1`, { waitUntil: "networkidle" });
mkdirSync(outDir, { recursive: true });

const report = await page.evaluate(async ([map, cellNames]) => {
  const { THREE } = await import("/scripts/visual/harness-deps.js");
  const { LivingWorld } = await import("/src/game/living-world.ts");
  const { buildLivingWorld, LIVING_WORLD_SPECS } =
    await import("/src/game/living-world-zones.js");

  const sample = {
    position: new THREE.Vector3(0, 0, 0),
    right: new THREE.Vector3(1, 0, 0),
    halfWidth: 10,
  };
  const course = {
    kind: map,
    length: LIVING_WORLD_SPECS[map].courseLength,
    sampleAtDistance: () => sample,
    sample: () => sample,
    createSampleScratch: () => ({ ...sample }),
  };

  // Greenwater's `foliage` and `lamps` batches draw from the environment GLB's
  // own atlases, so the audit has to hand LivingWorld the SAME texture objects
  // the game does — including their flipY, which GLTFLoader sets to false.
  // Pulled out of the real model by material name, exactly as environment.ts's
  // findLivingTextures does.
  let textures = {};
  if (map === "greenwater") {
    const { GLTFLoader } =
      await import("/scripts/visual/harness-deps.js");
    const gltf = await new GLTFLoader()
      .loadAsync("/assets/greenwater/models/greenwater_environment_runtime.glb");
    gltf.scene.traverse((object) => {
      if (!object.isMesh) return;
      const list = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of list) {
        if (material.name === "GW_MAT_jungle") textures.jungle = material.map;
        if (material.name === "GW_MAT_emissive") {
          textures.emissive = material.emissiveMap ?? material.map;
        }
      }
    });
  }

  const world = await LivingWorld.load(
    course,
    textures,
    "/assets/greenwater/textures/greenwater_motion_512.png",
    "/assets/greenwater/textures/greenwater_motion_b_512.png",
    "/assets/greenwater/textures/futurisma_horizon_1024.png",
  );
  const authored = buildLivingWorld(LIVING_WORLD_SPECS[map]);

  const SIDE = 128;
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

  const bandProfile = (alpha) => {
    const per = SIDE / BANDS;
    const out = [];
    for (let band = 0; band < BANDS; band += 1) {
      let total = 0;
      let count = 0;
      for (let row = band * per; row < (band + 1) * per; row += 1) {
        for (let column = 0; column < SIDE; column += 1) {
          total += alpha[row * SIDE + column];
          count += 1;
        }
      }
      out.push(total / count / 255);
    }
    return out;
  };

  // Mean colour over the LIT pixels only. The alpha profile cannot tell the
  // amber lamp cell from the red one — same shape, same coverage, different
  // hue — so a shape match that ties is broken on colour rather than on which
  // slot the loop happened to reach first.
  const colourMean = (rgba) => {
    let r = 0;
    let g = 0;
    let b = 0;
    let lit = 0;
    for (let index = 0; index < rgba.length; index += 4) {
      if (rgba[index + 3] <= 5) continue;
      r += rgba[index];
      g += rgba[index + 1];
      b += rgba[index + 2];
      lit += 1;
    }
    return lit === 0 ? [0, 0, 0] : [r / lit / 255, g / lit / 255, b / lit / 255];
  };

  // Cell profiles taken from the texture's OWN image, which is top-origin
  // whatever the sampler does with it. Cached per texture.
  const sheetCache = new Map();
  const sheetProfiles = (texture, cellSize) => {
    const key = `${texture.uuid}:${cellSize}`;
    if (sheetCache.has(key)) return sheetCache.get(key);
    const image = texture.image;
    const sheetSize = image.width;
    const columns = Math.round(sheetSize / cellSize);
    const canvas = document.createElement("canvas");
    canvas.width = SIDE;
    canvas.height = SIDE;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.imageSmoothingEnabled = false;
    const out = [];
    for (let slot = 0; slot < columns * columns; slot += 1) {
      context.clearRect(0, 0, SIDE, SIDE);
      context.drawImage(
        image,
        (slot % columns) * cellSize + 1.5,
        Math.floor(slot / columns) * cellSize + 1.5,
        cellSize - 3, cellSize - 3,
        0, 0, SIDE, SIDE,
      );
      const data = context.getImageData(0, 0, SIDE, SIDE).data;
      const alpha = new Uint8Array(SIDE * SIDE);
      for (let index = 0; index < alpha.length; index += 1) {
        alpha[index] = data[index * 4 + 3];
      }
      out.push({ slot, profile: bandProfile(alpha), colour: colourMean(data) });
    }
    sheetCache.set(key, { columns, profiles: out });
    return sheetCache.get(key);
  };

  const mad = (a, b) =>
    a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0) / a.length;

  const results = [];
  for (const batch of authored.batches) {
    const mesh = world.root.getObjectByName(batch.spec.meshName);
    if (!mesh) continue;
    const seen = new Set();
    for (let cardIndex = 0; cardIndex < batch.cards.length; cardIndex += 1) {
      const card = batch.cards[cardIndex];
      const key = `${card.motionId}|${card.rect.x},${card.rect.y},${card.rect.size}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const uvs = mesh.geometry.attributes.uv.array
        .slice(cardIndex * 8, cardIndex * 8 + 8);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
        -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
      ]), 3));
      geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uvs), 2));
      geometry.setIndex([0, 1, 2, 0, 2, 3]);
      const material = new THREE.MeshBasicMaterial({
        map: mesh.material.map,
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
      canvas.getContext("2d").putImageData(new ImageData(rgba, SIDE, SIDE), 0, 0);

      const rendered = bandProfile(alpha);
      const renderedColour = colourMean(rgba);
      const sheet = sheetProfiles(mesh.material.map, card.rect.size);
      const namedSlot = Math.round(card.rect.y / card.rect.size) * sheet.columns
        + Math.round(card.rect.x / card.rect.size);
      const candidates = [];
      for (const entry of sheet.profiles) {
        for (const orientation of ["upright", "flipped"]) {
          const reference = orientation === "upright"
            ? entry.profile
            : entry.profile.slice().reverse();
          candidates.push({
            slot: entry.slot,
            orientation,
            score: mad(rendered, reference),
            colourScore: mad(renderedColour, entry.colour),
          });
        }
      }
      // Rank on shape, then break shape ties on colour. The tie window is
      // 1e-4 — below the canvas/GPU resampling floor, so it only ever fires on
      // cells that really are the same shape.
      candidates.sort((a, b) => a.score - b.score);
      const floor = candidates[0].score;
      const best = candidates
        .filter((c) => c.score <= floor + 1e-4)
        .sort((a, b) => a.colourScore - b.colourScore)[0];
      const names = cellNames[batch.spec.texture] ?? null;
      results.push({
        zone: card.motionId,
        batch: card.batch,
        mesh: batch.spec.meshName,
        texture: batch.spec.texture,
        cardIndex,
        namedSlot,
        namedCell: names ? names[namedSlot] : `slot${namedSlot}`,
        drawnSlot: best.slot,
        drawnCell: names ? names[best.slot] : `slot${best.slot}`,
        orientation: best.orientation,
        mad: Number(best.score.toFixed(5)),
        madVsNamedUpright: Number(
          mad(rendered, sheet.profiles[namedSlot].profile).toFixed(5)),
        colourScore: Number(best.colourScore.toFixed(5)),
        correct: best.slot === namedSlot && best.orientation === "upright",
        // THE VERDICT THAT MATTERS, and why it is not `correct`.
        //
        // The defect this phase fixes moves a card to the mirrored grid ROW and
        // draws it upside down. It cannot move a card sideways. So the test for
        // it is "same row, upright" — and that test is decidable from the alpha
        // profile alone, which is what makes it trustworthy.
        //
        // `correct` additionally demands the exact slot, and on one sheet that
        // is not decidable here: the emissive atlas's amber and red lamp cells
        // (slots 0 and 2, same row) are the same artwork, and their colour is
        // carried by `card.tint` at runtime, which this isolated render leaves
        // out on purpose. Those cards report rowCorrect true, mad 0, and an
        // ambiguous slot — a limit of the measurement, not a mirrored card.
        namedRow: Math.floor(namedSlot / sheet.columns),
        drawnRow: Math.floor(best.slot / sheet.columns),
        rowCorrect: Math.floor(best.slot / sheet.columns)
          === Math.floor(namedSlot / sheet.columns)
          && best.orientation === "upright",
        profile: rendered.map((v) => Number(v.toFixed(4))),
        image: canvas.toDataURL(),
      });
    }
  }
  return results;
}, [map, CELL_NAMES]);

const rows = [];
for (const result of report) {
  const file = `${outDir}/${result.zone}-${result.namedCell}.png`;
  writeFileSync(file, Buffer.from(result.image.split(",")[1], "base64"));
  delete result.image;
  rows.push(result);
  const flag = result.correct ? "OK   "
    : result.rowCorrect ? "AMBIG" : "WRONG";
  console.log(
    `${flag} ${result.zone.padEnd(28)} `
    + `names ${result.namedCell.padEnd(16)} draws ${result.drawnCell.padEnd(16)} `
    + `${result.orientation.padEnd(8)} mad=${result.mad}`,
  );
}
const wrong = rows.filter((r) => !r.rowCorrect).length;
const ambiguous = rows.filter((r) => r.rowCorrect && !r.correct).length;
console.log(
  `${rows.length} zone/rect pairs on ${map}; ${wrong} on the wrong grid row or `
  + `upside down; ${ambiguous} on the right row with an ambiguous column`,
);
writeFileSync(`${outDir}/cells.json`, JSON.stringify(rows, null, 2));
await browser.close();
