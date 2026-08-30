import * as THREE from "three";
import atlasRegionsJson from "./data/ATLAS_REGIONS.json";
import edgeBandJson from "./data/BITTERPAN_ROAD_EDGE_BAND.json";
import productionJson from "./data/map02/BITTERPAN_PRODUCTION.json";
import { GROUND_Y_METRES } from "./bitterpan-surface";
import { type CourseSample, type RaceCourse, surfaceHeightAtLateral } from "./course";

/**
 * P18 art pass 03 — the Bitterpan road edge, painted on the road.
 *
 * This is the replacement half of a single change. The orange banding on the
 * Bitterpan edge today is not authored art: it arrives with the legacy
 * `BLOCKOUT_barrier` material on the vestigial blockout GLB — a mirrored
 * duplicate of the road that P16 already proved is not the surface the craft
 * drives on. That mesh stops rendering in the same commit as this layer,
 * because two orange edge languages in one frame is worse than either alone.
 *
 * Everything here is zero-height painted road: 0.012 m of lift, the same as the
 * pan crust decals and the Greenwater opening straight. Nothing is furniture,
 * nothing needs a corridor exemption, and the corridor sweep reports it flush.
 *
 * ONE merged mesh, ONE material, ONE draw call on Bitterpan. It cannot ride
 * `BP_SURFACE_CRUST`: that material samples `bitterpan_crust_1024`, which is
 * hash-pinned as of Pass 02.
 *
 * ## Hierarchy
 *
 * Orange is physical: the surface ends here, or something on it will hit you.
 * Cyan is route: the line, the direction, the sequence. They never share a
 * mark. The only new cyan in Pass 03 is the 1.5 m span-entry tick, six times a
 * lap; `ROUTE_EDGE_CYAN` and the rest of the route language on the crust sheet
 * are untouched.
 *
 * ## Deviations from the delivery, stated rather than absorbed
 *
 * 1. **Each 24 m strip is drawn as six 4 m quads, not one.** The delivery
 *    budgets 282 quads / 564 triangles, i.e. one quad per strip. Bitterpan's
 *    tightest authored radius makes a 24 m chord miss the deck edge by
 *    `L^2 / 8R` — enough for the band to leave the road on a bend. The
 *    subdivision is one segment per authored 4.0 m dash cycle, so the phase
 *    rule ("phase 0 at each strip origin, six cycles per strip") is what sets
 *    the cut. The number that was budgeted — draw calls — is unchanged.
 * 2. **`WEAR_CAP` count.** The delivery says 14 per lap, at "the last strip of
 *    any band run that ends on open pan". That number does not fall out of the
 *    accepted station table under any reading of that sentence; the rule below
 *    is the literal one and reports whatever it produces. See the phase report.
 * 3. **Drift exclusions.** The delivery says 11 strips per side. The accepted
 *    `HZ_SALT_DRIFT` patches are authored on ONE side (lateral fraction -1 to
 *    -0.3), and midpoint containment resolves a different count. Measured
 *    values are reported by the counters rather than asserted to the note.
 */

const MESH_NAME = "BP_ROAD_EDGE_BAND";
const MATERIAL_NAME = "BP_ROAD_EDGE_BAND";
const VERTICES_PER_QUAD = 4;
const TRIANGLES_PER_QUAD = 2;

const SHEET_KEY = "futurisma_trim_512";

interface AtlasRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface AtlasSheet {
  texture: string;
  width: number;
  height: number;
  regions: Record<string, AtlasRegion>;
}

const ATLAS_SHEETS = atlasRegionsJson as unknown as Record<string, AtlasSheet>;

const SPEC = edgeBandJson as unknown as {
  geometry: {
    dashRhythmMetres: { cycle: number };
    stripLengthMetres: number;
    liftMetres: number;
  };
  ticks: { region: string; cells: { index: number; id: string }[] };
  placementPlan: {
    stripsPerSide: number;
    sides: number;
    totalStrips: number;
    lapLengthMetres: number;
  };
};

const PRODUCTION = productionJson as unknown as {
  hazards: {
    entries: {
      id: string;
      type: string;
      fromDistance: number;
      toDistance: number;
      lateralFromFraction: number;
      lateralToFraction: number;
    }[];
  };
  boostPads: { pads: { id: string; distance: number }[] };
  edges: { spans: { id: string; fromDistance: number; toDistance: number }[] };
};

