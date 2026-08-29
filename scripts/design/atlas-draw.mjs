/**
 * FUTURISMA — authored atlas rasteriser.
 *
 * Pure, dependency-free, deterministic. No canvas, no font files, no floating
 * point in any pixel decision that a validator would have to reproduce: every
 * glyph is a 5x7 bitmap scaled by an integer, every edge lands on a pixel
 * boundary, every noise draw comes off one seeded mulberry32 stream in
 * declaration order.
 *
 * That is not fastidiousness for its own sake. These sheets are magnified with
 * NearestFilter and no mipmaps, so a half-pixel edge is a visible ragged step
 * at 1280x720, and an anti-aliased glyph is a grey smear. Authoring on the
 * pixel grid is the only way the PS2 treatment stays a treatment rather than
 * an accident.
 *
 * Exports `buildRunwayAtlas`, `buildSignageAtlas`, `buildMotionAtlasB`, each
 * returning `{ name, width, height, rgba, regions }`.
 */

// ---------------------------------------------------------------------------
// Palette. Sampled from the accepted greenwater_signage_1024 and the four
// accepted livery sheets; the Bitterpan pair is the route language from its
// palette doc. Nothing here is invented outside those two sources.
// ---------------------------------------------------------------------------

export const PALETTE = {
  INK: [30, 37, 33, 255],
  INK_SOFT: [44, 52, 47, 255],
  BONE: [232, 230, 219, 255],
  BONE_DIM: [186, 184, 172, 255],
  ORANGE: [245, 160, 60, 255],
  RED: [217, 56, 43, 255],
  ACID: [198, 240, 60, 255],
  CYAN: [79, 216, 245, 255],
  STEEL: [110, 122, 120, 255],
  STEEL_DARK: [72, 82, 80, 255],
  RUST: [154, 82, 50, 255],
  SALT: [242, 238, 226, 255],
  BP_CYAN: [119, 220, 227, 255],
  BP_ORANGE: [240, 106, 50, 255],
  // Team accents, read off the PAINT CHIPS swatch row on each livery sheet.
  // WORKS is ACID and NIGHTFORM is CYAN above; these two are their own values.
  PRIVATEER: [239, 106, 40, 255],
  NEEDLE: [111, 168, 176, 255],
  CLEAR: [0, 0, 0, 0],
};

// ---------------------------------------------------------------------------
// Deterministic noise stream
// ---------------------------------------------------------------------------

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// 5x7 bitmap face. Upper case, digits, and the four marks the accepted sheets
// actually use. A missing glyph draws nothing rather than a box, so a typo
// shows up as a hole in review instead of shipping as tofu.
// ---------------------------------------------------------------------------

const FACE = {
  A: ".###.|#...#|#...#|#####|#...#|#...#|#...#",
  B: "####.|#...#|#...#|####.|#...#|#...#|####.",
  C: ".####|#....|#....|#....|#....|#....|.####",
  D: "####.|#...#|#...#|#...#|#...#|#...#|####.",
  E: "#####|#....|#....|####.|#....|#....|#####",
  F: "#####|#....|#....|####.|#....|#....|#....",
  G: ".####|#....|#....|#..##|#...#|#...#|.####",
  H: "#...#|#...#|#...#|#####|#...#|#...#|#...#",
  I: "#####|..#..|..#..|..#..|..#..|..#..|#####",
  J: "####.|...#.|...#.|...#.|...#.|#..#.|.##..",
  K: "#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#",
  L: "#....|#....|#....|#....|#....|#....|#####",
  M: "#...#|##.##|#.#.#|#...#|#...#|#...#|#...#",
  N: "#...#|##..#|#.#.#|#..##|#...#|#...#|#...#",
  O: ".###.|#...#|#...#|#...#|#...#|#...#|.###.",
  P: "####.|#...#|#...#|####.|#....|#....|#....",
  Q: ".###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#",
  R: "####.|#...#|#...#|####.|#.#..|#..#.|#...#",
  S: ".####|#....|#....|.###.|....#|....#|####.",
  T: "#####|..#..|..#..|..#..|..#..|..#..|..#..",
  U: "#...#|#...#|#...#|#...#|#...#|#...#|.###.",
  V: "#...#|#...#|#...#|#...#|#...#|.#.#.|..#..",
  W: "#...#|#...#|#...#|#...#|#.#.#|##.##|#...#",
  X: "#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#",
  Y: "#...#|#...#|.#.#.|..#..|..#..|..#..|..#..",
  Z: "#####|....#|...#.|..#..|.#...|#....|#####",
  0: ".###.|#...#|#..##|#.#.#|##..#|#...#|.###.",
  1: "..#..|.##..|..#..|..#..|..#..|..#..|.###.",
  2: ".###.|#...#|....#|...#.|..#..|.#...|#####",
  3: "####.|....#|....#|.###.|....#|....#|####.",
  4: "...#.|..##.|.#.#.|#..#.|#####|...#.|...#.",
  5: "#####|#....|####.|....#|....#|#...#|.###.",
  6: ".###.|#....|#....|####.|#...#|#...#|.###.",
  7: "#####|....#|...#.|..#..|.#...|.#...|.#...",
  8: ".###.|#...#|#...#|.###.|#...#|#...#|.###.",
  9: ".###.|#...#|#...#|.####|....#|....#|.###.",
  " ": ".....|.....|.....|.....|.....|.....|.....",
  "-": ".....|.....|.....|#####|.....|.....|.....",
  ".": ".....|.....|.....|.....|.....|.##..|.##..",
  ":": ".....|.##..|.##..|.....|.##..|.##..|.....",
  "/": "....#|....#|...#.|..#..|.#...|#....|#....",
  "·": ".....|.....|.##..|.##..|.....|.....|.....",
};

export const GLYPH_W = 5;
export const GLYPH_H = 7;

// ---------------------------------------------------------------------------
// Surface
// ---------------------------------------------------------------------------

export function createSurface(width, height) {
  return {
    width,
    height,
    rgba: new Uint8ClampedArray(width * height * 4),
    clip: null,
    mask: false,
  };
}

/**
 * Proper source-over with an un-premultiplied result, a clip rect, and an
 * optional "only where something is already drawn" mask.
 *
 * The mask is what makes patina behave on a decal sheet. These atlases are
 * mostly transparent by design — a decal quad shows deck through everything
 * that is not marking — so unmasked grain would leave dirt floating in empty
 * space and read as sensor noise rather than a worn painted line.
 */
