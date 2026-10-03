import type {CircuitRuntime} from "./circuit-runtime";
import type { RaceCourse } from "./course";
import type { InputController } from "./input";
import type { EngineAudio } from "./audio";
import type { GameUi } from "./ui";
import type { PolarityCourse } from "./polarity-course";
import type { TidelineCourse } from "./tideline-course";

export async function createCircuitRuntime(course: RaceCourse, input: InputController, audio: EngineAudio,
  ui: GameUi, reducedMotion: boolean, cancelled: () => boolean): Promise<CircuitRuntime | null> {
  let runtime: CircuitRuntime | null = null;
  if (course.kind === "frostline") {
    const {FrostlineRuntime}=await import("./frostline-runtime");
    if(cancelled())return null;
    runtime=new FrostlineRuntime(course as import("./frostline-course").FrostlineCourse,audio,ui);
  } else if (course.kind === "afterglow") {
    const {AfterglowRuntime}=await import('./afterglow-runtime');
    if(cancelled())return null;
    runtime=new AfterglowRuntime(course as import('./afterglow-course').AfterglowCourse,input,audio,ui);
  } else if (course.kind === "polarity") {
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
  }
  if(course.kind!=="frostline"){
    const {CircuitEnrichment}=await import("./circuit-enrichment");
    if(cancelled()){runtime?.dispose();return null;}
    const {CircuitBoothKit}=await import('./circuit-booth-kit');
    // A failed optional art load leaves the original procedural booths usable.
    const boothKit=await CircuitBoothKit.load(course.kind).catch(error=>{
      console.warn('Using original roadside booths:',error);return null;
    });
    if(cancelled()){boothKit?.dispose();runtime?.dispose();return null;}
    const {CircuitDistricts}=await import('./circuit-districts');
    const districts=await CircuitDistricts.load(course).catch(error=>{
      console.warn('Optional district art unavailable:',error);return null;
    });
    if(cancelled()){districts?.dispose();boothKit?.dispose();runtime?.dispose();return null;}
    runtime=new CircuitEnrichment(course,runtime,audio,ui,reducedMotion,boothKit,districts);
  }
  if(!runtime)return null;
  await runtime.ready;
  if (cancelled()) { runtime.dispose(); return null; }
  const {installRaceTimingKit} = await import('./race-timing-kit');
  await installRaceTimingKit(runtime, cancelled).catch(error => console.warn('Optional timing hardware unavailable:', error));
  if (cancelled()) { runtime.dispose(); return null; }
  const {installCircuitSignature}=await import('./circuit-signatures');
  await installCircuitSignature(runtime,audio,reducedMotion,cancelled).catch(error=>console.warn('Optional circuit scene unavailable:',error));
  if(cancelled()){runtime.dispose();return null;}
  course.finishEnvironment=async root=>{
    if(!root||cancelled())return;
    try {
      const {finishCircuitSurfaces}=await import('./circuit-surface-finish');
      if(!cancelled())await finishCircuitSurfaces(course,root,cancelled);
    } catch(error) { console.warn('Optional surface finish unavailable:',error); }
  };
  // Phase F. The ONE shared change the island's HUD skin needs: the circuit's
  // own id on the document element, so a stylesheet that ships inside a
  // circuit's lazy chunk can scope itself to that circuit and reach the shared
  // HUD nodes. It is cleared on dispose, so a quit to the paddock and a second
  // race on another map cannot leave the island's skin behind.
  document.documentElement.dataset.circuit = course.kind;
  const disposeRuntime = runtime.dispose.bind(runtime);
  runtime.dispose = () => { delete course.finishEnvironment;delete document.documentElement.dataset.circuit; disposeRuntime(); };
  return runtime;
}
