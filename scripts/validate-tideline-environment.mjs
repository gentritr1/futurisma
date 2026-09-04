import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { transformWithOxc } from "vite";
import { parseGlb } from "./lib/greenwater-package-validator.mjs";
import { disposeObject3DResources } from "../src/game/graphics-resources.js";

const root = new URL("../", import.meta.url);
const route = JSON.parse(await readFile(new URL("src/game/data/tideline/route.json", root), "utf8"));
const base = new URL("public/assets/tideline/", root);
const bytes = await readFile(new URL("tideline_world.glb", base));
let { json, binary } = parseGlb(bytes, "Tideline marine circuit");
const manifest = JSON.parse(await readFile(new URL("manifest.json", base), "utf8"));
const lamps = JSON.parse(await readFile(new URL("lights.json", base), "utf8"));
assert.ok(bytes.length < 8 * 1024 * 1024, "The marine environment exceeds its download budget.");
assert.ok(!json.animations?.length && !json.skins?.length && !json.cameras?.length);
assert.ok(!json.extensionsRequired?.length);
assert.equal(manifest.waterLevel, 0);
assert.equal(manifest.pelagicCrowns, 1);
assert.equal(manifest.reference, "art/reference/pelagic-crown-three-view.png");
assert.ok((await readFile(new URL(manifest.reference, root))).length > 100_000);
assert.ok(manifest.aqueductRibs >= 40 && manifest.reactors >= 5 && manifest.mantas >= 4);
assert.ok(manifest.kelpBeds >= 50 && manifest.portHalls >= 12 && manifest.cranes >= 6);
assert.equal(manifest.flightLenses, 4);
assert.equal(lamps.length, manifest.lightAnchors);
for (const lamp of lamps) {
  assert.ok([...lamp.p, lamp.ground, lamp.size].every(Number.isFinite));
  assert.ok(lamp.size > 0 && lamp.size <= 8);
}
let triangles = 0;
let primitives = 0;
for (const mesh of json.meshes) for (const primitive of mesh.primitives) {
  primitives++;
  assert.equal(primitive.mode ?? 4, 4);
  triangles += json.accessors[primitive.indices].count / 3;
}
assert.equal(triangles, manifest.triangles);
assert.ok(triangles <= 150_000);
assert.ok(primitives <= 60);

// Test actual exported vertices AND triangle interiors in each station's 3D
// frame. A boat below an air gap is valid, but geometry at the craft's height
// must remain outside the road + two metre recovery margin.
const cells = new Map();
for (const station of route.stations) {
  const tangent = new THREE.Vector3(...station.t);
  const right = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, tangent).normalize();
  const entry = { p: new THREE.Vector3(...station.p), right, up, tangent, halfWidth: station.width / 2 };
  const key = `${Math.floor(station.p[0] / 32)},${Math.floor(station.p[2] / 32)}`;
  const bucket = cells.get(key) ?? [];
  bucket.push(entry);
  cells.set(key, bucket);
}
const relative = new THREE.Vector3();
let checkedPoints = 0;
let nearbyPoints = 0;
function checkPoint(point, nodeName) {
  checkedPoints++;
  const xCell = Math.floor(point.x / 32), zCell = Math.floor(point.z / 32);
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    for (const station of cells.get(`${xCell + dx},${zCell + dz}`) ?? []) {
      relative.subVectors(point, station.p);
      if (Math.abs(relative.dot(station.tangent)) > 1.6) continue;
      const height = relative.dot(station.up);
      if (height < -.25 || height > 7) continue;
      nearbyPoints++;
      const lateral = Math.abs(relative.dot(station.right));
      assert.ok(lateral >= station.halfWidth + 2,
        `${nodeName} enters the 3D driving/glide corridor: ${point.toArray().map(n => n.toFixed(2))}; lateral ${lateral.toFixed(2)}, height ${height.toFixed(2)} m.`);
    }
  }
}
function readPositions(primitive, world) {
  const accessor = json.accessors[primitive.attributes.POSITION];
  assert.equal(accessor.componentType, 5126);
  const view = json.bufferViews[accessor.bufferView];
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const stride = view.byteStride ?? 12;
  return Array.from({ length: accessor.count }, (_, i) => new THREE.Vector3(
    binary.readFloatLE(start + i * stride), binary.readFloatLE(start + i * stride + 4),
    binary.readFloatLE(start + i * stride + 8),
  ).applyMatrix4(world));
}
function readIndices(primitive) {
  const accessor = json.accessors[primitive.indices];
  const view = json.bufferViews[accessor.bufferView];
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const size = { 5121: 1, 5123: 2, 5125: 4 }[accessor.componentType];
  assert.ok(size);
  return Array.from({ length: accessor.count }, (_, i) => binary.readUIntLE(start + i * size, size));
}
const middle = new THREE.Vector3();
function visit(index, parent) {
  const node = json.nodes[index];
  const local = node.matrix ? new THREE.Matrix4().fromArray(node.matrix) : new THREE.Matrix4().compose(
    new THREE.Vector3().fromArray(node.translation ?? [0, 0, 0]),
    new THREE.Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
    new THREE.Vector3().fromArray(node.scale ?? [1, 1, 1]),
  );
  const world = parent.clone().multiply(local);
  if (node.mesh !== undefined) for (const primitive of json.meshes[node.mesh].primitives) {
    const positions = readPositions(primitive, world);
    const indices = readIndices(primitive);
    for (const point of positions) checkPoint(point, node.name);
    for (let i = 0; i < indices.length; i += 3) {
      const a = positions[indices[i]], b = positions[indices[i + 1]], c = positions[indices[i + 2]];
      checkPoint(middle.copy(a).add(b).add(c).multiplyScalar(1 / 3), node.name);
      checkPoint(middle.copy(a).add(b).multiplyScalar(.5), node.name);
      checkPoint(middle.copy(b).add(c).multiplyScalar(.5), node.name);
      checkPoint(middle.copy(c).add(a).multiplyScalar(.5), node.name);
    }
  }
  for (const child of node.children ?? []) visit(child, world);
}
for (const node of json.scenes[json.scene ?? 0].nodes) visit(node, new THREE.Matrix4());
assert.ok(checkedPoints > 100_000 && nearbyPoints > 1000);

