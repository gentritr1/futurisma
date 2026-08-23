import * as THREE from "three";

export interface CourseSample {
  position: THREE.Vector3;
  tangent: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  curvature: number;
}

export interface CourseProjection extends CourseSample {
  progress: number;
  lateral: number;
}

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const COURSE_POINTS = [
  [0, 0, 0],
  [0, 0, -100],
  [-55, 5, -210],
  [-180, 12, -240],
  [-290, 7, -155],
  [-315, 1, -25],
  [-260, -4, 105],
  [-135, 2, 185],
  [20, 8, 205],
  [165, 14, 160],
  [270, 10, 55],
  [275, 3, -70],
  [210, 0, -175],
  [95, 2, -235],
  [25, 0, -120],
] as const;

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

export class SpeedCourse {
  readonly group = new THREE.Group();
  readonly curve: THREE.CatmullRomCurve3;
  readonly length: number;
  readonly halfWidth = 9.5;
  readonly checkpointCount = 8;
  private readonly projectionResolution = 1440;
  private readonly projectionPoints: THREE.Vector3[] = [];

  constructor() {
    this.group.name = "neutral_speed_course";
    this.curve = new THREE.CatmullRomCurve3(
      COURSE_POINTS.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
      true,
      "catmullrom",
      0.32,
    );
    this.arcLengthDivisions = 1800;
    this.length = this.curve.getLength();
    for (let index = 0; index < this.projectionResolution; index += 1) {
      this.projectionPoints.push(this.curve.getPointAt(index / this.projectionResolution));
    }

    this.group.add(
      this.createTrackSurface(),
      this.createTrackUnderside(),
      this.createEdgeLights(),
      this.createCheckpointGates(),
      this.createStartGrid(),
      this.createJungleSilhouette(),
      this.createGroundPlane(),
    );
  }

  private set arcLengthDivisions(value: number) {
    this.curve.arcLengthDivisions = value;
    this.curve.updateArcLengths();
  }

  sample(progress: number): CourseSample {
    const wrapped = THREE.MathUtils.euclideanModulo(progress, 1);
    const position = this.curve.getPointAt(wrapped);
    const tangent = this.curve.getTangentAt(wrapped).normalize();
    const right = new THREE.Vector3().crossVectors(tangent, WORLD_UP).normalize();
    const up = new THREE.Vector3().crossVectors(right, tangent).normalize();
    const before = this.curve.getTangentAt(THREE.MathUtils.euclideanModulo(wrapped - 0.003, 1));
    const after = this.curve.getTangentAt(THREE.MathUtils.euclideanModulo(wrapped + 0.003, 1));
    const curvature = THREE.MathUtils.clamp(
      new THREE.Vector3().crossVectors(before, after).dot(WORLD_UP) * 9,
      -1,
      1,
    );

    return { position, tangent, right, up, curvature };
  }

  project(position: THREE.Vector3, hintProgress: number): CourseProjection {
    const segmentCount = this.projectionResolution;
    const hintIndex = Math.round(THREE.MathUtils.euclideanModulo(hintProgress, 1) * segmentCount);
    const localRadius = 36;
    let nearestDistanceSq = Number.POSITIVE_INFINITY;
    let nearestProgress = hintProgress;

    const inspectSegment = (rawIndex: number): void => {
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
            ((position.x - start.x) * segmentX
              + (position.y - start.y) * segmentY
              + (position.z - start.z) * segmentZ) / lengthSq,
            0,
            1,
          )
        : 0;
      const differenceX = start.x + segmentX * along - position.x;
      const differenceY = start.y + segmentY * along - position.y;
      const differenceZ = start.z + segmentZ * along - position.z;
      const distanceSq = differenceX * differenceX
        + differenceY * differenceY
        + differenceZ * differenceZ;
      if (distanceSq >= nearestDistanceSq) return;

      nearestDistanceSq = distanceSq;
      nearestProgress = THREE.MathUtils.euclideanModulo((index + along) / segmentCount, 1);
    };

    for (let offset = -localRadius; offset <= localRadius; offset += 1) {
      inspectSegment(hintIndex + offset);
    }

