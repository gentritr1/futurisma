import * as THREE from "three";
import greenwaterJson from "./data/greenwater-blockout.json";
import {
  createApronResolution,
  resolveApron,
  resolveApronProfile,
} from "./apron.js";
import type { ApronResolution, ApronTable } from "./apron.js";
import { isCircularHazardContact } from "./race-rules";

export type EdgeType = "A" | "B" | "C";

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
  recovery: {
    holdSeconds: number;
    reinsertSpeedKph: number;
    immunitySeconds: number;
  };
  landmarkProxies: RawLandmark[];
  hazards: RawHazard[];
  music: { triggers: RawMusicTrigger[] };
  apron: ApronTable;
}

export type { ApronResolution } from "./apron.js";

export interface CourseSample {
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
}

export type CourseKind = "greenwater" | "bitterpan";

export interface RivalGridStart {
  raceDistanceMeters: number;
  courseDistanceMeters: number;
  lateralMeters: number;
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
  createSampleScratch(): CourseSample;
  createProjectionScratch(): CourseProjection;
  sample(progress: number, target?: CourseSample): CourseSample;
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
  isOnBoostPad(progress: number, lateral: number, halfWidth: number): boolean;
  sectorLabelAt(progress: number): string;
  musicAt(progress: number): MusicProfile;
  updateAtmosphere(elapsedSeconds: number, reducedMotion: boolean): boolean;
  vehicleHoverHeight(speedMetersPerSecond: number, boostActive: boolean): number;
  setCheckpointProgress(nextCheckpointIndex: number): void;
  setLapBoard(current: number, total: number): void;
  recoveryProgressFor(progress: number, previousCheckpointIndex: number): number;
  rivalGridStart(identity: string): RivalGridStart | null;
}

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const COURSE_BASIS = new THREE.Matrix4();
const COURSE_BACK = new THREE.Vector3();
const MAP = greenwaterJson as unknown as GreenwaterMapData;
const APRON = MAP.apron;
const ATMOSPHERE_UPDATE_INTERVAL_SECONDS = 1 / 30;
const LIGHTING_CROSSFADE_METRES = 90;
// The run-off tucks just under the deck edge so the seam cannot open a crack.
const APRON_SEAM_OVERLAP_METRES = 0.06;
const EDGE_FURNITURE_CLEARANCE_METRES = 4.5;
const EDGE_FURNITURE_SAFETY_MARGIN_METRES = 0.25;
const TURN_CHEVRON_CLEARANCE_METRES = 9;
const BOOST_PAD_DISTANCES = [1705, 1815, 1925, 2035] as const;
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
const SECTOR_PALETTE_DEFINITIONS = [
  {
    sector: "RUNWAY_START",
    distance: 0,
    key: 0xf4f7f9,
    keyIntensity: 1.75,
    sky: 0xd6e0e6,
    ground: 0x4d5852,
    hemisphereIntensity: 1.45,
    fog: 0x8e9ba0,
    fogDensity: 0.0016,
  },
  {
    sector: "T1_CRADLE_BEND",
    distance: 221.998,
    key: 0xeef2ea,
    keyIntensity: 1.7,
    sky: 0xc9d6c4,
    ground: 0x475044,
    hemisphereIntensity: 1.5,
    fog: 0x8a958f,
    fogDensity: 0.0018,
  },
  {
    sector: "WATER_TABLE",
    distance: 377.997,
    key: 0xd2e2e0,
    keyIntensity: 1.5,
    sky: 0x86bab2,
    ground: 0x24403a,
    hemisphereIntensity: 1.55,
    fog: 0x7fa8a2,
    fogDensity: 0.00215,
  },
  {
    sector: "LINK_APRON",
    distance: 587.996,
    key: 0xcedcd6,
    keyIntensity: 1.45,
    sky: 0x7fada6,
    ground: 0x243630,
    hemisphereIntensity: 1.45,
    fog: 0x6f938e,
    fogDensity: 0.00295,
  },
  {
    sector: "HANGAR_SIX",
    distance: 617.996,
    key: 0xffbd63,
    keyIntensity: 0.85,
    sky: 0x6f6355,
    ground: 0x1b1a18,
    hemisphereIntensity: 1,
    fog: 0x3f3a34,
    fogDensity: 0.0042,
  },
  {
    sector: "HANGAR_EXIT",
    distance: 817.994,
    key: 0xffd08a,
    keyIntensity: 1.3,
    sky: 0x8e8371,
    ground: 0x272420,
    hemisphereIntensity: 1.2,
    fog: 0x4d4a41,
    fogDensity: 0.00355,
  },
  {
    sector: "GREENWATER_SWEEP",
    distance: 847.994,
    key: 0xe6f0d8,
    keyIntensity: 1.6,
    sky: 0x8fb8b0,
    ground: 0x25423c,
    hemisphereIntensity: 1.65,
    fog: 0x6f8a83,
    fogDensity: 0.0026,
  },
  {
    sector: "CANOPY_PASSAGE",
    distance: 1129.992,
    key: 0xffe9a8,
    keyIntensity: 1.2,
    sky: 0x7fa06a,
    ground: 0x1e3320,
    hemisphereIntensity: 1.7,
    fog: 0x51684a,
    fogDensity: 0.003,
  },
  {
    sector: "THE_ELBOW",
    distance: 1481.99,
    key: 0xf0e8b4,
    keyIntensity: 1.4,
    sky: 0x92ab7e,
    ground: 0x283a28,
    hemisphereIntensity: 1.6,
    fog: 0x60755a,
    fogDensity: 0.0027,
  },
  {
    sector: "FUEL_ROW",
    distance: 1591.989,
    key: 0xffb970,
    keyIntensity: 1.6,
    sky: 0xa8a48c,
    ground: 0x3a3428,
    hemisphereIntensity: 1.35,
    fog: 0x77776b,
    fogDensity: 0.0019,
  },
  {
    sector: "T10_TOTEM_TURN",
    distance: 2121.985,
    key: 0xd9dee4,
    keyIntensity: 1.25,
    sky: 0x77828c,
    ground: 0x22262a,
    hemisphereIntensity: 1.15,
    fog: 0x4a5358,
    fogDensity: 0.0023,
  },
  {
    sector: "RUNWAY_HOME",
    distance: 2255.984,
    key: 0xf4f7f9,
    keyIntensity: 1.8,
    sky: 0xd6e0e6,
    ground: 0x4d5852,
    hemisphereIntensity: 1.5,
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

function edgeFurnitureOffset(
  sample: CourseSample,
  side: -1 | 1,
  visibleWidth: number,
  clearance = EDGE_FURNITURE_CLEARANCE_METRES,
): number {
  return side * (
    sample.halfWidth
    + clearance
    + EDGE_FURNITURE_SAFETY_MARGIN_METRES
    + visibleWidth / 2
  );
}

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
  readonly startProgress = 0.002;
  readonly startLateral = 0;
  readonly recoveryHoldSeconds = MAP.recovery.holdSeconds;
  readonly recoverySpeedMps = MAP.recovery.reinsertSpeedKph / 3.6;
  readonly recoveryImmunitySeconds = MAP.recovery.immunitySeconds;

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
  };
  private readonly cableHazards = MAP.hazards.filter(
    (hazard) => hazard.type === "cable_coil" && hazard.distance !== undefined,
  );
  private readonly steamVents: SteamVentRuntime[] = [];
  private readonly atmosphereTransform = new THREE.Object3D();
  private atmospherePreviousElapsedSeconds = -1;
  private atmosphereNextUpdateAt = 0;
  private steamPuffs: THREE.InstancedMesh | null = null;
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

  isOnBoostPad(progress: number, lateral: number, halfWidth: number): boolean {
    if (lateral < halfWidth * 0.12 || lateral > halfWidth * 0.78) return false;
    const distance = THREE.MathUtils.euclideanModulo(progress, 1) * this.length;
    return BOOST_PAD_DISTANCES.some(
      (padDistance) => Math.abs(distance - padDistance) <= 10,
    );
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
    if (puffs && warnings) {
      const puffsPerVent = 6;
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

        for (let puffIndex = 0; puffIndex < puffsPerVent; puffIndex += 1) {
          const instanceIndex = ventIndex * puffsPerVent + puffIndex;
          const ageSeconds = cycleTime
            - vent.telegraphSeconds
            - puffIndex * 0.16;
          const age = ageSeconds / 1.18;
          const active = age >= 0 && age <= 1;
          const fade = active ? Math.sin(age * Math.PI) : 0;
          // Keep the vent readable as a hazard without letting its overlapping
          // low-poly puffs merge into a solid, rock-like silhouette.
          const scale = active
            ? (0.82 + age * 1.78) * Math.max(0.16, fade)
            : 0.001;
          const wobble = reducedMotion ? 0 : Math.sin(age * 8 + ventIndex) * age * 0.7;
          setCourseObjectTransform(
            this.atmosphereTransform,
            vent.sample,
            vent.lateralOffset + wobble,
            0.55 + Math.max(0, age) * 8.5,
            reducedMotion ? 0 : Math.cos(age * 7 + puffIndex) * age * 0.45,
            scale,
            scale * 1.5,
            scale,
          );
          puffs.setMatrixAt(instanceIndex, this.atmosphereTransform.matrix);
        }
      }
      warnings.instanceMatrix.needsUpdate = true;
      puffs.instanceMatrix.needsUpdate = true;
    }

    if (this.cargoHookPivot) {
      const amplitude = reducedMotion ? 0.1 : 0.34;
      this.cargoHookPivot.rotation.z = Math.sin(elapsed * 1.7) * amplitude;
    }
    return true;
  }

  vehicleHoverHeight(speedMetersPerSecond: number, boostActive: boolean): number {
    const dynamicHeight = boostActive ? 0.6 : speedMetersPerSecond < 11 ? 0.18 : 0.45;
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
        color.setHex(0x5b4528);
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
        color: new THREE.Color(0x4a4c42),
        outerRise: -0.35,
        innerDrop: 0.04,
      },
      {
        type: "B",
        color: new THREE.Color(0x565954),
        outerRise: 0.14,
        innerDrop: 0.02,
      },
    ];
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
          const band = surface.type === "B"
            ? (index % 2 === 0 ? 1 : 0.42)
            : 0.86 + 0.14 * (((index * 7 + (side < 0 ? 3 : 0)) % 5) / 4);
          const outerShade = surface.type === "B" ? 0.9 : 0.74;
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
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshLambertMaterial({
          color: 0xffffff,
          vertexColors: true,
          side: THREE.DoubleSide,
        }),
      );
      mesh.name = `apron_${surface.type}_${
        surface.type === "A" ? "gravel" : "rumble"
      }`;
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
    const material = new THREE.MeshBasicMaterial({ color: 0xc8ff2e });
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
    const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xff5a3c });
    const markers = new THREE.InstancedMesh(
      markerGeometry,
      markerMaterial,
      this.samples.length,
    );
    const stripGeometry = new THREE.BoxGeometry(0.58, 0.06, 4.2);
    const stripMaterial = new THREE.MeshBasicMaterial({ color: 0xff8a2e });
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
      new THREE.MeshBasicMaterial({ color: 0xffa22e }),
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
        setCourseObjectTransform(
          marker,
          sample,
          inside * sample.halfWidth * 0.68,
          0.085,
          0,
          0.34,
          0.045,
          1.55,
        );
        markers.setMatrixAt(markerIndex, marker.matrix);
        markerIndex += 1;
      }
    }
    markers.count = markerIndex;
    markers.instanceMatrix.needsUpdate = true;
    return markers;
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
    let approachIndex = 0;

    for (const turn of MAP.turns) {
      const outside = turn.direction === "left" ? 1 : -1;
      for (let index = 0; index < turn.chevronCount; index += 1) {
        const markerDistance = turn.apexDistance + (index - (turn.chevronCount - 1) / 2) * 7;
        const sample = this.sampleAtDistance(markerDistance);
        // These panels repeat around bends. The structural gap keeps their
        // projected silhouettes out of the route opening, even when several
        // boards stack in the chase camera through a fast chicane.
        const markerX = edgeFurnitureOffset(
          sample,
          outside,
          chevronBoardWidth,
          TURN_CHEVRON_CLEARANCE_METRES,
        );
        setCourseObjectTransform(
          object,
          sample,
          markerX,
          2.3,
          0,
          chevronBoardWidth,
          chevronBoardHeight,
          0.24,
        );
        chevronBoards.setMatrixAt(chevronIndex, object.matrix);
        setCourseObjectTransform(object, sample, markerX, 1.05, 0.08, 0.18, 2.1, 0.18);
        chevronPosts.setMatrixAt(chevronIndex, object.matrix);
        setCourseObjectTransform(
          object,
          sample,
          markerX,
          2.3,
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
        const markerX = edgeFurnitureOffset(sample, side, distanceBoardWidth);
        const labelBatch = boardLabels.get(boardDistance);
        if (!labelBatch) {
          throw new Error(`Missing Greenwater braking-board label ${boardDistance}M.`);
        }
        setCourseObjectTransform(
          object,
          sample,
          markerX,
          2.05,
          0.08,
          distanceBoardWidth,
          1.28,
          1,
        );
        labelBatch.mesh.setMatrixAt(labelBatch.count, object.matrix);
        labelBatch.count += 1;
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
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
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
        const x = side * (checkpoint.gateWidth / 2 + 0.7);
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
    const acid = new THREE.MeshBasicMaterial({ color: 0xc8ff2e });
    const amber = new THREE.MeshBasicMaterial({ color: 0xffa22e });
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
    const acid = new THREE.MeshBasicMaterial({ color: 0xc8ff2e });
    const white = new THREE.MeshBasicMaterial({ color: 0xb9c1bb });
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
    const sodiumMaterial = new THREE.MeshBasicMaterial({ color: 0x9a6b2f });
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
      const puffsPerVent = 6;
      const puffGeometry = new THREE.DodecahedronGeometry(1, 0);
      const puffMaterial = new THREE.MeshBasicMaterial({
        color: 0xa7b9b1,
        transparent: true,
        opacity: 0.24,
        depthWrite: false,
      });
      const puffs = new THREE.InstancedMesh(
        puffGeometry,
        puffMaterial,
        steamHazards.length * puffsPerVent,
      );
      puffs.name = "steam_vent_puffs";
      puffs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      puffs.frustumCulled = false;
      const warnings = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({ color: 0xffa22e }),
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
      new THREE.MeshBasicMaterial({ color: 0xffa22e }),
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

    const boostMaterial = new THREE.MeshBasicMaterial({ color: 0xc8ff2e });
    const boostPads = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      boostMaterial,
      BOOST_PAD_DISTANCES.length,
    );
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
