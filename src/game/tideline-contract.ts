import * as THREE from 'three';
export const TIDELINE_CENSUS_KEYS=['aqueductRibs','reactors','kelpBeds','mantas','portHalls','cranes','boats','flightLenses','pelagicCrowns','gantries','lightAnchors'] as const;
export function loadedTidelineCounts(root:THREE.Object3D){
 const census:Record<string,number>=Object.fromEntries(TIDELINE_CENSUS_KEYS.map(key=>[key,0]));let triangles=0,primitives=0;
 root.traverse(object=>{
  const kind=object.userData.tidelineInstanceKind;
  if(kind!==undefined){if(!TIDELINE_CENSUS_KEYS.includes(kind))throw Error(`Unknown Tideline instance: ${kind}`);census[kind]++;}
  if(object instanceof THREE.Mesh){primitives++;triangles+=(object.geometry.index?.count??object.geometry.getAttribute('position').count)/3*(object instanceof THREE.InstancedMesh?object.count:1);}
 });return {census,triangles,primitives};
}
export function assertTidelineContract(root:THREE.Object3D,manifest:{census:Record<string,number>;triangles:number;primitives:number}):void {
 const actual=loadedTidelineCounts(root);
 for(const key of TIDELINE_CENSUS_KEYS)if(actual.census[key]!==manifest.census[key])throw Error(`Tideline ${key}: manifest ${manifest.census[key]}, loaded ${actual.census[key]}.`);
 for(const key of ['triangles','primitives'] as const)if(actual[key]!==manifest[key])throw Error(`Tideline ${key}: manifest ${manifest[key]}, loaded ${actual[key]}.`);
}
