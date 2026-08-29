/**
 * FUTURISMA — Pass 02 authored atlases.
 *
 * A sibling of `atlas-draw.mjs`, not a rewrite of it. The three Pass 01 sheets
 * are hash-registered in `scripts/validate-assets.mjs`; keeping their builders
 * and their rng streams untouched is the only way to *prove* Pass 02 did not
 * disturb them. Every primitive here is imported from Pass 01, so there is one
 * rasteriser, one 5x7 face, one blend rule.
 *
 * Pass 02 direction change (PRODUCT.md principle 4, revised): the PS2 era is
 * the memory, not the method. Pixel-grid authoring stays — it ships crisp and
 * it is how these sheets are legible — but nothing below is designed to *need*
 * low resolution to read. Two consequences show up in the code:
 *
 *  - The Bitterpan crust tile is authored for mipmaps and LinearFilter, not
 *    NearestFilter. It is a ground surface seen at every distance from 2 m to
 *    900 m; a nearest-filtered ground plane at 720p with MSAA aliases into
 *    sparkle the moment the craft moves. Its detail is therefore sized to
 *    survive minification, not magnification.
 *  - The livery wear sheet is authored against the livery atlas's own
 *    "mip filtering on, anisotropy 1" contract (totem/MANIFEST.json), so its
 *    grain cells are large enough to still exist two mip levels down.
 *
 * The decal atlases keep NearestFilter, because they are magnified onto large
 * ground quads where a crisp painted edge is the correct read.
 *
 * Exports `buildCrustTile`, `buildBitterpanCrustAtlas`, `buildHangarFixtures`,
 * `buildLiveryWearAtlas`.
 */

import {
  PALETTE,
  mulberry32,
  createSurface,
  clipped,
  masked,
  rect,
  frame,
  poly,
  stroke,
  grain,
  blob,
  text,
  textCentred,
  textFitCentred,
} from "./atlas-draw.mjs";

// ---------------------------------------------------------------------------
// Pass 02 palette additions.
//
// The pan is bone-white and the route language is cyan/orange — that is the
// Bitterpan brief verbatim, and BP_CYAN / BP_ORANGE already exist in Pass 01's
// PALETTE, so they are reused rather than restated. What is new is the *pan
// itself*: five values between lit crust and wet brine. They are a ramp, not a
// palette — a salt pan has one colour and a great deal of luminance.
// ---------------------------------------------------------------------------

export const PAN = {
  LIT: [252, 250, 244, 255],      // crust rim catching the hard noon key
  WHITE: [244, 241, 231, 255],    // the pan's own value
  SHADE: [198, 193, 178, 255],    // plate turned away from the key
  DEEP: [151, 146, 131, 255],     // inside a crack
  WARM: [206, 191, 160, 255],     // dust blown in off the berm
  BRINE: [122, 138, 138, 255],    // standing brine, cool against the warm pan
  BRINE_DEEP: [86, 100, 101, 255],
  SCRAPE: [178, 170, 152, 255],   // harvester-cut crust, duller than the rim
  CUT: [124, 118, 102, 255],      // the groove a harvester blade leaves
};

/** Region bookkeeping — same contract as Pass 01's private `regionTable`. */
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

/**
 * Run `fn` nine times at the eight wrap offsets plus the origin, so anything it
 * draws is seamless across the tile boundary. `blend` already rejects
 * off-surface pixels, so the eight ghosts cost nothing but the loop.
 */
function seamless(size, fn) {
  for (let oy = -1; oy <= 1; oy += 1) {
    for (let ox = -1; ox <= 1; ox += 1) fn(ox * size, oy * size);
  }
}

/**
 * Toroidal Voronoi crust — the one piece of real observation on this sheet.
 *
 * A salt pan does not crack randomly. Brine dries from the surface down, the
 * crust contracts, and it fails along the perpendicular bisectors between
 * nucleation points: a Voronoi diagram, with a raised rim where the plates
 * push against each other and a dark groove where they part. So the field is
 * generated as one — nearest and second-nearest site per pixel, the gap
 * between them read as distance-to-edge.
 *
 * Distances wrap in both axes, which is what makes the result tile with no
 * seam and no mirroring. `plate` is called with a per-plate 0-1 value so the
 * caller can vary plate luminance without a second noise source.
 */
function voronoiCrust(s, x0, y0, size, opts) {
  const { rng, cells, groove, rim, onCrack, onRim, onPlate } = opts;
  const sites = [];
  const pitch = size / cells;
  for (let r = 0; r < cells; r += 1) {
    for (let c = 0; c < cells; c += 1) {
      sites.push([(c + 0.18 + rng() * 0.64) * pitch, (r + 0.18 + rng() * 0.64) * pitch, rng()]);
    }
  }
  const half = size / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let d1 = Infinity;
      let d2 = Infinity;
      let hit = 0;
      for (let i = 0; i < sites.length; i += 1) {
        let dx = Math.abs(sites[i][0] - x - 0.5);
        if (dx > half) dx = size - dx;
        let dy = Math.abs(sites[i][1] - y - 0.5);
        if (dy > half) dy = size - dy;
        const d = dx * dx + dy * dy;
        if (d < d1) { d2 = d1; d1 = d; hit = i; } else if (d < d2) { d2 = d; }
      }
      const edge = Math.sqrt(d2) - Math.sqrt(d1);
      const px = x0 + x;
      const py = y0 + y;
      if (edge < groove) onCrack(px, py, 1 - edge / groove, sites[hit][2]);
      else if (edge < groove + rim && onRim) onRim(px, py, 1 - (edge - groove) / rim, sites[hit][2]);
      else if (onPlate) onPlate(px, py, sites[hit][2]);
    }
  }
}

