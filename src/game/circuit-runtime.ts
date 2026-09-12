import type * as THREE from "three";
import type { CourseProjection, RaceCourse } from "./course";
import type { InputFrame } from "./input";
import type { TotemVisualState } from "./totem";
import type { InputController } from "./input";
import type { EngineAudio } from "./audio";
import type { GameUi } from "./ui";
import type { PolarityCourse } from "./polarity-course";
import type { TidelineCourse } from "./tideline-course";

export async function createCircuitRuntime(course: RaceCourse, input: InputController, audio: EngineAudio,
  ui: GameUi, reducedMotion: boolean, cancelled: () => boolean): Promise<CircuitRuntime | null> {
  let runtime: CircuitRuntime;
  if (course.kind === "polarity") {
    const { PolarityRuntime } = await import("./polarity-runtime");
    if (cancelled()) return null;
    runtime = new PolarityRuntime(course as PolarityCourse, input, audio, ui, reducedMotion);
  } else if (course.kind === "tideline") {
    const { TidelineRuntime } = await import("./tideline-runtime");
    if (cancelled()) return null;
    runtime = new TidelineRuntime(course as TidelineCourse, input, audio, ui, reducedMotion);
  } else if(course.kind === "dreamisland") {
    const {DreamIslandRuntime}=await import("./dreamisland-runtime");if(cancelled())return null;
    runtime=new DreamIslandRuntime(course as import("./dreamisland-course").DreamIslandCourse,input,audio,ui);
  } else if(course.kind === "ascension") {
    const {AscensionRuntime}=await import("./ascension-runtime");if(cancelled())return null;
    runtime=new AscensionRuntime(course as import("./ascension-course").AscensionCourse,input,audio,ui);
  } else return null;
  await runtime.ready;
  if (cancelled()) { runtime.dispose(); return null; }
  // Phase F. The ONE shared change the island's HUD skin needs: the circuit's
  // own id on the document element, so a stylesheet that ships inside a
  // circuit's lazy chunk can scope itself to that circuit and reach the shared
  // HUD nodes. It is cleared on dispose, so a quit to the paddock and a second
  // race on another map cannot leave the island's skin behind.
  document.documentElement.dataset.circuit = course.kind;
  const disposeRuntime = runtime.dispose.bind(runtime);
  runtime.dispose = () => { delete document.documentElement.dataset.circuit; disposeRuntime(); };
  return runtime;
}

/** Small adapter between authored circuit rules and the existing fixed-step race. */
export interface CircuitRuntime {
  readonly course: RaceCourse & { readonly rivalCourse?: RaceCourse | null };
  readonly ready: Promise<void>;
  readonly ceiling: boolean;
  readonly isFlipping: boolean;
  readonly surgeActive: boolean;
  readonly shieldActive: boolean;
  readonly boostRechargeScale: number;
  handleActions(running: boolean, progress: number, position: THREE.Vector3, lateral: number, demo: boolean): boolean;
  step(delta: number, progress: number, lateral: number, lap: number): void;
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
