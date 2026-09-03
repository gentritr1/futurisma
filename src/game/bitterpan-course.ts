import * as THREE from "three";
import centrelineJson from "./data/map02/CENTRELINE_STATIONS.json";
import checkpointsJson from "./data/map02/CHECKPOINTS.json";
import gridAndRecoveryJson from "./data/map02/GRID_AND_RECOVERY.json";
import sectorsJson from "./data/map02/SECTORS_AND_SEQUENCES.json";
import productionJson from "./data/map02/BITTERPAN_PRODUCTION.json";
import { createApronResolution, resolveApron, resolveApronProfile } from "./apron.js";
import type { ApronResolution } from "./apron.js";
import { resolveAudioZone } from "./audio-space.js";
import type { AudioZone } from "./audio-space.js";
import { resolveGatePostLateral } from "./furniture-placement.js";
import { lerpKeyDirection } from "./lighting-motion.js";
import { isCircularHazardContact } from "./race-rules";
import type {
  CourseLightingProfile,
  CourseProjection,
  CourseSample,
  EdgeType,
  FogProfile,
  MusicProfile,
  RaceCourse,
  RivalGridStart,
  RivalPaceTable,
  TimeOfDayStop,
  TurnCue,
} from "./course";
import DRIVABLE_LIMIT_TABLE from "./data/map02/DRIVABLE_LIMITS.json";
import { DrivableLimits } from "./drivable-limits";

interface BitterpanStation {
  i: number;
  s: number;
  x: number;
  y: number;
  z: number;
  tangent: [number, number, number];
  curvature: number;
  width_m: number;
  bank_deg: number;
  sector: string;
  sequence: string;
  sequence_name: string;
}

interface BitterpanCentrelineData {
  format: string;
  final_map02_blockout_freeze: boolean;
  station_spacing_m: number;
  station_count: number;
  total_length_m: number;
  stations: BitterpanStation[];
}

interface BitterpanCheckpoint {
  order: number;
  id: string;
  is_lap_trigger: boolean;
  station_m: number;
  half_width_m: number;
  height_m: number;
}

interface BitterpanCheckpointData {
  format: string;
  final_map02_blockout_freeze: boolean;
  count: number;
  checkpoints: BitterpanCheckpoint[];
}

interface BitterpanGridTransform {
  identity: string;
  station_m: number;
  lateral_offset_m: number;
}

interface BitterpanRecoveryTransform {
  station_m: number;
  position: [number, number, number];
  heading_deg: number;
}

interface BitterpanGridRecoveryData {
  final_map02_blockout_freeze: boolean;
  grid: { slots: number; transforms: BitterpanGridTransform[] };
  recovery: {
    detection_window_s: number;
    rejoin_delay_s: number;
    rejoin_speed_fraction: number;
    rejoin_transform_count: number;
    transforms: BitterpanRecoveryTransform[];
  };
}

interface BitterpanPrimitive {
  id: string;
  name: string;
  kind: string;
  from_m: number;
  to_m: number;
  radius_m: number | null;
}

interface BitterpanSectorData {
  final_map02_blockout_freeze: boolean;
  authored_primitives: BitterpanPrimitive[];
}

interface BitterpanTurn {
  entryDistance: number;
  exitDistance: number;
  radius: number;
  direction: "left" | "right";
}

/* ------------------------------------------------------------------ */
/* P8 authored production sidecar                                      */
/* ------------------------------------------------------------------ */

interface BitterpanApronEdgeProfile {
  label: string;
  surface: string;
  widthMetres: number;
  grip: number;
  wall: boolean;
  wallSpeedMultiplier: number;
  wallImpactStrength: number;
  wallScrubMetresPerSecondSquared: number;
}

interface BitterpanEdgeSpan {
  id: string;
  sequence: string;
  fromDistance: number;
  toDistance: number;
  edgeLeft: EdgeType;
  edgeRight: EdgeType;
}

interface BitterpanGripHazard {
  id: string;
  type: "salt_drift";
  fromDistance: number;
  toDistance: number;
  lateralFromFraction: number;
  lateralToFraction: number;
  gripMultiplier: number;
}

interface BitterpanCableHazard {
  id: string;
  type: "cable_coil";
  distance: number;
  lateralOffset: number;
}

type BitterpanHazard = BitterpanGripHazard | BitterpanCableHazard;

interface BitterpanBoostPad {
  id: string;
  distance: number;
  sequence: string;
  lateralFraction: number;
}

interface BitterpanMusicTrigger {
  distance: number;
  sequence: string;
  sector: string;
  levels: MusicProfile;
}

interface BitterpanLightingProfileData {
  sector: string;
  name: string;
  distance: number;
  sky: string;
  ground: string;
  key: string;
  rim: string;
  hemisphereIntensity: number;
  keyIntensity: number;
  rimIntensity: number;
  keyElevationDegrees: number;
  keyAzimuthDegrees: number;
  keyDirection: { x: number; y: number; z: number };
  fog: { density: number; color: string };
}

interface BitterpanProductionData {
  format: string;
  apron: {
    deckMarginMetres: number;
    gripFloor: number;
    edges: Record<string, BitterpanApronEdgeProfile>;
    overrides: (BitterpanApronEdgeProfile & {
      id?: string;
      edges?: string[];
      sectors?: string[];
    })[];
  };
  edges: {
    default: { edgeLeft: EdgeType; edgeRight: EdgeType };
    spans: BitterpanEdgeSpan[];
  };
  hazards: { gripRecoverySeconds: number; entries: BitterpanHazard[] };
  boostPads: {
    halfLengthMetres: number;
    lateralHalfFraction: number;
    pads: BitterpanBoostPad[];
  };
  /** G1 rival pace, solved by scripts/rival-pace-calibration.mjs. */
  rivals: RivalPaceTable;
  music: { triggers: BitterpanMusicTrigger[] };
  audio: {
    zones: { name: AudioZone; startDistance: number; endDistance: number }[];
    defaultZone: AudioZone;
  };
  lighting: { crossfadeMetres: number; profiles: BitterpanLightingProfileData[] };
  timeOfDay: { stops: TimeOfDayStop[] };
  lapBoard: {
    template: string;
    subtitle: string;
    distance: number;
    lateralOffset: number;
    heightMetres: number;
    widthMetres: number;
    boardHeightMetres: number;
    foreground: string;
    background: string;
  };
  culling: {
    baseDistanceMetres: number;
    radiusMultiplier: number;
    maximumDistanceMetres: number;
  };
}

/** One resolved sector lighting zone, in lap order, including the wrap run. */
interface BitterpanLightingZone {
  distance: number;
  sector: string;
  sky: THREE.Color;
  ground: THREE.Color;
  key: THREE.Color;
  rim: THREE.Color;
  hemisphereIntensity: number;
  keyIntensity: number;
  rimIntensity: number;
  direction: { x: number; y: number; z: number };
  fogDensity: number;
  fogColor: THREE.Color;
}

