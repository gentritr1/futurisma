import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { transformWithOxc } from "vite";
import { PowerKit } from "../src/game/power-kit.ts";
import { disposeObject3DResources } from "../src/game/graphics-resources.js";

const bytes = await readFile(new URL("../public/assets/power-kit/power_kit.glb", import.meta.url));
const manifest = JSON.parse(await readFile(new URL("../public/assets/power-kit/manifest.json", import.meta.url), "utf8"));
const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
const triangles = json.meshes.reduce((sum, mesh) => sum + mesh.primitives.reduce((n, primitive) => n + json.accessors[primitive.indices ?? primitive.attributes.POSITION].count / 3, 0), 0);
assert.equal(triangles, manifest.triangles);
assert.ok(triangles <= 4000);
assert.ok(bytes.length < 180 * 1024);
assert.equal(json.meshes.reduce((sum, mesh) => sum + mesh.primitives.length, 0), 8);
assert.equal(json.images?.length ?? 0, 0);
assert.equal(json.textures?.length ?? 0, 0);
assert.equal(json.skins, undefined);
assert.equal(json.animations, undefined);
assert.ok(!(json.extensionsRequired ?? []).some(name => /draco|meshopt/i.test(name)));
const array = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const asset = await new GLTFLoader().parseAsync(array, "");
// Check the exported triangles, including the new open shrouds and hinge barrels.
// Thin mechanical details must remain finite, non-degenerate geometry after export.
const vertexA = new THREE.Vector3(); const vertexB = new THREE.Vector3(); const vertexC = new THREE.Vector3();
asset.scene.traverse(object => {
  if (!object.isMesh) return;
  const position = object.geometry.getAttribute("position");
  for (const value of position.array) assert.ok(Number.isFinite(value), `${object.name} has a non-finite vertex.`);
  const index = object.geometry.getIndex();
  for (let corner = 0; corner < (index?.count ?? position.count); corner += 3) {
    vertexA.fromBufferAttribute(position, index ? index.getX(corner) : corner);
    vertexB.fromBufferAttribute(position, index ? index.getX(corner + 1) : corner + 1);
    vertexC.fromBufferAttribute(position, index ? index.getX(corner + 2) : corner + 2);
    vertexB.sub(vertexA); vertexC.sub(vertexA);
    assert.ok(vertexB.cross(vertexC).lengthSq() > 1e-14, `${object.name} has a collapsed triangle.`);
  }
});
const kit = new PowerKit(asset.scene);
const surge = kit.createPickupVisual("surge");
const secondSurge = kit.createPickupVisual("surge");
const shield = kit.createPickupVisual("shield");
const scene = new THREE.Group(); scene.add(surge.root, secondSurge.root, shield.root);
for (const [kind, template] of Object.entries(kit.templates)) {
  const bounds = new THREE.Box3().setFromObject(template).getSize(new THREE.Vector3());
  assert.ok(bounds.y > 1.2 && bounds.y < 2, `${kind} must read as a substantial device.`);
  assert.ok(Math.max(bounds.x, bounds.z) > 1 && Math.max(bounds.x, bounds.z) < 2);
}
const a = surge.root.getObjectByName("PK_surge_cage");
const b = secondSurge.root.getObjectByName("PK_surge_cage");
assert.equal(a.geometry, b.geometry);
assert.equal(a.material, b.material);
for (let frame = 1; frame <= 60; frame++) surge.update(frame / 60, false, .6, 0);
assert.ok(a.rotation.y > 0);
assert.equal(b.rotation.y, 0, "Sharing geometry cannot share moving transforms.");
const angle = a.rotation.y;
for (let frame = 61; frame <= 120; frame++) surge.update(frame / 60, true, .6, 0);
assert.equal(a.rotation.y, angle, "Reduced motion freezes continuous mechanics.");
surge.update(2.1, false, 1, 1);
assert.ok(a.scale.y > 1.1, "An active turbine expands its cage.");
const petals = shield.root.getObjectByName("PK_shield_petals");
shield.update(1, true, .3, 0); const stowedSpan = petals.scale.x;
shield.update(2, true, 1, 1);
assert.ok(petals.scale.x > stowedSpan + .3 && petals.position.y > .2, "Shield panels mechanically deploy.");

// A removed pickup does not destroy a resource another pickup is rendering.
const resources = new Set();
asset.scene.traverse(object => {
  if (object.geometry) resources.add(object.geometry);
  for (const material of object.material ? (Array.isArray(object.material) ? object.material : [object.material]) : []) resources.add(material);
});
const disposals = new Map();
for (const resource of resources) resource.addEventListener("dispose", () => disposals.set(resource, (disposals.get(resource) ?? 0) + 1));
surge.dispose(); surge.dispose();
assert.equal(disposals.size, 0);
assert.equal(surge.root.parent, null);
assert.ok(secondSurge.root.children.length > 0);

