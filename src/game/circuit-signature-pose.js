/** Presentation only. Authored circuit state is the source of truth; these
 * poses never open a route, change grip, award a pickup or fire an attack.
 * @typedef {{waterLevel:number,draining:boolean,night:number,deluge:boolean,ceiling:boolean,flipping:boolean,relay:string,gravityBlend?:number}} SignatureSignals
 */
const clamp = (/** @type {number} */ value) => Math.max(0, Math.min(1, value));

/** @param {string} kind @param {number} seconds @param {boolean} reduced
 * @param {SignatureSignals} signals */
export function circuitSignaturePose(kind, seconds, reduced, signals) {
  const time = reduced ? 0 : seconds;
  const water = clamp((signals.waterLevel + 27) / 27);
  const night = clamp(signals.night);
  const relay = signals.relay === 'idle' ? 0 : signals.relay === 'cooldown' ? .3 : signals.relay === 'strike' ? 1 : .65;
  const gravity = clamp(signals.gravityBlend ?? Number(signals.ceiling));
  return {
    time,
    planeBob: Math.sin(time * .75) * .13,
    planeRoll: Math.sin(time * .52) * .012,
    wheelAngle: time * .18,
    washerAngle: time * 1.2,
    gravityTilt: .48-.96*(reduced ? Number(gravity >= .5) : gravity),
    rovLift: water * 2.6,
    domeOpen: night * 5.8,
    valveAngle: signals.deluge ? Math.PI * .5 : 0,
    fanAngle: time * 2.2,
    bladeAngle: Math.sin(time * .3) * .04,
    status: kind === 'polarity' ? signals.flipping ? 'TRANSFERRING' : signals.ceiling ? 'UPPER EXPRESS' : 'LOWER POWER'
      : kind === 'tideline' ? signals.draining ? 'DRAINING' : water > .8 ? 'SUBMERGED SURVEY' : 'DRY DOCK'
      : kind === 'ascension' ? signals.deluge ? 'DELUGE FEED ACTIVE' : 'RESERVOIR STANDBY'
      : kind === 'dreamisland' ? night > .5 ? 'NIGHT OBSERVATION' : 'DAY SHELTER'
      : kind === 'afterglow' ? `RELAY ${signals.relay.toUpperCase()}`
      : kind === 'greenwater' ? 'MARSH SURVEY CREW'
      : kind === 'bitterpan' ? 'SALT RECOVERY LINE'
      : kind === 'nightshift' ? 'NIGHT CREW / OPEN 24H' : 'WINTER ROAD SERVICE',
    alert: kind === 'afterglow' && signals.relay === 'strike',
    active: kind === 'ascension' ? signals.deluge : kind === 'tideline' ? signals.draining : kind === 'dreamisland' ? night > .5 : kind === 'polarity' ? signals.flipping : relay > 0,
  };
}