const dot = (s, x, y, color, alpha) => rect(s, x, y, 1, 1, color, alpha);

/** Erase a box back to full transparency. blend() can only ADD coverage. */
function clear(s, x, y, w, h) {
  for (let py = y; py < y + h; py += 1) {
    for (let px = x; px < x + w; px += 1) {
      const i = (py * s.width + px) * 4;
      s.rgba[i] = 0; s.rgba[i + 1] = 0; s.rgba[i + 2] = 0; s.rgba[i + 3] = 0;
    }
  }
}

// ===========================================================================
// SHEET 1 — bitterpan_crust_tile_256
//
// The pan's ground material. Bitterpan currently has no ground texture at all,
// which is why the dust devils and scud cards on motion sheet B have nothing
// to read against: a card of blown salt over a flat white plane is a card of
// blown salt over nothing.
//
// 256 px covering 12 m of pan — 21 px/m, which puts a crust plate at roughly
// 0.5 m across, the size they actually are. Seamless in both axes, repeat
// wrapped, mipmapped. Opaque: this is the surface, not a decal over it.
// ===========================================================================

export function buildCrustTile() {
  const size = 256;
  const s = createSurface(size, size);
  const rng = mulberry32(0x8a17);
  const T = regionTable();

  T.add("CRUST_FIELD", 0, 0, size, size, "seamless pan crust, 12 m across, repeat wrapped");

  rect(s, 0, 0, size, size, PAN.WHITE, 1);

  // Slow luminance drift, so a repeated tile does not read as one value.
  seamless(size, (ox, oy) => {
    blob(s, ox + 62, oy + 84, 96, PAN.WARM, { cell: 8, alpha: 0.3, falloff: 1.2 });
    blob(s, ox + 188, oy + 196, 84, PAN.SHADE, { cell: 8, alpha: 0.22, falloff: 1.3 });
    blob(s, ox + 214, oy + 46, 58, PAN.LIT, { cell: 8, alpha: 0.26, falloff: 1.4 });
  });

  // Coarse plates first, then a finer crack set inside them: a pan cracks at
  // two scales because it dries twice, after the flood and after the rain.
  voronoiCrust(s, 0, 0, size, {
    rng,
    cells: 8,
    groove: 1.1,
    rim: 2.2,
    onCrack: (x, y, t) => dot(s, x, y, PAN.DEEP, 0.55 + t * 0.35),
    onRim: (x, y, t) => dot(s, x, y, PAN.LIT, 0.14 + t * 0.3),
    onPlate: (x, y, v) => dot(s, x, y, v > 0.5 ? PAN.LIT : PAN.SHADE, 0.06 + v * 0.1),
  });
  voronoiCrust(s, 0, 0, size, {
    rng,
    cells: 17,
    groove: 0.7,
    rim: 1.1,
    onCrack: (x, y, t) => dot(s, x, y, PAN.DEEP, 0.16 + t * 0.2),
    onRim: (x, y, t) => dot(s, x, y, PAN.LIT, 0.06 + t * 0.14),
  });

  // Brine that never quite dried, in the low ground the coarse drift made.
  seamless(size, (ox, oy) => {
    blob(s, ox + 196, oy + 208, 40, PAN.BRINE, { cell: 5, alpha: 0.2, falloff: 1.8 });
    blob(s, ox + 34, oy + 158, 26, PAN.BRINE, { cell: 5, alpha: 0.16, falloff: 1.8 });
  });

  // Grit. cell 3 rather than Pass 01's 4: this tile is minified far more often
  // than it is magnified, and 3 px survives two mip drops as tone.
  grain(s, 0, 0, size, size, PAN.WARM, { cell: 3, density: 0.24, alpha: 0.2, rng });
  grain(s, 0, 0, size, size, PAN.LIT, { cell: 3, density: 0.18, alpha: 0.24, rng });

  return { name: "bitterpan_crust_tile_256", width: size, height: size, rgba: s.rgba, regions: T.regions };
}

// ===========================================================================
// SHEET 2 — bitterpan_crust_1024
//
// Everything the crust tile cannot say, because it is the same 12 m repeated:
// where the harvesters actually drove, where the brine actually stood, where
// the loadout actually spilled. Alpha throughout — the tile shows through — and
// tintable, so one stain serves a wet cut and a dry one.
//
// Also carries the route language. Cyan is the line, orange is the warning:
// the only two saturated colours allowed on a map whose whole subject is glare.
// ===========================================================================