function blend(s, x, y, color, alpha) {
  if (x < 0 || y < 0 || x >= s.width || y >= s.height) return;
  const c = s.clip;
  if (c && (x < c.x0 || y < c.y0 || x >= c.x1 || y >= c.y1)) return;
  const sa = (color[3] / 255) * alpha;
  if (sa <= 0) return;
  const i = (y * s.width + x) * 4;
  const da = s.rgba[i + 3] / 255;
  if (s.mask && da <= 0.03) return;
  const oa = sa + da * (1 - sa);
  if (oa <= 0) return;
  const k = da * (1 - sa);
  s.rgba[i] = (color[0] * sa + s.rgba[i] * k) / oa;
  s.rgba[i + 1] = (color[1] * sa + s.rgba[i + 1] * k) / oa;
  s.rgba[i + 2] = (color[2] * sa + s.rgba[i + 2] * k) / oa;
  s.rgba[i + 3] = Math.round((s.mask ? da : oa) * 255);
}

/** Run `fn` with drawing confined to a box. */
export function clipped(s, x, y, w, h, fn) {
  const prev = s.clip;
  s.clip = { x0: Math.round(x), y0: Math.round(y), x1: Math.round(x + w), y1: Math.round(y + h) };
  fn();
  s.clip = prev;
}

/** Run `fn` so it can only darken/tint pixels that already have coverage. */
export function masked(s, fn) {
  const prev = s.mask;
  s.mask = true;
  fn();
  s.mask = prev;
}

export function rect(s, x, y, w, h, color, alpha = 1) {
  const x0 = Math.round(x);
  const y0 = Math.round(y);
  const x1 = Math.round(x + w);
  const y1 = Math.round(y + h);
  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) blend(s, px, py, color, alpha);
  }
}

/** Axis-aligned outline, `t` px thick, drawn inside the box. */
export function frame(s, x, y, w, h, t, color, alpha = 1) {
  rect(s, x, y, w, t, color, alpha);
  rect(s, x, y + h - t, w, t, color, alpha);
  rect(s, x, y + t, t, h - t * 2, color, alpha);
  rect(s, x + w - t, y + t, t, h - t * 2, color, alpha);
}

/** Convex/concave polygon, even-odd scanline. Points are [x, y] pairs. */
export function poly(s, points, color, alpha = 1) {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, py] of points) {
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(s.height - 1, Math.ceil(maxY));
  for (let py = y0; py <= y1; py += 1) {
    const sampleY = py + 0.5;
    const xs = [];
    for (let i = 0; i < points.length; i += 1) {
      const [ax, ay] = points[i];
      const [bx, by] = points[(i + 1) % points.length];
      if (ay === by) continue;
      if (sampleY >= Math.min(ay, by) && sampleY < Math.max(ay, by)) {
        xs.push(ax + ((sampleY - ay) / (by - ay)) * (bx - ax));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const sx = Math.round(xs[i]);
      const ex = Math.round(xs[i + 1]);
      for (let px = sx; px < ex; px += 1) blend(s, px, py, color, alpha);
    }
  }
}

/** Circular outline, `t` px thick, centred on the radius. */
export function ring(s, cx, cy, r, t, color, alpha = 1) {
  const outer = r + t / 2;
  const x0 = Math.floor(cx - outer);
  const y0 = Math.floor(cy - outer);
  const x1 = Math.ceil(cx + outer);
  const y1 = Math.ceil(cy + outer);
  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) {
      const d = Math.hypot(px + 0.5 - cx, py + 0.5 - cy);
      if (Math.abs(d - r) <= t / 2) blend(s, px, py, color, alpha);
    }
  }
}

/** A line of given thickness, drawn as a quad. Diagonals stay crisp. */
export function stroke(s, x0, y0, x1, y1, t, color, alpha = 1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (t / 2);
  const ny = (dx / len) * (t / 2);
  poly(s, [
    [x0 + nx, y0 + ny],
    [x1 + nx, y1 + ny],
    [x1 - nx, y1 - ny],
    [x0 - nx, y0 - ny],
  ], color, alpha);
}

/**
 * Blocky grain, matching the 4 px cell noise on the accepted signage sheet.
 * `cell` is the grain size in pixels; keeping it >= 3 means the noise survives
 * nearest-neighbour magnification as texture instead of dissolving to sparkle.
 */
export function grain(s, x, y, w, h, color, { cell = 4, density = 0.35, alpha = 0.5, rng, wear = true }) {
  const draw = () => {
    const cols = Math.ceil(w / cell);
    const rows = Math.ceil(h / cell);
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        if (rng() > density) continue;
        const a = alpha * (0.45 + rng() * 0.55);
        rect(s, x + c * cell, y + r * cell, cell, cell, color, a);
      }
    }
  };
  if (wear) masked(s, draw);
  else draw();
}

/** A soft radial blob, quantised to `cell` so it reads as dithered, not blurred. */
export function blob(s, cx, cy, radius, color, { cell = 4, alpha = 1, falloff = 2 }) {
  const x0 = Math.floor((cx - radius) / cell) * cell;
  const y0 = Math.floor((cy - radius) / cell) * cell;
  const x1 = Math.ceil((cx + radius) / cell) * cell;
  const y1 = Math.ceil((cy + radius) / cell) * cell;
  for (let py = y0; py < y1; py += cell) {
    for (let px = x0; px < x1; px += cell) {
      const d = Math.hypot(px + cell / 2 - cx, py + cell / 2 - cy) / radius;
      if (d >= 1) continue;
      rect(s, px, py, cell, cell, color, alpha * (1 - d) ** falloff);
    }
  }
}

export function textWidth(str, scale, tracking = 1) {
  if (!str.length) return 0;
  return str.length * (GLYPH_W + tracking) * scale - tracking * scale;
}

export function text(s, str, x, y, scale, color, { tracking = 1, alpha = 1 } = {}) {
  let cursor = Math.round(x);
  for (const raw of str) {
    const ch = raw.toUpperCase();
    const rows = FACE[ch];
    if (rows) {
      const lines = rows.split("|");
      for (let ry = 0; ry < GLYPH_H; ry += 1) {
        for (let rx = 0; rx < GLYPH_W; rx += 1) {
          if (lines[ry][rx] !== "#") continue;
          rect(s, cursor + rx * scale, y + ry * scale, scale, scale, color, alpha);
        }
      }
    }
    cursor += (GLYPH_W + tracking) * scale;
  }
  return cursor - tracking * scale - Math.round(x);
}

