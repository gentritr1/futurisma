/**
 * P4b — the PS2 presentation path, behind `?render=ps2`.
 *
 * PRODUCT.md asks for a "beautifully remembered PlayStation 2 title" and for
 * "deliberate low-resolution character over modern rendering complexity", while
 * the renderer has been running `AgXToneMapping` — a 2023 filmic curve that
 * desaturates and lifts shadows. This module owns the *pure* half of the
 * alternative: mode parsing, the tuning constants, the snap-grid derivation and
 * the GLSL that `totem.ts` injects through `onBeforeCompile`. Keeping it free of
 * `three` is what lets `scripts/validate-render-quality.mjs` assert the numbers
 * that the shaders actually carry.
 *
 * The mode is **presentation only**. Nothing here is allowed to reach physics,
 * lap timing or the HUD.
 *
 * @typedef {"agx" | "ps2"} RenderMode
 */

/** `?render=` is opt-in; the AgX path stays the default until the A/B closes. */
export const DEFAULT_RENDER_MODE = /** @type {RenderMode} */ ("agx");

/**
 * Parses the `?render=` query value. Anything that is not a known mode falls
 * back to the default rather than throwing — a typo in a share link must not
 * break the game.
 *
 * @param {string | null | undefined} raw
 * @returns {RenderMode}
 */
export function resolveRenderMode(raw) {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (value === "ps2") return "ps2";
  return DEFAULT_RENDER_MODE;
}

/** @type {RenderMode | null} */
let cachedMode = null;

/**
 * The mode for this page load. Memoized so the five material-treatment call
 * sites, the renderer setup and the diagnostics line can never disagree.
 *
 * @returns {RenderMode}
 */
export function activeRenderMode() {
  if (cachedMode === null) {
    cachedMode = resolveRenderMode(
      typeof window === "undefined"
        ? null
        : new URLSearchParams(window.location.search).get("render"),
    );
  }
  return cachedMode;
}

// ---------------------------------------------------------------------------
// Tuning constants. Every number the GLSL carries is declared here so the
// validator can assert it and a taste pass can dial it in one place.
// ---------------------------------------------------------------------------

/**
 * Vertex snap grid. The PS2's VU1 transformed vertices into a fixed-point
 * screen space, so geometry visibly stepped along a low-resolution raster. We
 * derive the raster from the *internal* render target rather than the CSS
 * viewport: half the internal height, clamped into the PS2 band. At the
 * `quality=high` 1280x720 target (internal 1600x900 at pixelRatio 1.25) the
 * clamp pins it to 240 lines; at `quality=low` (internal ~640x360) the halving
 * lands on 180 and the clamp never fires, which is the point — the effect
 * scales with, but never exceeds, the period look.
 */
export const PS2_SNAP_RESOLUTION_SCALE = 0.5;
/** Upper bound in raster lines; NTSC PS2 games rendered 224-256 lines. */
export const PS2_SNAP_MAX_LINES = 240;
/** Lower bound, so a very small window does not turn the world into cubes. */
export const PS2_SNAP_MIN_LINES = 180;
/** Fallback aspect when the render target has not been sized yet. */
export const PS2_SNAP_FALLBACK_ASPECT = 16 / 9;

/** Uniform the snap grid is published through. Shared by every snapped material. */
export const PS2_SNAP_UNIFORM_NAME = "uPs2SnapGrid";

/**
 * Colour grade. This replaces AgX rather than sitting on top of it: a crushed
 * toe, an identity midrange, a soft highlight knee and a saturation lift back
 * over what AgX takes out.
 */
/** Matches the exposure the AgX path used, so the A/B compares curves not gain. */
export const PS2_EXPOSURE = 1.05;
/** Below this the toe pulls values down toward black. */
export const PS2_BLACK_CRUSH_KNEE = 0.22;
/** 0 = no crush, 1 = full smoothstep crush inside the toe. */
export const PS2_BLACK_CRUSH_STRENGTH = 0.55;
/** Above this the highlight rolloff starts; below it the curve is identity. */
export const PS2_HIGHLIGHT_KNEE = 0.75;
/** 1.0 keeps AgX's saturation; above it puts the period's punch back. */
export const PS2_SATURATION = 1.18;

/** Rec.709 luma weights, used for the saturation pivot. */
export const PS2_LUMA_WEIGHTS = Object.freeze({
  r: 0.2126,
  g: 0.7152,
  b: 0.0722,
});

