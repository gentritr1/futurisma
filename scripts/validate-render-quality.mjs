import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  calculateMinimumPixelRatio,
  calculatePreferredPixelRatio,
  reconcilePixelRatioAfterResize,
} from "../src/game/render-quality.js";
import {
  ps2BayerThreshold,
  ps2ColorGradeChunk,
  ps2DitherChunk,
  ps2VertexSnapChunk,
  ps2VertexSnapUniformDeclaration,
  resolvePs2SnapGrid,
  resolveRenderMode,
  DEFAULT_RENDER_MODE,
  PS2_BAYER_4X4,
  PS2_BAYER_MEAN,
  PS2_BLACK_CRUSH_KNEE,
  PS2_BLACK_CRUSH_STRENGTH,
  PS2_COLOR_STEPS,
  PS2_DITHER_STRENGTH,
  PS2_EXPOSURE,
  PS2_HIGHLIGHT_KNEE,
  PS2_SATURATION,
  PS2_SNAP_MAX_LINES,
  PS2_SNAP_MIN_LINES,
  PS2_SNAP_UNIFORM_NAME,
} from "../src/game/render-mode.js";

// P14 re-baseline: `adaptive` targets 720 lines with a 1.0 ratio cap (was 540
// lines / 0.82), so a 720p window renders 1:1 instead of at 960x540.
assert.equal(calculatePreferredPixelRatio(720, 2, "adaptive"), 1);
// The adaptive *floor* is deliberately unchanged at 360 lines / 0.65, so the
// p95 governor keeps the full downshift range it had before P14.
assert.equal(calculateMinimumPixelRatio(720, 2, "adaptive"), 0.5);
assert.ok(
  Math.abs(calculatePreferredPixelRatio(1_080, 2, "adaptive") - 2 / 3) < 1e-9,
);
assert.ok(
  Math.abs(calculateMinimumPixelRatio(1_080, 2, "adaptive") - 1 / 3) < 1e-9,
);
assert.ok(
  Math.abs(calculatePreferredPixelRatio(2_160, 2, "adaptive") - 1 / 3) < 1e-9,
);
// P14 re-baseline: `low` inherits the old adaptive target (540 lines, was 360)
// and keeps its own 0.65 cap, so at 720p it is still a real step down.
assert.equal(calculatePreferredPixelRatio(720, 2, "low"), 0.65);
assert.equal(calculateMinimumPixelRatio(720, 2, "low"), 0.65);
// `high` is untouched by P14.
assert.equal(calculatePreferredPixelRatio(720, 2, "high"), 1.25);

// The three modes must stay ordered, and adaptive must keep headroom to fall
// into — a preferred ratio pinned to its own floor would make the governor a
// no-op, which is the failure mode raising the target could have introduced.
for (const height of [480, 720, 900, 1_080, 1_440, 2_160]) {
  const low = calculatePreferredPixelRatio(height, 2, "low");
  const adaptive = calculatePreferredPixelRatio(height, 2, "adaptive");
  const high = calculatePreferredPixelRatio(height, 2, "high");
  assert.ok(
    low <= adaptive && adaptive <= high,
    `Quality modes fell out of order at ${height}px: ${low} / ${adaptive} / ${high}.`,
  );
  assert.ok(
    calculateMinimumPixelRatio(height, 2, "adaptive") < adaptive,
    `Adaptive has no downshift headroom at ${height}px; the p95 governor could `
      + "never reduce the render scale.",
  );
}

assert.equal(reconcilePixelRatioAfterResize(0.75, 0.75, 0.5, 1 / 3), 0.5);
assert.equal(reconcilePixelRatioAfterResize(0.58, 0.75, 0.6, 0.4), 0.58);
assert.equal(reconcilePixelRatioAfterResize(0.34, 0.5, 0.6, 0.4), 0.4);

// ---------------------------------------------------------------------------
// P4b — `?render=ps2` mode parsing.
// ---------------------------------------------------------------------------

assert.equal(DEFAULT_RENDER_MODE, "agx", "The default must stay AgX in P4b.");
assert.equal(resolveRenderMode("ps2"), "ps2");
assert.equal(resolveRenderMode("PS2"), "ps2");
assert.equal(resolveRenderMode("  ps2  "), "ps2");
assert.equal(resolveRenderMode("agx"), "agx");
for (const garbage of [null, undefined, "", "  ", "ps3", "PS2X", "1", "true"]) {
  assert.equal(
    resolveRenderMode(garbage),
    "agx",
    `resolveRenderMode(${JSON.stringify(garbage)}) must fall back to agx.`,
  );
}

