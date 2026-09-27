import { FRAME_CARDS, frameCard } from "./garage-catalog.js";

/** @param {import('./garage-rules.js').Garage} garage @param {number} previousBalance */
export function rewardFrame(garage, previousBalance) {
  const available = FRAME_CARDS.filter(card => card.price > 0 && !Object.hasOwn(garage.fleet, card.code) && garage.contracts.done >= card.licence);
  const newlyAffordable = available.filter(card => previousBalance < card.price && card.price <= garage.credits);
  const affordable = available.filter(card => card.price <= garage.credits);
  return [...(newlyAffordable.length ? newlyAffordable : affordable)].sort((a, b) => b.price - a.price)[0]?.code
    ?? available.sort((a, b) => a.price - b.price)[0]?.code ?? null;
}

/** An offer is a purchase opportunity, never an unlock or an automatic spend.
 * @param {import('./garage-rules.js').Garage} garage @param {string} code */
export function rewardState(garage, code) {
  const card = frameCard(code);
  if (Object.hasOwn(garage.fleet, code)) return {kind: "owned", short: 0};
  if (garage.contracts.done < card.licence) return {kind: "licence", short: card.licence - garage.contracts.done};
  const short = Math.max(0, card.price - garage.credits);
  return {kind: short ? "short" : "affordable", short};
}
