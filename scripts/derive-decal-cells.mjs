/**
 * P17 task 1 — measures the TOTEM decal-cell UV rects out of the runtime GLB.
 *
 * WHY THIS EXISTS. `TOTEM_LIVERY_WEAR.json` shipped in P15 with an
 * `openDependency`: "the 12 decal_* cell rects from totem.js". They were never
 * published in `totem/MANIFEST.json`, so the wear pass was gated to the paint
 * chip strip and the twelve library slots (grime, repair plates, the NEEDLE
 * REPAIR stencil) sat authored-but-unapplied. This script closes that
 * dependency by MEASURING the rects rather than asking for them, so a future
 * GLB re-export is detectable instead of silently moving the wear.
 *
 * WHAT IT MEASURES. Every `TOTEM_body` primitive in `totem_runtime.glb`. The
 * hull's UVs collapse to a single paint-chip centre (all on one row), so the
 * decal quads are exactly the triangles that are NOT on that row. Those
 * triangles are grouped into geometric islands by shared vertex position, and
 * the islands are then bucketed by their exact UV bounding rect. Twelve
 * distinct rects come back; nineteen quads share them.
 *
 * THE UV CONVENTION, STATED ONCE. Pixel rects in this file — and in the JSON it
 * writes — are in the SERVED-SHEET convention: origin top-left, +Y down, on the
 * 1024x1024 PNG as `ATLAS_REGIONS.json` and `totem/MANIFEST.json` describe it.
 * That is the `THREE.Texture.flipY = true` orientation (`SERVED_LIVERY_FLIP_Y`
 * in `src/game/totem.ts`), so
 *
 *     u = x / 1024                 x = u * 1024
 *     v = 1 - (y + h) / 1024       y = (1 - vMax) * 1024
 *
 * The check that this is the right way round and not its mirror: the paint-chip
 * strip is declared at image rows 900-996, centre row 948, and every hull vertex
 * in the GLB sits at v = 0.07421875 = 1 - 948/1024. It falls out to the texel.
 * The GLB's own embedded copy of the sheet is the vertical flip of the served
 * one and is loaded with `flipY = false`; the two conventions cancel. Nothing
 * here touches that — see the `SERVED_LIVERY_FLIP_Y` note in `totem.ts`.
 *
 * WHAT IT WRITES — two files, one pass, so they cannot drift:
 *
 *   src/game/data/TOTEM_DECAL_CELLS.json
 *     The measurement. Every cell with its pixel rect, UV rect, quad count and
 *     per-quad provenance (node, material, vertex count, model-space AABB), plus
 *     the GLB's sha256. Read by `validate-art-pass.mjs` and by people. NOT
 *     imported by the runtime.
 *
 *   src/game/data/TOTEM_WEAR_CELLS.json
 *     The runtime table: the twelve wear placements resolved down to
 *     `{ slot, cell, dst[4], src[4], scale }` and nothing else. This is what
 *     `src/game/totem.ts` imports. The reasoning behind each placement lives in
 *     `TOTEM_WEAR_PLACEMENT.json`, which the runtime never sees — the initial JS
 *     bundle is budgeted at 225 KiB gzip in `validate-build.mjs` and an argument
 *     about where soot belongs does not need to travel down the wire.
 *
 * USAGE
 *   node scripts/derive-decal-cells.mjs            # rewrite both JSON files
 *   node scripts/derive-decal-cells.mjs --check    # fail if either would change
 *
 * `--check` is what makes the derivation idempotent, following P16's
 * `derive-drivable-limits.mjs`: re-running must produce byte-identical output or
 * the GLB moved under the data.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const GLB_PATH = "public/assets/totem/models/totem_runtime.glb";
const OUT_PATH = "src/game/data/TOTEM_DECAL_CELLS.json";
const RUNTIME_PATH = "src/game/data/TOTEM_WEAR_CELLS.json";
const WEAR_PATH = "src/game/data/TOTEM_LIVERY_WEAR.json";
const PLACEMENT_PATH = "src/game/data/TOTEM_WEAR_PLACEMENT.json";
const ATLAS_PATH = "src/game/data/ATLAS_REGIONS.json";
const WEAR_SHEET_KEY = "totem_wear_1024";
const SHEET_SIZE = 1024;
const BODY_MATERIAL = "TOTEM_body";
/** Positions this close (metres) are one vertex for island grouping. */
const WELD_TOLERANCE_METRES = 1e-5;
/** The measurement is only meaningful if it finds exactly this many cells. */
const EXPECTED_CELLS = 12;

