import assert from "node:assert/strict";
import * as THREE from "three";
import { disposeObject3DResources } from "../src/game/graphics-resources.js";

const root = new THREE.Group();
const geometry = new THREE.BoxGeometry(1, 1, 1);
const texture = new THREE.Texture();
const material = new THREE.MeshBasicMaterial({ map: texture });
root.add(
  new THREE.Mesh(geometry, material),
  new THREE.Mesh(geometry, material),
);

let geometryDisposals = 0;
let materialDisposals = 0;
let textureDisposals = 0;
geometry.addEventListener("dispose", () => { geometryDisposals += 1; });
material.addEventListener("dispose", () => { materialDisposals += 1; });
texture.addEventListener("dispose", () => { textureDisposals += 1; });

const disposed = disposeObject3DResources(root);
assert.deepEqual(disposed, {
  objects: 3,
  geometries: 1,
  materials: 1,
  textures: 1,
});
assert.equal(geometryDisposals, 1);
assert.equal(materialDisposals, 1);
assert.equal(textureDisposals, 1);

console.log(
  "Graphics resources PASS: shared geometry, material, and texture ownership disposes exactly once.",
);