export function textCentred(s, str, cx, y, scale, color, opts = {}) {
  const w = textWidth(str, scale, opts.tracking ?? 1);
  return text(s, str, Math.round(cx - w / 2), y, scale, color, opts);
}

/**
 * Largest integer scale at or below `maxScale` that fits `str` in `maxW`.
 * Integer only: a fractional scale would put glyph edges between pixels, which
 * NearestFilter then magnifies into uneven stem weights.
 */
export function fitScale(str, maxW, maxScale, tracking = 1) {
  for (let sc = maxScale; sc > 1; sc -= 1) {
    if (textWidth(str, sc, tracking) <= maxW) return sc;
  }
  return 1;
}

export function textFit(s, str, x, y, maxW, maxScale, color, opts = {}) {
  const tracking = opts.tracking ?? 1;
  const sc = fitScale(str, maxW, maxScale, tracking);
  text(s, str, x, y, sc, color, opts);
  return sc;
}

export function textFitCentred(s, str, cx, y, maxW, maxScale, color, opts = {}) {
  const tracking = opts.tracking ?? 1;
  const sc = fitScale(str, maxW, maxScale, tracking);
  textCentred(s, str, cx, y, sc, color, opts);
  return sc;
}

/** Diagonal hazard banding, clipped to a box. */
export function hazard(s, x, y, w, h, color, { pitch = 32, thickness = 16, alpha = 1, lean = 1 }) {
  clipped(s, x, y, w, h, () => {
    for (let i = -Math.ceil((h * Math.abs(lean)) / pitch) - 1;
      i < Math.ceil((w + h * Math.abs(lean)) / pitch) + 1; i += 1) {
      const ox = x + i * pitch;
      poly(s, [
        [ox, y + h],
        [ox + thickness, y + h],
        [ox + thickness + h * lean, y],
        [ox + h * lean, y],
      ], color, alpha);
    }
  });
}

// ---------------------------------------------------------------------------
// Region bookkeeping. Every authored slot is registered so the JSON placement
// files and the review sheet read the same numbers the pixels were drawn at.
// ---------------------------------------------------------------------------

function regionTable() {
  const regions = {};
  return {
    regions,
    add(id, x, y, w, h, note) {
      regions[id] = { x, y, w, h, note };
      return { x, y, w, h };
    },
  };
}

// ===========================================================================
// ATLAS 1 — greenwater_runway_1024
// The surface-character pass for RUNWAY_START, 0-220 m. Airfield markings,
// service stencils, and the wear that makes an airfield look served rather
// than laid. Everything is deck-facing; nothing here is vertical.
// ===========================================================================

