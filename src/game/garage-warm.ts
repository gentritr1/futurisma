/**
 * Garage warm-up — compiles, uploads and draws once what a first visit to the
 * bay draws, from the menu, on idle, so the first open, the first part
 * close-up, the first LANCE or CORONA and the first underglow each find
 * everything ready instead of freezing a frame on it.
 *
 * WHY THE BAY RECOMPILES THE CRAFT. The bay is its own scene: linear fog, four
 * lights of its own and no shadow caster, where the race has exponential fog,
 * its circuit's lights and a shadow-casting key light. three keys a program on
 * all of those, so every material the craft wears needs a second program in
 * the bay. `renderer.compile(root, camera, bay)` builds exactly those —
 * the bay's lights and fog, the root's own materials and geometry — without
 * moving anything: the craft stays where the race draws it. With
 * KHR_parallel_shader_compile the driver links in the background and this
 * waits for it without blocking a frame (see `compileSliced`); without it,
 * the link happens here, on idle, rather than on the open.
 *
 * WHY ONE HIDDEN DRAW AS WELL. A linked program is not the whole bill: the
 * driver builds its pipeline state (vertex layout, blending, the canvas's
 * formats) on the first draw, and the geometry is uploaded then. Measured
 * before this draw existed: a fully compiled LANCE still froze its first view
 * for 167 ms with no link. So each warmed root is drawn once, into a single
 * pixel of the CANVAS (a render target has other formats, and three would pick
 * other programs for it), right after a real menu frame has been drawn into
 * the same buffer — never onto an empty one — with culling off so every mesh
 * draws. The paddock is drawn again on the next frame.
 *
 * Each step runs in its own idle slice or frame, so the menu never holds a
 * long frame for the warm-up. Lazy, in the garage chunk.
 */
import * as THREE from "three";
import { showroomWarmup } from "./garage-look";

/** One idle slice (a short timeout where the browser has no idle callback, as Safari). */
export const idle = (): Promise<void> => new Promise((resolve) => {
  if (typeof requestIdleCallback === "function") requestIdleCallback(() => resolve(), { timeout: 400 });
  else setTimeout(resolve, 32);
});

const TEXTURE_SLOTS = ["map", "emissiveMap", "normalMap", "roughnessMap", "metalnessMap", "alphaMap", "aoMap"] as const;

function texturesOf(root: THREE.Object3D, seen: Set<THREE.Texture>): THREE.Texture[] {
  const found: THREE.Texture[] = [];
  root.traverse((object) => {
    const material = (object as THREE.Mesh).material;
    for (const each of Array.isArray(material) ? material : material ? [material] : []) {
      for (const slot of TEXTURE_SLOTS) {
        const texture = (each as unknown as Record<string, THREE.Texture | null | undefined>)[slot];
        if (texture?.isTexture && !seen.has(texture)) { seen.add(texture); found.push(texture); }
      }
    }
    // Textures no material wears yet (TOTEM's one-channel light map), handed over by name.
    for (const texture of (object.userData.warmTextures as THREE.Texture[] | undefined) ?? []) {
      if (!seen.has(texture)) { seen.add(texture); found.push(texture); }
    }
  });
  return found;
}

/** New programs per idle slice: each costs the driver a few ms of translation. */
const PROGRAMS_PER_SLICE = 2;
type Programmed = { currentProgram?: { isReady(): boolean } };

/**
 * `renderer.compileAsync(root, camera, bay)`, sliced: mesh by mesh, yielding
 * after every {@link PROGRAMS_PER_SLICE} new programs, then waiting for the
 * links on idle. `compileAsync` itself compiles a whole root in one task and
 * asks the driver whether each program is ready straight away — a synchronous
 * round trip that waits out every translation just queued (measured: one 255 ms
 * menu task for the craft alone, from an empty shader cache).
 */