function fail(message) {
  console.error(`derive-decal-cells: ${message}`);
  process.exit(1);
}

// --- GLB reading ------------------------------------------------------------

function readGlb(path) {
  const bytes = readFileSync(path);
  if (bytes.toString("ascii", 0, 4) !== "glTF") fail(`${path} is not a GLB.`);
  let offset = 12;
  let json = null;
  let bin = null;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.toString("utf8", offset + 4, offset + 8);
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "JSON") json = JSON.parse(body.toString("utf8").trim());
    else if (type.startsWith("BIN")) bin = body;
    offset += 8 + length;
  }
  if (!json || !bin) fail(`${path} is missing its JSON or BIN chunk.`);
  return { json, bin, sha256: createHash("sha256").update(bytes).digest("hex") };
}

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function readAccessor(glb, index) {
  const accessor = glb.json.accessors[index];
  if (accessor.componentType !== 5126) {
    fail(`accessor ${index} is componentType ${accessor.componentType}, not float.`);
  }
  const view = glb.json.bufferViews[accessor.bufferView];
  const components = COMPONENTS[accessor.type];
  const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const stride = view.byteStride ?? components * 4;
  const out = new Array(accessor.count);
  for (let i = 0; i < accessor.count; i += 1) {
    const row = new Array(components);
    for (let c = 0; c < components; c += 1) {
      row[c] = glb.bin.readFloatLE(base + i * stride + c * 4);
    }
    out[i] = row;
  }
  return out;
}

/** Node names that draw each mesh, so a cell can name where it came from. */
function meshNodeNames(glb) {
  const names = new Map();
  for (const [index, node] of glb.json.nodes.entries()) {
    if (node.mesh === undefined) continue;
    const list = names.get(node.mesh) ?? [];
    list.push(node.name ?? `node_${index}`);
    names.set(node.mesh, list);
  }
  return names;
}

// --- Island grouping --------------------------------------------------------

class DisjointSet {
  #parent = new Map();

