import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import {
  SHADOW_BIAS,
  SHADOW_BOX_METRES,
  SHADOW_CAMERA_FAR_METRES,
  SHADOW_CAMERA_NEAR_METRES,
  SHADOW_LIGHT_DISTANCE_METRES,
  SHADOW_LOOKAHEAD_METRES,
  SHADOW_MAP_SIZE,
  SHADOW_NORMAL_BIAS,
  SHADOW_UNLIT_FLOOR,
  resolveShadowMapSize,
  resolveShadowsEnabled,
  shadowBasis,
  shadowTexelMetres,
  snapShadowCentre,
} from "../src/game/shadow-settings.js";

/**
 * P20.1 — the shadow phase's pure half.
 *
 * Two things are worth a build-time guard here. The kill-switch truth table,
 * because `?shadows=0` and `?render=ps2` are contracts other phases rely on;
 * and the texel snapping, because it is the one piece of maths whose failure
 * mode is invisible to every other check — a wrong basis still renders shadows,
 * it just makes their edges crawl at speed, which only a moving eyeball catches.
 */

// ---------------------------------------------------------------------------
// Kill switches.
// ---------------------------------------------------------------------------

assert.equal(resolveShadowsEnabled(null, "agx"), true, "Shadows default to on.");
assert.equal(resolveShadowsEnabled("1", "agx"), true);
assert.equal(resolveShadowsEnabled("", "agx"), true);
for (const off of ["0", "off", "false", "no", "OFF", " 0 "]) {
  assert.equal(
    resolveShadowsEnabled(off, "agx"),
    false,
    `?shadows=${off} must disable shadows.`,
  );
}
// `?render=ps2` is era-accurate by contract, and wins over the flag either way.
for (const raw of [null, "1", "0", "on"]) {
  assert.equal(
    resolveShadowsEnabled(raw, "ps2"),
    false,
    "ps2 must never render shadows, whatever ?shadows= says.",
  );
}

assert.equal(resolveShadowMapSize(null), SHADOW_MAP_SIZE);
assert.equal(resolveShadowMapSize("1024"), 1024);
assert.equal(resolveShadowMapSize("512"), 512);
// Anything not on the authored list falls back rather than throwing: a typo in
// a share link must not break the game.
for (const bad of ["1023", "0", "-2048", "huge", ""]) {
  assert.equal(resolveShadowMapSize(bad), SHADOW_MAP_SIZE);
}

// ---------------------------------------------------------------------------
// Frustum sizing. These are the numbers docs/PERFORMANCE_BASELINE.md quotes.
// ---------------------------------------------------------------------------

assert.equal(SHADOW_BOX_METRES, 140);
assert.equal(SHADOW_LOOKAHEAD_METRES, 45);
assert.equal(SHADOW_MAP_SIZE, 2048);
assert.ok(
  Math.abs(shadowTexelMetres(2048) - 0.068359375) < 1e-9,
  "A 140 m box over a 2048 map must be a 6.8 cm texel.",
);
assert.ok(
  shadowTexelMetres(1024) === shadowTexelMetres(2048) * 2,
  "Halving the map must double the texel.",
);
// The shadow camera has to clear the box in depth from where the light sits.
// At the shallowest key on either map (Greenwater, ~56 degrees elevation) a
// 140 m box spans 140*cos(56) = 78 m along the light axis, and the tallest
// authored massing is under 70 m; both ends must stay inside [near, far].
const shallowestElevationDegrees = 56;
const boxDepthSpan = SHADOW_BOX_METRES
  * Math.cos((shallowestElevationDegrees * Math.PI) / 180);
const tallestCasterMetres = 70;
assert.ok(
  SHADOW_CAMERA_NEAR_METRES
    < SHADOW_LIGHT_DISTANCE_METRES - boxDepthSpan / 2 - tallestCasterMetres,
  "The shadow camera's near plane clips the tallest caster.",
);
assert.ok(
  SHADOW_CAMERA_FAR_METRES > SHADOW_LIGHT_DISTANCE_METRES + boxDepthSpan / 2,
  "The shadow camera's far plane clips the far edge of the box.",
);
// A depth bias larger than a texel's worth of slope is what detaches a shadow
// from the craft casting it; the normal bias does the acne work instead.
assert.ok(SHADOW_BIAS < 0 && SHADOW_BIAS > -0.001, "Depth bias out of band.");
assert.ok(
  SHADOW_NORMAL_BIAS > 0 && SHADOW_NORMAL_BIAS < 2 * shadowTexelMetres(2048),
  "Normal bias must stay inside two texels or the craft's shadow detaches.",
);
assert.ok(
  SHADOW_UNLIT_FLOOR > 0.2 && SHADOW_UNLIT_FLOOR < 1,
  "A shadowed deck must be darker than lit and must not reach black.",
);

// ---------------------------------------------------------------------------
// Texel snapping. The basis must match Object3D.lookAt's, or the rounding
// happens in a grid the shadow camera does not rasterise in and buys nothing.
// ---------------------------------------------------------------------------

const right = new THREE.Vector3();
const up = new THREE.Vector3();
const snapped = new THREE.Vector3();