export function buildRunwayAtlas() {
  const s = createSurface(1024, 1024);
  const rng = mulberry32(0x0714);
  const T = regionTable();
  const P = PALETTE;

  // -- Band A, y 0-128: longitudinal markings ------------------------------
  T.add("THRESHOLD_BARS", 0, 0, 1024, 96, "runway threshold, 8 bars along U");
  for (let i = 0; i < 8; i += 1) {
    const bx = 12 + i * 126;
    rect(s, bx, 8, 96, 80, P.BONE, 0.92);
    grain(s, bx, 8, 96, 80, P.INK, { cell: 4, density: 0.16, alpha: 0.5, rng });
  }

  T.add("CENTRELINE_DASH", 0, 96, 256, 32, "runway centreline dash");
  rect(s, 16, 104, 224, 16, P.BONE, 0.88);
  grain(s, 16, 104, 224, 16, P.INK, { cell: 4, density: 0.2, alpha: 0.45, rng });

  T.add("EDGE_LINE", 256, 96, 256, 32, "continuous runway edge line");
  rect(s, 256, 106, 256, 12, P.BONE, 0.8);
  grain(s, 256, 106, 256, 12, P.INK, { cell: 3, density: 0.26, alpha: 0.5, rng });

  T.add("HOLD_LADDER", 512, 96, 256, 32, "holding position: 2 solid, 2 dashed");
  rect(s, 512, 98, 256, 6, P.ORANGE, 0.9);
  rect(s, 512, 108, 256, 6, P.ORANGE, 0.9);
  for (let i = 0; i < 8; i += 1) {
    rect(s, 512 + i * 32, 118, 20, 5, P.ORANGE, 0.85);
    rect(s, 512 + i * 32, 126, 20, 2, P.ORANGE, 0.7);
  }

  T.add("TAXI_DASH", 768, 96, 256, 32, "taxi route dash, service yellow");
  for (let i = 0; i < 4; i += 1) {
    rect(s, 776 + i * 64, 104, 44, 16, P.ORANGE, 0.86);
    grain(s, 776 + i * 64, 104, 44, 16, P.INK, { cell: 4, density: 0.22, alpha: 0.5, rng });
  }

  // -- Band B, y 128-256: designators and stencilled words ------------------
  T.add("DESIGNATOR_07", 0, 128, 192, 128, "runway designator 07");
  textCentred(s, "07", 96, 152, 12, P.BONE, { tracking: 2, alpha: 0.92 });
  grain(s, 8, 136, 176, 112, P.INK, { cell: 5, density: 0.09, alpha: 0.5, rng });

  T.add("DESIGNATOR_25", 192, 128, 192, 128, "reciprocal designator 25");
  textCentred(s, "25", 288, 152, 12, P.BONE, { tracking: 2, alpha: 0.92 });
  grain(s, 200, 136, 176, 112, P.INK, { cell: 5, density: 0.09, alpha: 0.5, rng });

  const stencil = (id, x, y, w, h, str, note) => {
    T.add(id, x, y, w, h, note);
    textFitCentred(s, str, x + w / 2, y + Math.round((h - 7 * 5) / 2), w - 24, 5, P.BONE, {
      tracking: 2,
      alpha: 0.86,
    });
    grain(s, x, y, w, h, P.INK, { cell: 4, density: 0.2, alpha: 0.45, rng });
  };
  stencil("WORD_NO_ENTRY", 384, 128, 320, 64, "NO ENTRY", "deck stencil");
  stencil("WORD_KEEP_CLEAR", 384, 192, 320, 64, "KEEP CLEAR", "deck stencil");
  stencil("WORD_HOLD_SHORT", 704, 128, 320, 64, "HOLD SHORT", "deck stencil");
  stencil("WORD_FUEL_POINT", 704, 192, 320, 64, "FUEL POINT", "deck stencil");

  // -- Band C, y 256-512: aiming points, grid, shoulder ---------------------
  T.add("AIM_BLOCK", 0, 256, 128, 256, "aiming point block pair");
  rect(s, 14, 272, 42, 224, P.BONE, 0.9);
  rect(s, 72, 272, 42, 224, P.BONE, 0.9);
  grain(s, 14, 272, 100, 224, P.INK, { cell: 4, density: 0.15, alpha: 0.5, rng });

  const tdz = (id, x, bars) => {
    T.add(id, x, 256, 96, 256, `touchdown zone, ${bars} bar`);
    const bw = 22;
    const total = bars * bw + (bars - 1) * 10;
    const sx = x + Math.round((96 - total) / 2);
    for (let i = 0; i < bars; i += 1) {
      rect(s, sx + i * (bw + 10), 280, bw, 208, P.BONE, 0.88);
    }
    grain(s, x, 272, 96, 224, P.INK, { cell: 4, density: 0.16, alpha: 0.5, rng });
  };
  tdz("TDZ_3BAR", 128, 3);
  tdz("TDZ_2BAR", 224, 2);
  tdz("TDZ_1BAR", 320, 1);

  T.add("GRID_BOX", 416, 256, 192, 192, "start grid box outline");
  frame(s, 424, 264, 176, 176, 8, P.BONE, 0.85);
  rect(s, 424, 264, 60, 8, P.ORANGE, 0.9);
  rect(s, 540, 432, 60, 8, P.ORANGE, 0.9);
  grain(s, 424, 264, 176, 176, P.INK, { cell: 4, density: 0.1, alpha: 0.45, rng });

  for (let i = 0; i < 4; i += 1) {
    const x = 416 + i * 48;
    T.add(`GRID_NUM_${i + 1}`, x, 448, 48, 64, `grid slot numeral ${i + 1}`);
    textCentred(s, String(i + 1), x + 24, 462, 5, P.BONE, { alpha: 0.9 });
    grain(s, x + 4, 452, 40, 56, P.INK, { cell: 4, density: 0.14, alpha: 0.5, rng });
  }

  T.add("CHEVRON_SHOULDER", 608, 256, 416, 128, "shoulder chevrons, orange");
  for (let i = 0; i < 4; i += 1) {
    const cx = 664 + i * 104;
    poly(s, [
      [cx - 44, 356], [cx, 288], [cx + 44, 356],
      [cx + 44, 372], [cx, 304], [cx - 44, 372],
    ], P.ORANGE, 0.92);
  }
  grain(s, 608, 256, 416, 128, P.INK, { cell: 4, density: 0.1, alpha: 0.4, rng });

  T.add("HAZARD_BAND", 608, 384, 416, 128, "run-off hazard banding");
  rect(s, 608, 384, 416, 128, P.INK, 0.92);
  hazard(s, 608, 384, 416, 128, P.ORANGE, { pitch: 52, thickness: 26, alpha: 0.95 });
  grain(s, 608, 384, 416, 128, P.INK, { cell: 4, density: 0.18, alpha: 0.45, rng });

  // -- Band D, y 512-768: wear ---------------------------------------------
  T.add("SCRUB_HEAVY", 0, 512, 256, 128, "rubber deposit, heavy");
  clipped(s, 0, 512, 256, 128, () => {
    for (let i = 0; i < 5; i += 1) {
      const y = 522 + i * 22;
      rect(s, 8 + rng() * 30, y, 180 + rng() * 60, 12, P.INK, 0.34);
    }
    grain(s, 0, 512, 256, 128, P.INK, { cell: 4, density: 0.5, alpha: 0.22, rng, wear: false });
  });

  T.add("SCRUB_LIGHT", 256, 512, 256, 128, "rubber deposit, light");
  grain(s, 256, 512, 256, 128, P.INK, { cell: 6, density: 0.34, alpha: 0.15, rng, wear: false });

  T.add("PATCH_ASPHALT", 512, 512, 256, 128, "resurfacing patch with seam");
  rect(s, 522, 522, 236, 108, P.INK_SOFT, 0.55);
  frame(s, 522, 522, 236, 108, 3, P.INK, 0.6);
  grain(s, 522, 522, 236, 108, P.STEEL, { cell: 4, density: 0.3, alpha: 0.22, rng });

  T.add("PATCH_PLATE", 768, 512, 256, 128, "bolted steel repair plate");
  rect(s, 778, 522, 236, 108, P.STEEL_DARK, 0.72);
  frame(s, 778, 522, 236, 108, 4, P.STEEL, 0.6);
  for (let i = 0; i < 8; i += 1) {
    rect(s, 792 + (i % 4) * 68, 536 + Math.floor(i / 4) * 78, 10, 10, P.INK, 0.7);
  }
  grain(s, 778, 522, 236, 108, P.RUST, { cell: 4, density: 0.24, alpha: 0.35, rng });

  T.add("CRACK_NET", 0, 640, 256, 128, "surface crack network");
  clipped(s, 0, 640, 256, 128, () => {
    for (let i = 0; i < 9; i += 1) {
      const x0 = 10 + rng() * 230;
      const y0 = 648 + rng() * 110;
      stroke(s, x0, y0, x0 + (rng() - 0.5) * 90, y0 + (rng() - 0.5) * 70, 3, P.INK, 0.42);
    }
  });

  T.add("STAIN_PUDDLE", 256, 640, 256, 128, "standing water stain");
  blob(s, 384, 704, 108, P.INK, { cell: 5, alpha: 0.3, falloff: 1.6 });
  grain(s, 290, 656, 190, 96, P.BONE, { cell: 4, density: 0.12, alpha: 0.14, rng });

  T.add("STAIN_OIL", 512, 640, 256, 128, "service spill");
  blob(s, 640, 704, 74, P.INK, { cell: 4, alpha: 0.46, falloff: 2.4 });
  blob(s, 600, 690, 34, P.INK, { cell: 4, alpha: 0.4, falloff: 2.2 });

  T.add("DRAIN_GRATE", 768, 640, 256, 128, "deck drain grate");
  rect(s, 796, 660, 200, 88, P.STEEL_DARK, 0.85);
  for (let i = 0; i < 9; i += 1) rect(s, 806 + i * 21, 668, 11, 72, P.INK, 0.9);
  frame(s, 796, 660, 200, 88, 5, P.STEEL, 0.7);

  // -- Band E, y 768-1024: cancelled, faded, fixings ------------------------
  T.add("CANCEL_X", 0, 768, 256, 256, "cancelled marking");
  clipped(s, 0, 768, 256, 256, () => {
    stroke(s, 26, 794, 230, 998, 26, P.BONE, 0.6);
    stroke(s, 230, 794, 26, 998, 26, P.BONE, 0.6);
    grain(s, 0, 768, 256, 256, P.INK, { cell: 5, density: 0.3, alpha: 0.4, rng });
  });

  T.add("FADED_ARROW", 256, 768, 256, 256, "faded direction arrow");
  poly(s, [[384, 792], [470, 890], [420, 890], [420, 998], [348, 998], [348, 890], [298, 890]],
    P.BONE, 0.52);
  grain(s, 280, 780, 208, 232, P.INK, { cell: 5, density: 0.42, alpha: 0.4, rng });

  T.add("TIEDOWN_RING", 512, 768, 128, 128, "deck tie-down ring");
  blob(s, 576, 832, 40, P.STEEL_DARK, { cell: 4, alpha: 0.9, falloff: 0.35 });
  blob(s, 576, 832, 22, P.INK, { cell: 4, alpha: 1, falloff: 0.3 });

  T.add("BOLT_CLUSTER", 640, 768, 128, 128, "panel fixings");
  for (let i = 0; i < 6; i += 1) {
    rect(s, 656 + (i % 3) * 34, 792 + Math.floor(i / 3) * 44, 14, 14, P.STEEL_DARK, 0.85);
    rect(s, 659 + (i % 3) * 34, 795 + Math.floor(i / 3) * 44, 8, 8, P.INK, 0.9);
  }

  T.add("SEAM_JOINT", 512, 896, 256, 128, "slab expansion joint");
  rect(s, 512, 950, 256, 12, P.INK, 0.5);
  rect(s, 512, 946, 256, 4, P.STEEL, 0.3);
  grain(s, 512, 940, 256, 32, P.INK, { cell: 3, density: 0.3, alpha: 0.3, rng });
  T.add("WARN_PLATE", 768, 768, 256, 256, "deck warning plate");
  rect(s, 786, 786, 220, 220, P.INK, 0.9);
  frame(s, 786, 786, 220, 220, 8, P.ORANGE, 0.9);
  textCentred(s, "PLASMA", 896, 852, 5, P.ORANGE, { tracking: 2, alpha: 0.95 });
  textCentred(s, "WASH", 896, 900, 5, P.ORANGE, { tracking: 2, alpha: 0.95 });
  grain(s, 786, 786, 220, 220, P.BONE, { cell: 4, density: 0.08, alpha: 0.18, rng });

  return { name: "greenwater_runway_1024", width: 1024, height: 1024, rgba: s.rgba, regions: T.regions };
}

