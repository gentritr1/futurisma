import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { transformWithOxc } from 'vite';
import {typescriptModuleUrl} from './lib/typescript-module.mjs';
const kitModule=await typescriptModuleUrl(new URL('../src/game/power-kit.ts',import.meta.url));
const evolutionUrl = new URL('../src/game/totem-evolution.ts', import.meta.url);
const transformed = await transformWithOxc(fs.readFileSync(evolutionUrl, 'utf8'), evolutionUrl.pathname);
const code = transformed.code
  .replace('from "./tideline-power-field"', `from ${JSON.stringify(await typescriptModuleUrl(new URL("../src/game/tideline-power-field.ts",import.meta.url)))}`).replace('from "three/addons/loaders/GLTFLoader.js"', `from ${JSON.stringify(import.meta.resolve("three/addons/loaders/GLTFLoader.js"))}`).replace('from \"three\"', `from ${JSON.stringify(import.meta.resolve('three'))}`)
  .replace('from \"./graphics-resources.js\"', `from ${JSON.stringify(new URL('../src/game/graphics-resources.js', import.meta.url).href)}`)
  .replace('from \"./power-kit\"', `from ${JSON.stringify(kitModule)}`);
const { TotemEvolution } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
import { disposeObject3DResources } from '../src/game/graphics-resources.js';