// ---------------------------------------------------------------------------
// P4b — snap grid derived from the *internal* render target height.
// ---------------------------------------------------------------------------

// quality=high at 1280x720 CSS runs a 1600x900 backbuffer: half is 450, the
// PS2 band clamps it to 240 lines, and the columns follow the 16:9 aspect.
assert.deepEqual(resolvePs2SnapGrid(1_600, 900), { x: 427, y: 240 });
// quality=low lands inside the band, so the halving is what decides.
assert.deepEqual(resolvePs2SnapGrid(640, 360), { x: 320, y: 180 });
// Below the band the floor holds; above it the ceiling does.
assert.equal(resolvePs2SnapGrid(320, 200).y, PS2_SNAP_MIN_LINES);
assert.equal(resolvePs2SnapGrid(3_840, 2_160).y, PS2_SNAP_MAX_LINES);
// A degenerate target must not produce NaN or a zero grid (division by it is a
// vertex-stage divide, so a zero here would blank the world).
for (const [w, h] of [[0, 0], [-1, -1], [Number.NaN, 100], [100, Number.NaN]]) {
  const grid = resolvePs2SnapGrid(w, h);
  assert.ok(
    Number.isFinite(grid.x) && grid.x >= 1 && Number.isFinite(grid.y) && grid.y >= 1,
    `resolvePs2SnapGrid(${w}, ${h}) produced ${JSON.stringify(grid)}.`,
  );
}
// Inside the band, lines track height and never leave it.
let previousLines = 0;
for (let height = 100; height <= 2_000; height += 20) {
  const { x, y } = resolvePs2SnapGrid(Math.round(height * (16 / 9)), height);
  assert.ok(
    y >= PS2_SNAP_MIN_LINES && y <= PS2_SNAP_MAX_LINES,
    `Snap lines ${y} left the PS2 band at height ${height}.`,
  );
  assert.ok(y >= previousLines, `Snap lines fell from ${previousLines} to ${y}.`);
  assert.ok(x > y, "A 16:9 target must have more columns than lines.");
  previousLines = y;
}

// ---------------------------------------------------------------------------
// P4b — the 4x4 Bayer matrix the fragment stage computes in closed form.
// ---------------------------------------------------------------------------

assert.equal(PS2_BAYER_4X4.length, 16);
assert.equal(new Set(PS2_BAYER_4X4).size, 16, "Bayer entries must be distinct.");
for (let y = 0; y < 4; y += 1) {
  for (let x = 0; x < 4; x += 1) {
    assert.equal(
      ps2BayerThreshold(x, y),
      PS2_BAYER_4X4[y * 4 + x] / 16,
      `The closed form disagrees with the canonical Bayer matrix at (${x}, ${y}).`,
    );
  }
}
// The GLSL indexes gl_FragCoord, which is unbounded, so the form must tile.
for (const [x, y] of [[4, 0], [0, 4], [17, 23], [102, 55], [1_000, 999]]) {
  assert.equal(ps2BayerThreshold(x, y), ps2BayerThreshold(x % 4, y % 4));
}
assert.equal(
  PS2_BAYER_4X4.reduce((total, value) => total + value, 0) / 16 / 16,
  PS2_BAYER_MEAN,
  "PS2_BAYER_MEAN must be the matrix mean; the dither pivots on it.",
);

// The dither must not shift average brightness. Averaged over one Bayer tile,
// the quantized value has to sit within the residual the sub-unity strength
// leaves behind — that residual, not zero, is the honest bound.
const meanErrorBound = (1 - PS2_DITHER_STRENGTH) / 2 + PS2_DITHER_STRENGTH / 32;
for (const steps of [PS2_COLOR_STEPS.r, PS2_COLOR_STEPS.g, PS2_COLOR_STEPS.b]) {
  for (const value of [0, 0.013, 0.25, 0.5, 0.507, 0.75, 0.99, 1]) {
    let total = 0;
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        const threshold = 0.5
          + (ps2BayerThreshold(x, y) - PS2_BAYER_MEAN) * PS2_DITHER_STRENGTH;
        total += Math.min(1, Math.max(0, Math.floor(value * steps + threshold) / steps));
      }
    }
    assert.ok(
      Math.abs(total / 16 - value) <= meanErrorBound / steps + 1e-9,
      `RGB${steps + 1} dither shifted ${value} to ${total / 16}.`,
    );
  }
}

