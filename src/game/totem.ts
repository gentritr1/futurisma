import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import atlasRegionsJson from "./data/ATLAS_REGIONS.json";
import liveryWearJson from "./data/TOTEM_LIVERY_WEAR.json";
import wearCellsJson from "./data/TOTEM_WEAR_CELLS.json";
import { disposeObject3DResources } from "./graphics-resources";
import { TotemEvolution } from "./totem-evolution";
import {
  TotemRacePresence,
  type RacePresenceVisualState,
} from "./race-presence";
import {
  activeRenderMode,
  ps2ColorGradeChunk,
  ps2DitherChunk,
  ps2VertexSnapChunk,
  ps2VertexSnapUniformDeclaration,
  resolvePs2SnapGrid,
  PS2_DITHERING_ANCHOR,
  PS2_PROJECT_VERTEX_ANCHOR,
  PS2_SNAP_UNIFORM_NAME,
  PS2_TONE_MAPPING_ANCHOR,
} from "./render-mode.js";

export interface TotemVisualState extends RacePresenceVisualState {
  steer: number;
  lateralLoad: number;
  gravitySign?: number;
  gravityTransition?: number;
  shieldActive?: boolean;
  overdriveActive?: boolean;
  shieldRefundWindow?: boolean;
  powerReady?: boolean;
  heldPowerKind?: "surge" | "shield" | null;
  powerCharge?: number;
  powerActivation?: number;
  boostReserve?: number;
}

interface NeutralTransform {
  quaternion: THREE.Quaternion;
  position: THREE.Vector3;
}

export interface Ps2MaterialTreatmentStats {
  materials: number;
  textures: number;
  /** Materials this call armed with vertex snapping. Always 0 in `agx` mode. */
  snapMaterials: number;
  /** Materials this call armed with the RGB565 dither. Always 0 in `agx` mode. */
  ditherMaterials: number;
}

export interface Ps2MaterialTreatmentOptions {
  /**
   * Course, environment and dressing geometry opts in; the player craft, the
   * rivals and the sky do not. Vertex snapping and framebuffer dither ride on
   * this flag — the colour grade does not, because a ship graded differently
   * from the world it sits in reads as a bug.
   */
  worldGeometry?: boolean;
  /**
   * P14 — which texture class this root carries, following P12's `worldGeometry`
   * pattern of an opt-in flag rather than a second entry point.
   *
   * `"pixel"` (the default) is for **pixel-authored** sheets: the runway and
   * signage atlases, the motion/effects atlases, the livery decal sheets and the
   * surface-character mask. They are drawn texel-by-texel by
   * `scripts/design/atlas-draw.mjs` and a linear magnifier smears exactly the
   * stem weights that script is careful about, so they keep `NearestFilter`.
   *
   * `"painterly"` is for the **baked/painted** GLB sheets — the Greenwater
   * environment's concrete/metal/jungle/signage/water atlases. Those are painted
   * at 1024 with sub-texel noise under crisp vector plates; nothing in them is
   * authored to a screen texel, so point sampling only buys minification
   * speckle. The asset kit is deliberately NOT in this class: its one texture is
   * the livery decal sheet, which the craft wears too.
   */
  textureCharacter?: "pixel" | "painterly";
}

/**
 * P14 — the two filter classes, declared as data so
 * `scripts/validate-render-quality.mjs` can assert both without a GL context.
 * Anisotropy stays at 1 in both: it is a per-sample cost on every surface in
 * the scene and the A/B could not separate it from the min-filter change.
 */
export const TEXTURE_FILTER_CLASSES = {
  pixel: {
    magFilter: THREE.NearestFilter,
    minFilter: THREE.NearestMipmapLinearFilter,
    anisotropy: 1,
  },
  painterly: {
    magFilter: THREE.LinearFilter,
    minFilter: THREE.LinearMipmapLinearFilter,
    anisotropy: 1,
  },
} as const;

/**
 * What the material treatments in this module armed. The contributor is named
 * `ps2` in `diagnostics.ts` because P4b got here first; it is really "whatever
 * totem.ts patched into a program", which is where P15's wear overlay belongs
 * too — the alternative was a new contributor, and `game.ts` is at its seam
 * budget and may not grow by a line to register one.
 */
export interface Ps2TreatmentDiagnostics {
  renderMode: string;
  ps2SnapMaterials: number;
  ps2DitherMaterials: number;
  /** P15: false means the overlay never loaded and no hull is wearing it. */
  wearActive: boolean;
  wearMaterials: number;
  /** 1.0 at the authored 45/100; nightform holds it back to 34/45. */
  wearScale: number;
  /**
   * P17 — library slots actually placed on a measured decal cell. 0 is the P15
   * behaviour (chip strip only); 12 is the whole authored library. A slot held
   * back to `scale: 0` in the spec still counts as applied, because it is armed
   * and one number away from visible; a slot that failed to RESOLVE never gets
   * here at all, and the shortfall is what this counter exists to surface.
   */
  appliedWearSlots: number;
}

export type TotemRivalMaterialRole =
  | "TOTEM_body"
  | "TOTEM_emissive"
  | "TOTEM_glass";

/**
 * How a rival batch moves. `hull` is welded to the craft; the others turn about
 * their authored pivots, driven by the rival's pose signals.
 */
export type TotemRivalArticulationGroup =
  | "hull"
  | "steering_fins"
  | "airbrakes";

export interface TotemRivalArticulationSlot {
  /** Authored pivot node this slot stands in for, e.g. `steering_fin_L_pivot`. */
  pivot: string;
  /** The pivot's neutral transform in model space. Batch geometry is pivot-local. */
  pivotMatrix: THREE.Matrix4;
  /** Local axis the pivot turns about, per the MANIFEST `movable_nodes` contract. */
  axis: "x" | "y" | "z";
  /**
   * Brightness correction for this slot. Both sides of a pair share one
   * geometry, so they also share the reference side's baked `COLOR_0` shading.
   * This restores each side's own authored mean brightness through the instance
   * colour; the finer per-vertex panel variation is the price of the shared
   * geometry and stays with the reference side.
   */
  shadingScale: number;
}

export interface TotemRivalVisualBatch {
  role: TotemRivalMaterialRole;
  group: TotemRivalArticulationGroup;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  triangles: number;
  /**
   * One entry per copy of this batch's geometry on a single craft. `hull` has a
   * single identity slot; an articulated group has one slot per side, and every
   * side shares the one pivot-local geometry — which is what lets a left/right
   * pair cost a single draw call instead of two.
   */
  slots: readonly TotemRivalArticulationSlot[];
}

/**
 * The left/right pairs worth articulating on a rival, in slot order. Both sides
 * of a pair are driven by the same signal, so they can share one instanced mesh.
 *
 * Elevons are deliberately absent: they are authored movers, but a third
 * articulated pair would cost a seventh rival body draw call and the phase
 * budget has no room for it. They ride with the hull on rivals; the player's
 * own vehicle still articulates all of them through `updateVisual`.
 */
