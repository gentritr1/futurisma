/**
 * FUTURISMA — Pass 03 authored atlases. "The world past the barriers."
 *
 * Third sibling of `atlas-draw.mjs`. Same rules as Pass 02: every primitive is
 * imported from Pass 01 so there is one rasteriser, one 5x7 face, one blend
 * rule; the Pass 01 and Pass 02 sheets and their rng streams are not touched,
 * so their registered hashes keep meaning "these pixels came from this source".
 *
 * Three sheets, four deliverables:
 *
 *   bitterpan_facades_1024   D1 structure facades (15 face regions)
 *   futurisma_horizon_1024   D2 horizon silhouette cards (16 x 256 cells)
 *   futurisma_trim_512       D3 signage back panels + D4 road edge band
 *
 * Draw-call arithmetic, stated up front because it is the budget that matters:
 *
 *   D1  +0 both maps. Every facade region lives on ONE sheet, so each massing
 *       family keeps exactly the one merged material it already has. Texturing
 *       a blockout family is a material swap, not a new batch.
 *   D2  Greenwater +1 batch, Bitterpan +2 (silhouette + additive shimmer).
 *   D3  +1 per map: a back face cannot share the signage material because it
 *       does not sample the signage sheet.
 *   D4  Bitterpan +1 decal batch. The band cannot ride BP_SURFACE_CRUST —
 *       that material samples bitterpan_crust_1024, which is hash-pinned.
 *
 * Filtering contract per sheet:
 *   facades  mips ON, LinearFilter, anisotropy 4. These are seen from 8 m to
 *            900 m on the same frame; a nearest-filtered rib pitch at 720p
 *            with MSAA is a moire generator.
 *   horizon  NearestFilter, no mips — the card sheets' own contract
 *            (`living-world.ts`: sRGB, nearest both filters, no mipmaps).
 *   trim     the band strips are magnified onto ground quads, so nearest and
 *            a crisp painted edge, exactly like the Pass 02 decal sheets.
 *
 * Exports `PASS03_LAYOUT` (the region truth, from which
 * `data/PASS03_ATLAS_REGIONS.json` is generated), the three builders, and
 * `PASS03_ATLASES`.
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
} from "./atlas-draw.mjs";
import { PAN } from "./atlas-draw-pass02.mjs";

// ---------------------------------------------------------------------------
// Pass 03 palette additions.
//
// Anchored to two things that already exist and cannot be renegotiated: the
// PAN ramp (Pass 02) and the three Bitterpan sector fog values in
// BITTERPAN_PRODUCTION.json — S1 #c7b997, S2 #d5cfb9, S3 #aeb8b2. Every
// structure value below is picked to sit BETWEEN the pan and its own sector's
// fog, because that is the only way a facade reads as mass at 400 m: it must be
// darker than the pan it stands on and darker than the air in front of it.
//
// The five massing materials in MASSING_PLACEMENTS.json get one value family
// each, so a family's skin and its silhouette agree.
// ---------------------------------------------------------------------------

export const FACADE = {
  GALV: [152, 162, 159, 255],        // MASS_galvanised_sheet, lit rib
  GALV_MID: [118, 129, 128, 255],
  GALV_DARK: [82, 92, 92, 255],
  PLANT: [141, 108, 82, 255],        // MASS_corroded_plant_steel, sun side
  PLANT_MID: [104, 79, 61, 255],
  PLANT_DARK: [67, 54, 46, 255],
  CANVAS: [181, 168, 140, 255],      // MASS_weathered_canvas
  CANVAS_DARK: [117, 107, 88, 255],
  GLASS: [214, 210, 194, 255],       // MASS_bleached_fibreglass, tank staves
  GLASS_DARK: [163, 160, 146, 255],
  CONCRETE: [168, 163, 148, 255],    // stained pour
  CONCRETE_DARK: [113, 109, 98, 255],
  LAMP: [255, 177, 84, 255],         // HANGAR_LAMP_COLOR, the dusk interior
  LAMP_DEEP: [196, 108, 42, 255],
  FOG_S1: [199, 185, 151, 255],
  FOG_S2: [213, 207, 185, 255],
  FOG_S3: [174, 184, 178, 255],
};

/**
 * THE REGION TRUTH.
 *
 * Both the builders below and `data/PASS03_ATLAS_REGIONS.json` are generated
 * from this literal, so a rect can never drift between the sheet and the
 * registry. `metres` is the world footprint the region is authored for — the
 * mapping specs in `data/` quote it rather than re-deriving it.
 */
export const PASS03_LAYOUT = {
  bitterpan_facades_1024: {
    width: 1024,
    height: 1024,
    filtering: "mips on, linear, anisotropy 4",
    regions: {
      SKIN_GALV_RIB: { x: 0, y: 0, w: 256, h: 256, metres: [4, 4], note: "galvanised corrugated skin, 0.25 m rib pitch, tiles U and V" },
      SKIN_PLANT_STEEL: { x: 256, y: 0, w: 256, h: 256, metres: [4, 4], note: "corroded plant steel, bolted plate seams, tiles U and V" },
      SKIN_PATCHED: { x: 512, y: 0, w: 256, h: 256, metres: [4, 4], note: "corrugated with three mismatched replacement sheets, tiles U" },
      SKIN_CANVAS: { x: 768, y: 0, w: 256, h: 256, metres: [4, 4], note: "weathered canvas over a frame, lashed, torn at one corner" },
      SKIN_CONCRETE: { x: 0, y: 256, w: 512, h: 256, metres: [8, 4], note: "stained concrete, pour lines and form ties, brine wick at base" },
      LATTICE_RIG: { x: 512, y: 256, w: 256, h: 256, metres: [6, 6], note: "open rig lattice, ALPHA region, alphaTest 0.5, tiles U and V" },
      SKIN_TANK: { x: 768, y: 256, w: 256, h: 256, metres: [6, 6], note: "bleached fibreglass staves, two hoop ribs, brine tide rings" },
      TRIM_VENT: { x: 0, y: 512, w: 256, h: 256, metres: [4, 4], note: "vent and cowl cluster on galvanised ground; face patch, not tileable" },
      TRIM_PIPE_RUN: { x: 256, y: 512, w: 256, h: 256, metres: [4, 4], note: "horizontal pipe bundle on brackets, tiles U" },
      TRIM_DUCT_STACK: { x: 512, y: 512, w: 256, h: 256, metres: [4, 4], note: "vertical duct and extract cowl for tall rigs, tiles V" },
      ROOF_SHEET: { x: 768, y: 512, w: 256, h: 256, metres: [6, 6], note: "roof sheeting, skylight strip, salt drift in the valleys, tiles U and V" },
      WINDOW_STRIP_DUSK: { x: 0, y: 768, w: 512, h: 128, metres: [8, 2], note: "eight lit bays, 1.0 m pitch, tiles U; the dusk read" },
      WINDOW_STRIP_DEAD: { x: 512, y: 768, w: 512, h: 128, metres: [8, 2], note: "same eight bays unlit, for time-of-day stop 0" },
      BASE_SKIRT: { x: 0, y: 896, w: 512, h: 128, metres: [8, 2], note: "salt wick and drift bank at grade, tiles U; marries facade to crust" },
      FACADE_TAGS: { x: 512, y: 896, w: 512, h: 128, metres: [8, 2], note: "four 2.0 m stencil tag blocks, one per size class" },
    },
  },
  futurisma_horizon_1024: {
    width: 1024,
    height: 1024,
    filtering: "nearest, no mips, sRGB — the card sheet contract",
    cells: "atlasRect(1024, 4, slot)",
    regions: {
      TREELINE_DENSE: { x: 0, y: 0, w: 256, h: 256, slot: 0, note: "Greenwater wetland treeline, closed canopy" },
      TREELINE_BROKEN: { x: 256, y: 0, w: 256, h: 256, slot: 1, note: "treeline with a gap and two emergents" },
      TREELINE_SNAG: { x: 512, y: 0, w: 256, h: 256, slot: 2, note: "drowned snags, thin verticals over low scrub" },
      PYLON_RUN: { x: 768, y: 0, w: 256, h: 256, slot: 3, note: "transmission pylon pair with catenary" },
      GANTRY_FAR: { x: 0, y: 256, w: 256, h: 256, slot: 4, note: "far service gantry, open frame" },
      HANGAR_MASS: { x: 256, y: 256, w: 256, h: 256, slot: 5, note: "distant hangar shed, one ridge, one vent" },
      SILO_PAIR: { x: 512, y: 256, w: 256, h: 256, slot: 6, note: "two silos and a link bridge" },
      TANK_FARM_FAR: { x: 768, y: 256, w: 256, h: 256, slot: 7, note: "low tank row, horizontal read" },
      STACK_CLUSTER: { x: 0, y: 512, w: 256, h: 256, slot: 8, note: "Bitterpan refinery stacks, three of unequal height" },
      STACK_SINGLE: { x: 256, y: 512, w: 256, h: 256, slot: 9, note: "one tall stack with a guyed collar" },
      PLANT_MASS: { x: 512, y: 512, w: 256, h: 256, slot: 10, note: "refinery plant block, stepped" },
      RIG_FAR: { x: 768, y: 512, w: 256, h: 256, slot: 11, note: "far harvester rig, the S1 silhouette at distance" },
      MESA_LONG: { x: 0, y: 768, w: 256, h: 256, slot: 12, note: "long low mesa line, flat top, scree toe" },
      MESA_BLUFF: { x: 256, y: 768, w: 256, h: 256, slot: 13, note: "mesa bluff end, the one vertical in the far band" },
      SHIMMER_BAND: { x: 512, y: 768, w: 256, h: 256, slot: 14, note: "heat shimmer band, additive, bottom-weighted" },
      HAZE_BAND: { x: 768, y: 768, w: 256, h: 256, slot: 15, note: "dust haze band, normal blend, sits under the silhouettes" },
    },
  },
  futurisma_trim_512: {
    width: 512,
    height: 512,
    filtering: "nearest, no mips — magnified painted edges",
    regions: {
      SIGN_BACK_BLANK: { x: 0, y: 0, w: 256, h: 256, metres: [2.5, 2.5], note: "board back: ribbed weathered panel, frame, through-bolts, no art" },
      SIGN_BACK_TAGGED: { x: 256, y: 0, w: 256, h: 256, metres: [2.5, 2.5], note: "same panel plus a stencilled service tag block" },
      EDGE_BAND_DECK: { x: 0, y: 256, w: 512, h: 64, metres: [24, 3], note: "deck-lip edge band, full rhythm, tiles U over 24 m" },
      EDGE_BAND_PAN: { x: 0, y: 320, w: 512, h: 64, metres: [24, 3], note: "open-pan degrade: shorter dashes, broken outer lip, no hairline" },
      EDGE_BAND_BERM: { x: 0, y: 384, w: 512, h: 64, metres: [24, 3], note: "berm and works-stand variant, 45 deg hatch outboard of the band" },
      EDGE_TICK_SET: { x: 0, y: 448, w: 512, h: 64, metres: [6, 3], note: "four 1.5 m ticks: cyan span entry, orange chevron, wear cap, blank" },
    },
  },
};

