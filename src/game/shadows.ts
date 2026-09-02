import * as THREE from "three";
import {
  SHADOW_BIAS,
  SHADOW_BOX_METRES,
  SHADOW_CAMERA_FAR_METRES,
  SHADOW_CAMERA_NEAR_METRES,
  SHADOW_NORMAL_BIAS,
  SHADOW_UNLIT_FLOOR,
  shadowMapSize,
  shadowsEnabled,
} from "./shadow-settings.js";

/**
 * P20.1 — the half of the shadow phase that needs `three` at runtime: renderer
 * setup, the key light's shadow camera, and the shadow-receiving stand-in for
 * an authored-absolute unlit material.
 *
 * The settings, the kill switches and the texel-snapping maths live in
 * shadow-settings.js, which is authored as `.js` so the validator can execute
 * them under Node. Imported only by game.ts and atmosphere.ts — see the note in
 * that file for why the import surface is kept that small.
 */

/**
 * Arms the renderer. Called from `game.ts` in place of the `shadowMap.enabled =
 * false` this phase replaced, so the race loop keeps its one line.
 *
 * `PCFSoftShadowMap` over `VSMShadowMap`: VSM needs a blur pass over the map
 * every frame and leaks light through the thin conveyor spans that BRINE CUT is
 * built from, which is exactly the shadow this phase exists to show.
 */
export function configureShadowMap(renderer: THREE.WebGLRenderer): void {
  const enabled = shadowsEnabled();
  renderer.shadowMap.enabled = enabled;
  if (enabled) renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}

/**
 * Sets a DirectionalLight up as the one shadow caster. Idempotent, and a no-op
 * when shadows are off, so the light behaves exactly as it did pre-phase.
 */
export function armKeyLightShadow(light: THREE.DirectionalLight): boolean {
  if (!shadowsEnabled()) return false;
  const mapSize = shadowMapSize();
  const half = SHADOW_BOX_METRES / 2;
  light.castShadow = true;
  light.shadow.mapSize.set(mapSize, mapSize);
  light.shadow.bias = SHADOW_BIAS;
  light.shadow.normalBias = SHADOW_NORMAL_BIAS;
  const camera = light.shadow.camera;
  camera.left = -half;
  camera.right = half;
  camera.top = half;
  camera.bottom = -half;
  camera.near = SHADOW_CAMERA_NEAR_METRES;
  camera.far = SHADOW_CAMERA_FAR_METRES;
  camera.updateProjectionMatrix();
  return true;
}

/**
 * A shadow-receiving stand-in for a `MeshBasicMaterial` whose colour is
 * authored absolute.
 *
 * Bitterpan's drivable deck is `map02_route_deck_read_surface`: an opaque,
 * vertex-coloured, `toneMapped: false` overlay laid 4.5 cm over the pan floor.
 * It is the surface the craft flies over, so it is the surface the contact
 * shadow has to land on — but an unlit material cannot receive a shadow, and
 * converting it to Lambert would put the whole sector-coded deck read under the
 * key light and change the palette this phase is not allowed to touch.
 *
 * So: the authored colour is reproduced bit-for-bit outside shadow (the mask is
 * 1 there, and `mix(floor, 1, 1)` is 1), and only the shadowed samples are
 * scaled toward {@link SHADOW_UNLIT_FLOOR}. No key light, no tone mapping, no
 * change to anything the deck read encodes.
 *
 * `lights: true` is what makes three emit the shadow uniforms and the
 * `NUM_DIR_LIGHT_SHADOWS` defines for a custom shader. The geometry carries no
 * normal attribute, so `HAS_NORMAL` is undefined and `shadowmap_vertex` falls
 * back to a zero shadow normal — this surface takes `shadow.bias` only, not
 * `normalBias`, which is correct for a plane this flat.
 */
function createShadowedUnlitMaterial(options: {
  name: string;
  side: THREE.Side;
  shadowFloor?: number;
}): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    name: options.name,
    side: options.side,
    fog: true,
    lights: true,
    vertexColors: true,
    // `UniformsLib.lights` is not optional under `lights: true`: the renderer
    // writes `ambientLightColor.needsUpdate` and friends unconditionally for
    // such a material. `common` is left out — this shader reads no map, no
    // diffuse and no opacity.
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      THREE.UniformsLib.lights,
      { shadowFloor: { value: options.shadowFloor ?? SHADOW_UNLIT_FLOOR } },
    ]),
    vertexShader: /* glsl */ `
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <shadowmap_pars_vertex>
void main() {
#include <color_vertex>
#include <begin_vertex>
#include <project_vertex>
#include <worldpos_vertex>
#include <shadowmap_vertex>
#include <fog_vertex>
}`,
    // `receiveShadow` is declared here rather than by pulling in
    // <lights_pars_begin>: this shader reads no light but the shadow mask, and
    // the renderer sets that uniform from `object.receiveShadow` for every
    // program that declares it.
    fragmentShader: /* glsl */ `
#include <common>
uniform bool receiveShadow;
uniform float shadowFloor;
#include <color_pars_fragment>
#include <fog_pars_fragment>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
void main() {
vec4 diffuseColor = vec4( 1.0 );
#include <color_fragment>
gl_FragColor = vec4( diffuseColor.rgb * mix( shadowFloor, 1.0, getShadowMask() ), 1.0 );
#include <fog_fragment>
#include <colorspace_fragment>
}`,
  });
  // The authored deck read is post-tone-map by construction, exactly as the
  // MeshBasicMaterial it stands in for was.
  material.toneMapped = false;
  return material;
}

/**
 * Mesh names whose authored material is an opaque unlit overlay that
 * nonetheless has to receive shadow, with the {@link SHADOW_UNLIT_FLOOR}
 * variant they are promoted to.
 *
 * Only one entry, and it is load-bearing: `map02_route_deck_read_surface` is
 * Bitterpan's drivable deck. Greenwater's deck is authored Lambert
 * (`GW_SECTOR_*_concrete`) and receives natively, so it is not listed.
 */
const UNLIT_SHADOW_RECEIVERS = ["map02_route_deck_read_surface"] as const;

/**
 * Swaps the authored unlit material on the meshes above for the shadow-only
 * stand-in, and disposes what it replaced.
 *
 * Called once from `RaceAtmosphere`'s constructor rather than from the course
 * builders, for two reasons: every shadow decision then lives in one module,
 * and the map chunks stay free of any import from here — when
 * `bitterpan-course.ts` imported this file, Rollup promoted it to a shared
 * chunk and the initial shell grew 1.3 KiB gzip.
 *
 * A no-op when shadows are off, so `?shadows=0` and `?render=ps2` ship the
 * authored `MeshBasicMaterial` exactly as before this phase.
 *
 * @returns how many meshes were promoted.
 */
export function promoteUnlitShadowReceivers(root: THREE.Object3D): number {
  if (!shadowsEnabled()) return 0;
  let promoted = 0;
  for (const name of UNLIT_SHADOW_RECEIVERS) {
    const mesh = root.getObjectByName(name);
    if (!(mesh instanceof THREE.Mesh) || Array.isArray(mesh.material)) continue;
    const replaced = mesh.material;
    mesh.material = createShadowedUnlitMaterial({
      name: `${name}_shadowed`,
      side: replaced.side,
    });
    replaced.dispose();
    mesh.receiveShadow = true;
    promoted += 1;
  }
  return promoted;
}
