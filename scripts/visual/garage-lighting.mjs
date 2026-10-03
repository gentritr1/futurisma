/**
 * Loads the shipped bodies and renders their real composed shaders. Checks
 * lamp boundaries, kit isolation, repeat mounts, paint tint and circuit fog.
 * No game save, production debug hook, or extra material is needed.
 * Run: npm run check:garage-lighting (requires Playwright).
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "vite";

const server = await createServer({
  server: { host: "127.0.0.1", port: 5323, strictPort: true },
  logLevel: "error",
  plugins: [{
    name: "lighting-test-subject",
    resolveId(id) { if (id === "/__lighting-subject") return "\0lighting-test-subject"; },
    load(id) {
      if (id === "\0lighting-test-subject") return `
        export * as THREE from 'three';
        export { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
        export { fitFrameLighting } from '/src/game/garage-lighting.ts';
        export { applyPs2MaterialTreatment } from '/src/game/totem.ts';
        export { applyTidelineRenderRule } from '/src/game/tideline-render-rule.ts';
      `;
    },
  }],
});
await server.listen();
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
try {
  for (const mode of ["agx", "ps2"]) {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.route("**/__lighting-check?*", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Frame lighting check</title>" }));
    await page.goto(`http://127.0.0.1:5323/__lighting-check?render=${mode}`);
    const results = await page.evaluate(async () => {
      const { THREE, GLTFLoader, fitFrameLighting, applyPs2MaterialTreatment, applyTidelineRenderRule } = await import("/__lighting-subject");
      const renderer = new THREE.WebGLRenderer();
      renderer.setSize(512, 512);
      const target = new THREE.WebGLRenderTarget(512, 512);
      renderer.setRenderTarget(target);
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xffffff, 0x222233, 1));
      const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
      camera.position.set(7, 4, 10);
      camera.lookAt(0, 0, 0);
      const snapshot = () => {
        renderer.render(scene, camera);
        const pixels = new Uint8Array(512 * 512 * 4);
        renderer.readRenderTargetPixels(target, 0, 0, 512, 512, pixels);
        return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, pixels };
      };
      const results = [];
      for (const frame of ["lance", "sidewinder", "bulwark", "corona", "halo"]) {
        const { scene: body } = await new GLTFLoader().loadAsync(`/assets/garage/frames/${frame}.glb`);
        applyPs2MaterialTreatment(body, { textureCharacter: "painterly" });
        const lamps = [];
        const others = [];
        body.traverse((mesh) => {
          if (!mesh.isMesh) return;
          const state = { mesh, material: mesh.material, key: mesh.material.customProgramCacheKey(), intensity: mesh.material.emissiveIntensity };
          (mesh.material.name === "FRAME_lights" ? lamps : others).push(state);
        });
        scene.add(body);
        const stock = snapshot();
        fitFrameLighting(body, frame);
        const revised = snapshot();
        const values = new Set();
        let mixedTriangles = 0;
        let bytes = 0;
        for (const { mesh } of lamps) {
          const attribute = mesh.geometry.getAttribute("frameLightLevel");
          for (const value of attribute.array) values.add(value);
          bytes += attribute.array.byteLength;
          const indices = mesh.geometry.index;
          const count = indices ? indices.count : attribute.count;
          for (let index = 0; index < count; index += 3) {
            const levels = [0, 1, 2].map((offset) => attribute.getX(indices ? indices.getX(index + offset) : index + offset));
            if (new Set(levels).size !== 1) mixedTriangles += 1;
          }
        }
        const keys = lamps.map(({ mesh }) => mesh.material.customProgramCacheKey());
        fitFrameLighting(body, frame);
        const repeated = lamps.every(({ mesh }, index) => mesh.material.customProgramCacheKey() === keys[index]);
        const preserved = [...lamps, ...others].every(({ mesh, material, intensity }) => mesh.material === material && material.emissiveIntensity === intensity);
        const isolated = others.every(({ mesh, key }) => !mesh.geometry.hasAttribute("frameLightLevel") && mesh.material.customProgramCacheKey() === key);
        for (const { mesh } of lamps) mesh.material.emissive.setHex(0xff8800);
        const painted = snapshot();
        applyTidelineRenderRule(body);
        scene.fog = new THREE.FogExp2(0x111122, 0.06);
        const fogged = snapshot();
        const changed = (a, b) => a.pixels.reduce((sum, value, index) => sum + Number(value !== b.pixels[index]), 0);
        results.push({ frame, bytes, mixedTriangles, preserved, isolated, repeated, min: Math.min(...values), max: Math.max(...values),
          stockCalls: stock.calls, revisedCalls: revised.calls, stockTriangles: stock.triangles, revisedTriangles: revised.triangles,
          changed: changed(stock, revised), painted: changed(revised, painted), fogged: changed(painted, fogged) });
        scene.fog = null;
        scene.remove(body);
        body.traverse((mesh) => { if (mesh.isMesh) { mesh.geometry.dispose(); mesh.material.dispose(); } });
      }
      target.dispose();
      renderer.dispose();
      return results;
    });
    for (const result of results) {
      assert.equal(result.mixedTriangles, 0, `${result.frame}: a lamp crosses brightness roles`);
      assert.ok(result.preserved && result.isolated && result.repeated, `${result.frame}: material identity, kit isolation or repeat fitting failed`);
      assert.ok(result.min > 0 && result.min < 1 && result.max > 1 && result.max < 2, `${result.frame}: missing or invalid hierarchy`);
      assert.equal(result.revisedCalls, result.stockCalls, `${result.frame}: extra draw calls`);
      assert.equal(result.revisedTriangles, result.stockTriangles, `${result.frame}: extra triangles`);
      assert.ok(result.changed > 100 && result.painted > 100 && result.fogged > 100, `${result.frame}: hierarchy, tint or fog did not reach the rendered pixels`);
      console.log(`${mode}/${result.frame}: ${result.bytes} attribute bytes; lamps stay separate; paint and fog render; no extra draws or triangles.`);
    }
    assert.deepEqual(errors, [], "Shader or page errors");
    await page.close();
  }
  console.log("Garage lighting PASS: five shipped bodies, AgX and PS2 shaders, repeated fitting.");
} finally {
  await browser.close();
  await server.close();
}
