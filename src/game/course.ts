import * as THREE from "three";
import greenwaterJson from "./data/greenwater-blockout.json";
import greenwaterRivalPaceJson from "./data/greenwater-rival-pace.json";
import plaqueBackingJson from "./data/HANGAR_SIX_PLAQUE_BACKING.json";
import {
  createApronResolution,
  resolveApron,
  resolveApronProfile,
} from "./apron.js";
import type { ApronResolution, ApronTable } from "./apron.js";
import { resolveAudioZone } from "./audio-space.js";
import type { AudioZone } from "./audio-space.js";
import {
  EDGE_FURNITURE_CLEARANCE_METRES,
  TURN_CHEVRON_CLEARANCE_METRES,
  resolveFurniturePlacement,
  resolveGatePostLateral,
} from "./furniture-placement.js";
import type { FurniturePlacement } from "./furniture-placement.js";
import {
  ATMOSPHERE_UPDATE_INTERVAL_SECONDS,
  LIGHTING_CROSSFADE_METRES,
  SECTOR_KEY_DIRECTIONS,
  lerpKeyDirection,
} from "./lighting-motion.js";
import { crossedForwardProgress, isCircularHazardContact } from "./race-rules";
import { APRON_EDGE_CROSS_SECTION, type EdgeType } from "./apron-profile";
import DRIVABLE_LIMIT_TABLE from "./data/DRIVABLE_LIMITS.json";
import { DrivableLimits } from "./drivable-limits";

// P16 — the run-off cross-section moved to `apron-profile.ts`, a leaf module,
// so the presentation path can read it without pulling the whole course builder
// into the initial bundle. Re-exported here: every existing import still works,
// and there is still exactly one table.
export type { EdgeType } from "./apron-profile";
export { APRON_EDGE_CROSS_SECTION, surfaceHeightAtLateral } from "./apron-profile";

interface RawCourseSample {
  d: number;
  x: number;
  y: number;
  z: number;
  hdg: number;
  w: number;
  bank: number;
  sector: string;
  edgeL: EdgeType;
  edgeR: EdgeType;
}

interface RawCheckpoint {
  index: number;
  id: string;
  distance: number;
  gateWidth: number;
  mastHeight: number;
  name: string;
}

interface RawTurn {
  id: string;
  name: string;
  direction: "left" | "right";
  radius: number;
  entryDistance: number;
  apexDistance: number;
  exitDistance: number;
  chevronCount: number;
  boards: number[];
}

interface RawFogZone {
  fromDistance: number;
  toDistance: number;
  density: number;
  color: string;
}

interface RawLandmark {
  id: string;
  anchorDistance: number;
  lateralOffset: number;
  position: { x: number; y: number; z: number };
  height: number;
  footprint: { x: number; z: number };
  note: string;
}

interface RawHazard {
  id: string;
  type: string;
  distance?: number;
  fromDistance?: number;
  toDistance?: number;
  lateralOffset?: number;
  cycleSeconds?: number;
  telegraphSeconds?: number;
  effect?: string;
  collision?: boolean;
  gripMultiplier?: number;
  durationSeconds?: number;
}

interface SteamVentRuntime {
  sample: CourseSample;
  lateralOffset: number;
  cycleSeconds: number;
  telegraphSeconds: number;
  phaseOffset: number;
}

export interface MusicProfile {
  trance: number;
  jungle: number;
  deep_dnb: number;
  techstep: number;
}

interface RawMusicTrigger {
  distance: number;
  sector: string;
  levels: MusicProfile;
}

interface GreenwaterMapData {
  map: { id: string; name: string };
  race: {
    lapCount: number;
    lapCountRange: [number, number];
    lapBoard: { template: string };
  };
  startFinish: {
    clearSpan: number;
    structureHeight: number;
    gridOffset: number;
    gridPads: number;
  };
  centreline: {
    closed: boolean;
    lapLength: number;
    sampleCount: number;
    samples: RawCourseSample[];
  };
  checkpoints: RawCheckpoint[];
  turns: RawTurn[];
  fog: { zones: RawFogZone[]; crossfadeMetres: number };
  timeOfDay: { stops: TimeOfDayStop[] };
  recovery: {
    holdSeconds: number;
    reinsertSpeedKph: number;
    immunitySeconds: number;
  };
  landmarkProxies: RawLandmark[];
  hazards: RawHazard[];
  music: { triggers: RawMusicTrigger[] };
  audio: {
    zones: RawAudioZone[];
    defaultZone: AudioZone;
    crossfadeSeconds: number;
  };
  apron: ApronTable;
}

interface RawAudioZone {
  name: AudioZone;
  startDistance: number;
  endDistance: number;
}

export type { ApronResolution } from "./apron.js";

export interface CourseSample {
  /** A physical branch separated from the AI fleet’s main road. */
  alternateRoad?: boolean;
  position: THREE.Vector3;
  tangent: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  curvature: number;
  width: number;
  halfWidth: number;
  bank: number;
  sector: string;
  edgeLeft: EdgeType;
  edgeRight: EdgeType;
  /** Authored run-off beyond `halfWidth`, in metres, per side. */
  apronLeft: number;
  apronRight: number;
  /** Grip multiplier once past `halfWidth - deckMargin`, per side. */
  apronGripLeft: number;
  apronGripRight: number;
}

export interface CourseProjection extends CourseSample {
  progress: number;
  lateral: number;
}

function createCourseSampleValue(): CourseSample {
  return {
    position: new THREE.Vector3(),
    tangent: new THREE.Vector3(0, 0, -1),
    right: new THREE.Vector3(1, 0, 0),
    up: new THREE.Vector3(0, 1, 0),
    curvature: 0,
    width: 0,
    halfWidth: 0,
    bank: 0,
    sector: "",
    edgeLeft: "A",
    edgeRight: "A",
    apronLeft: 0,
    apronRight: 0,
    apronGripLeft: 1,
    apronGripRight: 1,
  };
}

function createCourseProjectionValue(): CourseProjection {
  return {
    ...createCourseSampleValue(),
    progress: 0,
    lateral: 0,
  };
}

export interface TurnCue {
  direction: "LEFT" | "RIGHT";
  followingDirection: "LEFT" | "RIGHT" | null;
  distance: number;
  hard: boolean;
  radius: number;
}

export interface FogProfile {
  density: number;
  color: THREE.Color;
}

export interface CourseLightingProfile {
  sky: THREE.Color;
  ground: THREE.Color;
  key: THREE.Color;
  rim: THREE.Color;
  hemisphereIntensity: number;
  keyIntensity: number;
  rimIntensity: number;
  /**
   * Normalized world-space direction the key light comes *from*, crossfaded
   * around the lap with the same `LIGHTING_CROSSFADE_METRES` window as the
   * colours above. Before P4a this was a constant `(80, 130, -35)` nailed into
   * `atmosphere.ts`; it is course data now so the sun can swing per sector.
   */
  keyDirection: THREE.Vector3;
}

/**
 * One authored stop of the P4a lap-based time-of-day ramp. Every tint is a
 * multiplier over the sector palette, so a course that authors no ramp simply
 * reports `timeOfDayStops: null` and nothing drifts.
 */
export interface TimeOfDayStop {
  lapProgress: number;
  label: string;
  keyTint: readonly [number, number, number];
  skyTint: readonly [number, number, number];
  groundTint: readonly [number, number, number];
  fogTint: readonly [number, number, number];
  hemisphereScale: number;
  keyScale: number;
}

export type CourseKind = "greenwater" | "bitterpan" | "nightshift" | "polarity" | "tideline";

export interface RivalGridStart {
  raceDistanceMeters: number;
  courseDistanceMeters: number;
  lateralMeters: number;
}

/** One rival's authored pace on this map. See `rival-race.js` for the model. */
export interface RivalPaceEntry {
  cruiseSpeedMetersPerSecond: number;
  padUse: boolean;
  boostWindows: readonly { fromMeters: number; toMeters: number }[];
}

/**
 * G1 - the per-map rival pace block. Greenwater authors it in
 * `data/greenwater-rival-pace.json`, Bitterpan under the `rivals` key of
 * `BITTERPAN_PRODUCTION.json`. Both were solved by
 * `scripts/rival-pace-calibration.mjs` against a measured demo soak.
 */
export interface RivalPaceTable {
  cornerSpeedGain: number;
  cornerSpeedFloor: number;
  noBlockSide: number;
  driftCurvature: number;
  straightCurvature: number;
  profiles: Record<string, RivalPaceEntry>;
}

export interface RaceCourse {
  readonly kind: CourseKind;
  readonly group: THREE.Group;
  readonly length: number;
  readonly halfWidth: number;
  readonly checkpointCount: number;
  readonly orderedCheckpointCount: number;
  readonly defaultLapCount: number;
  readonly minimumLapCount: number;
  readonly maximumLapCount: number;
  readonly mapName: string;
  readonly mapCode: string;
  readonly finishName: string;
  readonly startLabel: string;
  readonly startProgress: number;
  readonly startLateral: number;
  readonly recoveryHoldSeconds: number;
  readonly recoverySpeedMps: number;
  readonly recoveryImmunitySeconds: number;
  readonly surfaceGripRecoverySeconds: number;
  /**
   * Authored time-of-day ramp, or `null` for a course that has not authored one
   * (Bitterpan until P8). `atmosphere.ts` applies it multiplicatively over
   * whatever `lightingAt` / `fogAt` return.
   */
  readonly timeOfDayStops: readonly TimeOfDayStop[] | null;
  /**
   * P15 — Greenwater only. Backing panels for the wall plaques, emitted by the
   * course's own furniture resolver as it places them. Bitterpan authors no
   * barrier span, so it resolves no wall plaques and declares none.
   */
  readonly wallPlaqueBackings?: readonly PlaqueBackingPlacement[];
  createSampleScratch(): CourseSample;
  createProjectionScratch(): CourseProjection;
  sample(progress: number, target?: CourseSample): CourseSample;
  demoSample?(progress: number, target?: CourseSample): CourseSample;
  rivalLateralAt?(position: THREE.Vector3, progress: number): number;
  sampleAtDistance(distance: number): CourseSample;
  checkpointProgress(index: number): number;
  checkpointHalfWidth(index: number): number;
  project(
    position: THREE.Vector3,
    hintProgress: number,
    target?: CourseProjection,
  ): CourseProjection;
  turnAhead(progress: number, maximumDistance?: number, target?: TurnCue): TurnCue | null;
  fogAt(progress: number): FogProfile;
  lightingAt(progress: number): CourseLightingProfile;
  edgeType(sample: CourseSample, lateral: number): EdgeType;
  /**
   * Authored run-off at this sample and lateral. Drives the lateral clamp, the
   * grip cost of leaving the deck and the wall response, so the boundary is
   * course data rather than a rule baked into the race loop.
   */
  apronAt(
    sample: CourseSample,
    lateral: number,
    target?: ApronResolution,
  ): ApronResolution;
  surfaceGripAt(progress: number, lateral: number, halfWidth: number): number;
  cableTripSideAt(progress: number, lateral: number): -1 | 0 | 1;
  /**
   * G2 — the lateral gap to the nearest cable coil whose station the craft
   * crossed on this step, or NaN when none was crossed.
   *
   * A near miss is a thing that happens at an INSTANT: the coil goes by, or it
   * does not. Sampling "am I near a coil" every frame would pay the reward for
   * driving slowly alongside one, so the crossing is what the race loop asks
   * about. Maps with no coils return NaN, which is the same answer as "none
   * crossed" and needs no special case at the call site.
   */
  cablePassLateralMeters(
    previousProgress: number,
    progress: number,
    lateral: number,
  ): number;
  isOnBoostPad(progress: number, lateral: number, halfWidth: number): boolean;
  sectorLabelAt(progress: number): string;
  musicAt(progress: number): MusicProfile;
  /** Authored reverb room at this point on the lap. See `audio.zones` in the map. */
  audioZoneAt(progress: number): AudioZone;
  /** Optional authored flight gaps: contact shadows require an actual road. */
  travelModeAt?(progress: number): "submerged" | "surface" | "air";
  updateAtmosphere(elapsedSeconds: number, reducedMotion: boolean): boolean;
  vehicleHoverHeight(speedMetersPerSecond: number, boostActive: boolean): number;
  setCheckpointProgress(nextCheckpointIndex: number): void;
  setLapBoard(current: number, total: number): void;
  recoveryProgressFor(progress: number, previousCheckpointIndex: number): number;
  rivalGridStart(identity: string): RivalGridStart | null;
  /** The authored rival pace for this map, or null if it authors none. */
  readonly rivalPace: RivalPaceTable | null;
  /** Optional authored line around a visible obstacle; null keeps the fleet's normal line. */
  rivalHazardLaneAt?(courseDistanceMeters: number, lateralMeters: number): number | null;
  /**
   * The lateral line of the authored boost pad this course distance is running
   * up to, or null when there is none inside `approachMeters`. Rivals use it to
   * line up for a pad the way the player does; it is a pure function of the
   * course, so which pad a rival takes can never depend on the player.
   */
  boostPadLaneAt(
    courseDistanceMeters: number,
    halfWidth: number,
    approachMeters: number,
  ): number | null;
}

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const COURSE_BASIS = new THREE.Matrix4();
const COURSE_BACK = new THREE.Vector3();
const MAP = greenwaterJson as unknown as GreenwaterMapData;
const APRON = MAP.apron;
// The 30 Hz atmosphere tick and the 90 m lighting crossfade window now live in
// lighting-motion.js: the P4a key-direction sweep and hangar flicker have to
// agree with them exactly, and scripts/validate-lighting.mjs has to be able to
// import them from Node.
// The run-off tucks just under the deck edge so the seam cannot open a crack.
const APRON_SEAM_OVERLAP_METRES = 0.06;
/** Mesh-name suffix per authored edge type. `C` gained a surface in P11. */
const APRON_SURFACE_LABELS: Record<string, string> = {
  A: "gravel",
  B: "rumble",
  C: "runoff",
};
/** P11: turn guide lights hug the inside deck edge instead of the apex. */
const TURN_GUIDE_EDGE_INSET_METRES = 0.9;
// ---------------------------------------------------------------------------
// H3 — the Hangar Six steam vents.
//
// THE DEFECT. Approaching Hangar Six down the LINK_APRON the player saw "a
// small grey hexagonal lump hanging in the air over the road" and read it as an
// obstacle to steer around. It was HZ_STEAM_1's puff: a
// `DodecahedronGeometry(1, 0)` — twelve flat pentagons, no smoothing — in a
// `MeshBasicMaterial` at opacity 0.24. At 60-120 m, against the dark hangar
// interior, a flat-shaded polyhedron with a hard silhouette is a rock. Steam
// has no silhouette; that is most of what makes it read as steam.
//
// THE PUFF IS NOW A SOFT CAMERA-FACING CARD, in the living world's own
// vocabulary. Same InstancedMesh, same instance count, same 30 Hz cadence, same
// warning-lamp cycle (`validate-lighting.mjs` pins the flicker and nothing here
// touches it) — the geometry becomes one quad and the material grows a sheet
// whose alpha falls off to nothing at the rim, so the shape the player sees is
// drawn by the texture rather than by an edge.
//
// WHY A GENERATED SHEET RATHER THAN THE ATLAS CELL. The look wanted is the
// STEAM cell of `greenwater_motion_512` — the cell the accepted
// STEAM_HANGAR_VENTS living-world zone draws from 700 to 815 m, 26 m past this
// vent. But `course.ts` is built synchronously, before `scene-assets.ts` has
// loaded any atlas, and the living-world layer is optional at runtime — it
// loads last, `scene-assets.ts` catches its failure and keeps going, and
// `?living=0` hides it. A course that took its puff sheet from there would draw
// hard-edged untextured quads in exactly the cases the layer never arrived,
// which is worse than the polyhedron it replaced.
// So this follows the precedent `createGreenwaterBoostPadTexture` set directly
// above: the pinned PNG is not sampled at runtime, it is MEASURED, and the
// measurement is what is authored here. Same reason, same shape of answer.
//
// AND THE MEASUREMENT IS THE CELL'S OWN. `STEAM_CELL_RADIAL_ALPHA` below is the
// mean alpha of the STEAM cell (slot 1 of the 2x2 sheet, x 256-512, y 0-256 of
// `public/assets/greenwater/textures/greenwater_motion_512.png`) in sixteen
// equal annuli from its centre to its edge, normalised to 1. Reproduce it with:
//
//   python3 - <<'PY'
//   from PIL import Image; import math
//   cell = Image.open("public/assets/greenwater/textures/"
//                     "greenwater_motion_512.png").convert("RGBA").crop((256,0,512,256))
//   px = cell.load(); w = cell.size[0]; c = (w - 1) / 2
//   bins = [[0, 0] for _ in range(16)]
//   for y in range(w):
//       for x in range(w):
//           r = math.hypot(x - c, y - c) / (w / 2)
//           if r > 1: continue
//           i = min(15, int(r * 16)); bins[i][0] += px[x, y][3]; bins[i][1] += 1
//   print([round(s / n / 255, 3) for s, n in bins])
//   PY
//
// -> [0.967, 0.876, 0.818, 0.745, 0.663, 0.612, 0.532, 0.471,
//     0.405, 0.335, 0.287, 0.220, 0.166, 0.106, 0.061, 0.025]
//
// which is the row below divided by 0.967. The same run reports the cell 64.6%
// covered with a mean covered colour of #e7eee7 — 64.6% is the figure
// `living-world-zones.js` already quotes for this cell, which is the check that
// the crop is the cell the zones draw and not its pre-P20.8 mirror.
/**
 * The STEAM cell's measured alpha falloff, centre to rim, normalised to 1 at the
 * centre. Sixteen stops, linearly interpolated by {@link createSteamPuffTexture}.
 */