/** Region bookkeeping — same contract as Pass 01 and Pass 02. */
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

/** Register every region of a layout sheet, in declaration order. */
function registerSheet(layout) {
  const T = regionTable();
  for (const [id, r] of Object.entries(layout.regions)) T.add(id, r.x, r.y, r.w, r.h, r.note);
  return { T, R: (id) => layout.regions[id] };
}

/** Run `fn` at the eight wrap offsets plus the origin. Pass 02's helper. */
function seamless(size, fn) {
  for (let oy = -1; oy <= 1; oy += 1) {
    for (let ox = -1; ox <= 1; ox += 1) fn(ox * size, oy * size);
  }
}

// ===========================================================================
// SHEET 1 — bitterpan_facades_1024
//
// Every structure on the pan is untextured blockout: 226 placements across 15
// families, all reading as one flat value. That is why the pan currently has no
// middle distance — the crust floor and the sky are both doing work, and
// everything between them is a grey box.
//
// The treatment is deliberately NOT "detail". At 300 km/h a facade is read as
// three things and no more: a value against the fog, a direction (ribs are
// vertical, pipes are horizontal, lattice is diagonal), and a base that touches
// the ground. So each region commits hard to one direction, holds one value
// band, and carries its own grade contact. Detail smaller than ~0.1 m is only
// present where it survives the first mip drop as tone.
//
// The 64 px/m authoring scale on the skins is chosen so a 0.25 m rib is 16 px:
// four mip levels down it is still 1 px of alternating value, which is a rib
// pitch read as texture rather than as sparkle.
// ===========================================================================