const CENTRELINE = centrelineJson as unknown as BitterpanCentrelineData;
const CHECKPOINTS = checkpointsJson as unknown as BitterpanCheckpointData;
const GRID_AND_RECOVERY = gridAndRecoveryJson as unknown as BitterpanGridRecoveryData;
const SECTORS = sectorsJson as unknown as BitterpanSectorData;
const PRODUCTION = productionJson as unknown as BitterpanProductionData;
const APRON = PRODUCTION.apron;
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const COURSE_LENGTH_METRES = 3050;
const CRUISE_SPEED_METRES_PER_SECOND = 86;
const CHECKPOINT_PENDING = new THREE.Color(0xff8c32);
const CHECKPOINT_PASSED = new THREE.Color(0xc8ff2e);
const CHECKPOINT_INACTIVE = new THREE.Color(0x80633c);
const ROUTE_EDGE_LEFT = new THREE.Color(0x77dce3);
const ROUTE_EDGE_RIGHT = new THREE.Color(0xf06a32);
const ROUTE_DECK_BY_SECTOR: Record<string, THREE.Color> = {
  S1: new THREE.Color(0x514c43),
  S2: new THREE.Color(0x414946),
  S3: new THREE.Color(0x3d4c4d),
};
const SECTOR_LABELS: Record<string, string> = {
  S1: "HARVEST BASIN",
  S2: "THE LONG BASIN",
  S3: "LOADOUT BASIN",
};
// P19: 0x77dce3 -> deeper. Under AgX tone mapping the old value still read as
// a pale ice slab against the dark deck; this keeps the cyan identity at a
// luminance the road can sit under.
const BOOST_PAD_COLOR = new THREE.Color(0x49a9bd);
const CABLE_COIL_COLOR = new THREE.Color(0xf06a32);
const SALT_DRIFT_COLOR = new THREE.Color(0xe8e2cf);

/**
 * P20.2 centre-line paint. See `createCentreDashes`.
 *
 * 7.5 -> 4.5 m on the same 25 m rhythm: at 88 m/s a 7.5 m dash covers the lane
 * for 85 ms, which is long enough for the eye to track it as an object rather
 * than as a rhythm. The lift drops 0.075 -> 0.055 m, one centimetre over the
 * deck read surface (0.045) and one centimetre under the edge band (0.065), so
 * the paint layer keeps its slot in the stack without standing off the road.
 */
const CENTRE_DASH_WIDTH_METRES = 0.34;
const CENTRE_DASH_LENGTH_METRES = 4.5;
const CENTRE_DASH_LIFT_METRES = 0.055;
/**
 * Measured, not picked.
 *
 * `shots/p20.2/calibrate-dash.mjs` freezes a frame, masks the dash's exact
 * pixels, and re-renders that same frame once per candidate colour, so the
 * only thing that changes between readings is the colour. The transfer it
 * measured through AgX at 1280x720, against the deck taken from the pixels
 * immediately beside the dash:
 *
 *   colour     d 586 (S1, deck 70.4)   d 2084 (S3, deck 68.8)
 *   0x6b6f63   +41.0                   +47.8
 *   0x7d8175   +55.0                   +62.5
 *   0x9aa08f   +74.6  (over)           +82.9  (over)
 *   0xdce6d4  +105.8  (the old value)  +115.8
 *
 * 0x74786c is interpolated between the two passing rungs to sit near the middle
 * of the [deck + 30, deck + 70] window on both decks, so neither end of the
 * window is one grade change away. The old 0xdce6d4 is on the table because it
 * is the value that shipped, and it missed by 36..46.
 */
const CENTRE_DASH_COLOR = new THREE.Color(0x74786c);

/**
 * P20.2 salt-drift falloff, metres.
 *
 * The drift is a grip telegraph, so its EXTENT is not negotiable — it is the
 * exact band `surfaceGripAt` tests and nothing here moves it. What changes is
 * that the paint no longer stops dead at that band's edge. A hard-edged
 * near-white ribbon over the inside third is the silhouette of a poured slab;
 * crust that thins into the road is the silhouette of crust.
 *
 * 1.8 m across the inner edge and 6 m at each end are the acceptance floors for
 * this phase, and the code takes the smaller of the floor and a fraction of the
 * band so a narrow station cannot invert the ramp.
 */
const DRIFT_INNER_FADE_METRES = 2;
const DRIFT_OUTER_FADE_METRES = 0.9;
const DRIFT_END_FADE_METRES = 6.5;
/**
 * The most opaque the crust ever gets. Under 1 the deck reads THROUGH the
 * drift everywhere, which is what stops the patch reading as a separate
 * surface laid on top of the road.
 *
 * 0.68 is measured, not chosen. Two readings bound it from opposite sides and
 * both were taken through a pixel-exact mask of the patch:
 *
 *   * the patch's OPAQUE CORE must land under the 135 luma cap. At 0.86 it
 *     measured 136.8 at d 324 and 143.4 at d 1358 -- over on both;
 *   * the patch AS A WHOLE, fades included, must stay at least 35 over the
 *     deck or it stops telegraphing the grip loss.
 *
 * Those pull against each other: alpha moves the core and the whole patch in
 * the same direction. 0.68 with these fade widths is the value that clears
 * both with room, and the fades were tightened from 2.4 / 8 m to the phase's
 * own floors of 2 / 6.5 m for the same reason -- a narrower ramp puts more of
 * the patch at full crust, which buys back telegraph without buying back glare.
 */
const DRIFT_PEAK_ALPHA = 0.68;

/** Hermite ramp; 0 below `edge0`, 1 above `edge1`. */
function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * The boost pad's paint, generated rather than authored.
 *
 * 64 x 256 greyscale-modulated, drawn once and shared by all four instances, so
 * it costs one 64 KB texture and NO draw call — the pads stay a single
 * instanced draw. The canvas maps u across the road and v along it (the pad's
 * local X is `right` and its local Z is the tangent), and the pad is about
 * 4.1 m x 16 m, so a 64 x 256 sheet is very close to square texels.
 *
 * Values are a MULTIPLIER on `BOOST_PAD_COLOR`: 1.0 is exactly the P19 cyan, so
 * nothing here can push the pad brighter than the value that was already
 * accepted. Everything else is darker, which is where the interior structure
 * comes from.
 */