const signBytes = await readFile(new URL("signage.glb", base));
const signage = parseGlb(signBytes, "Tideline Pelagic Authority signage");
const signManifest = JSON.parse(await readFile(new URL("signage-manifest.json", base), "utf8"));
assert.equal(signManifest.signs.length, 9);
assert.ok(signManifest.flightArcsClear && signManifest.minimumRoadFaceClearance > 8);
assert.ok(signage.json.images.every(image => image.bufferView !== undefined && !image.uri),
  "The original signage atlas must be embedded and available offline.");
assert.ok(!signage.json.animations?.length && !signage.json.skins?.length);
assert.ok((signage.json.extensionsRequired ?? []).every(extension => extension === "EXT_texture_webp"));
let signTriangles = 0, signPrimitives = 0;
for (const mesh of signage.json.meshes) for (const primitive of mesh.primitives) {
  signPrimitives++;
  signTriangles += signage.json.accessors[primitive.indices].count / 3;
}
assert.equal(signTriangles, signManifest.triangles);
assert.ok(triangles + signTriangles <= 100_000 && primitives + signPrimitives <= 50);
assert.ok(bytes.length + signBytes.length < 8 * 1024 * 1024);
json = signage.json;
binary = signage.binary;
for (const node of json.scenes[json.scene ?? 0].nodes) visit(node, new THREE.Matrix4());

// Exercise the actual asynchronous loader using asset ports so both partial
// failure orders release their resources, and the atlas survives conversion.
const environmentUrl = new URL("src/game/tideline-environment.ts", root);
const environmentSource = await readFile(environmentUrl, "utf8");
const environmentCode = (await transformWithOxc(environmentSource, environmentUrl.pathname)).code
  .replace('import { isFoundryEdition } from "./tideline-style";', 'const isFoundryEdition = false;')
  .replace('from "three"', `from ${JSON.stringify(import.meta.resolve("three"))}`)
  .replace('import route from "./data/tideline/route.json";', `const route = ${JSON.stringify(route)};`)
  .replace('import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";',
    'class GLTFLoader { loadAsync() { return globalThis.__tidelineAssetPorts.signage(); } }')
  .replace('import { NeonEnvironment } from "./neon-environment";',
    'const NeonEnvironment = {load: options => globalThis.__tidelineAssetPorts.scenery(options)};')
  .replace('import { resolveReducedMotion } from "./query-probes";', 'const resolveReducedMotion = () => true;')
  .replace('from "./graphics-resources"', `from ${JSON.stringify(new URL("src/game/graphics-resources.js", root).href)}`);
