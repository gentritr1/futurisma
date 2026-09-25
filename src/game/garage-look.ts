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
import type { Garage } from "./garage-rules.js";

const UNDERGLOW_NAME = "garage_underglow";
const WORKS_FLAME = 0xff581d;
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
    uniforms: { uColor: { value: new THREE.Color() } },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        vec2 edge = abs(vUv - 0.5) * 2.0;
        float reach = length(max(edge - vec2(0.42, 0.6), 0.0)) / 0.5;
        float glow = (1.0 - smoothstep(0.0, 1.0, reach)) * 0.6;
        gl_FragColor = vec4(uColor * glow, glow);
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

/**
 * Fits the frame on the grid — or, with `previewFrame`, one the driver is only
 * looking at in the showroom, wearing its signature colours. Resolves once the
 * refit is on the craft (or has been superseded by a newer one).
 */
export async function applyCraftLook(
  vehicle: TotemVehicle,
  garage: Garage,
  previewFrame: string | null = null,
  circuit = "",
): Promise<void> {
  const serial = (serials.get(vehicle) ?? 0) + 1;
  serials.set(vehicle, serial);
  const frame = previewFrame ?? garage.chassis;
  const body = frame === "totem" ? null : await bodyFor(vehicle, frame, circuit);
  if (serials.get(vehicle) !== serial) return;
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
  // Sized to the hull it sits under, so wide skirts or pontoons never hide it.
  const bounds = body?.userData.garageBounds as THREE.Box3 | undefined;
  if (bounds) {
    underglow.scale.set((bounds.max.x - bounds.min.x + 0.5) / 3.4, (bounds.max.z - bounds.min.z) * 0.92 / 6.4, 1);
    underglow.position.set(0, bounds.min.y + 0.1, (bounds.min.z + bounds.max.z) / 2);
  } else {
    underglow.scale.set(1, 1, 1);
    underglow.position.set(0, 0.05, 0.1);
  }
}