// The point of ordering the dither is that a value between two RGB565 steps
// resolves to *both* of them across the tile. Below roughly half strength the
// pattern stops spanning a step and banding comes back.
assert.ok(
  PS2_DITHER_STRENGTH > 0.5 && PS2_DITHER_STRENGTH <= 1,
  "PS2_DITHER_STRENGTH must span most of a quantization step.",
);
for (const steps of [PS2_COLOR_STEPS.r, PS2_COLOR_STEPS.g]) {
  const between = (Math.floor(0.5 * steps) + 0.5) / steps;
  const outputs = new Set();
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      const threshold = 0.5
        + (ps2BayerThreshold(x, y) - PS2_BAYER_MEAN) * PS2_DITHER_STRENGTH;
      outputs.add(Math.floor(between * steps + threshold));
    }
  }
  assert.equal(
    outputs.size,
    2,
    `A value halfway between RGB${steps + 1} steps must resolve to both of them `
      + `across the Bayer tile; it resolved to ${outputs.size}.`,
  );
}

// ---------------------------------------------------------------------------
// P4b — the grade's shape. This reference mirrors the GLSL below; the string
// assertions that follow are what keep the two carrying the same constants.
// ---------------------------------------------------------------------------

function gradeGrey(linear) {
  let value = Math.max(linear, 0) * PS2_EXPOSURE;
  const t = Math.min(1, Math.max(0, value / PS2_BLACK_CRUSH_KNEE));
  const toe = t * t * (3 - 2 * t);
  value *= 1 + (toe - 1) * PS2_BLACK_CRUSH_STRENGTH;
  const shoulder = 1 - PS2_HIGHLIGHT_KNEE;
  const knee = PS2_HIGHLIGHT_KNEE
    + shoulder * (1 - Math.exp(-Math.max(value - PS2_HIGHLIGHT_KNEE, 0) / shoulder));
  // Grey is its own luma, so the saturation lift is identity here.
  return Math.min(1, Math.max(0, Math.min(value, knee)));
}

assert.equal(gradeGrey(0), 0);
let previousGraded = -1;
for (let linear = 0; linear <= 6; linear += 0.005) {
  const graded = gradeGrey(linear);
  assert.ok(graded >= previousGraded - 1e-12, "The PS2 grade must be monotonic.");
  assert.ok(graded <= 1, "The PS2 grade must never exceed white.");
  previousGraded = graded;
}
// Crushed blacks, identity midrange, rolled highlights — the three claims.
assert.ok(
  gradeGrey(0.05) < 0.05 * PS2_EXPOSURE * 0.75,
  "The toe must visibly crush blacks.",
);
const midrange = 0.5;
assert.ok(
  Math.abs(gradeGrey(midrange) - midrange * PS2_EXPOSURE) < 1e-9,
  "The midrange must be identity — the sector palettes are authored, not filmic.",
);
assert.ok(gradeGrey(2) < 1 && gradeGrey(2) > PS2_HIGHLIGHT_KNEE, "Highlights roll off.");
assert.ok(PS2_SATURATION > 1, "AgX desaturates; the PS2 path must put it back.");

// ---------------------------------------------------------------------------
// P4b — the emitted GLSL carries those constants and compiles in isolation.
// ---------------------------------------------------------------------------

const glslFloat = (value) => {
  const text = String(value);
  return text.includes(".") || text.includes("e") ? text : `${text}.0`;
};

const snapChunk = ps2VertexSnapChunk();
const gradeChunk = ps2ColorGradeChunk();
const ditherChunk = ps2DitherChunk();

for (const [name, chunk] of Object.entries({ snapChunk, gradeChunk, ditherChunk })) {
  for (const [open, close] of [["{", "}"], ["(", ")"]]) {
    const opens = chunk.split(open).length - 1;
    const closes = chunk.split(close).length - 1;
    assert.equal(opens, closes, `${name} has unbalanced ${open}${close}.`);
  }
  assert.ok(
    !chunk.includes("#include"),
    `${name} must not re-emit a three.js chunk include.`,
  );
  assert.ok(
    !/(^|[^.\w])\d+\s*[)\/*+-]\s*[a-zA-Z_]/.test(chunk.replace(/\d+\.\d*/g, "F")),
    `${name} looks like it passes an int literal where GLSL wants a float.`,
  );
}