const STEAM_CELL_RADIAL_ALPHA = [
  1, 0.905, 0.846, 0.77, 0.685, 0.633, 0.55, 0.487,
  0.418, 0.346, 0.297, 0.227, 0.172, 0.11, 0.063, 0.026,
] as const;
/** The cell's own mean covered colour. The tint is the material's. */
const STEAM_CELL_COLOR = { r: 0xe7, g: 0xee, b: 0xe7 } as const;
/**
 * The tint STEAM_HANGAR_VENTS carries in `living-world-zones.js`. Applied here
 * as the material colour so the hazard vents at 674.5 / 731.5 m and the living
 * world's own steam from 700 m are the same material rather than two greys that
 * happen to be near each other.
 */
const STEAM_PUFF_TINT = 0xd8cbb2;
/**
 * THE CEILING IS ON THE PLUME, NOT ON ONE CARD, AND THAT IS THE WHOLE POINT.
 *
 * "Never opaque against any background" is a statement about the pixel the
 * player sees, and six puffs leaving 0.16 s apart with a 1.5 m/s rise stand
 * 0.24 m apart while they are 1.2-3.2 m across: they overlap almost completely,
 * and transparency composites as `1 - prod(1 - a_i)`. Six cards at a 0.45
 * envelope peak reach a MEASURED 0.857 through the middle of the plume — 86%
 * opaque, which is a grey wall with soft edges and not much better than the
 * polyhedron. The per-card number that holds the plume at 0.45 is 0.155.
 *
 * MEASURED, not reasoned: `node scripts/visual/steam-puff-stack.mjs` walks the
 * 4 s cycle in 1 ms steps and the plume's own screen plane in 25 mm (rise) by
 * 38 mm (lateral) steps, running the envelope, the rise, the growth, the
 * outboard drift and the wobble this file runs, and compositing every live card
 * through the sheet profile below.
 *
 *   peak 0.450 -> plume 0.857   peak 0.220 -> plume 0.574
 *   peak 0.180 -> plume 0.497   peak 0.155 -> plume 0.443
 *
 * `validate-lighting.mjs` re-runs that walk against these constants, so raising
 * either number fails the build rather than quietly thickening the steam.
 */
// Exported because it is the acceptance number for this repair rather than an
// implementation detail: a reviewer reads it here, and `validate-lighting.mjs`
// holds the constants below to it.
export const STEAM_PLUME_PEAK_ALPHA = 0.45;
/** Peak of ONE card's envelope. See {@link STEAM_PLUME_PEAK_ALPHA}. */
const STEAM_PUFF_PEAK_ALPHA = 0.155;
/**
 * Seconds a puff lives. The vents are authored `cycleSeconds: 4`,
 * `telegraphSeconds: 1`, and six puffs leave 0.16 s apart, so the last one is
 * born at 1.0 + 5 * 0.16 = 1.80 s and 2.1 s of life buries it 0.1 s before the
 * cycle wraps. A life longer than 2.2 s would be cut off mid-dissolve by the
 * wrap, which is the hard edge in time that the soft sheet removes in space.
 */
const STEAM_PUFF_LIFE_SECONDS = 2.1;
const STEAM_PUFFS_PER_VENT = 6;
const STEAM_PUFF_SPAWN_INTERVAL_SECONDS = 0.16;
/** Metres per second the puff climbs, and metres across as it is born / dies. */
const STEAM_PUFF_RISE_METRES_PER_SECOND = 1.5;
const STEAM_PUFF_BIRTH_METRES = 1.2;
const STEAM_PUFF_DEATH_METRES = 3.2;
/** Where the puff's centre starts, clear of the 0.41 m vent-base lip. */
const STEAM_PUFF_BASE_HEIGHT_METRES = 0.7;
/**
 * Greenwater authors no wind, so the puff leans OUTBOARD — away from the
 * corridor, the direction a vent standing 0.7 m off the deck edge would exhaust
 * anyway. It is also the drift that takes the puff away from the racing line
 * instead of across it, which is the read the defect report was about.
 */
const STEAM_PUFF_DRIFT_METRES_PER_SECOND = 0.55;
const BOOST_PAD_DISTANCES = [1705, 1815, 1925, 2035] as const;
const BOOST_PAD_HALF_LENGTH_METRES = 10;
/** Middle of the authored 0.12..0.78 half-width strip `isOnBoostPad` accepts. */
const BOOST_PAD_LANE_FRACTION = 0.45;
const GREENWATER_RIVAL_PACE = greenwaterRivalPaceJson.rivals as unknown as RivalPaceTable;
const SECTOR_LABELS: Record<string, string> = {
  RUNWAY_START: "RUNWAY 09",
  T1_CRADLE_BEND: "CRADLE BEND",
  WATER_TABLE: "WATER TABLE",
  LINK_APRON: "LINK APRON",
  HANGAR_SIX: "HANGAR SIX",
  HANGAR_EXIT: "HANGAR EXIT",
  GREENWATER_SWEEP: "GREENWATER SWEEP",
  CANOPY_PASSAGE: "CANOPY PASSAGE",
  THE_ELBOW: "THE ELBOW",
  FUEL_ROW: "FUEL ROW",
  T10_TOTEM_TURN: "TOTEM TURN",
  RUNWAY_HOME: "HOME STRAIGHT",
};
/**
 * The Greenwater boost pad's paint, generated rather than authored.
 *
 * 64 x 256, drawn once and shared by all four instances, so it costs one
 * texture and NO draw call — the pads stay a single instanced draw. The pad is
 * 4.8 m across by 18 m along (the instance scale in the roadside build), so the
 * sheet is 13.3 px/m across and 14.2 px/m along: near enough square texels.
 *
 * IN THE RUNWAY'S OWN LANGUAGE. Greenwater Strip is a runway, and
 * `greenwater_runway_1024` already carries the vocabulary a runway marks itself
 * with — THRESHOLD_BARS is eight weathered white bars running along the strip.
 * That is what a boost pad is here: a threshold marking, four bars with the
 * centre left open, not the chevron ladder Bitterpan uses. The sheet itself is
 * NOT sampled at runtime — it is hash-pinned in ATLAS_REGIONS.json and reaching
 * it from here would couple the course build to an async texture load for no
 * pixels gained. What is taken from it is its PALETTE, read off the pinned PNG:
 * the threshold bars sit at luma 230 on a transparent ground, so the bar tone
 * here is authored as a weathered off-white rather than a fresh 255.
 *
 * THE TONES ARE ABSOLUTE AND THEY WERE MEASURED. Same method as the Bitterpan
 * pad, and the same reason: this is a `MeshBasicMaterial` with
 * `toneMapped: true`, so a hex code says nothing about what lands in the frame.
 * The transfer was measured with a six-band test texture
 * (texel 40/70/100/130/170/220 -> frame 38/78/108/134/158/182, Rec.709 luma)
 * and checked against Greenwater here: the pre-P20.7 pad was a flat
 * `0xb9e62e`, luma 207, and rendered at 168-173 on the strip, which is what
 * that curve predicts (~176) minus a little sunset fog. The Greenwater deck
 * beside the four pads renders at 69.5-73.6.
 */
function createGreenwaterBoostPadTexture(): THREE.CanvasTexture {
  const width = 64;
  const height = 256;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create the Greenwater boost pad paint.");

  // The field. 88.6 luma renders at ~96, deck + 24: inside the [deck+18,
  // deck+55] the phase asks for, and warm rather than neutral because the
  // Greenwater deck is timber, not concrete — a cool grey film on it would read
  // as a plate for the same reason a teal one did on the salt pan.
  context.fillStyle = "rgb(90,88,84)";
  context.fillRect(0, 0, width, height);

  // The faint acid-green core: a 1.5 m band down the centre, and all that is
  // left of `0xb9e62e`. Boost is green on this map and has to stay green —
  // this keeps the cue without letting it be the whole surface.
  //
  // NEAR-ISO-LUMINANT WITH THE FIELD (92.5 against 88.6), so it reads as a hue
  // and adds nothing to the pad's brightness structure. That constraint is what
  // sets the colour: the first pass used rgba(78,102,52), which measured 9.9
  // HSV saturation on the frame — a green the driver cannot actually see, on
  // the map where green MEANS boost. rgb(70,104,44) is 58% saturated at the
  // same luma, so the cue comes back for free. It cannot be bought with
  // brightness instead: the open-strip pads already sit at deck+51 against a
  // deck+55 ceiling.
  const coreHalf = 10; // px, ~0.75 m each side of the centre line.
  const core = context.createLinearGradient(
    width / 2 - coreHalf,
    0,
    width / 2 + coreHalf,
    0,
  );
  core.addColorStop(0, "rgba(70,104,44,0)");
  core.addColorStop(0.5, "rgba(70,104,44,0.95)");
  core.addColorStop(1, "rgba(70,104,44,0)");
  context.fillStyle = core;
  context.fillRect(width / 2 - coreHalf, 0, coreHalf * 2, height);

  // The threshold bars: four, running the length of the pad, paired either side
  // of the core with the centre left open, which is how a real runway threshold
  // is laid out and why the marking reads as a gate to fly through rather than
  // a block to drive over.
  //
  // rgb(155,152,146) renders at ~145 — 49 above the field, so the second
  // interior tone the phase asks for (>= 18 apart) is carried by the bars. NOT
  // the sheet's own 230: at that value four bars put the pad's interior mean
  // over the deck+55 ceiling, which is the flat-bright-block failure this is
  // replacing, one tone later.
  const barPx = 6; // ~0.45 m.
  context.fillStyle = "rgb(155,152,146)";
  for (const centre of [-19.5, -12.5, 12.5, 19.5]) {
    context.fillRect(width / 2 + centre - barPx / 2, 0, barPx, height);
  }

  // The soft edge, last, over everything. 3 px is 0.23 m across and 0.21 m
  // along, inside the phase's 0.25 m ceiling. It runs to rgb(70,62,54), luma
  // 63, which renders at ~70 against a measured deck of 69.5-73.6 — so the
  // paint ends where the strip already is and the pad carries no outline.
  // Painted as an rgba gradient over an already opaque canvas, so the texture
  // stays opaque and the pad stays in the opaque pass.
  const rampPx = 3;
  /**
   * @param rect the band to paint, [x, y, w, h]
   * @param from the point on the OUTER edge, where the ramp is fully the deck
   *   value; it runs from there to `to`, where it is fully transparent and the
   *   paint below shows through unchanged.
   */
  const ramp = (
    rect: [number, number, number, number],
    from: [number, number],
    to: [number, number],
  ) => {
    const gradient = context.createLinearGradient(from[0], from[1], to[0], to[1]);
    gradient.addColorStop(0, "rgba(70,62,54,1)");
    gradient.addColorStop(1, "rgba(70,62,54,0)");
    context.fillStyle = gradient;
    context.fillRect(rect[0], rect[1], rect[2], rect[3]);
  };
  ramp([0, 0, rampPx, height], [0, 0], [rampPx, 0]);
  ramp([width - rampPx, 0, rampPx, height], [width, 0], [width - rampPx, 0]);
  ramp([0, 0, width, rampPx], [0, 0], [0, rampPx]);
  ramp([0, height - rampPx, width, rampPx], [0, height], [0, height - rampPx]);

  const texture = new THREE.CanvasTexture(canvas);
  texture.name = "greenwater_boost_pad_paint";
  texture.colorSpace = THREE.SRGBColorSpace;
  // Read from 2 m to 300 m; point-sampling four bars at that range sparkles.
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

/**
 * H3 — the steam puff sheet, generated from the STEAM cell's measured profile.
 *
 * 128 x 128 for one 1.2-3.2 m card. The STEAM cell it is measured from is
 * 256 px, but that cell is authored for the living world's 3-28 m cards; this
 * one is never wider than 3.2 m and never nearer than the deck edge, and there
 * is nothing on it sharp enough for the other 3/4 of those texels to carry.
 *
 * ALPHA IS THE WHOLE POINT. The radius runs to the quad's edge, the measured
 * falloff is 2.6% of centre at the rim, and the outer eighth carries even that
 * to zero, so the quad has no visible boundary at any alpha the envelope can
 * reach — the shape is drawn by the texture, and the geometry has no say.
 *
 * The lobes are a fixed, seedless modulation, because steam is not a perfect
 * radial gradient and six overlapping cards on a clean radial ramp read as
 * concentric rings. Held to +/-22%, which keeps the generated sheet on the
 * measured profile: its own annulus means run 0.904 / 0.831 / 0.778 / 0.726 /
 * 0.677 ... against the measured 1.000 / 0.905 / 0.846 / 0.770 / 0.685 ..., a
 * worst disagreement of 0.096 in the centre bin (fewest pixels, and where the
 * lobes bite hardest) and under 0.02 outside it.
 */
function createSteamPuffTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create the Greenwater steam puff sheet.");
  const image = context.createImageData(size, size);
  const data = image.data;
  const centre = (size - 1) / 2;
  const stops = STEAM_CELL_RADIAL_ALPHA;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x - centre) / (size / 2);
      const dy = (y - centre) / (size / 2);
      const radius = Math.hypot(dx, dy);
      let profile = 0;
      if (radius < 1) {
        // The stops are annulus means, so stop i sits at radius (i + 0.5)/16.
        const scaled = radius * stops.length - 0.5;
        const low = Math.max(0, Math.min(stops.length - 1, Math.floor(scaled)));
        const high = Math.min(stops.length - 1, low + 1);
        const blend = Math.max(0, Math.min(1, scaled - low));
        profile = stops[low] + (stops[high] - stops[low]) * blend;
        // The last stop is 2.6% of centre, not 0. Carry it to nothing over the
        // outer eighth so the disc cannot end on a step.
        if (radius > 0.875) profile *= (1 - radius) / 0.125;
      }
      const lobes = Math.sin(dx * 7.3 + 1.7) * Math.sin(dy * 6.1 - 0.9) * 0.5
        + Math.sin((dx + dy) * 11.4 + 2.3) * 0.3
        + Math.sin((dx - dy) * 4.7 - 1.1) * 0.2;
      const alpha = profile * (1 + lobes * 0.22);
      const offset = (y * size + x) * 4;
      data[offset] = STEAM_CELL_COLOR.r;
      data[offset + 1] = STEAM_CELL_COLOR.g;
      data[offset + 2] = STEAM_CELL_COLOR.b;
      data[offset + 3] = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
    }
  }
  context.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.name = "greenwater_steam_puff";
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 1;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

