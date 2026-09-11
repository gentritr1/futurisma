import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
/** Material/image contracts are validated on the original JSON separately.
 * Geometry-only parsing avoids inventing a browser image decoder in Node. */
export async function parseGeometry(bytes) {
 const size=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+size));
 for(const material of json.materials??[]){
  for(const key of ['normalTexture','occlusionTexture','emissiveTexture'])delete material[key];
  for(const key of ['baseColorTexture','metallicRoughnessTexture'])delete material.pbrMetallicRoughness?.[key];
 }
 delete json.images;delete json.textures;
 let encoded=Buffer.from(JSON.stringify(json));encoded=Buffer.concat([encoded,Buffer.alloc((4-encoded.length%4)%4,32)]);
 const tail=bytes.subarray(20+size),head=Buffer.alloc(20);
 head.writeUInt32LE(0x46546c67,0);head.writeUInt32LE(2,4);head.writeUInt32LE(20+encoded.length+tail.length,8);
 head.writeUInt32LE(encoded.length,12);head.writeUInt32LE(0x4e4f534a,16);
 const result=Buffer.concat([head,encoded,tail]);return new GLTFLoader().parseAsync(result.buffer.slice(result.byteOffset,result.byteOffset+result.byteLength),'');
}
