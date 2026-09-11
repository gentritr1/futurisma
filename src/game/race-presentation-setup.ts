import type * as THREE from 'three';
import type {TotemVehicle} from './totem';
import type {RivalFleet} from './rivals';
const VEHICLE_MODEL_URL='/assets/totem/models/totem_runtime.glb';
const RACE_PRESENCE_FX_ATLAS_URL='/assets/totem/textures/totem_race_presence_fx_256.png';
export async function loadVehicleForRace(vehicle:TotemVehicle,kind:string){
 const startedAt=performance.now();await vehicle.load(VEHICLE_MODEL_URL,RACE_PRESENCE_FX_ATLAS_URL,kind==='tideline'||kind==='ascension',kind==='ascension'?'/assets/ascension/power-kit.glb':undefined);
 const elapsed=performance.now()-startedAt;
 const resources=performance.getEntriesByName(new URL(VEHICLE_MODEL_URL,window.location.href).href,'resource');
 return {startedAt,elapsed,requests:resources.length,requestStart:resources[0]?.startTime??null};
}
export async function prepareTidelinePresentation(kind:string,reduced:boolean,scene:THREE.Scene,rivals:RivalFleet|null,...roots:THREE.Object3D[]):Promise<(()=>void)|null> {
 if(kind!=='tideline'&&kind!=='ascension'&&kind!=='dreamisland')return null;
 const {resolveAbilitySeed}=await import("./ability-seed");
 const {applyTidelineRenderRule,auditTidelineGameplayMaterials}=await import("./tideline-render-rule");
 await rivals?.enableTidelinePowers(resolveAbilitySeed(),reduced);
 if(kind==='ascension'||kind==='dreamisland')for(const root of [...roots,...(rivals?[rivals.root]:[])])root.traverse(object=>{
  // Glass and luminous lenses do not occlude sunlight. Keep solid hull shadows.
  if(/^(stabiliser_ring_emissive|emissive_static|canopy_glass|rival_totem_emissive_hull|rival_totem_glass_hull)$/.test(object.name))object.castShadow=false;
 });
 if(kind==='ascension'||kind==='dreamisland'){const ghost=scene.getObjectByName('totem_ghost_hull');if(ghost)roots.push(ghost);}
 const update=applyTidelineRenderRule(...roots,...(rivals?[rivals.root]:[]));auditTidelineGameplayMaterials(scene);return update;
}