const RIVAL_ARTICULATION_GROUPS: ReadonlyArray<{
  group: Exclude<TotemRivalArticulationGroup, "hull">;
  pivots: readonly string[];
  axis: "x" | "y" | "z";
}> = [
  {
    group: "steering_fins",
    pivots: ["steering_fin_L_pivot", "steering_fin_R_pivot"],
    axis: "y",
  },
  {
    group: "airbrakes",
    pivots: ["airbrake_L_pivot", "airbrake_R_pivot"],
    axis: "x",
  },
];

const IDENTITY_SLOT: TotemRivalArticulationSlot = {
  pivot: "",
  pivotMatrix: new THREE.Matrix4(),
  axis: "y",
  shadingScale: 1,
};

/** Mean of a geometry's baked vertex-shading multiplier, or 1 when unshaded. */
function meanVertexShading(geometry: THREE.BufferGeometry): number {
  const color = geometry.getAttribute("color");
  if (!color || color.count === 0) return 1;
  let total = 0;
  for (let index = 0; index < color.count; index += 1) {
    total += color.getX(index) + color.getY(index) + color.getZ(index);
  }
  const mean = total / (color.count * 3);
  return Number.isFinite(mean) && mean > 1e-6 ? mean : 1;
}

/** Positions must agree to this many metres for two sides to share geometry. */
const SHARED_SIDE_TOLERANCE_METERS = 1e-5;

interface OriginalVisibleMesh {
  mesh: THREE.Mesh;
  modelLocalMatrix: THREE.Matrix4;
  /** Nearest enclosing articulation pivot, or `null` when welded to the hull. */
  pivot: string | null;
}

const DEG = Math.PI / 180;
const LOCAL_ROTATION_AXES = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
} as const;
const ENGINE_FLAP_NAMES = [
  "engine_flap_L_0_pivot",
  "engine_flap_L_1_pivot",
  "engine_flap_R_0_pivot",
  "engine_flap_R_1_pivot",
] as const;
const RIVAL_MATERIAL_ROLES: readonly TotemRivalMaterialRole[] = [
  "TOTEM_body",
  "TOTEM_emissive",
  "TOTEM_glass",
];

function isRivalMaterialRole(name: string): name is TotemRivalMaterialRole {
  return RIVAL_MATERIAL_ROLES.includes(name as TotemRivalMaterialRole);
}

/**
 * One shared uniform object handed to every snapped program, so the whole world
 * agrees on the raster and a resize costs one `Vector2.set` rather than a walk
 * over the material graph.
 */
const ps2SnapGridUniform = { value: new THREE.Vector2(427, 240) };

/** Re-derives the snap raster from the backbuffer. Called on every resize. */
export function updatePs2SnapGrid(
  internalWidth: number,
  internalHeight: number,
): void {
  const grid = resolvePs2SnapGrid(internalWidth, internalHeight);
  ps2SnapGridUniform.value.set(grid.x, grid.y);
}

let ps2SnapMaterialCount = 0;
let ps2DitherMaterialCount = 0;
const ps2PatchedMaterials = new WeakSet<THREE.Material>();

/**
 * P14 — whether the renderer should be built with MSAA.
 *
 * The AgX path takes it: geometry-edge shimmer at 200+ km/h is the single
 * loudest "this looks worse than it should" artifact once the internal target
 * is high enough to show it. `?render=ps2` does not: the mode's whole signature
 * is snapped silhouettes stepping along a low-resolution raster, and smoothing
 * those edges would take the era out of the era mode.
 *
 * Read at renderer construction, so it lives beside `activeRenderMode`'s other
 * consumers rather than being a second place that parses the query string.
 */
export function prefersMultisampling(): boolean {
  return activeRenderMode() !== "ps2";
}

/** `renderMode` plus the counts P4b's and P15's acceptance checks read. */
export function ps2TreatmentDiagnostics(): Ps2TreatmentDiagnostics {
  return {
    renderMode: activeRenderMode(),
    ps2SnapMaterials: ps2SnapMaterialCount,
    ps2DitherMaterials: ps2DitherMaterialCount,
    wearActive: liveryWearMaterialCount > 0 && liveryWearMapUniform.value !== null,
    wearMaterials: liveryWearMaterialCount,
    wearScale: Number(liveryWearScaleUniform.value.toFixed(4)),
    appliedWearSlots: LIVERY_WEAR_CELLS.length,
  };
}

/**
 * Injects the PS2 presentation shaders. A no-op outside `?render=ps2`, so the
 * AgX path compiles exactly the programs it did before this phase.
 *
 * `Material.clone()` copies neither `onBeforeCompile` nor
 * `customProgramCacheKey`, so anything that clones a treated material has to
 * come back through here — see the rival batch clone pass.
 */
function applyPs2ShaderTreatment(
  material: THREE.Material,
  worldGeometry: boolean,
): { snapped: boolean; dithered: boolean } {
  if (activeRenderMode() !== "ps2") return { snapped: false, dithered: false };
  if (ps2PatchedMaterials.has(material)) {
    return { snapped: false, dithered: false };
  }
  ps2PatchedMaterials.add(material);
  // A material that opted out of tone mapping stays opted out: it was authored
  // against the raw linear value in both modes.
  const graded = material.toneMapped !== false;
  const snapped = worldGeometry;
  const dithered = worldGeometry;
  // three keys the program cache on `onBeforeCompile.toString()` by default.
  // Every variant here shares one function body, so without an explicit key a
  // snapped course material and an unsnapped hull material would collide on the
  // same compiled program.
  const cacheKey = `ps2|${graded ? "g" : ""}${snapped ? "s" : ""}${dithered ? "d" : ""}`;
  material.onBeforeCompile = (shader) => {
    if (snapped && shader.vertexShader.includes(PS2_PROJECT_VERTEX_ANCHOR)) {
      shader.uniforms[PS2_SNAP_UNIFORM_NAME] = ps2SnapGridUniform;
      shader.vertexShader = (
        ps2VertexSnapUniformDeclaration() + shader.vertexShader
      ).replace(
        PS2_PROJECT_VERTEX_ANCHOR,
        `${PS2_PROJECT_VERTEX_ANCHOR}\n${ps2VertexSnapChunk()}`,
      );
    }
    if (graded && shader.fragmentShader.includes(PS2_TONE_MAPPING_ANCHOR)) {
      shader.fragmentShader = shader.fragmentShader.replace(
        PS2_TONE_MAPPING_ANCHOR,
        ps2ColorGradeChunk(),
      );
    }
    if (dithered && shader.fragmentShader.includes(PS2_DITHERING_ANCHOR)) {
      shader.fragmentShader = shader.fragmentShader.replace(
        PS2_DITHERING_ANCHOR,
        `${PS2_DITHERING_ANCHOR}\n${ps2DitherChunk()}`,
      );
    }
  };
  material.customProgramCacheKey = () => cacheKey;
  if (snapped) ps2SnapMaterialCount += 1;
  if (dithered) ps2DitherMaterialCount += 1;
  return { snapped, dithered };
}