export function buildBitterpanCrustAtlas() {
  const s = createSurface(1024, 1024);
  const rng = mulberry32(0x2f0b);
  const T = regionTable();
  const P = PALETTE;

  // -- Row 0, y 0-256: crack overlays, four densities ----------------------
  // These break the tile's repeat. Alpha-only: the crack and its rim, with the
  // plate left transparent, so laying one over the ground darkens the joints
  // without re-tinting the pan.
  [["CRACK_COARSE", 0, 6], ["CRACK_MID", 256, 9], ["CRACK_FINE", 512, 13],
    ["CRACK_SHATTER", 768, 19]].forEach(([id, x, cells]) => {
    T.add(id, x, 0, 256, 256, `crack overlay, ${cells}x${cells} plates, tileable`);
    voronoiCrust(s, x, 0, 256, {
      rng,
      cells,
      groove: 1.2,
      rim: 2,
      onCrack: (px, py, t) => dot(s, px, py, P.INK, (0.3 + t * 0.34) * 0.85),
      onRim: (px, py, t) => dot(s, px, py, PAN.LIT, 0.1 + t * 0.26),
    });
  });

  // -- Row 1, y 256-512: loadout spill fans and a harvester turn -----------
  /**
   * A spill fan is what falls off the end of a conveyor when the loadout is
   * running: a cone of dropped salt, brightest and lumpiest at the toe where
   * the coarse material rolls furthest, thinning to dust at the mouth. It is
   * drawn from the mouth outward so the toe overwrites, which is the order the
   * material lands in.
   */
  function spillFan(x, y, spread, reach, density) {
    const mx = x + 128;
    const my = y + 18;
    // On a bone-white pan the readable value is SHADOW. Highlights are a rim
    // on the lumps, never the body of the mark - a white streak on white crust
    // is nothing at 1280x720, in fog or out of it.
    for (let i = 0; i < 46; i += 1) {
      const a = (rng() - 0.5) * spread;
      const len = reach * (0.45 + rng() * 0.55);
      const ex = mx + Math.sin(a) * len;
      const ey = my + Math.cos(a) * len;
      stroke(s, mx + Math.sin(a) * 10, my + Math.cos(a) * 10, ex, ey,
        2 + rng() * 4, PAN.SHADE, 0.16 + rng() * 0.2);
    }
    for (let i = 0; i < density; i += 1) {
      const a = (rng() - 0.5) * spread;
      const len = reach * (0.6 + rng() * 0.42);
      const lx = mx + Math.sin(a) * len;
      const ly = my + Math.cos(a) * len;
      const r = 5 + rng() * 10;
      // Lump: shadow side, body, then a hard lit cap. falloff 0.5 keeps the
      // edge crisp so it reads as a piece of salt, not a smudge.
      blob(s, lx + 4, ly + 4, r, PAN.CUT, { cell: 3, alpha: 0.3, falloff: 1 });
      blob(s, lx, ly, r, PAN.SHADE, { cell: 3, alpha: 0.62, falloff: 0.55 });
      blob(s, lx - 2, ly - 2, r * 0.5, PAN.LIT, { cell: 3, alpha: 0.5, falloff: 0.7 });
      // A second, smaller lump off the same landing point breaks the circle:
      // one blob is a bead, two overlapping blobs are a piece of broken crust.
      blob(s, lx + r * 0.55, ly + r * 0.3, r * 0.6, PAN.SHADE,
        { cell: 3, alpha: 0.5, falloff: 0.55 });
    }
  }
  T.add("SPILL_FAN_HEAVY", 0, 256, 256, 256, "loadout drop, running chute");
  spillFan(0, 256, 1.5, 210, 58);
  T.add("SPILL_FAN_LIGHT", 256, 256, 256, 256, "loadout drop, trailing off");
  spillFan(256, 256, 1.1, 150, 26);
  T.add("SPILL_FAN_SPLIT", 512, 256, 256, 256, "twin chute, overlapping toes");
  spillFan(512, 256, 0.62, 190, 30);
  spillFan(512, 256, 2.1, 120, 22);

  T.add("HARVESTER_TURN", 768, 256, 256, 256, "scraped turning arc at a windrow head");
  clipped(s, 768, 256, 256, 256, () => {
    for (let i = 0; i < 22; i += 1) {
      const r = 62 + i * 4.4;
      const a0 = -0.35 + rng() * 0.12;
      const a1 = 2.1 + rng() * 0.2;
      let px = 768 + 30 + Math.cos(a0) * r;
      let py = 256 + 24 + Math.sin(a0) * r;
      for (let k = 1; k <= 12; k += 1) {
        const a = a0 + ((a1 - a0) * k) / 12;
        const nx = 768 + 30 + Math.cos(a) * r;
        const ny = 256 + 24 + Math.sin(a) * r;
        stroke(s, px, py, nx, ny, 2, i % 3 ? PAN.SCRAPE : PAN.CUT, 0.42 + rng() * 0.28);
        px = nx;
        py = ny;
      }
    }
    grain(s, 768, 256, 256, 256, PAN.LIT, { cell: 3, density: 0.3, alpha: 0.22, rng });
  });

  // -- Row 2, y 512-640: harvester scrape lines, tileable along U ----------
  /**
   * The harvesters cut the crust in parallel passes and leave a corduroy of
   * shallow grooves with a bright turned edge on the key side. Tileable along
   * U so a 90 m run of harvested pan is one strip repeated, not forty decals.
   */
  function scrapeBundle(x, y, w, h, lines, wander) {
    clipped(s, x, y, w, h, () => {
      for (let i = 0; i < lines; i += 1) {
        const ly = y + 8 + (i * (h - 16)) / lines + rng() * 2;
        let px = x;
        let py = ly;
        for (let k = 1; k <= 16; k += 1) {
          const nx = x + (w * k) / 16;
          const ny = ly + Math.sin((k / 16) * 6.283 + i) * wander;
          stroke(s, px, py, nx, ny, 3, PAN.CUT, 0.5);
          stroke(s, px, py + 3, nx, ny + 3, 3, PAN.SHADE, 0.4);
          stroke(s, px, py - 2, nx, ny - 2, 1, PAN.LIT, 0.55);
          px = nx;
          py = ny;
        }
      }
      grain(s, x, y, w, h, PAN.WARM, { cell: 3, density: 0.3, alpha: 0.2, rng });
    });
  }
  T.add("SCRAPE_BUNDLE_A", 0, 512, 512, 128, "harvester corduroy, 9 passes, U-tileable");
  scrapeBundle(0, 512, 512, 128, 9, 1.6);
  T.add("SCRAPE_BUNDLE_B", 512, 512, 512, 128, "harvester corduroy, 6 passes, worn");
  scrapeBundle(512, 512, 512, 128, 6, 2.6);

  // -- Row 3, y 640-768: windrows ------------------------------------------
  /**
   * A windrow is the ridge the harvester throws to one side: lit crest, shaded
   * flank, lumpy silhouette. Its whole job here is to be the one thing on the
   * pan with a horizon of its own, so the scud cards have an edge to cross.
   */
  function windrow(x, y, w, h, crest, taperEnd) {
    clipped(s, x, y, w, h, () => {
      const base = y + h - 18;
      const top = [];
      for (let i = 0; i <= 32; i += 1) {
        const t = i / 32;
        const taper = taperEnd ? Math.min(1, (1 - t) * 2.6) : 1;
        top.push([x + t * w, base - (crest + Math.sin(t * 11) * 5 + rng() * 6) * taper]);
      }
      // Flank in shade, a deeper wedge along the base, then a thin lit crest.
      // The ridge has to own a horizon line the scud cards can cross, and a
      // horizon is a value change, so the mass is dark and only the top few
      // pixels are bright.
      poly(s, [...top, [x + w, base], [x, base]], PAN.SHADE, 0.94);
      poly(s, [...top.map(([px, py]) => [px, py + 10]), [x + w, base], [x, base]],
        PAN.DEEP, 0.3);
      for (let i = 0; i < top.length - 1; i += 1) {
        stroke(s, top[i][0], top[i][1], top[i + 1][0], top[i + 1][1], 4, PAN.LIT, 1);
        stroke(s, top[i][0], top[i][1] + 5, top[i + 1][0], top[i + 1][1] + 5, 3,
          PAN.DEEP, 0.34);
      }
      // Toe shadow on the pan, key at azimuth 56 degrees.
      rect(s, x, base, w, 9, PAN.DEEP, 0.34);
      rect(s, x, base + 9, w, 5, PAN.SHADE, 0.22);
      grain(s, x, y, w, h, PAN.LIT, { cell: 3, density: 0.34, alpha: 0.26, rng });
    });
  }
  T.add("WINDROW_LONG", 0, 640, 512, 128, "continuous salt windrow, U-tileable");
  windrow(0, 640, 512, 128, 52, false);
  T.add("WINDROW_BROKEN", 512, 640, 256, 128, "worked windrow, gapped");
  windrow(512, 640, 256, 128, 38, false);
  clear(s, 596, 640, 26, 128);
  T.add("WINDROW_END", 768, 640, 256, 128, "windrow head, tapered");
  windrow(768, 640, 256, 128, 46, true);

  // -- Row 4, y 768-896: conveyor shadow, tileable along U -----------------
  /**
   * OCC2_conveyor_span is the only accepted element over the drivable
   * corridor, and at 15.5 m with the S3 key at 63 degrees it lays a hard band
   * across the deck. This is that band as surface, not as geometry: a soft
   * penumbra, a solid core, and the regular darker blocks the trestle legs and
   * the belt idlers cut into it. Zero height, so it is painted road under
   * `FLAT_FURNITURE_MAX_HEIGHT_METRES` and stands outside the furniture rule.
   */
  T.add("CONVEYOR_SHADOW", 0, 768, 1024, 128, "span shadow band across the deck, U-tileable");
  clipped(s, 0, 768, 1024, 128, () => {
    rect(s, 0, 796, 1024, 72, PAN.BRINE_DEEP, 0.46);
    rect(s, 0, 806, 1024, 52, P.INK, 0.3);
    for (let i = 0; i < 16; i += 1) {
      rect(s, i * 64 + 14, 796, 22, 72, P.INK, 0.22);
    }
    for (let i = 0; i < 6; i += 1) {
      rect(s, 0, 788 + i * 2, 1024, 1, PAN.BRINE_DEEP, 0.06 + i * 0.03);
      rect(s, 0, 868 - i * 2, 1024, 1, PAN.BRINE_DEEP, 0.06 + i * 0.03);
    }
    grain(s, 0, 780, 1024, 100, P.INK, { cell: 4, density: 0.22, alpha: 0.14, rng });
  });

  // -- Row 5, y 896-1024: brine stains and route language ------------------
  T.add("BRINE_STAIN", 0, 896, 256, 128, "standing brine, crystallised rim");
  blob(s, 122, 964, 96, PAN.BRINE_DEEP, { cell: 4, alpha: 0.42, falloff: 1.5 });
  blob(s, 96, 948, 52, PAN.BRINE_DEEP, { cell: 4, alpha: 0.3, falloff: 1.7 });
  masked(s, () => grain(s, 0, 896, 256, 128, PAN.LIT, { cell: 3, density: 0.3, alpha: 0.4, rng }));
  // The rim is where the brine gave up its salt: a broken necklace of crystal
  // lumps, each with its own shadow so it survives against white crust.
  for (let i = 0; i < 40; i += 1) {
    const a = rng() * 6.283;
    const r = 84 + rng() * 18;
    const cx = 122 + Math.cos(a) * r;
    const cy = 964 + Math.sin(a) * r * 0.72;
    const rad = 5 + rng() * 6;
    blob(s, cx + 3, cy + 3, rad, PAN.CUT, { cell: 3, alpha: 0.36, falloff: 0.9 });
    blob(s, cx, cy, rad, PAN.SHADE, { cell: 3, alpha: 0.72, falloff: 0.55 });
    blob(s, cx + rad * 0.5, cy - rad * 0.3, rad * 0.6, PAN.SHADE,
      { cell: 3, alpha: 0.6, falloff: 0.55 });
    blob(s, cx - 1, cy - 1, rad * 0.5, PAN.LIT, { cell: 3, alpha: 0.55, falloff: 0.7 });
  }

  T.add("BRINE_SHEEN", 256, 896, 256, 128, "wet pan sheen, the HZ_SALT_DRIFT telegraph");
  blob(s, 384, 960, 112, PAN.BRINE, { cell: 5, alpha: 0.26, falloff: 1.2 });
  blob(s, 356, 952, 62, P.BP_CYAN, { cell: 5, alpha: 0.1, falloff: 1.6 });
  grain(s, 268, 908, 232, 104, PAN.LIT, { cell: 4, density: 0.22, alpha: 0.2, rng });

  T.add("ROUTE_EDGE_CYAN", 512, 896, 256, 128, "route edge line, U-tileable");
  rect(s, 512, 936, 256, 14, P.BP_CYAN, 0.88);
  rect(s, 512, 950, 256, 4, PAN.BRINE_DEEP, 0.3);
  for (let i = 0; i < 8; i += 1) rect(s, 516 + i * 32, 962, 18, 7, P.BP_CYAN, 0.5);
  masked(s, () => grain(s, 512, 896, 256, 128, PAN.LIT, { cell: 3, density: 0.24, alpha: 0.42, rng }));

  T.add("ROUTE_ARROW_ORANGE", 768, 896, 256, 128, "direction chevron pair, warning orange");
  [0, 96].forEach((ox) => {
    poly(s, [[796 + ox, 918], [864 + ox, 960], [796 + ox, 1002],
      [796 + ox, 976], [820 + ox, 960], [796 + ox, 944]], P.BP_ORANGE, 0.92);
  });
  masked(s, () => grain(s, 768, 896, 256, 128, P.INK, { cell: 3, density: 0.2, alpha: 0.34, rng }));

  return { name: "bitterpan_crust_1024", width: 1024, height: 1024, rgba: s.rgba, regions: T.regions };
}