async function compileSliced(renderer: THREE.WebGLRenderer, root: THREE.Object3D, camera: THREE.Camera, bay: THREE.Scene, stop: () => boolean): Promise<boolean> {
  const done = new Set<THREE.Material>();
  const meshes: THREE.Object3D[] = [];
  root.traverse((object) => { if ((object as THREE.Mesh).material) meshes.push(object); });
  let fresh = 0;
  for (const mesh of meshes) {
    const material = (mesh as THREE.Mesh).material;
    if ((Array.isArray(material) ? material : [material]).every((each) => done.has(each))) continue;
    const before = renderer.info.programs?.length ?? 0;
    for (const each of renderer.compile(mesh, camera, bay)) done.add(each);
    fresh += (renderer.info.programs?.length ?? 0) - before;
    if (fresh < PROGRAMS_PER_SLICE) continue;
    fresh = 0;
    await idle();
    if (stop()) return false;
  }
  // Ask only once the driver has had a moment: the first question is the one that waits.
  for (let pending = [...done]; pending.length;) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    await idle();
    if (stop()) return false;
    pending = pending.filter((material) => !((renderer.properties.get(material) as Programmed).currentProgram?.isReady() ?? true));
  }
  return true;
}

const viewport = new THREE.Vector4();
const scissor = new THREE.Vector4();

/**
 * Draws `root` once in the bay, into the canvas's bottom-left pixel, straight
 * after the page's own next frame (its scene's `onAfterRender`, then a
 * microtask, so the draw lands in the buffer that frame filled). `root` may be
 * the craft itself, which is lent to the bay for that one synchronous draw and
 * put back at its index before anything else runs. Resolves false, drawing
 * nothing, when no frame of the craft's scene comes within a second.
 */
function drawHidden(renderer: THREE.WebGLRenderer, bay: THREE.Scene, camera: THREE.Camera, root: THREE.Object3D, page: THREE.Object3D, requestRender: () => void): Promise<boolean> {
  let scene: THREE.Object3D = page;
  while (scene.parent) scene = scene.parent;
  if (!(scene as THREE.Scene).isScene || scene === bay) return Promise.resolve(false);
  const host = scene as THREE.Scene;
  return new Promise((resolve) => {
    const previous = host.onAfterRender;
    const timeout = window.setTimeout(() => { host.onAfterRender = previous; resolve(false); }, 1000);
    host.onAfterRender = function (...args) {
      previous.apply(this, args);
      host.onAfterRender = previous;
      clearTimeout(timeout);
      queueMicrotask(() => {
        const parent = root.parent, index = parent ? parent.children.indexOf(root) : -1;
        const culled = new Map<THREE.Object3D, boolean>();
        const test = renderer.getScissorTest();
        renderer.getViewport(viewport); renderer.getScissor(scissor);
        bay.add(root);
        // The bay's own floor and walls too: whatever its camera can see, everything draws.
        bay.traverse((object) => { culled.set(object, object.frustumCulled); object.frustumCulled = false; });
        try {
          renderer.setViewport(0, 0, 1, 1); renderer.setScissor(0, 0, 1, 1); renderer.setScissorTest(true);
          renderer.render(bay, camera);
        } finally {
          bay.remove(root);
          if (parent) {
            parent.add(root); parent.children.splice(parent.children.length - 1, 1); parent.children.splice(index, 0, root);
            // Its world matrices were the bay's for that draw; anything read before the next frame sees the race's again.
            root.updateWorldMatrix(false, true);
          }
          renderer.setViewport(viewport); renderer.setScissor(scissor); renderer.setScissorTest(test);
          for (const [object, value] of culled) object.frustumCulled = value;
          requestRender();
        }
        resolve(true);
      });
    };
    requestRender();
  });
}

/**
 * Warms the bay: its own floor, walls and lights first, then everything
 * `showroomWarmup` hands over, compiled against `bay` (resolving once every
 * program reports ready), its textures uploaded, and drawn once. It carries on
 * if the bay opens meanwhile (the frames and the wash are still ahead of the
 * driver), skipping only the hidden draws; `stop` (a disposed bay) ends it.
 */
export async function warmShowroom(renderer: THREE.WebGLRenderer, bay: THREE.Scene, camera: THREE.Camera, circuit: string, requestRender: () => void, stop: () => boolean): Promise<void> {
  const seen = new Set<THREE.Texture>();
  await idle();
  if (stop() || !await compileSliced(renderer, bay, camera, bay, stop)) return;
  let page: THREE.Object3D | null = null;
  for await (const root of showroomWarmup(circuit)) {
    page ??= root;
    await idle();
    if (stop() || !await compileSliced(renderer, root, camera, bay, stop)) return;
    for (const texture of texturesOf(root, seen)) {
      await idle();
      if (stop()) return;
      renderer.initTexture(texture);
    }
    await idle();
    if (stop()) return;
    await drawHidden(renderer, bay, camera, root, page, requestRender);
  }
}