/**
 * Adds one shader injection to a material WITHOUT throwing away whatever is
 * already on it.
 *
 * three keeps exactly one `onBeforeCompile` per material and keys its program
 * cache off `customProgramCacheKey`, so the naive `material.onBeforeCompile =
 * fn` silently deletes any earlier injection — and, worse, leaves the earlier
 * *cache key* in place, so the material then reuses a compiled program that has
 * neither injection. Three separate passes now want to reach into the TOTEM
 * body program (the PS2 grade, the rivals' livery-atlas quadrant offset, and
 * this phase's wear multiply), so composition goes through here and the key
 * grows a segment per pass.
 */
export function composeShaderInjection(
  material: THREE.Material,
  key: string,
  inject: (shader: THREE.WebGLProgramParametersWithUniforms) => void,
): void {
  const previousCompile = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  material.onBeforeCompile = function composed(shader, renderer) {
    previousCompile.call(this, shader, renderer);
    inject(shader);
  };
  material.customProgramCacheKey = function composedKey() {
    return `${previousKey.call(this)}|${key}`;
  };
  material.needsUpdate = true;
}

/**
 * P15 art pass 02 — the TOTEM livery wear overlay.
 *
 * `TOTEM_LIVERY_WEAR.json` ships as an OVERLAY sheet rather than as four
 * recomposited livery sheets, and the reasoning is worth keeping next to the
 * code: the livery PNGs are hash-pinned in `validate-assets.mjs` and baked into
 * the runtime GLB, and compositing into them would not be idempotent, so the
 * atlas builder's `--check` would pass once and fail on the second run.
 *
 * What the runtime does with it is one multiply, in one place, gated to one
 * rectangle:
 *
 * - **Same UVs.** The sheet is in register with the livery sheet, so the wear
 *   is sampled at the hull's own UV. It is sampled from the RAW `uv` attribute
 *   rather than from `vMapUv`, because the rivals remap `vMapUv` into their
 *   atlas quadrant in the vertex stage and the wear sheet is not quadranted.
 * - **Chip strip, in register.** The hull's UVs collapse to the centre of one of
 *   the eight paint chips — the centre texel is the only one ever sampled, and
 *   the authored wear detail lives in the chip margins for review.
 * - **Decal cells, placed** — P17. P15 shipped with the factor pinned to exactly
 *   1.0 outside the chip strip, because the 12 decal-cell rects that would place
 *   the library slots were unpublished and guessing them would leak grime,
 *   repair plates and a NEEDLE REPAIR stencil onto whatever those cells hold.
 *   They are no longer guessed: `scripts/derive-decal-cells.mjs` measures them
 *   out of the runtime GLB, `TOTEM_DECAL_CELLS.json` publishes them with
 *   per-cell provenance, and the twelve library slots are placed one per cell.
 *   See `resolveLiveryWearCells` for the placement model and for why the chip
 *   read is unaffected.
 * - **One intensity.** The sheet is authored at 45/100 with the 0.45 already
 *   baked into every alpha, so a straight `mix(1, wearRGB, alpha)` reproduces
 *   the spec's `effective` column. `uWearScale` only ever scales that back
 *   toward 1.0 — nightform asks for 34 of 45, because 45 on a near-black hull
 *   reads as mud rather than as service.
 */
/**
 * The orientation every SERVED sheet in the TOTEM texture family is authored
 * in, as a `THREE.Texture.flipY`.
 *
 * `true` — the `TextureLoader` default — means UV `v = 0` samples the BOTTOM
 * image row, so `v = 1 - imageY / height`. That is the convention
 * `totem/MANIFEST.json` and `ATLAS_REGIONS.json` describe their rectangles in:
 * the paint-chip strip at image rows 900-996 lands under the hull's authored
 * `v = 0.07422` chip row, which is where the geometry actually samples.
 *
 * It is deliberately NOT the orientation of the sheet baked into
 * `totem_runtime.glb`. That one is stored pre-flipped and loaded with
 * `flipY = false`, because glTF puts its UV origin at the top of the image.
 * The two conventions cancel and both land on the same texels — which is
 * exactly why a texture swap between them must SET this rather than copy it.
 * See `applyLivery`.
 */
export const SERVED_LIVERY_FLIP_Y = true;

const LIVERY_WEAR_TEXTURE_URL = "/assets/totem/textures/totem_wear_1024.png";
const LIVERY_WEAR = liveryWearJson as unknown as {
  intensity: number;
  perLivery: readonly { livery: string; sheet: string; intensity: number }[];
};
const LIVERY_WEAR_SHEET_KEY = "totem_wear_1024";
const LIVERY_WEAR_STRIP_SLOT = "CHIP_WEAR_STRIP";

interface AtlasSheet {
  width: number;
  height: number;
  regions: Record<string, { x: number; y: number; w: number; h: number }>;
}

/** The one place a pixel rect becomes a UV rect. See `resolveWearChipRect`. */
function pixelRectToUv(
  sheet: { width: number; height: number },
  rect: { x: number; y: number; w: number; h: number },
): THREE.Vector4 {
  return new THREE.Vector4(
    rect.x / sheet.width,
    1 - (rect.y + rect.h) / sheet.height,
    (rect.x + rect.w) / sheet.width,
    1 - rect.y / sheet.height,
  );
}

function wearSheet(): AtlasSheet {
  const sheet = (atlasRegionsJson as unknown as Record<string, AtlasSheet>)[
    LIVERY_WEAR_SHEET_KEY
  ];
  if (!sheet) throw new Error(`ATLAS_REGIONS.json has no ${LIVERY_WEAR_SHEET_KEY} sheet.`);
  return sheet;
}

/**
 * The chip strip in UV space.
 *
 * `flipY` is the whole of the subtlety here. The livery sheet baked into the
 * GLB is stored pre-flipped (glTF loads with `flipY = false` and the exporter
 * flipped the image to match), while the served PNGs — this wear sheet among
 * them — are stored the way `ATLAS_REGIONS.json` describes them, origin at the
 * top. Loaded with the `TextureLoader` default `flipY = true`, `v = 1 -
 * imageY / height` puts this rectangle exactly under the hull's authored
 * `v = 0.07422` chip row. Measured against the shipped sheets, not assumed.
 */
function resolveWearChipRect(): THREE.Vector4 {
  const sheet = wearSheet();
  const region = sheet.regions[LIVERY_WEAR_STRIP_SLOT];
  if (!region) {
    throw new Error(`The wear sheet is missing its ${LIVERY_WEAR_STRIP_SLOT} region.`);
  }
  return pixelRectToUv(sheet, region);
}

