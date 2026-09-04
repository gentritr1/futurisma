import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { parseGlb } from "./lib/greenwater-package-validator.mjs";
import { disposeObject3DResources } from "../src/game/graphics-resources.js";

const root = new URL("../", import.meta.url);
const base = new URL("public/assets/tideline-foundry/", root);
const route = JSON.parse(await readFile(new URL("src/game/data/tideline/route.json", root), "utf8"));
const bytes = await readFile(new URL("foundry_world.glb", base));
const manifest = JSON.parse(await readFile(new URL("manifest.json", base), "utf8"));
const placements = JSON.parse(await readFile(new URL("placements.json", base), "utf8"));
const lamps = JSON.parse(await readFile(new URL("lights.json", base), "utf8"));
const { json } = parseGlb(bytes, "Tideline Foundry");
const names = new Set(["concrete", "metal", "jungle", "water", "signage", "emissive"].map(role => `GW_MAT_${role}`));
assert.ok(bytes.length < 8 * 1024 * 1024);
assert.equal(manifest.routeLength, route.length);
assert.equal(manifest.routeCount, route.count);
assert.equal(manifest.gantries, 3);
assert.deepEqual(placements.map(p => p.progress), [.055, .185, .325]);
assert.equal(lamps.length, manifest.lightAnchors);
assert.ok(lamps.length > 15);
for (const lamp of lamps) {
  assert.equal(lamp.color, "GW_MAT_emissive");
  assert.ok([...lamp.p, lamp.ground, lamp.size].every(Number.isFinite));
}
assert.ok(!json.animations?.length && !json.skins?.length && !json.cameras?.length);
assert.ok(!json.extensionsRequired?.length);
assert.ok(!json.images?.length && !json.textures?.length, "Foundry AO and wear belong in vertex colours, with no PBR maps.");
assert.ok(json.materials.length <= 6);
for (const material of json.materials) {
  assert.ok(names.has(material.name), `Unknown material role ${material.name}.`);
  assert.ok(!material.normalTexture && !material.occlusionTexture);
  assert.ok(!material.pbrMetallicRoughness?.metallicRoughnessTexture);
  assert.equal(material.pbrMetallicRoughness?.metallicFactor ?? 1, 0);
  assert.equal(material.alphaMode ?? "OPAQUE", ["GW_MAT_jungle", "GW_MAT_signage"].includes(material.name) ? "MASK" : "OPAQUE");
  if (material.name === "GW_MAT_emissive") {
    const [red, green, blue] = material.emissiveFactor;
    assert.ok(red > green && green > blue && red < .5, "The only emissive role is restrained sodium amber.");
  }
}
let triangles = 0, primitives = 0;
for (const mesh of json.meshes) for (const primitive of mesh.primitives) {
  primitives++;
  assert.equal(primitive.mode ?? 4, 4);
  assert.ok(primitive.indices !== undefined);
  for (const attribute of ["POSITION", "NORMAL", "TEXCOORD_0", "COLOR_0"]) {
    assert.ok(primitive.attributes[attribute] !== undefined, `Missing ${attribute}.`);
  }
  triangles += json.accessors[primitive.indices].count / 3;
}
assert.equal(triangles, manifest.triangles);
assert.ok(triangles + 11_204 <= 100_000, "Foundry plus runtime water/glass exceeds the existing triangle budget.");
assert.ok(primitives <= 50);
const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
gltf.scene.updateMatrixWorld(true);
const cells = new Map();
for (const station of route.stations) {
  const tangent = new THREE.Vector3(...station.t);
  const right = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, tangent).normalize();
  const key = `${Math.floor(station.p[0] / 32)},${Math.floor(station.p[2] / 32)}`;
  const bucket = cells.get(key) ?? [];
  bucket.push({ p: new THREE.Vector3(...station.p), tangent, right, up, halfWidth: station.width / 2 });
  cells.set(key, bucket);
}
let probes = 0, closeProbes = 0;
const relative = new THREE.Vector3();
function check(point, nodeName) {
  probes++;
  const x = Math.floor(point.x / 32), z = Math.floor(point.z / 32);
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    for (const station of cells.get(`${x + dx},${z + dz}`) ?? []) {
      relative.subVectors(point, station.p);
      if (Math.abs(relative.dot(station.tangent)) > 1.6) continue;
      const height = relative.dot(station.up);
      if (height < -.25 || height > 7) continue;
      closeProbes++;
      assert.ok(Math.abs(relative.dot(station.right)) >= station.halfWidth + 2,
        `${nodeName} intrudes into the road/glide corridor at ${point.toArray()}.`);
    }
  }
}
const point = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
let colorMinimum = 1, colorMaximum = 0;
const groups = [];
gltf.scene.traverse(object => {
  if (!object.isMesh) return;
  const geometry = object.geometry;
  const positions = geometry.getAttribute("position"), colors = geometry.getAttribute("color");
  assert.ok(colors && object.material.vertexColors, "The loader must preserve the authored AO/paint channel.");
  assert.ok(positions.count > 0 && geometry.index);
  for (let index = 0; index < positions.count; index++) {
    point.fromBufferAttribute(positions, index).applyMatrix4(object.matrixWorld);
    check(point, object.name);
    for (const value of [colors.getX(index), colors.getY(index), colors.getZ(index)]) {
      assert.ok(Number.isFinite(value) && value >= 0 && value <= 1);
      colorMinimum = Math.min(colorMinimum, value); colorMaximum = Math.max(colorMaximum, value);
    }
  }
  for (let index = 0; index < geometry.index.count; index += 3) {
    a.fromBufferAttribute(positions, geometry.index.getX(index)).applyMatrix4(object.matrixWorld);
    b.fromBufferAttribute(positions, geometry.index.getX(index + 1)).applyMatrix4(object.matrixWorld);
    c.fromBufferAttribute(positions, geometry.index.getX(index + 2)).applyMatrix4(object.matrixWorld);
    check(point.copy(a).add(b).add(c).multiplyScalar(1 / 3), object.name);
    check(point.copy(a).add(b).multiplyScalar(.5), object.name);
    check(point.copy(b).add(c).multiplyScalar(.5), object.name);
    check(point.copy(c).add(a).multiplyScalar(.5), object.name);
  }
  geometry.computeBoundingSphere();
  groups.push({ sphere: geometry.boundingSphere.clone().applyMatrix4(object.matrixWorld),
    triangles: geometry.index.count / 3 });
});
assert.ok(probes > 100_000 && closeProbes > 1000);
assert.ok(colorMaximum - colorMinimum > .3, "The six roles need authored value contrast, AO and weathering.");
// Measure the same world-space frustum and distance cull used by the loader.
const camera = new THREE.PerspectiveCamera(63, 16 / 9, .1, 900);
const frustum = new THREE.Frustum(), matrix = new THREE.Matrix4();
let peakDraws = 0, peakTriangles = 0;
for (let index = 0; index < route.count; index += 3) {
  const station = route.stations[index];
  const p = new THREE.Vector3(...station.p), t = new THREE.Vector3(...station.t);
  camera.position.copy(p).addScaledVector(t, -11.5); camera.position.y += 5.8;
  camera.lookAt(p.addScaledVector(t, 19)); camera.updateMatrixWorld();
  frustum.setFromProjectionMatrix(matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  const visible = groups.filter(group => frustum.intersectsSphere(group.sphere) && group.sphere.distanceToPoint(camera.position) <= 200);
  peakDraws = Math.max(peakDraws, visible.length);
  peakTriangles = Math.max(peakTriangles, visible.reduce((sum, group) => sum + group.triangles, 0));
}
assert.ok(peakDraws <= 24, `The Foundry contribution peaks at ${peakDraws} draws (limit 24).`);
assert.ok(peakTriangles + 11_204 <= 100_000);
disposeObject3DResources(gltf.scene);
console.log(`Tideline Foundry PASS: ${triangles.toLocaleString()} authored triangles / ${primitives} primitives / ${(bytes.length / 1024 / 1024).toFixed(2)} MiB; ${probes.toLocaleString()} 3D clearance probes; six-role vertex-painted materials; peak authored visibility ${peakDraws} draws / ${peakTriangles.toLocaleString()} triangles.`);
