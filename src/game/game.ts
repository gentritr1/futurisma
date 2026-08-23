import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { EngineAudio } from "./audio";
import { SpeedCourse } from "./course";
import type { InputFrame } from "./input";
import { InputController } from "./input";
import { TotemVehicle } from "./totem";
import { GameUi } from "./ui";

type RacePhase = "standby" | "countdown" | "running" | "finished";

const TOTAL_LAPS = 2;
const CRUISE_MAX_SPEED = 86;
const BOOST_MAX_SPEED = 112;

export class FuturismaGame {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(58, 1, 0.1, 520);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly course = new SpeedCourse();
  private readonly vehicle = new TotemVehicle();
  private readonly audio = new EngineAudio();
  private readonly timer = new THREE.Timer();
  private readonly speedLines: THREE.Points;
  private readonly cameraTarget = new THREE.Vector3();
  private readonly cameraLook = new THREE.Vector3();
  private readonly poseMatrix = new THREE.Matrix4();
  private readonly poseQuaternion = new THREE.Quaternion();
  private readonly position = new THREE.Vector3();
  private readonly forward = new THREE.Vector3(0, 0, -1);
  private readonly travelDirection = new THREE.Vector3(0, 0, -1);

  private phase: RacePhase = "standby";
  private progress = 0.002;
  private speed = 0;
  private lateral = 0;
  private steerAmount = 0;
  private nextCheckpointIndex = 1;
  private boostReserve = 1;
  private boostActive = false;
  private lap = 1;
  private elapsedMs = 0;
  private countdown = 3.7;
  private edgeContact = false;
  private impactShake = 0;
  private running = false;
  private animationFrame = 0;
  private readonly demoMode = new URLSearchParams(window.location.search).has("demo");

  constructor(
    canvas: HTMLCanvasElement,
    private readonly input: InputController,
    private readonly ui: GameUi,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = false;
    this.scene.background = new THREE.Color(0x091013);
    this.scene.fog = new THREE.Fog(0x091013, 24, 210);

    this.scene.add(this.course.group, this.vehicle.root);
    this.speedLines = this.createSpeedLines();
    this.camera.add(this.speedLines);
    this.scene.add(this.camera);
    this.installLighting();
    this.timer.connect(document);
    this.resize();
    window.addEventListener("resize", this.resize);
  }

  async initialize(): Promise<void> {
    await this.vehicle.load("/assets/totem/models/totem_runtime.glb");
    await this.loadAssetKit();
    this.resetRaceState();
    this.updatePose({ throttle: 0, brake: 0, steer: 0, boost: false }, 0);
    this.snapCamera();
    this.running = true;
    this.animationFrame = requestAnimationFrame(this.frame);
  }

  async startTrial(): Promise<void> {
    await this.audio.start().catch(() => undefined);
    this.resetRaceState();
    this.phase = "countdown";
    this.countdown = 3.7;
    this.ui.showRace();
  }

  canStart(): boolean {
    return this.phase === "standby" || this.phase === "finished";
  }

  private readonly frame = (timestamp: number): void => {
    if (!this.running) return;
    this.timer.update(timestamp);
    const delta = Math.min(this.timer.getDelta(), 0.05);
    const physicalInput = this.input.read();
    const input = this.demoMode ? this.readDemoInput() : physicalInput;

    if (this.input.consumeStart() && this.canStart()) {
      void this.startTrial();
    }
    if (this.input.consumeReset()) {
      if (this.phase === "running" || this.phase === "countdown") this.recoverVehicle();
    }
    if (this.input.consumeMute()) {
      this.ui.setAudioMuted(this.audio.toggleMute());
    }

    this.update(delta, input);
    this.renderer.render(this.scene, this.camera);
    this.animationFrame = requestAnimationFrame(this.frame);
  };