/**
 * P17 — the wear LIBRARY, placed on the measured decal cells.
 *
 * P15 shipped the twelve library slots authored on the sheet and deliberately
 * unapplied: the decal-cell rects they had to land on were never published, and
 * a guessed rect leaks a NEEDLE REPAIR stencil onto whatever the cell really
 * holds. `scripts/derive-decal-cells.mjs` closed that by MEASURING the rects out
 * of `totem_runtime.glb` — every `TOTEM_body` triangle that is not on the
 * collapsed chip row, grouped into islands, bucketed by exact UV rect. Twelve
 * came back. `TOTEM_DECAL_CELLS.json` is that measurement, keyed to the GLB's
 * sha256 so a re-export is caught before the overlay paints at rects that moved.
 *
 * A slot is PLACED on a cell rather than sampled in register with it: the cell
 * rect is the destination on the hull's UV, the slot rect is the source on the
 * wear sheet, and the shader maps one onto the other. Only the chip strip is in
 * register, and its code path below is untouched — the two UV regions are
 * disjoint (cells bottom out at v = 0.125, the strip tops out at v = 0.12109),
 * so the library factor is exactly 1.0 at every chip texel and the chip read is
 * bit-identical to P15's.
 *
 * WHY THE TABLE IS PRE-RESOLVED. `TOTEM_WEAR_CELLS.json` is generated: it holds
 * the twelve placements as eight floats and a scale each, and nothing else. The
 * argument for which slot lands where is in `TOTEM_WEAR_PLACEMENT.json` and the
 * measurement with its provenance is in `TOTEM_DECAL_CELLS.json`; the runtime
 * imports neither, because this module lands in the initial bundle and
 * `validate-build.mjs` caps that at 225 KiB gzip.
 *
 * Resolution is all-or-nothing per slot and never throws: a malformed entry is
 * dropped, and `appliedWearSlots` in the soak diagnostics is what reports the
 * shortfall. `validate-art-pass.mjs` asserts the full twelve, so a silent drop
 * cannot ship.
 */
interface LiveryWearCell {
  slot: string;
  cell: string;
  /** Destination rect on the hull's UV: the measured decal cell. */
  destination: THREE.Vector4;
  /** Source rect on the wear sheet: the authored library slot. */
  source: THREE.Vector4;
  /** Per-slot hold-back, multiplying `uWearScale` for this cell only. */
  scale: number;
}

function resolveLiveryWearCells(): LiveryWearCell[] {
  const table = wearCellsJson as unknown as {
    cells: readonly {
      slot: string;
      cell: string;
      dst: readonly number[];
      src: readonly number[];
      scale: number;
    }[];
  };
  const resolved: LiveryWearCell[] = [];
  for (const entry of table.cells) {
    if (entry.dst.length !== 4 || entry.src.length !== 4) continue;
    if (!(entry.scale > 0)) continue;
    resolved.push({
      slot: entry.slot,
      cell: entry.cell,
      destination: new THREE.Vector4(entry.dst[0], entry.dst[1], entry.dst[2], entry.dst[3]),
      source: new THREE.Vector4(entry.src[0], entry.src[1], entry.src[2], entry.src[3]),
      scale: Math.min(entry.scale, 1),
    });
  }
  return resolved;
}

const LIVERY_WEAR_CELLS = resolveLiveryWearCells();

const liveryWearMapUniform: { value: THREE.Texture | null } = { value: null };
const liveryWearScaleUniform = { value: 1 };
const liveryWearRectUniform = { value: resolveWearChipRect() };
const liveryWearCellDestinationUniform = {
  value: LIVERY_WEAR_CELLS.map((cell) => cell.destination),
};
const liveryWearCellSourceUniform = {
  value: LIVERY_WEAR_CELLS.map((cell) => cell.source),
};
const liveryWearCellScaleUniform = {
  value: LIVERY_WEAR_CELLS.map((cell) => cell.scale),
};
let liveryWearMaterialCount = 0;
const liveryWearPatchedMaterials = new WeakSet<THREE.Material>();

/**
 * The library half of the wear injection, as GLSL.
 *
 * Kept out of `applyLiveryWearTreatment` so the chip-strip block there stays
 * character-for-character what P15 shipped — the acceptance for this phase is
 * that the chip centres read back bit-identical, and the cheapest way to hold
 * that is to not retype the code that produces them.
 *
 * FIRST HIT WINS. The twelve destination rects are disjoint (asserted in
 * `derive-decal-cells.mjs`), but `step` is inclusive at both ends, so a fragment
 * landing exactly on a shared cell boundary would satisfy two rect tests, sum
 * two scales and sample the average of two unrelated places on the sheet. The
 * `1.0 - taken` factor makes the first containing cell the only one that
 * contributes, branchlessly. A fragment inside no cell keeps `wearCellAmount`
 * at 0, and `mix(vec3(1.0), x, 0.0)` is exactly `vec3(1.0)` — so the hull, and
 * the chip strip with it, is multiplied by exactly one.
 */
function liveryWearLibraryChunk(count: number): string {
  return (
    `\tvec2 wearCellUv = vec2( 0.0 );\n`
    + `\tfloat wearCellAmount = 0.0;\n`
    + `\tfloat wearCellTaken = 0.0;\n`
    + `\tfor ( int i = 0; i < ${count}; i ++ ) {\n`
    + `\t\tvec4 wearDst = uWearCellDst[ i ];\n`
    + `\t\tvec2 wearHitAxes = step( wearDst.xy, vWearUv ) * step( vWearUv, wearDst.zw );\n`
    + `\t\tfloat wearHit = wearHitAxes.x * wearHitAxes.y * ( 1.0 - wearCellTaken );\n`
    + `\t\twearCellTaken = min( 1.0, wearCellTaken + wearHitAxes.x * wearHitAxes.y );\n`
    + `\t\tvec4 wearSrc = uWearCellSrc[ i ];\n`
    + `\t\twearCellUv += wearHit * ( wearSrc.xy\n`
    + `\t\t\t+ ( vWearUv - wearDst.xy ) / ( wearDst.zw - wearDst.xy )\n`
    + `\t\t\t* ( wearSrc.zw - wearSrc.xy ) );\n`
    + `\t\twearCellAmount += wearHit * uWearCellScale[ i ];\n`
    + `\t}\n`
    + `\tvec4 wearCellTexel = texture2D( uWearMap, wearCellUv );\n`
    + `\tdiffuseColor.rgb *= mix(\n`
    + `\t\tvec3( 1.0 ),\n`
    + `\t\tmix( vec3( 1.0 ), wearCellTexel.rgb, wearCellTexel.a ),\n`
    + `\t\twearCellAmount * uWearScale );\n`
  );
}

/** Loads the overlay sheet once. Resolves to null when it is unavailable. */
export async function loadLiveryWearMap(): Promise<THREE.Texture | null> {
  if (liveryWearMapUniform.value) return liveryWearMapUniform.value;
  let texture: THREE.Texture;
  try {
    texture = await new THREE.TextureLoader().loadAsync(LIVERY_WEAR_TEXTURE_URL);
  } catch {
    // A missing overlay is cosmetic: the craft renders exactly as it did before
    // this phase. `wearActive: false` in the soak is what surfaces it.
    return null;
  }
  texture.name = LIVERY_WEAR_SHEET_KEY;
  texture.colorSpace = THREE.SRGBColorSpace;
  // The overlay is a served sheet in register with the served livery sheets, so
  // it takes their orientation. One constant, so the two can never disagree.
  texture.flipY = SERVED_LIVERY_FLIP_Y;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  // The spec's own filtering contract, matching the livery atlas it overlays:
  // mips on, anisotropy 1. The grain cells are 5-6 px, so the treatment still
  // exists two mip levels down.
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapLinearFilter;
  texture.anisotropy = 1;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  liveryWearMapUniform.value = texture;
  return texture;
}

