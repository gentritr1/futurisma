/** Read machine state only; display copy and CSS transforms are not inputs.
 * @param {{device?:string,kind?:string,charge?:string}} power
 * @param {{deck?:string}} deck
 * @param {{transfer?:string}} transfer
 * @returns {{state:"held"|"active"|"perfect"|"empty",kind:"surge"|"shield"|null,charge:number,deck:"upper"|"lower"|"none",ready:boolean}}
 */
export function readAbilityAttributes(power, deck, transfer) {
  const state = (power.device === "held" || power.device === "active" || power.device === "perfect") ? power.device : "empty";
  const kind = power.kind === "surge" || power.kind === "shield" ? power.kind : null;
  const value = Number(power.charge);
  return {
    state,
    kind,
    charge: Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0,
    deck: deck.deck === "upper" || deck.deck === "lower" ? deck.deck : "none",
    ready: transfer.transfer === "ready",
  };
}
