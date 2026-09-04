import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { transformWithOxc } from "vite";
import { disposeObject3DResources } from "../src/game/graphics-resources.js";

const root = new URL("../", import.meta.url);
const route = JSON.parse(await readFile(new URL("src/game/data/tideline/route.json", root), "utf8"));
const manifest = JSON.parse(await readFile(new URL("public/assets/tideline-foundry/manifest.json", root), "utf8"));
const placements = JSON.parse(await readFile(new URL("public/assets/tideline-foundry/placements.json", root), "utf8"));
assert.equal(manifest.census.pelagicCrowns, 0);
assert.equal(manifest.census.flightLenses, 0);
assert.ok(manifest.census.aqueductRibs >= 35);
assert.ok(manifest.census.portHalls >= 12 && manifest.census.reactors >= 5);
const ribs = placements.filter(p => p.kind === "rib");
assert.deepEqual([...new Set(ribs.map(r => r.variant))].sort(), [0, 1, 2]);
assert.equal(ribs.filter(r => r.damaged).length, 2);
assert.ok(ribs.every(r => r.heavy === (r.index % 4 === 0)));

const file = new URL("src/game/tideline-environment.ts", root);
const source = await readFile(file, "utf8");
const code = (await transformWithOxc(source, file.pathname)).code
  .replace('from "three"', `from ${JSON.stringify(import.meta.resolve("three"))}`)
  .replace('import route from "./data/tideline/route.json";', `const route = ${JSON.stringify(route)};`)
  .replace('new THREE.TextureLoader().loadAsync("/assets/tideline-foundry/textures/water.jpg")', 'globalThis.__tidelineAssetPorts.water()')
  .replace('import { NeonEnvironment } from "./neon-environment";', 'const NeonEnvironment = {load: options => globalThis.__tidelineAssetPorts.scenery(options)};')
  .replace('import { resolveReducedMotion } from "./query-probes";', 'const resolveReducedMotion = () => globalThis.__tidelineAssetPorts.reduced ?? false;')
  .replace('from "./graphics-resources"', `from ${JSON.stringify(new URL("src/game/graphics-resources.js", root).href)}`);
const { TidelineEnvironment } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
function fixture() {
  const texture = new THREE.Texture();
  const material = new THREE.MeshLambertMaterial({map: texture, emissiveMap: texture, emissive: 0x404040, name:"GW_MAT_emissive"});
  const geometry = new THREE.BoxGeometry(2, 2, 2);
  const root = new THREE.Group(); root.add(new THREE.Mesh(geometry, material));
  const disposed = {texture:0, material:0, geometry:0};
  for (const [name, resource] of Object.entries({texture, material, geometry})) resource.addEventListener("dispose", () => disposed[name]++);
  const stats = {meshes:1, materials:1, textures:1, triangles:12, visibleGroups:0, visibleTriangles:0,
    shaderModel:"lambert", signageSource:"baked", contractDrift:[]};
  return {root, texture, material, disposed, scenery:{root, stats, updateVisibility() {stats.visibleGroups=0;stats.visibleTriangles=0;}}};
}
const previous = globalThis.__tidelineAssetPorts;
try {
  for (const reduced of [false, true]) {
    const world = fixture(), water = new THREE.Texture();
    let waterDisposals = 0; water.addEventListener("dispose", () => waterDisposals++);
    globalThis.__tidelineAssetPorts = {reduced, water:async () => water, scenery:async options => {
      assert.equal(options.modelUrl, "/assets/tideline-foundry/foundry_world.glb");
      assert.equal(options.maximumDistance, 200); assert.equal(options.opticalEffects, false);
      return world.scenery;
    }};
    const course = {tide:{lap:1, elapsed:1, waterLevel:0}};
    const environment = await TidelineEnvironment.load(course);
    const ocean = environment.root.getObjectByName("tideline_water_surface");
    const steam = environment.root.getObjectByName("tideline_pump_steam");
    const bubbles = environment.root.getObjectByName("tideline_suspended_bubbles");
    assert.equal(ocean.material.uniforms.waterAtlas.value, water, "The generated atlas reaches the actual shader.");
    assert.equal(water.colorSpace, THREE.SRGBColorSpace);
    assert.ok(manifest.triangles + environment.stats.triangles - 12 <= 100_000);
    const shader = {uniforms:{}, vertexShader:"#include <begin_vertex>", fragmentShader:"#include <emissivemap_fragment>"};
    world.material.onBeforeCompile(shader);
    const camera = new THREE.PerspectiveCamera(60, 1, .1, 500);
    camera.position.set(0, -10, 10); camera.updateMatrixWorld();
    environment.updateVisibility(camera);
    assert.equal(bubbles.visible, !reduced); assert.equal(steam.visible, false);
    assert.equal(shader.uniforms.tideWaterLevel.value, 0);
    course.tide = {lap:3, elapsed:8, waterLevel:-27}; environment.updateVisibility(camera);
    assert.equal(ocean.position.y, -27); assert.equal(steam.visible, !reduced); assert.equal(bubbles.visible, false);
    assert.equal(shader.uniforms.tideWaterLevel.value, -27);
    assert.equal(shader.uniforms.tideLampTime.value, reduced ? 0 : 8);
    const time = ocean.material.uniforms.tidelineTime.value;
    for (let frame = 0; frame < 120; frame++) environment.updateVisibility(camera);
    assert.equal(ocean.material.uniforms.tidelineTime.value, time, "Paused race clock freezes water, steam and lamp motion.");
    disposeObject3DResources(environment.root);
    assert.deepEqual(world.disposed, {texture:1, material:1, geometry:1});
    assert.equal(waterDisposals, 1, "Textures in ShaderMaterial uniforms are released once.");
  }
  for (const failed of ["scenery", "water"]) {
    const world = fixture(), water = new THREE.Texture();
    let waterDisposals = 0; water.addEventListener("dispose", () => waterDisposals++);
    globalThis.__tidelineAssetPorts = {
      scenery:async () => {if (failed === "scenery") throw Error("missing world"); return world.scenery;},
      water:async () => {if (failed === "water") throw Error("missing atlas"); return water;},
    };
    await assert.rejects(TidelineEnvironment.load(), /could not be loaded/);
    if (failed === "water") assert.deepEqual(world.disposed, {texture:1, material:1, geometry:1});
    else assert.equal(waterDisposals, 1);
  }
} finally {
  if (previous === undefined) delete globalThis.__tidelineAssetPorts;
  else globalThis.__tidelineAssetPorts = previous;
}
console.log("Tideline environment PASS: varied structural/damaged ribs, no Crown or flight beacons; real painted-water shader, waterline lamp response, drain steam, underwater bubbles, pause/reduced motion and both partial-load cleanup orders.");
