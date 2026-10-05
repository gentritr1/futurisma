/**
 * Bakes Greenwater's corridor relocation (P16 task 3) into data.
 *
 * WHY. `relocateCorridorObstacles` (src/game/course-repair.ts) projects every
 * vertex of `greenwater_environment_runtime.glb` onto the course, mostly through
 * `course.project`'s global search. Measured on the prod build it blocks the
 * main thread ~900 ms (881/906/903 ms over three runs), and because Greenwater
 * loaded its environment AFTER the menu appeared, that block landed on the
 * menu: ~2 s frozen right after it showed. The GLB is sha256-pinned by
 * `validate-assets.mjs` and the pass is a pure function of the GLB and the
 * course, so its answer is the same on every session — it is data.
 *
 * WHAT IT DOES. Replays the runtime pipeline under Node with the game's own
 * modules (vite `ssrLoadModule`, the way `build-launch-atlas.mjs` builds
 * courses): GLTFLoader on the GLB with its images stripped (geometry and node
 * transforms are untouched), `repairGreenwaterRuntimeGeometry` (the hangar
 * barriers and the signature-parcel marsh plants, exactly as `load` runs
 * them), then the real `relocateCorridorObstacles` with the real options. It
 * diffs every position attribute before/after and writes the vertices that
 * moved, with their new local positions, to
 *
 *   src/game/data/GREENWATER_CORRIDOR_RELOCATION.json
 *
 * which `src/game/corridor-bake.ts` applies at load in O(moved vertices). The
 * runtime keeps the full pass as its fallback (and `?corridorbake=0` forces
 * it), so a precondition that does not hold costs time, never correctness.
 *
 * USAGE
 *   node scripts/derive-corridor-relocation.mjs           # rewrite the JSON
 *   node scripts/derive-corridor-relocation.mjs --check   # fail if it would change
 *
 * `--check` follows `derive-decal-cells.mjs --check`: re-deriving must be
 * byte-identical, or the GLB, the course or the relocation moved under the data.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GLB_PATH = "public/assets/greenwater/models/greenwater_environment_runtime.glb";
const OUT_PATH = "src/game/data/GREENWATER_CORRIDOR_RELOCATION.json";
const check = process.argv.includes("--check");

function fail(message) {
  console.error(`derive-corridor-relocation: ${message}`);
  process.exit(1);
}

/** The GLB with every image reference removed, so Node's GLTFLoader never needs a DOM. */
function geometryOnlyGlb(bytes) {
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
  if (!json || !bin) fail(`${GLB_PATH} is missing its JSON or BIN chunk.`);
  delete json.textures;
  delete json.images;
  delete json.samplers;
  const stripTextures = (value) => {
    if (!value || typeof value !== "object") return;
    for (const key of Object.keys(value)) {
      if (/Texture$/.test(key)) delete value[key];
      else stripTextures(value[key]);
    }
  };
  for (const material of json.materials ?? []) stripTextures(material);
  let text = Buffer.from(JSON.stringify(json), "utf8");
  text = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const binPadded = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4, 0)]);
  const out = Buffer.alloc(12 + 8 + text.length + 8 + binPadded.length);
  out.write("glTF", 0, "ascii");
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(text.length, 12);
  out.write("JSON", 16, "ascii");
  text.copy(out, 20);
  const binAt = 20 + text.length;
  out.writeUInt32LE(binPadded.length, binAt);
  out.write("BIN\0", binAt + 4, "ascii");
  binPadded.copy(out, binAt + 8);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}

/** Shortest decimal that reads back as the same float32. */
function f32(value) {
  for (let digits = 6; digits <= 9; digits += 1) {
    const text = Number(value.toPrecision(digits));
    if (Math.fround(text) === value) return text;
  }
  return value;
}

// Course constructors author canvas sign textures; nothing here renders them.
globalThis.document = { createElement: () => ({ width: 1, height: 1, getContext: () => new Proxy({ measureText: (t) => ({ width: t.length * 10 }), createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }) }, { get: (o, k) => o[k] ?? (() => {}) }) }) };

