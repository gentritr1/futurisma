/**
 * Garage — settles a finished race into the garage and prints the purse on
 * the result screen.
 *
 * Reached only through `meta-runtime.ts`, which warms this chunk after first
 * paint so the finish line can settle in the same frame the classification
 * locks. The arithmetic is `settleRace` in `garage-economy.js`; this module
 * owns the impure steps around it — the save write and the DOM.
 *
 * The save store and the circuit arrive as arguments rather than imports. A
 * lazy chunk that imported `persistence.ts` would make the bundler split the
 * save module (and everything under it) out of the entry chunk into a shared
 * one; handing them over keeps the initial shell exactly as it was chunked.
 *
 * The result screen's own stats (G4) answer "how was the race"; the purse
 * answers "what did it buy", so it sits under them and reads in the same
 * mono dispatch voice: itemised lines, a total, the balance.
 */
import { formatCredits } from "./garage-catalog.js";
import { settleRace, type RaceFacts, type Settlement } from "./garage-economy.js";
import type { Garage } from "./garage-rules.js";
import type { RaceResultInputs, RaceResultSummary } from "./race-modes";

/** The two save calls the purse makes. `save` in `persistence.ts` is one. */
export interface GarageStore {
  readonly garage: Garage;
  setGarage(next: unknown): Garage;
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ""): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  if (text) element.textContent = text;
  return element;
}

/** The race as the economy sees it: only facts the race already measured. */
export function raceFacts(summary: RaceResultSummary, inputs: RaceResultInputs, laps: number, track: string): RaceFacts | null {
  const finish = inputs.finish;
  if (!finish) return null;
  return {
    track,
    mode: summary.mode,
    tier: summary.tier,
    position: finish.position,
    racerCount: finish.racerCount,
    laps,
    newBestLap: summary.newBestLap,
    topSpeedKph: summary.topSpeedKph,
    nearMisses: summary.nearMisses,
    cleanGateChain: summary.cleanGateChain,
    slipstreamSeconds: summary.slipstreamSeconds,
    driftCashes: finish.driftCashes,
    demo: finish.demo,
  };
}

function renderPurse(settlement: Settlement, balance: number): void {
  const panel = document.getElementById("result-purse");
  if (!panel) return;
  const head = node("p", "purse__head");
  head.append(node("span", "purse__key", "PURSE"));
  if (settlement.demo) {
    head.append(node("strong", "purse__total", "AUTOPILOT RUN · NO PURSE"));
    panel.replaceChildren(head);
    panel.hidden = false;
    return;
  }
  head.append(node("strong", "purse__total", `+ ${formatCredits(settlement.total)}`));
  const list = node("ul", "purse__lines");
  for (const line of settlement.lines) {
    const row = node("li", "purse__line");
    row.dataset.code = line.code;
    row.append(node("span", "", line.label), node("b", "", `+${line.amount.toLocaleString("en-US")}`));
    list.append(row);
  }
  const foot = node("p", "purse__foot");
  foot.append(
    node("span", "", settlement.completed.length > 0
      ? `${settlement.completed.length} CONTRACT${settlement.completed.length === 1 ? "" : "S"} CLOSED`
      : "OPEN THE GARAGE TO SPEND"),
    node("span", "purse__balance", `BALANCE ${formatCredits(balance)}`),
  );
  panel.replaceChildren(head, list, foot);
  panel.dataset.contract = String(settlement.completed.length > 0);
  panel.hidden = false;
}

/**
 * Settles one finish: purse, first-circuit bonus and contracts, written once.
 * Non-fatal end to end — the purse is a reward for the race, never a way to
 * lose the result screen — so any throw is swallowed after the write it
 * failed to make.
 */
export function settleFinish(
  summary: RaceResultSummary,
  inputs: RaceResultInputs,
  laps: number,
  save: GarageStore,
  track: string,
): void {
  try {
    const facts = raceFacts(summary, inputs, laps, track);
    if (!facts) return;
    const settlement = settleRace(save.garage, facts);
    const stored = settlement.demo ? save.garage : save.setGarage(settlement.garage);
    renderPurse(settlement, stored.credits);
    const credits = document.getElementById("garage-credits");
    if (credits) credits.textContent = formatCredits(stored.credits);
  } catch (error) {
    console.warn("The purse could not be settled.", error);
  }
}
