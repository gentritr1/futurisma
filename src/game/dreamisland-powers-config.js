/** One non-solid phase field, at the watchtower tunnel mouth. The bore is the
 * corner, so the field is what makes the pinch a decision rather than a wall. */
export const DREAMISLAND_FIELDS=[
 {id:'watchtower-bore',progress:.330,lateral:0,halfWidth:3.8},
];
/** @type {import('./polarity-simulation.js').PowerCourseConfig} */
export const DREAMISLAND_ABILITY_CONFIG={id:'dream-island-powers-v1',allowGravity:false,transferWindows:[],
 pickups:[
  {id:'beach-turbine',progress:.045,lane:0,lateral:0,kind:'surge',charge:1},
  {id:'grove-projector',progress:.205,lane:0,lateral:-4,kind:'shield',charge:1},
  {id:'court-turbine',progress:.575,lane:0,lateral:4,kind:'surge',charge:1},
  {id:'reef-projector',progress:.715,lane:0,lateral:-5,kind:'shield',charge:1},
  {id:'cut-turbine',progress:.905,lane:0,lateral:0,kind:'surge',charge:1},
 ],
 launchZones:[{id:'beach-strip',from:.075,to:.095,lane:0},{id:'reef-strip',from:.700,to:.720,lane:0}],
 fieldIds:DREAMISLAND_FIELDS.map(f=>f.id),
};
/** @param {number} progress @param {number} lateral @param {number} length */
export function dreamislandFieldAt(progress,lateral,length){
 return DREAMISLAND_FIELDS.find(f=>Math.abs(((progress-f.progress+1.5)%1)-.5)*length<2.5&&Math.abs(lateral-f.lateral)<f.halfWidth);
}