assert.ok(snapChunk.includes(PS2_SNAP_UNIFORM_NAME));
assert.ok(snapChunk.includes("gl_Position.xy"), "The snap must run in clip space.");
assert.ok(snapChunk.includes("floor("), "The snap must quantize, not smooth.");
assert.ok(
  /\*\s*gl_Position\.w/.test(snapChunk),
  "The snap must multiply w back in, or the perspective divide moves the vertex "
    + "a second time and near geometry tears away from the camera.",
);
assert.ok(
  /abs\(gl_Position\.w\)/.test(snapChunk),
  "The snap must guard w before dividing by it.",
);
assert.ok(
  ps2VertexSnapUniformDeclaration().includes(`uniform vec2 ${PS2_SNAP_UNIFORM_NAME};`),
);

for (const value of [
  PS2_EXPOSURE,
  PS2_BLACK_CRUSH_KNEE,
  PS2_BLACK_CRUSH_STRENGTH,
  PS2_HIGHLIGHT_KNEE,
  PS2_SATURATION,
]) {
  assert.ok(
    gradeChunk.includes(glslFloat(value)),
    `The grade GLSL dropped the constant ${value}.`,
  );
}
assert.ok(gradeChunk.includes("gl_FragColor.rgb"));
assert.ok(gradeChunk.includes("clamp("), "The grade must clamp before sRGB encode.");

// The dither GLSL must carry the same six coefficients the closed form uses.
for (const coefficient of [
  "8.0 * ps2X0",
  "12.0 * ps2Y0",
  "16.0 * ps2X0 * ps2Y0",
  "2.0 * ps2X1",
  "3.0 * ps2Y1",
  "4.0 * ps2X1 * ps2Y1",
]) {
  assert.ok(
    ditherChunk.includes(coefficient),
    `The dither GLSL dropped the Bayer term \`${coefficient}\`.`,
  );
}
for (const value of [
  PS2_COLOR_STEPS.r,
  PS2_COLOR_STEPS.g,
  PS2_COLOR_STEPS.b,
  PS2_BAYER_MEAN,
  PS2_DITHER_STRENGTH,
]) {
  assert.ok(
    ditherChunk.includes(glslFloat(value)),
    `The dither GLSL dropped the constant ${value}.`,
  );
}
assert.equal(PS2_COLOR_STEPS.g, PS2_COLOR_STEPS.r * 2 + 1, "RGB565 gives green a bit more.");
assert.ok(ditherChunk.includes("gl_FragCoord"), "Ordered dither is screen-space.");

// ---------------------------------------------------------------------------
// P4b — wiring. Vertex snap is course + environment only; the craft, the
// rivals and the sky must stay smooth, and the HUD is never touched.
// ---------------------------------------------------------------------------

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

// P14 re-baseline: two of these call sites grew a second option, so the check
// is now "the call opts world geometry in" rather than one exact string.
for (const [path, receiver] of [
  ["src/game/game.ts", "this.course.group"],
  ["src/game/environment.ts", "root"],
  ["src/game/bitterpan-environment.ts", "root"],
  ["src/game/scene-assets.ts", "gltf.scene"],
]) {
  const source = read(path);
  const call = new RegExp(
    `applyPs2MaterialTreatment\\(\\s*${receiver.replace(".", "\\.")},\\s*\\{[^}]*worldGeometry:\\s*true`,
  );
  assert.match(
    source,
    call,
    `${path} must opt its world geometry into the PS2 vertex snap via `
      + `applyPs2MaterialTreatment(${receiver}, { worldGeometry: true, ... }).`,
  );
}
const totem = read("src/game/totem.ts");
assert.ok(
  /applyPs2MaterialTreatment\(this\.model\)/.test(totem),
  "The player craft must take the treatment without `worldGeometry` — a snapping "
    + "ship is a readability bug, not a period detail.",
);
assert.ok(
  /applyPs2ShaderTreatment\(clone, false\)/.test(totem),
  "Rival material clones must be re-armed without `worldGeometry`; `Material.copy` "
    + "carries neither onBeforeCompile nor the program cache key.",
);
assert.ok(
  totem.includes("material.customProgramCacheKey = () => cacheKey;"),
  "Every PS2 variant must declare its own program cache key, or a snapped course "
    + "material and an unsnapped hull material collide on one compiled program.",
);
const atmosphere = read("src/game/atmosphere.ts");
assert.ok(
  atmosphere.includes("THREE.NoToneMapping")
    && atmosphere.includes("THREE.AgXToneMapping"),
  "atmosphere.ts owns the tone-mapping branch for both modes.",
);
assert.ok(
  !read("src/style.css").includes("ps2")
    && !read("src/game/ui.ts").includes("ps2"),
  "P4b must not touch the HUD or the CSS scanline layer.",
);