/**
 * H3 — the two things an InstancedMesh cannot say on its own, said once.
 *
 * 1. CAMERA-FACING. The puff has to face the player from every approach, and
 *    `updateAtmosphere(elapsedSeconds, reducedMotion)` has no camera — it is a
 *    course-interface method both maps implement, and threading a camera
 *    through it to re-orient twelve quads would put the billboard on the CPU at
 *    30 Hz for nothing. Building the quad in VIEW space instead needs no camera
 *    at all: the instance matrix places and scales the puff's centre, and the
 *    quad is spread from there along the view axes, so it is exactly screen
 *    facing on every frame including the ones between atmosphere ticks.
 * 2. PER-INSTANCE ALPHA. `InstancedMesh` carries a matrix and a colour per
 *    instance and no alpha, and the envelope this needs (0 -> 0.155 -> 0 over
 *    each puff's own life) is alpha, not colour: fading a puff by darkening it
 *    under NormalBlending turns steam into soot. One `InstancedBufferAttribute`
 *    and one multiply in the fragment stage carry it instead.
 *
 * Kept as an injection into `MeshBasicMaterial` rather than a `ShaderMaterial`
 * so the material stays an ordinary lit-by-nothing basic material for
 * `corridor-sweep.ts` (which classifies it by `transparent` + `depthWrite`),
 * for `disposeObject3DResources`, and for the `?render=ps2` treatment chain.
 */
function installSteamPuffBillboard(material: THREE.MeshBasicMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute float puffAlpha;\nvarying float vPuffAlpha;",
      )
      .replace(
        "#include <project_vertex>",
        /* glsl */`
        vPuffAlpha = puffAlpha;
        vec4 mvPosition = vec4( 0.0, 0.0, 0.0, 1.0 );
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif
        mvPosition = modelViewMatrix * mvPosition;
        #ifdef USE_INSTANCING
          mvPosition.xy += vec2(
            transformed.x * length( instanceMatrix[ 0 ].xyz ),
            transformed.y * length( instanceMatrix[ 1 ].xyz )
          );
        #else
          mvPosition.xy += transformed.xy;
        #endif
        gl_Position = projectionMatrix * mvPosition;
        `,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying float vPuffAlpha;",
      )
      .replace(
        "#include <alphamap_fragment>",
        "#include <alphamap_fragment>\ndiffuseColor.a *= vPuffAlpha;",
      );
  };
  // three keys its program cache on `onBeforeCompile.toString()` by default,
  // which is a long string recomputed per compile; this material has exactly
  // one program.
  material.customProgramCacheKey = () => "greenwater_steam_puff_billboard";
}

/**
 * P11 key/fill rebalance. The lap read flat because the hemisphere fill was
 * within a whisker of the key everywhere: nothing cast a readable form. Every
 * sector took the same ratio shift — key x1.18, hemisphere x0.82, rounded to
 * 2dp — so hue identity is untouched and only the modelling changes. Two
 * sectors are authored rather than scaled: HANGAR_SIX (key 0.85 -> 1.25,
 * hemisphere 1.00 -> 0.80, fog 0.0042 -> 0.0036) was the darkest and muddiest
 * point on the lap, and GREENWATER_SWEEP (key 1.60 -> 1.95, hemisphere
 * 1.65 -> 1.20) is where the banking needs a shadow side to read at all.
 * `RIM_PRESENCE_BOOST` in atmosphere.ts drops 1.85 -> 1.35 in the same pass;
 * the rim was standing in for the key and has to give the ratio back.
 */
const SECTOR_PALETTE_DEFINITIONS = [
  {
    sector: "RUNWAY_START",
    keyDirection: SECTOR_KEY_DIRECTIONS.RUNWAY_START,
    distance: 0,
    key: 0xf4f7f9,
    keyIntensity: 2.07,
    sky: 0xd6e0e6,
    ground: 0x4d5852,
    hemisphereIntensity: 1.19,
    fog: 0x8e9ba0,
    fogDensity: 0.0016,
  },
  {
    sector: "T1_CRADLE_BEND",
    keyDirection: SECTOR_KEY_DIRECTIONS.T1_CRADLE_BEND,
    distance: 221.998,
    key: 0xeef2ea,
    keyIntensity: 2.01,
    sky: 0xc9d6c4,
    ground: 0x475044,
    hemisphereIntensity: 1.23,
    fog: 0x8a958f,
    fogDensity: 0.0018,
  },
  {
    sector: "WATER_TABLE",
    keyDirection: SECTOR_KEY_DIRECTIONS.WATER_TABLE,
    distance: 377.997,
    key: 0xd2e2e0,
    keyIntensity: 1.77,
    sky: 0x86bab2,
    ground: 0x24403a,
    hemisphereIntensity: 1.27,
    fog: 0x7fa8a2,
    fogDensity: 0.00215,
  },
  {
    sector: "LINK_APRON",
    keyDirection: SECTOR_KEY_DIRECTIONS.LINK_APRON,
    distance: 587.996,
    key: 0xcedcd6,
    keyIntensity: 1.71,
    sky: 0x7fada6,
    ground: 0x243630,
    hemisphereIntensity: 1.19,
    fog: 0x6f938e,
    fogDensity: 0.00295,
  },
  {
    sector: "HANGAR_SIX",
    keyDirection: SECTOR_KEY_DIRECTIONS.HANGAR_SIX,
    distance: 617.996,
    key: 0xffbd63,
    keyIntensity: 1.25,
    sky: 0x6f6355,
    ground: 0x1b1a18,
    hemisphereIntensity: 0.8,
    fog: 0x3f3a34,
    fogDensity: 0.0036,
  },
  {
    sector: "HANGAR_EXIT",
    keyDirection: SECTOR_KEY_DIRECTIONS.HANGAR_EXIT,
    distance: 817.994,
    key: 0xffd08a,
    keyIntensity: 1.53,
    sky: 0x8e8371,
    ground: 0x272420,
    hemisphereIntensity: 0.98,
    fog: 0x4d4a41,
    fogDensity: 0.00355,
  },
  {
    sector: "GREENWATER_SWEEP",
    keyDirection: SECTOR_KEY_DIRECTIONS.GREENWATER_SWEEP,
    distance: 847.994,
    key: 0xe6f0d8,
    keyIntensity: 1.95,
    sky: 0x8fb8b0,
    ground: 0x25423c,
    hemisphereIntensity: 1.2,
    fog: 0x6f8a83,
    fogDensity: 0.0026,
  },
  {
    sector: "CANOPY_PASSAGE",
    keyDirection: SECTOR_KEY_DIRECTIONS.CANOPY_PASSAGE,
    distance: 1129.992,
    key: 0xffe9a8,
    keyIntensity: 1.42,
    sky: 0x7fa06a,
    ground: 0x1e3320,
    hemisphereIntensity: 1.39,
    fog: 0x51684a,
    fogDensity: 0.003,
  },
  {
    sector: "THE_ELBOW",
    keyDirection: SECTOR_KEY_DIRECTIONS.THE_ELBOW,
    distance: 1481.99,
    key: 0xf0e8b4,
    keyIntensity: 1.65,
    sky: 0x92ab7e,
    ground: 0x283a28,
    hemisphereIntensity: 1.31,
    fog: 0x60755a,
    fogDensity: 0.0027,
  },
  {
    sector: "FUEL_ROW",
    keyDirection: SECTOR_KEY_DIRECTIONS.FUEL_ROW,
    distance: 1591.989,
    key: 0xffb970,
    keyIntensity: 1.89,
    sky: 0xa8a48c,
    ground: 0x3a3428,
    hemisphereIntensity: 1.11,
    fog: 0x77776b,
    fogDensity: 0.0019,
  },
  {
    sector: "T10_TOTEM_TURN",
    keyDirection: SECTOR_KEY_DIRECTIONS.T10_TOTEM_TURN,
    distance: 2121.985,
    key: 0xd9dee4,
    keyIntensity: 1.48,
    sky: 0x77828c,
    ground: 0x22262a,
    hemisphereIntensity: 0.94,
    fog: 0x4a5358,
    fogDensity: 0.0023,
  },
  {
    sector: "RUNWAY_HOME",
    keyDirection: SECTOR_KEY_DIRECTIONS.RUNWAY_HOME,
    distance: 2255.984,
    key: 0xf4f7f9,
    keyIntensity: 2.12,
    sky: 0xd6e0e6,
    ground: 0x4d5852,
    hemisphereIntensity: 1.23,
    fog: 0x8e9ba0,
    fogDensity: 0.0016,
  },
] as const;

// The living-world review does not replace the accepted navigation rim light.
// Keep its existing color language while the reviewed palette drives the sun,
// hemisphere and fog columns above.
const RIM_LIGHTING_ZONE_DEFINITIONS = [
  {
    distance: 0,
    sky: 0xa9bbb0,
    ground: 0x10180e,
    key: 0xd8e0ca,
    rim: 0xc8ff2e,
    hemisphereIntensity: 1.65,
    keyIntensity: 2.25,
    rimIntensity: 0.65,
  },
  {
    distance: 586.519,
    sky: 0x71807c,
    ground: 0x120f0d,
    key: 0xaab5ae,
    rim: 0xff7138,
    hemisphereIntensity: 1.05,
    keyIntensity: 1.6,
    rimIntensity: 0.95,
  },
  {
    distance: 846.239,
    sky: 0xa6b79b,
    ground: 0x09150b,
    key: 0xd1debf,
    rim: 0x9aff57,
    hemisphereIntensity: 1.6,
    keyIntensity: 2.05,
    rimIntensity: 0.72,
  },
  {
    distance: 1128.982,
    sky: 0x879d7e,
    ground: 0x071008,
    key: 0xb9cda9,
    rim: 0x67d99b,
    hemisphereIntensity: 1.22,
    keyIntensity: 1.82,
    rimIntensity: 0.56,
  },
  {
    distance: 1481.152,
    sky: 0x78867a,
    ground: 0x130f0c,
    key: 0xbac4b6,
    rim: 0xff693d,
    hemisphereIntensity: 1.16,
    keyIntensity: 1.78,
    rimIntensity: 0.86,
  },
  {
    distance: 1591.107,
    sky: 0x9b9d80,
    ground: 0x16120a,
    key: 0xe1d6ae,
    rim: 0xff9a38,
    hemisphereIntensity: 1.42,
    keyIntensity: 2.08,
    rimIntensity: 0.9,
  },
  {
    distance: 2121.465,
    sky: 0x6d7978,
    ground: 0x0a0d0d,
    key: 0xafbab6,
    rim: 0xc8ff2e,
    hemisphereIntensity: 1.12,
    keyIntensity: 1.8,
    rimIntensity: 1,
  },
  {
    distance: 2254.982,
    sky: 0xa2b7ad,
    ground: 0x0d160d,
    key: 0xdbe4cf,
    rim: 0xc8ff2e,
    hemisphereIntensity: 1.72,
    keyIntensity: 2.32,
    rimIntensity: 0.78,
  },
] as const;

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x1_0000_0000;
  };
}

function poseObject(object: THREE.Object3D, sample: CourseSample): void {
  COURSE_BASIS.makeBasis(
    sample.right,
    sample.up,
    COURSE_BACK.copy(sample.tangent).multiplyScalar(-1),
  );
  object.position.copy(sample.position);
  object.quaternion.setFromRotationMatrix(COURSE_BASIS);
}

function setCourseObjectTransform(
  object: THREE.Object3D,
  sample: CourseSample,
  localX: number,
  localY: number,
  localZ: number,
  scaleX = 1,
  scaleY = 1,
  scaleZ = 1,
): void {
  poseObject(object, sample);
  object.position
    .addScaledVector(sample.right, localX)
    .addScaledVector(sample.up, localY)
    .addScaledVector(sample.tangent, -localZ);
  object.scale.set(scaleX, scaleY, scaleZ);
  object.updateMatrix();
}

/**
 * P13: every piece of edge furniture resolves through one helper, against the
 * authored apron rather than against a sector name. `furniture-placement.js`
 * owns the rule; this wrapper only supplies the corridor at `sample`.
 */
function resolveEdgeFurniture(
  sample: CourseSample,
  side: -1 | 1,
  visibleWidth: number,
  centreHeight: number,
  extentHeight: number,
  clearance: number,
): FurniturePlacement {
  return resolveFurniturePlacement({
    halfWidth: sample.halfWidth,
    apronWidth: side < 0 ? sample.apronLeft : sample.apronRight,
    side,
    clearance,
    footprintHalfWidth: visibleWidth / 2,
    centreHeight,
    extentHeight,
  });
}

/**
 * P15 — one Hangar Six backing panel, in the class its plaque belongs to plus
 * the world matrix that puts it behind that plaque.
 *
 * The matrix rather than the position: it is produced by the same
 * `setCourseObjectTransform` call the plaque uses, so the panel inherits the
 * plaque's bank, facing and station exactly instead of re-deriving them.
 */
export interface PlaqueBackingPlacement {
  klass: "chevron" | "board";
  matrix: THREE.Matrix4;
  /** Signed lateral of the panel centre; asserted by validate-furniture.mjs. */
  lateral: number;
  /** Lower edge above the deck. Flush with the plaque band, never below it. */
  bottomHeight: number;
}

/**
 * How far inside the wall line a BACKING panel sits, in metres.
 *
 * 0.06 m outboard of the plaque's own `WALL_PLAQUE_INSET_METRES`, so the plaque
 * stands proud of its backing by 60 mm. That gap is the whole effect: it is
 * what the shadow recess drawn on `hangar_fixtures_512` is there to receive.
 */
const BACKING_INSET_METRES = 0.29;
/**
 * The same 60 mm, taken along the panel's facing normal as well as across it.
 *
 * The spec expresses the offset as lateral only, but a plaque and its backing
 * both face down the course: separated only laterally they would be coplanar
 * and z-fight over the whole overlap. Setting the panel 60 mm further from the
 * viewer resolves that with the exact number the spec already names, and makes
 * "stands proud" true in the direction a player can actually see it.
 */
const BACKING_STANDOFF_METRES = 0.06;

/**
 * The authored panel sizes, read straight out of the delivery spec so the
 * runtime and `validate-art-pass.mjs` cannot disagree about them.
 */
export const PLAQUE_BACKING_CLASSES = Object.freeze(
  Object.fromEntries(
    (plaqueBackingJson.classes as ReadonlyArray<{
      id: string;
      slot: string;
      widthMetres: number;
      heightMetres: number;
      bottomHeightMetres: number;
    }>).map((entry) => [
      entry.id === "PLAQUE_BACK_CHEVRON" ? "chevron" : "board",
      Object.freeze({
        slot: entry.slot,
        width: entry.widthMetres,
        height: entry.heightMetres,
        bottomHeight: entry.bottomHeightMetres,
      }),
    ]),
  ) as Record<
    "chevron" | "board",
    { readonly slot: string; readonly width: number; readonly height: number;
      readonly bottomHeight: number }
  >,
);

function createLabelMaterial(
  text: string,
  foreground = "#c8ff2e",
  background = "#111615",
): THREE.MeshBasicMaterial {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create Greenwater sign texture.");
  context.imageSmoothingEnabled = false;
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = foreground;
  context.lineWidth = 8;
  context.strokeRect(7, 7, canvas.width - 14, canvas.height - 14);
  context.fillStyle = foreground;
  context.font = "700 66px monospace";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, canvas.width / 2, canvas.height / 2 + 4);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  return new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
}

