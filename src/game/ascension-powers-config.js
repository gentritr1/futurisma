/** Two non-solid phase fields; the first belongs exclusively to the trench. */
export const ASCENSION_FIELDS=[
 {id:'trench-exit',progress:.575,lateral:-6,halfWidth:3.8,trench:true},
 {id:'tank-farm',progress:.935,lateral:0,halfWidth:3.8,trench:false},
];
/** @type {import('./polarity-simulation.js').PowerCourseConfig} */
export const ASCENSION_ABILITY_CONFIG={id:'ascension-pad-powers-v1',allowGravity:false,
 pickups:[
  {id:'pad-turbine',progress:.04,lane:0,lateral:0,kind:'surge',charge:1},
  {id:'trench-projector',progress:.545,lane:0,lateral:-6,kind:'shield',charge:1},
  {id:'causeway-turbine',progress:.795,lane:0,lateral:0,kind:'surge',charge:1},
  {id:'tank-projector',progress:.91,lane:0,lateral:0,kind:'shield',charge:1},
 ],
 launchZones:[{id:'pad-road',from:.075,to:.095,lane:0},{id:'causeway',from:.815,to:.835,lane:0}],
 fieldIds:ASCENSION_FIELDS.map(f=>f.id),
};
/** @param {number} progress @param {number} lateral @param {number} length @param {boolean} trench */
export function ascensionFieldAt(progress,lateral,length,trench){
 return ASCENSION_FIELDS.find(f=>f.trench===trench&&Math.abs(((progress-f.progress+1.5)%1)-.5)*length<2.5&&Math.abs(lateral-f.lateral)<f.halfWidth);
}