const libraryResourceCount = resources.size;

// Use the real ship assembly to verify that inventory becomes visible hardware.
const evolutionUrl = new URL("../src/game/totem-evolution.ts", import.meta.url);
const transformed = await transformWithOxc(await readFile(evolutionUrl, "utf8"), evolutionUrl.pathname);
const code = transformed.code.replace('from "three"', `from ${JSON.stringify(import.meta.resolve("three"))}`)
  .replace('from "three/addons/loaders/GLTFLoader.js"', `from ${JSON.stringify(import.meta.resolve("three/addons/loaders/GLTFLoader.js"))}`)
  .replace('from "./graphics-resources.js"', `from ${JSON.stringify(new URL("../src/game/graphics-resources.js", import.meta.url).href)}`)
  .replace('from "./power-kit"', `from ${JSON.stringify(new URL("../src/game/power-kit.ts", import.meta.url).href)}`);
const { TotemEvolution } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const hullBytes = await readFile(new URL("../public/assets/totem-evolution/totem_evolution.glb", import.meta.url));
const hull = await new GLTFLoader().parseAsync(hullBytes.buffer.slice(hullBytes.byteOffset, hullBytes.byteOffset + hullBytes.byteLength), "");
const vehicle = new TotemEvolution(hull.scene, kit);
scene.add(vehicle.root);
vehicle.root.traverse(object => {
  const owned = [object.geometry, ...(object.material ? (Array.isArray(object.material) ? object.material : [object.material]) : [])].filter(Boolean);
  for (const resource of owned) {
    if (resources.has(resource)) continue;
    resources.add(resource);
    resource.addEventListener("dispose", () => disposals.set(resource, (disposals.get(resource) ?? 0) + 1));
  }
});
const mountedSurge = vehicle.root.getObjectByName("TE_mounted_surge");
const mountedShield = vehicle.root.getObjectByName("TE_mounted_shield");
assert.ok(mountedSurge && mountedShield);
assert.ok(mountedSurge.position.x < 0 && mountedShield.position.x > 0);
const state = { steer: 0, lateralLoad: 0, throttle: 1, brake: 0, speedRatio: .8, boostActive: false, driftIntensity: 0, surfaceGrip: 1, reducedMotion: true, elapsed: 0, delta: 1 / 60, heldPowerKind: "surge", powerCharge: .5, powerActivation: 0 };
for (let frame = 0; frame < 90; frame++) { state.elapsed += state.delta; vehicle.update(state); }
assert.ok(mountedSurge.position.y > mountedShield.position.y + .25, "The held power deploys on its matching flank.");
const readyHeight = mountedSurge.position.y;
state.overdriveActive = true; state.powerActivation = 1; state.powerCharge = 1;
for (let frame = 0; frame < 90; frame++) { state.elapsed += state.delta; vehicle.update(state); }
assert.ok(mountedSurge.position.y > readyHeight + .1);
state.overdriveActive = false; state.heldPowerKind = "shield"; state.shieldActive = true;
for (let frame = 0; frame < 90; frame++) { state.elapsed += state.delta; vehicle.update(state); }
assert.ok(mountedShield.position.y > mountedSurge.position.y + .25);
const field = vehicle.root.getObjectByName("TE_power_shield");
assert.equal(field.visible, true);
assert.equal(field.geometry.getAttribute("position").count / 3, 144, "Shield field is 24 individual hex plates.");
kit.dispose(); kit.dispose();
assert.equal(disposals.size, libraryResourceCount);
for (const count of disposals.values()) assert.equal(count, 1);
assert.equal(secondSurge.root.parent, null);
assert.equal(shield.root.parent, null);
assert.equal(mountedSurge.parent, null);
assert.throws(() => kit.createPickupVisual("surge"), /disposed/);
disposeObject3DResources(scene);
assert.equal(disposals.size, resources.size, "Scene cleanup releases mounted pistons, conduit, field and engine resources too.");
for (const count of disposals.values()) assert.equal(count, 1, "Scene cleanup must not dispose the detached library twice.");
console.log(`Power kit PASS: ${triangles} Blender triangles, 8 batches, ${bytes.length} bytes, no textures; distinct mechanical silhouettes, independent shared-resource clones, reduced motion, mounted inventory/deployment and exactly-once cleanup.`);
