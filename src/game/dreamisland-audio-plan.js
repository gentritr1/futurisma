export const DREAMISLAND_AUDIO_CLIPS=['clock-quarter-chime','clock-strike-three-tolls','waterfall-loop','fish-rise','tunnel-pass','day-birds'];
/** Motion reduction changes presentation, never the audio ramp.
 * @param {number} tick @param {{strikeTick:number,nightRampTicks:number}|null} config */
export function dreamIslandAudioNightBlend(tick,config){
 const t=config?Math.max(0,Math.min(1,(tick-config.strikeTick)/config.nightRampTicks)):0;
 return t*t*(3-2*t);
}