// ===========================================================================
// SHEET 3 — hangar_fixtures_512
//
// Hangar Six is a barrier span: `greenwater-blockout.json` authors
// HANGAR_INTERIOR with widthMetres 0, so `resolveFurniturePlacement` turns 13
// pieces of edge furniture into wall plaques — pinned 0.35 m inside the wall
// line and lifted to the 3.2 m plaque band. Correct, and the reason the P11
// obstacle-on-the-road bug is gone. But a plaque pinned to a pillar-frame wall
// with nothing behind it floats: the frame is open structure, so the panel
// reads as hanging in the gap between pillars.
//
// This sheet is the thing behind it. A backing panel is not decoration — it is
// the answer to "what is this bolted to". Dark, so the plaque's own contrast is
// unchanged; larger than the plaque by a consistent margin; bolted at four
// corners; with a drip lip that catches the hangar's top light and a recess
// shadow under the plaque's lower edge so the plaque sits proud of it.
// ===========================================================================

export function buildHangarFixtures() {
  const s = createSurface(512, 512);
  const rng = mulberry32(0x6c19);
  const T = regionTable();
  const P = PALETTE;

  /**
   * One panel.
   *
   * The recess is FLUSH WITH THE BOTTOM EDGE, not centred, and that is a
   * clearance decision rather than a compositional one. A wall plaque is
   * resolved with its lower edge exactly on PLAQUE_BAND_BOTTOM_METRES (3.2 m)
   * — that is the whole reason it is allowed to sit 0.35 m inside the deck
   * line. A backing panel with a symmetric margin would hang 0.5 m BELOW the
   * plaque, which puts structure over the drivable deck under the band and
   * fails the P13 rule. So the panel grows upward only: side margins, a deep
   * top band carrying the drip lip, the fixings and the serial, and a bottom
   * edge flush with the plaque's.
   */
  function panel(x, y, w, h, insetX, recessH, serial) {
    rect(s, x, y, w, h, P.STEEL_DARK, 1);
    // Rolled steel: lit top edge, shadowed bottom. Two rows, not a gradient —
    // a gradient on a 4 px bevel is three greys nobody can see.
    rect(s, x, y, w, 3, P.STEEL, 0.85);
    rect(s, x, y + h - 4, w, 4, P.INK, 0.75);
    rect(s, x, y, 3, h, P.STEEL, 0.4);
    rect(s, x + w - 3, y, 3, h, P.INK, 0.55);
    // Drip lip along the top, the detail that says outdoor-rated hardware
    // bolted indoors because that is what the field authority had.
    rect(s, x + 6, y + 5, w - 12, 6, P.INK_SOFT, 0.9);
    rect(s, x + 6, y + 5, w - 12, 2, P.STEEL, 0.55);
    // Plaque recess, bottom-flush.
    const rx = x + insetX;
    const ry = y + h - recessH;
    const rw = w - insetX * 2;
    rect(s, rx, ry, rw, recessH, P.INK, 0.85);
    rect(s, rx, ry, rw, 6, P.INK, 1);       // shadow the proud plaque casts
    rect(s, rx - 3, ry, 3, recessH, P.INK, 0.8);
    rect(s, rx + rw, ry, 3, recessH, P.STEEL, 0.35);
    rect(s, rx - 3, ry - 3, rw + 6, 3, P.STEEL, 0.45);
    // Fixings in the side margins and the top band — never in the recess,
    // which the plaque covers.
    const bolt = (bx, by) => {
      rect(s, bx, by, 11, 11, P.INK, 0.95);
      rect(s, bx + 1, by + 1, 9, 3, P.STEEL, 0.7);
      rect(s, bx + 2, by + 5, 7, 4, P.STEEL_DARK, 0.9);
    };
    const mid = Math.round(insetX / 2) - 5;
    bolt(x + mid, y + 20);
    bolt(x + w - mid - 11, y + 20);
    bolt(x + mid, y + h - 24);
    bolt(x + w - mid - 11, y + h - 24);
    if (serial) text(s, serial, x + mid - 4, y + h - recessH - 14, 1, P.BONE_DIM,
      { tracking: 1, alpha: 0.6 });
    // Clumped, not speckled. Even 4 px rust noise across a whole panel reads
    // as sensor grain at 720p with MSAA; oxide collects in corners and under
    // fixings, so that is where it goes.
    masked(s, () => {
      for (let i = 0; i < 7; i += 1) {
        blob(s, x + 12 + rng() * (w - 24), y + 12 + rng() * (h - 24), 14 + rng() * 26,
          P.RUST, { cell: 4, alpha: 0.24, falloff: 1.4 });
      }
    });
    grain(s, x, y, w, h, P.INK, { cell: 4, density: 0.18, alpha: 0.26, rng });
  }

  // Sized to the two plaque footprints the runtime actually draws
  // (course.ts: chevron 3.00 x 1.45 m, braking board 2.465 x 1.28 m), each with
  // a 0.45 m side margin and a 0.25 m top/bottom margin. The region aspect
  // matches the intended metres so nothing is stretched.
  // Region aspect equals intended metres, so nothing is stretched, and the
  // recess is the plaque's real footprint to the pixel:
  //   chevron  3.90 x 1.95 m over 512 x 256 px  = 131.28 px/m; 3.000 x 1.450 m
  //            plaque = 394 x 190 px, side margin 59 px = 0.449 m
  //   board    3.15 x 1.80 m over 448 x 256 px  = 142.22 px/m; 2.465 x 1.280 m
  //            plaque = 350 x 182 px, side margin 49 px = 0.345 m
  T.add("PANEL_CHEVRON", 0, 0, 512, 256, "backing for the 3.00 x 1.45 m chevron plaque; 3.90 x 1.95 m");
  panel(0, 0, 512, 256, 59, 190, "H6-CH");

  T.add("PANEL_BOARD", 0, 256, 448, 256, "backing for the 2.465 x 1.28 m braking board; 3.15 x 1.80 m");
  panel(0, 256, 448, 256, 49, 182, "H6-BD");

  T.add("BOLT_PAIR", 448, 256, 64, 128, "spare fixing detail for a wider panel");
  rect(s, 448, 256, 64, 128, P.STEEL_DARK, 1);
  for (let i = 0; i < 2; i += 1) {
    rect(s, 470, 286 + i * 56, 20, 20, P.INK, 0.95);
    rect(s, 472, 288 + i * 56, 16, 5, P.STEEL, 0.7);
  }
  masked(s, () => blob(s, 480, 340, 30, P.RUST, { cell: 4, alpha: 0.26, falloff: 1.4 }));

  T.add("MOUNT_STRAP", 448, 384, 64, 128, "vertical strap, ties a panel to a pillar");
  rect(s, 460, 384, 40, 128, P.STEEL_DARK, 1);
  rect(s, 460, 384, 4, 128, P.STEEL, 0.5);
  rect(s, 496, 384, 4, 128, P.INK, 0.7);
  for (let i = 0; i < 4; i += 1) rect(s, 474, 396 + i * 32, 12, 12, P.INK, 0.9);
  masked(s, () => {
    blob(s, 480, 420, 24, P.RUST, { cell: 3, alpha: 0.3, falloff: 1.3 });
    blob(s, 476, 486, 20, P.RUST, { cell: 3, alpha: 0.26, falloff: 1.3 });
  });

  return { name: "hangar_fixtures_512", width: 512, height: 512, rgba: s.rgba, regions: T.regions };
}