/**
 * The lip threshold, in metres above the pan floor.
 *
 * Measured, not chosen for looks: below it the deck edge and the pan are the
 * same surface to the eye at 300 km/h, and a hairline drawn there would be
 * describing an edge the player cannot see.
 */
const LIP_THRESHOLD_METRES = 0.35;

/** How far inboard of the deck lip the strip reaches. `v = 64 px` is 3.00 m. */
const STRIP_INBOARD_METRES = 3;

/** Length of one tick cell, metres. Four 1.5 m cells share EDGE_TICK_SET. */
const TICK_LENGTH_METRES = 1.5;

/** Chevrons stand this far before the reference they warn about. */
const CHEVRON_LEAD_METRES = 12;

type BandRegion = "EDGE_BAND_DECK" | "EDGE_BAND_PAN" | "EDGE_BAND_BERM";

interface StripPlan {
  side: -1 | 1;
  index: number;
  origin: number;
  length: number;
  midpoint: number;
  lip: number;
  edge: "A" | "B" | "C";
  region: BandRegion | null;
}

export interface RoadEdgeBandStats {
  drawCalls: number;
  strips: number;
  ticks: number;
  cyanTicks: number;
  chevronTicks: number;
  wearCapTicks: number;
  /** Strips whose paint is buried by an authored salt drift patch. */
  blankStrips: number;
  deckStrips: number;
  panStrips: number;
  bermStrips: number;
  quads: number;
  triangles: number;
  materials: number;
  textures: number;
  /** Every cyan tick that landed inside an authored edge span. Must equal 6. */
  cyanTicksInSpan: number;
  maxLiftMetres: number;
  shaderModel: "unlit";
}

interface QuadSink {
  positions: number[];
  uvs: number[];
  indices: number[];
}

export class BitterpanRoadEdgeBand {
  readonly stats: RoadEdgeBandStats;

  private constructor(readonly root: THREE.Group, stats: RoadEdgeBandStats) {
    this.stats = stats;
  }

