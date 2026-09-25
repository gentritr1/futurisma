/**
 * Garage — puts a fitted look on the player's craft: the frame's stance, the
 * running-light colour, the boost flame and the underglow.
 *
 * Lazy, like the rest of the showroom, and applied through
 * `FuturismaGame.refitCraft`, which hands over the craft and repaints the
 * paddock. Everything here touches player-only surfaces (see
 * `TotemVehicle.craftSurfaces`), so the three rivals and the ghost keep the
 * works look whatever the player bolts on.
 *
 * WHY THE LIGHTS GO MONOCHROME FIRST. `TOTEM_emissive` samples a painted
 * emissive map whose lamps are cyan and acid green. Tinting it directly would
 * MULTIPLY: amber over cyan comes out mud. So a fitted colour swaps in a
 * one-channel copy of the same map (each texel's brightest channel) and lets
 * the material's emissive colour do the tinting; `stock` puts the painted
 * original back. The copy is made once per session and released on restore.
 */
import * as THREE from "three";
import type { TotemVehicle } from "./totem";
import { frameCard, resolvePaint } from "./garage-catalog.js";
import type { Garage } from "./garage-rules.js";

const UNDERGLOW_NAME = "garage_underglow";
const WORKS_FLAME = 0xff581d;

interface StockLights {
  map: THREE.Texture | null;
  emissive: THREE.Color;
}

const stockLights = new WeakMap<THREE.MeshStandardMaterial, StockLights>();
const monoLights = new WeakMap<THREE.MeshStandardMaterial, THREE.Texture>();

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

function fitLights(lights: THREE.MeshStandardMaterial, hex: number | null): void {
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
  mesh.position.set(0, 0.05, 0.1);
  mesh.renderOrder = 2;
  return mesh;
}

/**
 * Applies the look of the frame on the grid — or, with `previewFrame`, of a
 * frame the driver is only looking at in the showroom, wearing its signature
 * colours. Total and idempotent: calling it twice is the same as once, and a
 * craft whose model or kit failed to load simply keeps what it has.
 */
export function applyCraftLook(vehicle: TotemVehicle, garage: Garage, previewFrame: string | null = null): void {
  const frame = previewFrame ?? garage.chassis;
  const fit = garage.fleet[frame];
  const glow = resolvePaint(frame, "glow", fit?.glow ?? "stock");
  const flame = resolvePaint(frame, "flame", fit?.flame ?? "stock");
  const under = resolvePaint(frame, "under", fit?.under ?? "off");
  const { hull, lights, flame: jets } = vehicle.craftSurfaces();
  const [width, height, length] = frameCard(frame).stance;
  hull.scale.set(width, height, length);
  if (lights) fitLights(lights, glow);
  jets?.setHex(flame ?? WORKS_FLAME);
  let underglow = hull.getObjectByName(UNDERGLOW_NAME) as THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> | undefined;
  if (under !== null && !underglow) {
    underglow = createUnderglow();
    hull.add(underglow);
  }
  if (underglow) {
    // Hidden rather than removed when switched off: no draw, and switching it
    // back on in the paint shop does not rebuild a material mid-browse.
    underglow.visible = under !== null;
    if (under !== null) underglow.material.uniforms.uColor.value.setHex(under);
  }
}
