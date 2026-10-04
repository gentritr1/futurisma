import type * as THREE from "three";
import type { CourseProjection, RaceCourse } from "./course";
import type { InputFrame } from "./input";
import type { TotemVisualState } from "./totem";
import type { InputController } from "./input";
import type { EngineAudio } from "./audio";
import type { GameUi } from "./ui";

/** Keep circuit registration and presentation out of the initial shell. */
export async function createCircuitRuntime(course: RaceCourse, input: InputController, audio: EngineAudio,
  ui: GameUi, reducedMotion: boolean, cancelled: () => boolean): Promise<CircuitRuntime | null> {
  const factory=await import('./circuit-runtime-factory');
  return factory.createCircuitRuntime(course,input,audio,ui,reducedMotion,cancelled);
}

/** Small adapter between authored circuit rules and the existing fixed-step race. */
export interface CircuitRuntime {
  readonly ownsCamera?: boolean;
  readonly course: RaceCourse & { readonly rivalCourse?: RaceCourse | null };
  readonly ready: Promise<void>;
  readonly ceiling: boolean;
  readonly isFlipping: boolean;
  readonly gravityBlend?: number;
  readonly surgeActive: boolean;
  readonly shieldActive: boolean;
  readonly boostRechargeScale: number;
  handleActions(running: boolean, progress: number, position: THREE.Vector3, lateral: number, demo: boolean): boolean;
  step(delta: number, progress: number, lateral: number, lap: number, leadMeters?: number): void;
  advanceClocks(delta: number): void;
  applySurge(previous: number, normal: number, input: InputFrame, delta: number): number;
  present(sample: CourseProjection, position: THREE.Vector3, forward: THREE.Vector3, state: TotemVisualState): void;
  updateCamera(camera: THREE.PerspectiveCamera, delta: number, position: THREE.Vector3, forward: THREE.Vector3, speed: number): void;
  updateHud(progress: number): void;
  onShieldImpact(progress: number, lateral: number): number;
  recover(progress: number): void;
  reset(): void;
  dispose(): void;
}