  add(key) {
    if (!this.#parent.has(key)) this.#parent.set(key, key);
  }

  find(key) {
    let node = key;
    while (this.#parent.get(node) !== node) {
      this.#parent.set(node, this.#parent.get(this.#parent.get(node)));
      node = this.#parent.get(node);
    }
    return node;
  }

  union(a, b) {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.#parent.set(rootA, rootB);
  }
}

/** Quantised position key, so a shared corner welds two triangles together. */
function positionKey(position) {
  const q = 1 / WELD_TOLERANCE_METRES;
  return position.map((value) => Math.round(value * q)).join(",");
}

function roundTo(value, places) {
  return Number(value.toFixed(places));
}

// --- Measurement ------------------------------------------------------------

const glb = readGlb(resolve(root, GLB_PATH));
const nodeNames = meshNodeNames(glb);

/** Every hull vertex sits on this row; it is the chip strip's centre. */
let chipRowV = null;
const bodyPrimitives = [];
for (const [meshIndex, mesh] of glb.json.meshes.entries()) {
  for (const [primitiveIndex, primitive] of mesh.primitives.entries()) {
    const material = glb.json.materials[primitive.material];
    if (material?.name !== BODY_MATERIAL) continue;
    if (primitive.indices !== undefined) {
      fail(
        `${BODY_MATERIAL} primitive ${meshIndex}/${primitiveIndex} is indexed; this `
          + "measurement assumes the runtime GLB's non-indexed triangle soup.",
      );
    }
    if (primitive.attributes.TEXCOORD_0 === undefined) {
      fail(`${BODY_MATERIAL} primitive ${meshIndex}/${primitiveIndex} has no TEXCOORD_0.`);
    }
    bodyPrimitives.push({
      meshIndex,
      primitiveIndex,
      node: (nodeNames.get(meshIndex) ?? [`mesh_${meshIndex}`]).join("+"),
      uv: readAccessor(glb, primitive.attributes.TEXCOORD_0),
      position: readAccessor(glb, primitive.attributes.POSITION),
    });
  }
}
if (bodyPrimitives.length === 0) fail(`no ${BODY_MATERIAL} primitive found in ${GLB_PATH}.`);

// The chip row is the single v shared by the overwhelming majority of vertices.
{
  const histogram = new Map();
  for (const primitive of bodyPrimitives) {
    for (const [, v] of primitive.uv) histogram.set(v, (histogram.get(v) ?? 0) + 1);
  }
  const [row, count] = [...histogram.entries()].sort((a, b) => b[1] - a[1])[0];
  const total = [...histogram.values()].reduce((sum, n) => sum + n, 0);
  if (count / total < 0.9) {
    fail(
      `the dominant UV row v=${row} covers only ${(count / total * 100).toFixed(1)}% of `
        + `${BODY_MATERIAL} vertices. The hull is supposed to collapse onto the chip `
        + "strip; this GLB does not, so the chip/decal split below is not valid.",
    );
  }
  chipRowV = row;
}

const islands = [];
for (const primitive of bodyPrimitives) {
  const triangles = primitive.uv.length / 3;
  if (!Number.isInteger(triangles)) {
    fail(`${primitive.node} does not hold complete triangles.`);
  }
  const decalTriangles = [];
  for (let t = 0; t < triangles; t += 1) {
    const onChipRow = [0, 1, 2].every((k) => primitive.uv[t * 3 + k][1] === chipRowV);
    if (!onChipRow) decalTriangles.push(t);
  }
  if (decalTriangles.length === 0) continue;

  const sets = new DisjointSet();
  const firstTriangleAt = new Map();
  for (const t of decalTriangles) sets.add(t);
  for (const t of decalTriangles) {
    for (let k = 0; k < 3; k += 1) {
      const key = positionKey(primitive.position[t * 3 + k]);
      const seen = firstTriangleAt.get(key);
      if (seen === undefined) firstTriangleAt.set(key, t);
      else sets.union(t, seen);
    }
  }
  const grouped = new Map();
  for (const t of decalTriangles) {
    const root = sets.find(t);
    const list = grouped.get(root) ?? [];
    list.push(t);
    grouped.set(root, list);
  }
  for (const list of grouped.values()) {
    let u0 = Infinity;
    let v0 = Infinity;
    let u1 = -Infinity;
    let v1 = -Infinity;
    const aabb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const t of list) {
      for (let k = 0; k < 3; k += 1) {
        const [u, v] = primitive.uv[t * 3 + k];
        u0 = Math.min(u0, u);
        u1 = Math.max(u1, u);
        v0 = Math.min(v0, v);
        v1 = Math.max(v1, v);
        const p = primitive.position[t * 3 + k];
        for (let axis = 0; axis < 3; axis += 1) {
          aabb[axis] = Math.min(aabb[axis], p[axis]);
          aabb[axis + 3] = Math.max(aabb[axis + 3], p[axis]);
        }
      }
    }
    islands.push({
      node: primitive.node,
      meshIndex: primitive.meshIndex,
      primitiveIndex: primitive.primitiveIndex,
      triangles: list.length,
      vertices: list.length * 3,
      uvRect: [u0, v0, u1, v1],
      aabb,
    });
  }
}