// ===========================================================================
// ATLAS 2 — futurisma_signage_1024
// Vertical trackside boards, both maps. Sponsor fiction is deliberately
// industrial-supplier rather than consumer-brand: a working airfield and a
// working salt pan are leased to the people who service them.
// ===========================================================================

export function buildSignageAtlas() {
  const s = createSurface(1024, 1024);
  const rng = mulberry32(0x5167);
  const T = regionTable();
  const P = PALETTE;

  /**
   * A 512x128 trackside board: mark block on the left, wordmark stacked on up
   * to two lines, strapline under it. Two lines rather than one because a
   * single-line wordmark on a 512 px plate has to drop to a 15 px cap height
   * to fit, and 15 px of nearest-filtered glyph at 60 m is a grey bar.
   */
  function board(id, col, row, opts) {
    const x = col * 512;
    const y = row * 128;
    T.add(id, x, y, 512, 128, opts.note);
    rect(s, x, y, 512, 128, opts.ground, 1);
    if (opts.rule) rect(s, x, y + 118, 512, 10, opts.rule, 1);
    if (opts.mark) opts.mark(x, y);
    const tx = x + (opts.textX ?? 132);
    const maxW = 512 - (opts.textX ?? 132) - 16;
    const lines = opts.lines;
    const top = lines.length > 1 ? 14 : 34;
    lines.forEach((line, i) => {
      textFit(s, line, tx, y + top + i * 40, maxW, opts.maxScale ?? 5, opts.fg, { tracking: 2 });
    });
    if (opts.sub) {
      textFit(s, opts.sub, tx, y + (lines.length > 1 ? 96 : 82), maxW, 3,
        opts.subFg ?? opts.fg, { tracking: 2, alpha: 0.9 });
    }
    grain(s, x, y, 512, 128, opts.grainColor ?? P.INK,
      { cell: 4, density: opts.grainDensity ?? 0.1, alpha: 0.4, rng });
  }

  // KAIRO chevron mark, the accepted logo shape from the livery sheets.
  /**
   * The KAIRO emblem, derived from the authoritative vector at
   * public/assets/totem/logos/kairo-dynamics.svg rather than eyeballed off a
   * livery raster. That file is a 256 viewBox holding
   *   circle  cx 128 cy 118 r 88, stroke 10
   *   chevron M76 152 L128 74 L180 152, stroke 20, butt caps
   * so the ratios that matter are fixed: half-span 52 to rise 78 (exactly
   * 1:1.5), stroke 20 against a 104 span, and a ring whose radius is 1.692x
   * the chevron half-span. `K` below is the only free number; everything else
   * is those coordinates scaled.
   */
  const kairoMark = (fg, ringColor) => (x, y) => {
    const K = 0.44;
    const ox = x + 66 - 128 * K;
    const oy = y + 64 - 118 * K;
    const p = (px, py) => [ox + px * K, oy + py * K];
    ring(s, ox + 128 * K, oy + 118 * K, 88 * K, 10 * K, ringColor, 0.9);
    // One polygon, not two strokes: a mitred apex. Vertical thickness 24.03 is
    // the authored 20 px perpendicular stroke over the 52:78 slope.
    poly(s, [p(76, 152), p(128, 74), p(180, 152),
      p(180, 176.03), p(128, 98.03), p(76, 176.03)], fg, 1);
  };

  board("BOARD_KAIRO", 0, 0, {
    note: "prime constructor, both maps",
    ground: P.INK, fg: P.BONE, subFg: P.CYAN, rule: P.CYAN,
    lines: ["KAIRO", "DYNAMICS"], sub: "CLASS II ANTIGRAV",
    mark: kairoMark(P.CYAN, P.BONE_DIM),
  });

  board("BOARD_PALE_HARVEST", 1, 0, {
    note: "Bitterpan: the salt works that leases the pan",
    ground: P.SALT, fg: P.INK, subFg: P.BP_ORANGE, rule: P.BP_ORANGE,
    lines: ["PALE", "HARVEST"], sub: "SOLAR SALT · BITTERPAN",
    grainColor: P.BP_ORANGE, grainDensity: 0.14,
    mark: (x, y) => {
      const cx = x + 66;
      const cy = y + 60;
      poly(s, [[cx, cy - 34], [cx + 32, cy], [cx, cy + 34], [cx - 32, cy]], P.INK, 1);
      poly(s, [[cx, cy - 16], [cx + 15, cy], [cx, cy + 16], [cx - 15, cy]], P.SALT, 1);
    },
  });

  board("BOARD_SODIUM_ROW", 0, 1, {
    note: "Greenwater: the fuel contractor Fuel Row is named for",
    ground: P.ORANGE, fg: P.INK, subFg: P.INK, rule: P.INK,
    lines: ["SODIUM ROW"], sub: "BULK PROPELLANT · LINE 4",
    grainColor: P.INK, grainDensity: 0.13,
    mark: (x, y) => {
      rect(s, x + 32, y + 26, 68, 72, P.INK, 1);
      rect(s, x + 44, y + 38, 44, 14, P.ORANGE, 1);
      rect(s, x + 44, y + 60, 44, 8, P.ORANGE, 1);
      rect(s, x + 44, y + 76, 44, 8, P.ORANGE, 1);
    },
  });

  board("BOARD_AEROLIFT", 1, 1, {
    note: "Greenwater: airframe repair, the trade Hangar Six houses",
    ground: P.RUST, fg: P.BONE, subFg: P.SALT, rule: P.INK,
    lines: ["AEROLIFT VII"], sub: "AIRFRAME REPAIR · HANGAR SIX",
    grainColor: P.INK, grainDensity: 0.2,
    mark: (x, y) => {
      const cx = x + 66;
      const cy = y + 62;
      poly(s, [[cx - 42, cy + 4], [cx + 42, cy - 14], [cx + 42, cy + 2], [cx - 42, cy + 20]],
        P.BONE, 1);
      rect(s, cx - 6, cy - 34, 12, 56, P.BONE, 1);
    },
  });

  board("BOARD_GREENWATER_AUTH", 0, 2, {
    note: "the site operator; the only board that carries a civic tone",
    ground: P.INK, fg: P.ACID, subFg: P.BONE_DIM, rule: P.ACID,
    lines: ["GREENWATER"], sub: "FIELD AUTHORITY · EST 0714",
    mark: (x, y) => {
      frame(s, x + 28, y + 22, 80, 80, 7, P.ACID, 1);
      rect(s, x + 52, y + 46, 32, 32, P.ACID, 1);
    },
  });

  board("BOARD_BITTERPAN_WORKS", 1, 2, {
    note: "Bitterpan site board",
    ground: P.INK, fg: P.BP_CYAN, subFg: P.BP_ORANGE, rule: P.BP_ORANGE,
    lines: ["BITTERPAN", "WORKS"], sub: "LOADOUT · CONVEYOR · BRINE",
    mark: (x, y) => {
      for (let i = 0; i < 3; i += 1) {
        rect(s, x + 28 + i * 10, y + 34 + i * 14, 80 - i * 20, 10, P.BP_CYAN, 1);
      }
      rect(s, x + 28, y + 90, 80, 8, P.BP_ORANGE, 1);
    },
  });

  board("BOARD_TECH_PLATE", 0, 3, {
    note: "technical plate, reads as facility signage not sponsorship",
    ground: P.STEEL_DARK, fg: P.BONE, subFg: P.BONE_DIM, rule: P.STEEL,
    lines: ["KD-0714-TTM"], sub: "REV 12 · AXIS 4 · TR-88", textX: 36,
    grainColor: P.INK, grainDensity: 0.24,
  });

  board("BOARD_HEAT_DEAD", 1, 3, {
    note: "sun-killed board: the Bitterpan brief's heat-dead signage",
    ground: P.BONE_DIM, fg: P.BONE, subFg: P.BONE, rule: P.BONE,
    lines: ["PALE", "HARVEST"], sub: "SOLAR SALT · BITTERPAN",
    grainColor: P.SALT, grainDensity: 0.55,
  });
  // Bleach it: the ink has gone, only the ghost of the ink remains.
  rect(s, 512, 384, 512, 128, PALETTE.SALT, 0.62);
  grain(s, 512, 384, 512, 128, PALETTE.BP_ORANGE, { cell: 5, density: 0.18, alpha: 0.14, rng });
  for (let i = 0; i < 5; i += 1) {
    rect(s, 512 + rng() * 400, 384 + rng() * 110, 40 + rng() * 70, 5, PALETTE.INK, 0.14);
  }

  // -- Team field totems, y 512-768 ----------------------------------------
  /**
   * Field totem plate.
   *
   * Grounded in two files rather than invented:
   *
   * - `logos/totem-syndicate.svg` is a 512x128 lockup whose entire emblem is a
   *   solid 48x48 square at #c8ff2e, set at x8 y40, with the wordmark to its
   *   right. So the TOTEM mark is a BLOCK, not a chevron. The square below is
   *   that square at its authored 0.375-of-band proportion, with the team
   *   numeral where the wordmark sits.
   * - The KAIRO chevron under it is the same `kairo-dynamics.svg` geometry the
   *   board marks use — 1 : 1.5 half-span to rise, butt caps — because the
   *   constructor sits under every team, and two chevrons on one sheet at
   *   different slopes would read as two different marks.
   *
   * Accents come from each livery sheet's own PAINT CHIPS row, which is the
   * only place the game states what colour a team is.
   */
  const totem = (id, col, label, num, accent, note) => {
    const x = col * 256;
    const y = 512;
    T.add(id, x, y, 256, 256, note);
    rect(s, x, y, 256, 256, P.INK, 1);
    frame(s, x + 8, y + 8, 240, 240, 6, accent, 0.9);

    // Syndicate block + numeral, the emblem's own lockup.
    rect(s, x + 26, y + 32, 62, 62, accent, 1);
    textFit(s, num, x + 102, y + 38, 138, 8, accent, { tracking: 2 });

    // KAIRO chevron at the authored 1 : 1.5, mitred: half-span 40, rise 60,
    // 15 px perpendicular stroke, which is 18 px of vertical thickness.
    poly(s, [[x + 88, y + 178], [x + 128, y + 118], [x + 168, y + 178],
      [x + 168, y + 196], [x + 128, y + 136], [x + 88, y + 196]], accent, 0.55);

    textFitCentred(s, label, x + 128, y + 208, 200, 3, P.BONE_DIM, { tracking: 2, alpha: 0.9 });
    grain(s, x, y, 256, 256, P.INK, { cell: 4, density: 0.13, alpha: 0.5, rng });
  };
  // Accent per team, sampled from the PAINT CHIPS swatch on that team's own
  // decal sheet — the sixth chip, which is the one that differs between sheets.
  totem("TOTEM_WORKS", 0, "WORKS", "07", P.ACID, "factory entry — acid, works sheet chip 6");
  totem("TOTEM_PRIVATEER", 1, "PRIVATEER", "13", P.PRIVATEER,
    "customer car — orange, privateer sheet chip 6");
  totem("TOTEM_NIGHTFORM", 2, "NIGHTFORM", "24", P.CYAN,
    "night trials shell — cyan, nightform sheet chip 6");
  totem("TOTEM_NEEDLE", 3, "NEEDLE", "16", P.NEEDLE,
    "lightweight spec — teal, needle sheet chip 6");

  // -- Repeating trims, y 768-896 ------------------------------------------
  T.add("PENNANT_ROW", 0, 768, 256, 128, "tileable pennant line");
  for (let i = 0; i < 8; i += 1) {
    const px = i * 32;
    poly(s, [[px, 776], [px + 30, 776], [px + 15, 828]],
      i % 2 ? P.ORANGE : P.BONE, 0.92);
  }
  rect(s, 0, 770, 256, 6, P.INK, 0.85);

  T.add("SPONSOR_TAPE", 256, 768, 256, 128, "tileable sponsor tape, 256 px repeat");
  rect(s, 256, 786, 256, 60, P.INK, 1);
  clipped(s, 256, 786, 256, 60, () => {
    text(s, "KAIRO·KAIRO·", 258, 808, 3, P.BONE, { tracking: 2, alpha: 0.9 });
  });
  rect(s, 256, 786, 256, 4, P.CYAN, 0.9);
  rect(s, 256, 842, 256, 4, P.CYAN, 0.9);

  T.add("MARSHAL_PLATE", 512, 768, 256, 128, "marshal post plate");
  rect(s, 520, 776, 240, 112, P.INK, 1);
  frame(s, 520, 776, 240, 112, 6, P.RED, 0.95);
  textFitCentred(s, "MARSHAL", 640, 802, 208, 5, P.RED, { tracking: 2 });
  textFitCentred(s, "POST", 640, 844, 208, 5, P.RED, { tracking: 2 });

  T.add("DISTANCE_BLANK", 768, 768, 256, 128, "blank distance board for runtime numerals");
  rect(s, 776, 776, 240, 112, P.INK, 1);
  frame(s, 776, 776, 240, 112, 6, P.BONE, 0.9);
  grain(s, 776, 776, 240, 112, P.BONE, { cell: 4, density: 0.06, alpha: 0.16, rng });

  // -- The Cradle gantry banner, y 896-1024 --------------------------------
  T.add("CRADLE_BANNER", 0, 896, 1024, 128, "start/finish gantry fascia, 38 m wide");
  rect(s, 0, 896, 1024, 128, P.INK, 1);
  rect(s, 0, 896, 1024, 8, P.ACID, 1);
  rect(s, 0, 1016, 1024, 8, P.ACID, 1);
  hazard(s, 0, 904, 132, 112, P.ORANGE, { pitch: 44, thickness: 22, alpha: 0.9, lean: 0.45 });
  hazard(s, 892, 904, 132, 112, P.ORANGE, { pitch: 44, thickness: 22, alpha: 0.9, lean: -0.45 });
  textFitCentred(s, "THE CRADLE", 512, 918, 700, 12, P.BONE, { tracking: 3 });
  textFitCentred(s, "GREENWATER FIELD AUTHORITY", 512, 986, 700, 4, P.ACID,
    { tracking: 2, alpha: 0.9 });
  grain(s, 0, 896, 1024, 128, P.INK, { cell: 4, density: 0.12, alpha: 0.45, rng });

  return { name: "futurisma_signage_1024", width: 1024, height: 1024, rgba: s.rgba, regions: T.regions };
}