const buffer = fs.readFileSync(new URL('../public/assets/totem-evolution/totem_evolution.glb', import.meta.url));
const manifest = JSON.parse(fs.readFileSync(new URL('../public/assets/totem-evolution/manifest.json', import.meta.url), 'utf8'));
const gltf = JSON.parse(buffer.subarray(20, 20 + buffer.readUInt32LE(12)).toString());
assert.ok(buffer.byteLength < 220 * 1024, 'The player kit must stay under 220 KiB.');
assert.equal(gltf.images?.length ?? 0, 0, 'The kit must require no new textures.');
assert.equal(gltf.textures?.length ?? 0, 0);
assert.ok(!(gltf.extensionsRequired ?? []).some((name) => /draco|meshopt/i.test(name)), 'No runtime decoder dependency.');
const triangles = gltf.meshes.reduce((sum, mesh) => sum + mesh.primitives.reduce((n, primitive) => n + (primitive.indices === undefined ? gltf.accessors[primitive.attributes.POSITION].count : gltf.accessors[primitive.indices].count) / 3, 0), 0);
assert.equal(triangles, manifest.triangles);
assert.ok(triangles <= 3000);
const drawCalls = gltf.meshes.reduce((sum, mesh) => sum + mesh.primitives.length, 0);
assert.ok(drawCalls <= 7, `Unexpected kit draw calls: ${drawCalls}.`);
const asset = await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
const evolution = new TotemEvolution(asset.scene);
const rotor = evolution.root.getObjectByName('TE_gyro_pivot');
assert.ok(rotor);
assert.ok(Math.abs(rotor.position.y - 0.235659) < 1e-5, 'Gyro pivot must fit the accepted rear ring.');
assert.ok(Math.abs(rotor.position.z - 2.51) < 1e-5);
const material = (name) => {
  let result;
  evolution.root.traverse((object) => {
    if (!object.isMesh) return;
    for (const candidate of Array.isArray(object.material) ? object.material : [object.material]) {
      if (candidate.name === name) result = candidate;
    }
  });
  assert.ok(result, `Missing ${name}.`);
  return result;
};
const state = {
  steer: 0, lateralLoad: 0, throttle: 1, brake: 0, speedRatio: 0.7,
  boostActive: false, driftIntensity: 0, surfaceGrip: 1, reducedMotion: false,
  elapsed: 0, delta: 1 / 60,
};
const tick = (frames, patch = {}) => {
  Object.assign(state, patch);
  let spin = 0;
  for (let i = 0; i < frames; i += 1) {
    state.elapsed += state.delta;
    const before = rotor.rotation.z;
    evolution.update(state);
    spin += Math.atan2(Math.sin(rotor.rotation.z - before), Math.cos(rotor.rotation.z - before));
  }
  return spin;
};
tick(180);
const cruiseSpin = tick(60);
assert.ok(cruiseSpin > 0);
tick(120, { boostActive: true });
const boostSpin = tick(60);
assert.ok(boostSpin > cruiseSpin * 2, 'Boost must visibly accelerate the gyro.');
assert.ok(material('TE_boost').emissive.r > material('TE_boost').emissive.b, 'Nitro firing signal should match the orange plume.');
const jets = evolution.root.getObjectByName('TE_twin_layered_exhaust');
const jetPose = new THREE.Matrix4();
const jetPosition = new THREE.Vector3(); const jetRotation = new THREE.Quaternion(); const jetScale = new THREE.Vector3();
jets.getMatrixAt(1, jetPose); jetPose.decompose(jetPosition, jetRotation, jetScale);
const nitroLength = jetScale.z;
assert.ok(nitroLength > 4 && jetScale.x > .4, 'Nitro plume must read at chase-camera distance.');
assert.ok(material('TE_layered_engine_jets').uniforms.uStrength.value > 1.7);
assert.ok(material('TE_layered_engine_jets').uniforms.uColor.value.r > material('TE_layered_engine_jets').uniforms.uColor.value.b);
tick(120, { overdriveActive: true });
jets.getMatrixAt(1, jetPose); jetPose.decompose(jetPosition, jetRotation, jetScale);
assert.ok(jetScale.z > nitroLength + .7, 'Surge extends the visible plasma wake.');
assert.ok(material('TE_layered_engine_jets').uniforms.uColor.value.b > material('TE_layered_engine_jets').uniforms.uColor.value.r, 'Surge has a distinct cyan plume.');
state.overdriveActive = false;
tick(120, { gravitySign: -1, boostActive: false, brake: 1 });
assert.ok(tick(60) < 0, 'Ceiling orientation must reverse the gyro.');
assert.ok(material('TE_gravity').emissive.r > material('TE_gravity').emissive.g, 'Ceiling signal should be pink.');
assert.ok(material('TE_brake').emissiveIntensity > 2, 'Braking must raise the aft brake lamps.');
tick(60, { gravityTransition: 0.5 });
assert.ok(material('TE_gravity').emissive.g > material('TE_gravity').emissive.b, 'Changing surface should show amber.');
tick(90, { gravityTransition: 0, shieldActive: true });
assert.equal(evolution.root.getObjectByName('TE_power_shield').visible, true);
assert.ok(material('TE_power').emissive.b > material('TE_power').emissive.r, 'Shield signal should be violet.');
const angle = rotor.rotation.z;
assert.equal(tick(120, { reducedMotion: true }), 0, 'Reduced motion must stop continuous rotation.');
assert.equal(rotor.rotation.z, angle);
assert.equal(material('TE_layered_engine_jets').uniforms.uTime.value, 0, 'Reduced motion must freeze exhaust modulation.');
tick(60, { shieldActive: false, boostReserve: 0, brake: 0 });
assert.equal(evolution.root.getObjectByName('TE_power_shield').visible, false);
assert.ok(material('TE_boost').emissive.g > material('TE_boost').emissive.b, 'Low reserve should show amber.');
evolution.reset();
assert.equal(rotor.rotation.z, 0);
assert.equal(material('TE_layered_engine_jets').uniforms.uStrength.value, 0);

// All new effects must be owned by the scene hierarchy, so the existing shared
// cleanup releases them exactly once without a hidden animation loop or texture.
const resources = new Set();
evolution.root.traverse((object) => {
  if (object.geometry) resources.add(object.geometry);
  for (const m of object.material ? (Array.isArray(object.material) ? object.material : [object.material]) : []) resources.add(m);
});
const disposals = new Map();
for (const resource of resources) resource.addEventListener('dispose', () => disposals.set(resource, (disposals.get(resource) ?? 0) + 1));
const disposed = disposeObject3DResources(evolution.root);
assert.equal(disposed.textures, 0);
assert.equal(disposals.size, resources.size);
for (const count of disposals.values()) assert.equal(count, 1);
console.log(`TOTEM evolution PASS: ${triangles} authored triangles, ${drawCalls} asset draws, ${buffer.byteLength} bytes, zero textures; gyro, signals, reduced motion, reset and unique cleanup verified.`);