function createBoostPadTexture(): THREE.CanvasTexture {
  const width = 64;
  const height = 256;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create the Bitterpan boost pad paint.");

  // The field the chevrons sit on. Measured: at "#6a6a6a" the pad came back at
  // mean luma 55.2 against a 66.6 deck -- DARKER than the road it is painted
  // on, which trades a glowing plate for a hole. The field has to sit above the
  // deck; the structure comes from the chevrons and the rim, not from sinking
  // the whole marking.
  context.fillStyle = "#909090";
  context.fillRect(0, 0, width, height);

  // Chevrons pointing the way the craft is going. Local +Z is -tangent, so
  // travel runs from high v to low v and the apex points at the top of the
  // canvas as drawn.
  const border = 6; // ~0.35 m on both axes at this pad size.
  const chevrons = 5;
  const pitch = (height - border * 2) / chevrons;
  context.strokeStyle = "#ffffff";
  context.lineWidth = pitch * 0.3;
  context.lineCap = "butt";
  context.lineJoin = "miter";
  for (let index = 0; index < chevrons; index += 1) {
    const base = height - border - index * pitch - pitch * 0.25;
    context.beginPath();
    context.moveTo(border + 2, base);
    context.lineTo(width / 2, base - pitch * 0.45);
    context.lineTo(width - border - 2, base);
    context.stroke();
  }

  // The border last, over everything, so no chevron leaks into it. A marking
  // with a darker rim reads as painted onto the surface; a marking that runs
  // to its own silhouette reads as a plate resting on it.
  context.fillStyle = "#565656";
  context.fillRect(0, 0, width, border);
  context.fillRect(0, height - border, width, border);
  context.fillRect(0, 0, border, height);
  context.fillRect(width - border, 0, border, height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.name = "map02_boost_pad_paint";
  texture.colorSpace = THREE.SRGBColorSpace;
  // The pad is read from 2 m to 300 m. Point-sampling a 5-chevron ladder at
  // that range is the sparkle the pan floor's own note warns about, so this
  // takes the same stated exception: mipped and linear.
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

/** Deterministic 0..1 from one number. Same crust grain on every load. */
function hashUnit(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Where to put a ring of vertices along one drift.
 *
 * A uniform 5 m step cannot carry an 8 m end ramp — two segments for the whole
 * fade, which is a visible facet, not a fade. This keeps the 5 m body step and
 * adds explicit nodes across both ramps, so the gradient is smooth where it is
 * measured and costs vertices only where it is needed.
 */
function driftNodeDistances(from: number, to: number): number[] {
  const nodes = new Set<number>([from, to]);
  for (const offset of [1, 2, 3.5, 5, 6.5, 8]) {
    if (from + offset < to) nodes.add(from + offset);
    if (to - offset > from) nodes.add(to - offset);
  }
  for (let distance = from + 5; distance < to; distance += 5) nodes.add(distance);
  return [...nodes].sort((a, b) => a - b);
}

/**
 * Per-station edge types, resolved once from the authored span table. `sample`
 * runs several times per frame, so this has to be a table read rather than a
 * span scan: 610 stations x 2 sides, built at module scope alongside the
 * authored apron profile each one resolves to.
 */
const STATION_EDGES: {
  left: EdgeType;
  right: EdgeType;
  apronLeft: BitterpanApronEdgeProfile;
  apronRight: BitterpanApronEdgeProfile;
}[] = CENTRELINE.stations.map((station) => {
  let left = PRODUCTION.edges.default.edgeLeft;
  let right = PRODUCTION.edges.default.edgeRight;
  for (const span of PRODUCTION.edges.spans) {
    if (station.s < span.fromDistance || station.s > span.toDistance) continue;
    left = span.edgeLeft;
    right = span.edgeRight;
  }
  return {
    left,
    right,
    apronLeft: resolveApronProfile(APRON, left, station.sector),
    apronRight: resolveApronProfile(APRON, right, station.sector),
  };
});

const GRIP_HAZARDS = PRODUCTION.hazards.entries.filter(
  (hazard): hazard is BitterpanGripHazard => hazard.type === "salt_drift",
);
const CABLE_HAZARDS = PRODUCTION.hazards.entries.filter(
  (hazard): hazard is BitterpanCableHazard => hazard.type === "cable_coil",
);

/**
 * Sector lighting zones in lap order, derived from the accepted station table
 * rather than authored twice. Bitterpan's S3 owns both the 0-55 m start apron
 * and the 2550-3045 m loadout run, so the zone list is S3, S1, S2, S3 and the
 * lap wrap is a zero-delta seam — the same property Greenwater gets by making
 * RUNWAY_HOME repeat RUNWAY_START.
 */
const LIGHTING_ZONES: BitterpanLightingZone[] = (() => {
  const bySector = new Map(
    PRODUCTION.lighting.profiles.map((profile) => [profile.sector, profile]),
  );
  const zones: BitterpanLightingZone[] = [];
  let previousSector: string | null = null;
  for (const station of CENTRELINE.stations) {
    if (station.sector === previousSector) continue;
    previousSector = station.sector;
    const profile = bySector.get(station.sector);
    if (!profile) {
      throw new Error(`Bitterpan sector ${station.sector} has no authored lighting.`);
    }
    zones.push({
      distance: station.s,
      sector: profile.sector,
      sky: new THREE.Color(profile.sky),
      ground: new THREE.Color(profile.ground),
      key: new THREE.Color(profile.key),
      rim: new THREE.Color(profile.rim),
      hemisphereIntensity: profile.hemisphereIntensity,
      keyIntensity: profile.keyIntensity,
      rimIntensity: profile.rimIntensity,
      direction: profile.keyDirection,
      fogDensity: profile.fog.density,
      fogColor: new THREE.Color(profile.fog.color),
    });
  }
  return zones;
})();

const KEY_DIRECTION_ZONES = LIGHTING_ZONES.map((zone) => ({
  distance: zone.distance,
  direction: zone.direction,
}));

function createCourseSampleValue(): CourseSample {
  return {
    position: new THREE.Vector3(),
    tangent: new THREE.Vector3(0, 0, 1),
    right: new THREE.Vector3(-1, 0, 0),
    up: new THREE.Vector3(0, 1, 0),
    curvature: 0,
    width: 0,
    halfWidth: 0,
    bank: 0,
    sector: "",
    edgeLeft: PRODUCTION.edges.default.edgeLeft,
    edgeRight: PRODUCTION.edges.default.edgeRight,
    apronLeft: APRON.edges[PRODUCTION.edges.default.edgeLeft].widthMetres,
    apronRight: APRON.edges[PRODUCTION.edges.default.edgeRight].widthMetres,
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

function stationIndexAtDistance(distance: number): number {
  return Math.floor(
    THREE.MathUtils.euclideanModulo(distance, COURSE_LENGTH_METRES)
      / CENTRELINE.station_spacing_m,
  ) % CENTRELINE.station_count;
}

export class BitterpanCourse implements RaceCourse {
  readonly kind = "bitterpan" as const;
  readonly group = new THREE.Group();
  readonly length = COURSE_LENGTH_METRES;
  readonly halfWidth = 15;
  readonly checkpointCount = CHECKPOINTS.count - 1;
  readonly orderedCheckpointCount = CHECKPOINTS.count;
  readonly defaultLapCount = 5;
  readonly minimumLapCount = 1;
  readonly maximumLapCount = 9;
  readonly mapName = "Bitterpan Works";
  readonly mapCode = "MAP 02";
  readonly finishName = "the Loadout Apron";
  readonly startLabel = "LOADOUT APRON";
  readonly startProgress = 3045 / COURSE_LENGTH_METRES;
  // Runtime right is tangent × up. At station 3045 it points west, so +6.2
  // reproduces the accepted WORKS 07 world-space X offset of -6.2 m.
  readonly startLateral = 6.2;
  readonly recoveryHoldSeconds = GRID_AND_RECOVERY.recovery.detection_window_s
    + GRID_AND_RECOVERY.recovery.rejoin_delay_s;
  readonly recoverySpeedMps = CRUISE_SPEED_METRES_PER_SECOND
    * GRID_AND_RECOVERY.recovery.rejoin_speed_fraction;
  readonly recoveryImmunitySeconds = 1.2;
  readonly surfaceGripRecoverySeconds = PRODUCTION.hazards.gripRecoverySeconds;
  readonly timeOfDayStops: readonly TimeOfDayStop[] = PRODUCTION.timeOfDay.stops;
  // G1 - the rival pace block, authored under the production sheet's `rivals`
  // key so the map ships its own racing character with the rest of its data.
  readonly rivalPace: RivalPaceTable = PRODUCTION.rivals;

  private readonly stations = CENTRELINE.stations;
  private readonly projectionPoints = this.stations.map(
    (station) => new THREE.Vector3(station.x, station.y, station.z),
  );
  private readonly projectionTangents = this.projectionPoints.map((_, index) => {
    const before = this.projectionPoints[
      THREE.MathUtils.euclideanModulo(index - 1, this.projectionPoints.length)
    ];
    const after = this.projectionPoints[(index + 1) % this.projectionPoints.length];
    return after.clone().sub(before).normalize();
  });
  private readonly turns = this.createTurns();
  private checkpointIndicatorMesh: THREE.InstancedMesh | null = null;
  private lapBoardTexture: THREE.CanvasTexture | null = null;
  private lapBoardContext: CanvasRenderingContext2D | null = null;
  private readonly lightingProfileScratch: CourseLightingProfile = {
    sky: new THREE.Color(),
    ground: new THREE.Color(),
    key: new THREE.Color(),
    rim: new THREE.Color(),
    hemisphereIntensity: 1,
    keyIntensity: 1,
    rimIntensity: 1,
    keyDirection: new THREE.Vector3(0, 1, 0),
  };
  private readonly fogProfileScratch: FogProfile = {
    density: 0,
    color: new THREE.Color(),
  };

  constructor() {
    if (
      CENTRELINE.format !== "FUTURISMA_MAP02_BITTERPAN_CENTRELINE"
      || CENTRELINE.final_map02_blockout_freeze
      || CHECKPOINTS.final_map02_blockout_freeze
      || GRID_AND_RECOVERY.final_map02_blockout_freeze
      || SECTORS.final_map02_blockout_freeze
      || CENTRELINE.station_count !== 610
      || this.stations.length !== CENTRELINE.station_count
      || Math.abs(CENTRELINE.total_length_m - this.length) > 1e-6
      || CHECKPOINTS.count !== CHECKPOINTS.checkpoints.length
      || GRID_AND_RECOVERY.grid.slots !== 4
      || GRID_AND_RECOVERY.recovery.rejoin_transform_count !== this.stations.length
      || GRID_AND_RECOVERY.recovery.transforms.length !== this.stations.length
    ) {
      throw new Error("Bitterpan accepted course data failed its runtime invariants.");
    }
    this.group.name = "map02_bitterpan_runtime_markers";
    this.group.add(this.createRouteReadLayer());
    this.group.add(this.createCheckpointMarkers());
    this.group.add(this.createSaltDrifts());
    this.group.add(this.createBoostPads());
    this.group.add(this.createCableCoils());
    this.group.add(this.createLapBoard());
    this.setCheckpointProgress(1);
    this.setLapBoard(1, this.defaultLapCount);
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
    const scaled = wrapped * this.stations.length;
    const index = Math.floor(scaled) % this.stations.length;
    const nextIndex = (index + 1) % this.stations.length;
    const alpha = scaled - Math.floor(scaled);
    const current = this.stations[index];
    const next = this.stations[nextIndex];

    target.position.lerpVectors(
      this.projectionPoints[index],
      this.projectionPoints[nextIndex],
      alpha,
    );
    target.tangent.copy(this.projectionTangents[index])
      .lerp(this.projectionTangents[nextIndex], alpha)
      .normalize();
    target.right.crossVectors(target.tangent, WORLD_UP).normalize();
    target.up.crossVectors(target.right, target.tangent).normalize();
    const bank = THREE.MathUtils.lerp(current.bank_deg, next.bank_deg, alpha);
    if (Math.abs(bank) > 0.001) {
      const bankRadians = THREE.MathUtils.degToRad(-bank);
      target.right.applyAxisAngle(target.tangent, bankRadians).normalize();
      target.up.applyAxisAngle(target.tangent, bankRadians).normalize();
    }

    const width = THREE.MathUtils.lerp(current.width_m, next.width_m, alpha);
    target.curvature = THREE.MathUtils.clamp(
      THREE.MathUtils.lerp(current.curvature, next.curvature, alpha) * 70,
      -1,
      1,
    );
    target.width = width;
    target.halfWidth = width / 2;
    target.bank = bank;
    target.sector = current.sector;
    // Edges resolve per station rather than per interpolated metre: an edge type
    // is a discrete authored fact and lerping between A and B has no meaning.
    const edges = STATION_EDGES[index];
    target.edgeLeft = edges.left;
    target.edgeRight = edges.right;
    target.apronLeft = edges.apronLeft.widthMetres;
    target.apronRight = edges.apronRight.widthMetres;
    target.apronGripLeft = edges.apronLeft.grip;
    target.apronGripRight = edges.apronRight.grip;
    return target;
  }

  sampleAtDistance(distance: number): CourseSample {
    return this.sample(distance / this.length);
  }

  checkpointProgress(index: number): number {
    const checkpoint = CHECKPOINTS.checkpoints[index];
    if (!checkpoint) throw new Error(`Unknown Bitterpan checkpoint ${index}.`);
    return checkpoint.station_m / this.length;
  }

  checkpointHalfWidth(index: number): number {
    const checkpoint = CHECKPOINTS.checkpoints[index];
    if (!checkpoint) throw new Error(`Unknown Bitterpan checkpoint ${index}.`);
    return checkpoint.half_width_m;
  }

  project(
    position: THREE.Vector3,
    hintProgress: number,
    target: CourseProjection = createCourseProjectionValue(),
  ): CourseProjection {
    const segmentCount = this.stations.length;
    const hintIndex = Math.round(
      THREE.MathUtils.euclideanModulo(hintProgress, 1) * segmentCount,
    );
    const localRadius = 42;
    let nearestDistanceSq = Number.POSITIVE_INFINITY;
    let nearestProgress = hintProgress;
    const globalSearchThresholdSq = (this.halfWidth + 24) ** 2;

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
        const distanceSq = (nearestX - position.x) ** 2
          + (nearestY - position.y) ** 2
          + (nearestZ - position.z) ** 2;
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
    let nearestIndex = -1;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < this.turns.length; index += 1) {
      const turn = this.turns[index];
      const inside = distance >= turn.entryDistance && distance <= turn.exitDistance;
      const distanceAhead = inside
        ? 0
        : THREE.MathUtils.euclideanModulo(turn.entryDistance - distance, this.length);
      if (distanceAhead > maximumDistance || distanceAhead >= nearestDistance) continue;
      nearestIndex = index;
      nearestDistance = distanceAhead;
    }
    if (nearestIndex < 0) return null;

    const turn = this.turns[nearestIndex];
    const following = this.turns[(nearestIndex + 1) % this.turns.length];
    const followingGap = THREE.MathUtils.euclideanModulo(
      following.entryDistance - turn.exitDistance,
      this.length,
    );
    const cue = target ?? {
      direction: "LEFT",
      followingDirection: null,
      distance: 0,
      hard: false,
      radius: 0,
    };
    cue.direction = turn.direction === "left" ? "LEFT" : "RIGHT";
    cue.followingDirection = followingGap <= 70 && following.direction !== turn.direction
      ? following.direction === "left" ? "LEFT" : "RIGHT"
      : null;
    cue.distance = nearestDistance;
    cue.hard = turn.radius <= 110;
    cue.radius = turn.radius;
    return cue;
  }

  /** Index of the lighting zone covering `distance`, and its crossfade amount. */
  private zoneBlendAt(distance: number): { index: number; amount: number } {
    let index = 0;
    for (let candidate = 1; candidate < LIGHTING_ZONES.length; candidate += 1) {
      if (LIGHTING_ZONES[candidate].distance > distance) break;
      index = candidate;
    }
    const zone = LIGHTING_ZONES[index];
    const zoneEnd = index === LIGHTING_ZONES.length - 1
      ? this.length
      : LIGHTING_ZONES[index + 1].distance;
    const crossfadeStart = Math.max(
      zone.distance,
      zoneEnd - PRODUCTION.lighting.crossfadeMetres,
    );
    const amount = distance <= crossfadeStart
      ? 0
      : THREE.MathUtils.smoothstep(distance, crossfadeStart, zoneEnd);
    return { index, amount };
  }

  fogAt(progress: number): FogProfile {
    const distance = THREE.MathUtils.euclideanModulo(progress, 1) * this.length;
    const { index, amount } = this.zoneBlendAt(distance);
    const zone = LIGHTING_ZONES[index];
    const next = LIGHTING_ZONES[(index + 1) % LIGHTING_ZONES.length];
    this.fogProfileScratch.density = THREE.MathUtils.lerp(
      zone.fogDensity,
      next.fogDensity,
      amount,
    );
    this.fogProfileScratch.color.lerpColors(zone.fogColor, next.fogColor, amount);
    return this.fogProfileScratch;
  }

  lightingAt(progress: number): CourseLightingProfile {
    const distance = THREE.MathUtils.euclideanModulo(progress, 1) * this.length;
    const { index, amount } = this.zoneBlendAt(distance);
    const zone = LIGHTING_ZONES[index];
    const next = LIGHTING_ZONES[(index + 1) % LIGHTING_ZONES.length];
    const target = this.lightingProfileScratch;
    target.sky.lerpColors(zone.sky, next.sky, amount);
    target.ground.lerpColors(zone.ground, next.ground, amount);
    target.key.lerpColors(zone.key, next.key, amount);
    target.rim.lerpColors(zone.rim, next.rim, amount);
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
    target.rimIntensity = THREE.MathUtils.lerp(
      zone.rimIntensity,
      next.rimIntensity,
      amount,
    );
    // The sun rides the same window as the palette, so the swing across the
    // three basins reads as one move rather than a colour change plus a jump.
    lerpKeyDirection(
      KEY_DIRECTION_ZONES,
      distance,
      this.length,
      target.keyDirection,
      PRODUCTION.lighting.crossfadeMetres,
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

  /**
   * Salt drift. The authored patches are lateral *bands* rather than a single
   * "left third" rule, because Bitterpan's deck ranges 22-30 m wide and a fixed
   * fraction would mean something different in the chicane than on the pan.
   */
  surfaceGripAt(progress: number, lateral: number, halfWidth: number): number {
    const distance = THREE.MathUtils.euclideanModulo(progress, 1) * this.length;
    let grip = 1;
    for (const hazard of GRIP_HAZARDS) {
      if (distance < hazard.fromDistance || distance > hazard.toDistance) continue;
      const from = hazard.lateralFromFraction * halfWidth;
      const to = hazard.lateralToFraction * halfWidth;
      const low = Math.min(from, to);
      const high = Math.max(from, to);
      if (lateral < low || lateral > high) continue;
      grip = Math.min(grip, hazard.gripMultiplier);
    }
    return grip;
  }

  cableTripSideAt(progress: number, lateral: number): -1 | 0 | 1 {
    const distance = THREE.MathUtils.euclideanModulo(progress, 1) * this.length;
    for (const hazard of CABLE_HAZARDS) {
      if (isCircularHazardContact(
        distance,
        lateral,
        hazard.distance,
        hazard.lateralOffset,
        this.length,
      )) {
        return hazard.lateralOffset < 0 ? -1 : 1;
      }
    }
    return 0;
  }

  boostPadLaneAt(
    courseDistanceMeters: number,
    halfWidth: number,
    approachMeters: number,
  ): number | null {
    const distance = THREE.MathUtils.euclideanModulo(courseDistanceMeters, this.length);
    const pads = PRODUCTION.boostPads;
    let lane: number | null = null;
    let nearest = Infinity;
    for (const pad of pads.pads) {
      const gap = THREE.MathUtils.euclideanModulo(
        pad.distance - distance + this.length / 2,
        this.length,
      ) - this.length / 2;
      if (gap > approachMeters || gap < -pads.halfLengthMetres) continue;
      if (Math.abs(gap) >= nearest) continue;
      nearest = Math.abs(gap);
      lane = pad.lateralFraction * halfWidth;
    }
    return lane;
  }

  isOnBoostPad(progress: number, lateral: number, halfWidth: number): boolean {
    const distance = THREE.MathUtils.euclideanModulo(progress, 1) * this.length;
    const pads = PRODUCTION.boostPads;
    for (const pad of pads.pads) {
      const along = Math.abs(
        THREE.MathUtils.euclideanModulo(
          distance - pad.distance + this.length / 2,
          this.length,
        ) - this.length / 2,
      );
      if (along > pads.halfLengthMetres) continue;
      const centre = pad.lateralFraction * halfWidth;
      const reach = pads.lateralHalfFraction * halfWidth;
      if (Math.abs(lateral - centre) <= reach) return true;
    }
    return false;
  }

  sectorLabelAt(progress: number): string {
    const station = this.stationAtProgress(progress);
    return station.sequence_name || SECTOR_LABELS[station.sector] || station.sector;
  }

  musicAt(progress: number): MusicProfile {
    const distance = THREE.MathUtils.euclideanModulo(progress, 1) * this.length;
    let active = PRODUCTION.music.triggers[0];
    for (const trigger of PRODUCTION.music.triggers) {
      if (trigger.distance > distance) break;
      active = trigger;
    }
    return active.levels;
  }

  /**
   * One authored room: the conveyor underpass, continued across the lap wrap
   * because the accepted massing puts a support 4 m behind the start line. The
   * rest of the pan is open air, which is the point of the map.
   */
  audioZoneAt(progress: number): AudioZone {
    return resolveAudioZone(
      THREE.MathUtils.euclideanModulo(progress, 1) * this.length,
      PRODUCTION.audio.zones,
      PRODUCTION.audio.defaultZone,
    ) as AudioZone;
  }

  updateAtmosphere(): boolean {
    return false;
  }

  vehicleHoverHeight(_speedMetersPerSecond: number, boostActive: boolean): number {
    // P19 hover clearance: the stabiliser ring bottoms out 0.892 m below the
    // model origin, so the old 0.95/1.1 left the ring 0.06 m off the deck —
    // touching it on any bank. These carry 0.29/0.45 m of ring clearance.
    return boostActive ? 1.34 : 1.18;
  }

  setCheckpointProgress(nextCheckpointIndex: number): void {
    const indicators = this.checkpointIndicatorMesh;
    if (!indicators) return;
    for (let order = 0; order < CHECKPOINTS.count; order += 1) {
      const color = order === 0
        ? nextCheckpointIndex === 0 ? CHECKPOINT_PENDING : CHECKPOINT_INACTIVE
        : nextCheckpointIndex === 0 || order < nextCheckpointIndex
          ? CHECKPOINT_PASSED
          : order === nextCheckpointIndex
            ? CHECKPOINT_PENDING
            : CHECKPOINT_INACTIVE;
      for (let part = 0; part < 3; part += 1) {
        indicators.setColorAt(order * 3 + part, color);
      }
    }
    if (indicators.instanceColor) indicators.instanceColor.needsUpdate = true;
  }

  setLapBoard(current: number, total: number): void {
    const context = this.lapBoardContext;
    if (!context || !this.lapBoardTexture) return;
    const board = PRODUCTION.lapBoard;
    context.fillStyle = board.background;
    context.fillRect(0, 0, 512, 192);
    context.strokeStyle = board.foreground;
    context.lineWidth = 10;
    context.strokeRect(7, 7, 498, 178);
    context.fillStyle = board.foreground;
    context.font = "700 68px monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(
      board.template
        .replace("{current}", String(Math.min(current, total)))
        .replace("{total}", String(total)),
      256,
      86,
    );
    context.fillStyle = "#9c8f7c";
    context.font = "600 24px monospace";
    context.fillText(board.subtitle, 256, 145);
    this.lapBoardTexture.needsUpdate = true;
  }

  recoveryProgressFor(progress: number): number {
    const distance = THREE.MathUtils.euclideanModulo(progress, 1) * this.length;
    const index = Math.floor(distance / CENTRELINE.station_spacing_m)
      % GRID_AND_RECOVERY.recovery.transforms.length;
    return GRID_AND_RECOVERY.recovery.transforms[index].station_m / this.length;
  }

  rivalGridStart(identity: string): RivalGridStart | null {
    const transform = GRID_AND_RECOVERY.grid.transforms.find(
      (candidate) => candidate.identity === identity,
    );
    if (!transform || identity === "WORKS 07") return null;
    const raceDistanceMeters = transform.station_m === 0
      ? 0
      : transform.station_m - this.length;
    return {
      raceDistanceMeters,
      courseDistanceMeters: raceDistanceMeters,
      // Accepted lateral offsets use the supplied +X station normal. The
      // runtime basis uses tangent × up, so the sign is intentionally flipped.
      lateralMeters: -transform.lateral_offset_m,
    };
  }

  private stationAtProgress(progress: number): BitterpanStation {
    const index = Math.floor(
      THREE.MathUtils.euclideanModulo(progress, 1) * this.stations.length,
    ) % this.stations.length;
    return this.stations[index];
  }

  private createTurns(): BitterpanTurn[] {
    return SECTORS.authored_primitives
      .filter((primitive) => primitive.kind === "arc" && primitive.radius_m !== null)
      .map((primitive) => {
        const midpoint = (primitive.from_m + primitive.to_m) / 2;
        const curvature = this.stations[stationIndexAtDistance(midpoint)].curvature;
        return {
          entryDistance: primitive.from_m,
          exitDistance: primitive.to_m,
          radius: primitive.radius_m ?? Number.POSITIVE_INFINITY,
          direction: curvature >= 0 ? "right" as const : "left" as const,
        };
      })
      .filter((turn) => turn.radius < 600)
      .sort((a, b) => a.entryDistance - b.entryDistance);
  }

  private createCheckpointMarkers(): THREE.InstancedMesh {
    const geometry = new THREE.BoxGeometry(0.52, 1, 0.52);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      fog: true,
      toneMapped: false,
    });
    const indicators = new THREE.InstancedMesh(
      geometry,
      material,
      CHECKPOINTS.count * 3,
    );
    indicators.name = "map02_checkpoint_pylons";
    indicators.frustumCulled = true;
    const transform = new THREE.Object3D();
    const basis = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    for (const checkpoint of CHECKPOINTS.checkpoints) {
      const sample = this.sampleAtDistance(checkpoint.station_m);
      basis.makeBasis(
        sample.right,
        sample.up,
        sample.tangent.clone().multiplyScalar(-1),
      );
      quaternion.setFromRotationMatrix(basis);
      for (let sideIndex = 0; sideIndex < 2; sideIndex += 1) {
        const side = sideIndex === 0 ? -1 : 1;
        // P13: the pan's deck width varies station to station, so the authored
        // gate half-width is a floor-checked value, not a free one. Measured
        // against the authored stations, the tightest Map 02 gate is CP06 at
        // 4.00 m of centre clearance (3.74 m to the pylon's inner face), so this
        // floor binds nowhere today — it is here so a re-authored station cannot
        // quietly stand a 12 m pylon on the racing surface.
        transform.position.copy(sample.position)
          .addScaledVector(
            sample.right,
            resolveGatePostLateral(sample.halfWidth, checkpoint.half_width_m, side),
          )
          .addScaledVector(sample.up, checkpoint.height_m / 2);
        transform.quaternion.copy(quaternion);
        transform.scale.set(1, checkpoint.height_m, 1);
        transform.updateMatrix();
        indicators.setMatrixAt(checkpoint.order * 3 + sideIndex, transform.matrix);
      }
      transform.position.copy(sample.position)
        .addScaledVector(sample.up, checkpoint.height_m - 0.18);
      transform.quaternion.copy(quaternion);
      transform.scale.set(checkpoint.half_width_m * 2, 0.28, 0.72);
      transform.updateMatrix();
      indicators.setMatrixAt(checkpoint.order * 3 + 2, transform.matrix);
    }
    indicators.instanceMatrix.needsUpdate = true;
    this.checkpointIndicatorMesh = indicators;
    return indicators;
  }

  private createRouteReadLayer(): THREE.Group {
    const routeRead = new THREE.Group();
    routeRead.name = "map02_route_read_layer";
    routeRead.add(
      this.createDeckOverlay(),
      this.createEdgeBands(),
      this.createCentreDashes(),
    );
    return routeRead;
  }

  private createDeckOverlay(): THREE.Mesh {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const surfaceLift = 0.045;
    for (let index = 0; index < this.stations.length; index += 1) {
      const sample = this.sample(index / this.stations.length);
      const color = ROUTE_DECK_BY_SECTOR[this.stations[index].sector]
        ?? ROUTE_DECK_BY_SECTOR.S2;
      for (const side of [-1, 1] as const) {
        const point = sample.position.clone()
          .addScaledVector(sample.right, side * (sample.halfWidth - 0.32))
          .addScaledVector(sample.up, surfaceLift);
        positions.push(point.x, point.y, point.z);
        colors.push(color.r, color.g, color.b);
      }
    }
    for (let index = 0; index < this.stations.length; index += 1) {
      const next = (index + 1) % this.stations.length;
      const left = index * 2;
      const right = left + 1;
      const nextLeft = next * 2;
      const nextRight = nextLeft + 1;
      indices.push(left, right, nextRight, left, nextRight, nextLeft);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      fog: true,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = "map02_route_deck_read_surface";
    // P20.1. This overlay IS Bitterpan's drivable deck: the accepted blockout
    // road under it is hidden, so it is the only surface the craft's contact
    // shadow can land on. An unlit material cannot take a shadow, so when
    // shadows are on `promoteUnlitShadowReceivers` in shadows.ts swaps this
    // material for a shadow-only stand-in by mesh name — done there rather than
    // here so the whole shadow decision lives in one module and this map's
    // chunk carries no shadow code.
    mesh.receiveShadow = true;
    return mesh;
  }

  private createEdgeBands(): THREE.Mesh {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const bandWidth = 0.58;
    const surfaceLift = 0.065;
    const appendVertex = (point: THREE.Vector3, color: THREE.Color): number => {
      positions.push(point.x, point.y, point.z);
      colors.push(color.r, color.g, color.b);
      return positions.length / 3 - 1;
    };

    for (const side of [-1, 1] as const) {
      const color = side < 0 ? ROUTE_EDGE_LEFT : ROUTE_EDGE_RIGHT;
      const firstVertex = positions.length / 3;
      for (let index = 0; index < this.stations.length; index += 1) {
        const sample = this.sample(index / this.stations.length);
        const edgeOffset = sample.halfWidth - 0.34;
        const inner = sample.position.clone()
          .addScaledVector(sample.right, side * (edgeOffset - bandWidth))
          .addScaledVector(sample.up, surfaceLift);
        const outer = sample.position.clone()
          .addScaledVector(sample.right, side * edgeOffset)
          .addScaledVector(sample.up, surfaceLift);
        appendVertex(inner, color);
        appendVertex(outer, color);
      }
      for (let index = 0; index < this.stations.length; index += 1) {
        const next = (index + 1) % this.stations.length;
        const inner = firstVertex + index * 2;
        const outer = inner + 1;
        const nextInner = firstVertex + next * 2;
        const nextOuter = nextInner + 1;
        if (side < 0) indices.push(inner, nextOuter, outer, inner, nextInner, nextOuter);
        else indices.push(inner, outer, nextOuter, inner, nextOuter, nextInner);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      fog: true,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = "map02_route_edge_bands";
    return mesh;
  }

  /**
   * The authored salt drift, drawn as one ribbon per patch merged into a single
   * mesh. A grip penalty the driver cannot see is just an unfair surprise, so
   * the low-grip band is exactly the band `surfaceGripAt` tests.
   */
  private createSaltDrifts(): THREE.Mesh {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const surfaceLift = 0.055;
    for (const hazard of GRIP_HAZARDS) {
      const firstVertex = positions.length / 3;
      const nodes = driftNodeDistances(hazard.fromDistance, hazard.toDistance);
      // Darker crust where the grip loss is worst, so the three patches read as
      // three different costs rather than one repeated decal.
      const shade = SALT_DRIFT_COLOR.clone().multiplyScalar(
        0.72 + hazard.gripMultiplier * 0.28,
      );
      for (let node = 0; node < nodes.length; node += 1) {
        const distance = nodes[node];
        const sample = this.sampleAtDistance(distance);
        // The authored band is clamped into the deck so the drift never floats
        // over the run-off it is not authored to cover.
        const inner = THREE.MathUtils.clamp(
          hazard.lateralToFraction * sample.halfWidth,
          -sample.halfWidth + 0.35,
          sample.halfWidth - 0.35,
        );
        const outer = THREE.MathUtils.clamp(
          hazard.lateralFromFraction * sample.halfWidth,
          -sample.halfWidth + 0.35,
          sample.halfWidth - 0.35,
        );
        // Along the road: the crust arrives and leaves, it does not start.
        const along = Math.min(
          smoothstep(0, DRIFT_END_FADE_METRES, distance - hazard.fromDistance),
          smoothstep(0, DRIFT_END_FADE_METRES, hazard.toDistance - distance),
        );
        // Across the road: full where the grip band is worst, gone by the time
        // it reaches the racing line, so the driver sees crust thinning rather
        // than a slab edge. The FULL band is still the band `surfaceGripAt`
        // tests — only the paint's opacity falls off, never its extent.
        const width = inner - outer;
        const towardInner = Math.sign(width) || 1;
        const innerFadeMetres = Math.min(
          DRIFT_INNER_FADE_METRES,
          Math.abs(width) * 0.45,
        );
        const outerFadeMetres = Math.min(
          DRIFT_OUTER_FADE_METRES,
          Math.abs(width) * 0.2,
        );
        const columns: [number, number][] = [
          [outer, 0],
          [outer + towardInner * outerFadeMetres, 1],
          [inner - towardInner * innerFadeMetres, 1],
          [inner, 0],
        ];
        for (const [offset, across] of columns) {
          const point = sample.position.clone()
            .addScaledVector(sample.right, offset)
            .addScaledVector(sample.up, surfaceLift);
          positions.push(point.x, point.y, point.z);
          // A little deterministic mottle so the patch has crust grain rather
          // than one flat fill. Cheap: it rides the vertex colour that is
          // already there instead of a second texture and a second draw call.
          const grain = 0.94 + 0.12 * hashUnit(distance * 3.1 + offset * 7.7);
          colors.push(
            shade.r * grain,
            shade.g * grain,
            shade.b * grain,
            across * along * DRIFT_PEAK_ALPHA,
          );
        }
      }
      for (let node = 0; node < nodes.length - 1; node += 1) {
        const a = firstVertex + node * 4;
        const b = firstVertex + (node + 1) * 4;
        for (let column = 0; column < 3; column += 1) {
          indices.push(
            a + column, a + column + 1, b + column + 1,
            a + column, b + column + 1, b + column,
          );
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 4));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        fog: true,
        // P20.2: was `toneMapped: false`, which put the patch at 179.5 against
        // a 69.7 deck — 2.5x the road and brighter than the sky, which is what
        // made a grip telegraph read as a concrete ramp. Graded with everything
        // else it still brightens well before entry; it just stops being the
        // brightest thing in the frame.
        toneMapped: true,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        // MEASURED, not assumed: a transparent DoubleSide material is drawn in
        // TWO passes by WebGLRenderer (back faces, then front), so turning this
        // mesh transparent silently doubled it from 1 draw call to 2 and put
        // the phase over its whole budget on one material flag. The patch lies
        // flat on the deck and is read from above; there is no back face to
        // sort against a front face, so one pass is not an approximation of
        // two, it is the same picture. `shots/p20.2/probe-calls.mjs` reads the
        // per-mesh cost by hiding it and diffing renderer.info.
        forceSinglePass: true,
      }),
    );
    mesh.name = "map02_salt_drift_patches";
    // Blended paint over an opaque deck: it must not write depth over the edge
    // band that sits a centimetre above it, and it must draw after the deck.
    mesh.renderOrder = 1;
    return mesh;
  }

  /**
   * The four authored pads, one instanced draw, sized from the live half-width.
   *
   * P20.2: the pad is painted rather than plated. P19 tone-mapped it and
   * narrowed it, which fixed the glow, but it was still ONE flat cyan value
   * across its whole footprint, and a uniform rectangle on a road reads as an
   * object lying on the road whatever its brightness. It now carries a
   * procedural chevron ladder — a dark border, a mid field, bright chevrons —
   * so the eye gets interior structure and resolves it as a marking.
   *
   * Geometry, transform, footprint and trigger are BYTE-IDENTICAL to P19. The
   * painted extent is the trigger extent; only the material changed. That is
   * deliberate: the brief allows the paint to overhang the trigger by up to
   * 0.6 m, and taking that option would have desynchronised the mesh from the
   * footprint `validate-furniture.mjs` models from the same JSON.
   */
  private createBoostPads(): THREE.InstancedMesh {
    const pads = PRODUCTION.boostPads;
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 0.07, 1),
      new THREE.MeshBasicMaterial({
        color: BOOST_PAD_COLOR,
        map: createBoostPadTexture(),
        fog: true,
        // P19: tone-mapped now. Unmapped, the pad was a flat cyan slab glowing
        // over the deck; mapped, it reads as paint under the same sun.
        toneMapped: true,
      }),
      pads.pads.length,
    );
    mesh.name = "map02_boost_pads";
    const transform = new THREE.Object3D();
    const basis = new THREE.Matrix4();
    for (let index = 0; index < pads.pads.length; index += 1) {
      const pad = pads.pads[index];
      const sample = this.sampleAtDistance(pad.distance);
      transform.position.copy(sample.position)
        .addScaledVector(sample.right, pad.lateralFraction * sample.halfWidth)
        .addScaledVector(sample.up, 0.085);
      basis.makeBasis(
        sample.right,
        sample.up,
        sample.tangent.clone().multiplyScalar(-1),
      );
      transform.quaternion.setFromRotationMatrix(basis);
      transform.scale.set(
        pads.lateralHalfFraction * sample.halfWidth * 2,
        1,
        pads.halfLengthMetres * 2,
      );
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }

  /** The authored cable coils, at the exact lateral `cableTripSideAt` tests. */
  private createCableCoils(): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(
      new THREE.TorusGeometry(1.35, 0.4, 5, 9),
      new THREE.MeshBasicMaterial({
        color: CABLE_COIL_COLOR,
        fog: true,
        toneMapped: false,
      }),
      CABLE_HAZARDS.length,
    );
    mesh.name = "map02_cable_coils";
    // P20.1. A trip hazard the player is meant to see and avoid; a coil with no
    // shadow reads as painted onto the deck rather than lying on it.
    mesh.castShadow = true;
    const transform = new THREE.Object3D();
    const basis = new THREE.Matrix4();
    for (let index = 0; index < CABLE_HAZARDS.length; index += 1) {
      const hazard = CABLE_HAZARDS[index];
      const sample = this.sampleAtDistance(hazard.distance);
      transform.position.copy(sample.position)
        .addScaledVector(sample.right, hazard.lateralOffset)
        .addScaledVector(sample.up, 0.4);
      // The torus lies flat on the deck: its local +Z becomes the surface up.
      basis.makeBasis(sample.right, sample.tangent, sample.up);
      transform.quaternion.setFromRotationMatrix(basis);
      transform.scale.set(1, 1, 1);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }

  /**
   * The lap board hangs under the accepted `OCC2_conveyor_span` soffit — the one
   * authored element already over the drivable corridor — so Map 02 gets a
   * world-space lap read without introducing massing the freeze does not have.
   */
  private createLapBoard(): THREE.Mesh {
    const board = PRODUCTION.lapBoard;
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 192;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not create the Bitterpan lap board.");
    context.imageSmoothingEnabled = false;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    this.lapBoardContext = context;
    this.lapBoardTexture = texture;

    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(board.widthMetres, board.boardHeightMetres),
      new THREE.MeshBasicMaterial({
        map: texture,
        fog: true,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    );
    mesh.name = "map02_lap_board";
    const sample = this.sampleAtDistance(board.distance);
    mesh.position.copy(sample.position)
      .addScaledVector(sample.right, board.lateralOffset)
      .addScaledVector(sample.up, board.heightMetres);
    // Local +Z faces back down the course, so the board reads to a driver on
    // approach rather than to the empty pan behind the underpass.
    const basis = new THREE.Matrix4().makeBasis(
      sample.right,
      sample.up,
      sample.tangent.clone().multiplyScalar(-1),
    );
    mesh.quaternion.setFromRotationMatrix(basis);
    return mesh;
  }

  /**
   * P20.2 — the centre line is paint, not a plank.
   *
   * It used to be a `BoxGeometry(0.34, 0.055, 7.5)` in an unlit,
   * tone-mapping-exempt `MeshBasicMaterial` at 0.075 m of lift. Three separate
   * things made that read as an obstacle from the chase camera: the box has
   * SIDES, so the nearest dash showed a lit 5.5 cm wall edge-on; 7.5 m is long
   * enough at 317 km/h to fill the lane ahead of the craft; and exempting it
   * from the grade let it sit at 2x the deck's luma, brighter than anything
   * else on the road.
   *
   * It is now a zero-thickness quad — no side to catch the light — 4.5 m long
   * on the same 25 m rhythm, lit and tone-mapped like the world rather than
   * punched through it. The colour is the value that lands the nearest dash
   * inside [deck + 30, deck + 70] measured at 1280x720 across the S1/S2/S3
   * deck keys; see `shots/p20.2/measure.py`.
   *
   * Still ONE draw call: same InstancedMesh, 2 triangles an instance instead of
   * 12.
   */
  private createCentreDashes(): THREE.InstancedMesh {
    const spacing = 25;
    const count = Math.floor(this.length / spacing);
    // A plane lies in local XY with its normal on local +Z, so the basis below
    // puts local +Z on the surface up and the quad lies flat on the deck.
    const geometry = new THREE.PlaneGeometry(
      CENTRE_DASH_WIDTH_METRES,
      CENTRE_DASH_LENGTH_METRES,
    );
    // Unlit, like the deck read surface it is painted on, but NOT
    // tone-mapping-exempt the way that surface still is. Matching the deck's
    // shading model is what makes the dash/deck contrast a constant the phase
    // can pin: a Lambert dash re-lights per sector against an unlit road, so
    // the same colour measured deck+52 in S1 and deck+9 in S3 and no single
    // value satisfies the window. Unlit + graded is one number everywhere.
    const material = new THREE.MeshBasicMaterial({
      color: CENTRE_DASH_COLOR,
      fog: true,
      // P20.2: was `toneMapped: false`. Paint takes the same grade as the road
      // it is painted on; exempting it is what made it glow.
      toneMapped: true,
      // The dash sits 1 cm over the deck read surface, which is enough at 4 m
      // and not enough at 400 m. The offset keeps the far dashes off the deck's
      // own z without lifting the near ones into the air.
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    const dashes = new THREE.InstancedMesh(geometry, material, count);
    dashes.name = "map02_route_centre_dashes";
    const transform = new THREE.Object3D();
    const basis = new THREE.Matrix4();
    for (let index = 0; index < count; index += 1) {
      const sample = this.sampleAtDistance(index * spacing + spacing / 2);
      transform.position.copy(sample.position)
        .addScaledVector(sample.up, CENTRE_DASH_LIFT_METRES);
      basis.makeBasis(sample.right, sample.tangent, sample.up);
      transform.quaternion.setFromRotationMatrix(basis);
      transform.scale.set(1, 1, 1);
      transform.updateMatrix();
      dashes.setMatrixAt(index, transform.matrix);
    }
    dashes.instanceMatrix.needsUpdate = true;
    return dashes;
  }
}
