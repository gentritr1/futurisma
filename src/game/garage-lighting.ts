import * as THREE from "three";
import { composeShaderInjection } from "./totem";

// Relative to the GLBs' 0.62 emissive strength: exhaust 0.90, small markers
// 0.53, broad trim 0.25. Live TE_* lamps keep their own kit-driven intensity.
const EXHAUST = 1.45;
const MARKER = 0.85;
const TRIM = 0.4;

function isMarker(frame: string, point: THREE.Vector3): boolean {
  switch (frame) {
    case "lance": return (Math.abs(point.x) > 1.5 && point.z < 0) || point.y > 0.5;
    case "sidewinder": return point.y > 0.75;
    case "bulwark": return point.z < -3 || point.y > 0.7;
    case "halo": return Math.abs(point.x) > 1 && point.z > 2.4;
    default: return false;
  }
}

/**
 * Give the existing lamps a hierarchy without splitting their shared material
 * or adding draws. Roles are assigned once in the body's rest pose, so a
 * moving ring cannot wander into a nozzle's classification during a race.
 * Paint still tints the same material; PS2 grading and circuit fog compose.
 */
export function fitFrameLighting(body: THREE.Object3D, frame: string): void {
  body.updateMatrixWorld(true);
  const toBody = body.matrixWorld.clone().invert();
  const jets = ["FX_jet_left", "FX_jet_right"].flatMap((name) => {
    const anchor = body.getObjectByName(name);
    return anchor ? [anchor.getWorldPosition(new THREE.Vector3()).applyMatrix4(toBody)] : [];
  });
  const materials = new Set<THREE.MeshStandardMaterial>();
  body.traverse((object) => {
    const mesh = object as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    if (!mesh.isMesh || mesh.material.name !== "FRAME_lights") return;
    // Cached bodies may be mounted many times; never stack the injection.
    if (mesh.geometry.hasAttribute("frameLightLevel")) return;
    let ring = false;
    for (let at: THREE.Object3D | null = mesh; at && at !== body; at = at.parent) {
      if (at.name === "stabiliser_ring_pivot") ring = true;
    }
    const positions = mesh.geometry.getAttribute("position");
    const levels = new Float32Array(positions.count);
    const matrix = new THREE.Matrix4().multiplyMatrices(toBody, mesh.matrixWorld);
    const point = new THREE.Vector3();
    for (let index = 0; index < positions.count; index += 1) {
      point.fromBufferAttribute(positions, index).applyMatrix4(matrix);
      const exhaust = !ring && jets.some((jet) => Math.abs(point.x - jet.x) < 0.36
        && Math.abs(point.y - jet.y) < 0.36 && point.z > jet.z - 0.7 && point.z < jet.z + 0.08);
      levels[index] = ring ? TRIM : exhaust ? EXHAUST : isMarker(frame, point) ? MARKER : TRIM;
    }
    mesh.geometry.setAttribute("frameLightLevel", new THREE.BufferAttribute(levels, 1));
    materials.add(mesh.material);
  });
  for (const material of materials) {
    composeShaderInjection(material, "frame-light-level", (shader) => {
      shader.vertexShader = `attribute float frameLightLevel;\nvarying float vFrameLightLevel;\n${shader.vertexShader}`
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFrameLightLevel = frameLightLevel;");
      shader.fragmentShader = `varying float vFrameLightLevel;\n${shader.fragmentShader}`
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vFrameLightLevel;");
    });
  }
}