  static build(course: RaceCourse, texture: THREE.Texture): BitterpanRoadEdgeBand {
    const sheet = ATLAS_SHEETS[SHEET_KEY];
    if (!sheet) {
      throw new Error(`Trim atlas ${SHEET_KEY} is missing from ATLAS_REGIONS.`);
    }
    const scratch = course.createSampleScratch();
    const plans = planStrips(course, scratch);

    const sink: QuadSink = { positions: [], uvs: [], indices: [] };
    const counts = { EDGE_BAND_DECK: 0, EDGE_BAND_PAN: 0, EDGE_BAND_BERM: 0 };
    let blankStrips = 0;
    let maxLift = 0;

    const cycle = SPEC.geometry.dashRhythmMetres.cycle;
    for (const plan of plans) {
      const regionName = plan.region ?? "EDGE_TICK_SET";
      const region = sheet.regions[regionName];
      if (!region) throw new Error(`Edge band names unknown trim region ${regionName}.`);
      if (plan.region) counts[plan.region] += 1;
      else blankStrips += 1;

      // Dash phase is 0 at the strip origin and the strip is exactly six 4.0 m
      // cycles long, so a repeat lands on a dash boundary and the rhythm never
      // stutters at a seam. Cutting the geometry on the same boundary keeps
      // that true while letting the strip follow the deck around a bend.
      for (let step = 0; step * cycle < plan.length - 1e-6; step += 1) {
        const from = plan.origin + step * cycle;
        const to = Math.min(plan.origin + plan.length, from + cycle);
        const u0 = (from - plan.origin) / SPEC.geometry.stripLengthMetres;
        const u1 = (to - plan.origin) / SPEC.geometry.stripLengthMetres;
        maxLift = Math.max(
          maxLift,
          pushSurfaceQuad(sink, course, scratch, sheet, region, plan.side, from, to,
            plan.region ? u0 : tickCellU(u0, 3), plan.region ? u1 : tickCellU(u1, 3)),
        );
      }
    }

    const ticks = planTicks(plans);
    for (const tick of ticks) {
      const region = sheet.regions[SPEC.ticks.region];
      if (!region) throw new Error(`Edge band names unknown tick region ${SPEC.ticks.region}.`);
      maxLift = Math.max(
        maxLift,
        pushSurfaceQuad(sink, course, scratch, sheet, region, tick.side,
          tick.from, tick.from + TICK_LENGTH_METRES,
          tickCellU(0, tick.cell), tickCellU(1, tick.cell)),
      );
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(sink.positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(sink.uvs, 2));
    geometry.setIndex(sink.indices);
    geometry.computeBoundingSphere();

    // Identical contract to BP_SURFACE_CRUST and the Greenwater opening
    // straight: unlit, nearest, no mip chain, polygon-offset, no depth write.
    const material = new THREE.MeshBasicMaterial({
      name: MATERIAL_NAME,
      map: texture,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      // DoubleSide, unlike BP_SURFACE_CRUST. The crust decals are authored with
      // one winding and sit flat; these strips are generated per side of the
      // centreline off `sample.right`, so their winding flips with the sign of
      // the lateral and a single-sided material silently drew nothing on one
      // hand and — on a banked station — nothing on either. Found by looking at
      // the road rather than at the counters: `edgeBandQuads` read 1,557 the
      // whole time.
      side: THREE.DoubleSide,
      fog: true,
      alphaTest: 0,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = MESH_NAME;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    // Behind the crust decals in the same band: the paint is under the salt.
    mesh.renderOrder = 1;

    const root = new THREE.Group();
    root.name = "bitterpan_road_edge_band";
    root.add(mesh);

    const cyan = ticks.filter((tick) => tick.cell === 0);
    return new BitterpanRoadEdgeBand(root, {
      drawCalls: 1,
      strips: plans.length,
      ticks: ticks.length,
      cyanTicks: cyan.length,
      chevronTicks: ticks.filter((tick) => tick.cell === 1).length,
      wearCapTicks: ticks.filter((tick) => tick.cell === 2).length,
      blankStrips,
      deckStrips: counts.EDGE_BAND_DECK,
      panStrips: counts.EDGE_BAND_PAN,
      bermStrips: counts.EDGE_BAND_BERM,
      quads: sink.positions.length / 3 / VERTICES_PER_QUAD,
      triangles: sink.indices.length / 3,
      materials: 1,
      textures: 1,
      cyanTicksInSpan: cyan.filter((tick) => PRODUCTION.edges.spans.some(
        (span) => tick.from >= span.fromDistance && tick.from < span.toDistance,
      )).length,
      maxLiftMetres: Number(maxLift.toFixed(4)),
      shaderModel: "unlit",
    });
  }

  static async load(
    course: RaceCourse,
    texture: THREE.Texture,
  ): Promise<BitterpanRoadEdgeBand> {
    return BitterpanRoadEdgeBand.build(course, texture);
  }
}

/** The 127 strips a side, each resolved to its variant by edge type and lip. */
function planStrips(course: RaceCourse, scratch: CourseSample): StripPlan[] {
  const plan: StripPlan[] = [];
  const stripLength = SPEC.geometry.stripLengthMetres;
  const perSide = SPEC.placementPlan.stripsPerSide;
  const lap = SPEC.placementPlan.lapLengthMetres;
  const drifts = PRODUCTION.hazards.entries.filter((entry) => entry.type === "salt_drift");

  for (const side of [-1, 1] as const) {
    for (let index = 0; index < perSide; index += 1) {
      const origin = index * stripLength;
      // The last strip is trimmed at the lap seam with its dash phase preserved,
      // so the seam falls inside a gap rather than inside a dash.
      const length = Math.min(stripLength, lap - origin);
      const midpoint = origin + length / 2;
      const sample = course.sample(midpoint / course.length, scratch);
      const lateral = side * sample.halfWidth;
      const lip = sample.position.y - GROUND_Y_METRES;
      const edge = course.edgeType(sample, lateral);
      // Salt drift buries paint. Painting over a drift patch would tell the
      // player the surface is grippy where the hazard says it is not. The
      // authored patches carry a lateral fraction range, so the exclusion
      // applies to the side they are actually on.
      const buried = drifts.some((drift) => midpoint >= drift.fromDistance
        && midpoint < drift.toDistance
        && side === (drift.lateralFromFraction < 0 ? -1 : 1));
      plan.push({
        side,
        index,
        origin,
        length,
        midpoint,
        lip,
        edge,
        region: buried
          ? null
          : edge !== "C"
            ? "EDGE_BAND_BERM"
            : lip >= LIP_THRESHOLD_METRES
              ? "EDGE_BAND_DECK"
              : "EDGE_BAND_PAN",
      });
    }
  }
  return plan;
}

interface TickPlan {
  side: -1 | 1;
  from: number;
  cell: number;
}

/** The three authored tick classes, in cell order: cyan, chevron, wear cap. */
function planTicks(plans: StripPlan[]): TickPlan[] {
  const ticks: TickPlan[] = [];
  for (const side of [-1, 1] as const) {
    // Cell 0, SPAN_ENTRY_CYAN: first 1.5 m of each authored edge span, both
    // sides. Three bars reading inboard — the route language telling you the
    // sequence has changed. Six a lap, and the pinned cyan exception.
    for (const span of PRODUCTION.edges.spans) {
      ticks.push({ side, from: span.fromDistance, cell: 0 });
    }
    // Cell 1, CHEVRON_ORANGE: 12 m before each braking reference on the four
    // BP_* sequences. Physical warning, paired with the existing route chevrons
    // on the crust sheet so the two agree in direction.
    for (const pad of PRODUCTION.boostPads.pads) {
      ticks.push({ side, from: pad.distance - CHEVRON_LEAD_METRES, cell: 1 });
    }
    // Cell 2, WEAR_CAP: the last strip of any band run that ends on open pan.
    // A band that stops dead reads as a texture ending; this is how paint
    // actually ends, worn to nothing.
    const sideStrips = plans.filter((plan) => plan.side === side);
    for (let index = 0; index < sideStrips.length; index += 1) {
      const current = sideStrips[index];
      if (!current.region) continue;
      const next = sideStrips[(index + 1) % sideStrips.length];
      const endsOnOpenPan = next.region === null || next.region === "EDGE_BAND_PAN";
      if (!endsOnOpenPan) continue;
      ticks.push({
        side,
        from: current.origin + current.length - TICK_LENGTH_METRES,
        cell: 2,
      });
    }
  }
  return ticks;
}

/** U inside EDGE_TICK_SET for cell `cell`, at fraction `t` across that cell. */
function tickCellU(t: number, cell: number): number {
  return (cell + t) / 4;
}

/**
 * One ground quad from `from` to `to` along the lap, spanning the deck lip to
 * `STRIP_INBOARD_METRES` inboard on `side`.
 *
 * Every corner is sampled at its OWN distance so a strip on a bend follows the
 * centreline instead of cutting the chord, and rides the authored cross-section
 * through `surfaceHeightAtLateral` rather than a flat extrapolation.
 *
 * @returns the greatest lift above the surface any corner of this quad took.
 */
function pushSurfaceQuad(
  sink: QuadSink,
  course: RaceCourse,
  scratch: CourseSample,
  sheet: AtlasSheet,
  region: AtlasRegion,
  side: -1 | 1,
  from: number,
  to: number,
  u0: number,
  u1: number,
): number {
  // `v = 0` is the deck lip and `v = h` is STRIP_INBOARD_METRES inboard; image
  // space runs top-down and UV space bottom-up, so the lip is the region's TOP.
  const vLip = 1 - region.y / sheet.height;
  const vInboard = 1 - (region.y + region.h) / sheet.height;
  const uLeft = (region.x + region.w * u0) / sheet.width;
  const uRight = (region.x + region.w * u1) / sheet.width;

  const base = sink.positions.length / 3;
  const point = new THREE.Vector3();
  const corners: ReadonlyArray<readonly [number, number, number, number]> = [
    [from, 0, uLeft, vLip],
    [to, 0, uRight, vLip],
    [from, STRIP_INBOARD_METRES, uLeft, vInboard],
    [to, STRIP_INBOARD_METRES, uRight, vInboard],
  ];
  const lift = SPEC.geometry.liftMetres;
  for (const [distance, inboard, u, v] of corners) {
    const sample = course.sample(
      (((distance % course.length) + course.length) % course.length) / course.length,
      scratch,
    );
    const lateral = side * Math.max(0, sample.halfWidth - inboard);
    const height = surfaceHeightAtLateral(sample, lateral) + lift;
    point.copy(sample.position)
      .addScaledVector(sample.right, lateral)
      .addScaledVector(sample.up, height);
    sink.positions.push(point.x, point.y, point.z);
    sink.uvs.push(u, v);
  }
  sink.indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  return lift;
}

export { TRIANGLES_PER_QUAD };