const previousPorts = globalThis.__tidelineAssetPorts;
function fixture() {
  const texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: texture, emissiveMap: texture, emissive: 0x404040 });
  const geometry = new THREE.BoxGeometry(2, 2, 2);
  const root = new THREE.Group();
  root.add(new THREE.Mesh(geometry, material));
  const disposed = { texture: 0, material: 0, geometry: 0 };
  texture.addEventListener("dispose", () => disposed.texture++);
  material.addEventListener("dispose", () => disposed.material++);
  geometry.addEventListener("dispose", () => disposed.geometry++);
  const stats = { meshes: 1, materials: 1, textures: 1, triangles: 12, visibleGroups: 0,
    visibleTriangles: 0, shaderModel: "lambert", signageSource: "baked", contractDrift: [] };
  return { root, texture, material, disposed, scenery: { root, stats, updateVisibility() {
    stats.visibleGroups = 0; stats.visibleTriangles = 0;
  } } };
}
try {
  const { TidelineEnvironment } = await import(`data:text/javascript;base64,${Buffer.from(environmentCode).toString("base64")}`);
  const world = fixture(), signs = fixture();
  globalThis.__tidelineAssetPorts = { scenery: async () => world.scenery, signage: async () => ({ scene: signs.root }) };
  const environment = await TidelineEnvironment.load();
  const proceduralTriangles = environment.stats.triangles - 24;
  assert.ok(triangles + signTriangles + proceduralTriangles <= 100_000,
    "The environment triangle budget includes runtime water and glass.");
  assert.equal(signs.disposed.material, 1, "Original sign materials must be released after conversion.");
  assert.equal(signs.disposed.texture, 0, "The original embedded atlas stays alive.");
  const runtimeMaterial = signs.root.children[0].material;
  assert.equal(runtimeMaterial.map, signs.texture);
  assert.equal(runtimeMaterial.emissiveMap, signs.texture);
  assert.ok(runtimeMaterial.isMeshLambertMaterial);
  const camera = new THREE.PerspectiveCamera(60, 1, .1, 500);
  camera.position.set(0, 0, 10); camera.updateMatrixWorld();
  environment.updateVisibility(camera);
  disposeObject3DResources(environment.root);
  assert.equal(signs.disposed.texture, 1);
  assert.equal(signs.disposed.geometry, 1);
  for (const failed of ["scenery", "signage"]) {
    const sibling = fixture();
    globalThis.__tidelineAssetPorts = {
      scenery: async () => { if (failed === "scenery") throw new Error("missing world"); return sibling.scenery; },
      signage: async () => { if (failed === "signage") throw new Error("missing signage"); return { scene: sibling.root }; },
    };
    await assert.rejects(TidelineEnvironment.load(), /could not be loaded/);
    assert.deepEqual(sibling.disposed, { texture: 1, material: 1, geometry: 1 },
      `A failed ${failed} load must clean up the sibling asset.`);
  }
  const foundryCode = environmentCode.replace('const isFoundryEdition = false;', 'const isFoundryEdition = true;');
  const { TidelineEnvironment: FoundryEnvironment } = await import(`data:text/javascript;base64,${Buffer.from(foundryCode).toString("base64")}`);
  const foundry = fixture();
  globalThis.__tidelineAssetPorts = {
    scenery: async options => {
      assert.equal(options.modelUrl, "/assets/tideline-foundry/foundry_world.glb");
      assert.equal(options.maximumDistance, 200);
      assert.equal(options.opticalEffects, false);
      return foundry.scenery;
    },
    signage: () => { throw new Error("The Foundry edition must not load the neon atlas signage."); },
  };
  const foundryEnvironment = await FoundryEnvironment.load();
  assert.equal(foundryEnvironment.root.getObjectByName("tideline_water_surface").material.uniforms.foundry.value, 1);
  disposeObject3DResources(foundryEnvironment.root);
  assert.deepEqual(foundry.disposed, { texture: 1, material: 1, geometry: 1 });
} finally {
  if (previousPorts === undefined) delete globalThis.__tidelineAssetPorts;
  else globalThis.__tidelineAssetPorts = previousPorts;
}
console.log(`Tideline environment PASS: ${(triangles + signTriangles).toLocaleString()} triangles, ${primitives + signPrimitives} primitives, ${((bytes.length + signBytes.length) / 1024 / 1024).toFixed(2)} MiB including original atlas signage; ${checkedPoints.toLocaleString()} exported vertex/triangle probes clear the full 3D driving and glide corridor; ${lamps.length} lights.`);
