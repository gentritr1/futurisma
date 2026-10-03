import { frameCard, formatCredits } from "./garage-catalog.js";
import { rewardFrame, rewardState } from "./garage-reward-rules.js";
import type { Garage } from "./garage-rules.js";

let offeredFrame: string | null = null;
let becameAffordable = false;

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

export function beginRewardOffer(garage: Garage, previousBalance: number, demo: boolean): void {
  offeredFrame = demo ? null : rewardFrame(garage, previousBalance);
  becameAffordable = offeredFrame !== null && frameCard(offeredFrame).price > previousBalance;
  refreshRewardOffer(garage);
}

/** Savings are feedback; the result footer owns the single route to the garage. */
export function refreshRewardOffer(garage: Garage): void {
  const purse = document.getElementById("result-purse");
  const balance = purse?.querySelector(".purse__balance");
  if (balance) balance.textContent = `BALANCE ${formatCredits(garage.credits)}`;
  purse?.querySelector(".garage__reward")?.remove();
  const garageButton = document.getElementById("result-garage-button");
  if (garageButton) {
    if (offeredFrame) garageButton.dataset.frame = offeredFrame;
    else delete garageButton.dataset.frame;
  }
  if (!purse || !offeredFrame) return;
  const card = frameCard(offeredFrame), state = rewardState(garage, offeredFrame);
  const offer = node("section", "garage__reward", "");
  offer.dataset.state = state.kind;
  offer.setAttribute("aria-label", "Your next craft");
  offer.append(node("h3", "", card.label));
  const status = state.kind === "owned" ? "IN YOUR FLEET"
    : state.kind === "licence" ? `${state.short} MORE CONTRACTS TO UNLOCK`
    : state.kind === "short" ? "SAVING FOR YOUR NEXT CRAFT"
    : becameAffordable ? "NOW AVAILABLE IN GARAGE" : "AVAILABLE IN GARAGE";
  offer.append(node("p", "garage__reward-state", status));
  if (state.kind !== "owned") {
    const progress = document.createElement("progress");
    progress.className = "garage__reward-progress";
    progress.max = Math.max(1, card.price);
    progress.value = Math.min(garage.credits, card.price);
    progress.setAttribute("aria-label", `${card.label} savings`);
    offer.append(progress, node("p", "garage__reward-detail", `${formatCredits(garage.credits)} saved / ${formatCredits(card.price)}`));
  } else {
    offer.append(node("p", "garage__reward-detail", garage.chassis === offeredFrame ? "ON THE GRID" : "READY TO RACE"));
  }
  purse.append(offer);
}
