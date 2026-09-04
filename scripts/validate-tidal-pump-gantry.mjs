import assert from 'node:assert/strict';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const root = new URL('../', import.meta.url);
const assetUrl = new URL('public/assets/tideline-foundry/tidal-pump-gantry.glb', root);
const bytes = await readFile(assetUrl);
const manifest = JSON.parse(await readFile(new URL('public/assets/tideline-foundry/tidal-pump-gantry-manifest.json', root), 'utf8'));
const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
assert.equal(bytes.readUInt32LE(0), 0x46546c67);
assert.equal(bytes.readUInt32LE(4), 2);
assert.equal(bytes.readUInt32LE(8), bytes.length);
assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sha256);
assert.equal(bytes.length, manifest.bytes);
assert.ok(bytes.length < 512 * 1024);
const roles = new Set(['concrete', 'metal', 'jungle', 'water', 'signage', 'emissive']);
for (const material of json.materials) {
  const role = material.name.replace('GW_MAT_', '');
  assert.ok(roles.has(role), material.name);
  assert.equal(material.alphaMode, role === 'jungle' || role === 'signage' ? 'MASK' : 'OPAQUE');
  assert.equal(material.pbrMetallicRoughness?.metallicFactor, 0);
  assert.equal(material.pbrMetallicRoughness?.roughnessFactor ?? 1, 1);
  for (const key of ['normalTexture', 'occlusionTexture', 'emissiveTexture']) assert.equal(material[key], undefined);
  assert.equal(material.pbrMetallicRoughness?.baseColorTexture, undefined);
  assert.equal(material.pbrMetallicRoughness?.metallicRoughnessTexture, undefined);
  if (role === 'emissive') assert.ok(material.emissiveFactor[0] > material.emissiveFactor[1] * 2 && material.emissiveFactor[1] > material.emissiveFactor[2] * 5, 'The sole emissive role must remain amber.');
}
for (const key of ['images', 'textures', 'skins', 'animations', 'cameras']) assert.equal(json[key]?.length ?? 0, 0);
assert.equal(json.extensions?.KHR_lights_punctual, undefined);
assert.ok(!json.nodes.some(node => /REF_|CAM_|REFERENCE|light/i.test(node.name ?? '')), 'Reference planes, cameras and lights must not export.');
const expectedParts = { concrete_foot: 2, repair_plate: 2, overhead_truss: 3, pump_drum: 1, ladder: 1, lamp_working: 3, lamp_dead: 1 };
for (const [role, count] of Object.entries(expectedParts)) {
  const parts = manifest.parts.filter(part => part.role === role);
  assert.equal(parts.length, count, `${role} count`);
  for (const part of parts) assert.ok(json.nodes.some(node => node.name === part.name), `Missing physical part marker ${part.name}`);
}
for (const name of ['tidal-pump-orthographic.png', 'tidal-pump-hero.png', 'tidal-pump-material-id.png', 'generation.json']) {
  assert.ok((await stat(new URL(`art/references/tideline-foundry/${name}`, root))).size > 100);
}
let triangles = 0;
let primitives = 0;
for (const mesh of json.meshes) for (const primitive of mesh.primitives) {
  primitives++;
  assert.notEqual(primitive.indices, undefined);
  for (const attribute of ['POSITION', 'NORMAL', 'TEXCOORD_0', 'COLOR_0']) assert.notEqual(primitive.attributes[attribute], undefined, `${mesh.name}: ${attribute}`);
  triangles += json.accessors[primitive.indices].count / 3;
}
assert.equal(triangles, manifest.triangles);
assert.ok(triangles <= 5500);
assert.equal(primitives, 5);
const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
const model = gltf.scene.getObjectByName('GW_LM_TIDAL_PUMP_GANTRY');
assert.ok(model);
assert.deepEqual(model.position.toArray(), [0, 0, 0]);
assert.deepEqual(model.scale.toArray(), [1, 1, 1]);
gltf.scene.updateMatrixWorld(true);
const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
let minimumCentralHeight = Infinity;
let minimumSupportLateral = Infinity;
model.traverse(object => {
  if (!object.isMesh) return;
  const position = object.geometry.getAttribute('position');
  const color = object.geometry.getAttribute('color');
  const normal = object.geometry.getAttribute('normal');
  const index = object.geometry.getIndex();
  let lowest = Infinity, highest = -Infinity;
  for (let i = 0; i < position.count; i++) {
    a.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
    assert.ok(a.toArray().every(Number.isFinite));
    assert.ok(Math.abs(a.x) >= 18 || a.y >= 12.5, 'Every exported vertex must clear the portal envelope.');
    if (Math.abs(a.x) < 18) minimumCentralHeight = Math.min(minimumCentralHeight, a.y);
    if (a.y < 12.5) minimumSupportLateral = Math.min(minimumSupportLateral, Math.abs(a.x));
    b.fromBufferAttribute(normal, i);
    assert.ok(Math.abs(b.length() - 1) < .001);
    for (const value of [color.getX(i), color.getY(i), color.getZ(i)]) {
      assert.ok(Number.isFinite(value) && value >= 0 && value <= 1);
      lowest = Math.min(lowest, value); highest = Math.max(highest, value);
    }
  }
  assert.ok(highest - lowest > .01, 'Vertex paint must contain actual variation.');
  for (let i = 0; i < index.count; i += 3) {
    a.fromBufferAttribute(position, index.getX(i));
    b.fromBufferAttribute(position, index.getX(i + 1));
    c.fromBufferAttribute(position, index.getX(i + 2));
    const crossesOpening = Math.min(a.x,b.x,c.x) < 18 && Math.max(a.x,b.x,c.x) > -18;
    assert.ok(!crossesOpening || Math.min(a.y,b.y,c.y) >= 12.5, 'Triangle interiors must not bridge the empty portal.');
    assert.ok(b.sub(a).cross(c.sub(a)).lengthSq() > 1e-14, 'No collapsed triangles.');
  }
});
assert.ok(minimumCentralHeight >= 12.5);
assert.ok(minimumSupportLateral >= 18.5);
const result = { pass: true, triangles, primitives, bytes: bytes.length, minimumCentralHeight, minimumSupportLateral, exactPartCounts: expectedParts, checks: ['metre-scale zero root', 'indexes/normals/UV0/COLOR_0', 'finite non-degenerate geometry', 'painted AO/wear variation', 'six allowed roles', 'three amber lamps plus one dead', 'no maps or runtime images', 'reference planes excluded', 'source references and provenance present'] };
await writeFile(new URL('public/assets/tideline-foundry/tidal-pump-gantry-validation.json', root), `${JSON.stringify(result, null, 2)}\n`);
console.log(`Tidal Pump Gantry PASS: ${triangles} triangles, ${primitives} draws, ${(bytes.length / 1024).toFixed(1)} KiB, painted vertex colour, no textures; ${minimumCentralHeight.toFixed(3)} m overhead and ${minimumSupportLateral.toFixed(3)} m support clearances.`);
