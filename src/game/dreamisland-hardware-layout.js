import * as THREE from 'three';

/** The grove device sits beyond its steep inner bank, on the flat shoulder.
 * These offsets decorate the route; the pickup triggers remain unchanged.
 * @param {number} halfWidth @param {number} triggerLateral @param {string} sector */
export function dreamIslandHardwareLateral(halfWidth,triggerLateral,sector=''){
 return (triggerLateral<0?-1:1)*(halfWidth+(/GROVE/.test(sector)?3.4:2.5));
}
/** Face the mechanism's front toward the road. @param {number} lateral */
export function dreamIslandHardwareYaw(lateral){return Math.sign(lateral)*Math.PI/2;}

/** Seat the foot on the actual painted sand triangles. The sand is the BR
 * jungle cell in uploaded texture space; foliage/bark hits are excluded.
 * @param {{position:THREE.Vector3,right:THREE.Vector3}} sample
 * @param {number} lateral @param {THREE.Object3D} world */
export function dreamIslandHardwareFoot(sample,lateral,world){
 const position=sample.position.clone().addScaledVector(sample.right,lateral);
 const ground=world.getObjectByName('DI_STATIC_DI_MAT_jungle');
 if(!ground)throw Error('Missing painted ground for power-kit placement');
 ground.updateWorldMatrix(true,false);
 const highest=new THREE.Box3().setFromObject(ground).max.y;
 const ray=new THREE.Raycaster(new THREE.Vector3(position.x,highest+1,position.z),new THREE.Vector3(0,-1,0));
 const hit=ray.intersectObject(ground).find(hit=>hit.uv&&hit.uv.x>.5&&hit.uv.y>.5);
 if(hit)position.y=hit.point.y;
 return {position,groundY:hit?.point.y??null};
}

/** A stone outrigger seats a device beside a pier where no sand exists.
 * Its top is flush with the deck and its inner edge starts at the road edge.
 * @param {{position:THREE.Vector3,right:THREE.Vector3,up:THREE.Vector3,tangent:THREE.Vector3,halfWidth:number}} sample
 * @param {number} lateral */
export function dreamIslandHardwareSupport(sample,lateral){
 const span=Math.abs(lateral)-sample.halfWidth+.48;
 const geometry=new THREE.BoxGeometry(span,.25,.96),uv=geometry.attributes.uv;
 // The same uploaded concrete/road-sand cell as the target plates.
 for(let i=0;i<uv.count;i++)uv.setXY(i,.004+uv.getX(i)*.492,.004+uv.getY(i)*.492);
 const position=sample.position.clone().addScaledVector(sample.right,Math.sign(lateral)*(sample.halfWidth+span/2))
  .addScaledVector(sample.up,-.125);
 const matrix=new THREE.Matrix4().makeBasis(sample.right,sample.up,sample.tangent.clone().negate()).setPosition(position);
 return {geometry,matrix,span};
}
