import * as THREE from "three";

/**
 * Load-time GPU warm-up, run once behind the loading screen.
 *
 * WHY. three compiles a program the first time a material is DRAWN with a given
 * light/fog/shadow state, and the game never asked it to do that early. Measured
 * on the prod build (Chrome on ANGLE Metal, M1 Pro), the first frame after load
 * blocked 354-768 ms compiling 47-91 programs, and more compiled mid-race:
 * Greenwater 52 on entering the hangar (worst frame 4.55 s cold), Frostline 14,
 * Dream Island 11, Night Shift 10.
 *
 * WHY ALL FIVE STEPS. `compileAsync` alone was measured and left 15 programs
 * compiling mid-race: the shadow depth/distance clones `WebGLShadowMap` makes per
 * material only exist once a shadow pass has drawn that mesh, and texture
 * uploads still landed in the hangar frame. So:
 *
 *  1. Light counts are already constant by the time this runs — every light the
 *     race uses stays `visible` and carries its state in `intensity` (the hangar
 *     lamps in atmosphere.ts; `presenceLight` always did). The light counts are
 *     part of three's program key; intensity is not.
 *  2. `compileAsync` with the race camera: every material in the scene, visible
 *     or not, compiled through KHR_parallel_shader_compile where it exists.
 *  3. Every shadow depth variant the race can reach, compiled explicitly (see
 *     `compileShadowVariants`): the shadow pass shares ONE depth material and
 *     only re-keys its program on some state changes, so which variant it
 *     needs depends on draw order — a single warm render cannot reach them all.
 *  4. `initTexture` on every texture a material or uniform holds.
 *  5. ONE render with every mesh drawn: `frustumCulled` off and hidden non-light
 *     objects shown, so the main and shadow passes bind every program and
 *     texture once. Lights the forced parents would
 *     newly expose are hidden for that frame, so the light state — and therefore
 *     every program key — is exactly the race's. All flags are restored after.
 *
 * `?warmup=0` skips it (A/B kill switch). The cost is printed as
 * `[FUTURISMA_WARMUP]` so a run can be read without the diagnostics overlay.
 */

export interface RenderWarmupReport {
  readonly programsBefore: number;
  readonly programsAfter: number;
  readonly compileMs: number;
  readonly shadowCasters: number;
  readonly shadowMs: number;
  readonly textures: number;
  readonly textureMs: number;
  readonly renderMs: number;
  readonly totalMs: number;
  readonly forcedVisible: number;
  readonly lights: number;
  readonly capped: boolean;
}

type MaterialHolder = THREE.Object3D & { material?: THREE.Material | THREE.Material[] };
type LightLike = THREE.Object3D & { isLight?: boolean };

function collectTextures(scene: THREE.Scene): Set<THREE.Texture> {
  const textures = new Set<THREE.Texture>();
  const take = (value: unknown): void => {
    if (value instanceof THREE.Texture) textures.add(value);
  };
  const seen = new Set<THREE.Material>();
  scene.traverse((object) => {
    const held = (object as MaterialHolder).material;
    if (!held) return;
    for (const material of Array.isArray(held) ? held : [held]) {
      if (seen.has(material)) continue;
      seen.add(material);
      for (const value of Object.values(material)) take(value);
      const uniforms = (material as THREE.ShaderMaterial).uniforms;
      if (uniforms) for (const uniform of Object.values(uniforms)) take(uniform?.value);
    }
  });
  take(scene.background);
  take(scene.environment);
  return textures;
}

type ShadowSource = THREE.Material & Partial<Pick<THREE.MeshStandardMaterial,
  "map" | "alphaMap" | "displacementMap" | "displacementScale" | "displacementBias" | "wireframe" | "wireframeLinewidth">>
  & { linewidth?: number };
type Caster = THREE.Object3D & {
  material?: THREE.Material | THREE.Material[];
  customDepthMaterial?: THREE.Material;
  customDistanceMaterial?: THREE.Material;
  isMesh?: boolean; isLine?: boolean; isPoints?: boolean;
};