for (const direction of [
  new THREE.Vector3(0.259, 0.9612, -0.0945).normalize(), // Bitterpan, ~74 deg
  new THREE.Vector3(0.510841, 0.830116, -0.223493).normalize(), // Greenwater
  new THREE.Vector3(-0.6, 0.5, 0.62).normalize(),
  new THREE.Vector3(0, 1, 0), // straight overhead: the degenerate case
]) {
  shadowBasis(direction, right, up);
  // The reference MUST be a camera, not a plain Object3D: `Object3D.lookAt`
  // builds `lookAt(target, position, up)` for ordinary objects and
  // `lookAt(position, target, up)` for cameras and lights, so the two differ by
  // a sign on X and Z. `LightShadow.updateMatrices` calls it on the shadow
  // camera, so the camera convention is the one `shadowBasis` has to match.
  const reference = new THREE.OrthographicCamera(-70, 70, 70, -70, 40, 280);
  reference.position.copy(direction).multiplyScalar(SHADOW_LIGHT_DISTANCE_METRES);
  reference.lookAt(0, 0, 0);
  reference.updateMatrixWorld();
  const lookAtRight = new THREE.Vector3().setFromMatrixColumn(
    reference.matrixWorld,
    0,
  );
  const lookAtUp = new THREE.Vector3().setFromMatrixColumn(reference.matrixWorld, 1);
  assert.ok(
    right.distanceTo(lookAtRight) < 1e-6 && up.distanceTo(lookAtUp) < 1e-6,
    `shadowBasis drifted from Object3D.lookAt at ${direction.toArray()}: `
      + `${right.toArray()} vs ${lookAtRight.toArray()}.`,
  );
}

// Snapping is idempotent, keeps the depth component exact, and never moves the
// centre by more than half a texel in either lateral axis.
const texel = shadowTexelMetres(2048);
const direction = new THREE.Vector3(0.259, 0.9612, -0.0945).normalize();
let maxLateralShift = 0;
for (let step = 0; step < 400; step += 1) {
  // A craft crossing the pan at 88 m/s, sampled every 60th of a second.
  const centre = new THREE.Vector3(12 + step * 0.02, 3.2, 400 + step * 1.46);
  snapShadowCentre(centre, direction, texel, right, up, snapped);
  const offset = snapped.clone().sub(centre);
  maxLateralShift = Math.max(
    maxLateralShift,
    Math.abs(offset.dot(right)),
    Math.abs(offset.dot(up)),
  );
  assert.ok(
    Math.abs(offset.dot(direction)) < 1e-6,
    "Snapping moved the centre along the light axis; only the lateral axes "
      + "decide which texel a world point lands in.",
  );
  // Every snapped centre must sit on the same global grid, which is what makes
  // consecutive frames sample the same world points.
  for (const axis of [right, up]) {
    const ticks = snapped.dot(axis) / texel;
    assert.ok(
      Math.abs(ticks - Math.round(ticks)) < 1e-6,
      "A snapped centre landed off the texel grid.",
    );
  }
  const again = new THREE.Vector3();
  snapShadowCentre(snapped, direction, texel, right, up, again);
  assert.ok(again.distanceTo(snapped) < 1e-6, "Snapping is not idempotent.");
}
assert.ok(
  maxLateralShift <= texel * 0.5 + 1e-6,
  `Snapping displaced the box by ${maxLateralShift} m, over half a texel.`,
);
// The guard that would have caught a no-op snap: an unsnapped centre must
// actually move.
assert.ok(maxLateralShift > texel * 0.2, "Snapping appears to be a no-op.");

// ---------------------------------------------------------------------------
// Source contracts the maths cannot see.
// ---------------------------------------------------------------------------

const source = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const game = source("src/game/game.ts");
assert.ok(
  game.includes("configureShadowMap(this.renderer)"),
  "game.ts must arm the shadow map through shadows.ts.",
);
assert.ok(
  !/renderer\.shadowMap\.enabled\s*=/.test(game),
  "The renderer's shadow switch belongs to shadows.ts, not the race loop.",
);

const atmosphere = source("src/game/atmosphere.ts");
for (const call of [
  "armKeyLightShadow(this.keyLight)",
  "this.scene.add(this.keyLight.target)",
  "promoteUnlitShadowReceivers(this.course.group)",
  "this.updateShadowCamera()",
]) {
  assert.ok(
    atmosphere.includes(call),
    `atmosphere.ts must call \`${call}\`; the shadow frustum stops following `
      + "the camera without it.",
  );
}

// The hangar lamps must never cast: three point-light shadow maps is six cube
// faces of depth rendering for an interior the directional key already reaches.
assert.ok(
  !/hangarLamp\w*\.castShadow\s*=\s*true|lamp\.castShadow\s*=\s*true/.test(atmosphere),
  "A Greenwater hangar lamp was armed as a shadow caster.",
);

const environment = source("src/game/environment.ts");
for (const family of ["GW_MAT_water", "GW_MAT_emissive"]) {
  assert.ok(
    environment.includes(family),
    `${family} must stay in the non-casting set; see PERFORMANCE_BASELINE.md.`,
  );
}

console.log(
  "Shadows PASS: kill switches (?shadows=0, ?render=ps2) and map-size parsing; "
    + `${SHADOW_BOX_METRES} m box / ${SHADOW_MAP_SIZE} map = `
    + `${(shadowTexelMetres(2048) * 100).toFixed(1)} cm texel with the frustum `
    + "clearing a 70 m caster at a 56 degree key; snapping matches "
    + "Object3D.lookAt's basis over 4 key directions, stays on one global grid "
    + "across 400 frames of travel, is idempotent and never moves the box more "
    + "than half a texel; renderer switch, shadow-camera follow and the "
    + "Greenwater non-casting families pinned in source.",
);
