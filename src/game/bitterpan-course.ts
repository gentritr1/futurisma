import * as THREE from "three";
import centrelineJson from "./data/map02/CENTRELINE_STATIONS.json";
import checkpointsJson from "./data/map02/CHECKPOINTS.json";
import gridAndRecoveryJson from "./data/map02/GRID_AND_RECOVERY.json";
import sectorsJson from "./data/map02/SECTORS_AND_SEQUENCES.json";
import type {
  CourseLightingProfile,
  CourseProjection,
  CourseSample,
  FogProfile,
  MusicProfile,
  RaceCourse,
  RivalGridStart,
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

const CENTRELINE = centrelineJson as unknown as BitterpanCentrelineData;
const CHECKPOINTS = checkpointsJson as unknown as BitterpanCheckpointData;
const GRID_AND_RECOVERY = gridAndRecoveryJson as unknown as BitterpanGridRecoveryData;
const SECTORS = sectorsJson as unknown as BitterpanSectorData;
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
const MUSIC_PROFILE: MusicProfile = {
  trance: 1,
  jungle: 0,
  deep_dnb: 1,
  techstep: 1,
};

const FOG_BY_SECTOR: Record<string, FogProfile> = {
  S1: { density: 0.00072, color: new THREE.Color(0xc7b997) },
  S2: { density: 0.00048, color: new THREE.Color(0xd5cfb9) },
  S3: { density: 0.00082, color: new THREE.Color(0xaeb8b2) },
};

const LIGHTING_BY_SECTOR: Record<string, CourseLightingProfile> = {
  S1: {
    sky: new THREE.Color(0xc9b994),
    ground: new THREE.Color(0x665c48),
    key: new THREE.Color(0xffe0a8),
    rim: new THREE.Color(0xd9904d),
    hemisphereIntensity: 1.25,
    keyIntensity: 1.55,
    rimIntensity: 0.7,
  },
  S2: {
    sky: new THREE.Color(0xd7d2bf),
    ground: new THREE.Color(0x6f6b60),
    key: new THREE.Color(0xffedc7),
    rim: new THREE.Color(0xb6c3be),
    hemisphereIntensity: 1.35,
    keyIntensity: 1.45,
    rimIntensity: 0.55,
  },
  S3: {
    sky: new THREE.Color(0xb6c0bb),
    ground: new THREE.Color(0x555e5a),
    key: new THREE.Color(0xe4eadc),
    rim: new THREE.Color(0x86aaa7),
    hemisphereIntensity: 1.2,
    keyIntensity: 1.3,
    rimIntensity: 0.8,
  },
};

const SECTOR_LABELS: Record<string, string> = {
  S1: "HARVEST BASIN",
  S2: "THE LONG BASIN",
  S3: "LOADOUT BASIN",
};

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
    edgeLeft: "C",
    edgeRight: "C",
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
  readonly surfaceGripRecoverySeconds = 0.8;

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
    target.edgeLeft = "C";
    target.edgeRight = "C";
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

  fogAt(progress: number): FogProfile {
    return FOG_BY_SECTOR[this.stationAtProgress(progress).sector] ?? FOG_BY_SECTOR.S2;
  }

  lightingAt(progress: number): CourseLightingProfile {
    return LIGHTING_BY_SECTOR[this.stationAtProgress(progress).sector]
      ?? LIGHTING_BY_SECTOR.S2;
  }

  edgeType(): "C" {
    return "C";
  }

  surfaceGripAt(): number {
    return 1;
  }

  cableTripSideAt(): 0 {
    return 0;
  }

  isOnBoostPad(): boolean {
    return false;
  }

  sectorLabelAt(progress: number): string {
    const station = this.stationAtProgress(progress);
    return station.sequence_name || SECTOR_LABELS[station.sector] || station.sector;
  }

  musicAt(): MusicProfile {
    return MUSIC_PROFILE;
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

  setLapBoard(): void {
    // The v0.2a.1 blockout provides no authored lap-board surface. HUD timing
    // remains authoritative until the Map 02 art phase supplies one.
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
        transform.position.copy(sample.position)
          .addScaledVector(sample.right, checkpoint.half_width_m * side)
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