export class GreenwaterCourse implements RaceCourse {
  readonly kind = "greenwater" as const;
  readonly group = new THREE.Group();
  readonly length = MAP.centreline.lapLength;
  readonly halfWidth = 12;
  readonly checkpointCount = MAP.checkpoints.length;
  readonly orderedCheckpointCount = MAP.checkpoints.length + 1;
  readonly defaultLapCount = MAP.race.lapCount;
  readonly minimumLapCount = MAP.race.lapCountRange[0];
  readonly maximumLapCount = MAP.race.lapCountRange[1];
  readonly mapName = MAP.map.name;
  readonly mapCode = "MAP 01";
  readonly finishName = "The Cradle";
  readonly startLabel = "RUNWAY 09";
  readonly rivalPace = GREENWATER_RIVAL_PACE;
  readonly startProgress = 0.002;
  readonly startLateral = 0;
  readonly recoveryHoldSeconds = MAP.recovery.holdSeconds;
  readonly recoverySpeedMps = MAP.recovery.reinsertSpeedKph / 3.6;
  readonly recoveryImmunitySeconds = MAP.recovery.immunitySeconds;
  /**
   * P15 — the Hangar Six plaque backings, emitted by the SAME resolver calls
   * that place the plaques.
   *
   * `HANGAR_SIX_PLAQUE_BACKING.json` is deliberately not a position list: the
   * 13 positions already exist and are resolved at runtime, and duplicating
   * them in data is exactly the second source of truth `furniture-placement.js`
   * was written to remove. So `createTurnMarkers` fills this as it runs, one
   * entry per group whose placement came back `mode === "wall"`, and
   * `plaque-backing.ts` turns the matrices into two instanced meshes once the
   * fixtures sheet has loaded. The panels cannot end up anywhere but behind the
   * plaques, because they were computed from the same `sample` and the same
   * `placement`.
   */
  readonly wallPlaqueBackings: PlaqueBackingPlacement[] = [];

  private readonly samples = MAP.centreline.samples;
  /**
   * Authored apron width and grip per side, resolved once at assembly. `sample`
   * runs several times per frame, so the per-station lookup is a table read.
   */
  private readonly apronProfiles = this.samples.map((sample) => ({
    left: resolveApronProfile(APRON, sample.edgeL, sample.sector),
    right: resolveApronProfile(APRON, sample.edgeR, sample.sector),
  }));
  private readonly projectionPoints = this.samples.map(
    (sample) => new THREE.Vector3(sample.x, sample.y, sample.z),
  );
  private readonly projectionTangents = this.projectionPoints.map((_, index) => {
    const before = this.projectionPoints[
      THREE.MathUtils.euclideanModulo(index - 1, this.projectionPoints.length)
    ];
    const after = this.projectionPoints[(index + 1) % this.projectionPoints.length];
    return after.clone().sub(before).normalize();
  });
  private readonly sampleCurvatures = this.projectionTangents.map((_, index) => {
    const sampleSpacing = this.length / this.projectionPoints.length;
    const offset = Math.max(1, Math.round(8 / sampleSpacing));
    const before = this.projectionTangents[
      THREE.MathUtils.euclideanModulo(index - offset, this.projectionTangents.length)
    ];
    const after = this.projectionTangents[
      (index + offset) % this.projectionTangents.length
    ];
    return THREE.MathUtils.clamp(
      new THREE.Vector3().crossVectors(before, after).dot(WORLD_UP) * 4,
      -1,
      1,
    );
  });
  private readonly projectionResolution = this.samples.length;
  private checkpointIndicatorMesh: THREE.InstancedMesh | null = null;
  private readonly waterHazard = MAP.hazards.find(
    (hazard) => hazard.id === "HZ_WATER_SHEET",
  );
  readonly surfaceGripRecoverySeconds = this.waterHazard?.durationSeconds ?? 0.8;
  private readonly fogProfiles = SECTOR_PALETTE_DEFINITIONS.map((zone) => ({
    distance: zone.distance,
    profile: {
      density: zone.fogDensity,
      color: new THREE.Color(zone.fog),
    },
  }));
  private readonly fogProfileScratch: FogProfile = {
    density: 0,
    color: new THREE.Color(),
  };
  private readonly lightingProfiles = SECTOR_PALETTE_DEFINITIONS.map((zone) => ({
    ...zone,
    sky: new THREE.Color(zone.sky),
    ground: new THREE.Color(zone.ground),
    key: new THREE.Color(zone.key),
  }));
  /**
   * The same 12 zones, reduced to what the key-direction crossfade needs. Kept
   * separate so the pure `lerpKeyDirection` in lighting-motion.js takes plain
   * data and stays runnable in the validator.
   */
  private readonly keyDirectionZones = SECTOR_PALETTE_DEFINITIONS.map((zone) => ({
    distance: zone.distance,
    direction: zone.keyDirection,
  }));
  readonly timeOfDayStops: readonly TimeOfDayStop[] = MAP.timeOfDay.stops;
  private readonly rimLightingProfiles = RIM_LIGHTING_ZONE_DEFINITIONS.map((zone) => ({
    distance: zone.distance,
    rim: new THREE.Color(zone.rim),
    rimIntensity: zone.rimIntensity,
  }));
  private readonly lightingProfileScratch: CourseLightingProfile = {
    sky: new THREE.Color(),
    ground: new THREE.Color(),
    key: new THREE.Color(),
    rim: new THREE.Color(),
    hemisphereIntensity: 0,
    keyIntensity: 0,
    rimIntensity: 0,
    keyDirection: new THREE.Vector3(),
  };
  private readonly cableHazards = MAP.hazards.filter(
    (hazard) => hazard.type === "cable_coil" && hazard.distance !== undefined,
  );
  private readonly steamVents: SteamVentRuntime[] = [];
  private readonly atmosphereTransform = new THREE.Object3D();
  private atmospherePreviousElapsedSeconds = -1;
  private atmosphereNextUpdateAt = 0;
  private steamPuffs: THREE.InstancedMesh | null = null;
  /** H3: the per-instance alpha envelope, which no InstancedMesh field carries. */
  private steamPuffAlpha: THREE.InstancedBufferAttribute | null = null;
  private steamWarnings: THREE.InstancedMesh | null = null;
  private cargoHookPivot: THREE.Group | null = null;
  private lapBoardTexture: THREE.CanvasTexture | null = null;
  private lapBoardContext: CanvasRenderingContext2D | null = null;

  constructor() {
    if (!MAP.centreline.closed || this.samples.length !== MAP.centreline.sampleCount) {
      throw new Error("Greenwater centreline failed its runtime invariant check.");
    }

    this.group.name = "map01_greenwater_strip";
    this.group.add(
      this.createTrackSurface(),
      this.createApronDecks(),
      this.createTrackUnderside(),
      this.createEdgeRails(),
      this.createEdgeLights(),
      this.createOpenEdgeMarkers(),
      this.createTurnGuideLights(),
      this.createTurnMarkers(),
      this.createCheckpointGates(),
      this.createStartGrid(),
      this.createHangarShell(),
      this.createHazards(),
      this.createLandmarks(),
      this.createJungleSilhouette(),
      this.createGroundPlane(),
    );
    this.setLapBoard(1, this.defaultLapCount);
    this.setCheckpointProgress(1);
  }

  createSampleScratch(): CourseSample {
    return createCourseSampleValue();
  }

  createProjectionScratch(): CourseProjection {
    return createCourseProjectionValue();
  }

  sample(
    progress: number,
    target: CourseSample = createCourseSampleValue(),
  ): CourseSample {
    const wrapped = THREE.MathUtils.euclideanModulo(progress, 1);
    const scaled = wrapped * this.samples.length;
    const index = Math.floor(scaled) % this.samples.length;
    const nextIndex = (index + 1) % this.samples.length;
    const alpha = scaled - Math.floor(scaled);
    const current = this.samples[index];
    const next = this.samples[nextIndex];
    target.position.lerpVectors(
      this.projectionPoints[index],
      this.projectionPoints[nextIndex],
      alpha,
    );
    target.tangent
      .copy(this.projectionTangents[index])
      .lerp(this.projectionTangents[nextIndex], alpha)
      .normalize();
    target.right.crossVectors(target.tangent, WORLD_UP).normalize();
    target.up.crossVectors(target.right, target.tangent).normalize();
    const bank = THREE.MathUtils.lerp(current.bank, next.bank, alpha);
    if (Math.abs(bank) > 0.001) {
      const bankRadians = THREE.MathUtils.degToRad(-bank);
      target.right.applyAxisAngle(target.tangent, bankRadians).normalize();
      target.up.applyAxisAngle(target.tangent, bankRadians).normalize();
    }

    const curvature = THREE.MathUtils.lerp(
      this.sampleCurvatures[index],
      this.sampleCurvatures[nextIndex],
      alpha,
    );
    const width = THREE.MathUtils.lerp(current.w, next.w, alpha);

    target.curvature = curvature;
    target.width = width;
    target.halfWidth = width / 2;
    target.bank = bank;
    target.sector = current.sector;
    target.edgeLeft = current.edgeL;
    target.edgeRight = current.edgeR;
    const apron = this.apronProfiles[index];
    target.apronLeft = apron.left.widthMetres;
    target.apronRight = apron.right.widthMetres;
    target.apronGripLeft = apron.left.grip;
    target.apronGripRight = apron.right.grip;
    return target;
  }

  sampleAtDistance(distance: number): CourseSample {
    return this.sample(distance / this.length);
  }

  checkpointProgress(index: number): number {
    if (index === 0) return 0;
    const checkpoint = MAP.checkpoints[index - 1];
    if (!checkpoint) throw new Error(`Unknown Greenwater checkpoint ${index}.`);
    return checkpoint.distance / this.length;
  }

  checkpointHalfWidth(index: number): number {
    if (index === 0) return MAP.startFinish.clearSpan / 2;
    const checkpoint = MAP.checkpoints[index - 1];
    if (!checkpoint) throw new Error(`Unknown Greenwater checkpoint ${index}.`);
    return checkpoint.gateWidth / 2;
  }

  project(
    position: THREE.Vector3,
    hintProgress: number,
    target: CourseProjection = createCourseProjectionValue(),
  ): CourseProjection {
    const segmentCount = this.projectionResolution;
    const hintIndex = Math.round(
      THREE.MathUtils.euclideanModulo(hintProgress, 1) * segmentCount,
    );
    const localRadius = 42;
    let nearestDistanceSq = Number.POSITIVE_INFINITY;
    let nearestProgress = hintProgress;

    const globalSearchThreshold = this.halfWidth + 24;
    const globalSearchThresholdSq = globalSearchThreshold * globalSearchThreshold;
    for (let pass = 0; pass < 2; pass += 1) {
      const globalSearch = pass === 1;
      if (globalSearch && nearestDistanceSq <= globalSearchThresholdSq) break;
      const first = globalSearch ? 0 : -localRadius;
      const last = globalSearch ? segmentCount - 1 : localRadius;
      for (let searchIndex = first; searchIndex <= last; searchIndex += 1) {
        const rawIndex = globalSearch ? searchIndex : hintIndex + searchIndex;
        const index = THREE.MathUtils.euclideanModulo(rawIndex, segmentCount);
        const nextIndex = (index + 1) % segmentCount;
        const start = this.projectionPoints[index];
        const end = this.projectionPoints[nextIndex];
        const segmentX = end.x - start.x;
        const segmentY = end.y - start.y;
        const segmentZ = end.z - start.z;
        const lengthSq = segmentX * segmentX + segmentY * segmentY + segmentZ * segmentZ;
        const along = lengthSq > 0
          ? THREE.MathUtils.clamp(
            (
              (position.x - start.x) * segmentX
              + (position.y - start.y) * segmentY
              + (position.z - start.z) * segmentZ
            ) / lengthSq,
            0,
            1,
          )
          : 0;
        const nearestX = start.x + segmentX * along;
        const nearestY = start.y + segmentY * along;
        const nearestZ = start.z + segmentZ * along;
        const differenceX = nearestX - position.x;
        const differenceY = nearestY - position.y;
        const differenceZ = nearestZ - position.z;
        const distanceSq = differenceX * differenceX
          + differenceY * differenceY
          + differenceZ * differenceZ;
        if (distanceSq >= nearestDistanceSq) continue;
        nearestDistanceSq = distanceSq;
        nearestProgress = THREE.MathUtils.euclideanModulo(
          (index + along) / segmentCount,
          1,
        );
      }
    }

    this.sample(nearestProgress, target);
    target.progress = nearestProgress;
    target.lateral = (position.x - target.position.x) * target.right.x
      + (position.y - target.position.y) * target.right.y
      + (position.z - target.position.z) * target.right.z;
    return target;
  }

  turnAhead(
    progress: number,
    maximumDistance = 240,
    target?: TurnCue,
  ): TurnCue | null {
    const distance = THREE.MathUtils.euclideanModulo(progress, 1) * this.length;
    let nearest: { turn: RawTurn; index: number; distance: number } | null = null;
    for (let index = 0; index < MAP.turns.length; index += 1) {
      const turn = MAP.turns[index];
      if (turn.radius >= 300) continue;
      const inside = distance >= turn.entryDistance && distance <= turn.exitDistance;
      const distanceAhead = inside
        ? 0
        : THREE.MathUtils.euclideanModulo(turn.entryDistance - distance, this.length);
      if (distanceAhead > maximumDistance) continue;
      if (!nearest || distanceAhead < nearest.distance) {
        nearest = { turn, index, distance: distanceAhead };
      }
    }
    if (!nearest) return null;
    const cue = target ?? {
      direction: "LEFT",
      followingDirection: null,
      distance: 0,
      hard: false,
      radius: 0,
    };
    cue.direction = nearest.turn.direction === "left" ? "LEFT" : "RIGHT";
    const followingTurn = MAP.turns[(nearest.index + 1) % MAP.turns.length];
    const followingGap = THREE.MathUtils.euclideanModulo(
      followingTurn.entryDistance - nearest.turn.exitDistance,
      this.length,
    );
    cue.followingDirection = followingGap <= 70
      && followingTurn.radius < 300
      && followingTurn.direction !== nearest.turn.direction
      ? followingTurn.direction === "left" ? "LEFT" : "RIGHT"
      : null;
    cue.distance = nearest.distance;
    cue.hard = nearest.turn.radius <= 110;
    cue.radius = nearest.turn.radius;
    return cue;
  }

  fogAt(progress: number): FogProfile {
    const distance = THREE.MathUtils.euclideanModulo(progress, 1) * this.length;
    let zoneIndex = 0;
    for (let index = 1; index < this.fogProfiles.length; index += 1) {
      if (this.fogProfiles[index].distance > distance) break;
      zoneIndex = index;
    }
    const zone = this.fogProfiles[zoneIndex];
    const next = this.fogProfiles[(zoneIndex + 1) % this.fogProfiles.length];
    const zoneEnd = zoneIndex === this.fogProfiles.length - 1
      ? this.length
      : next.distance;
    const crossfadeMetres = Math.min(MAP.fog.crossfadeMetres, zoneEnd - zone.distance);
    const crossfadeStart = zoneEnd - crossfadeMetres;
    const amount = distance <= crossfadeStart
      ? 0
      : THREE.MathUtils.smoothstep(distance, crossfadeStart, zoneEnd);
    this.fogProfileScratch.density = THREE.MathUtils.lerp(
      zone.profile.density,
      next.profile.density,
      amount,
    );
    this.fogProfileScratch.color.lerpColors(
      zone.profile.color,
      next.profile.color,
      amount,
    );
    return this.fogProfileScratch;
  }

