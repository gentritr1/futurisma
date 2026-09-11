import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parseGeometry} from './lib/glb-geometry.mjs';
import {typescriptModuleUrl} from './lib/typescript-module.mjs';
const {loadedTidelineCounts}=await import(await typescriptModuleUrl(new URL('../src/game/tideline-contract.ts',import.meta.url)));
const bytes=await readFile(new URL('../public/assets/tideline-foundry/foundry_world.glb',import.meta.url));
const gltf=await parseGeometry(bytes),counts=loadedTidelineCounts(gltf.scene);
const manifest={name:'Tideline / Pump Works',schemaVersion:1,status:'playable',model:'/assets/tideline-foundry/foundry_world.glb',sha256:createHash('sha256').update(bytes).digest('hex'),...counts,source:'scripts/regenerate-tideline-manifest.mjs',semantics:'Counts derive from instance anchors exported alongside merged geometry; mesh and triangle counts are measured from the parsed GLB.'};
await writeFile(new URL('../public/assets/tideline/manifest.json',import.meta.url),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify(manifest));