  private readDemoInput(): InputFrame {
    const projection = this.course.project(this.position, this.progress);
    const lookAhead = this.course.sample(
      this.progress + 0.012 + (this.speed / this.course.length) * 0.34,
    );
    const target = lookAhead.position
      .clone()
      .addScaledVector(
        lookAhead.right,
        Math.sin(this.timer.getElapsed() * 0.38) * 1.6,
      )
      .sub(this.position);
    this.alignDirectionToSurface(target, projection.up, projection.tangent);
    const signedAngle = Math.atan2(
      new THREE.Vector3().crossVectors(this.forward, target).dot(projection.up),
      THREE.MathUtils.clamp(this.forward.dot(target), -1, 1),
    );

    return {
      throttle: 1,
      brake: Math.abs(signedAngle) > 0.72 ? 0.42 : 0,
      steer: THREE.MathUtils.clamp(-signedAngle * 1.75, -1, 1),
      boost: this.timer.getElapsed() % 12 > 8.5 && Math.abs(signedAngle) < 0.28,
    };
  }

  private update(delta: number, input: InputFrame): void {
    if (this.phase === "countdown") this.updateCountdown(delta);
    if (this.phase === "running") this.updateRace(delta, input);
    if (this.phase === "finished") this.updateCoast(delta);

    this.updatePose(input, delta);
    this.updateCamera(delta, this.steerAmount);
    this.updateSpeedLines(delta);
    this.audio.update(this.speed / BOOST_MAX_SPEED, input.throttle, this.boostActive);
    this.updateHud(input);
  }

  private updateCountdown(delta: number): void {
    this.countdown -= delta;
    if (this.countdown > 3) this.ui.setCountdown("3");
    else if (this.countdown > 2) this.ui.setCountdown("2");
    else if (this.countdown > 1) this.ui.setCountdown("1");
    else if (this.countdown > 0) this.ui.setCountdown("GO");
    else {
      this.phase = "running";
      this.ui.setCountdown("");
    }
  }

  private alignDirectionToSurface(
    direction: THREE.Vector3,
    up: THREE.Vector3,
    fallback: THREE.Vector3,
  ): void {
    direction.addScaledVector(up, -direction.dot(up));
    if (direction.lengthSq() < 0.0001) direction.copy(fallback);
    direction.normalize();
  }