    const globalSearchThreshold = this.halfWidth + 20;
    if (nearestDistanceSq > globalSearchThreshold * globalSearchThreshold) {
      for (let index = 0; index < segmentCount; index += 1) inspectSegment(index);
    }

    const sample = this.sample(nearestProgress);
    const lateral = (position.x - sample.position.x) * sample.right.x
      + (position.y - sample.position.y) * sample.right.y
      + (position.z - sample.position.z) * sample.right.z;
    return { ...sample, progress: nearestProgress, lateral };
  }

  private createTrackSurface(): THREE.Mesh {
    const segments = 720;
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const dark = new THREE.Color(0x1a2328);
    const light = new THREE.Color(0x222d32);

    for (let index = 0; index <= segments; index += 1) {
      const progress = index / segments;
      const sample = this.sample(progress);
      const shade = index % 36 < 18 ? dark : light;

      for (const side of [-1, 1]) {
        const point = sample.position
          .clone()
          .addScaledVector(sample.right, side * this.halfWidth);
        positions.push(point.x, point.y, point.z);
        normals.push(sample.up.x, sample.up.y, sample.up.z);
        uvs.push(side < 0 ? 0 : 1, progress * 72);
        colors.push(shade.r, shade.g, shade.b);
      }

      if (index < segments) {
        const offset = index * 2;
        indices.push(offset, offset + 2, offset + 1, offset + 2, offset + 3, offset + 1);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();

    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.86,
      metalness: 0.14,
      flatShading: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = "course_surface";
    mesh.receiveShadow = true;
    return mesh;
  }

  private createTrackUnderside(): THREE.Mesh {
    const segments = 480;
    const positions: number[] = [];
    const indices: number[] = [];
    for (let index = 0; index <= segments; index += 1) {
      const sample = this.sample(index / segments);
      for (const side of [-1, 1]) {
        const point = sample.position
          .clone()
          .addScaledVector(sample.right, side * (this.halfWidth + 0.35))
          .addScaledVector(sample.up, -0.52);
        positions.push(point.x, point.y, point.z);
      }
      if (index < segments) {
        const offset = index * 2;
        indices.push(offset, offset + 1, offset + 2, offset + 2, offset + 1, offset + 3);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({
      color: 0x0c1215,
      roughness: 0.96,
      metalness: 0.06,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = "course_understructure";
    return mesh;
  }

  private createEdgeLights(): THREE.Group {
    const group = new THREE.Group();
    group.name = "course_edge_lights";
    const geometry = new THREE.BoxGeometry(0.22, 0.16, 2.8);
    const acidMaterial = new THREE.MeshBasicMaterial({ color: 0xc4f230 });
    const cyanMaterial = new THREE.MeshBasicMaterial({ color: 0x49e2ff });
    const acid = new THREE.InstancedMesh(geometry, acidMaterial, 180);
    const cyan = new THREE.InstancedMesh(geometry, cyanMaterial, 180);
    const matrix = new THREE.Matrix4();
    let acidIndex = 0;
    let cyanIndex = 0;

    for (let index = 0; index < 180; index += 1) {
      const progress = index / 180;
      const sample = this.sample(progress);
      for (const side of [-1, 1]) {
        const marker = new THREE.Object3D();
        poseObject(marker, sample);
        marker.position.addScaledVector(sample.right, side * (this.halfWidth - 0.18));
        marker.position.addScaledVector(sample.up, 0.12);
        marker.updateMatrix();
        matrix.copy(marker.matrix);
        if ((index + (side > 0 ? 1 : 0)) % 2 === 0) {
          acid.setMatrixAt(acidIndex, matrix);
          acidIndex += 1;
        } else {
          cyan.setMatrixAt(cyanIndex, matrix);
          cyanIndex += 1;
        }
      }
    }

    acid.count = acidIndex;
    cyan.count = cyanIndex;
    acid.instanceMatrix.needsUpdate = true;
    cyan.instanceMatrix.needsUpdate = true;
    acid.frustumCulled = false;
    cyan.frustumCulled = false;
    group.add(acid, cyan);
    return group;
  }

  private createCheckpointGates(): THREE.Group {
    const group = new THREE.Group();
    group.name = "checkpoint_gates";
    const columnGeometry = new THREE.BoxGeometry(0.5, 6.2, 0.5);
    const beamGeometry = new THREE.BoxGeometry(this.halfWidth * 2 + 2.4, 0.34, 0.48);
    const darkMaterial = new THREE.MeshStandardMaterial({
      color: 0x273136,
      roughness: 0.72,
      metalness: 0.28,
    });
    const acidMaterial = new THREE.MeshBasicMaterial({ color: 0xc4f230 });
    const cyanMaterial = new THREE.MeshBasicMaterial({ color: 0x49e2ff });

    for (let index = 0; index < this.checkpointCount; index += 1) {
      const sample = this.sample(index / this.checkpointCount);
      const gate = new THREE.Group();
      gate.name = `checkpoint_${index + 1}`;
      poseObject(gate, sample);

      for (const side of [-1, 1]) {
        const column = new THREE.Mesh(columnGeometry, darkMaterial);
        column.position.set(side * (this.halfWidth + 0.75), 3, 0);
        gate.add(column);

        const lamp = new THREE.Mesh(
          new THREE.BoxGeometry(0.62, 0.18, 0.7),
          index % 2 === 0 ? acidMaterial : cyanMaterial,
        );
        lamp.position.set(side * (this.halfWidth + 0.75), 5.2, -0.28);
        gate.add(lamp);
      }

      const beam = new THREE.Mesh(beamGeometry, darkMaterial);
      beam.position.y = 6.15;
      gate.add(beam);

      const centerLamp = new THREE.Mesh(
        new THREE.BoxGeometry(3.6, 0.16, 0.72),
        index % 2 === 0 ? cyanMaterial : acidMaterial,
      );
      centerLamp.position.set(0, 5.94, -0.28);
      gate.add(centerLamp);
      group.add(gate);
    }

    return group;
  }

  private createStartGrid(): THREE.Group {
    const group = new THREE.Group();
    group.name = "start_grid";
    const sample = this.sample(0.002);
    poseObject(group, sample);
    const white = new THREE.MeshBasicMaterial({ color: 0xaab2b2 });
    const acid = new THREE.MeshBasicMaterial({ color: 0xc4f230 });

    for (let index = -5; index <= 5; index += 1) {
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(1.45, 0.025, 0.85),
        index % 2 === 0 ? acid : white,
      );
      stripe.position.set(index * 1.62, 0.045, 0);
      group.add(stripe);
    }
    return group;
  }

  private createJungleSilhouette(): THREE.Group {
    const group = new THREE.Group();
    group.name = "neutral_jungle_silhouette";
    const random = seededRandom(714);
    const count = 260;
    const trunkGeometry = new THREE.CylinderGeometry(0.5, 0.7, 5, 5);
    const crownGeometry = new THREE.ConeGeometry(3.1, 10, 5);
    const trunkMaterial = new THREE.MeshStandardMaterial({
      color: 0x111d1b,
      roughness: 1,
      flatShading: true,
    });
    const crownMaterial = new THREE.MeshStandardMaterial({
      color: 0x142b23,
      roughness: 0.96,
      flatShading: true,
    });
    const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, count);
    const crowns = new THREE.InstancedMesh(crownGeometry, crownMaterial, count);
    const object = new THREE.Object3D();

    for (let index = 0; index < count; index += 1) {
      const progress = random();
      const sample = this.sample(progress);
      const side = random() > 0.5 ? 1 : -1;
      const distance = 24 + random() * 88;
      const scale = 0.6 + random() * 1.6;
      const position = sample.position.clone().addScaledVector(sample.right, side * distance);

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
    const geometry = new THREE.PlaneGeometry(1600, 1600, 1, 1);
    const material = new THREE.MeshStandardMaterial({
      color: 0x07100e,
      roughness: 1,
      metalness: 0,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = -19;
    mesh.receiveShadow = true;
    mesh.name = "fog_ground";
    return mesh;
  }
}