// Bucket the islands by their exact UV rect. That bucket IS a decal cell: one
// atlas cell, however many quads happen to be cut against it.
const byRect = new Map();
for (const island of islands) {
  const key = island.uvRect.join(",");
  const bucket = byRect.get(key) ?? { uvRect: island.uvRect, islands: [] };
  bucket.islands.push(island);
  byRect.set(key, bucket);
}

const cells = [...byRect.values()]
  .map((bucket) => {
    const [u0, v0, u1, v1] = bucket.uvRect;
    const rectPx = [
      Math.round(u0 * SHEET_SIZE),
      Math.round((1 - v1) * SHEET_SIZE),
      Math.round((u1 - u0) * SHEET_SIZE),
      Math.round((v1 - v0) * SHEET_SIZE),
    ];
    const aabb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const island of bucket.islands) {
      for (let axis = 0; axis < 3; axis += 1) {
        aabb[axis] = Math.min(aabb[axis], island.aabb[axis]);
        aabb[axis + 3] = Math.max(aabb[axis + 3], island.aabb[axis + 3]);
      }
    }
    return {
      rectPx,
      uvRect: bucket.uvRect.map((value) => roundTo(value, 8)),
      quads: bucket.islands.length,
      triangles: bucket.islands.reduce((sum, island) => sum + island.triangles, 0),
      vertices: bucket.islands.reduce((sum, island) => sum + island.vertices, 0),
      provenance: bucket.islands
        .map((island) => ({
          node: island.node,
          material: BODY_MATERIAL,
          primitive: `${island.meshIndex}/${island.primitiveIndex}`,
          vertices: island.vertices,
          aabb: island.aabb.map((value) => roundTo(value, 4)),
        }))
        .sort((a, b) => a.aabb[0] - b.aabb[0] || a.aabb[2] - b.aabb[2]),
      aabb: aabb.map((value) => roundTo(value, 4)),
    };
  })
  // Sheet reading order: top band first, then left to right. Deterministic, and
  // it is the order a person reads the PNG in.
  .sort((a, b) => a.rectPx[1] - b.rectPx[1] || a.rectPx[0] - b.rectPx[0]);

cells.forEach((cell, index) => {
  cell.id = `decal_${String(index + 1).padStart(2, "0")}`;
});

// --- Assertions the measurement must survive --------------------------------

if (cells.length !== EXPECTED_CELLS) {
  fail(
    `measured ${cells.length} decal cells, not ${EXPECTED_CELLS}. `
      + `totem/MANIFEST.json declares 12 decal_* materials, one per atlas cell. `
      + "Either the GLB was re-exported with a different UV layout or the chip/decal "
      + `split above is wrong. Measured rects: ${cells.map((c) => `[${c.rectPx}]`).join(" ")}`,
  );
}

const chipRect = [
  0,
  (1 - (900 + 96) / SHEET_SIZE),
  896 / SHEET_SIZE,
  (1 - 900 / SHEET_SIZE),
];
for (const cell of cells) {
  const [u0, v0, u1, v1] = cell.uvRect;
  if (u1 <= u0 || v1 <= v0) fail(`${cell.id} has no extent: [${cell.uvRect}].`);
  if (u0 < 0 || v0 < 0 || u1 > 1 || v1 > 1) fail(`${cell.id} leaves the sheet.`);
  // A decal cell that overlapped the chip strip would make the two multiplies
  // stack on the same texel and the chip read would stop being the spec's number.
  const overlapsChip = u0 < chipRect[2] && u1 > chipRect[0]
    && v0 < chipRect[3] && v1 > chipRect[1];
  if (overlapsChip) {
    fail(`${cell.id} [${cell.rectPx}] overlaps the paint-chip strip.`);
  }
}
for (let i = 0; i < cells.length; i += 1) {
  for (let j = i + 1; j < cells.length; j += 1) {
    const a = cells[i].uvRect;
    const b = cells[j].uvRect;
    if (a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]) {
      fail(
        `${cells[i].id} [${cells[i].rectPx}] and ${cells[j].id} [${cells[j].rectPx}] `
          + "overlap. The runtime picks one cell per fragment by summing disjoint "
          + "rect tests; overlapping rects would sample two cells at once.",
      );
    }
  }
}