const glbBytes = readFileSync(resolve(root, GLB_PATH));
const sha256 = createHash("sha256").update(glbBytes).digest("hex");
const server = await createServer({ root, configFile: false, server: { middlewareMode: true, hmr: false }, appType: "custom", logLevel: "error", optimizeDeps: { noDiscovery: true } });
let output;
try {
  const THREE = await import("three");
  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  const { GreenwaterCourse } = await server.ssrLoadModule("/src/game/course.ts");
  const { repairGreenwaterRuntimeGeometry } = await server.ssrLoadModule("/src/game/environment.ts");
  const repair = await server.ssrLoadModule("/src/game/course-repair.ts");

  const course = new GreenwaterCourse();
  // At runtime `installCircuitSignature` has already parented the dock to the
  // course; the marsh-plant reservation only needs it to exist.
  const signature = new THREE.Group();
  signature.name = "circuit_signature";
  course.group.add(signature);

  const scene = (await new GLTFLoader().parseAsync(geometryOnlyGlb(glbBytes), "")).scene;
  const drift = [];
  repairGreenwaterRuntimeGeometry(scene, course, drift);
  if (drift.length > 0) fail(`the authored-asset contract drifted: ${drift.join(", ")}`);
  const hangar = scene.getObjectByName("GW_SECTOR_HANGAR_SIX_concrete");

  const meshes = [];
  const names = new Set();
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (names.has(object.name)) fail(`mesh name ${object.name} is not unique; the bake keys on names.`);
    names.add(object.name);
    const positions = object.geometry.getAttribute("position");
    meshes.push({ object, positions, before: Float32Array.from(positions.array) });
  });

  const stats = repair.relocateCorridorObstacles(scene, course, {
    lateralMargin: repair.OBSTACLE_LATERAL_MARGIN_METRES,
    heightMin: repair.OBSTACLE_HEIGHT_MIN_METRES,
    heightMax: repair.OBSTACLE_HEIGHT_MAX_METRES,
    seamTolerance: repair.OBSTACLE_SEAM_TOLERANCE_METRES,
  });

  const baked = [];
  for (const { object, positions, before } of meshes) {
    const after = positions.array;
    const vertices = [];
    const moved = [];
    let checksum = 0;
    for (let vertex = 0; vertex < positions.count; vertex += 1) {
      const at = vertex * 3;
      if (after[at] === before[at] && after[at + 1] === before[at + 1] && after[at + 2] === before[at + 2]) continue;
      vertices.push(vertex);
      moved.push(f32(after[at]), f32(after[at + 1]), f32(after[at + 2]));
      checksum += before[at] + before[at + 1] + before[at + 2];
    }
    if (vertices.length === 0) continue;
    // Moved vertices come in contiguous index runs (41 runs for 18k vertices on
    // the accepted GLB), so they are stored as [first, count] pairs.
    const runs = [];
    for (const vertex of vertices) {
      const last = runs.at(-1);
      if (last && last[0] + last[1] === vertex) last[1] += 1;
      else runs.push([vertex, 1]);
    }
    baked.push({ mesh: object.name, vertexCount: positions.count, beforeChecksum: Number(checksum.toFixed(3)), runs, positions: moved });
  }
  const movedVertices = baked.reduce((sum, entry) => sum + entry.positions.length / 3, 0);
  if (stats.relocated === 0 || movedVertices === 0) fail("the relocation moved nothing; the bake would be vacuous.");

  output = {
    comment: "Generated by scripts/derive-corridor-relocation.mjs. Do not edit; re-derive.",
    source: GLB_PATH,
    sha256,
    options: {
      lateralMargin: repair.OBSTACLE_LATERAL_MARGIN_METRES,
      heightMin: repair.OBSTACLE_HEIGHT_MIN_METRES,
      heightMax: repair.OBSTACLE_HEIGHT_MAX_METRES,
      seamTolerance: repair.OBSTACLE_SEAM_TOLERANCE_METRES,
    },
    // Runtime preconditions: the bake is only valid on the input it was derived from.
    preconditions: {
      relocatedMarshPlants: signature.userData.relocatedMarshPlants,
      hangarComponents: hangar.userData.runtimeRouteRepair.relocatedComponents,
    },
    stats: { components: stats.components, relocated: stats.relocated, maxShiftMetres: stats.maxShiftMetres, moved: stats.moved },
    movedVertices,
    meshes: baked,
  };
} finally {
  await server.close();
}

const text = `${JSON.stringify(output)}\n`;
const path = resolve(root, OUT_PATH);
const summary = `${output.stats.relocated} components (max shift ${output.stats.maxShiftMetres} m) of ${output.stats.components}, `
  + `${output.movedVertices} vertices over ${output.meshes.length} meshes, ${(text.length / 1024).toFixed(1)} KiB, GLB ${sha256.slice(0, 12)}`;
if (check) {
  let committed = "";
  try { committed = readFileSync(path, "utf8"); } catch { fail(`${OUT_PATH} is missing; run without --check.`); }
  if (committed !== text) fail(`${OUT_PATH} is stale: re-deriving changes it. Run node scripts/derive-corridor-relocation.mjs and review the diff.`);
  console.log(`Corridor relocation bake PASS (idempotent): ${summary}.`);
} else {
  writeFileSync(path, text);
  console.log(`Wrote ${OUT_PATH}: ${summary}.`);
}