const SHADOW_SIDE: Record<number, THREE.Side> = {
  [THREE.FrontSide]: THREE.BackSide,
  [THREE.BackSide]: THREE.FrontSide,
  [THREE.DoubleSide]: THREE.DoubleSide,
};

/**
 * Programs the shadow pass can ask for, compiled now. Mirrors three r184's
 * `WebGLShadowMap.getDepthMaterial`: the pass draws every caster with ONE shared
 * depth (or distance) material whose side/map/alphaTest it overwrites per
 * object, and WebGLRenderer only re-keys that material's program when an
 * instancing/skinning/morph/... check flips — not on side, map or normals. So
 * the key the pass lands on is the key of whichever caster triggered the
 * re-key, which depends on draw order and culling. Measured on Greenwater: a
 * plain double-sided depth program (static_signature_steel, the dock) compiled
 * mid-race at +6.8 s on roughly one run in four, after the warm render had
 * drawn that same mesh without needing it.
 *
 * Every reachable key is the key of some caster, so each caster is compiled once
 * with a private copy of the depth material set up exactly as the pass would,
 * under a render target and without fog (shadow maps render with no tone
 * mapping, a linear output and a null scene). The copies are kept: disposing one would release a program it may be
 * the only user of. Returns the readiness promises so the caller awaits them.
 */
const shadowVariantMaterials: THREE.Material[] = [];
function compileShadowVariants(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): { casters: number; ready: Promise<unknown>[] } {
  const ready: Promise<unknown>[] = [];
  if (!renderer.shadowMap.enabled) return { casters: 0, ready };
  let directional = false;
  let point = false;
  scene.traverseVisible((object) => {
    const light = object as THREE.Light & { isPointLight?: boolean };
    if (!light.isLight || !light.castShadow) return;
    if (light.isPointLight) point = true;
    else directional = true;
  });
  if (!directional && !point) return { casters: 0, ready };
  const vsm = renderer.shadowMap.type === THREE.VSMShadowMap;
  const bases: THREE.Material[] = [];
  if (directional) bases.push(new THREE.MeshDepthMaterial());
  if (point) bases.push(new THREE.MeshDistanceMaterial());
  const previousTarget = renderer.getRenderTarget();
  const target = new THREE.WebGLRenderTarget(1, 1);
  // The pass draws with `scene === null`, so its programs are keyed fog-less.
  const fog = scene.fog;
  let casters = 0;
  renderer.setRenderTarget(target);
  scene.fog = null;
  try {
    scene.traverse((node) => {
      const object = node as Caster;
      if (!(object.isMesh || object.isLine || object.isPoints) || !object.material) return;
      if (!object.castShadow && !(vsm && object.receiveShadow)) return;
      casters += 1;
      const original = object.material;
      for (const source of (Array.isArray(original) ? original : [original]) as ShadowSource[]) {
        for (const base of bases) {
          const custom = base instanceof THREE.MeshDistanceMaterial
            ? object.customDistanceMaterial
            : object.customDepthMaterial;
          const variant = (custom ?? base.clone()) as ShadowSource;
          if (!custom) {
            variant.visible = source.visible;
            variant.wireframe = source.wireframe ?? false;
            variant.side = source.shadowSide !== null
              ? source.shadowSide
              : vsm ? source.side : SHADOW_SIDE[source.side];
            variant.alphaMap = source.alphaMap ?? null;
            variant.alphaTest = source.alphaToCoverage ? 0.5 : source.alphaTest;
            variant.map = source.map ?? null;
            variant.clipShadows = source.clipShadows;
            variant.clippingPlanes = source.clippingPlanes;
            variant.clipIntersection = source.clipIntersection;
            variant.displacementMap = source.displacementMap ?? null;
            variant.displacementScale = source.displacementScale ?? 1;
            variant.displacementBias = source.displacementBias ?? 0;
            variant.wireframeLinewidth = source.wireframeLinewidth ?? 1;
            variant.linewidth = source.linewidth;
            shadowVariantMaterials.push(variant);
          }
          object.material = variant;
          try {
            ready.push(renderer.compileAsync(object, camera, scene));
          } finally {
            object.material = original;
          }
        }
      }
    });
  } finally {
    scene.fog = fog;
    renderer.setRenderTarget(previousTarget);
    target.dispose();
  }
  return { casters, ready };
}