  lightingAt(progress: number): CourseLightingProfile {
    const distance = THREE.MathUtils.euclideanModulo(progress, 1) * this.length;
    let zoneIndex = 0;
    for (let index = 1; index < this.lightingProfiles.length; index += 1) {
      if (this.lightingProfiles[index].distance > distance) break;
      zoneIndex = index;
    }
    const zone = this.lightingProfiles[zoneIndex];
    const next = this.lightingProfiles[(zoneIndex + 1) % this.lightingProfiles.length];
    const zoneEnd = zoneIndex === this.lightingProfiles.length - 1
      ? this.length
      : next.distance;
    const crossfadeStart = Math.max(zone.distance, zoneEnd - LIGHTING_CROSSFADE_METRES);
    const amount = distance <= crossfadeStart
      ? 0
      : THREE.MathUtils.smoothstep(distance, crossfadeStart, zoneEnd);
    const target = this.lightingProfileScratch;
    target.sky.lerpColors(zone.sky, next.sky, amount);
    target.ground.lerpColors(zone.ground, next.ground, amount);
    target.key.lerpColors(zone.key, next.key, amount);
    target.hemisphereIntensity = THREE.MathUtils.lerp(
      zone.hemisphereIntensity,
      next.hemisphereIntensity,
      amount,
    );
    target.keyIntensity = THREE.MathUtils.lerp(
      zone.keyIntensity,
      next.keyIntensity,
      amount,
    );
    // Direction rides the *same* crossfade window as the colours above, so the
    // sun swings and the palette changes as one move rather than two.
    lerpKeyDirection(
      this.keyDirectionZones,
      distance,
      this.length,
      target.keyDirection,
      LIGHTING_CROSSFADE_METRES,
    );

    let rimZoneIndex = 0;
    for (let index = 1; index < this.rimLightingProfiles.length; index += 1) {
      if (this.rimLightingProfiles[index].distance > distance) break;
      rimZoneIndex = index;
    }
    const rimZone = this.rimLightingProfiles[rimZoneIndex];
    const rimNext = this.rimLightingProfiles[
      (rimZoneIndex + 1) % this.rimLightingProfiles.length
    ];
    const rimZoneEnd = rimZoneIndex === this.rimLightingProfiles.length - 1
      ? this.length
      : rimNext.distance;
    const rimCrossfadeStart = Math.max(
      rimZone.distance,
      rimZoneEnd - LIGHTING_CROSSFADE_METRES,
    );
    const rimAmount = distance <= rimCrossfadeStart
      ? 0
      : THREE.MathUtils.smoothstep(distance, rimCrossfadeStart, rimZoneEnd);
    target.rim.lerpColors(rimZone.rim, rimNext.rim, rimAmount);
    target.rimIntensity = THREE.MathUtils.lerp(
      rimZone.rimIntensity,
      rimNext.rimIntensity,
      rimAmount,
    );
    return target;
  }

  edgeType(sample: CourseSample, lateral: number): EdgeType {
    return lateral >= 0 ? sample.edgeRight : sample.edgeLeft;
  }

  /**
   * P16 — the measured drivable limit for this span, or null where nothing tall
   * stands within reach.
   *
   * The distance comes off the sample when it is a `CourseProjection`, which
   * every runtime caller passes: the race loop resolves the apron from
   * `beforeMove` / `afterMove`, and the corridor sweep from its own projection.
   * A bare `CourseSample` carries no progress, so it falls back to the authored
   * width rather than guessing a distance.
   */
  /**
   * P16 — the measured drivable limit table for this map. Built once: the
   * lookup runs twice per fixed step at 120 Hz for the whole race.
   */
  private readonly drivableLimits = new DrivableLimits(
    DRIVABLE_LIMIT_TABLE,
    this.length,
  );

  private derivedLimitAt(sample: CourseSample, lateral: number): number | null {
    const progress = (sample as Partial<CourseProjection>).progress;
    if (!Number.isFinite(progress)) return null;
    return this.drivableLimits.limitAt(
      THREE.MathUtils.euclideanModulo(progress as number, 1) * this.length,
      lateral,
    );
  }

  apronAt(
    sample: CourseSample,
    lateral: number,
    target: ApronResolution = createApronResolution(),
  ): ApronResolution {
    return resolveApron(
      APRON,
      this.edgeType(sample, lateral),
      sample.sector,
      sample.halfWidth,
      lateral,
      target,
      this.derivedLimitAt(sample, lateral),
    );
  }

  surfaceGripAt(progress: number, lateral: number, halfWidth: number): number {
    const distance = THREE.MathUtils.euclideanModulo(progress, 1) * this.length;
    const water = this.waterHazard;
    if (
      water?.fromDistance !== undefined
      && water.toDistance !== undefined
      && distance >= water.fromDistance
      && distance <= water.toDistance
      && lateral < -halfWidth * 0.25
    ) {
      return water.gripMultiplier ?? 0.8;
    }
    return 1;
  }

  cableTripSideAt(progress: number, lateral: number): -1 | 0 | 1 {
    const distance = THREE.MathUtils.euclideanModulo(progress, 1) * this.length;
    for (const hazard of this.cableHazards) {
      const hazardDistance = hazard.distance ?? 0;
      const lateralOffset = hazard.lateralOffset ?? 0;
      if (isCircularHazardContact(
        distance,
        lateral,
        hazardDistance,
        lateralOffset,
        this.length,
      )) {
        return lateralOffset < 0 ? -1 : 1;
      }
    }
    return 0;
  }

  cablePassLateralMeters(
    previousProgress: number,
    progress: number,
    lateral: number,
  ): number {
    let nearest = Number.NaN;
    for (const hazard of this.cableHazards) {
      const hazardDistance = hazard.distance ?? 0;
      if (!crossedForwardProgress(
        previousProgress,
        progress,
        hazardDistance / this.length,
      )) continue;
      const gap = Math.abs(lateral - (hazard.lateralOffset ?? 0));
      if (Number.isNaN(nearest) || gap < nearest) nearest = gap;
    }
    return nearest;
  }

  isOnBoostPad(progress: number, lateral: number, halfWidth: number): boolean {
    if (lateral < halfWidth * 0.12 || lateral > halfWidth * 0.78) return false;
    const distance = THREE.MathUtils.euclideanModulo(progress, 1) * this.length;
    return BOOST_PAD_DISTANCES.some(
      (padDistance) => Math.abs(distance - padDistance) <= BOOST_PAD_HALF_LENGTH_METRES,
    );
  }

  boostPadLaneAt(
    courseDistanceMeters: number,
    halfWidth: number,
    approachMeters: number,
  ): number | null {
    const distance = THREE.MathUtils.euclideanModulo(courseDistanceMeters, this.length);
    let lane: number | null = null;
    let nearest = Infinity;
    for (const padDistance of BOOST_PAD_DISTANCES) {
      const gap = THREE.MathUtils.euclideanModulo(
        padDistance - distance + this.length / 2,
        this.length,
      ) - this.length / 2;
      if (gap > approachMeters || gap < -BOOST_PAD_HALF_LENGTH_METRES) continue;
      if (Math.abs(gap) >= nearest) continue;
      nearest = Math.abs(gap);
      // Middle of the authored strip: `isOnBoostPad` accepts 0.12..0.78 of the
      // half width, so 0.45 is the line that collects it with the most margin.
      lane = BOOST_PAD_LANE_FRACTION * halfWidth;
    }
    return lane;
  }

  sectorLabelAt(progress: number): string {
    const index = Math.floor(
      THREE.MathUtils.euclideanModulo(progress, 1) * this.samples.length,
    ) % this.samples.length;
    const sector = this.samples[index].sector;
    return SECTOR_LABELS[sector] ?? sector.replaceAll("_", " ");
  }

  musicAt(progress: number): MusicProfile {
    const distance = THREE.MathUtils.euclideanModulo(progress, 1) * this.length;
    let active = MAP.music.triggers[0];
    for (const trigger of MAP.music.triggers) {
      if (trigger.distance > distance) break;
      active = trigger;
    }
    return active.levels;
  }

  audioZoneAt(progress: number): AudioZone {
    return resolveAudioZone(
      THREE.MathUtils.euclideanModulo(progress, 1) * this.length,
      MAP.audio.zones,
      MAP.audio.defaultZone,
    ) as AudioZone;
  }

  updateAtmosphere(elapsedSeconds: number, reducedMotion: boolean): boolean {
    const elapsed = Number.isFinite(elapsedSeconds)
      ? Math.max(0, elapsedSeconds)
      : 0;
    if (elapsed < this.atmospherePreviousElapsedSeconds) {
      this.atmosphereNextUpdateAt = elapsed;
    }
    this.atmospherePreviousElapsedSeconds = elapsed;
    if (elapsed + 1e-6 < this.atmosphereNextUpdateAt) return false;
    this.atmosphereNextUpdateAt = elapsed + ATMOSPHERE_UPDATE_INTERVAL_SECONDS;

    const puffs = this.steamPuffs;
    const warnings = this.steamWarnings;
    const puffAlpha = this.steamPuffAlpha;
    if (puffs && warnings && puffAlpha) {
      const puffsPerVent = STEAM_PUFFS_PER_VENT;
      for (let ventIndex = 0; ventIndex < this.steamVents.length; ventIndex += 1) {
        const vent = this.steamVents[ventIndex];
        const cycleTime = THREE.MathUtils.euclideanModulo(
          elapsed + vent.phaseOffset,
          vent.cycleSeconds,
        );
        const warningPulse = cycleTime < vent.telegraphSeconds
          ? 0.72 + Math.sin(cycleTime * 18) * 0.18
          : 0.32;
        setCourseObjectTransform(
          this.atmosphereTransform,
          vent.sample,
          vent.lateralOffset,
          0.42,
          0,
          warningPulse,
          0.16,
          warningPulse,
        );
        warnings.setMatrixAt(ventIndex, this.atmosphereTransform.matrix);

        // H3 — one puff's life, in metres and seconds rather than multipliers.
        //
        // `age` is 0 at birth and 1 at death, and every number below is an
        // absolute a crop of the frame can be measured against: 1.2 m across
        // growing to 3.2, climbing 1.5 m/s from 0.7 m, leaning outboard at
        // 0.55 m/s, and an alpha that opens to 0.155 and closes again — with
        // the six of them together reaching 0.443 through the plume. The
        // envelope peaks at age^0.75 = 0.5, i.e. 40% of the way through, so a
        // puff arrives quickly and dissolves slowly — which is what separates
        // steam from a thing that blinks.
        const outboard = Math.sign(vent.lateralOffset) || 1;
        for (let puffIndex = 0; puffIndex < puffsPerVent; puffIndex += 1) {
          const instanceIndex = ventIndex * puffsPerVent + puffIndex;
          const ageSeconds = cycleTime
            - vent.telegraphSeconds
            - puffIndex * STEAM_PUFF_SPAWN_INTERVAL_SECONDS;
          const age = ageSeconds / STEAM_PUFF_LIFE_SECONDS;
          const active = age >= 0 && age <= 1;
          const fade = active
            ? Math.sin(Math.PI * age ** 0.75) * STEAM_PUFF_PEAK_ALPHA
            : 0;
          const width = active
            ? STEAM_PUFF_BIRTH_METRES
              + (STEAM_PUFF_DEATH_METRES - STEAM_PUFF_BIRTH_METRES) * age
            // Degenerate rather than merely transparent: a dead puff costs no
            // fill, and there is no frame on which it can be seen shrinking.
            : 0.0001;
          const lived = active ? age * STEAM_PUFF_LIFE_SECONDS : 0;
          const wobble = reducedMotion ? 0 : Math.sin(age * 8 + ventIndex) * age * 0.5;
          setCourseObjectTransform(
            this.atmosphereTransform,
            vent.sample,
            vent.lateralOffset
              + outboard * lived * STEAM_PUFF_DRIFT_METRES_PER_SECOND
              + wobble,
            STEAM_PUFF_BASE_HEIGHT_METRES
              + lived * STEAM_PUFF_RISE_METRES_PER_SECOND,
            reducedMotion ? 0 : Math.cos(age * 7 + puffIndex) * age * 0.45,
            width,
            width,
            width,
          );
          puffs.setMatrixAt(instanceIndex, this.atmosphereTransform.matrix);
          puffAlpha.setX(instanceIndex, fade);
        }
      }
      warnings.instanceMatrix.needsUpdate = true;
      puffs.instanceMatrix.needsUpdate = true;
      puffAlpha.needsUpdate = true;
    }

    if (this.cargoHookPivot) {
      const amplitude = reducedMotion ? 0.1 : 0.34;
      this.cargoHookPivot.rotation.z = Math.sin(elapsed * 1.7) * amplitude;
    }
    return true;
  }

  vehicleHoverHeight(speedMetersPerSecond: number, boostActive: boolean): number {
    // P19 hover clearance: the TOTEM stabiliser ring bottoms out 0.892 m below
    // the model origin, so anything under ~0.95 m of total hover puts the ring
    // IN the deck. Rest keeps a small skim; cruise and boost carry real air.
    const dynamicHeight = boostActive ? 0.74 : speedMetersPerSecond < 11 ? 0.3 : 0.58;
    return dynamicHeight + 0.71;
  }

  setCheckpointProgress(nextCheckpointIndex: number): void {
    const indicators = this.checkpointIndicatorMesh;
    if (!indicators) return;
    for (let index = 0; index < MAP.checkpoints.length; index += 1) {
      const checkpointIndex = index + 1;
      const color = new THREE.Color();
      if (nextCheckpointIndex === 0 || checkpointIndex < nextCheckpointIndex) {
        color.setHex(0xc8ff2e);
      } else if (checkpointIndex === nextCheckpointIndex) {
        color.setHex(0xffa22e);
      } else {
        // P11: 0x5b4528 -> 0x8a6134. Still clearly the dim state next to the
        // 0xffa22e live gate, but legible from far enough back to plan a line.
        color.setHex(0x8a6134);
      }
      for (let side = 0; side < 2; side += 1) {
        indicators.setColorAt(index * 2 + side, color);
      }
    }
    if (indicators.instanceColor) indicators.instanceColor.needsUpdate = true;
  }

  setLapBoard(current: number, total: number): void {
    const context = this.lapBoardContext;
    if (!context || !this.lapBoardTexture) return;
    context.fillStyle = "#0d1210";
    context.fillRect(0, 0, 512, 192);
    context.strokeStyle = "#c8ff2e";
    context.lineWidth = 10;
    context.strokeRect(7, 7, 498, 178);
    context.fillStyle = "#c8ff2e";
    context.font = "700 68px monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(`LAP ${Math.min(current, total)}/${total}`, 256, 86);
    context.fillStyle = "#89978f";
    context.font = "600 24px monospace";
    context.fillText("GREENWATER STRIP", 256, 145);
    this.lapBoardTexture.needsUpdate = true;
  }

  recoveryProgressFor(_progress: number, previousCheckpointIndex: number): number {
    return THREE.MathUtils.euclideanModulo(
      this.checkpointProgress(previousCheckpointIndex) + 0.004,
      1,
    );
  }

  rivalGridStart(_identity: string): RivalGridStart | null {
    return null;
  }