// --- The runtime table ------------------------------------------------------
//
// The wear spec's slot table is the contract this measurement exists to serve.
// If a placement names a cell id that did not come back, the wear pass would be
// applied at a rect nobody measured — which is the exact failure this phase is
// closing. Fail here rather than let the runtime paint a guess.

const wear = JSON.parse(readFileSync(resolve(root, WEAR_PATH), "utf8"));
const placement = JSON.parse(readFileSync(resolve(root, PLACEMENT_PATH), "utf8"));
const atlas = JSON.parse(readFileSync(resolve(root, ATLAS_PATH), "utf8"));
const wearRegions = atlas[WEAR_SHEET_KEY]?.regions;
if (!wearRegions) fail(`${ATLAS_PATH} has no ${WEAR_SHEET_KEY} sheet.`);

const measuredIds = new Set(cells.map((cell) => cell.id));
const cellById = new Map(cells.map((cell) => [cell.id, cell]));
const slotNames = new Set(wear.librarySlots.slots.map((entry) => entry.slot));
const placements = placement.placements ?? [];
const usedCells = new Set();
const runtimeCells = [];
for (const entry of placements) {
  if (!measuredIds.has(entry.cell)) {
    fail(
      `${PLACEMENT_PATH} places ${entry.slot} at cell ${entry.cell}, which this `
        + `measurement did not find. Measured: ${[...measuredIds].join(", ")}.`,
    );
  }
  if (!slotNames.has(entry.slot)) {
    fail(
      `${PLACEMENT_PATH} places ${entry.slot}, which is not in `
        + `${WEAR_PATH}'s slot table.`,
    );
  }
  const region = wearRegions[entry.slot];
  if (!region) {
    fail(`${entry.slot} has no region on ${WEAR_SHEET_KEY}; it cannot be sampled.`);
  }
  if (usedCells.has(entry.cell)) {
    fail(`${PLACEMENT_PATH} places two slots at cell ${entry.cell}.`);
  }
  usedCells.add(entry.cell);
  const scale = Number.isFinite(entry.scale) ? entry.scale : 1;
  if (!(scale > 0 && scale <= 1)) {
    fail(
      `${entry.slot} asks for scale ${entry.scale}. The sheet is authored at its full `
        + "strength and a per-slot scale can only hold it back, so it must be in (0, 1].",
    );
  }
  const sheet = atlas[WEAR_SHEET_KEY];
  runtimeCells.push({
    slot: entry.slot,
    cell: entry.cell,
    // Destination: the measured decal cell, on the hull's own UV.
    dst: cellById.get(entry.cell).uvRect,
    // Source: the authored library slot, on the wear sheet, in the same served
    // (flipY = true) convention the chip strip already uses.
    src: [
      region.x / sheet.width,
      1 - (region.y + region.h) / sheet.height,
      (region.x + region.w) / sheet.width,
      1 - region.y / sheet.height,
    ].map((value) => roundTo(value, 8)),
    scale,
  });
}
const unplaced = [...slotNames].filter(
  (slot) => !placements.some((entry) => entry.slot === slot),
);
if (unplaced.length > 0) {
  fail(
    `the wear library leaves ${unplaced.join(", ")} unplaced. Every authored slot `
      + "must land on a cell or it is art nobody will ever see.",
  );
}

// --- Output -----------------------------------------------------------------