/** Per-livery hold-back, resolved from the sheet the player just put on. */
export function setLiveryWearIntensity(liveryTextureUrl: string): void {
  const sheet = liveryTextureUrl.split("/").pop() ?? "";
  const entry = LIVERY_WEAR.perLivery.find((livery) => livery.sheet === sheet);
  liveryWearScaleUniform.value = entry
    ? entry.intensity / LIVERY_WEAR.intensity
    : 1;
}

/**
 * Arms the wear multiply on one `TOTEM_body` material.
 *
 * Idempotent per material, and a no-op until the sheet has loaded — a material
 * armed without a map would sample texture unit 0 and multiply the hull by
 * itself.
 */
export function applyLiveryWearTreatment(material: THREE.Material): boolean {
  if (!liveryWearMapUniform.value) return false;
  if (liveryWearPatchedMaterials.has(material)) return false;
  liveryWearPatchedMaterials.add(material);
  const cellCount = LIVERY_WEAR_CELLS.length;
  // The cell count is a compile-time constant baked into the loop bound, so it
  // has to reach the program cache key: a build that resolved a different number
  // of cells must not reuse a program compiled for the old count.
  composeShaderInjection(material, `wear|cells${cellCount}`, (shader) => {
    shader.uniforms.uWearMap = liveryWearMapUniform;
    shader.uniforms.uWearScale = liveryWearScaleUniform;
    shader.uniforms.uWearChipRect = liveryWearRectUniform;
    shader.vertexShader = `varying vec2 vWearUv;\n${shader.vertexShader}`.replace(
      "#include <uv_vertex>",
      "#include <uv_vertex>\n\tvWearUv = uv;",
    );
    if (cellCount > 0) {
      shader.uniforms.uWearCellDst = liveryWearCellDestinationUniform;
      shader.uniforms.uWearCellSrc = liveryWearCellSourceUniform;
      shader.uniforms.uWearCellScale = liveryWearCellScaleUniform;
    }
    shader.fragmentShader = (
      "uniform sampler2D uWearMap;\n"
      + "uniform float uWearScale;\n"
      + "uniform vec4 uWearChipRect;\n"
      + (cellCount > 0
        ? `uniform vec4 uWearCellDst[ ${cellCount} ];\n`
          + `uniform vec4 uWearCellSrc[ ${cellCount} ];\n`
          + `uniform float uWearCellScale[ ${cellCount} ];\n`
        : "")
      + "varying vec2 vWearUv;\n"
      + shader.fragmentShader
    ).replace(
      "#include <map_fragment>",
      "#include <map_fragment>\n"
        + "\tvec4 wearTexel = texture2D( uWearMap, vWearUv );\n"
        + "\tvec2 wearInside = step( uWearChipRect.xy, vWearUv )\n"
        + "\t\t* step( vWearUv, uWearChipRect.zw );\n"
        + "\tfloat wearAmount = wearInside.x * wearInside.y * uWearScale;\n"
        + "\tdiffuseColor.rgb *= mix(\n"
        + "\t\tvec3( 1.0 ),\n"
        + "\t\tmix( vec3( 1.0 ), wearTexel.rgb, wearTexel.a ),\n"
        + "\t\twearAmount );\n"
        + (cellCount > 0 ? liveryWearLibraryChunk(cellCount) : ""),
    );
  });
  liveryWearMaterialCount += 1;
  return true;
}

export function applyPs2MaterialTreatment(
  root: THREE.Object3D,
  options: Ps2MaterialTreatmentOptions = {},
): Ps2MaterialTreatmentStats {
  const worldGeometry = options.worldGeometry === true;
  // `?render=ps2` is the era-accurate opt-in and P14 must not move it: every
  // texture stays on the point-sampled class there, whatever it was authored as.
  const filter = activeRenderMode() === "ps2"
    ? TEXTURE_FILTER_CLASSES.pixel
    : TEXTURE_FILTER_CLASSES[options.textureCharacter ?? "pixel"];
  const treatedMaterials = new Set<THREE.Material>();
  const treatedTextures = new Set<THREE.Texture>();
  let snapMaterials = 0;
  let ditherMaterials = 0;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!treatedMaterials.has(material)) {
        const armed = applyPs2ShaderTreatment(material, worldGeometry);
        if (armed.snapped) snapMaterials += 1;
        if (armed.dithered) ditherMaterials += 1;
      }
      treatedMaterials.add(material);
      material.dithering = true;
      const textured = material as THREE.Material & {
        map?: THREE.Texture | null;
        emissiveMap?: THREE.Texture | null;
        normalMap?: THREE.Texture | null;
        roughnessMap?: THREE.Texture | null;
        metalnessMap?: THREE.Texture | null;
        alphaMap?: THREE.Texture | null;
      };
      for (const texture of [
        textured.map,
        textured.emissiveMap,
        textured.normalMap,
        textured.roughnessMap,
        textured.metalnessMap,
        textured.alphaMap,
      ]) {
        if (!texture) continue;
        treatedTextures.add(texture);
        texture.magFilter = filter.magFilter;
        texture.minFilter = filter.minFilter;
        texture.anisotropy = filter.anisotropy;
        texture.needsUpdate = true;
      }
      material.needsUpdate = true;
    }
  });
  return {
    materials: treatedMaterials.size,
    textures: treatedTextures.size,
    snapMaterials,
    ditherMaterials,
  };
}

export class TotemVehicle {
  readonly root = new THREE.Group();
  private readonly visual = new THREE.Group();
  private readonly nodes = new Map<string, THREE.Object3D>();
  private readonly neutral = new Map<string, NeutralTransform>();
  private readonly rotationOffset = new THREE.Quaternion();
  private racePresence: TotemRacePresence | null = null;
  private evolution: TotemEvolution | null = null;
  private model: THREE.Object3D | null = null;
  private originalVisibleMeshes: OriginalVisibleMesh[] = [];
  private readonly pivotMatrices = new Map<string, THREE.Matrix4>();

  constructor() {
    this.root.name = "totem_vehicle_root";
    this.visual.name = "totem_visual_motion";
    this.root.add(this.visual);
  }

