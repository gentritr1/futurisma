import * as THREE from "three";

/**
 * Disposes every unique render resource reachable from an Object3D hierarchy.
 * Shared geometries, materials and textures are released exactly once.
 * @param {THREE.Object3D} root
 */
export function disposeObject3DResources(root) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  let objects = 0;

  root.traverse((object) => {
    objects += 1;
    const renderable = /** @type {{
      geometry?: THREE.BufferGeometry;
      material?: THREE.Material | THREE.Material[];
    }} */ (object);
    if (renderable.geometry instanceof THREE.BufferGeometry) {
      geometries.add(renderable.geometry);
    }
    const objectMaterials = Array.isArray(renderable.material)
      ? renderable.material
      : renderable.material
        ? [renderable.material]
        : [];
    for (const material of objectMaterials) {
      materials.add(material);
      if (material instanceof THREE.ShaderMaterial) {
        for (const uniform of Object.values(material.uniforms)) {
          if (uniform.value instanceof THREE.Texture) textures.add(uniform.value);
        }
      }
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });

  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();

  return {
    objects,
    geometries: geometries.size,
    materials: materials.size,
    textures: textures.size,
  };
}
