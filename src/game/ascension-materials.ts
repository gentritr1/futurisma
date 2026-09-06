import type * as THREE from 'three';
/** The organic atlas keeps its egret sprite in a chroma-key tile.
 * Discard precedes shared Lambert lighting, fog and tone mapping. */
export function applyAscensionOrganicCutout(material:THREE.MeshLambertMaterial):void {
 if(!material.name.endsWith('jungle'))return;
 material.onBeforeCompile=shader=>{
  shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',
   '#include <map_fragment>\nif(min(diffuseColor.r,diffuseColor.b)-diffuseColor.g>.025)discard;');
 };
 material.customProgramCacheKey=()=> 'ascension-organic-cutout-v1';
}