export function buildBitterpanFacades() {
  const s = createSurface(1024, 1024);
  const rng = mulberry32(0x3f10);
  const P = PALETTE;
  const F = FACADE;
  const { T, R } = registerSheet(PASS03_LAYOUT.bitterpan_facades_1024);

  /** Vertical corrugation. Lit face, shaded flank, one dark valley line. */
  function corrugate(x, y, w, h, pitch, lit, mid, dark) {
    rect(s, x, y, w, h, mid, 1);
    for (let i = 0; i * pitch < w; i += 1) {
      const rx = x + i * pitch;
      rect(s, rx, y, Math.round(pitch * 0.44), h, lit, 0.5);
      rect(s, rx + Math.round(pitch * 0.62), y, Math.round(pitch * 0.3), h, dark, 0.62);
      rect(s, rx + Math.round(pitch * 0.94), y, 1, h, dark, 0.34);
    }
  }

  /** Horizontal sheet laps: where two runs of cladding overlap, every 1.5 m. */
  function laps(x, y, w, h, pitch, dark, lit) {
    for (let ly = y + pitch; ly < y + h; ly += pitch) {
      rect(s, x, ly - 2, w, 3, dark, 0.5);
      rect(s, x, ly + 1, w, 1, lit, 0.35);
    }
  }

  // -- SKIN_GALV_RIB --------------------------------------------------------
  // The S3 signature. Galvanised sheet reads COOL against the warm pan, which
  // is the whole reason the loadout basin feels like a different place.
  {
    const r = R("SKIN_GALV_RIB");
    clipped(s, r.x, r.y, r.w, r.h, () => {
      corrugate(r.x, r.y, r.w, r.h, 16, F.GALV, F.GALV_MID, F.GALV_DARK);
      laps(r.x, r.y, r.w, r.h, 96, F.GALV_DARK, F.GALV);
      // Zinc weathers in patches, not evenly. Six soft plates of value, wrapped
      // so the patchiness survives tiling.
      seamless(256, (ox, oy) => {
        blob(s, r.x + ox + 58, r.y + oy + 74, 74, F.GALV_DARK, { cell: 6, alpha: 0.16, falloff: 1.5 });
        blob(s, r.x + ox + 190, r.y + oy + 168, 62, F.GALV, { cell: 6, alpha: 0.14, falloff: 1.6 });
      });
      // Salt bloom creeps up from grade; the pan gets into everything.
      grain(s, r.x, r.y + 196, r.w, 60, PAN.WHITE, { cell: 4, density: 0.3, alpha: 0.22, rng });
      grain(s, r.x, r.y, r.w, r.h, P.INK, { cell: 4, density: 0.14, alpha: 0.16, rng });
    });
  }

  // -- SKIN_PLANT_STEEL -----------------------------------------------------
  // The S1 warm mass: bolted plate, corroded, the sector's primary silhouette
  // material. Seams run horizontally so this skin never competes with the
  // galvanised ribs for direction.
  {
    const r = R("SKIN_PLANT_STEEL");
    clipped(s, r.x, r.y, r.w, r.h, () => {
      rect(s, r.x, r.y, r.w, r.h, F.PLANT_MID, 1);
      for (let py = 0; py < r.h; py += 64) {
        rect(s, r.x, r.y + py, r.w, 62, F.PLANT, 0.3 + (py / 64 % 2) * 0.16);
        rect(s, r.x, r.y + py + 60, r.w, 4, F.PLANT_DARK, 0.7);
        rect(s, r.x, r.y + py + 64, r.w, 1, F.PLANT, 0.3);
        for (let i = 0; i < 8; i += 1) {
          rect(s, r.x + 12 + i * 32, r.y + py + 52, 6, 6, F.PLANT_DARK, 0.8);
          rect(s, r.x + 12 + i * 32, r.y + py + 52, 6, 2, F.PLANT, 0.5);
        }
      }
      seamless(256, (ox, oy) => {
        blob(s, r.x + ox + 76, r.y + oy + 110, 66, P.RUST, { cell: 5, alpha: 0.3, falloff: 1.4 });
        blob(s, r.x + ox + 202, r.y + oy + 46, 48, P.RUST, { cell: 5, alpha: 0.24, falloff: 1.5 });
      });
      // Weeps run DOWN from the fixings. Parallel, never crossing: crossing
      // strokes read as scribble, parallel runs read as water with a history.
      for (let i = 0; i < 22; i += 1) {
        const x = r.x + rng() * r.w;
        const y0 = r.y + Math.floor(rng() * 4) * 64 + 56;
        stroke(s, x, y0, x + (rng() - 0.5) * 4, y0 + 22 + rng() * 54, 1 + rng() * 2, P.RUST, 0.3);
      }
      grain(s, r.x, r.y, r.w, r.h, P.INK, { cell: 4, density: 0.16, alpha: 0.2, rng });
    });
  }

  // -- SKIN_PATCHED ---------------------------------------------------------
  // The Pass 02 wear argument, applied to buildings: this is a site that is
  // SERVED. Three sheets have been replaced and none of them match. The value
  // break is the point; the seams are hard, not blended.
  {
    const r = R("SKIN_PATCHED");
    clipped(s, r.x, r.y, r.w, r.h, () => {
      corrugate(r.x, r.y, r.w, r.h, 16, F.GALV, F.GALV_MID, F.GALV_DARK);
      const patch = (px, py, pw, ph, base, lit, dark) => {
        corrugate(r.x + px, r.y + py, pw, ph, 16, lit, base, dark);
        rect(s, r.x + px, r.y + py, pw, 2, P.INK, 0.55);
        rect(s, r.x + px, r.y + py + ph - 2, pw, 2, P.INK, 0.45);
        rect(s, r.x + px, r.y + py, 2, ph, P.INK, 0.4);
        for (let i = 0; i < Math.floor(pw / 40); i += 1) {
          rect(s, r.x + px + 14 + i * 40, r.y + py + 6, 5, 5, P.INK, 0.75);
          rect(s, r.x + px + 14 + i * 40, r.y + py + ph - 11, 5, 5, P.INK, 0.75);
        }
      };
      patch(0, 32, 128, 64, F.PLANT_MID, F.PLANT, F.PLANT_DARK);      // wrong metal
      patch(160, 128, 96, 80, F.CONCRETE_DARK, F.CONCRETE, P.INK);     // wrong finish
      patch(48, 176, 96, 48, F.GALV_DARK, F.GALV_MID, P.INK);          // right metal, new
      laps(r.x, r.y, r.w, r.h, 96, F.GALV_DARK, F.GALV);
      masked(s, () => {
        for (let i = 0; i < 8; i += 1) {
          blob(s, r.x + rng() * 256, r.y + rng() * 256, 16 + rng() * 30, P.RUST,
            { cell: 5, alpha: 0.24, falloff: 1.4 });
        }
      });
      grain(s, r.x, r.y, r.w, r.h, P.INK, { cell: 4, density: 0.16, alpha: 0.18, rng });
    });
  }

  // -- SKIN_CANVAS ----------------------------------------------------------
  // The wind screens: 27 placements, the closest ordinary massing to the deck
  // and the only soft material on the pan. Sag and lashing carry it; the tear
  // is at one corner only, because a screen that has torn everywhere would have
  // been taken down.
  {
    const r = R("SKIN_CANVAS");
    clipped(s, r.x, r.y, r.w, r.h, () => {
      rect(s, r.x, r.y, r.w, r.h, F.CANVAS, 1);
      // Sag between lashing points: a chain of shallow arcs, shaded underneath.
      for (let b = 0; b < 5; b += 1) {
        const by = r.y + 26 + b * 52;
        for (let i = 0; i < 4; i += 1) {
          const x0 = r.x + i * 64;
          for (let k = 0; k < 8; k += 1) {
            const t0 = k / 8;
            const t1 = (k + 1) / 8;
            const dip = (t) => Math.sin(t * Math.PI) * 9;
            stroke(s, x0 + t0 * 64, by + dip(t0), x0 + t1 * 64, by + dip(t1), 3,
              F.CANVAS_DARK, 0.42);
            stroke(s, x0 + t0 * 64, by + dip(t0) - 4, x0 + t1 * 64, by + dip(t1) - 4, 2,
              PAN.LIT, 0.22);
          }
        }
      }
      // Lashing eyelets and cord.
      for (let i = 0; i < 4; i += 1) {
        for (let b = 0; b < 5; b += 1) {
          const ex = r.x + 8 + i * 64;
          const ey = r.y + 26 + b * 52;
          rect(s, ex - 3, ey - 3, 7, 7, P.INK, 0.7);
          stroke(s, ex, ey, ex + 12, ey + 9, 2, F.CANVAS_DARK, 0.6);
        }
      }
      // One torn corner, flapping loose over the frame behind it.
      poly(s, [[r.x + 196, r.y + 214], [r.x + 256, r.y + 200], [r.x + 256, r.y + 256],
        [r.x + 208, r.y + 256]], P.INK, 0.42);
      poly(s, [[r.x + 196, r.y + 214], [r.x + 238, r.y + 222], [r.x + 214, r.y + 256],
        [r.x + 196, r.y + 250]], F.CANVAS_DARK, 0.8);
      grain(s, r.x, r.y, r.w, r.h, PAN.WARM, { cell: 5, density: 0.34, alpha: 0.24, rng });
      grain(s, r.x, r.y + 180, r.w, 76, P.INK, { cell: 4, density: 0.2, alpha: 0.2, rng });
    });
  }

  // -- SKIN_CONCRETE --------------------------------------------------------
  // Stained concrete for the loadout plinths and the tank bunds. Twice as wide
  // as the other skins because a pour is wide: 8 m of form work at 64 px/m, so
  // the 2 m lifts and the tie holes land where a real pour puts them.
  {
    const r = R("SKIN_CONCRETE");
    clipped(s, r.x, r.y, r.w, r.h, () => {
      rect(s, r.x, r.y, r.w, r.h, F.CONCRETE, 1);
      for (let lift = 0; lift < 2; lift += 1) {
        const ly = r.y + 128 * lift;
        rect(s, r.x, ly, r.w, 128, lift ? F.CONCRETE : F.CONCRETE_DARK, lift ? 0 : 0.12);
        rect(s, r.x, ly, r.w, 3, F.CONCRETE_DARK, 0.6);   // pour line
        rect(s, r.x, ly + 3, r.w, 1, PAN.LIT, 0.3);
        for (let i = 0; i < 8; i += 1) {                  // form ties
          const tx = r.x + 30 + i * 64;
          rect(s, tx, ly + 62, 9, 9, F.CONCRETE_DARK, 0.7);
          rect(s, tx + 1, ly + 63, 7, 3, P.INK, 0.4);
          stroke(s, tx + 4, ly + 71, tx + 4, ly + 71 + 26 + rng() * 40, 3, F.CONCRETE_DARK, 0.26);
        }
      }
      // Brine wicks UP out of the pan through the pour, and it is the strongest
      // mark on this region: a wet base is what tells you the ground is salt.
      for (let i = 0; i < 30; i += 1) {
        const x = r.x + rng() * r.w;
        const h = 26 + rng() * 62;
        stroke(s, x, r.y + r.h, x + (rng() - 0.5) * 6, r.y + r.h - h, 3 + rng() * 5,
          PAN.BRINE_DEEP, 0.16);
      }
      rect(s, r.x, r.y + r.h - 10, r.w, 10, PAN.BRINE_DEEP, 0.24);
      masked(s, () => grain(s, r.x, r.y + r.h - 76, r.w, 76, PAN.WHITE,
        { cell: 4, density: 0.34, alpha: 0.3, rng }));
      grain(s, r.x, r.y, r.w, r.h, P.INK, { cell: 4, density: 0.14, alpha: 0.16, rng });
    });
  }

  // -- LATTICE_RIG (ALPHA) --------------------------------------------------
  // The one alpha region on the sheet. A harvester rig is 36 placements of open
  // frame; skinning it opaque is what makes the current blockout read as a
  // shipping container. Left transparent between members, alphaTest 0.5 — the
  // same treatment the GW_LIVING_SILHOUETTE batch already uses and defends.
  {
    const r = R("LATTICE_RIG");
    clipped(s, r.x, r.y, r.w, r.h, () => {
      const chord = (x0, y0, x1, y1, wide, alpha) =>
        stroke(s, r.x + x0, r.y + y0, r.x + x1, r.y + y1, wide, F.PLANT_MID, alpha);
      for (let i = 0; i < 3; i += 1) {          // verticals, 2 m pitch
        const vx = 22 + i * 106;
        rect(s, r.x + vx, r.y, 11, r.h, F.PLANT_MID, 0.95);
        rect(s, r.x + vx, r.y, 4, r.h, F.PLANT, 0.6);
        rect(s, r.x + vx + 8, r.y, 3, r.h, F.PLANT_DARK, 0.8);
      }
      for (let i = 0; i < 4; i += 1) {          // horizontals, 1.5 m pitch
        const hy = 30 + i * 64;
        rect(s, r.x, r.y + hy, r.w, 8, F.PLANT_MID, 0.92);
        rect(s, r.x, r.y + hy, r.w, 3, F.PLANT, 0.55);
      }
      for (let i = 0; i < 4; i += 1) {          // diagonals, alternating
        const y0 = 30 + i * 64;
        chord(22, y0, 128, y0 + 64, 6, 0.85);
        chord(128, y0, 234, y0 + 64, 6, 0.85);
      }
      masked(s, () => {
        for (let i = 0; i < 12; i += 1) {
          blob(s, r.x + rng() * 256, r.y + rng() * 256, 10 + rng() * 22, P.RUST,
            { cell: 4, alpha: 0.34, falloff: 1.3 });
        }
        grain(s, r.x, r.y, r.w, r.h, P.INK, { cell: 4, density: 0.2, alpha: 0.24, rng });
      });
    });
  }

  // -- SKIN_TANK ------------------------------------------------------------
  // Bleached fibreglass. The family note says it holds a value NEAR salt, so
  // silhouette has to carry the read: staves are barely there, the two hoops
  // and the tide rings do the work.
  {
    const r = R("SKIN_TANK");
    clipped(s, r.x, r.y, r.w, r.h, () => {
      rect(s, r.x, r.y, r.w, r.h, F.GLASS, 1);
      for (let i = 0; i < 8; i += 1) {          // staves, 0.75 m
        const sx = r.x + i * 32;
        rect(s, sx, r.y, 30, r.h, F.GLASS_DARK, 0.12);
        rect(s, sx + 29, r.y, 3, r.h, F.GLASS_DARK, 0.4);
      }
      [64, 176].forEach((hy) => {               // hoop ribs
        rect(s, r.x, r.y + hy, r.w, 14, F.GLASS_DARK, 0.55);
        rect(s, r.x, r.y + hy, r.w, 4, PAN.LIT, 0.45);
        rect(s, r.x, r.y + hy + 14, r.w, 4, P.INK, 0.3);
        for (let i = 0; i < 6; i += 1) rect(s, r.x + 18 + i * 40, r.y + hy + 4, 7, 7, P.INK, 0.6);
      });
      // Tide rings: every level this tank has been emptied to.
      [104, 126, 148, 210].forEach((ty, i) => {
        rect(s, r.x, r.y + ty, r.w, 2 + (i === 3 ? 4 : 0), PAN.BRINE_DEEP, 0.2 + i * 0.06);
      });
      masked(s, () => {
        for (let i = 0; i < 9; i += 1) {
          blob(s, r.x + rng() * 256, r.y + 150 + rng() * 100, 14 + rng() * 26, PAN.BRINE,
            { cell: 5, alpha: 0.22, falloff: 1.5 });
        }
        grain(s, r.x, r.y, r.w, r.h, PAN.WARM, { cell: 5, density: 0.26, alpha: 0.18, rng });
      });
    });
  }

  // -- TRIM_VENT ------------------------------------------------------------
  {
    const r = R("TRIM_VENT");
    clipped(s, r.x, r.y, r.w, r.h, () => {
      corrugate(r.x, r.y, r.w, r.h, 16, F.GALV, F.GALV_MID, F.GALV_DARK);
      // Louvred box, cowl, and a small grille — three sizes so the cluster has
      // a hierarchy rather than reading as one texture event.
      rect(s, r.x + 26, r.y + 44, 112, 88, F.GALV_DARK, 1);
      frame(s, r.x + 26, r.y + 44, 112, 88, 4, F.GALV, 0.8);
      for (let i = 0; i < 7; i += 1) {
        rect(s, r.x + 32, r.y + 52 + i * 11, 100, 6, P.INK, 0.6);
        rect(s, r.x + 32, r.y + 52 + i * 11 + 6, 100, 2, F.GALV, 0.5);
      }
      poly(s, [[r.x + 158, r.y + 130], [r.x + 158, r.y + 66], [r.x + 196, r.y + 44],
        [r.x + 226, r.y + 44], [r.x + 226, r.y + 130]], F.GALV_MID, 1);
      rect(s, r.x + 158, r.y + 60, 68, 6, P.INK, 0.55);
      rect(s, r.x + 176, r.y + 130, 32, 74, F.GALV_DARK, 1);   // downpipe
      rect(s, r.x + 176, r.y + 130, 8, 74, F.GALV, 0.5);
      rect(s, r.x + 44, r.y + 168, 56, 40, F.GALV_DARK, 1);
      for (let i = 0; i < 5; i += 1) rect(s, r.x + 48, r.y + 172 + i * 8, 48, 4, P.INK, 0.55);
      // Everything that vents, stains what is under it.
      for (let i = 0; i < 18; i += 1) {
        const x = r.x + 30 + rng() * 200;
        stroke(s, x, r.y + 132 + rng() * 20, x + (rng() - 0.5) * 5, r.y + 200 + rng() * 56,
          2 + rng() * 3, P.INK, 0.2);
      }
      masked(s, () => grain(s, r.x, r.y, r.w, r.h, P.RUST, { cell: 4, density: 0.16, alpha: 0.2, rng }));
    });
  }

  // -- TRIM_PIPE_RUN --------------------------------------------------------
  {
    const r = R("TRIM_PIPE_RUN");
    clipped(s, r.x, r.y, r.w, r.h, () => {
      corrugate(r.x, r.y, r.w, r.h, 16, F.GALV, F.GALV_MID, F.GALV_DARK);
      const pipe = (py, thick, color) => {
        rect(s, r.x, r.y + py, r.w, thick, F.PLANT_DARK, 0.9);
        rect(s, r.x, r.y + py, r.w, Math.max(2, Math.round(thick * 0.3)), color, 0.7);
        rect(s, r.x, r.y + py + thick - 2, r.w, 2, P.INK, 0.6);
        rect(s, r.x, r.y + py + thick, r.w, 5, P.INK, 0.22);   // cast shadow
      };
      pipe(96, 26, F.PLANT);
      pipe(130, 16, F.GALV);
      pipe(152, 10, F.PLANT_MID);
      for (let i = 0; i < 4; i += 1) {          // brackets every 1 m
        const bx = r.x + 20 + i * 64;
        rect(s, bx, r.y + 88, 12, 84, F.PLANT_DARK, 1);
        rect(s, bx, r.y + 88, 4, 84, F.PLANT_MID, 0.6);
        rect(s, bx - 4, r.y + 92, 20, 6, F.PLANT_DARK, 1);
      }
      // Flanges: two per run, so a repeat has a landmark and does not slide.
      [70, 198].forEach((fx) => {
        rect(s, r.x + fx, r.y + 92, 12, 34, F.PLANT, 0.9);
        rect(s, r.x + fx, r.y + 126, 10, 24, F.GALV, 0.8);
      });
      masked(s, () => {
        for (let i = 0; i < 10; i += 1) {
          blob(s, r.x + rng() * 256, r.y + 90 + rng() * 80, 10 + rng() * 20, P.RUST,
            { cell: 4, alpha: 0.3, falloff: 1.3 });
        }
      });
      for (let i = 0; i < 14; i += 1) {
        const x = r.x + rng() * r.w;
        stroke(s, x, r.y + 166, x + (rng() - 0.5) * 4, r.y + 190 + rng() * 60, 2, P.RUST, 0.26);
      }
    });
  }

  // -- TRIM_DUCT_STACK ------------------------------------------------------
  {
    const r = R("TRIM_DUCT_STACK");
    clipped(s, r.x, r.y, r.w, r.h, () => {
      rect(s, r.x, r.y, r.w, r.h, F.PLANT_MID, 1);
      laps(r.x, r.y, r.w, r.h, 64, F.PLANT_DARK, F.PLANT);
      rect(s, r.x + 88, r.y, 80, r.h, F.GALV_MID, 1);         // the duct
      rect(s, r.x + 88, r.y, 14, r.h, F.GALV, 0.7);
      rect(s, r.x + 156, r.y, 12, r.h, F.GALV_DARK, 0.85);
      rect(s, r.x + 80, r.y, 96, 6, P.INK, 0.3);
      for (let i = 0; i < 4; i += 1) {          // joint collars, 1 m
        const cy = r.y + 26 + i * 64;
        rect(s, r.x + 82, cy, 92, 12, F.GALV_DARK, 1);
        rect(s, r.x + 82, cy, 92, 3, PAN.LIT, 0.35);
        rect(s, r.x + 82, cy + 12, 92, 4, P.INK, 0.4);
      }
      rect(s, r.x + 60, r.y, 136, 26, F.GALV_DARK, 1);        // extract cowl
      poly(s, [[r.x + 60, r.y + 26], [r.x + 196, r.y + 26], [r.x + 176, r.y + 48],
        [r.x + 80, r.y + 48]], F.GALV_MID, 1);
      masked(s, () => {
        for (let i = 0; i < 12; i += 1) {
          blob(s, r.x + 60 + rng() * 140, r.y + rng() * 256, 12 + rng() * 24, P.INK,
            { cell: 5, alpha: 0.2, falloff: 1.4 });
        }
        grain(s, r.x, r.y, r.w, r.h, P.RUST, { cell: 4, density: 0.2, alpha: 0.24, rng });
      });
    });
  }

  // -- ROOF_SHEET -----------------------------------------------------------
  // Blockout boxes have tops, and on a pan lit from 63-74 degrees the tops are
  // half of what you see from the deck at any elevation change. Salt collects
  // in the valleys, which is the one thing that makes a roof look outdoors.
  {
    const r = R("ROOF_SHEET");
    clipped(s, r.x, r.y, r.w, r.h, () => {
      rect(s, r.x, r.y, r.w, r.h, F.GALV_MID, 1);
      for (let i = 0; i * 24 < r.w; i += 1) {
        const rx = r.x + i * 24;
        rect(s, rx, r.y, 10, r.h, F.GALV, 0.55);
        rect(s, rx + 12, r.y, 10, r.h, F.GALV_DARK, 0.5);
        grain(s, rx + 13, r.y, 8, r.h, PAN.WHITE, { cell: 3, density: 0.4, alpha: 0.3, rng });
      }
      rect(s, r.x, r.y + 96, r.w, 40, F.GLASS, 0.8);          // skylight strip
      frame(s, r.x, r.y + 96, r.w, 40, 3, F.GALV_DARK, 0.9);
      for (let i = 0; i < 6; i += 1) rect(s, r.x + 8 + i * 42, r.y + 96, 4, 40, F.GALV_DARK, 0.8);
      grain(s, r.x, r.y + 100, r.w, 32, PAN.WARM, { cell: 4, density: 0.3, alpha: 0.26, rng });
      // Drift banked against the skylight kerb, windward side only (292 deg).
      rect(s, r.x, r.y + 136, r.w, 9, PAN.WHITE, 0.5);
      grain(s, r.x, r.y + 140, r.w, 22, PAN.LIT, { cell: 4, density: 0.34, alpha: 0.34, rng });
      masked(s, () => grain(s, r.x, r.y, r.w, r.h, P.INK, { cell: 4, density: 0.12, alpha: 0.16, rng }));
    });
  }

  // -- WINDOW_STRIP_DUSK / _DEAD -------------------------------------------
  // The time-of-day ramp runs to stop 4 and Bitterpan's runs further into amber
  // than Greenwater's. Nothing on the pan currently changes when it does. Eight
  // bays at 1 m pitch, lit warm, is the cheapest possible answer: the pan gets
  // an interior it never has to model.
  function windowStrip(r, lit) {
    clipped(s, r.x, r.y, r.w, r.h, () => {
      rect(s, r.x, r.y, r.w, r.h, F.GALV_MID, 1);
      laps(r.x, r.y, r.w, r.h, 40, F.GALV_DARK, F.GALV);
      rect(s, r.x, r.y + 18, r.w, 4, F.GALV_DARK, 0.8);       // head rail
      rect(s, r.x, r.y + 96, r.w, 5, F.GALV_DARK, 0.8);       // cill
      rect(s, r.x, r.y + 101, r.w, 3, PAN.LIT, 0.3);
      for (let i = 0; i < 8; i += 1) {
        const bx = r.x + 10 + i * 64;
        rect(s, bx, r.y + 22, 44, 74, lit ? F.LAMP_DEEP : P.INK, lit ? 0.9 : 0.8);
        if (lit) {
          // Warm interior, brighter at the head where a fitting hangs, with a
          // spill onto the cladding under the cill. Two bays are dead: a shed
          // with every bay lit is a hotel.
          const dead = i === 2 || i === 6;
          if (!dead) {
            rect(s, bx + 3, r.y + 25, 38, 68, F.LAMP, 0.72);
            rect(s, bx + 3, r.y + 25, 38, 20, F.LAMP, 0.9);
            blob(s, bx + 22, r.y + 60, 42, F.LAMP, { cell: 5, alpha: 0.22, falloff: 1.8 });
            rect(s, bx - 4, r.y + 101, 52, 10, F.LAMP, 0.16);
          } else {
            rect(s, bx + 3, r.y + 25, 38, 68, P.INK, 0.5);
          }
        }
        for (let k = 0; k < 3; k += 1) rect(s, bx + 13 + k * 14, r.y + 22, 3, 74, F.GALV_DARK, 0.85);
        rect(s, bx + 20, r.y + 22, 4, 74, F.GALV_DARK, 0.6);
        frame(s, bx - 3, r.y + 19, 50, 80, 3, F.GALV_DARK, 1);
      }
      grain(s, r.x, r.y, r.w, r.h, P.INK, { cell: 4, density: 0.14, alpha: 0.18, rng });
      grain(s, r.x, r.y + 104, r.w, 24, PAN.WHITE, { cell: 4, density: 0.28, alpha: 0.2, rng });
    });
  }
  windowStrip(R("WINDOW_STRIP_DUSK"), true);
  windowStrip(R("WINDOW_STRIP_DEAD"), false);

  // -- BASE_SKIRT -----------------------------------------------------------
  // Where a facade meets salt. Without this, every structure on the pan looks
  // like it was pasted onto the ground plane — and this is the one region that
  // will be applied to all 226 placements without exception.
  {
    const r = R("BASE_SKIRT");
    clipped(s, r.x, r.y, r.w, r.h, () => {
      rect(s, r.x, r.y, r.w, 54, P.CLEAR, 0);
      // Contact shadow, hard at grade and gone within 0.35 m.
      rect(s, r.x, r.y + 54, r.w, 10, P.INK, 0.44);
      rect(s, r.x, r.y + 64, r.w, 8, P.INK, 0.24);
      rect(s, r.x, r.y + 72, r.w, 8, PAN.DEEP, 0.16);
      // Drift bank: a lumpy salt horizon 0.2-0.5 m up the wall, higher on the
      // windward side of each bay so the whole strip has a direction.
      for (let i = 0; i < 26; i += 1) {
        const bx = r.x + i * 20;
        const crest = 18 + Math.sin(i * 0.7) * 10 + rng() * 8;
        poly(s, [[bx, r.y + 54], [bx + 6, r.y + 54 - crest], [bx + 18, r.y + 54 - crest * 0.7],
          [bx + 24, r.y + 54]], PAN.WHITE, 0.92);
        stroke(s, bx + 6, r.y + 54 - crest, bx + 18, r.y + 54 - crest * 0.7, 3, PAN.LIT, 0.9);
        stroke(s, bx + 6, r.y + 52 - crest, bx + 24, r.y + 54, 2, PAN.SHADE, 0.3);
      }
      // Brine wick above the drift, and crystallised bloom in the drift face.
      rect(s, r.x, r.y + 30, r.w, 24, PAN.BRINE_DEEP, 0.12);
      grain(s, r.x, r.y + 20, r.w, 40, PAN.BRINE, { cell: 4, density: 0.2, alpha: 0.16, rng });
      grain(s, r.x, r.y + 30, r.w, 30, PAN.LIT, { cell: 3, density: 0.36, alpha: 0.34, rng });
      grain(s, r.x, r.y + 54, r.w, 20, PAN.WARM, { cell: 3, density: 0.24, alpha: 0.2, rng });
    });
  }

  // -- FACADE_TAGS ----------------------------------------------------------
  // One stencil block per size class. Small, chalky, never glossy — the
  // MASS_sun_killed_paint note applies to lettering too.
  {
    const r = R("FACADE_TAGS");
    const tags = [
      ["SMALL", "WS-04", F.CANVAS_DARK],
      ["MID", "SH-11", F.GALV_DARK],
      ["TALL", "RIG-06", F.PLANT_DARK],
      ["TANK", "BT-02", F.GLASS_DARK],
    ];
    tags.forEach(([klass, code, ground], i) => {
      const x = r.x + i * 128;
      clipped(s, x, r.y, 128, r.h, () => {
        rect(s, x, r.y, 128, r.h, ground, 1);
        rect(s, x + 12, r.y + 22, 104, 3, PAN.WHITE, 0.6);
        textCentred(s, code, x + 64, r.y + 38, 3, PAN.WHITE, { tracking: 2, alpha: 0.82 });
        textCentred(s, klass, x + 64, r.y + 72, 2, PAN.WHITE, { tracking: 2, alpha: 0.5 });
        rect(s, x + 12, r.y + 92, 104, 8, P.BP_ORANGE, 0.5);
        masked(s, () => grain(s, x, r.y, 128, r.h, P.INK, { cell: 3, density: 0.3, alpha: 0.34, rng }));
        grain(s, x, r.y, 128, r.h, PAN.WARM, { cell: 4, density: 0.2, alpha: 0.16, rng });
      });
    });
  }

  return {
    name: "bitterpan_facades_1024", width: 1024, height: 1024, rgba: s.rgba, regions: T.regions,
  };
}

