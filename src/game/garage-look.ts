/**
 * Garage — puts a fitted craft on the player's TOTEM: the frame's own body,
 * the running-light colour, the boost flame and the underglow.
 *
 * Lazy, like the rest of the showroom, and applied through
 * `FuturismaGame.refitCraft`, which hands over the craft and repaints the
 * paddock once the refit resolves. Everything here touches player-only
 * surfaces: rivals and the ghost cloned the works TOTEM at load.
 *
 * FRAME BODIES. Each frame other than TOTEM is its own GLB
 * (`art/blender/build_garage_frames.py`), loaded the first time it is fitted
 * or previewed and cached for this craft. `TotemVehicle.mountBody` swaps it in
 * for TOTEM's hull and re-anchors the animation, effects and kit to it.
 * Loading is async and the showroom refits on every keypress, so each refit
 * takes a serial and only the latest one mounts; a stale load still lands in
 * the cache for the next time.
 *
 * BODY PAINT. A scheme is a whole 512 atlas (`paint/<frame>-<scheme>.jpg`),
 * and both `FRAME_paint` and `FRAME_accent` sample the atlas they were built
 * with, so one texture swap repaints the body and its signal colour together.
 * A scheme is fetched once per page and shared; FACTORY puts the GLB's own map
 * back. The swap waits for the atlas BEFORE the body mounts, so a refit never
 * shows the factory paint for a frame and then the scheme.
 *
 * UNDERGLOW PATTERNS animate in the wash's own shader from a time uniform, all
 * at or under 3 Hz, and hold STEADY when the driver asked for reduced motion.
 *
 * WHY TOTEM'S LIGHTS GO MONOCHROME FIRST. `TOTEM_emissive` samples a painted
 * emissive map whose lamps are cyan and acid green; tinting it directly would
 * MULTIPLY (amber over cyan is mud). A fitted colour swaps in a one-channel
 * copy of the map and lets the emissive colour tint it; `stock` restores the
 * painted original. A frame body's `FRAME_lights` has no map: its emissive
 * colour IS the light, so it is tinted directly.
 */
import * as THREE from "three";
import type { TotemVehicle } from "./totem";
import { resolvePaint } from "./garage-catalog.js";
import { PATTERN_CODES, type Garage } from "./garage-rules.js";

const UNDERGLOW_NAME = "garage_underglow";
const WORKS_FLAME = 0xff581d;
/** Phases that draw every frame, where an underglow pattern can move. */
const MOVING_PHASES = new Set(["race", "countdown", "paused", "resuming"]);
/** Circuits whose render rule adapts every gameplay material for their fog. */
const RULED_CIRCUITS = new Set(["tideline", "ascension", "dreamisland"]);

interface StockLights {
  map: THREE.Texture | null;
  emissive: THREE.Color;
}

const stockLights = new WeakMap<THREE.MeshStandardMaterial, StockLights>();
const monoLights = new WeakMap<THREE.MeshStandardMaterial, THREE.Texture>();
/** Per craft, so a new game (a relink, a hot reload) never mounts a disposed body. */
const bodies = new WeakMap<TotemVehicle, Map<string, Promise<THREE.Object3D | null>>>();
const serials = new WeakMap<TotemVehicle, number>();
/** Scheme atlases by URL, fetched once per page and shared by every craft. */
const schemeMaps = new Map<string, Promise<THREE.Texture | null>>();
/** Each body material's own map, so FACTORY can put it back. */
const factoryMaps = new WeakMap<THREE.MeshStandardMaterial, THREE.Texture | null>();
/** The craft the last refit dressed: the one the showroom turns. */
let showroomCraft: TotemVehicle | null = null;

/**
 * The showroom turntable: yaws the craft's visual group (which the race loop
 * never yaws; it banks and pitches it) about its own origin, in place in
 * front of the chase camera. Zero puts it back exactly as it races.
 */