  private updateRace(delta: number, input: InputFrame): void {
    this.boostActive = input.boost && input.throttle > 0.1 && this.boostReserve > 0.012;
    const maxSpeed = this.boostActive ? BOOST_MAX_SPEED : CRUISE_MAX_SPEED;

    const engineForce = input.throttle * (26 - (this.speed / maxSpeed) * 12);
    const boostForce = this.boostActive ? 34 : 0;
    const brakeForce = input.brake * 46;
    const drag = 1.2 + this.speed * 0.038 + this.speed * this.speed * 0.0007;
    this.speed += (engineForce + boostForce - brakeForce - drag) * delta;
    this.speed = THREE.MathUtils.clamp(this.speed, 0, this.boostActive ? BOOST_MAX_SPEED : 92);

    if (this.boostActive) this.boostReserve = Math.max(0, this.boostReserve - delta * 0.2);
    else this.boostReserve = Math.min(1, this.boostReserve + delta * 0.075);

    const beforeMove = this.course.project(this.position, this.progress);
    const speedRatio = this.speed / BOOST_MAX_SPEED;
    const steerResponse = 1 - Math.exp(-delta * (Math.abs(input.steer) > 0.01 ? 6.2 : 8.5));
    this.steerAmount = THREE.MathUtils.lerp(
      this.steerAmount,
      input.steer,
      steerResponse,
    );
    const turnAuthority = THREE.MathUtils.lerp(
      0.32,
      1,
      THREE.MathUtils.smoothstep(speedRatio, 0.015, 0.2),
    );
    const turnRate = THREE.MathUtils.lerp(
      1.85,
      0.92,
      THREE.MathUtils.smoothstep(speedRatio, 0.12, 1),
    );
    this.forward.applyAxisAngle(
      beforeMove.up,
      -this.steerAmount * turnRate * turnAuthority * delta,
    );
    this.alignDirectionToSurface(this.forward, beforeMove.up, beforeMove.tangent);

    const gripRate = THREE.MathUtils.lerp(
      7.2,
      1.85,
      THREE.MathUtils.smoothstep(speedRatio, 0.08, 1),
    ) + input.brake * 2.2;
    const gripResponse = 1 - Math.exp(-delta * gripRate);
    this.travelDirection.lerp(this.forward, gripResponse);
    this.alignDirectionToSurface(
      this.travelDirection,
      beforeMove.up,
      this.forward,
    );

    this.position.addScaledVector(this.travelDirection, this.speed * delta);
    const previousProgress = this.progress;
    const afterMove = this.course.project(this.position, this.progress);
    this.progress = afterMove.progress;
    this.lateral = afterMove.lateral;
    this.position.y = afterMove.position.y;

    const lateralLimit = this.course.halfWidth - 2.05;
    const outside = Math.abs(this.lateral) > lateralLimit;
    const wasEdgeContact = this.edgeContact;
    if (outside) {
      this.lateral = THREE.MathUtils.clamp(this.lateral, -lateralLimit, lateralLimit);
      this.position.copy(afterMove.position).addScaledVector(afterMove.right, this.lateral);
      const outward = afterMove.right.clone().multiplyScalar(Math.sign(afterMove.lateral));
      const outwardMotion = this.travelDirection.dot(outward);
      if (outwardMotion > 0) {
        this.travelDirection.addScaledVector(outward, -outwardMotion * 1.45).normalize();
      }
      if (!wasEdgeContact) {
        this.speed *= 0.78;
        this.impactShake = 1;
      }
      this.speed = Math.max(0, this.speed - delta * 12);
    }
    this.edgeContact = outside
      || (wasEdgeContact && Math.abs(this.lateral) > lateralLimit - 0.12);
    this.alignDirectionToSurface(this.forward, afterMove.up, afterMove.tangent);
    this.alignDirectionToSurface(
      this.travelDirection,
      afterMove.up,
      this.forward,
    );

    this.elapsedMs += delta * 1000;
    this.updateCheckpointProgress(previousProgress, afterMove.tangent);
  }

  private updateCoast(delta: number): void {
    this.speed = Math.max(0, this.speed - delta * 5.5);
    this.position.addScaledVector(this.travelDirection, this.speed * delta);
    const projection = this.course.project(this.position, this.progress);
    this.progress = projection.progress;
    this.lateral = THREE.MathUtils.clamp(
      projection.lateral,
      -this.course.halfWidth + 2.05,
      this.course.halfWidth - 2.05,
    );
    this.position.copy(projection.position).addScaledVector(projection.right, this.lateral);
    this.boostActive = false;
  }

  private updateCheckpointProgress(
    previousProgress: number,
    courseTangent: THREE.Vector3,
  ): void {
    let progressDelta = this.progress - previousProgress;
    if (progressDelta > 0.5) progressDelta -= 1;
    if (progressDelta < -0.5) progressDelta += 1;
    if (progressDelta <= 0 || this.travelDirection.dot(courseTangent) < 0.2) return;

    const targetProgress = this.nextCheckpointIndex / this.course.checkpointCount;
    const distanceToTarget = THREE.MathUtils.euclideanModulo(
      targetProgress - previousProgress,
      1,
    );
    if (distanceToTarget > progressDelta + 0.0015) return;

    if (this.nextCheckpointIndex === 0) {
      this.lap += 1;
      if (this.lap > TOTAL_LAPS) {
        this.finishRace();
        return;
      }
      this.nextCheckpointIndex = 1;
      return;
    }

    this.nextCheckpointIndex = (this.nextCheckpointIndex + 1) % this.course.checkpointCount;
  }

  private recoverVehicle(): void {
    const previousCheckpoint = this.nextCheckpointIndex === 0
      ? this.course.checkpointCount - 1
      : Math.max(0, this.nextCheckpointIndex - 1);
    this.progress = THREE.MathUtils.euclideanModulo(
      previousCheckpoint / this.course.checkpointCount + 0.004,
      1,
    );
    const recovery = this.course.sample(this.progress);
    this.position.copy(recovery.position);
    this.forward.copy(recovery.tangent);
    this.travelDirection.copy(recovery.tangent);
    this.lateral = 0;
    this.steerAmount = 0;
    this.speed = Math.min(this.speed, 18);
    this.boostActive = false;
    this.edgeContact = false;
    this.impactShake = 0.25;
    this.updatePose({ throttle: 0, brake: 0, steer: 0, boost: false }, 0);
    this.snapCamera();
  }

