import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

/** Keep the six painted textures, but submit immutable world props in one lit draw. */
export function mergeAscensionStaticPaint(root:THREE.Group){
 const parts:THREE.Mesh[]=[];root.traverse(o=>{if(o instanceof THREE.Mesh&&o.name.startsWith('AP_STATIC_'))parts.push(o);});
 if(!parts.length)return;
 const materials=parts.map(p=>p.material as THREE.MeshLambertMaterial),geometries=parts.map((p,i)=>{
  const g=p.geometry.clone();g.applyMatrix4(p.matrixWorld);g.setAttribute('paintId',new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(i),1));return g;
 });
 const geometry=mergeGeometries(geometries)!;geometries.forEach(g=>g.dispose());
 const material=new THREE.MeshLambertMaterial({map:materials[0].map,vertexColors:true,side:THREE.DoubleSide});material.name='ascension_shared_static_paint';
 material.onBeforeCompile=shader=>{
  shader.vertexShader='attribute float paintId; varying float vPaintId;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvPaintId=paintId;');
  let declarations='varying float vPaintId;\n',selection='vec4 surfacePaint=vec4(1.);vec3 surfaceEmission=vec3(0.);float organic=0.;\n';
  materials.forEach((m,i)=>{
   shader.uniforms['paintAtlas'+i]={value:m.map};shader.uniforms['paintColor'+i]={value:m.color};shader.uniforms['paintEmission'+i]={value:m.emissive.clone().multiplyScalar(m.emissiveIntensity)};
   declarations+=`uniform sampler2D paintAtlas${i};uniform vec3 paintColor${i},paintEmission${i};\n`;
   selection+=`${i?'else ':''}if(vPaintId<${i+.5}){surfacePaint=texture2D(paintAtlas${i},vMapUv);surfaceEmission=surfacePaint.rgb*paintEmission${i};surfacePaint.rgb*=paintColor${i};organic=${m.name.endsWith('jungle')?'1.':'0.'};}\n`;
  });
  shader.fragmentShader=declarations+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',selection+'if(organic>.5&&min(surfacePaint.r,surfacePaint.b)-surfacePaint.g>.025)discard;\ndiffuseColor*=surfacePaint;');
  shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>','totalEmissiveRadiance=surfaceEmission;');
 };
 material.customProgramCacheKey=()=> 'ascension-static-painted-atlases-v1';
 const mesh=new THREE.Mesh(geometry,material);mesh.name='ascension_static_props_shared_paint';parts.forEach(p=>p.removeFromParent());root.add(mesh);
}
