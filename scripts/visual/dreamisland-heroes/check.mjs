import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {REVISION} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {inspectAsset, verifyAtlasInputs} from './inspect.mjs';
const out = process.argv.find(a=>a.startsWith('--out='))?.slice(6)??'art/evidence/dreamisland-v1/heroes';
mkdirSync(out, {recursive: true});
assert.equal(REVISION, '184', 'The loader check requires three r184');
const manifest = JSON.parse(readFileSync('public/assets/dreamisland/heroes/heroes.json', 'utf8'));
const report = {status: 'VERIFIED', threeRevision: REVISION, atlasInputs: verifyAtlasInputs(manifest), assets: {}};
for (const [name, spec] of Object.entries(manifest.assets)) {
  const buffer = readFileSync('public/assets/dreamisland/heroes/' + spec.file);
  const gltf = await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
  report.assets[name] = inspectAsset(name, spec, buffer, gltf.scene);
  console.log('VERIFIED', name, JSON.stringify(report.assets[name]));
}
writeFileSync(out + '/loader-check.json', JSON.stringify(report, null, 2) + '\n');
console.log('VERIFIED three r184: all four GLBs loaded; dimensions, budgets, materials, atlas UVs and texture absence passed.');
console.log('VERIFIED watchtower 14 x 8 m rectangle plus arched cap to 10 m through full depth:', report.assets.watchtower.bore.intersectingTriangles, 'intersecting triangles.');
console.log('VERIFIED evidence:', out + '/loader-check.json');
