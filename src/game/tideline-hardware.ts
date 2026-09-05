import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

export function hardwareAtlas(role: 'metal'|'signage'|'emissive'): THREE.Texture | null {
  if(typeof Image==='undefined')return null;
  const texture=new THREE.TextureLoader().load(`/assets/power-kit-v2/textures/${role}.jpg`);
  texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;return texture;
}
export function atlasTile(geometry: THREE.BufferGeometry,tile:number): THREE.BufferGeometry {
  const uv=geometry.getAttribute('uv');
  for(let i=0;i<uv.count;i++)uv.setXY(i,(tile%2)*.5+.015+uv.getX(i)*.47,(1-Math.floor(tile/2))*.5+.015+uv.getY(i)*.47);
  return geometry;
}
export function hardwareMaterial(map:THREE.Texture|null,color=0xffffff,emission=0):THREE.MeshLambertMaterial {
  const material=new THREE.MeshLambertMaterial({map,color,emissive:color,emissiveMap:map,emissiveIntensity:emission});
  material.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\n#ifdef USE_COLOR\ntotalEmissiveRadiance *= vColor.rgb;\n#endif');};
  return material;
}
/** Static parts share one draw; moving mechanisms remain separate named pivots. */
export class HardwareBatch {
  private readonly parts: THREE.BufferGeometry[]=[];
  box(x:number,y:number,z:number,w:number,h:number,d:number,tile=0):void {
    this.parts.push(atlasTile(new THREE.BoxGeometry(w,h,d),tile).translate(x,y,z));
  }
  beam(a:THREE.Vector3,b:THREE.Vector3,width:number,tile=0):void {
    const geometry=atlasTile(new THREE.BoxGeometry(width,a.distanceTo(b),width),tile);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),b.clone().sub(a).normalize()));
    geometry.translate((a.x+b.x)/2,(a.y+b.y)/2,(a.z+b.z)/2);this.parts.push(geometry);
  }
  add(geometry:THREE.BufferGeometry):void {this.parts.push(geometry);}
  mesh(name:string,material:THREE.Material):THREE.Mesh {
    const geometry=mergeGeometries(this.parts);if(!geometry)throw Error(`Empty hardware batch: ${name}`);
    for(const part of this.parts)part.dispose();this.parts.length=0;
    const mesh=new THREE.Mesh(geometry,material);mesh.name=name;mesh.receiveShadow=true;mesh.userData.tidelineGameplay=true;return mesh;
  }
}
