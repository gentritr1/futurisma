import * as THREE from "three";
import greenwaterJson from "./data/greenwater-blockout.json";

type EdgeType = "A" | "B" | "C";

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
}

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
}

export interface CourseProjection extends CourseSample {
  progress: number;
  lateral: number;
}

export interface TurnCue {
  direction: "LEFT" | "RIGHT";
  distance: number;
  hard: boolean;
}

export interface FogProfile {
  density: number;
  color: THREE.Color;
}

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const MAP = greenwaterJson as unknown as GreenwaterMapData;
const GAMEPLAY_FOG_SCALE = 0.58;

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x1_0000_0000;
  };
}

function poseObject(object: THREE.Object3D, sample: CourseSample): void {
  const basis = new THREE.Matrix4().makeBasis(
    sample.right,
    sample.up,
    sample.tangent.clone().multiplyScalar(-1),
  );
  object.position.copy(sample.position);
  object.quaternion.setFromRotationMatrix(basis);
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

export class GreenwaterCourse {
  readonly group = new THREE.Group();
  readonly length = MAP.centreline.lapLength;
  readonly halfWidth = 12;
  readonly checkpointCount = MAP.checkpoints.length;
  readonly defaultLapCount = MAP.race.lapCount;
  readonly minimumLapCount = MAP.race.lapCountRange[0];
  readonly maximumLapCount = MAP.race.lapCountRange[1];
  readonly mapName = MAP.map.name;
  readonly recoveryHoldSeconds = MAP.recovery.holdSeconds;
  readonly recoverySpeedMps = MAP.recovery.reinsertSpeedKph / 3.6;
  readonly recoveryImmunitySeconds = MAP.recovery.immunitySeconds;

  private readonly samples = MAP.centreline.samples;
  private readonly projectionPoints = this.samples.map(
    (sample) => new THREE.Vector3(sample.x, sample.y, sample.z),
  );
  private readonly projectionResolution = this.samples.length;
  private lapBoardTexture: THREE.CanvasTexture | null = null;
  private lapBoardContext: CanvasRenderingContext2D | null = null;

  constructor() {
    if (!MAP.centreline.closed || this.samples.length !== MAP.centreline.sampleCount) {
      throw new Error("Greenwater centreline failed its runtime invariant check.");
    }

    this.group.name = "map01_greenwater_strip";
    this.group.add(
      this.createTrackSurface(),
      this.createTrackUnderside(),
      this.createEdgeRails(),
      this.createEdgeLights(),
      this.createOpenEdgeMarkers(),
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
  }

  sample(progress: number): CourseSample {
    const wrapped = THREE.MathUtils.euclideanModulo(progress, 1);
    const scaled = wrapped * this.samples.length;
    const index = Math.floor(scaled) % this.samples.length;
    const nextIndex = (index + 1) % this.samples.length;
    const alpha = scaled - Math.floor(scaled);
    const current = this.samples[index];
    const next = this.samples[nextIndex];
    const position = this.projectionPoints[index].clone().lerp(
      this.projectionPoints[nextIndex],
      alpha,
    );
    const tangent = this.tangentAt(wrapped);
    const right = new THREE.Vector3().crossVectors(tangent, WORLD_UP).normalize();
    const up = new THREE.Vector3().crossVectors(right, tangent).normalize();
    const bank = THREE.MathUtils.lerp(current.bank, next.bank, alpha);
    if (Math.abs(bank) > 0.001) {
      const bankRotation = new THREE.Quaternion().setFromAxisAngle(
        tangent,
        THREE.MathUtils.degToRad(-bank),
      );
      right.applyQuaternion(bankRotation).normalize();
      up.applyQuaternion(bankRotation).normalize();
    }

    const before = this.tangentAt(
      THREE.MathUtils.euclideanModulo(wrapped - 8 / this.length, 1),
    );
    const after = this.tangentAt(
      THREE.MathUtils.euclideanModulo(wrapped + 8 / this.length, 1),
    );
    const curvature = THREE.MathUtils.clamp(
      new THREE.Vector3().crossVectors(before, after).dot(WORLD_UP) * 4,
      -1,
      1,
    );
    const width = THREE.MathUtils.lerp(current.w, next.w, alpha);

    return {
      position,
      tangent,
      right,
      up,
      curvature,
      width,
      halfWidth: width / 2,
      bank,
      sector: current.sector,
      edgeLeft: current.edgeL,
      edgeRight: current.edgeR,
    };
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

  project(position: THREE.Vector3, hintProgress: number): CourseProjection {
    const segmentCount = this.projectionResolution;
    const hintIndex = Math.round(
      THREE.MathUtils.euclideanModulo(hintProgress, 1) * segmentCount,
    );
    const localRadius = 42;
    let nearestDistanceSq = Number.POSITIVE_INFINITY;
    let nearestProgress = hintProgress;

    const inspectSegment = (rawIndex: number): void => {
      const index = THREE.MathUtils.euclideanModulo(rawIndex, segmentCount);
      const nextIndex = (index + 1) % segmentCount;
      const start = this.projectionPoints[index];
      const end = this.projectionPoints[nextIndex];
      const segment = end.clone().sub(start);
      const lengthSq = segment.lengthSq();
      const along = lengthSq > 0
        ? THREE.MathUtils.clamp(position.clone().sub(start).dot(segment) / lengthSq, 0, 1)
        : 0;
      const nearest = start.clone().addScaledVector(segment, along);
      const distanceSq = nearest.distanceToSquared(position);
      if (distanceSq >= nearestDistanceSq) return;
      nearestDistanceSq = distanceSq;
      nearestProgress = THREE.MathUtils.euclideanModulo((index + along) / segmentCount, 1);
    };

    for (let offset = -localRadius; offset <= localRadius; offset += 1) {
      inspectSegment(hintIndex + offset);
    }
    const globalSearchThreshold = this.halfWidth + 24;
    if (nearestDistanceSq > globalSearchThreshold * globalSearchThreshold) {
      for (let index = 0; index < segmentCount; index += 1) inspectSegment(index);
    }

    const sample = this.sample(nearestProgress);
    const difference = position.clone().sub(sample.position);
    const lateral = difference.dot(sample.right);
    return { ...sample, progress: nearestProgress, lateral };
  }

  turnAhead(progress: number, maximumDistance = 240): TurnCue | null {
    const distance = THREE.MathUtils.euclideanModulo(progress, 1) * this.length;
    let nearest: { turn: RawTurn; distance: number } | null = null;
    for (const turn of MAP.turns) {
      const inside = distance >= turn.entryDistance && distance <= turn.exitDistance;
      const distanceAhead = inside
        ? 0
        : THREE.MathUtils.euclideanModulo(turn.entryDistance - distance, this.length);
      if (distanceAhead > maximumDistance) continue;
      if (!nearest || distanceAhead < nearest.distance) nearest = { turn, distance: distanceAhead };
    }
    if (!nearest) return null;
    return {
      direction: nearest.turn.direction === "left" ? "LEFT" : "RIGHT",
      distance: nearest.distance,
      hard: nearest.turn.radius <= 85,
    };
  }

  fogAt(progress: number): FogProfile {
    const distance = THREE.MathUtils.euclideanModulo(progress, 1) * this.length;
    const zone = MAP.fog.zones.find(
      (candidate) => distance >= candidate.fromDistance && distance < candidate.toDistance,
    ) ?? MAP.fog.zones[0];
    return {
      density: zone.density * GAMEPLAY_FOG_SCALE,
      color: new THREE.Color(zone.color),
    };
  }

  edgeType(sample: CourseSample, lateral: number): EdgeType {
    return lateral >= 0 ? sample.edgeRight : sample.edgeLeft;
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

  private tangentAt(progress: number): THREE.Vector3 {
    const offset = 1 / this.samples.length;
    const before = this.positionAt(
      THREE.MathUtils.euclideanModulo(progress - offset, 1),
    );
    const after = this.positionAt(
      THREE.MathUtils.euclideanModulo(progress + offset, 1),
    );
    return after.sub(before).normalize();
  }

  private positionAt(progress: number): THREE.Vector3 {
    const scaled = progress * this.samples.length;
    const index = Math.floor(scaled) % this.samples.length;
    const alpha = scaled - Math.floor(scaled);
    return this.projectionPoints[index].clone().lerp(
      this.projectionPoints[(index + 1) % this.samples.length],
      alpha,
    );
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
          const currentBottom = current.position
            .clone()
            .addScaledVector(current.right, side * current.halfWidth)
            .addScaledVector(current.up, 0.03);
          const nextBottom = next.position
            .clone()
            .addScaledVector(next.right, side * next.halfWidth)
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
    const geometry = new THREE.BoxGeometry(0.28, 1.4, 0.28);
    const material = new THREE.MeshBasicMaterial({ color: 0xff5a3c });
    const markers = new THREE.InstancedMesh(geometry, material, this.samples.length);
    const object = new THREE.Object3D();
    let count = 0;
    for (let index = 0; index < this.samples.length; index += 5) {
      const raw = this.samples[index];
      const sample = this.sample(index / this.samples.length);
      for (const side of [-1, 1]) {
        const edge = side < 0 ? raw.edgeL : raw.edgeR;
        if (edge !== "C") continue;
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
    group.add(markers);
    return group;
  }

  private createTurnMarkers(): THREE.Group {
    const group = new THREE.Group();
    group.name = "greenwater_turn_grammar";
    const boardGeometry = new THREE.BoxGeometry(3.5, 1.7, 0.24);
    const postGeometry = new THREE.BoxGeometry(0.18, 2.2, 0.18);
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

    for (const turn of MAP.turns) {
      const outside = turn.direction === "left" ? 1 : -1;
      for (let index = 0; index < turn.chevronCount; index += 1) {
        const markerDistance = turn.apexDistance + (index - (turn.chevronCount - 1) / 2) * 7;
        const sample = this.sampleAtDistance(markerDistance);
        const marker = new THREE.Group();
        marker.name = `${turn.id}_chevron_${index + 1}`;
        poseObject(marker, sample);
        const markerX = outside * (sample.halfWidth + 1.8);
        const board = new THREE.Mesh(boardGeometry, boardMaterial);
        board.position.set(markerX, 2.3, 0);
        const post = new THREE.Mesh(postGeometry, postMaterial);
        post.position.set(markerX, 1.1, 0.08);
        const arrow = new THREE.Mesh(arrowGeometry, arrowMaterial);
        arrow.position.set(markerX, 2.3, -0.14);
        if (turn.direction === "left") arrow.scale.x = -1;
        marker.add(board, post, arrow);
        group.add(marker);
      }

      for (const boardDistance of turn.boards) {
        const distance = THREE.MathUtils.euclideanModulo(
          turn.entryDistance - boardDistance,
          this.length,
        );
        const sample = this.sampleAtDistance(distance);
        const board = new THREE.Group();
        poseObject(board, sample);
        const side = turn.direction === "left" ? 1 : -1;
        const sign = new THREE.Mesh(
          new THREE.PlaneGeometry(2.4, 2.4),
          createLabelMaterial(String(boardDistance / 50), "#ffa22e"),
        );
        sign.position.set(side * (sample.halfWidth + 2.1), 2.2, -0.08);
        const approachArrow = new THREE.Mesh(arrowGeometry, arrowMaterial);
        approachArrow.position.set(side * (sample.halfWidth + 2.1), 0.72, -0.1);
        approachArrow.scale.setScalar(0.78);
        if (turn.direction === "left") approachArrow.scale.x *= -1;
        board.add(sign, approachArrow);
        group.add(board);
      }
    }
    return group;
  }

  private createCheckpointGates(): THREE.Group {
    const group = new THREE.Group();
    group.name = "greenwater_gates";
    group.add(this.createFinishGate());
    const postMaterial = new THREE.MeshLambertMaterial({ color: 0x28312d });
    const pendingMaterial = new THREE.MeshBasicMaterial({ color: 0xffa22e });
    for (const checkpoint of MAP.checkpoints) {
      const sample = this.sampleAtDistance(checkpoint.distance);
      const gate = new THREE.Group();
      gate.name = checkpoint.id;
      gate.userData.name = checkpoint.name;
      poseObject(gate, sample);
      for (const side of [-1, 1]) {
        const x = side * (checkpoint.gateWidth / 2 + 0.7);
        const post = new THREE.Mesh(
          new THREE.BoxGeometry(0.55, checkpoint.mastHeight, 0.55),
          postMaterial,
        );
        post.position.set(x, checkpoint.mastHeight / 2, 0);
        const bar = new THREE.Mesh(
          new THREE.BoxGeometry(0.78, 3.2, 0.72),
          pendingMaterial,
        );
        bar.position.set(x, checkpoint.mastHeight - 2, -0.34);
        const number = new THREE.Mesh(
          new THREE.PlaneGeometry(1.9, 1.2),
          createLabelMaterial(checkpoint.index.toString().padStart(2, "0"), "#ffa22e"),
        );
        number.position.set(x, checkpoint.mastHeight - 0.9, -0.32);
        gate.add(post, bar, number);
      }
      group.add(gate);
    }
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
      vertical.position.set(side * span / 2, height / 2, -0.72);
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.65, 8, 6), amber);
      beacon.position.set(side * span / 2, height + 1.1, 0);
      gate.add(column, vertical, beacon);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span + 1.2, 1.3, 1.4), structure);
    beam.position.y = height - 0.65;
    gate.add(beam);
    const stripeGeometry = new THREE.BoxGeometry(1.05, 0.42, 1.5);
    for (let index = -15; index <= 15; index += 1) {
      const stripe = new THREE.Mesh(stripeGeometry, index % 2 === 0 ? acid : amber);
      stripe.position.set(index * 1.08, height - 0.65, -0.9);
      gate.add(stripe);
    }

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
    board.position.set(0, height - 3.2, -0.82);
    gate.add(board);
    return gate;
  }

  private createStartGrid(): THREE.Group {
    const group = new THREE.Group();
    group.name = "greenwater_start_grid";
    const acid = new THREE.MeshBasicMaterial({ color: 0xc8ff2e });
    const white = new THREE.MeshBasicMaterial({ color: 0xb9c1bb });
    const chequerSample = this.sample(0);
    const chequer = new THREE.Group();
    poseObject(chequer, chequerSample);
    for (let row = -2; row <= 2; row += 1) {
      for (let column = -11; column <= 11; column += 1) {
        const tile = new THREE.Mesh(
          new THREE.BoxGeometry(1, 0.035, 1),
          (row + column) % 2 === 0 ? white : acid,
        );
        tile.position.set(column, 0.05, row);
        chequer.add(tile);
      }
    }
    group.add(chequer);

    for (let index = 0; index < MAP.startFinish.gridPads; index += 1) {
      const distance = THREE.MathUtils.euclideanModulo(
        MAP.startFinish.gridOffset + index * 9,
        this.length,
      );
      const sample = this.sampleAtDistance(distance);
      const pad = new THREE.Group();
      poseObject(pad, sample);
      const marker = new THREE.Mesh(
        new THREE.BoxGeometry(3.3, 0.04, 5.4),
        index % 2 === 0 ? acid : white,
      );
      marker.position.set(index % 2 === 0 ? -3.2 : 3.2, 0.055, 0);
      pad.add(marker);
      group.add(pad);
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
    group.name = "greenwater_hazard_blockout";
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

    const cableMaterial = new THREE.MeshLambertMaterial({ color: 0x503d2d });
    for (const hazard of MAP.hazards.filter((candidate) => candidate.type === "cable_coil")) {
      if (hazard.distance === undefined || hazard.lateralOffset === undefined) continue;
      const sample = this.sampleAtDistance(hazard.distance);
      const cable = new THREE.Mesh(
        new THREE.TorusGeometry(1.5, 0.25, 5, 9),
        cableMaterial,
      );
      poseObject(cable, sample);
      cable.position.addScaledVector(sample.right, hazard.lateralOffset);
      cable.position.addScaledVector(sample.up, 0.28);
      cable.rotation.x += Math.PI / 2;
      group.add(cable);
    }

    const boostMaterial = new THREE.MeshBasicMaterial({ color: 0xc8ff2e });
    for (const distance of [1705, 1815, 1925, 2035]) {
      const sample = this.sampleAtDistance(distance);
      const pad = new THREE.Group();
      poseObject(pad, sample);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.035, 18), boostMaterial);
      mesh.position.set(sample.halfWidth * 0.44, 0.06, 0);
      pad.add(mesh);
      group.add(pad);
    }
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
    for (let index = 0; index < 9; index += 1) {
      const distance = 1640 + index * 55;
      const sample = this.sampleAtDistance(distance);
      const height = THREE.MathUtils.lerp(18, 7, index / 8);
      const radius = height * 0.34;
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 8), tankMaterial);
      tank.name = `fuel_tank_${index + 1}`;
      tank.position.copy(sample.position)
        .addScaledVector(sample.right, -40)
        .addScaledVector(sample.up, height / 2);
      group.add(tank);
    }
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