// ===========================================================================
// SHEET 4 — totem_wear_1024
//
// The wear pass, at intensity 45 of 100, delivered as an OVERLAY sheet rather
// than as edits to the four livery PNGs. Three reasons, in order of weight:
//
//  1. The four sheets are build products of `totem.js` / the handoff generator
//     (totem/MANIFEST.json "source"), not of this pipeline. Compositing wear
//     into them here would mean decoding a PNG, drawing over it and re-encoding
//     — an operation that is not idempotent, so `--check` would pass once and
//     fail on the second run, and the registered hash would stop meaning
//     "these pixels came from this source".
//  2. Filenames must not change and silhouettes are validator-pinned. An
//     overlay touches neither.
//  3. Intensity becomes one number. `WEAR` below is 0.45; every alpha on this
//     sheet is scaled by it, so re-authoring at 30 or 60 is a one-line change
//     and a rebuild, not a re-draw.
//
// UV contract: the CHIP_WEAR_STRIP region sits at exactly [8, 900, 896, 96] —
// the livery atlas's own paint-chip strip, per MANIFEST.texture_assignments —
// so a straight multiply of this sheet over a livery sheet wears the hull
// palette in place with no mapping at all. Every other region is a LIBRARY
// slot, addressed by name, to be placed on the 12 decal cells by whoever owns
// that UV layout; the cell rects are not published in the manifest and are not
// guessed here.
//
// Authored for the livery atlas's stated filtering — mips on, anisotropy 1 —
// so grain cells are 5-6 px, not 3. At 45/100 this is a machine that is
// serviced, not abandoned.
// ===========================================================================