  async load(url: string, effectsAtlasUrl: string, pumpWorks = false): Promise<void> {
    const [gltfResult, atlasResult] = await Promise.allSettled([
      new GLTFLoader().loadAsync(url),
      new THREE.TextureLoader().loadAsync(effectsAtlasUrl),
    ]);
    if (gltfResult.status === "rejected") {
      if (atlasResult.status === "fulfilled") atlasResult.value.dispose();
      throw gltfResult.reason;
    }
    if (atlasResult.status === "rejected") {
      disposeObject3DResources(gltfResult.value.scene);
      throw atlasResult.reason;
    }
    const gltf = gltfResult.value;
    const effectsAtlas = atlasResult.value;
    this.model = gltf.scene;
    this.model.name = "TOTEM_runtime";
    this.visual.add(this.model);
    applyPs2MaterialTreatment(this.model);
    this.calibrateVehicleMaterials();
    // P15 — the wear overlay, armed on the hull before the rival batches clone
    // its material. Awaited here rather than in `game.ts` (which is at its seam
    // budget) and non-fatal: a craft with no overlay is the craft this project
    // shipped in P14, and the soak's `wearActive` is what reports the gap.
    await loadLiveryWearMap();
    const bodyMaterial = this.bodyMaterial();
    if (bodyMaterial) applyLiveryWearTreatment(bodyMaterial);

    this.model.traverse((object) => {
      if (object.name) this.nodes.set(object.name, object);
      if (object.name === "collision_proxy") object.visible = false;
      if (!(object instanceof THREE.Mesh)) return;

      object.castShadow = true;
      object.receiveShadow = true;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (materials.some((material) => material.name === "TOTEM_collision")) {
        object.visible = false;
      }
    });

    this.captureOriginalVisibleMeshes();

    for (const name of [
      "canopy_pivot",
      "airbrake_L_pivot",
      "airbrake_R_pivot",
      "steering_fin_L_pivot",
      "steering_fin_R_pivot",
      "elevon_L_pivot",
      "elevon_R_pivot",
      "engine_flap_L_0_pivot",
      "engine_flap_L_1_pivot",
      "engine_flap_R_0_pivot",
      "engine_flap_R_1_pivot",
      "stabiliser_ring_pivot",
      "skids_pivot",
    ]) {
      const node = this.nodes.get(name);
      if (!node) continue;
      this.neutral.set(name, {
        quaternion: node.quaternion.clone(),
        position: node.position.clone(),
      });
    }

    this.racePresence = new TotemRacePresence(
      this.model,
      this.nodes,
      effectsAtlas,
    );
    // The original mesh capture above remains the rival asset contract. This
    // separate assembly belongs only to the player and follows scene disposal.
    try {
      this.evolution = await TotemEvolution.load(pumpWorks);
      applyPs2MaterialTreatment(this.evolution.root);
      this.model.add(this.evolution.root);
    } catch (error) {
      console.warn("TOTEM enhancement kit could not load; using the original craft.", error);
    }
  }

  /**
   * Ground-blob placement for the shared instanced shadow mesh: how far the
   * craft is floating above the deck right now, matching the hover the pose
   * uses. The blob itself is owned by the rival fleet.
   */
  hoverHeightMeters(state: TotemVisualState): number {
    return state.boostActive ? 0.6 : state.speedRatio < 0.1 ? 0.18 : 0.45;
  }

  effectsAtlas(): THREE.Texture {
    if (!this.racePresence) {
      throw new Error("TOTEM race-presence effects must be loaded before use.");
    }
    return this.racePresence.atlas;
  }

  createRivalVisualBatches(): TotemRivalVisualBatch[] {
    if (!this.model || this.originalVisibleMeshes.length === 0) {
      throw new Error("TOTEM must be loaded before creating rival visual batches.");
    }

    const materialByRole = new Map<TotemRivalMaterialRole, THREE.Material>();
    const roleOf = (source: OriginalVisibleMesh): TotemRivalMaterialRole => {
      if (Array.isArray(source.mesh.material)) {
        throw new Error(`TOTEM mesh ${source.mesh.name} has unsupported material groups.`);
      }
      const material = source.mesh.material;
      if (!isRivalMaterialRole(material.name)) {
        throw new Error(
          `TOTEM mesh ${source.mesh.name} has unexpected visible material ${material.name}.`,
        );
      }
      const existingMaterial = materialByRole.get(material.name);
      if (existingMaterial && existingMaterial !== material) {
        throw new Error(`TOTEM material role ${material.name} uses multiple materials.`);
      }
      materialByRole.set(material.name, material);
      return material.name;
    };

    const hullSources: OriginalVisibleMesh[] = [];
    const sourcesByPivot = new Map<string, OriginalVisibleMesh[]>();
    for (const source of this.originalVisibleMeshes) {
      roleOf(source);
      if (source.pivot === null) {
        hullSources.push(source);
        continue;
      }
      const existing = sourcesByPivot.get(source.pivot);
      if (existing) existing.push(source);
      else sourcesByPivot.set(source.pivot, [source]);
    }

    // Scratch geometries are tracked centrally so every exit path disposes them.
    const scratch: THREE.BufferGeometry[] = [];
    const bake = (
      source: OriginalVisibleMesh,
      matrix: THREE.Matrix4,
    ): THREE.BufferGeometry => {
      const geometry = source.mesh.geometry.index
        ? source.mesh.geometry.toNonIndexed()
        : source.mesh.geometry.clone();
      geometry.applyMatrix4(matrix);
      scratch.push(geometry);
      return geometry;
    };

    const batches: TotemRivalVisualBatch[] = [];
    const pivotLocal = new THREE.Matrix4();
    try {
      for (const definition of RIVAL_ARTICULATION_GROUPS) {
        const merged = this.mergeArticulationGroup(
          definition,
          sourcesByPivot,
          bake,
          scratch,
          pivotLocal,
        );
        if (!merged) {
          // The group is not shareable as authored, so the parts stay welded to
          // the hull rather than costing a draw call each. The soak's
          // `rivalArticulation` reading is what surfaces this if it happens.
          for (const pivot of definition.pivots) {
            for (const source of sourcesByPivot.get(pivot) ?? []) hullSources.push(source);
          }
          continue;
        }
        const material = materialByRole.get("TOTEM_body");
        if (!material) {
          merged.geometry.dispose();
          throw new Error("TOTEM is missing required rival material role TOTEM_body.");
        }
        batches.push({
          role: "TOTEM_body",
          group: definition.group,
          geometry: merged.geometry,
          material,
          triangles: merged.triangles,
          slots: merged.slots,
        });
      }

      const hullByRole = new Map<TotemRivalMaterialRole, THREE.BufferGeometry[]>();
      for (const role of RIVAL_MATERIAL_ROLES) hullByRole.set(role, []);
      for (const source of hullSources) {
        hullByRole.get(roleOf(source))?.push(bake(source, source.modelLocalMatrix));
      }
      for (const role of RIVAL_MATERIAL_ROLES) {
        const sourceGeometries = hullByRole.get(role) ?? [];
        const sourceMaterial = materialByRole.get(role);
        if (sourceGeometries.length === 0 || !sourceMaterial) {
          throw new Error(`TOTEM is missing required rival material role ${role}.`);
        }
        const geometry = mergeGeometries(sourceGeometries, false);
        if (!geometry) {
          throw new Error(`TOTEM ${role} geometry could not be merged safely.`);
        }
        const triangles = geometry.getAttribute("position").count / 3;
        if (!Number.isInteger(triangles)) {
          geometry.dispose();
          throw new Error(`TOTEM ${role} geometry does not contain complete triangles.`);
        }
        batches.push({
          role,
          group: "hull",
          geometry,
          material: sourceMaterial,
          triangles,
          slots: [{ ...IDENTITY_SLOT, pivotMatrix: new THREE.Matrix4() }],
        });
      }

      // Every batch of a role shares that role's material, so clone once per
      // role after the set is known and hand the clones out.
      const clonesByRole = new Map<TotemRivalMaterialRole, THREE.Material>();
      for (const batch of batches) {
        let clone = clonesByRole.get(batch.role);
        if (!clone) {
          clone = batch.material.clone();
          // `Material.copy` carries neither `onBeforeCompile` nor the cache key,
          // so a fresh clone would render the rivals ungraded next to a graded
          // player craft. Re-arm it — without `worldGeometry`, because rivals
          // must not snap either.
          applyPs2ShaderTreatment(clone, false);
          // Same reason for the wear multiply. The field is three more of the
          // same craft out of the same works; a clean field behind a worn
          // player would read as a bug rather than as a fleet.
          if (batch.role === "TOTEM_body") applyLiveryWearTreatment(clone);
          clonesByRole.set(batch.role, clone);
        }
        batch.material = clone;
      }
    } catch (error) {
      // Batches carry the model's own materials until the clone pass at the end
      // of the try block, so a throw can only ever leave geometry to release.
      for (const batch of batches) batch.geometry.dispose();
      throw error;
    } finally {
      for (const geometry of scratch) geometry.dispose();
    }
    return batches;
  }