export function turnCraft(radians: number): void {
  const hull = showroomCraft?.craftSurfaces().hull;
  if (hull) hull.rotation.y = radians;
}

/**
 * One channel of the painted emissive map, in the source's own orientation and
 * sampling. Null when the image is not something a canvas can read (it always
 * is for a loaded GLB; null keeps the refit non-fatal if it ever is not).
 */
function monochromeCopy(source: THREE.Texture): THREE.Texture | null {
  const image = source.image as (CanvasImageSource & { width?: number; height?: number }) | null;
  const width = image?.width ?? 0;
  const height = image?.height ?? 0;
  if (!image || width <= 0 || height <= 0) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, width, height);
  const data = pixels.data;
  for (let index = 0; index < data.length; index += 4) {
    const peak = Math.max(data[index], data[index + 1], data[index + 2]);
    data[index] = data[index + 1] = data[index + 2] = peak;
  }
  context.putImageData(pixels, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  // GLTFLoader uploads its bitmaps pre-oriented with flipY false; the copy was
  // drawn from that bitmap, so it has to be uploaded the same way or the lamps
  // land on the wrong panels.
  texture.flipY = source.flipY;
  texture.colorSpace = source.colorSpace;
  texture.wrapS = source.wrapS;
  texture.wrapT = source.wrapT;
  texture.magFilter = source.magFilter;
  texture.minFilter = source.minFilter;
  texture.anisotropy = source.anisotropy;
  texture.channel = source.channel;
  return texture;
}

function fitTotemLights(lights: THREE.MeshStandardMaterial, hex: number | null): void {
  if (!stockLights.has(lights)) {
    stockLights.set(lights, { map: lights.emissiveMap, emissive: lights.emissive.clone() });
  }
  const stock = stockLights.get(lights)!;
  if (hex === null) {
    const mono = monoLights.get(lights);
    lights.emissiveMap = stock.map;
    lights.emissive.copy(stock.emissive);
    if (mono) {
      mono.dispose();
      monoLights.delete(lights);
    }
    return;
  }
  let mono = monoLights.get(lights) ?? null;
  if (!mono && stock.map) {
    mono = monochromeCopy(stock.map);
    if (mono) monoLights.set(lights, mono);
  }
  if (mono) lights.emissiveMap = mono;
  lights.emissive.setHex(hex);
}

/**
 * A soft rounded-rectangle wash under the hull. Additive and depth-tested, so
 * the hull itself hides the middle and what reads from the chase camera is the
 * rim of light around the skirts — which is what an underglow is.
 */
function createUnderglow(): THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
  const material = new THREE.ShaderMaterial({
    name: UNDERGLOW_NAME,
    uniforms: { uColor: { value: new THREE.Color() }, uPattern: { value: 0 }, uTime: { value: 0 }, uHold: { value: 1 } },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    // Patterns: 0 STEADY, 1 BREATHE (0.5 Hz swell), 2 CHASE (a band sweeping
    // nose to tail at 0.8 Hz), 3 HEARTBEAT (a double pulse at 0.9 Hz). None
    // exceeds 3 Hz and none lifts the wash past its steady 0.6 ceiling.
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uPattern;
      uniform float uTime;
      uniform float uHold;
      varying vec2 vUv;
      void main() {
        vec2 edge = abs(vUv - 0.5) * 2.0;
        float reach = length(max(edge - vec2(0.42, 0.6), 0.0)) / 0.5;
        float glow = (1.0 - smoothstep(0.0, 1.0, reach)) * 0.6;
        float level = 1.0;
        if (uHold > 0.5) {
          level = 1.0;
        } else if (uPattern > 2.5) {
          float beat = fract(uTime * 0.9);
          level = 0.35 + 0.65 * max(exp(-beat * 16.0), exp(-abs(beat - 0.24) * 16.0));
        } else if (uPattern > 1.5) {
          level = 0.3 + 0.7 * smoothstep(0.62, 1.0, fract(vUv.y + uTime * 0.8));
        } else if (uPattern > 0.5) {
          level = 0.55 + 0.45 * sin(uTime * 3.14159265);
        }
        gl_FragColor = vec4(uColor * glow * level, glow * level);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 6.4), material);
  mesh.name = UNDERGLOW_NAME;
  // A pattern only moves where frames keep coming: racing, and the open bay.
  // The paddock and the result screen draw on request, so a still frame there
  // would freeze the pattern at whatever phase it had (BREATHE near its floor
  // reads as OFF); those frames hold the full steady wash instead.
  mesh.onBeforeRender = () => {
    const body = document.body.dataset;
    material.uniforms.uTime.value = performance.now() / 1000;
    material.uniforms.uHold.value = body.garage === "true" || MOVING_PHASES.has(body.phase ?? "") ? 0 : 1;
  };
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 2;
  return mesh;
}