export const WEAR = 0.45;

export function buildLiveryWearAtlas() {
  const s = createSurface(1024, 1024);
  const rng = mulberry32(0x45c2);
  const T = regionTable();
  const P = PALETTE;
  const w = (a) => a * WEAR;

  // -- Row 0, y 0-256 -------------------------------------------------------
  T.add("GRIME_SOFT", 0, 0, 256, 256, "broad settled grime, multiply");
  for (let i = 0; i < 26; i += 1) {
    blob(s, 20 + rng() * 216, 20 + rng() * 216, 22 + rng() * 54, P.INK,
      { cell: 6, alpha: w(0.3), falloff: 1.5 });
  }
  grain(s, 0, 0, 256, 256, P.INK, { cell: 6, density: 0.4, alpha: w(0.3), rng, wear: false });

  T.add("GRIME_STREAK", 256, 0, 256, 256, "wash streaking, hangs from the top edge");
  for (let i = 0; i < 44; i += 1) {
    const x = 260 + rng() * 248;
    const len = 40 + rng() * 180;
    stroke(s, x, 4, x + (rng() - 0.5) * 10, 4 + len, 2 + rng() * 5, P.INK, w(0.26));
  }
  for (let i = 0; i < 14; i += 1) {
    const x = 260 + rng() * 248;
    stroke(s, x, 4, x, 4 + 60 + rng() * 150, 2, P.RUST, w(0.3));
  }

  T.add("SOOT_FAN", 512, 0, 256, 256, "exhaust soot, aft of the nozzle exits");
  for (let i = 0; i < 60; i += 1) {
    const t = rng();
    blob(s, 540 + t * 200, 128 + (rng() - 0.5) * (28 + t * 150), 8 + rng() * 26,
      P.INK, { cell: 5, alpha: w(0.4 - t * 0.22), falloff: 1.4 });
  }
  for (let i = 0; i < 18; i += 1) {
    blob(s, 528 + rng() * 60, 128 + (rng() - 0.5) * 44, 6 + rng() * 14,
      P.RUST, { cell: 5, alpha: w(0.3), falloff: 1.6 });
  }

  T.add("REPAIR_PATCH_A", 768, 0, 256, 256, "bolted repair plate, oversprayed edge");
  rect(s, 800, 40, 176, 168, P.STEEL_DARK, w(1.7));
  frame(s, 800, 40, 176, 168, 4, P.STEEL, w(1.3));
  for (let i = 0; i < 12; i += 1) {
    rect(s, 812 + (i % 4) * 50, 54 + Math.floor(i / 4) * 62, 9, 9, P.INK, w(1.8));
  }
  grain(s, 800, 40, 176, 168, P.RUST, { cell: 5, density: 0.3, alpha: w(0.7), rng });
  // Overspray: whoever fitted the plate masked nothing.
  for (let i = 0; i < 30; i += 1) {
    blob(s, 792 + rng() * 192, 32 + rng() * 184, 6 + rng() * 16, P.INK_SOFT,
      { cell: 5, alpha: w(0.24), falloff: 1.5 });
  }

  // -- Row 1, y 256-512 -----------------------------------------------------
  T.add("REPAIR_PATCH_B", 0, 256, 256, 256, "welded strap, ground back and left bare");
  poly(s, [[28, 300], [222, 286], [228, 350], [34, 366]], P.STEEL, w(1.5));
  poly(s, [[28, 300], [222, 286], [224, 300], [30, 314]], P.BONE_DIM, w(0.9));
  for (let i = 0; i < 22; i += 1) {
    const t = i / 21;
    blob(s, 34 + t * 188, 296 + t * -8 + (rng() - 0.5) * 8, 5 + rng() * 5,
      P.STEEL_DARK, { cell: 4, alpha: w(0.8), falloff: 1 });
  }
  grain(s, 24, 282, 210, 92, P.RUST, { cell: 5, density: 0.34, alpha: w(0.8), rng });
  // Rust weeps DOWN from the strap's fixings. Random crossing strokes read as
  // scribble; parallel vertical runs read as water that has been somewhere.
  for (let i = 0; i < 16; i += 1) {
    const x = 34 + rng() * 186;
    stroke(s, x, 360 + rng() * 8, x + (rng() - 0.5) * 6, 386 + rng() * 74,
      1 + rng() * 3, P.RUST, w(0.34));
  }

  /**
   * A mismatched replacement panel. The point of the 45/100 brief is that this
   * craft is SERVED — parts get replaced, and the replacement was never the
   * right colour. So this slot is a flat primer-grey field with a hard edge, a
   * supplier stencil, and none of the base livery's paint quality. Laid over a
   * hull cell it replaces the paint rather than dirtying it.
   */
  T.add("MISMATCH_PANEL", 256, 256, 512, 256, "unpainted replacement panel, primer grey");
  rect(s, 272, 288, 480, 192, P.BONE_DIM, w(1.9));
  rect(s, 272, 288, 480, 5, P.BONE, w(1.4));
  rect(s, 272, 475, 480, 5, P.INK, w(1.5));
  textCentred(s, "NEEDLE REPAIR", 512, 330, 4, P.STEEL_DARK, { tracking: 2, alpha: w(2) });
  textCentred(s, "PANEL 14-C · NOT FINISHED", 512, 376, 2, P.STEEL_DARK,
    { tracking: 2, alpha: w(1.7) });
  rect(s, 400, 412, 224, 8, P.NEEDLE, w(1.6));
  grain(s, 272, 288, 480, 192, P.STEEL, { cell: 6, density: 0.3, alpha: w(0.6), rng });
  grain(s, 272, 288, 480, 192, P.RUST, { cell: 6, density: 0.14, alpha: w(0.5), rng });

  T.add("GRIME_CORNER", 768, 256, 256, 256, "corner accumulation, for cell edges");
  for (let i = 0; i < 34; i += 1) {
    const t = rng();
    blob(s, 776 + t * t * 200, 264 + rng() * 232, 10 + rng() * 34, P.INK,
      { cell: 6, alpha: w(0.34 * (1 - t)), falloff: 1.3 });
  }

  // -- Row 2, y 512-640 -----------------------------------------------------
  T.add("SCUFF_EDGE", 0, 512, 512, 128, "abraded leading edge, paint worn to metal");
  // Abrasion runs ALONG the edge it wears, so every mark is near-horizontal
  // and packed against the top of the band, densest at the lip.
  for (let i = 0; i < 110; i += 1) {
    const x = rng() * 512;
    const len = 6 + rng() * 46;
    const y = 524 + rng() * rng() * 32;
    stroke(s, x, y, x + len, y + (rng() - 0.5) * 2, 1 + rng() * 2,
      rng() > 0.4 ? P.STEEL : P.BONE_DIM, w(0.7));
  }
  rect(s, 0, 520, 512, 3, P.STEEL, w(0.9));
  grain(s, 0, 512, 512, 128, P.INK, { cell: 5, density: 0.26, alpha: w(0.4), rng, wear: false });

  T.add("RIVET_ROW", 512, 512, 512, 64, "tileable fixing line, 64 px pitch");
  for (let i = 0; i < 8; i += 1) {
    rect(s, 536 + i * 64, 528, 12, 12, P.INK, w(1.6));
    rect(s, 538 + i * 64, 530, 8, 4, P.STEEL, w(1.2));
    blob(s, 542 + i * 64, 546, 12, P.RUST, { cell: 4, alpha: w(0.5), falloff: 1.6 });
  }

  T.add("STENCIL_REPAIR", 512, 576, 512, 64, "service stencil applied over the livery");
  textFitCentred(s, "REWORK 0714 · SYNDICATE WORKS", 776, 594, 468, 3, P.BONE,
    { tracking: 2, alpha: w(1.5) });
  rect(s, 520, 586, 4, 40, P.PRIVATEER, w(1.6));

  // -- Row 3, y 640-896 -----------------------------------------------------
  T.add("DUST_FILM", 0, 640, 1024, 128, "even settled dust, whole-cell multiply");
  grain(s, 0, 640, 1024, 128, PAN.WARM, { cell: 6, density: 0.46, alpha: w(0.24), rng, wear: false });
  grain(s, 0, 640, 1024, 128, P.INK, { cell: 6, density: 0.22, alpha: w(0.2), rng, wear: false });

  T.add("OVERSPRAY", 0, 768, 1024, 128, "masking bleed and touch-up haze");
  for (let i = 0; i < 70; i += 1) {
    blob(s, rng() * 1024, 768 + rng() * 128, 10 + rng() * 34, P.INK_SOFT,
      { cell: 6, alpha: w(0.2), falloff: 1.4 });
  }
  for (let i = 0; i < 8; i += 1) {
    rect(s, i * 128 + 12, 776, 104, 3, P.BONE_DIM, w(0.5));
  }

  /**
   * The chip strip, in register with the livery atlas at [8, 900, 896, 96].
   *
   * This is the careful one. `texture_assignments.paint_chip_strip` says the
   * runtime hull UVs COLLAPSE TO A CHIP CENTRE — the strip is the entire body
   * palette, one flat colour per material. So anything drawn here is a uniform
   * shift of that whole material, not texture on it: a chip's centre is the
   * only pixel that is ever sampled. Grain and streaks in the middle of a chip
   * would be a lottery, not a treatment.
   *
   * Therefore each chip gets ONE deliberate multiply value at its centre and
   * the wear detail is pushed to the chip margins, where it is visible on the
   * sheet in review but never sampled by the hull. Values are the 45/100 read
   * per material: mechanisms and hardware dirty fastest, the accent fades, the
   * oxide patch spreads, the shadow black barely moves because it is already
   * the darkest thing on the craft.
   */
  const CHIP_WEAR = [
    ["carbon_shell", 0.16], ["petrol_panel", 0.2], ["gunmetal_mech", 0.34],
    ["faded_grey", 0.3], ["shadow_black", 0.07], ["acid_paint", 0.26],
    ["warning_orange", 0.3], ["oxide_patch", 0.38],
  ];
  T.add("CHIP_WEAR_STRIP", 8, 900, 896, 96,
    "in register with livery paint-chip strip; one multiply per material");
  CHIP_WEAR.forEach(([name, amount], i) => {
    const cx = 8 + i * 112;
    rect(s, cx, 900, 96, 96, P.INK, w(amount));
    // Margin detail: visible in review, outside the sampled centre.
    grain(s, cx, 900, 96, 10, P.RUST, { cell: 5, density: 0.4, alpha: w(0.5), rng, wear: false });
    grain(s, cx, 986, 96, 10, P.INK, { cell: 5, density: 0.4, alpha: w(0.5), rng, wear: false });
    if (name === "oxide_patch") {
      blob(s, cx + 48, 948, 46, P.RUST, { cell: 5, alpha: w(0.5), falloff: 1.4 });
    }
  });

  T.add("WEAR_KEY", 8, 1000, 896, 20, "authoring key, never sampled at runtime");
  textCentred(s, "WEAR 45 OF 100 · OVERLAY · MULTIPLY", 456, 1004, 2, P.STEEL,
    { tracking: 2, alpha: 0.5 });

  return { name: "totem_wear_1024", width: 1024, height: 1024, rgba: s.rgba, regions: T.regions };
}

export const PASS02_ATLASES = [
  buildCrustTile,
  buildBitterpanCrustAtlas,
  buildHangarFixtures,
  buildLiveryWearAtlas,
];
