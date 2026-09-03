// P20.8 review harness (not part of the shipped game).
//
// A Vite-transformed module that re-exports the bare specifiers the audit
// scripts need. `/node_modules/...` is served raw by the dev server, so a
// GLTFLoader imported from there fails on its own `import ... from "three"`;
// anything under the project root goes through Vite's resolver and does not.
export { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
export * as THREE from "three";
