import { frameCard, formatCredits } from "./garage-catalog.js";
import { rewardFrame, rewardState } from "./garage-reward-rules.js";
import type { Garage } from "./garage-rules.js";

let offeredFrame: string | null = null;
let becameAffordable = false;

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag); element.className = className; element.textContent = text; return element;
}

export function beginRewardOffer(garage: Garage, previousBalance: number, demo: boolean): void {
  offeredFrame = demo ? null : rewardFrame(garage, previousBalance);
  becameAffordable = offeredFrame !== null && frameCard(offeredFrame).price > previousBalance;
  refreshRewardOffer(garage);
}

export function refreshRewardOffer(garage: Garage): void {
  const purse = document.getElementById("result-purse");
  const balance = purse?.querySelector(".purse__balance");
  if (balance) balance.textContent = `BALANCE ${formatCredits(garage.credits)}`;
  purse?.querySelector(".garage__reward")?.remove();
  if (!purse || !offeredFrame) return;
  const code = offeredFrame, card = frameCard(code), state = rewardState(garage, code);
  const offer = node("section", "garage__reward", "");
  offer.dataset.state = state.kind;
  offer.setAttribute("aria-label", "Your next craft");
  offer.append(node("h3", "", card.label), node("p", "garage__reward-state", state.kind === "owned" ? "IN YOUR FLEET"
    : state.kind === "licence" ? `${state.short} MORE CONTRACTS REQUIRED`
    : state.kind === "short" ? `${formatCredits(state.short)} SHORT`
    : becameAffordable ? "NOW AFFORDABLE" : "AFFORDABLE"));
  offer.append(node("p", "garage__reward-detail", state.kind === "owned" ? `${card.deck} · ${garage.chassis === code ? "ON THE GRID" : "READY TO RACE"}`
    : `${formatCredits(card.price)} · YOU HAVE ${formatCredits(garage.credits)} · NOT BOUGHT`));
  const action = node("button", "garage__button garage__primary", state.kind === "owned" ? "VIEW IN GARAGE" : state.kind === "affordable" ? `BUY ${card.label}` : "OPEN THE GARAGE");
  action.type = "button";
  action.addEventListener("click", () => {
    const garageButton = document.getElementById("result-garage-button");
    if (garageButton) { garageButton.dataset.frame = code; garageButton.click(); }
  });
  offer.append(action); purse.append(offer);
}