/**
 * The circuit's render rule, for a body mounted after the course adapted the
 * rest of the craft: the same adaptation, or the body alone would skip the fog.
 */
async function applyCircuitRule(circuit: string, ...roots: THREE.Object3D[]): Promise<void> {
  if (!RULED_CIRCUITS.has(circuit)) return;
  const { applyTidelineRenderRule } = await import("./tideline-render-rule");
  applyTidelineRenderRule(...roots);
}

function bodyFor(vehicle: TotemVehicle, frame: string, circuit: string): Promise<THREE.Object3D | null> {
  let cache = bodies.get(vehicle);
  if (!cache) bodies.set(vehicle, (cache = new Map()));
  let body = cache.get(frame);
  if (!body) {
    // The livery atlas is painted at 512 with noise and gradients, so it takes
    // the linear painterly class, like the baked environment GLBs.
    body = vehicle.loadBody(`/assets/garage/frames/${frame}.glb`, { textureCharacter: "painterly" })
      .then(async (loaded) => {
        await applyCircuitRule(circuit, loaded);
        return loaded;
      })
      // A body that will not load costs the player the look, never the race:
      // the craft stays TOTEM and a later refit tries again.
      .catch((error: unknown) => {
        console.warn(`Garage frame ${frame} could not load; racing the TOTEM hull.`, error);
        cache.delete(frame);
        return null;
      });
    cache.set(frame, body);
  }
  return body;
}