const output = {
  id: "TOTEM_DECAL_CELLS_v1",
  pass: "P17 — decal-cell UV rects, measured",
  producedBy: "scripts/derive-decal-cells.mjs",
  source: {
    glb: GLB_PATH,
    sha256: glb.sha256,
    material: BODY_MATERIAL,
    note:
      "The sha256 is the detection mechanism for a GLB re-export: if the hull's UV "
      + "layout moves, this hash moves with it and validate-art-pass fails before the "
      + "wear overlay is painted at rects that no longer exist.",
  },
  convention: {
    sheet: "1024x1024 SERVED PNG, origin top-left, +Y down",
    flipY: true,
    flipYSource: "SERVED_LIVERY_FLIP_Y in src/game/totem.ts",
    rectPx: "[x, y, w, h] in served-sheet pixels",
    uvRect: "[uMin, vMin, uMax, vMax]; u = x/1024, vMin = 1 - (y+h)/1024",
    proof:
      "The paint-chip strip is declared at image rows 900-996 (centre 948) and every "
      + "hull vertex in the GLB reads v = 0.07421875 = 1 - 948/1024. The convention "
      + "lands on the texel, so it is measured rather than assumed.",
  },
  chipRowV: roundTo(chipRowV, 8),
  sheetSize: SHEET_SIZE,
  cellCount: cells.length,
  quadCount: cells.reduce((sum, cell) => sum + cell.quads, 0),
  cells: cells.map((cell) => ({
    id: cell.id,
    rectPx: cell.rectPx,
    uvRect: cell.uvRect,
    quads: cell.quads,
    triangles: cell.triangles,
    vertices: cell.vertices,
    aabb: cell.aabb,
    provenance: cell.provenance,
  })),
};

/**
 * The RUNTIME table. Deliberately austere: `src/game/totem.ts` imports this
 * file and it lands in the initial JS bundle, which `validate-build.mjs` caps at
 * 225 KiB gzip. Everything a person needs to understand or argue with lives in
 * TOTEM_DECAL_CELLS.json and TOTEM_WEAR_PLACEMENT.json, neither of which the
 * runtime imports.
 */
const runtimeOutput = {
  id: "TOTEM_WEAR_CELLS_v1",
  from: [OUT_PATH, PLACEMENT_PATH, `${ATLAS_PATH}#${WEAR_SHEET_KEY}`],
  producedBy: "scripts/derive-decal-cells.mjs",
  uv: "dst = measured decal cell on the hull UV; src = library slot on the wear "
    + "sheet; both [uMin, vMin, uMax, vMax], flipY = true",
  cells: runtimeCells,
};

const targets = [
  { path: OUT_PATH, body: `${JSON.stringify(output, null, 1)}\n` },
  { path: RUNTIME_PATH, body: `${JSON.stringify(runtimeOutput, null, 1)}\n` },
];

if (process.argv.includes("--check")) {
  for (const target of targets) {
    let existing = null;
    try {
      existing = readFileSync(resolve(root, target.path), "utf8");
    } catch {
      fail(`${target.path} does not exist. Run without --check to write it.`);
    }
    if (existing !== target.body) {
      fail(
        `${target.path} is not what this GLB derives. The measurement is not `
          + "idempotent, which means the committed data and the shipped model "
          + "disagree. Re-run without --check and review the diff.",
      );
    }
  }
  console.log(
    `Decal cells CHECK: ${cells.length} cells / ${output.quadCount} quads and `
      + `${runtimeCells.length} wear placements re-derived identical from ${GLB_PATH}.`,
  );
} else {
  for (const target of targets) writeFileSync(resolve(root, target.path), target.body);
  console.log(
    `Decal cells: ${cells.length} cells / ${output.quadCount} quads measured from `
      + `${GLB_PATH} -> ${OUT_PATH}; ${runtimeCells.length} wear placements resolved `
      + `-> ${RUNTIME_PATH}`,
  );
  const bySlot = new Map(runtimeCells.map((entry) => [entry.cell, entry]));
  for (const cell of cells) {
    const entry = bySlot.get(cell.id);
    console.log(
      `  ${cell.id} px=[${cell.rectPx.join(",")}] quads=${cell.quads} `
        + `verts=${cell.vertices} <- ${entry ? `${entry.slot} @${entry.scale}` : "(unplaced)"}`,
    );
  }
}
