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
  TimeOfDayStop,
  TurnCue,
} from "./course";

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
const BOOST_PAD_COLOR = new THREE.Color(0x77dce3);
const CABLE_COIL_COLOR = new THREE.Color(0xf06a32);
const SALT_DRIFT_COLOR = new THREE.Color(0xe8e2cf);

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
    return boostActive ? 1.1 : 0.95;
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
    const stepMetres = 5;
    for (const hazard of GRIP_HAZARDS) {
      const firstVertex = positions.length / 3;
      const steps = Math.max(
        1,
        Math.round((hazard.toDistance - hazard.fromDistance) / stepMetres),
      );
      // Darker crust where the grip loss is worst, so the three patches read as
      // three different costs rather than one repeated decal.
      const shade = SALT_DRIFT_COLOR.clone().multiplyScalar(
        0.72 + hazard.gripMultiplier * 0.28,
      );
      for (let step = 0; step <= steps; step += 1) {
        const distance = hazard.fromDistance
          + ((hazard.toDistance - hazard.fromDistance) * step) / steps;
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
        for (const offset of [inner, outer]) {
          const point = sample.position.clone()
            .addScaledVector(sample.right, offset)
            .addScaledVector(sample.up, surfaceLift);
          positions.push(point.x, point.y, point.z);
          colors.push(shade.r, shade.g, shade.b);
        }
      }
      for (let step = 0; step < steps; step += 1) {
        const a = firstVertex + step * 2;
        const b = a + 1;
        const c = firstVertex + (step + 1) * 2;
        const d = c + 1;
        indices.push(a, b, d, a, d, c);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        fog: true,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    );
    mesh.name = "map02_salt_drift_patches";
    return mesh;
  }

  /** The four authored pads, one instanced draw, sized from the live half-width. */
  private createBoostPads(): THREE.InstancedMesh {
    const pads = PRODUCTION.boostPads;
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 0.07, 1),
      new THREE.MeshBasicMaterial({
        color: BOOST_PAD_COLOR,
        fog: true,
        toneMapped: false,
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

  private createCentreDashes(): THREE.InstancedMesh {
    const spacing = 25;
    const count = Math.floor(this.length / spacing);
    const geometry = new THREE.BoxGeometry(0.34, 0.055, 7.5);
    const material = new THREE.MeshBasicMaterial({
      color: 0xdce6d4,
      fog: true,
      toneMapped: false,
    });
    const dashes = new THREE.InstancedMesh(geometry, material, count);
    dashes.name = "map02_route_centre_dashes";
    const transform = new THREE.Object3D();
    const basis = new THREE.Matrix4();
    for (let index = 0; index < count; index += 1) {
      const sample = this.sampleAtDistance(index * spacing + spacing / 2);
      transform.position.copy(sample.position).addScaledVector(sample.up, 0.075);
      basis.makeBasis(
        sample.right,
        sample.up,
        sample.tangent.clone().multiplyScalar(-1),
      );
      transform.quaternion.setFromRotationMatrix(basis);
      transform.scale.set(1, 1, 1);
      transform.updateMatrix();
      dashes.setMatrixAt(index, transform.matrix);
    }
    dashes.instanceMatrix.needsUpdate = true;
    return dashes;
  }
}