/** RGB565 — the PS2's 16-bit framebuffer. 32/64/32 levels, i.e. 31/63/31 steps. */
export const PS2_COLOR_STEPS = Object.freeze({ r: 31, g: 63, b: 31 });
/** 0 = plain rounding (banding), 1 = full-amplitude ordered dither. */
export const PS2_DITHER_STRENGTH = 0.75;

/**
 * The canonical 4x4 Bayer (ordered-dither) matrix, row-major.
 * {@link ps2BayerThreshold} reproduces it arithmetically so the GLSL needs no
 * lookup table; the validator holds the two against each other.
 */
export const PS2_BAYER_4X4 = Object.freeze([
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
]);

/** Mean of {@link PS2_BAYER_4X4} normalized to [0,1) — the dither's pivot. */
export const PS2_BAYER_MEAN = 7.5 / 16;

/**
 * Closed form of {@link PS2_BAYER_4X4}, normalized to [0, 15/16].
 *
 * Splitting the matrix into 2x2 blocks gives `base(x0,y0) + offset(x1,y1)` with
 * `base = [[0,8],[12,4]]` and `offset` the block ordering `[[0,2],[3,1]]`; both
 * are bilinear in their two bits, so the whole matrix is six multiplies with no
 * indexing — which matters because GLSL ES 1.00 forbids dynamic indexing of a
 * const array and this shader has to stay portable.
 *
 * @param {number} x Pixel column.
 * @param {number} y Pixel row.
 * @returns {number} Threshold in [0, 15/16].
 */
export function ps2BayerThreshold(x, y) {
  const x0 = mod2(x);
  const y0 = mod2(y);
  const x1 = mod2(Math.floor(x * 0.5));
  const y1 = mod2(Math.floor(y * 0.5));
  const base = 8 * x0 + 12 * y0 - 16 * x0 * y0;
  const offset = 2 * x1 + 3 * y1 - 4 * x1 * y1;
  return (base + offset) / 16;
}

/**
 * @param {number} value
 * @returns {number}
 */
function mod2(value) {
  return ((Math.floor(value) % 2) + 2) % 2;
}

/**
 * Snap grid for a render target, in raster cells across the full screen.
 *
 * @param {number} internalWidth Backbuffer width in device pixels.
 * @param {number} internalHeight Backbuffer height in device pixels.
 * @returns {{ x: number, y: number }}
 */
export function resolvePs2SnapGrid(internalWidth, internalHeight) {
  const height = Number.isFinite(internalHeight) && internalHeight > 0
    ? internalHeight
    : 0;
  const width = Number.isFinite(internalWidth) && internalWidth > 0
    ? internalWidth
    : 0;
  const lines = Math.max(
    PS2_SNAP_MIN_LINES,
    Math.min(
      PS2_SNAP_MAX_LINES,
      Math.round(height * PS2_SNAP_RESOLUTION_SCALE),
    ),
  );
  const aspect = width > 0 && height > 0
    ? width / height
    : PS2_SNAP_FALLBACK_ASPECT;
  return { x: Math.max(1, Math.round(lines * aspect)), y: lines };
}

// ---------------------------------------------------------------------------
// GLSL. Built from the constants above so a tuning change cannot drift out of
// the shaders, and returned as plain strings so the validator can read them.
// ---------------------------------------------------------------------------

/**
 * GLSL never accepts an integer literal where a float is expected, and a
 * stringified JS number drops the point.
 *
 * @param {number} value
 * @returns {string}
 */
function glsl(value) {
  const text = String(value);
  return text.includes(".") || text.includes("e") ? text : `${text}.0`;
}

/** Chunk this injection anchors on, in the vertex stage. */
export const PS2_PROJECT_VERTEX_ANCHOR = "#include <project_vertex>";
/** Chunk the colour grade replaces. With `NoToneMapping` it expands to nothing. */
export const PS2_TONE_MAPPING_ANCHOR = "#include <tonemapping_fragment>";
/** Chunk the quantizer follows, after three's own colour-space conversion. */
export const PS2_DITHERING_ANCHOR = "#include <dithering_fragment>";

/**
 * Quantizes the projected position onto the virtual raster. Applied to course
 * and environment geometry only — the player craft, the rivals and the sky dome
 * stay smooth, because a jittering ship is a readability bug, not a period
 * detail.
 *
 * @returns {string}
 */
