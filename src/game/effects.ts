import * as THREE from "three";
import type { RaceCourse } from "./course";
import { bankedSurfaceLift } from "./presentation";
import { BOOST_MAX_SPEED } from "./physics";
import {
  calculateSpeedStreakLength,
  calculateSpeedStreakOpacity,
} from "./presentation";

const SPEED_LINE_COLOR = new THREE.Color(0x94bdb7);
const BOOST_LINE_COLOR = new THREE.Color(0x78d6de);
const IMPACT_SPARK_COUNT = 48;

/**
 * Camera speed streaks and the impact spark burst. Owns every particle buffer so
 * the race loop only forwards the vehicle state that drives them.
 */
export class RaceEffects {
  readonly speedLines: THREE.LineSegments;
  readonly sparkPoints: THREE.Points;
  private readonly sparkPositions = new Float32Array(IMPACT_SPARK_COUNT * 3);
  private readonly sparkVelocities = new Float32Array(IMPACT_SPARK_COUNT * 3);
  private readonly sparkLife = new Float32Array(IMPACT_SPARK_COUNT);
  private sparkCursor = 0;

  constructor(private readonly reducedMotion: boolean) {
    this.speedLines = this.createSpeedLines();
    this.sparkPoints = this.createImpactSparks();
  }

  private createSpeedLines(): THREE.LineSegments {
    const count = 96;
    const positions = new Float32Array(count * 6);
    for (let index = 0; index < count; index += 1) {
      const offset = index * 6;
      const x = ((index * 0.61803398875) % 1 - 0.5) * 22;
      const y = ((index * 0.41421356237) % 1 - 0.5) * 12;
      const z = -3 - ((index * 0.75487766625) % 1) * 78;
      positions[offset] = x;
      positions[offset + 1] = y;
      positions[offset + 2] = z;
      positions[offset + 3] = x;
      positions[offset + 4] = y;
      positions[offset + 5] = z - 1;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({
      color: 0xc5f4ff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const lines = new THREE.LineSegments(geometry, material);
    lines.frustumCulled = false;
    lines.visible = false;
    return lines;
  }

  private createImpactSparks(): THREE.Points {
    for (let index = 0; index < this.sparkLife.length; index += 1) {
      this.sparkPositions[index * 3 + 1] = -10_000;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(this.sparkPositions, 3),
    );
    const material = new THREE.PointsMaterial({
      color: 0xffa22e,
      size: 0.16,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const sparks = new THREE.Points(geometry, material);
    sparks.name = "totem_impact_sparks";
    sparks.frustumCulled = false;
    sparks.visible = false;
    return sparks;
  }

  updateSpeedLines(
    delta: number,
    speed: number,
    steerAmount: number,
    driftIntensity: number,
    boostActive: boolean,
  ): void {
    const geometry = this.speedLines.geometry;
    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    const values = position.array as Float32Array;
    const speedRatio = speed / BOOST_MAX_SPEED;
    const material = this.speedLines.material as THREE.LineBasicMaterial;
    material.color.lerpColors(
      SPEED_LINE_COLOR,
      BOOST_LINE_COLOR,
      boostActive ? 1 : 0,
    );
    material.opacity = calculateSpeedStreakOpacity(
      speedRatio,
      driftIntensity,
      this.reducedMotion,
    );
    this.speedLines.visible = material.opacity > 0.005;
    const speedLineRoll = this.reducedMotion
      ? 0
      : -steerAmount * driftIntensity * 0.12;
    this.speedLines.rotation.z = THREE.MathUtils.lerp(
      this.speedLines.rotation.z,
      speedLineRoll,
      1 - Math.exp(-delta * 7.2),
    );
    if (!this.speedLines.visible) return;

    const streakLength = calculateSpeedStreakLength(
      speedRatio,
      boostActive,
      this.reducedMotion,
    );
    const travel = delta * (10 + speed * 0.85);
    for (let offset = 0; offset < values.length; offset += 6) {
      let z = values[offset + 2] + travel;
      if (z > -1.5) z -= 80;
      values[offset + 2] = z;
      values[offset + 5] = z - streakLength;
    }
    position.needsUpdate = true;
  }

  /**
   * @param origin the craft's simulation position, whose `y` is the *centreline*
   * height, and @param lateral its signed offset from that centreline. The deck
   * is banked, so the surface the sparks should leave sits `right.y * lateral`
   * above `origin` — see `bankedSurfaceLift` in presentation.js. Without it a
   * wall strike on the 12 degree GREENWATER_SWEEP threw sparks up to 3 m below
   * the wall it struck.
   */
  emitImpactSparks(
    sample: ReturnType<RaceCourse["sample"]>,
    origin: THREE.Vector3,
    lateral: number,
    speed: number,
    side: number,
    strength: number,
  ): void {
    const originY = origin.y + bankedSurfaceLift(sample.right.y, lateral);
    const count = this.reducedMotion ? 5 : 14;
    for (let emitted = 0; emitted < count; emitted += 1) {
      const particle = this.sparkCursor;
      this.sparkCursor = (this.sparkCursor + 1) % this.sparkLife.length;
      const offset = particle * 3;
      const spread = Math.random() - 0.5;
      this.sparkPositions[offset] = origin.x
        + sample.right.x * side * 1.7
        + sample.up.x * 0.35;
      this.sparkPositions[offset + 1] = originY
        + sample.right.y * side * 1.7
        + sample.up.y * 0.35;
      this.sparkPositions[offset + 2] = origin.z
        + sample.right.z * side * 1.7
        + sample.up.z * 0.35;
      const outwardSpeed = -(2.5 + Math.random() * 4.5) * side;
      const liftSpeed = 2 + Math.random() * 5;
      const trailSpeed = -2 - Math.random() * (4 + speed * 0.05);
      this.sparkVelocities[offset] = sample.right.x * outwardSpeed
        + sample.up.x * liftSpeed
        + sample.tangent.x * trailSpeed
        + spread;
      this.sparkVelocities[offset + 1] = sample.right.y * outwardSpeed
        + sample.up.y * liftSpeed
        + sample.tangent.y * trailSpeed
        + spread;
      this.sparkVelocities[offset + 2] = sample.right.z * outwardSpeed
        + sample.up.z * liftSpeed
        + sample.tangent.z * trailSpeed
        + spread;
      this.sparkLife[particle] = (0.22 + Math.random() * 0.28) * strength;
    }
    this.sparkPoints.visible = true;
    const position = this.sparkPoints.geometry.getAttribute("position");
    position.needsUpdate = true;
  }

  updateImpactSparks(delta: number): void {
    if (!this.sparkPoints.visible) return;
    let changed = false;
    let active = false;
    for (let particle = 0; particle < this.sparkLife.length; particle += 1) {
      if (this.sparkLife[particle] <= 0) continue;
      const offset = particle * 3;
      this.sparkLife[particle] = Math.max(0, this.sparkLife[particle] - delta);
      if (this.sparkLife[particle] === 0) {
        this.sparkPositions[offset + 1] = -10_000;
      } else {
        active = true;
        this.sparkPositions[offset] += this.sparkVelocities[offset] * delta;
        this.sparkPositions[offset + 1] += this.sparkVelocities[offset + 1] * delta;
        this.sparkPositions[offset + 2] += this.sparkVelocities[offset + 2] * delta;
        this.sparkVelocities[offset + 1] -= 6.5 * delta;
      }
      changed = true;
    }
    this.sparkPoints.visible = active;
    if (changed) {
      this.sparkPoints.geometry.getAttribute("position").needsUpdate = true;
    }
  }

  resetImpactSparks(): void {
    this.sparkCursor = 0;
    this.sparkLife.fill(0);
    this.sparkVelocities.fill(0);
    for (let particle = 0; particle < this.sparkLife.length; particle += 1) {
      const offset = particle * 3;
      this.sparkPositions[offset] = 0;
      this.sparkPositions[offset + 1] = -10_000;
      this.sparkPositions[offset + 2] = 0;
    }
    this.sparkPoints.visible = false;
    this.sparkPoints.geometry.getAttribute("position").needsUpdate = true;
  }
}