  private createTrackSurface(): THREE.Mesh {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const sectorColors: Record<string, THREE.Color> = {
      RUNWAY_START: new THREE.Color(0x303331),
      T1_CRADLE_BEND: new THREE.Color(0x252d2a),
      WATER_TABLE: new THREE.Color(0x263433),
      LINK_APRON: new THREE.Color(0x2c302e),
      HANGAR_SIX: new THREE.Color(0x242522),
      HANGAR_EXIT: new THREE.Color(0x292b28),
      GREENWATER_SWEEP: new THREE.Color(0x233029),
      CANOPY_PASSAGE: new THREE.Color(0x202b24),
      THE_ELBOW: new THREE.Color(0x2d302a),
      FUEL_ROW: new THREE.Color(0x302f27),
      T10_TOTEM_TURN: new THREE.Color(0x332d27),
      RUNWAY_HOME: new THREE.Color(0x303331),
    };

    for (let index = 0; index < this.samples.length; index += 1) {
      const progress = index / this.samples.length;
      const sample = this.sample(progress);
      const baseColor = sectorColors[sample.sector] ?? new THREE.Color(0x28302c);
      const shade = index % 18 < 9 ? 0.93 : 1;
      for (const side of [-1, 1]) {
        const point = sample.position.clone().addScaledVector(sample.right, side * sample.halfWidth);
        positions.push(point.x, point.y, point.z);
        normals.push(sample.up.x, sample.up.y, sample.up.z);
        uvs.push(side < 0 ? 0 : 1, this.samples[index].d / 8);
        colors.push(baseColor.r * shade, baseColor.g * shade, baseColor.b * shade);
      }
      const next = (index + 1) % this.samples.length;
      const offset = index * 2;
      const nextOffset = next * 2;
      indices.push(offset, nextOffset, offset + 1, nextOffset, nextOffset + 1, offset + 1);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true }),
    );
    mesh.name = "greenwater_surface";
    mesh.receiveShadow = true;
    return mesh;
  }

  /**
   * The authored run-off, merged into one mesh per apron surface so the whole
   * boundary removal costs two draw calls.
   *
   * The two surfaces must be told apart without relying on colour, so they
   * differ in three colour-free channels at once: cross-section (the gravel
   * shoulder falls away from the deck, the rumble strip steps up), band pitch
   * (a 10 m irregular mottle against hard 2 m transverse bars) and contrast
   * (a shallow ramp against a near-black/near-white alternation). Both also
   * darken outward, so the deck edge stays the brightest line in the frame.
   */
  private createApronDecks(): THREE.Group {
    const group = new THREE.Group();
    group.name = "greenwater_aprons";
    const surfaces: Array<{
      type: EdgeType;
      color: THREE.Color;
      outerRise: number;
      innerDrop: number;
    }> = [
      {
        type: "A",
        outerRise: APRON_EDGE_CROSS_SECTION.A.outerRise,
        color: new THREE.Color(0x4a4c42),
        innerDrop: APRON_EDGE_CROSS_SECTION.A.innerDrop,
      },
      {
        type: "B",
        color: new THREE.Color(0x565954),
        outerRise: APRON_EDGE_CROSS_SECTION.B.outerRise,
        innerDrop: APRON_EDGE_CROSS_SECTION.B.innerDrop,
      },
      {
        type: "C",
        color: new THREE.Color(0x424a45),
        outerRise: APRON_EDGE_CROSS_SECTION.C.outerRise,
        innerDrop: APRON_EDGE_CROSS_SECTION.C.innerDrop,
      },
    ];
    // One material for all three strips: they differ only in vertex colour and
    // cross-section, so sharing it keeps the run-off at one compiled program
    // (and one PS2 shader variant) however many edge types exist.
    const apronMaterial = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    for (const surface of surfaces) {
      const positions: number[] = [];
      const normals: number[] = [];
      const colors: number[] = [];
      const indices: number[] = [];
      for (let index = 0; index < this.samples.length; index += 1) {
        const nextIndex = (index + 1) % this.samples.length;
        for (const side of [-1, 1] as const) {
          const raw = this.samples[index];
          const nextRaw = this.samples[nextIndex];
          const edge = side < 0 ? raw.edgeL : raw.edgeR;
          if (edge !== surface.type) continue;
          const profile = side < 0
            ? this.apronProfiles[index].left
            : this.apronProfiles[index].right;
          if (profile.widthMetres <= 0) continue;
          const nextEdge = side < 0 ? nextRaw.edgeL : nextRaw.edgeR;
          const nextProfile = side < 0
            ? this.apronProfiles[nextIndex].left
            : this.apronProfiles[nextIndex].right;
          // Taper to nothing where the authored edge type changes, so the two
          // surfaces never overlap at a sector seam.
          const nextWidth = nextEdge === surface.type
            ? nextProfile.widthMetres
            : -APRON_SEAM_OVERLAP_METRES;
          const current = this.sample(index / this.samples.length);
          const next = this.sample(nextIndex / this.samples.length);
          // Three colour-free treatments: A mottles on a 10 m irregular pitch,
          // B alternates hard 2 m bars, C hatches on a 4 m pitch at half B's
          // contrast — one station is ~2 m, so `index >> 1` is the 4 m bar.
          const band = surface.type === "B"
            ? (index % 2 === 0 ? 1 : 0.42)
            : surface.type === "C"
              ? (Math.floor(index / 2) % 2 === 0 ? 1 : 0.72)
              : 0.86 + 0.14 * (((index * 7 + (side < 0 ? 3 : 0)) % 5) / 4);
          const outerShade = surface.type === "B"
            ? 0.9
            : surface.type === "C"
              ? 0.7
              : 0.74;
          const offset = positions.length / 3;
          const corners = [
            { sample: current, width: -APRON_SEAM_OVERLAP_METRES, shade: 1 },
            { sample: next, width: -APRON_SEAM_OVERLAP_METRES, shade: 1 },
            { sample: current, width: profile.widthMetres, shade: outerShade },
            { sample: next, width: nextWidth, shade: outerShade },
          ];
          for (const corner of corners) {
            const outward = corner.width > 0;
            const point = corner.sample.position
              .clone()
              .addScaledVector(
                corner.sample.right,
                side * (corner.sample.halfWidth + corner.width),
              )
              .addScaledVector(
                corner.sample.up,
                outward
                  ? surface.outerRise * (corner.width / profile.widthMetres)
                  : -surface.innerDrop,
              );
            positions.push(point.x, point.y, point.z);
            normals.push(
              corner.sample.up.x,
              corner.sample.up.y,
              corner.sample.up.z,
            );
            const shade = band * corner.shade;
            colors.push(
              surface.color.r * shade,
              surface.color.g * shade,
              surface.color.b * shade,
            );
          }
          if (side < 0) {
            indices.push(offset, offset + 2, offset + 1, offset + 1, offset + 2, offset + 3);
          } else {
            indices.push(offset, offset + 1, offset + 2, offset + 1, offset + 3, offset + 2);
          }
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      // Shared with the deck: the run-off is lit as ground, so the shallow
      // camber never reads as a differently lit material.
      geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      geometry.setIndex(indices);
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, apronMaterial);
      mesh.name = `apron_${surface.type}_${APRON_SURFACE_LABELS[surface.type]}`;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    return group;
  }

  private createTrackUnderside(): THREE.Mesh {
    const positions: number[] = [];
    const indices: number[] = [];
    for (let index = 0; index < this.samples.length; index += 1) {
      const sample = this.sample(index / this.samples.length);
      for (const side of [-1, 1]) {
        const point = sample.position
          .clone()
          .addScaledVector(sample.right, side * (sample.halfWidth + 0.4))
          .addScaledVector(sample.up, -0.55);
        positions.push(point.x, point.y, point.z);
      }
      const next = (index + 1) % this.samples.length;
      const offset = index * 2;
      const nextOffset = next * 2;
      indices.push(offset, offset + 1, nextOffset, nextOffset, offset + 1, nextOffset + 1);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshLambertMaterial({ color: 0x0c1310, side: THREE.DoubleSide }),
    );
    mesh.name = "greenwater_understructure";
    return mesh;
  }

  private createEdgeRails(): THREE.Group {
    const group = new THREE.Group();
    group.name = "greenwater_barriers";
    const types: Array<{ type: EdgeType; height: number; color: number }> = [
      { type: "A", height: 1.1, color: 0x1b2420 },
      { type: "B", height: 2.4, color: 0x262724 },
    ];
    for (const side of [-1, 1]) {
      for (const definition of types) {
        const positions: number[] = [];
        const indices: number[] = [];
        for (let index = 0; index < this.samples.length; index += 1) {
          const raw = this.samples[index];
          const edge = side < 0 ? raw.edgeL : raw.edgeR;
          if (edge !== definition.type) continue;
          const nextIndex = (index + 1) % this.samples.length;
          const current = this.sample(index / this.samples.length);
          const next = this.sample(nextIndex / this.samples.length);
          // The barrier stands at the far side of the authored run-off, which
          // is where the clamp now is. Where no apron is authored (the hangar
          // interior) the offset stays zero and the wall does not move.
          const currentApron = side < 0 ? current.apronLeft : current.apronRight;
          const nextApron = side < 0 ? next.apronLeft : next.apronRight;
          const currentBottom = current.position
            .clone()
            .addScaledVector(current.right, side * (current.halfWidth + currentApron))
            .addScaledVector(current.up, 0.03);
          const nextBottom = next.position
            .clone()
            .addScaledVector(next.right, side * (next.halfWidth + nextApron))
            .addScaledVector(next.up, 0.03);
          const currentTop = currentBottom.clone().addScaledVector(current.up, definition.height);
          const nextTop = nextBottom.clone().addScaledVector(next.up, definition.height);
          const offset = positions.length / 3;
          for (const point of [currentBottom, nextBottom, currentTop, nextTop]) {
            positions.push(point.x, point.y, point.z);
          }
          indices.push(offset, offset + 1, offset + 2, offset + 1, offset + 3, offset + 2);
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        const rail = new THREE.Mesh(
          geometry,
          new THREE.MeshLambertMaterial({ color: definition.color, side: THREE.DoubleSide }),
        );
        rail.name = `barrier_${definition.type}_${side < 0 ? "left" : "right"}`;
        group.add(rail);
      }
    }
    return group;
  }

  private createEdgeLights(): THREE.Group {
    const group = new THREE.Group();
    group.name = "greenwater_route_lights";
    const geometry = new THREE.BoxGeometry(0.18, 0.12, 1.8);
    // P11: emissive read. AgX rolls a saturated marker toward grey; opting
    // out of tone mapping lets the route lights clip to glow instead.
    const material = new THREE.MeshBasicMaterial({
      color: 0xc8ff2e,
      toneMapped: false,
    });
    const capacity = Math.ceil(this.samples.length / 6) * 2;
    const lights = new THREE.InstancedMesh(geometry, material, capacity);
    const marker = new THREE.Object3D();
    let count = 0;
    for (let index = 0; index < this.samples.length; index += 6) {
      const sample = this.sample(index / this.samples.length);
      for (const side of [-1, 1]) {
        poseObject(marker, sample);
        marker.position.addScaledVector(sample.right, side * (sample.halfWidth - 0.14));
        marker.position.addScaledVector(sample.up, 0.12);
        marker.updateMatrix();
        lights.setMatrixAt(count, marker.matrix);
        count += 1;
      }
    }
    lights.count = count;
    lights.instanceMatrix.needsUpdate = true;
    lights.frustumCulled = false;
    group.add(lights);
    return group;
  }

  private createOpenEdgeMarkers(): THREE.Group {
    const group = new THREE.Group();
    group.name = "greenwater_open_edge_markers";
    const markerGeometry = new THREE.BoxGeometry(0.28, 1.4, 0.28);
    const markerMaterial = new THREE.MeshBasicMaterial({
      color: 0xff5a3c,
      toneMapped: false,
    });
    const markers = new THREE.InstancedMesh(
      markerGeometry,
      markerMaterial,
      this.samples.length,
    );
    const stripGeometry = new THREE.BoxGeometry(0.58, 0.06, 4.2);
    const stripMaterial = new THREE.MeshBasicMaterial({
      color: 0xff8a2e,
      toneMapped: false,
    });
    const warningStrips = new THREE.InstancedMesh(
      stripGeometry,
      stripMaterial,
      this.samples.length,
    );
    const object = new THREE.Object3D();
    let count = 0;
    let stripCount = 0;
    for (let index = 0; index < this.samples.length; index += 4) {
      const raw = this.samples[index];
      const sample = this.sample(index / this.samples.length);
      for (const side of [-1, 1]) {
        const edge = side < 0 ? raw.edgeL : raw.edgeR;
        if (edge !== "C") continue;
        poseObject(object, sample);
        object.position.addScaledVector(sample.right, side * (sample.halfWidth - 0.2));
        object.position.addScaledVector(sample.up, 0.09);
        object.updateMatrix();
        warningStrips.setMatrixAt(stripCount, object.matrix);
        stripCount += 1;

        if (index % 8 !== 0) continue;
        poseObject(object, sample);
        object.position.addScaledVector(sample.right, side * (sample.halfWidth + 5.8));
        object.position.addScaledVector(sample.up, 0.7);
        object.updateMatrix();
        markers.setMatrixAt(count, object.matrix);
        count += 1;
      }
    }
    markers.count = count;
    markers.instanceMatrix.needsUpdate = true;
    warningStrips.count = stripCount;
    warningStrips.instanceMatrix.needsUpdate = true;
    group.add(warningStrips, markers);
    return group;
  }

  private createTurnGuideLights(): THREE.InstancedMesh {
    const guidedTurns = MAP.turns.filter((turn) => turn.radius < 300);
    const spacingMetres = 7;
    const markerCount = guidedTurns.reduce(
      (total, turn) => total + Math.floor(
        (turn.exitDistance - turn.entryDistance) / spacingMetres,
      ) + 1,
      0,
    );
    const markers = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffa22e, toneMapped: false }),
      markerCount,
    );
    markers.name = "greenwater_turn_vector_lights";
    const marker = new THREE.Object3D();
    let markerIndex = 0;
    for (const turn of guidedTurns) {
      const inside = turn.direction === "left" ? -1 : 1;
      for (
        let distance = turn.entryDistance;
        distance <= turn.exitDistance + 0.001;
        distance += spacingMetres
      ) {
        const sample = this.sampleAtDistance(distance);
        // P11: these sat at 0.68 of the half-width — on the racing line, where
        // a 1.55 m slab reads as an obstacle to drive around. Moved to the
        // inside edge and shrunk, they become a runway-style guidance line.
        setCourseObjectTransform(
          marker,
          sample,
          inside * (sample.halfWidth - TURN_GUIDE_EDGE_INSET_METRES),
          0.085,
          0,
          0.24,
          0.04,
          0.9,
        );
        markers.setMatrixAt(markerIndex, marker.matrix);
        markerIndex += 1;
      }
    }
    markers.count = markerIndex;
    markers.instanceMatrix.needsUpdate = true;
    return markers;
  }

  /**
   * P15 — records the backing panel for one plaque, and only for a plaque.
   *
   * A verge placement returns early: on a verge the sign stands on a post in
   * the open and there is nothing to bolt it to. `plaqueZ` is the plaque's own
   * offset along the course (0 for a chevron face, 0.08 for a braking board
   * label); the panel sits `BACKING_STANDOFF_METRES` behind whatever that is.
   *
   * The panel grows UPWARD only, from a lower edge flush with the plaque band.
   * A symmetric margin would hang structure over the deck under the band, which
   * is the precise failure P13 was written to close.
   */
  private recordPlaqueBacking(
    placement: FurniturePlacement,
    sample: CourseSample,
    klass: "chevron" | "board",
    side: -1 | 1,
    plaqueZ: number,
  ): void {
    if (placement.mode !== "wall") return;
    const backing = PLAQUE_BACKING_CLASSES[klass];
    const lateral = side * Math.max(0, sample.halfWidth - BACKING_INSET_METRES);
    const centreHeight = backing.bottomHeight + backing.height / 2;
    const object = new THREE.Object3D();
    setCourseObjectTransform(
      object,
      sample,
      lateral,
      centreHeight,
      plaqueZ - BACKING_STANDOFF_METRES,
      backing.width,
      backing.height,
      1,
    );
    this.wallPlaqueBackings.push({
      klass,
      matrix: object.matrix.clone(),
      lateral,
      bottomHeight: backing.bottomHeight,
    });
  }

  private createTurnMarkers(): THREE.Group {
    const group = new THREE.Group();
    group.name = "greenwater_turn_grammar";
    const cubeGeometry = new THREE.BoxGeometry(1, 1, 1);
    // Chevron faces only need to read on approach. A one-sided plane removes
    // the large blank backside after TOTEM passes without changing the arrow,
    // placement, scale, or accepted braking-distance language.
    const boardFaceGeometry = new THREE.PlaneGeometry(1, 1);
    const chevronBoardWidth = 3;
    const chevronBoardHeight = 1.45;
    const distanceBoardWidth = 1.7 * 1.45;
    const boardMaterial = new THREE.MeshLambertMaterial({ color: 0x1b201d });
    const postMaterial = new THREE.MeshLambertMaterial({ color: 0x333a35 });
    const arrowMaterial = new THREE.MeshBasicMaterial({ color: 0xffa22e, side: THREE.DoubleSide });
    const arrowShape = new THREE.Shape();
    arrowShape.moveTo(-1.25, -0.22);
    arrowShape.lineTo(0.25, -0.22);
    arrowShape.lineTo(0.25, -0.58);
    arrowShape.lineTo(1.28, 0);
    arrowShape.lineTo(0.25, 0.58);
    arrowShape.lineTo(0.25, 0.22);
    arrowShape.lineTo(-1.25, 0.22);
    arrowShape.closePath();
    const arrowGeometry = new THREE.ShapeGeometry(arrowShape);
    const chevronCount = MAP.turns.reduce((total, turn) => total + turn.chevronCount, 0);
    const boardCount = MAP.turns.reduce((total, turn) => total + turn.boards.length, 0);
    const chevronBoards = new THREE.InstancedMesh(
      boardFaceGeometry,
      boardMaterial,
      chevronCount,
    );
    const chevronPosts = new THREE.InstancedMesh(
      cubeGeometry,
      postMaterial,
      chevronCount,
    );
    const chevronArrows = new THREE.InstancedMesh(
      arrowGeometry,
      arrowMaterial,
      chevronCount,
    );
    const approachArrows = new THREE.InstancedMesh(
      arrowGeometry,
      arrowMaterial,
      boardCount,
    );
    const boardLabels = new Map<number, { mesh: THREE.InstancedMesh; count: number }>();
    for (const distanceMetres of new Set(MAP.turns.flatMap((turn) => turn.boards))) {
      boardLabels.set(distanceMetres, {
        mesh: new THREE.InstancedMesh(
          boardFaceGeometry,
          createLabelMaterial(`${distanceMetres}M`, "#ffa22e"),
          boardCount,
        ),
        count: 0,
      });
    }
    const object = new THREE.Object3D();
    let chevronIndex = 0;
    let postIndex = 0;
    let approachIndex = 0;

    for (const turn of MAP.turns) {
      const outside = turn.direction === "left" ? 1 : -1;
      for (let index = 0; index < turn.chevronCount; index += 1) {
        const markerDistance = turn.apexDistance + (index - (turn.chevronCount - 1) / 2) * 7;
        const sample = this.sampleAtDistance(markerDistance);
        // These panels repeat around bends. The structural gap keeps their
        // projected silhouettes out of the route opening, even when several
        // boards stack in the chase camera through a fast chicane. Inside the
        // hangar there is no verge at all, so the panel becomes a wall plaque
        // and the post that would have held it up is dropped — it would have
        // been a 2.1 m pole standing on the racing surface.
        const placement = resolveEdgeFurniture(
          sample,
          outside,
          chevronBoardWidth,
          2.3,
          chevronBoardHeight,
          TURN_CHEVRON_CLEARANCE_METRES,
        );
        const markerX = placement.lateral;
        setCourseObjectTransform(
          object,
          sample,
          markerX,
          placement.centreHeight,
          0,
          chevronBoardWidth,
          chevronBoardHeight,
          0.24,
        );
        chevronBoards.setMatrixAt(chevronIndex, object.matrix);
        // P15: a wall plaque is bolted to an open pillar frame with nothing
        // behind it. Emitted here, from this resolver call, so the panel and
        // the plaque can never be placed against different corridors.
        this.recordPlaqueBacking(placement, sample, "chevron", outside, 0);
        if (placement.groundMounted) {
          setCourseObjectTransform(object, sample, markerX, 1.05, 0.08, 0.18, 2.1, 0.18);
          chevronPosts.setMatrixAt(postIndex, object.matrix);
          postIndex += 1;
        }
        setCourseObjectTransform(
          object,
          sample,
          markerX,
          placement.centreHeight,
          0.14,
          turn.direction === "left" ? -1 : 1,
          1,
          1,
        );
        chevronArrows.setMatrixAt(chevronIndex, object.matrix);
        chevronIndex += 1;
      }

      for (const boardDistance of turn.boards) {
        const distance = THREE.MathUtils.euclideanModulo(
          turn.entryDistance - boardDistance,
          this.length,
        );
        const sample = this.sampleAtDistance(distance);
        const side = turn.direction === "left" ? 1 : -1;
        const placement = resolveEdgeFurniture(
          sample,
          side,
          distanceBoardWidth,
          2.05,
          1.28,
          EDGE_FURNITURE_CLEARANCE_METRES,
        );
        const markerX = placement.lateral;
        const labelBatch = boardLabels.get(boardDistance);
        if (!labelBatch) {
          throw new Error(`Missing Greenwater braking-board label ${boardDistance}M.`);
        }
        setCourseObjectTransform(
          object,
          sample,
          markerX,
          placement.centreHeight,
          0.08,
          distanceBoardWidth,
          1.28,
          1,
        );
        labelBatch.mesh.setMatrixAt(labelBatch.count, object.matrix);
        labelBatch.count += 1;
        this.recordPlaqueBacking(placement, sample, "board", side, 0.08);
        // The low approach arrow is deck paint standing on end. It belongs in
        // front of a board on a verge; on a wall plaque it is an arrow lying in
        // the road, so a barrier span drops it entirely.
        if (placement.groundMounted) {
          setCourseObjectTransform(
            object,
            sample,
            markerX,
            0.62,
            0.1,
            turn.direction === "left" ? -0.78 : 0.78,
            0.58,
            0.58,
          );
          approachArrows.setMatrixAt(approachIndex, object.matrix);
          approachIndex += 1;
        }
      }
    }
    chevronPosts.count = postIndex;
    approachArrows.count = approachIndex;
    for (const mesh of [chevronBoards, chevronPosts, chevronArrows, approachArrows]) {
      mesh.instanceMatrix.needsUpdate = true;
    }
    for (const batch of boardLabels.values()) {
      batch.mesh.count = batch.count;
      batch.mesh.instanceMatrix.needsUpdate = true;
      group.add(batch.mesh);
    }
    group.add(chevronBoards, chevronPosts, chevronArrows, approachArrows);
    return group;
  }

  private createCheckpointGates(): THREE.Group {
    const group = new THREE.Group();
    group.name = "greenwater_gates";
    group.add(this.createFinishGate());
    const cubeGeometry = new THREE.BoxGeometry(1, 1, 1);
    const labelGeometry = new THREE.PlaneGeometry(1, 1);
    const postMaterial = new THREE.MeshLambertMaterial({ color: 0x28312d });
    const postCount = MAP.checkpoints.length * 2;
    const posts = new THREE.InstancedMesh(cubeGeometry, postMaterial, postCount);
    const indicators = new THREE.InstancedMesh(
      cubeGeometry,
      new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
      postCount,
    );
    const object = new THREE.Object3D();
    for (let checkpointIndex = 0; checkpointIndex < MAP.checkpoints.length; checkpointIndex += 1) {
      const checkpoint = MAP.checkpoints[checkpointIndex];
      const sample = this.sampleAtDistance(checkpoint.distance);
      const labels = new THREE.InstancedMesh(
        labelGeometry,
        createLabelMaterial(checkpoint.index.toString().padStart(2, "0"), "#ffa22e"),
        2,
      );
      labels.name = `${checkpoint.id}_label`;
      labels.userData.name = checkpoint.name;
      for (let sideIndex = 0; sideIndex < 2; sideIndex += 1) {
        const side = sideIndex === 0 ? -1 : 1;
        const instanceIndex = checkpointIndex * 2 + sideIndex;
        // The gate half-width is authored, but the deck is not constant, so a
        // gate narrower than the road it crosses would stand its masts on the
        // racing surface. The deck edge is the floor.
        const x = resolveGatePostLateral(
          sample.halfWidth,
          checkpoint.gateWidth / 2 + 0.7,
          side,
        );
        setCourseObjectTransform(
          object,
          sample,
          x,
          checkpoint.mastHeight / 2,
          0,
          0.55,
          checkpoint.mastHeight,
          0.55,
        );
        posts.setMatrixAt(instanceIndex, object.matrix);
        setCourseObjectTransform(
          object,
          sample,
          x,
          checkpoint.mastHeight - 2,
          0,
          0.78,
          3.2,
          0.72,
        );
        indicators.setMatrixAt(instanceIndex, object.matrix);
        setCourseObjectTransform(
          object,
          sample,
          x,
          checkpoint.mastHeight - 0.9,
          0.38,
          1.9,
          1.2,
          1,
        );
        labels.setMatrixAt(sideIndex, object.matrix);
      }
      labels.instanceMatrix.needsUpdate = true;
      group.add(labels);
    }
    posts.instanceMatrix.needsUpdate = true;
    indicators.instanceMatrix.needsUpdate = true;
    this.checkpointIndicatorMesh = indicators;
    group.add(posts, indicators);
    return group;
  }

  private createFinishGate(): THREE.Group {
    const sample = this.sample(0);
    const gate = new THREE.Group();
    gate.name = "SF_THE_CRADLE";
    poseObject(gate, sample);
    const span = MAP.startFinish.clearSpan;
    const height = MAP.startFinish.structureHeight;
    const structure = new THREE.MeshLambertMaterial({ color: 0x252e2a });
    const acid = new THREE.MeshBasicMaterial({ color: 0xc8ff2e, toneMapped: false });
    const amber = new THREE.MeshBasicMaterial({ color: 0xffa22e, toneMapped: false });
    for (const side of [-1, 1]) {
      const column = new THREE.Mesh(new THREE.BoxGeometry(1.2, height, 1.2), structure);
      column.position.set(side * span / 2, height / 2, 0);
      const vertical = new THREE.Mesh(new THREE.BoxGeometry(0.34, height - 4, 1.3), acid);
      vertical.position.set(side * span / 2, height / 2, 0.72);
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.65, 8, 6), amber);
      beacon.position.set(side * span / 2, height + 1.1, 0);
      gate.add(column, vertical, beacon);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span + 1.2, 1.3, 1.4), structure);
    beam.position.y = height - 0.65;
    gate.add(beam);
    const stripeGeometry = new THREE.BoxGeometry(1.05, 0.42, 1.5);
    const acidStripes = new THREE.InstancedMesh(stripeGeometry, acid, 16);
    const amberStripes = new THREE.InstancedMesh(stripeGeometry, amber, 16);
    const stripeObject = new THREE.Object3D();
    let acidIndex = 0;
    let amberIndex = 0;
    for (let index = -15; index <= 15; index += 1) {
      stripeObject.position.set(index * 1.08, height - 0.65, 0.9);
      stripeObject.updateMatrix();
      if (index % 2 === 0) {
        acidStripes.setMatrixAt(acidIndex, stripeObject.matrix);
        acidIndex += 1;
      } else {
        amberStripes.setMatrixAt(amberIndex, stripeObject.matrix);
        amberIndex += 1;
      }
    }
    acidStripes.count = acidIndex;
    amberStripes.count = amberIndex;
    acidStripes.instanceMatrix.needsUpdate = true;
    amberStripes.instanceMatrix.needsUpdate = true;
    gate.add(acidStripes, amberStripes);

    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 192;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not create The Cradle lap board.");
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    this.lapBoardContext = context;
    this.lapBoardTexture = texture;
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(9.5, 3.55),
      new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }),
    );
    board.position.set(0, height - 3.2, 0.82);
    gate.add(board);
    return gate;
  }

  private createStartGrid(): THREE.Group {
    const group = new THREE.Group();
    group.name = "greenwater_start_grid";
    const acid = new THREE.MeshBasicMaterial({ color: 0xc8ff2e, toneMapped: false });
    const white = new THREE.MeshBasicMaterial({ color: 0xb9c1bb, toneMapped: false });
    const cubeGeometry = new THREE.BoxGeometry(1, 1, 1);
    const capacity = 64;
    const acidMarkers = new THREE.InstancedMesh(cubeGeometry, acid, capacity);
    const whiteMarkers = new THREE.InstancedMesh(cubeGeometry, white, capacity);
    const counts = new Map<THREE.InstancedMesh, number>([
      [acidMarkers, 0],
      [whiteMarkers, 0],
    ]);
    const addMarker = (
      mesh: THREE.InstancedMesh,
      object: THREE.Object3D,
    ): void => {
      const index = counts.get(mesh) ?? 0;
      mesh.setMatrixAt(index, object.matrix);
      counts.set(mesh, index + 1);
    };
    const object = new THREE.Object3D();
    const chequerSample = this.sample(0);
    for (let row = -2; row <= 2; row += 1) {
      for (let column = -11; column <= 11; column += 1) {
        setCourseObjectTransform(object, chequerSample, column, 0.05, row, 1, 0.035, 1);
        addMarker((row + column) % 2 === 0 ? whiteMarkers : acidMarkers, object);
      }
    }

    for (let index = 0; index < MAP.startFinish.gridPads; index += 1) {
      const distance = THREE.MathUtils.euclideanModulo(
        MAP.startFinish.gridOffset + index * 9,
        this.length,
      );
      const sample = this.sampleAtDistance(distance);
      setCourseObjectTransform(
        object,
        sample,
        index % 2 === 0 ? -3.2 : 3.2,
        0.055,
        0,
        3.3,
        0.04,
        5.4,
      );
      addMarker(index % 2 === 0 ? acidMarkers : whiteMarkers, object);
    }
    for (const mesh of [acidMarkers, whiteMarkers]) {
      mesh.count = counts.get(mesh) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
    }
    return group;
  }

  private createHangarShell(): THREE.Group {
    const group = new THREE.Group();
    group.name = "hangar_six_blockout";
    const frameMaterial = new THREE.MeshLambertMaterial({ color: 0x20231f });
    // P11: 0x9a6b2f -> 0xffb154. These are the fixtures the hangar
    // PointLights represent, so they have to read lit rather than as dull
    // painted metal. Matches HANGAR_LAMP_COLOR in atmosphere.ts exactly.
    const sodiumMaterial = new THREE.MeshBasicMaterial({
      color: 0xffb154,
      toneMapped: false,
    });
    const frameDistances: number[] = [];
    for (let distance = 616.519; distance <= 816.239; distance += 10) {
      frameDistances.push(distance);
    }
    const cube = new THREE.BoxGeometry(1, 1, 1);
    const pillars = new THREE.InstancedMesh(cube, frameMaterial, frameDistances.length * 2);
    const roofs = new THREE.InstancedMesh(cube, frameMaterial, frameDistances.length);
    const lamps = new THREE.InstancedMesh(cube, sodiumMaterial, Math.ceil(frameDistances.length / 2));
    const object = new THREE.Object3D();
    let pillarIndex = 0;
    let lampIndex = 0;
    for (let index = 0; index < frameDistances.length; index += 1) {
      const sample = this.sampleAtDistance(frameDistances[index]);
      for (const side of [-1, 1]) {
        poseObject(object, sample);
        object.position.addScaledVector(sample.right, side * (sample.halfWidth + 0.9));
        object.position.addScaledVector(sample.up, 8);
        object.scale.set(0.7, 16, 0.7);
        object.updateMatrix();
        pillars.setMatrixAt(pillarIndex, object.matrix);
        pillarIndex += 1;
      }
      poseObject(object, sample);
      object.position.addScaledVector(sample.up, 16);
      object.scale.set(sample.width + 2.5, 0.7, 0.8);
      object.updateMatrix();
      roofs.setMatrixAt(index, object.matrix);
      if (index % 2 === 0) {
        poseObject(object, sample);
        object.position.addScaledVector(sample.up, 15.5);
        object.scale.set(3.2, 0.12, 0.8);
        object.updateMatrix();
        lamps.setMatrixAt(lampIndex, object.matrix);
        lampIndex += 1;
      }
    }
    pillars.instanceMatrix.needsUpdate = true;
    roofs.instanceMatrix.needsUpdate = true;
    lamps.count = lampIndex;
    lamps.instanceMatrix.needsUpdate = true;
    group.add(pillars, roofs, lamps);
    return group;
  }

  private createHazards(): THREE.Group {
    const group = new THREE.Group();
    group.name = "greenwater_hazards";
    const water = MAP.hazards.find((hazard) => hazard.id === "HZ_WATER_SHEET");
    if (water?.fromDistance !== undefined && water.toDistance !== undefined) {
      const positions: number[] = [];
      const indices: number[] = [];
      let stripIndex = 0;
      for (let distance = water.fromDistance; distance <= water.toDistance; distance += 4) {
        const sample = this.sampleAtDistance(distance);
        for (const lateralScale of [-0.98, -0.25]) {
          const point = sample.position
            .clone()
            .addScaledVector(sample.right, sample.halfWidth * lateralScale)
            .addScaledVector(sample.up, 0.045);
          positions.push(point.x, point.y, point.z);
        }
        if (distance + 4 <= water.toDistance) {
          const offset = stripIndex * 2;
          indices.push(offset, offset + 2, offset + 1, offset + 2, offset + 3, offset + 1);
        }
        stripIndex += 1;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({ color: 0x344c4a, transparent: true, opacity: 0.82 }),
      );
      mesh.name = "standing_water_sheet";
      group.add(mesh);
    }

    const steamHazards = MAP.hazards.filter(
      (hazard) => hazard.type === "steam_vent"
        && hazard.distance !== undefined
        && hazard.lateralOffset !== undefined,
    );
    if (steamHazards.length > 0) {
      const puffsPerVent = STEAM_PUFFS_PER_VENT;
      const puffCount = steamHazards.length * puffsPerVent;
      // H3: one quad, spread in view space by `installSteamPuffBillboard`. The
      // unit plane's own vertices are the half-extents that injection reads.
      const puffGeometry = new THREE.PlaneGeometry(1, 1);
      const puffAlpha = new THREE.InstancedBufferAttribute(
        new Float32Array(puffCount),
        1,
      );
      puffAlpha.setUsage(THREE.DynamicDrawUsage);
      puffGeometry.setAttribute("puffAlpha", puffAlpha);
      const puffMaterial = new THREE.MeshBasicMaterial({
        map: createSteamPuffTexture(),
        // The STEAM cell's tint, not a grey: see STEAM_PUFF_TINT.
        color: STEAM_PUFF_TINT,
        transparent: true,
        // NormalBlending, so the puff stays vapour lit by the hangar rather
        // than a lamp of its own; additive steam over the dark interior reads
        // as a flare. Kept explicit because it is a decision, not a default.
        blending: THREE.NormalBlending,
        // Opacity is 1 and the ENVELOPE is per instance, in the `puffAlpha`
        // attribute below: a material opacity would fade all twelve cards
        // together, which is a vent that blinks rather than six puffs with
        // lives of their own.
        opacity: 1,
        depthWrite: false,
        // A card the craft can fly through, seen from both sides.
        side: THREE.DoubleSide,
        // AND SEEN FROM BOTH SIDES IN ONE PASS. three draws a transparent
        // DoubleSide material TWICE — back faces, then front faces — so that a
        // folded transparent surface sorts against itself, and the pair costs
        // two of `renderer.info.render.calls`. Measured: without this the
        // Greenwater station set went 84 -> 85 calls at 630 m and 77 -> 78 at
        // 815 m, which is the whole draw-call budget for this repair spent on a
        // sort a flat quad cannot need. `living-world.ts` carries the same flag
        // for the same reason, and the same evidence.
        forceSinglePass: true,
      });
      installSteamPuffBillboard(puffMaterial);
      const puffs = new THREE.InstancedMesh(
        puffGeometry,
        puffMaterial,
        puffCount,
      );
      puffs.name = "steam_vent_puffs";
      puffs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      puffs.frustumCulled = false;
      this.steamPuffAlpha = puffAlpha;
      const warnings = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({ color: 0xffa22e, toneMapped: false }),
        steamHazards.length,
      );
      warnings.name = "steam_vent_warning_lamps";
      warnings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const ventBases = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.8, 1.1, 0.42, 6),
        new THREE.MeshLambertMaterial({ color: 0x384039 }),
        steamHazards.length,
      );
      const ventObject = new THREE.Object3D();
      for (let index = 0; index < steamHazards.length; index += 1) {
        const hazard = steamHazards[index];
        const sample = this.sampleAtDistance(hazard.distance ?? 0);
        const lateralOffset = hazard.lateralOffset ?? 0;
        this.steamVents.push({
          sample,
          lateralOffset,
          cycleSeconds: Math.max(1, hazard.cycleSeconds ?? 4),
          telegraphSeconds: Math.max(0.2, hazard.telegraphSeconds ?? 1),
          phaseOffset: index * 1.7,
        });
        setCourseObjectTransform(
          ventObject,
          sample,
          lateralOffset,
          0.2,
          0,
          1,
          1,
          1,
        );
        ventBases.setMatrixAt(index, ventObject.matrix);
      }
      ventBases.instanceMatrix.needsUpdate = true;
      this.steamPuffs = puffs;
      this.steamWarnings = warnings;
      group.add(ventBases, warnings, puffs);
    }

    const cableMaterial = new THREE.MeshLambertMaterial({ color: 0x503d2d });
    const cableCoils = new THREE.InstancedMesh(
      new THREE.TorusGeometry(1.5, 0.25, 5, 9),
      cableMaterial,
      this.cableHazards.length,
    );
    const cableWarnings = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffa22e, toneMapped: false }),
      this.cableHazards.length,
    );
    const cableObject = new THREE.Object3D();
    for (let index = 0; index < this.cableHazards.length; index += 1) {
      const hazard = this.cableHazards[index];
      if (hazard.distance === undefined || hazard.lateralOffset === undefined) continue;
      const sample = this.sampleAtDistance(hazard.distance);
      poseObject(cableObject, sample);
      cableObject.position.addScaledVector(sample.right, hazard.lateralOffset);
      cableObject.position.addScaledVector(sample.up, 0.28);
      cableObject.rotation.x += Math.PI / 2;
      cableObject.updateMatrix();
      cableCoils.setMatrixAt(index, cableObject.matrix);
      setCourseObjectTransform(
        cableObject,
        sample,
        hazard.lateralOffset,
        1.25,
        0,
        0.16,
        2.2,
        0.16,
      );
      cableWarnings.setMatrixAt(index, cableObject.matrix);
    }
    cableCoils.name = "cable_trip_hazards";
    // P20.1. Greenwater's equivalent of the Bitterpan coils; same reason.
    cableCoils.castShadow = true;
    cableWarnings.name = "cable_trip_warning_posts";
    cableCoils.instanceMatrix.needsUpdate = true;
    cableWarnings.instanceMatrix.needsUpdate = true;
    group.add(cableCoils, cableWarnings);

    const cargoHook = MAP.hazards.find((hazard) => hazard.type === "swinging_hook");
    if (cargoHook?.distance !== undefined) {
      const sample = this.sampleAtDistance(cargoHook.distance);
      const root = new THREE.Group();
      root.name = cargoHook.id;
      poseObject(root, sample);
      root.position.addScaledVector(sample.right, cargoHook.lateralOffset ?? 0);
      root.position.addScaledVector(sample.up, 15.2);
      const pivot = new THREE.Group();
      pivot.name = `${cargoHook.id}_swing`;
      const cable = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.12, 7.4, 5),
        new THREE.MeshLambertMaterial({ color: 0x302d28 }),
      );
      cable.position.y = -3.7;
      const hook = new THREE.Mesh(
        new THREE.TorusGeometry(0.78, 0.18, 5, 8, Math.PI * 1.55),
        new THREE.MeshBasicMaterial({ color: 0xffa22e }),
      );
      hook.position.y = -7.55;
      hook.rotation.z = Math.PI * 0.25;
      pivot.add(cable, hook);
      root.add(pivot);
      this.cargoHookPivot = pivot;
      group.add(root);
    }

    const boostMaterial = new THREE.MeshBasicMaterial({
      // P19: tone-mapped now. The pad was tone-mapping-exempt and read as a
      // glowing slab parked on the road rather than a painted strip on it.
      //
      // P20.7: white, and the paint is in the map. Tone mapping alone did not
      // finish the job — measured on the P20.1 build, the pad's interior came
      // back as ONE tone (no second mode at all) at deck+82 to deck+101, which
      // is a flat acid-green rectangle filling the lane, not a marking. The
      // colour now survives only as a faint core down the middle of
      // createGreenwaterBoostPadTexture.
      color: 0xffffff,
      map: createGreenwaterBoostPadTexture(),
      toneMapped: true,
    });
    const boostPads = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      boostMaterial,
      BOOST_PAD_DISTANCES.length,
    );
    boostPads.name = "greenwater_boost_pads";
    const boostObject = new THREE.Object3D();
    for (let index = 0; index < BOOST_PAD_DISTANCES.length; index += 1) {
      const distance = BOOST_PAD_DISTANCES[index];
      const sample = this.sampleAtDistance(distance);
      setCourseObjectTransform(
        boostObject,
        sample,
        sample.halfWidth * 0.44,
        0.06,
        0,
        4.8,
        0.035,
        18,
      );
      boostPads.setMatrixAt(index, boostObject.matrix);
    }
    boostPads.instanceMatrix.needsUpdate = true;
    group.add(boostPads);
    this.updateAtmosphere(0, false);
    return group;
  }

  private createLandmarks(): THREE.Group {
    const group = new THREE.Group();
    group.name = "greenwater_landmark_proxies";
    const concrete = new THREE.MeshLambertMaterial({ color: 0x343b35 });
    const dark = new THREE.MeshLambertMaterial({ color: 0x191f1c });
    const water = new THREE.MeshBasicMaterial({ color: 0x314b43, transparent: true, opacity: 0.86 });
    const sodium = new THREE.MeshBasicMaterial({ color: 0x9a6b2f });
    const red = new THREE.MeshBasicMaterial({ color: 0xff5a3c });

    for (const landmark of MAP.landmarkProxies) {
      if (landmark.id === "LM_CRADLE" || landmark.id === "LM_HANGAR" || landmark.id === "LM_TANKS") {
        continue;
      }
      const sample = this.sampleAtDistance(landmark.anchorDistance);
      const root = new THREE.Group();
      root.name = landmark.id;
      root.userData.note = landmark.note;
      poseObject(root, sample);
      root.position.set(landmark.position.x, landmark.position.y, landmark.position.z);

      if (landmark.id === "LM_WATER_TOWER") {
        const tank = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 5.5, 8, 8), concrete);
        tank.position.y = 23;
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.5, 20, 6), dark);
        stem.position.y = 10;
        root.rotation.z = THREE.MathUtils.degToRad(7);
        root.add(stem, tank);
      } else if (landmark.id === "LM_CRANE") {
        const boom = new THREE.Mesh(new THREE.BoxGeometry(landmark.footprint.x, 1.2, 1.2), concrete);
        boom.position.y = 10;
        boom.rotation.z = THREE.MathUtils.degToRad(-22);
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.8, 1.4), sodium);
        lamp.position.set(9, 6.5, -0.8);
        root.add(boom, lamp);
      } else if (landmark.id === "LM_WEIR") {
        const sheet = new THREE.Mesh(
          new THREE.BoxGeometry(landmark.footprint.x, 0.3, landmark.footprint.z),
          water,
        );
        sheet.position.y = 0.1;
        root.add(sheet);
      } else if (landmark.id === "LM_ANTENNA") {
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 1.05, 60, 6), concrete);
        mast.position.y = 30;
        mast.rotation.z = THREE.MathUtils.degToRad(12);
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(1.1, 8, 6), red);
        lamp.position.set(-6.2, 59.2, 0);
        root.add(mast, lamp);
      } else if (landmark.id === "LM_TOWER") {
        const stem = new THREE.Mesh(new THREE.BoxGeometry(8, 18, 8), concrete);
        stem.position.y = 9;
        const cabin = new THREE.Mesh(new THREE.BoxGeometry(18, 8, 18), dark);
        cabin.position.y = 22;
        const window = new THREE.Mesh(new THREE.BoxGeometry(14, 2.2, 0.4), sodium);
        window.position.set(0, 23, -9.2);
        root.add(stem, cabin, window);
      }
      group.add(root);
    }

    const tankMaterial = new THREE.MeshLambertMaterial({ color: 0x3a4037 });
    const tanks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(1, 1, 1, 8),
      tankMaterial,
      9,
    );
    const tankObject = new THREE.Object3D();
    for (let index = 0; index < 9; index += 1) {
      const distance = 1640 + index * 55;
      const sample = this.sampleAtDistance(distance);
      const height = THREE.MathUtils.lerp(18, 7, index / 8);
      const radius = height * 0.34;
      tankObject.position.copy(sample.position)
        .addScaledVector(sample.right, -40)
        .addScaledVector(sample.up, height / 2);
      tankObject.quaternion.identity();
      tankObject.scale.set(radius, height, radius);
      tankObject.updateMatrix();
      tanks.setMatrixAt(index, tankObject.matrix);
    }
    tanks.name = "fuel_tanks";
    tanks.instanceMatrix.needsUpdate = true;
    group.add(tanks);
    return group;
  }

  private createJungleSilhouette(): THREE.Group {
    const group = new THREE.Group();
    group.name = "greenwater_canopy";
    const random = seededRandom(714);
    const count = 240;
    const trunkGeometry = new THREE.CylinderGeometry(0.45, 0.7, 5, 5);
    const crownGeometry = new THREE.ConeGeometry(3.2, 10, 5);
    const trunkMaterial = new THREE.MeshLambertMaterial({ color: 0x111a16, flatShading: true });
    const crownMaterial = new THREE.MeshLambertMaterial({ color: 0x17291f, flatShading: true });
    const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, count);
    const crowns = new THREE.InstancedMesh(crownGeometry, crownMaterial, count);
    const object = new THREE.Object3D();
    for (let index = 0; index < count; index += 1) {
      const inCanopy = index < 150;
      const distance = inCanopy
        ? THREE.MathUtils.lerp(1128.982, 1591.107, random())
        : random() * this.length;
      const sample = this.sampleAtDistance(distance);
      const side = random() > 0.5 ? 1 : -1;
      const offset = (inCanopy ? 15 : 30) + random() * (inCanopy ? 34 : 80);
      const scale = 0.7 + random() * 1.5;
      const position = sample.position.clone().addScaledVector(sample.right, side * offset);
      object.position.copy(position).addScaledVector(sample.up, 2.5 * scale - 1.2);
      object.rotation.set(0, random() * Math.PI * 2, (random() - 0.5) * 0.08);
      object.scale.set(scale, scale, scale);
      object.updateMatrix();
      trunks.setMatrixAt(index, object.matrix);
      object.position.copy(position).addScaledVector(sample.up, 9.2 * scale - 1.2);
      object.rotation.y += random() * 0.8;
      object.updateMatrix();
      crowns.setMatrixAt(index, object.matrix);
    }
    trunks.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    group.add(trunks, crowns);
    return group;
  }

  private createGroundPlane(): THREE.Mesh {
    const geometry = new THREE.PlaneGeometry(1800, 1800, 1, 1);
    const material = new THREE.MeshLambertMaterial({ color: 0x07100b });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(-340, -20, 30);
    mesh.receiveShadow = true;
    mesh.name = "greenwater_fog_ground";
    return mesh;
  }
}
