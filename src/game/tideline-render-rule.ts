import * as THREE from "three";

/** Tideline-only adapter for legacy vehicle/effect materials. Keeps live controls
 * on their original objects; replacement Lambert materials copy those values.
 * Custom emission shaders keep their effect, then use the world's AgX and fog.
 */
export function applyTidelineRenderRule(...roots: THREE.Object3D[]): () => void {
  const replacements = new Map<THREE.Material, THREE.Material>();
  const controls: { source: THREE.MeshBasicMaterial; target: THREE.MeshLambertMaterial }[] = [];
  const adapt = (source: THREE.Material): THREE.Material => {
    const cached = replacements.get(source);
    if (cached) return cached;
    let target = source;
    if (source instanceof THREE.MeshBasicMaterial) {
      const lit = new THREE.MeshLambertMaterial({
        name: source.name, map: source.map, alphaMap: source.alphaMap,
        color: source.color, emissive: source.color, emissiveMap: source.map,
        emissiveIntensity: source.toneMapped === false ? .45 : .05,
        transparent: source.transparent, opacity: source.opacity, alphaTest: source.alphaTest,
        side: source.side, depthWrite: source.depthWrite, depthTest: source.depthTest,
        blending: source.blending, vertexColors: source.vertexColors,
        polygonOffset: source.polygonOffset, polygonOffsetFactor: source.polygonOffsetFactor,
        polygonOffsetUnits: source.polygonOffsetUnits,
      });
      lit.onBeforeCompile = source.onBeforeCompile;
      lit.customProgramCacheKey = source.customProgramCacheKey;
      controls.push({source, target: lit}); target = lit;
      // Textures are shared; only the superseded GPU material is released.
      source.dispose();
    } else if (source instanceof THREE.ShaderMaterial) {
      for (const [key, uniform] of Object.entries(THREE.UniformsLib.fog)) {
        source.uniforms[key] ??= THREE.UniformsUtils.clone({[key]: uniform})[key];
      }
      if (!source.vertexShader.includes("fog_pars_vertex")) {
        source.vertexShader = '#include <fog_pars_vertex>\n' + source.vertexShader;
        const end = source.vertexShader.lastIndexOf("}");
        source.vertexShader = source.vertexShader.slice(0,end) + '\n#ifdef USE_FOG\nvFogDepth=gl_Position.w;\n#endif\n' + source.vertexShader.slice(end);
      }
      if (!source.fragmentShader.includes("fog_pars_fragment")) {
        source.fragmentShader = '#include <fog_pars_fragment>\n' + source.fragmentShader;
        const end = source.fragmentShader.lastIndexOf("}");
        source.fragmentShader = source.fragmentShader.slice(0,end) + '\n#include <fog_fragment>\n' + source.fragmentShader.slice(end);
      }
      if (!source.fragmentShader.includes("tonemapping_fragment")) {
        source.fragmentShader = source.fragmentShader.replace('#include <colorspace_fragment>', '#include <tonemapping_fragment>\n#include <colorspace_fragment>');
      }
      source.fog = true;
    }
    target.toneMapped = true;
    if ("fog" in target) target.fog = true;
    target.needsUpdate = true;
    replacements.set(source,target);
    return target;
  };
  for (const root of roots) root.traverse(object => {
    // The sky has its own directional horizon haze, not distance fog.
    if (object.name === "tideline_refinery_horizon") return;
    const renderable = object as THREE.Mesh;
    if (!renderable.material) return;
    renderable.material = Array.isArray(renderable.material)
      ? renderable.material.map(adapt) : adapt(renderable.material);
    object.userData.tidelineGameplay = true;
  });
  return () => {
    for (const {source,target} of controls) {
      target.color.copy(source.color); target.emissive.copy(source.color);
      target.opacity = source.opacity;
    }
  };
}

export function auditTidelineGameplayMaterials(root: THREE.Object3D): {object:string;material:string;type:string;toneMapped:boolean;fog:boolean}[] {
  const rows: ReturnType<typeof auditTidelineGameplayMaterials> = [];
  root.traverse(object => {
    if (!object.userData.tidelineGameplay) return;
    const mesh=object as THREE.Mesh;
    for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material]) {
      const fog = !('fog' in material) || material.fog === true;
      rows.push({object:object.name,material:material.name,type:material.type,toneMapped:material.toneMapped,fog});
      if (!material.toneMapped || !fog) throw new Error(`Tideline render rule failed: ${object.name}/${material.name}`);
    }
  });
  return rows;
}