// ===========================================================================
// ATLAS 3 — greenwater_motion_b_512
// The second living-world card sheet. 4x4 grid of 128 px slots, addressed by
// `atlasRect(512, 4, slot)` exactly as living-world-zones.js already does.
// Alpha-only silhouettes: the zone `tint` field does the colouring, so one
// slot serves both a green sector and a salt pan.
// ===========================================================================

export function buildMotionAtlasB() {
  const s = createSurface(512, 512);
  const rng = mulberry32(0x2b17);
  const T = regionTable();
  const P = PALETTE;
  const cell = 128;
  const slot = (i) => ({ x: (i % 4) * cell, y: Math.floor(i / 4) * cell });

  function reg(id, i, note) {
    const { x, y } = slot(i);
    T.add(id, x, y, cell, cell, note);
    return { x, y };
  }

  // A bird: two swept quads off a body dot. Three frames of one wingbeat.
  function bird(cx, cy, span, droop, color, alpha) {
    poly(s, [[cx, cy], [cx - span, cy - droop], [cx - span * 0.62, cy + 3], [cx - span * 0.2, cy + 2]],
      color, alpha);
    poly(s, [[cx, cy], [cx + span, cy - droop], [cx + span * 0.62, cy + 3], [cx + span * 0.2, cy + 2]],
      color, alpha);
    rect(s, cx - 2, cy - 1, 5, 4, color, alpha);
  }

  // Slots 0-2: flock sequence. Same four birds, wings up / level / down.
  const flock = [[30, 34], [72, 26], [52, 66], [92, 74]];
  [[0, -14], [1, 0], [2, 13]].forEach(([i, droop]) => {
    const { x, y } = reg(`BIRDS_${"ABC"[i]}`, i, `flock frame ${i + 1} of 3`);
    for (const [bx, by] of flock) bird(x + bx, y + by, 15, droop, P.INK, 0.82);
  });

  {
    const { x, y } = reg("GULL_SINGLE", 3, "single near bird, larger read");
    bird(x + 64, y + 60, 38, -8, P.INK, 0.86);
  }

  // Slots 4-5: salt devil. A leaning column of grain, denser at the base.
  [[4, 1], [5, -1]].forEach(([i, lean]) => {
    const { x, y } = reg(`DEVIL_WISP_${i === 4 ? "A" : "B"}`, i, "salt devil column");
    for (let r = 0; r < 28; r += 1) {
      const t = r / 27;
      const w = 30 - t * 12;
      const cx = x + 64 + lean * (t * t * 40 - 16);
      const cy = y + 120 - r * 4;
      grain(s, cx - w / 2, cy, w, 5, P.SALT,
        { cell: 3, density: 0.72 - t * 0.42, alpha: 0.52 - t * 0.34, rng, wear: false });
    }
  });

  // Slots 6-8: signage flicker. Same lamp, three states, so a `sequence` card
  // can step a dying tube without a second material.
  const lamp = (x, y, on) => {
    rect(s, x + 26, y + 50, 76, 26, P.BONE, 0.14 + on * 0.24);
    if (on > 0) {
      blob(s, x + 64, y + 63, 46 * on, P.BONE, { cell: 4, alpha: 0.5 * on, falloff: 2.2 });
      rect(s, x + 32, y + 56, 64, 14, P.BONE, 0.5 + on * 0.45);
    }
    rect(s, x + 22, y + 46, 6, 34, P.STEEL_DARK, 0.7);
    rect(s, x + 100, y + 46, 6, 34, P.STEEL_DARK, 0.7);
  };
  lamp(reg("FLICKER_FULL", 6, "lamp lit").x, slot(6).y, 1);
  lamp(reg("FLICKER_HALF", 7, "lamp browning out").x, slot(7).y, 0.45);
  lamp(reg("FLICKER_DEAD", 8, "lamp out, fixture only").x, slot(8).y, 0);

  // Slots 9-12: far-field served-machinery silhouettes. Deliberately blunt:
  // at 40-90 m through fog these are read as mass and stance, never detail.
  {
    const { x, y } = reg("WRECK_FUSELAGE", 9, "airframe hull on its side, ~18 m");
    // Long and low: at 40-90 m through fog the only thing that survives is the
    // horizon line it cuts, so the read is length, a broken back, and a nose
    // that is clearly a nose.
    poly(s, [[x + 6, y + 88], [x + 18, y + 74], [x + 62, y + 70], [x + 70, y + 78],
      [x + 104, y + 76], [x + 116, y + 84], [x + 114, y + 98], [x + 10, y + 98]], P.INK, 0.82);
    poly(s, [[x + 96, y + 76], [x + 116, y + 48], [x + 122, y + 52], [x + 112, y + 78]],
      P.INK, 0.74);
    rect(s, x + 30, y + 62, 4, 14, P.INK, 0.6);
    rect(s, x + 4, y + 98, 116, 5, P.INK, 0.45);
  }
  {
    const { x, y } = reg("WRECK_TAILFIN", 10, "empennage upright in the grass, ~11 m");
    poly(s, [[x + 44, y + 100], [x + 56, y + 22], [x + 78, y + 22], [x + 84, y + 100]], P.INK, 0.8);
    poly(s, [[x + 20, y + 46], [x + 56, y + 40], [x + 56, y + 54], [x + 24, y + 58]], P.INK, 0.74);
    rect(s, x + 34, y + 100, 60, 5, P.INK, 0.5);
  }
  {
    const { x, y } = reg("WRECK_NACELLE_STACK", 11, "engine cans on pallets, ~6 m");
    for (let i = 0; i < 3; i += 1) {
      rect(s, x + 22 + i * 8, y + 92 - i * 22, 84 - i * 16, 20, P.INK, 0.78);
    }
    rect(s, x + 16, y + 112, 96, 8, P.INK, 0.6);
  }
  {
    const { x, y } = reg("WRECK_GANTRY", 12, "service gantry frame, ~14 m");
    rect(s, x + 22, y + 26, 8, 88, P.INK, 0.76);
    rect(s, x + 98, y + 26, 8, 88, P.INK, 0.76);
    rect(s, x + 18, y + 22, 92, 9, P.INK, 0.78);
    for (let i = 0; i < 3; i += 1) rect(s, x + 30, y + 46 + i * 24, 68, 5, P.INK, 0.6);
    stroke(s, x + 30, y + 34, x + 98, y + 108, 4, P.INK, 0.55);
  }

  {
    const { x, y } = reg("DUST_SCUD", 13, "low ground scud");
    for (let i = 0; i < 4; i += 1) {
      grain(s, x + 6 + i * 6, y + 74 + i * 9, 112 - i * 14, 14, P.SALT,
        { cell: 4, density: 0.5 - i * 0.08, alpha: 0.34 - i * 0.05, rng, wear: false });
    }
  }
  {
    const { x, y } = reg("VAPOR_THIN", 14, "thin vapour, quietest card on the sheet");
    blob(s, x + 64, y + 68, 56, P.BONE, { cell: 6, alpha: 0.22, falloff: 1.5 });
    grain(s, x + 12, y + 34, 104, 70, P.BONE,
      { cell: 5, density: 0.3, alpha: 0.13, rng, wear: false });
  }
  {
    const { x, y } = reg("CRATE_STACK", 15, "served stores, near-field silhouette");
    rect(s, x + 20, y + 68, 44, 44, P.INK, 0.8);
    rect(s, x + 66, y + 80, 40, 32, P.INK, 0.8);
    rect(s, x + 30, y + 52, 30, 16, P.INK, 0.74);
    rect(s, x + 16, y + 112, 96, 6, P.INK, 0.5);
  }

  return { name: "greenwater_motion_b_512", width: 512, height: 512, rgba: s.rgba, regions: T.regions };
}

export const ATLASES = [buildRunwayAtlas, buildSignageAtlas, buildMotionAtlasB];