  /**
   * Builds one shared pivot-local geometry for a left/right articulation pair.
   * Returns `null` when the pair cannot share geometry, which is the caller's
   * signal to weld those parts to the hull instead.
   */
  private mergeArticulationGroup(
    definition: (typeof RIVAL_ARTICULATION_GROUPS)[number],
    sourcesByPivot: ReadonlyMap<string, OriginalVisibleMesh[]>,
    bake: (source: OriginalVisibleMesh, matrix: THREE.Matrix4) => THREE.BufferGeometry,
    scratch: THREE.BufferGeometry[],
    pivotLocal: THREE.Matrix4,
  ): {
    geometry: THREE.BufferGeometry;
    triangles: number;
    slots: TotemRivalArticulationSlot[];
  } | null {
    const slots: TotemRivalArticulationSlot[] = [];
    const perPivot: THREE.BufferGeometry[] = [];
    for (const pivot of definition.pivots) {
      const sources = sourcesByPivot.get(pivot);
      const pivotMatrix = this.pivotMatrices.get(pivot);
      if (!sources || sources.length === 0 || !pivotMatrix) return null;
      // A mirrored pivot would flip winding on the shared geometry.
      if (pivotMatrix.determinant() <= 0) return null;
      if (sources.some((source) => (
        Array.isArray(source.mesh.material) || source.mesh.material.name !== "TOTEM_body"
      ))) return null;
      pivotLocal.copy(pivotMatrix).invert();
      const baked = sources.map((source) => (
        bake(source, pivotLocal.clone().multiply(source.modelLocalMatrix))
      ));
      let merged = baked[0];
      if (baked.length > 1) {
        const combined = mergeGeometries(baked, false);
        if (!combined) return null;
        scratch.push(combined);
        merged = combined;
      }
      perPivot.push(merged);
      slots.push({
        pivot,
        pivotMatrix: pivotMatrix.clone(),
        axis: definition.axis,
        shadingScale: 1,
      });
    }

    const reference = perPivot[0];
    const referenceShading = meanVertexShading(reference);
    for (let index = 0; index < perPivot.length; index += 1) {
      slots[index].shadingScale = meanVertexShading(perPivot[index]) / referenceShading;
    }
    const referencePositions = reference.getAttribute("position");
    for (let index = 1; index < perPivot.length; index += 1) {
      const positions = perPivot[index].getAttribute("position");
      if (positions.count !== referencePositions.count) return null;
      for (let component = 0; component < positions.array.length; component += 1) {
        const difference = Math.abs(
          (positions.array as ArrayLike<number>)[component]
            - (referencePositions.array as ArrayLike<number>)[component],
        );
        if (difference > SHARED_SIDE_TOLERANCE_METERS) return null;
      }
    }

    const triangles = referencePositions.count / 3;
    if (!Number.isInteger(triangles)) return null;
    // The reference is scratch-owned; hand back a copy the batch can own.
    return { geometry: reference.clone(), triangles, slots };
  }

  setPose(position: THREE.Vector3, quaternion: THREE.Quaternion): void {
    this.root.position.copy(position);
    this.root.quaternion.copy(quaternion);
    // updateVisual changes child transforms immediately after this call. The
    // chase-camera anchor performs the single authoritative world-matrix sync
    // once those changes are complete; an update here would traverse the full
    // vehicle hierarchy twice per active frame.
  }

  updateVisual(state: TotemVisualState): void {
    const bank = THREE.MathUtils.clamp(
      -state.steer * (0.2 + state.driftIntensity * 0.08)
        - state.lateralLoad * 0.13,
      -0.34,
      0.34,
    );
    const pitch = state.brake * 0.055 - state.throttle * 0.025;
    const bob = state.reducedMotion
      ? 0
      : Math.sin(state.elapsed * 4.1) * 0.026 * (0.25 + state.speedRatio);
    this.visual.position.y = bob;
    const pitchResponse = 1 - Math.exp(-state.delta * 8.5);
    const bankResponse = 1 - Math.exp(-state.delta * 7.2);
    this.visual.rotation.x = THREE.MathUtils.lerp(
      this.visual.rotation.x,
      pitch,
      pitchResponse,
    );
    this.visual.rotation.z = THREE.MathUtils.lerp(
      this.visual.rotation.z,
      bank,
      bankResponse,
    );

    this.setRotation("steering_fin_L_pivot", "y", state.steer * 20 * DEG);
    this.setRotation("steering_fin_R_pivot", "y", state.steer * 20 * DEG);
    this.setRotation("airbrake_L_pivot", "x", state.brake * 60 * DEG);
    this.setRotation("airbrake_R_pivot", "x", state.brake * 60 * DEG);
    this.setRotation("elevon_L_pivot", "y", (-state.steer * 9 + state.brake * 6) * DEG);
    this.setRotation("elevon_R_pivot", "y", (-state.steer * 9 - state.brake * 6) * DEG);
    this.setRotation(
      "stabiliser_ring_pivot",
      "z",
      (-state.lateralLoad * 12 - state.steer * state.driftIntensity * 10) * DEG,
    );

    const flapAngle = (9 + state.throttle * 20 + (state.boostActive ? 4 : 0)) * DEG;
    for (const name of ENGINE_FLAP_NAMES) {
      this.setRotation(name, "x", flapAngle);
    }

    const skid = this.nodes.get("skids_pivot");
    const skidNeutral = this.neutral.get("skids_pivot");
    if (skid && skidNeutral) {
      const retract = THREE.MathUtils.smoothstep(state.speedRatio, 0.12, 0.26);
      skid.position.y = skidNeutral.position.y - retract * 0.22;
    }

    // The ground blob used to be a 12-triangle circle parented here. It now
    // rides in the fleet's shared instanced blob mesh alongside the rivals, so
    // every craft on track reads the same way for one draw call in total.
    this.racePresence?.update(state);
    this.evolution?.update(state);
  }