/**
 * `compileAsync` polls `COMPLETION_STATUS` and never resolves on a lost context,
 * so the waits are capped: a slow or lost GPU costs at most this much loading
 * screen once (a second wait after a cap is skipped), then the race starts and
 * compiles on first draw as it did before.
 */
const WAIT_CAP_MS = 10_000;
let capped = false;
const settle = (promise: Promise<unknown>): Promise<unknown> => capped ? Promise.resolve(null) : Promise.race([
  promise,
  new Promise((resolve) => setTimeout(() => { capped = true; resolve(null); }, WAIT_CAP_MS)),
]);

/** Never throws: a failed warm-up costs the hitches it exists to remove, not the race. */
export async function warmRenderer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  disposed: () => boolean,
): Promise<RenderWarmupReport | null> {
  if (new URLSearchParams(location.search).get("warmup") === "0" || disposed()) return null;
  if (renderer.getContext().isContextLost()) return null;
  try {
    return await warm(renderer, scene, camera, disposed);
  } catch (error) {
    console.warn("[FUTURISMA_WARMUP] failed; shaders will compile on first draw.", error);
    return null;
  }
}

async function warm(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  disposed: () => boolean,
): Promise<RenderWarmupReport> {
  const programs = (): number => renderer.info.programs?.length ?? 0;
  const programsBefore = programs();
  const started = performance.now();
  scene.updateMatrixWorld(true);
  await settle(renderer.compileAsync(scene, camera));
  const compiled = performance.now();
  const shadow = compileShadowVariants(renderer, scene, camera);
  await settle(Promise.all(shadow.ready));
  const shadowed = performance.now();

  const textures = collectTextures(scene);
  if (!disposed()) for (const texture of textures) renderer.initTexture(texture);
  const uploaded = performance.now();

  // The race's own light set, before any flag below changes what is reachable.
  const raceLights = new Set<THREE.Object3D>();
  scene.traverseVisible((object) => {
    if ((object as LightLike).isLight) raceLights.add(object);
  });
  const culled: THREE.Object3D[] = [];
  const shown: THREE.Object3D[] = [];
  const darkened: THREE.Object3D[] = [];
  scene.traverse((object) => {
    if (object.frustumCulled) {
      object.frustumCulled = false;
      culled.push(object);
    }
    if (!object.visible && !(object as LightLike).isLight) {
      object.visible = true;
      shown.push(object);
    }
  });
  scene.traverseVisible((object) => {
    if ((object as LightLike).isLight && !raceLights.has(object)) {
      object.visible = false;
      darkened.push(object);
    }
  });
  try {
    if (!disposed() && !renderer.getContext().isContextLost()) {
      renderer.shadowMap.needsUpdate = true;
      renderer.render(scene, camera);
    }
  } finally {
    for (const object of culled) object.frustumCulled = true;
    for (const object of shown) object.visible = false;
    for (const object of darkened) object.visible = true;
  }
  const rendered = performance.now();

  const report: RenderWarmupReport = {
    programsBefore,
    programsAfter: programs(),
    compileMs: Math.round(compiled - started),
    shadowCasters: shadow.casters,
    shadowMs: Math.round(shadowed - compiled),
    textures: textures.size,
    textureMs: Math.round(uploaded - shadowed),
    renderMs: Math.round(rendered - uploaded),
    totalMs: Math.round(rendered - started),
    forcedVisible: shown.length,
    lights: raceLights.size,
    capped,
  };
  console.info(`[FUTURISMA_WARMUP] ${JSON.stringify(report)}`);
  return report;
}
