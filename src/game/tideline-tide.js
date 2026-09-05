/** Published, race-wide schedule. Extra laps stay drained; sprint stops after ebb. */
export const TIDE_SCHEDULE = Object.freeze([
  Object.freeze({lap:1,id:"flood",label:"FLOODED",waterLevel:0,grip:1,current:true,shortcut:false}),
  Object.freeze({lap:2,id:"ebb",label:"DRAINING / DAMP DECK",waterLevel:-15,grip:.7,current:false,shortcut:false}),
  Object.freeze({lap:3,id:"dry",label:"DRAINED / PUMP HALL OPEN",waterLevel:-27,grip:.94,current:false,shortcut:true}),
]);
export const TIDE_DRAIN_SECONDS=5;
/** @param {number} lap */
export function tideForLap(lap) {return TIDE_SCHEDULE[Math.min(2,Math.max(0,Math.floor(lap)-1))];}
/** Deterministic water position, driven only by race ticks. @param {number} lap @param {number} seconds */
export function tideWaterLevel(lap,seconds) {
 const target=tideForLap(lap).waterLevel;
 if(lap<=1||lap>3)return target;
 const before=tideForLap(lap-1).waterLevel;
 const a=Math.min(1,Math.max(0,seconds/TIDE_DRAIN_SECONDS));
 return before+(target-before)*a*a*(3-2*a);
}
/** Grip cost belongs to the damp reactor, never the dry port. @param {number} lap @param {number} height @param {number} lateral @param {number} [waterLevel] */
export function tideGrip(lap,height,lateral,waterLevel=tideForLap(lap).waterLevel) {
 if(height>-3 || (height+1<waterLevel))return 1;
 return tideForLap(lap).grip+(lap===2&&Math.abs(lateral)<2?.12:0);
}