// ===========================================================================
// SHEET 2 — futurisma_horizon_1024
//
// Both maps end in flat gradient. The card system already knows how to stand a
// silhouette on the ground and lean it half a degree
// (`GREENWATER_ZONES_B.OPENING_WRECK_LINE`), so the horizon layer is that same
// idiom pushed out to 180-900 m — no new card kind, no new runtime path.
//
// Sixteen 256 px cells, addressed by `atlasRect(1024, 4, slot)` exactly like
// `greenwater_motion_b_512`. Two rules govern every cell:
//
//  1. Bottom-anchored. Cards are placed with `base: 0`, so the silhouette's
//     feet must be at the cell's bottom edge or the object floats. Every cell
//     draws its grade contact at y = 248-256.
//  2. Alpha 0.62 or higher inside the silhouette, nothing between 0.1 and 0.5
//     anywhere. The batch alpha-tests at 0.5; a soft edge does not survive it,
//     it just gets a jagged one. Softness is delivered by the per-band TINT in
//     the placement spec, not by feathering pixels.
// ===========================================================================

export function buildHorizonCards() {
  const s = createSurface(1024, 1024);
  const rng = mulberry32(0x3f2b);
  const P = PALETTE;
  const { T, R } = registerSheet(PASS03_LAYOUT.futurisma_horizon_1024);
  const INK = P.INK;

  /** Grade contact: the 8 px band that says "standing on something". */
  function grade(r, width, alpha) {
    rect(s, r.x + (256 - width) / 2, r.y + 248, width, 6, INK, alpha);
  }

  /** A canopy lump: overlapping crowns, flat-ish bottom, ragged top. */
  function canopy(r, x0, x1, base, height, count, alpha) {
    for (let i = 0; i < count; i += 1) {
      const t = i / (count - 1);
      const cx = r.x + x0 + t * (x1 - x0);
      const h = height * (0.62 + rng() * 0.5);
      const w = 18 + rng() * 22;
      poly(s, [[cx - w / 2, r.y + base], [cx - w * 0.36, r.y + base - h * 0.72],
        [cx, r.y + base - h], [cx + w * 0.4, r.y + base - h * 0.66],
        [cx + w / 2, r.y + base]], INK, alpha);
    }
    rect(s, r.x + x0 - 8, r.y + base - 6, x1 - x0 + 16, 8, INK, alpha);
  }

  // -- Slot 0-2: Greenwater treeline ---------------------------------------
  {
    const r = R("TREELINE_DENSE");
    canopy(r, 6, 250, 254, 96, 14, 0.86);
    rect(s, r.x, r.y + 236, r.w, 20, INK, 0.86);
    grade(r, 256, 0.86);
  }
  {
    const r = R("TREELINE_BROKEN");
    canopy(r, 4, 96, 254, 78, 6, 0.84);
    canopy(r, 150, 252, 254, 86, 7, 0.84);
    // Two emergents standing out of the canopy — the read that says wetland
    // rather than hedge.
    [[112, 132], [136, 150]].forEach(([ex, eh]) => {
      rect(s, r.x + ex, r.y + 254 - eh, 7, eh, INK, 0.82);
      poly(s, [[r.x + ex - 16, r.y + 254 - eh + 14], [r.x + ex + 3, r.y + 254 - eh - 6],
        [r.x + ex + 22, r.y + 254 - eh + 16], [r.x + ex + 3, r.y + 254 - eh + 8]], INK, 0.8);
    });
    rect(s, r.x, r.y + 244, r.w, 12, INK, 0.7);
    grade(r, 256, 0.8);
  }
  {
    const r = R("TREELINE_SNAG");
    rect(s, r.x, r.y + 226, r.w, 30, INK, 0.8);              // low scrub band
    for (let i = 0; i < 9; i += 1) {                          // drowned snags
      const sx = r.x + 14 + i * 27 + rng() * 8;
      const h = 54 + rng() * 78;
      rect(s, sx, r.y + 232 - h, 4 + (i % 2), h, INK, 0.78);
      stroke(s, sx + 2, r.y + 232 - h + 12, sx + 2 + (rng() > 0.5 ? 16 : -16),
        r.y + 232 - h + 2, 3, INK, 0.72);
    }
    grade(r, 256, 0.78);
  }

  // -- Slot 3: pylons -------------------------------------------------------
  {
    const r = R("PYLON_RUN");
    const pylon = (px, scale) => {
      const top = 254 - 176 * scale;
      poly(s, [[r.x + px - 26 * scale, r.y + 254], [r.x + px - 9 * scale, r.y + top],
        [r.x + px + 9 * scale, r.y + top], [r.x + px + 26 * scale, r.y + 254],
        [r.x + px + 17 * scale, r.y + 254], [r.x + px, r.y + top + 30 * scale],
        [r.x + px - 17 * scale, r.y + 254]], INK, 0.8);
      [0.06, 0.24].forEach((t, i) => {
        const ay = r.y + top + 176 * scale * t;
        rect(s, r.x + px - (44 - i * 8) * scale, ay, (88 - i * 16) * scale, 5 * scale, INK, 0.8);
      });
      for (let k = 0; k < 5; k += 1) {
        stroke(s, r.x + px - 20 * scale, r.y + 254 - k * 32 * scale,
          r.x + px + 20 * scale, r.y + 254 - (k + 1) * 32 * scale, 3, INK, 0.66);
      }
    };
    pylon(72, 1);
    pylon(196, 0.72);
    // Catenary between them, sagging. Drawn as chords so it alpha-tests clean.
    for (let k = 0; k < 10; k += 1) {
      const t0 = k / 10;
      const t1 = (k + 1) / 10;
      const sag = (t) => 96 + Math.sin(t * Math.PI) * 26;
      stroke(s, r.x + 72 + t0 * 124, r.y + sag(t0), r.x + 72 + t1 * 124, r.y + sag(t1), 3, INK, 0.62);
    }
    grade(r, 220, 0.7);
  }

  // -- Slot 4-7: Greenwater far industry -----------------------------------
  {
    const r = R("GANTRY_FAR");
    rect(s, r.x + 30, r.y + 70, 12, 184, INK, 0.8);
    rect(s, r.x + 208, r.y + 70, 12, 184, INK, 0.8);
    rect(s, r.x + 22, r.y + 58, 206, 16, INK, 0.82);
    rect(s, r.x + 96, r.y + 40, 62, 20, INK, 0.8);
    for (let i = 0; i < 4; i += 1) rect(s, r.x + 42, r.y + 100 + i * 40, 166, 7, INK, 0.7);
    stroke(s, r.x + 42, r.y + 90, r.x + 208, r.y + 244, 5, INK, 0.62);
    stroke(s, r.x + 208, r.y + 90, r.x + 42, r.y + 244, 5, INK, 0.62);
    grade(r, 240, 0.8);
  }
  {
    const r = R("HANGAR_MASS");
    poly(s, [[r.x + 8, r.y + 254], [r.x + 8, r.y + 148], [r.x + 128, r.y + 96],
      [r.x + 248, r.y + 148], [r.x + 248, r.y + 254]], INK, 0.84);
    rect(s, r.x + 104, r.y + 74, 48, 26, INK, 0.82);          // ridge vent
    rect(s, r.x + 32, r.y + 186, 56, 68, INK, 0.9);           // door void reads dark
    grade(r, 256, 0.86);
  }
  {
    const r = R("SILO_PAIR");
    [[70, 46, 150], [166, 38, 122]].forEach(([cx, rad, h]) => {
      rect(s, r.x + cx - rad, r.y + 254 - h, rad * 2, h, INK, 0.84);
      poly(s, [[r.x + cx - rad, r.y + 254 - h], [r.x + cx, r.y + 254 - h - 22],
        [r.x + cx + rad, r.y + 254 - h]], INK, 0.84);
    });
    rect(s, r.x + 70, r.y + 128, 116, 12, INK, 0.78);         // link bridge
    rect(s, r.x + 120, r.y + 140, 8, 114, INK, 0.7);
    grade(r, 230, 0.84);
  }
  {
    const r = R("TANK_FARM_FAR");
    for (let i = 0; i < 4; i += 1) {
      const tx = 22 + i * 58;
      const h = 52 + (i % 2) * 16;
      rect(s, r.x + tx, r.y + 254 - h, 50, h, INK, 0.82);
      rect(s, r.x + tx - 4, r.y + 250 - h, 58, 7, INK, 0.82);
    }
    rect(s, r.x, r.y + 236, r.w, 8, INK, 0.6);                // bund wall
    grade(r, 256, 0.8);
  }

  // -- Slot 8-11: Bitterpan refinery ---------------------------------------
  {
    const r = R("STACK_CLUSTER");
    [[54, 200, 16], [116, 156, 12], [176, 232, 20]].forEach(([sx, h, wide]) => {
      rect(s, r.x + sx, r.y + 254 - h, wide, h, INK, 0.84);
      rect(s, r.x + sx - 3, r.y + 254 - h, wide + 6, 10, INK, 0.84);
      rect(s, r.x + sx - 2, r.y + 254 - h + 26, wide + 4, 5, INK, 0.7);
    });
    rect(s, r.x + 20, r.y + 208, 216, 46, INK, 0.86);         // plant base
    for (let i = 0; i < 5; i += 1) rect(s, r.x + 30 + i * 44, r.y + 190, 10, 20, INK, 0.8);
    grade(r, 246, 0.86);
  }
  {
    const r = R("STACK_SINGLE");
    rect(s, r.x + 116, r.y + 12, 24, 242, INK, 0.86);
    rect(s, r.x + 110, r.y + 12, 36, 12, INK, 0.86);
    [58, 108, 158].forEach((cy) => rect(s, r.x + 108, r.y + cy, 40, 7, INK, 0.78));
    stroke(s, r.x + 128, r.y + 60, r.x + 42, r.y + 250, 3, INK, 0.64);   // guys
    stroke(s, r.x + 128, r.y + 60, r.x + 214, r.y + 250, 3, INK, 0.64);
    rect(s, r.x + 88, r.y + 230, 80, 24, INK, 0.84);
    grade(r, 150, 0.84);
  }
  {
    const r = R("PLANT_MASS");
    rect(s, r.x + 12, r.y + 178, 232, 76, INK, 0.86);
    rect(s, r.x + 44, r.y + 122, 96, 58, INK, 0.84);
    rect(s, r.x + 160, r.y + 96, 62, 84, INK, 0.84);
    rect(s, r.x + 176, r.y + 62, 14, 36, INK, 0.8);
    for (let i = 0; i < 6; i += 1) rect(s, r.x + 24 + i * 38, r.y + 160, 8, 20, INK, 0.72);
    stroke(s, r.x + 140, r.y + 140, r.x + 160, r.y + 140, 8, INK, 0.78);
    grade(r, 250, 0.86);
  }
  {
    const r = R("RIG_FAR");
    // The S1 harvester rig read at 400 m: a leg frame, a boom, a hopper. Same
    // stance as LATTICE_RIG on the facade sheet, so near and far agree.
    rect(s, r.x + 46, r.y + 126, 10, 128, INK, 0.82);
    rect(s, r.x + 150, r.y + 126, 10, 128, INK, 0.82);
    stroke(s, r.x + 51, r.y + 132, r.x + 155, r.y + 248, 5, INK, 0.7);
    stroke(s, r.x + 155, r.y + 132, r.x + 51, r.y + 248, 5, INK, 0.7);
    rect(s, r.x + 36, r.y + 104, 134, 24, INK, 0.84);         // hopper
    poly(s, [[r.x + 36, r.y + 104], [r.x + 170, r.y + 104], [r.x + 148, r.y + 74],
      [r.x + 58, r.y + 74]], INK, 0.84);
    stroke(s, r.x + 160, r.y + 92, r.x + 236, r.y + 44, 9, INK, 0.82);   // boom
    rect(s, r.x + 228, r.y + 40, 18, 10, INK, 0.8);
    grade(r, 190, 0.82);
  }

  // -- Slot 12-13: mesa ----------------------------------------------------
  {
    const r = R("MESA_LONG");
    // Flat top, then a scree toe. A mesa is one horizontal line and one value;
    // everything else is the toe deciding where the ground is.
    poly(s, [[r.x, r.y + 254], [r.x, r.y + 176], [r.x + 34, r.y + 168],
      [r.x + 222, r.y + 164], [r.x + 256, r.y + 172], [r.x + 256, r.y + 254]], INK, 0.8);
    for (let i = 0; i < 22; i += 1) {
      const sx = r.x + rng() * 256;
      stroke(s, sx, r.y + 214 + rng() * 10, sx + (rng() - 0.5) * 18, r.y + 250, 4, INK, 0.6);
    }
    rect(s, r.x, r.y + 240, r.w, 14, INK, 0.8);
    grade(r, 256, 0.8);
  }
  {
    const r = R("MESA_BLUFF");
    poly(s, [[r.x + 18, r.y + 254], [r.x + 30, r.y + 118], [r.x + 76, r.y + 96],
      [r.x + 188, r.y + 104], [r.x + 214, r.y + 150], [r.x + 232, r.y + 254]], INK, 0.82);
    // Two vertical shadow flutes: the only interior value a mesa needs.
    rect(s, r.x + 92, r.y + 110, 12, 140, INK, 0.9);
    rect(s, r.x + 150, r.y + 114, 9, 136, INK, 0.9);
    for (let i = 0; i < 16; i += 1) {
      const sx = r.x + 24 + rng() * 200;
      stroke(s, sx, r.y + 200 + rng() * 16, sx + (rng() - 0.5) * 22, r.y + 252, 5, INK, 0.62);
    }
    grade(r, 232, 0.82);
  }

  // -- Slot 14: SHIMMER_BAND (additive) ------------------------------------
  // Additive, so the alpha-test rule above does not apply — this is the one
  // cell authored as tone. Bottom-weighted: heat comes off the pan, so the band
  // is dense in its lowest 0.4 and gone by the top.
  {
    const r = R("SHIMMER_BAND");
    for (let row = 0; row < 26; row += 1) {
      const t = row / 25;
      const y = r.y + 254 - row * 9;
      const alpha = 0.3 * (1 - t) * (1 - t);
      grain(s, r.x, y - 8, r.w, 9, PAN.LIT,
        { cell: 4, density: 0.5 - t * 0.3, alpha, rng, wear: false });
      // Two horizontal smears per row: shimmer refracts the horizon sideways.
      stroke(s, r.x + rng() * 60, y - 4, r.x + 90 + rng() * 160, y - 4 + (rng() - 0.5) * 3,
        2 + rng() * 3, PAN.WHITE, alpha * 0.8);
    }
    blob(s, r.x + 128, r.y + 246, 130, PAN.WHITE, { cell: 6, alpha: 0.12, falloff: 2.2 });
  }

  // -- Slot 15: HAZE_BAND (normal) -----------------------------------------
  // Sits UNDER the silhouettes and behind them: the band that makes 600 m look
  // like 600 m without touching fog density, which is signed off.
  {
    const r = R("HAZE_BAND");
    rect(s, r.x, r.y + 150, r.w, 106, PAN.WARM, 0.2);
    for (let i = 0; i < 34; i += 1) {
      blob(s, r.x + rng() * 256, r.y + 170 + rng() * 84, 24 + rng() * 52, PAN.WHITE,
        { cell: 6, alpha: 0.12, falloff: 1.8 });
    }
    grain(s, r.x, r.y + 150, r.w, 106, PAN.WARM, { cell: 5, density: 0.34, alpha: 0.14, rng, wear: false });
    rect(s, r.x, r.y + 246, r.w, 10, PAN.WARM, 0.26);
  }

  return {
    name: "futurisma_horizon_1024", width: 1024, height: 1024, rgba: s.rgba, regions: T.regions,
  };
}