/** The body's two atlas-sampling materials, paint and accent. */
function atlasMaterials(body: THREE.Object3D): THREE.MeshStandardMaterial[] {
  const found = new Set<THREE.MeshStandardMaterial>();
  body.traverse((object) => {
    const material = (object as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (material && (material.name === "FRAME_paint" || material.name === "FRAME_accent")) found.add(material);
  });
  for (const material of found) if (!factoryMaps.has(material)) factoryMaps.set(material, material.map);
  return [...found];
}

/**
 * A scheme's atlas, sampled exactly like the factory one it replaces: same
 * orientation, colour space, wrapping and filter class (the PS2 treatment and
 * the painterly class were applied to the factory map at load).
 */
function schemeMap(frame: string, scheme: string, factory: THREE.Texture): Promise<THREE.Texture | null> {
  const url = `/assets/garage/frames/paint/${frame}-${scheme}.jpg`;
  let map = schemeMaps.get(url);
  if (!map) {
    map = new THREE.TextureLoader().loadAsync(url)
      .then((texture) => {
        texture.flipY = factory.flipY;
        texture.colorSpace = factory.colorSpace;
        texture.wrapS = factory.wrapS;
        texture.wrapT = factory.wrapT;
        texture.magFilter = factory.magFilter;
        texture.minFilter = factory.minFilter;
        texture.generateMipmaps = factory.generateMipmaps;
        texture.anisotropy = factory.anisotropy;
        texture.channel = factory.channel;
        return texture;
      })
      // A scheme that will not load costs the paint, never the race: the body
      // keeps its factory livery and a later refit tries again.
      .catch((error: unknown) => {
        console.warn(`Garage paint ${frame}-${scheme} could not load; keeping the factory livery.`, error);
        schemeMaps.delete(url);
        return null;
      });
    schemeMaps.set(url, map);
  }
  return map;
}

/** Options the running page decides for the look. */
export interface CraftLookOptions {
  /** Reduced motion, as `resolveReducedMotion` reads it: patterns hold STEADY. */
  still?: boolean;
}

/**
 * Fits the frame on the grid — or, with `previewFrame`, one the driver is only
 * looking at in the showroom, wearing its own fitted look. `garage` may be a
 * trial garage the paint shop built to show a scheme or a pattern before it is
 * bought. Resolves once the refit is on the craft (or has been superseded by a
 * newer one).
 */
export async function applyCraftLook(
  vehicle: TotemVehicle,
  garage: Garage,
  previewFrame: string | null = null,
  circuit = "",
  options: CraftLookOptions = {},
): Promise<void> {
  const serial = (serials.get(vehicle) ?? 0) + 1;
  serials.set(vehicle, serial);
  showroomCraft = vehicle;
  const frame = previewFrame ?? garage.chassis;
  const body = frame === "totem" ? null : await bodyFor(vehicle, frame, circuit);
  if (serials.get(vehicle) !== serial) return;
  const scheme = garage.fleet[frame]?.body ?? "factory";
  const surfaces = body ? atlasMaterials(body) : [];
  const factory = surfaces.length > 0 ? factoryMaps.get(surfaces[0]) ?? null : null;
  const painted = factory && scheme !== "factory" ? await schemeMap(frame, scheme, factory) : null;
  if (serials.get(vehicle) !== serial) return;
  for (const material of surfaces) material.map = painted ?? factoryMaps.get(material) ?? material.map;
  vehicle.mountBody(body);

  const fit = garage.fleet[frame];
  const glow = resolvePaint(frame, "glow", fit?.glow ?? "stock");
  const flame = resolvePaint(frame, "flame", fit?.flame ?? "stock");
  const under = resolvePaint(frame, "under", fit?.under ?? "off");
  const { hull, lights, flame: jets } = vehicle.craftSurfaces();
  if (body) {
    body.traverse((object) => {
      const material = (object as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (material?.name === "FRAME_lights" && glow !== null) material.emissive.setHex(glow);
    });
  } else if (lights) {
    fitTotemLights(lights, glow);
  }
  jets?.setHex(flame ?? WORKS_FLAME);

  let underglow = hull.getObjectByName(UNDERGLOW_NAME) as THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> | undefined;
  if (under !== null && !underglow) {
    underglow = createUnderglow();
    await applyCircuitRule(circuit, underglow);
    if (serials.get(vehicle) !== serial) return;
    hull.add(underglow);
  }
  if (!underglow) return;
  // Hidden rather than removed when switched off: no draw, and switching it
  // back on in the paint shop does not rebuild a material mid-browse.
  underglow.visible = under !== null;
  if (under !== null) underglow.material.uniforms.uColor.value.setHex(under);
  underglow.material.uniforms.uPattern.value = options.still ? 0 : Math.max(0, PATTERN_CODES.indexOf(fit?.pattern ?? "steady"));
  // Sized past the hull it sits under — about 0.4 m beyond both flanks and
  // behind the tail — so the rim, and a pattern moving in it, reads from the
  // chase camera rather than hiding under the skirts. TOTEM uses its own
  // measured envelope (3.4 m wide, 6.37 m long).
  const bounds = body?.userData.garageBounds as THREE.Box3 | undefined;
  const width = bounds ? bounds.max.x - bounds.min.x : 3.4;
  const length = bounds ? bounds.max.z - bounds.min.z : 6.37;
  underglow.scale.set((width + 1.2) / 3.4, length * 1.15 / 6.4, 1);
  underglow.position.set(0, bounds ? bounds.min.y + 0.1 : 0.05, bounds ? (bounds.min.z + bounds.max.z) / 2 : 0.1);
}