  private updatePose(input: InputFrame, delta: number): void {
    const sample = this.course.project(this.position, this.progress);
    const speedRatio = this.speed / BOOST_MAX_SPEED;
    const hoverHeight = this.boostActive ? 0.6 : this.speed < 11 ? 0.18 : 0.45;
    const vehiclePosition = this.position
      .clone()
      .addScaledVector(sample.up, hoverHeight + 0.71);
    const vehicleRight = new THREE.Vector3().crossVectors(this.forward, sample.up).normalize();
    const vehicleUp = new THREE.Vector3().crossVectors(vehicleRight, this.forward).normalize();

    this.poseMatrix.makeBasis(
      vehicleRight,
      vehicleUp,
      this.forward.clone().multiplyScalar(-1),
    );
    this.poseQuaternion.setFromRotationMatrix(this.poseMatrix);
    this.vehicle.setPose(vehiclePosition, this.poseQuaternion);
    const slip = THREE.MathUtils.clamp(
      this.travelDirection.dot(vehicleRight) * speedRatio * 2.4,
      -1,
      1,
    );
    this.vehicle.updateVisual({
      steer: this.steerAmount,
      throttle: input.throttle,
      brake: input.brake,
      speedRatio,
      boostActive: this.boostActive,
      lateralLoad: this.steerAmount * 0.45 - slip,
      elapsed: this.timer.getElapsed(),
    });

    if (delta > 0) this.impactShake = Math.max(0, this.impactShake - delta * 3.6);
  }