  triggerImpactEffect(side: number, strength: number): void {
    this.racePresence?.triggerImpact(side, strength);
  }

  resetEffects(): void {
    this.racePresence?.reset();
    this.evolution?.reset();
  }

  worldPosition(
    name: string,
    fallback: THREE.Vector3,
    target: THREE.Vector3,
  ): THREE.Vector3 {
    const node = this.nodes.get(name);
    if (!node) return target.copy(fallback);
    this.root.updateMatrixWorld(true);
    return node.getWorldPosition(target);
  }

  private setRotation(name: string, axis: "x" | "y" | "z", offset: number): void {
    const node = this.nodes.get(name);
    const neutral = this.neutral.get(name);
    if (!node || !neutral) return;
    this.rotationOffset.setFromAxisAngle(LOCAL_ROTATION_AXES[axis], offset);
    node.quaternion.copy(neutral.quaternion).multiply(this.rotationOffset);
  }

  private captureOriginalVisibleMeshes(): void {
    if (!this.model) return;
    this.model.updateMatrixWorld(true);
    const modelWorldInverse = this.model.matrixWorld.clone().invert();
    const articulated = new Set(
      RIVAL_ARTICULATION_GROUPS.flatMap((entry) => entry.pivots),
    );
    this.originalVisibleMeshes = [];
    this.pivotMatrices.clear();
    this.model.traverse((object) => {
      if (articulated.has(object.name)) {
        this.pivotMatrices.set(
          object.name,
          modelWorldInverse.clone().multiply(object.matrixWorld),
        );
      }
      if (!(object instanceof THREE.Mesh) || !object.visible) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (materials.some((material) => material.name === "TOTEM_collision")) return;
      let pivot: string | null = null;
      for (
        let ancestor: THREE.Object3D | null = object;
        ancestor && ancestor !== this.model;
        ancestor = ancestor.parent
      ) {
        if (articulated.has(ancestor.name)) {
          pivot = ancestor.name;
          break;
        }
      }
      this.originalVisibleMeshes.push({
        mesh: object,
        modelLocalMatrix: modelWorldInverse.clone().multiply(object.matrixWorld),
        pivot,
      });
    });
  }

  /**
   * P7 — swaps the player's decal sheet.
   *
   * `TOTEM_body.map` arrives baked into the runtime GLB as the works sheet, so
   * livery select is a texture swap on that one material rather than a model
   * variant. The replacement inherits every sampler setting from the sheet it
   * replaces — colour space, filters, anisotropy, wrap — so a chosen livery
   * cannot read differently at distance from the shipped default, and the PS2
   * nearest-filter treatment survives.
   *
   * **`flipY` is the one setting that must NOT be inherited**, and P15.1 fixed
   * the bug where it was. The two sheets do not live in the same orientation:
   *
   * - The GLB's embedded sheet is stored PRE-FLIPPED. glTF puts the UV origin
   *   at the top of the image and `GLTFLoader` sets `flipY = false` to honour
   *   that, so the exporter flipped the pixels to compensate. The hull's chip
   *   row lands on embedded image row 76.
   * - The served PNGs are stored the way `totem/MANIFEST.json` describes them,
   *   origin at the top — the paint-chip strip really is at rows 900-996. They
   *   are an exact vertical flip of the embedded sheet.
   *
   * So a served sheet needs the `TextureLoader` default `flipY = true` to put
   * the same pixels under the same UVs. Copying the GLB's `false` sampled every
   * hull material from the mirrored row instead: `NIGHTFORM` took the acid-paint
   * chip for its whole body and rendered bright green, and every other swapped
   * livery was wrong in its own way. Nothing caught it because the default path
   * never swaps — the works sheet on the model at boot is the embedded one.
   *
   * Returns false when the sheet could not be fetched; the works decal already
   * on the model stays, and the race is unaffected. Must be called after
   * `load()` and before `createRivalVisualBatches()`, which clones these
   * materials for the field.
   */
  async applyLivery(textureUrl: string): Promise<boolean> {
    const material = this.bodyMaterial();
    if (!material) return false;
    const previous = material.map;
    let texture: THREE.Texture;
    try {
      texture = await new THREE.TextureLoader().loadAsync(textureUrl);
    } catch {
      return false;
    }
    if (previous) {
      texture.colorSpace = previous.colorSpace;
      texture.wrapS = previous.wrapS;
      texture.wrapT = previous.wrapT;
      texture.magFilter = previous.magFilter;
      texture.minFilter = previous.minFilter;
      texture.anisotropy = previous.anisotropy;
      texture.generateMipmaps = previous.generateMipmaps;
    }
    // Set, never inherited. See the note above: the sheet being replaced may be
    // the pre-flipped one baked into the GLB, and this one is not.
    texture.flipY = SERVED_LIVERY_FLIP_Y;
    texture.needsUpdate = true;
    material.map = texture;
    material.needsUpdate = true;
    // P15 — the wear intensity travels with the livery, because it is a
    // property of the paint rather than of the craft. Only ever a hold-back:
    // three of the four sheets sit at the authored 45 and nightform at 34.
    setLiveryWearIntensity(textureUrl);
    // The baked sheet is never referenced again: the rival atlas is built from
    // the served PNGs, not from this material's map.
    previous?.dispose();
    return true;
  }

  private bodyMaterial(): THREE.MeshStandardMaterial | null {
    let found: THREE.MeshStandardMaterial | null = null;
    this.model?.traverse((object) => {
      if (found || !(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of materials) {
        if (
          material.name === "TOTEM_body"
          && material instanceof THREE.MeshStandardMaterial
        ) {
          found = material;
          return;
        }
      }
    });
    return found;
  }

  private calibrateVehicleMaterials(): void {
    if (!this.model) return;
    const calibrated = new Set<THREE.Material>();
    this.model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (calibrated.has(material) || !(material instanceof THREE.MeshStandardMaterial)) {
          continue;
        }
        calibrated.add(material);
        if (material.name === "TOTEM_body") {
          material.roughness = Math.max(material.roughness, 0.72);
          material.metalness = Math.min(material.metalness, 0.18);
        } else if (material.name === "TOTEM_emissive") {
          material.emissiveIntensity = 0.62;
        } else if (material.name === "TOTEM_glass") {
          material.roughness = Math.max(material.roughness, 0.25);
          material.metalness = Math.min(material.metalness, 0.1);
        }
        material.needsUpdate = true;
      }
    });
  }

}