// ---------------------------------------------------------------------------
// P14 — MSAA, and the surgical split between pixel-authored and painterly
// texture classes. The point of the split is that it is *surgical*: the sheets
// `scripts/design/atlas-draw.mjs` draws texel-by-texel keep point sampling, and
// only the baked GLB sheets take the smooth class.
// ---------------------------------------------------------------------------

assert.match(
  read("src/game/game.ts"),
  /antialias:\s*prefersMultisampling\(\)/,
  "P14 turns MSAA on through totem.ts's mode-aware helper, not a bare literal — "
    + "geometry-edge shimmer at speed is the loudest artifact at the raised "
    + "internal target, but `?render=ps2` has to keep its snapped, jagged edges.",
);
assert.match(
  totem,
  /export function prefersMultisampling\(\): boolean \{\s*return activeRenderMode\(\) !== "ps2";/,
  "prefersMultisampling must be false in ps2 mode; smoothing the snapped "
    + "silhouettes would take the era out of the era mode.",
);

// The two classes, and the exact filters each one carries.
assert.match(
  totem,
  /pixel:\s*\{\s*magFilter:\s*THREE\.NearestFilter,\s*minFilter:\s*THREE\.NearestMipmapLinearFilter,\s*anisotropy:\s*1,/,
  "The pixel class must stay point-sampled: the runway, signage and motion "
    + "atlases plus the livery decal sheets are authored texel-by-texel and a "
    + "linear magnifier smears exactly the stem weights atlas-draw.mjs protects.",
);
assert.match(
  totem,
  /painterly:\s*\{\s*magFilter:\s*THREE\.LinearFilter,\s*minFilter:\s*THREE\.LinearMipmapLinearFilter,\s*anisotropy:\s*1,/,
  "The painterly class must be linear in both directions: the baked GLB sheets "
    + "are painted at 1024 with sub-texel noise, so point sampling only buys "
    + "minification speckle.",
);
assert.match(
  totem,
  /activeRenderMode\(\) === "ps2"\s*\?\s*TEXTURE_FILTER_CLASSES\.pixel/,
  "`?render=ps2` must force the pixel class regardless of the authored "
    + "character, or P14 would quietly re-grade the era-accurate opt-in.",
);

// Who takes which class. Only the baked environment GLBs opt into painterly.
for (const path of ["src/game/environment.ts", "src/game/bitterpan-environment.ts"]) {
  assert.match(
    read(path),
    /textureCharacter:\s*"painterly"/,
    `${path} carries a baked/painted GLB atlas and must take the painterly class.`,
  );
}
for (const path of [
  // The course builds its own pixel atlases; the asset kit's only texture is
  // the livery decal sheet; the craft wears that same sheet.
  "src/game/game.ts",
  "src/game/scene-assets.ts",
  "src/game/totem.ts",
]) {
  assert.ok(
    !/textureCharacter:\s*"painterly"/.test(read(path)),
    `${path} carries pixel-authored sheets and must NOT take the painterly `
      + "class — P14's split is surgical, not a blanket filter swap.",
  );
}

console.log(
  "Render quality PASS: 720-line adaptive target, 360-line floor, resize-safe "
    + `degradation; ?render defaults to ${DEFAULT_RENDER_MODE}, snap grid clamps to `
    + `${PS2_SNAP_MIN_LINES}-${PS2_SNAP_MAX_LINES} lines, Bayer closed form matches `
    + "the canonical 4x4, grade is monotonic with an identity midrange, world "
    + "geometry snaps and the craft, rivals, sky and HUD do not; MSAA is on "
    + "outside ps2 and the painterly filter class reaches the baked GLB sheets "
    + "only.",
);