export function ps2VertexSnapChunk() {
  return `
  // PS2 vertex snap: fixed-point VU1 transforms stepped geometry along a
  // low-resolution raster. Quantize in NDC, then restore w so the perspective
  // divide still lands where the rasterizer expects it.
  if (abs(gl_Position.w) > 1e-5) {
    vec2 ps2SnapCells = ${PS2_SNAP_UNIFORM_NAME} * 0.5;
    vec2 ps2SnapNdc = gl_Position.xy / gl_Position.w;
    gl_Position.xy = (floor(ps2SnapNdc * ps2SnapCells + 0.5) / ps2SnapCells)
      * gl_Position.w;
  }`;
}

/** Declaration prepended to a snapped vertex shader. */
export function ps2VertexSnapUniformDeclaration() {
  return `uniform vec2 ${PS2_SNAP_UNIFORM_NAME};\n`;
}

/**
 * The replacement for AgX, in linear space and before fog. Deliberately *not* a
 * filmic curve: identity through the midrange, so the authored sector palettes
 * come through at the value they were painted at.
 *
 * @returns {string}
 */
export function ps2ColorGradeChunk() {
  const shoulder = 1 - PS2_HIGHLIGHT_KNEE;
  return `
  // PS2 grade (replaces tone mapping): crushed toe, identity midrange, soft
  // highlight knee that asymptotes to white, saturation back over AgX.
  {
    vec3 ps2Color = max(gl_FragColor.rgb, 0.0) * ${glsl(PS2_EXPOSURE)};
    vec3 ps2Toe = smoothstep(vec3(0.0), vec3(${glsl(PS2_BLACK_CRUSH_KNEE)}), ps2Color);
    ps2Color *= mix(vec3(1.0), ps2Toe, ${glsl(PS2_BLACK_CRUSH_STRENGTH)});
    vec3 ps2Over = max(ps2Color - ${glsl(PS2_HIGHLIGHT_KNEE)}, 0.0);
    vec3 ps2Knee = ${glsl(PS2_HIGHLIGHT_KNEE)}
      + ${glsl(shoulder)} * (1.0 - exp(-ps2Over / ${glsl(shoulder)}));
    ps2Color = min(ps2Color, ps2Knee);
    float ps2Luma = dot(ps2Color, vec3(${glsl(PS2_LUMA_WEIGHTS.r)}, ${glsl(PS2_LUMA_WEIGHTS.g)}, ${glsl(PS2_LUMA_WEIGHTS.b)}));
    gl_FragColor.rgb = clamp(
      mix(vec3(ps2Luma), ps2Color, ${glsl(PS2_SATURATION)}),
      0.0,
      1.0
    );
  }`;
}

/**
 * Ordered-dither quantization to the 16-bit framebuffer, in display space and
 * after three's colour-space conversion. The HUD is DOM and is never touched.
 *
 * @returns {string}
 */
export function ps2DitherChunk() {
  return `
  // RGB565 ordered dither. The 4x4 Bayer threshold is expressed in closed form
  // (see ps2BayerThreshold) so it needs no lookup table, and is centred on the
  // matrix mean so the quantization does not shift overall brightness.
  {
    vec2 ps2Cell = floor(gl_FragCoord.xy);
    float ps2X0 = mod(ps2Cell.x, 2.0);
    float ps2Y0 = mod(ps2Cell.y, 2.0);
    float ps2X1 = mod(floor(ps2Cell.x * 0.5), 2.0);
    float ps2Y1 = mod(floor(ps2Cell.y * 0.5), 2.0);
    float ps2Bayer = (
      8.0 * ps2X0 + 12.0 * ps2Y0 - 16.0 * ps2X0 * ps2Y0
      + 2.0 * ps2X1 + 3.0 * ps2Y1 - 4.0 * ps2X1 * ps2Y1
    ) / 16.0;
    vec3 ps2Steps = vec3(${glsl(PS2_COLOR_STEPS.r)}, ${glsl(PS2_COLOR_STEPS.g)}, ${glsl(PS2_COLOR_STEPS.b)});
    float ps2Threshold = 0.5
      + (ps2Bayer - ${glsl(PS2_BAYER_MEAN)}) * ${glsl(PS2_DITHER_STRENGTH)};
    gl_FragColor.rgb = clamp(
      floor(gl_FragColor.rgb * ps2Steps + ps2Threshold) / ps2Steps,
      0.0,
      1.0
    );
  }`;
}