// ===========================================================================
// SHEET 3 — futurisma_trim_512
//
// Two small jobs that share one sheet because they share one material story:
// painted sheet metal that nobody was ever meant to look at.
//
//  D3 board backs. A signage board currently shows its front art mirrored on
//     the back, which is the single most era-inaccurate thing on either map —
//     and not in the good way. The back of a board is a panel, a frame, four
//     bolt heads and a service tag.
//  D4 the Bitterpan road edge band, replacing the legacy orange banding that
//     came in with the BLOCKOUT_barrier material. Drawn on the ribbon, as
//     zero-height painted road under FLAT_FURNITURE_MAX_HEIGHT_METRES, so it
//     needs no furniture clearance and no corridor exemption.
//
// Band geometry, all quoted per the trim sheet's 24 m x 3 m strip at
// 21.33 px/m: outer warning band 0.55 m, hairline 0.10 m at 0.65 m inboard,
// dash rhythm 2.4 m on / 1.6 m off. The strip is 6 dashes long, so a repeat
// lands on a dash boundary and the rhythm never stutters at a seam.
// ===========================================================================

export function buildTrimSheet() {
  const s = createSurface(512, 512);
  const rng = mulberry32(0x3f4c);
  const P = PALETTE;
  const F = FACADE;
  const { T, R } = registerSheet(PASS03_LAYOUT.futurisma_trim_512);

  const PX_PER_M = 512 / 24;          // 21.333 px/m along the strip
  const m = (v) => v * PX_PER_M;

  /** One board back. `tagged` adds the stencil block. */
  function signBack(r, tagged) {
    clipped(s, r.x, r.y, r.w, r.h, () => {
      rect(s, r.x, r.y, r.w, r.h, F.GALV_MID, 1);
      // Ribs run horizontally on a back face — the stiffeners are welded across
      // the sheet, and it is the one cue that says "this is the wrong side".
      for (let i = 0; i < 5; i += 1) {
        const ry = r.y + 30 + i * 44;
        rect(s, r.x + 10, ry, r.w - 20, 14, F.GALV_DARK, 0.7);
        rect(s, r.x + 10, ry, r.w - 20, 4, F.GALV, 0.5);
        rect(s, r.x + 10, ry + 14, r.w - 20, 4, P.INK, 0.4);
      }
      frame(s, r.x + 4, r.y + 4, r.w - 8, r.h - 8, 8, F.GALV_DARK, 1);
      rect(s, r.x + 4, r.y + 4, r.w - 8, 4, F.GALV, 0.7);
      rect(s, r.x + 4, r.y + r.h - 10, r.w - 8, 6, P.INK, 0.7);
      // Through-bolts: the fixings that hold the FRONT art on, seen from behind.
      [[26, 26], [r.w - 38, 26], [26, r.h - 40], [r.w - 38, r.h - 40]].forEach(([bx, by]) => {
        rect(s, r.x + bx, r.y + by, 14, 14, P.INK, 0.9);
        rect(s, r.x + bx + 2, r.y + by + 2, 10, 4, F.GALV, 0.65);
        blob(s, r.x + bx + 7, r.y + by + 18, 14, P.RUST, { cell: 4, alpha: 0.4, falloff: 1.5 });
      });
      if (tagged) {
        rect(s, r.x + 62, r.y + 106, 132, 46, F.GALV_DARK, 1);
        frame(s, r.x + 62, r.y + 106, 132, 46, 2, P.INK, 0.6);
        textCentred(s, "BP-S3 / 041", r.x + 128, r.y + 116, 2, PAN.WHITE, { tracking: 2, alpha: 0.72 });
        textCentred(s, "DO NOT PAINT", r.x + 128, r.y + 134, 1, PAN.WHITE, { tracking: 1, alpha: 0.5 });
      }
      // Weather: streaks from the top rail, oxide at the bolts, dust at the toe.
      for (let i = 0; i < 22; i += 1) {
        const x = r.x + 12 + rng() * (r.w - 24);
        stroke(s, x, r.y + 12, x + (rng() - 0.5) * 5, r.y + 40 + rng() * 150, 2 + rng() * 3,
          P.INK, 0.18);
      }
      masked(s, () => {
        for (let i = 0; i < 6; i += 1) {
          blob(s, r.x + rng() * r.w, r.y + rng() * r.h, 14 + rng() * 24, P.RUST,
            { cell: 4, alpha: 0.22, falloff: 1.4 });
        }
      });
      grain(s, r.x, r.y, r.w, r.h, P.INK, { cell: 4, density: 0.16, alpha: 0.2, rng });
      grain(s, r.x, r.y + r.h - 40, r.w, 40, PAN.WARM, { cell: 4, density: 0.26, alpha: 0.2, rng });
    });
  }
  signBack(R("SIGN_BACK_BLANK"), false);
  signBack(R("SIGN_BACK_TAGGED"), true);

  /**
   * The edge band.
   *
   * V runs from the deck edge inboard: v=0 is the lip, v=64 px is 3.0 m in. So
   * the band lives in the OUTBOARD half of the strip and the inboard half is
   * transparent, which is what lets one strip serve a 9 m deck and a 12 m one.
   *
   * The hierarchy, stated once and obeyed by all three variants:
   *   ORANGE is physical — "the surface ends here, or something will hit you".
   *   CYAN is route — the line, the direction, the sequence. It is reserved,
   *   and the only cyan in this whole deliverable is the 1.5 m span-entry tick
   *   in EDGE_TICK_SET, used three times per lap at the authored edge spans.
   */
  function edgeBand(r, opts) {
    const { dashOn, dashOff, bandW, hairline, hatch, degrade } = opts;
    clipped(s, r.x, r.y, r.w, r.h, () => {
      const bandTop = r.y + 4;
      const bandH = m(bandW);
      // Dashes. Phase 0 at the strip origin so repeats line up.
      const cycle = m(dashOn + dashOff);
      for (let i = 0; i * cycle < r.w + cycle; i += 1) {
        const dx = r.x + i * cycle;
        const dw = m(dashOn);
        rect(s, dx, bandTop, dw, bandH, P.BP_ORANGE, degrade ? 0.62 : 0.9);
        // A dash is paint on crust: darker at the trailing edge where the
        // squeegee lifted, and it never has a clean end.
        rect(s, dx, bandTop + bandH - 2, dw, 2, PAN.CUT, 0.3);
        rect(s, dx + dw - 3, bandTop, 3, bandH, PAN.CUT, 0.22);
        if (degrade) {
          // Open pan: the outer third of the dash is worn through to crust in
          // patches. This is the degrade — same band, less of it.
          for (let k = 0; k < 6; k += 1) {
            const wx = dx + rng() * dw;
            rect(s, wx, bandTop, 2 + rng() * 6, 2 + rng() * (bandH * 0.5), PAN.WHITE, 0.5);
          }
        }
      }
      if (hairline) {
        const hy = bandTop + m(0.65);
        rect(s, r.x, hy, r.w, Math.max(2, m(0.1)), P.INK, 0.7);
        rect(s, r.x, hy + m(0.1), r.w, 2, PAN.LIT, 0.3);
      }
      if (hatch) {
        // 45 deg hatch OUTBOARD of the band, 0.6 m pitch: the berm/works-stand
        // read. Hatch means "walled", and it only appears where the edge table
        // says wall: true.
        for (let i = -4; i * m(0.6) < r.w; i += 1) {
          const hx = r.x + i * m(0.6);
          stroke(s, hx, r.y + 2, hx + 26, r.y + 28, 3, P.BP_ORANGE, 0.66);
        }
        rect(s, r.x, r.y + 2, r.w, 2, P.BP_ORANGE, 0.8);
      }
      if (degrade) {
        // The painted lip onto salt: no kerb, no wall, just where the deck
        // stops. Crust encroaches over the paint from outboard.
        for (let i = 0; i < 90; i += 1) {
          const px = r.x + rng() * r.w;
          rect(s, px, r.y + 2 + rng() * 6, 2 + rng() * 7, 2 + rng() * 4, PAN.WHITE, 0.6);
        }
        grain(s, r.x, r.y + 2, r.w, 16, PAN.LIT, { cell: 3, density: 0.3, alpha: 0.34, rng });
      }
      // Tyre scrub over everything: this is the edge cars actually touch.
      for (let i = 0; i < 26; i += 1) {
        const sx = r.x + rng() * r.w;
        stroke(s, sx, bandTop + rng() * bandH, sx + 8 + rng() * 40, bandTop + rng() * bandH,
          1 + rng() * 2, P.INK, 0.2);
      }
      grain(s, r.x, r.y, r.w, Math.round(bandH) + 10, PAN.CUT, { cell: 3, density: 0.2, alpha: 0.2, rng });
    });
  }
  edgeBand(R("EDGE_BAND_DECK"), { dashOn: 2.4, dashOff: 1.6, bandW: 0.55, hairline: true });
  edgeBand(R("EDGE_BAND_PAN"), { dashOn: 1.6, dashOff: 2.4, bandW: 0.45, degrade: true });
  edgeBand(R("EDGE_BAND_BERM"), { dashOn: 2.4, dashOff: 1.6, bandW: 0.55, hairline: true, hatch: true });

  // -- EDGE_TICK_SET --------------------------------------------------------
  // Four 1.5 m ticks, laid at span boundaries and braking references. Slot 0 is
  // the ONLY new cyan in Pass 03.
  {
    const r = R("EDGE_TICK_SET");
    const slot = (i) => r.x + i * 128;
    clipped(s, r.x, r.y, r.w, r.h, () => {
      // 0: span entry, route cyan. Three bars, reading inboard.
      for (let k = 0; k < 3; k += 1) {
        rect(s, slot(0) + 14 + k * 34, r.y + 6, 22, 40 - k * 10, P.BP_CYAN, 0.86 - k * 0.16);
      }
      rect(s, slot(0), r.y + 52, 128, 3, PAN.BRINE_DEEP, 0.4);
      // 1: orange chevron tick, the physical warning.
      poly(s, [[slot(1) + 20, r.y + 6], [slot(1) + 62, r.y + 30], [slot(1) + 20, r.y + 54],
        [slot(1) + 20, r.y + 40], [slot(1) + 36, r.y + 30], [slot(1) + 20, r.y + 20]],
        P.BP_ORANGE, 0.9);
      poly(s, [[slot(1) + 66, r.y + 6], [slot(1) + 108, r.y + 30], [slot(1) + 66, r.y + 54],
        [slot(1) + 66, r.y + 40], [slot(1) + 82, r.y + 30], [slot(1) + 66, r.y + 20]],
        P.BP_ORANGE, 0.9);
      // 2: wear cap — the end of a band run, worn to nothing.
      rect(s, slot(2), r.y + 4, 128, 12, P.BP_ORANGE, 0.7);
      for (let i = 0; i < 40; i += 1) {
        rect(s, slot(2) + rng() * 128, r.y + 4 + rng() * 12, 3 + rng() * 8, 3, PAN.WHITE, 0.7);
      }
      grain(s, slot(2), r.y + 4, 128, 18, PAN.LIT, { cell: 3, density: 0.4, alpha: 0.4, rng });
      // 3: blank crust, for a station where the band is deliberately absent.
      grain(s, slot(3), r.y + 4, 128, 20, PAN.SHADE, { cell: 3, density: 0.22, alpha: 0.2, rng });
      masked(s, () => grain(s, r.x, r.y, r.w, r.h, P.INK, { cell: 3, density: 0.16, alpha: 0.22, rng }));
      textCentred(s, "TICKS 1.5 M", r.x + 256, r.y + 58, 1, P.STEEL, { tracking: 2, alpha: 0.4 });
    });
  }

  return {
    name: "futurisma_trim_512", width: 512, height: 512, rgba: s.rgba, regions: T.regions,
  };
}

export const PASS03_ATLASES = [
  buildBitterpanFacades,
  buildHorizonCards,
  buildTrimSheet,
];