  private updateCamera(delta: number, steer: number): void {
    const sample = this.course.project(this.position, this.progress);
    const vehicleRight = new THREE.Vector3().crossVectors(this.forward, sample.up).normalize();
    const fallback = this.vehicle.root.position
      .clone()
      .addScaledVector(this.forward, -5)
      .addScaledVector(sample.up, 2.2);
    const anchor = this.vehicle.worldPosition("CAMERA_chase_target", fallback);
    const desired = anchor
      .addScaledVector(this.forward, -2.7)
      .addScaledVector(sample.up, 1.25)
      .addScaledVector(vehicleRight, -steer * 0.45);
    const target = this.vehicle.root.position
      .clone()
      .addScaledVector(this.forward, 8 + this.speed * 0.075)
      .addScaledVector(this.travelDirection, this.speed * 0.025)
      .addScaledVector(sample.up, 0.8);

    const speedRatio = this.speed / BOOST_MAX_SPEED;
    const positionDamping = 1 - Math.exp(-delta * (12 + speedRatio * 8));
    const lookDamping = 1 - Math.exp(-delta * (11 + speedRatio * 5));
    this.cameraTarget.lerp(desired, positionDamping);
    this.cameraLook.lerp(target, lookDamping);
    this.camera.position.copy(this.cameraTarget);

    if (this.impactShake > 0) {
      const shake = this.impactShake * 0.12;
      this.camera.position.x += (Math.random() - 0.5) * shake;
      this.camera.position.y += (Math.random() - 0.5) * shake;
    }

    this.camera.lookAt(this.cameraLook);
    const desiredFov = 56 + (this.speed / BOOST_MAX_SPEED) * 10 + (this.boostActive ? 7 : 0);
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, desiredFov, 1 - Math.exp(-delta * 4.8));
    this.camera.updateProjectionMatrix();
  }

  private snapCamera(): void {
    const sample = this.course.project(this.position, this.progress);
    this.cameraTarget
      .copy(this.vehicle.root.position)
      .addScaledVector(this.forward, -9)
      .addScaledVector(sample.up, 4);
    this.cameraLook
      .copy(this.vehicle.root.position)
      .addScaledVector(this.forward, 10)
      .addScaledVector(sample.up, 0.8);
    this.camera.position.copy(this.cameraTarget);
    this.camera.lookAt(this.cameraLook);
  }

  private updateSpeedLines(delta: number): void {
    const geometry = this.speedLines.geometry;
    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    const speedRatio = this.speed / BOOST_MAX_SPEED;
    for (let index = 0; index < position.count; index += 1) {
      let z = position.getZ(index) + delta * (10 + this.speed * 0.85);
      if (z > -1.5) z = -52 - Math.random() * 32;
      position.setZ(index, z);
    }
    position.needsUpdate = true;
    const material = this.speedLines.material as THREE.PointsMaterial;
    material.opacity = THREE.MathUtils.smoothstep(speedRatio, 0.42, 0.92) * 0.48;
    material.size = this.boostActive ? 0.1 : 0.065;
  }

  private updateHud(input: InputFrame): void {
    const checkpoint = this.nextCheckpointIndex === 0
      ? this.course.checkpointCount
      : this.nextCheckpointIndex;
    this.ui.update({
      speedKph: this.speed * 3.6,
      boost: this.boostReserve,
      elapsedMs: this.elapsedMs,
      lap: this.lap,
      totalLaps: TOTAL_LAPS,
      progress: ((this.lap - 1) + this.progress) / TOTAL_LAPS,
      checkpoint,
      checkpointCount: this.course.checkpointCount,
      boostActive: this.boostActive,
      braking: input.brake > 0.1,
      skidsDown: this.speed < 11,
      edgeWarning: this.edgeContact,
    });
  }

  private finishRace(): void {
    this.phase = "finished";
    this.boostActive = false;
    this.ui.showResult(this.elapsedMs);
  }

  private resetRaceState(): void {
    this.progress = 0.002;
    this.speed = 0;
    this.lateral = 0;
    this.steerAmount = 0;
    this.nextCheckpointIndex = 1;
    this.boostReserve = 1;
    this.boostActive = false;
    this.lap = 1;
    this.elapsedMs = 0;
    this.edgeContact = false;
    this.impactShake = 0;
    const start = this.course.sample(this.progress);
    this.position.copy(start.position);
    this.forward.copy(start.tangent);
    this.travelDirection.copy(start.tangent);
  }

  private installLighting(): void {
    const hemisphere = new THREE.HemisphereLight(0x7bb0bd, 0x06110c, 1.8);
    const key = new THREE.DirectionalLight(0xc5ebf2, 2.5);
    key.position.set(80, 130, 35);
    const rim = new THREE.DirectionalLight(0xc8ff2e, 0.65);
    rim.position.set(-100, 25, -80);
    this.scene.add(hemisphere, key, rim);
  }

  private createSpeedLines(): THREE.Points {
    const count = 160;
    const positions = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      positions[index * 3] = (Math.random() - 0.5) * 22;
      positions[index * 3 + 1] = (Math.random() - 0.5) * 12;
      positions[index * 3 + 2] = -3 - Math.random() * 78;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0xc5f4ff,
      size: 0.065,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    return points;
  }

  private async loadAssetKit(): Promise<void> {
    try {
      const gltf = await new GLTFLoader().loadAsync(
        "/assets/totem/models/futurisma_asset_kit.glb",
      );
      const sample = this.course.sample(0.985);
      gltf.scene.name = "totem_asset_kit_pit_display";
      gltf.scene.position.copy(sample.position).addScaledVector(sample.right, -22);
      this.poseMatrix.makeBasis(
        sample.right,
        sample.up,
        sample.tangent.clone().multiplyScalar(-1),
      );
      gltf.scene.quaternion.setFromRotationMatrix(this.poseMatrix);
      this.scene.add(gltf.scene);
    } catch {
      // The neutral course remains playable if the optional prop lineup fails.
    }
  }

  private readonly resize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  };

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.animationFrame);
    window.removeEventListener("resize", this.resize);
    this.timer.dispose();
    this.renderer.dispose();
  }
}
