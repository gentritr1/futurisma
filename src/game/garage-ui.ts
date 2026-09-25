/**
 * Garage — the works bay. Four tabs over one save: CRAFT (buy and choose a
 * frame), PARTS (stage the frame on the grid), PAINT (lights, boost flame,
 * underglow) and CONTRACTS (the board that sends the driver round all seven
 * circuits).
 *
 * Lazy: `main.ts` imports this on the first GARAGE press, so none of it is in
 * the initial shell. It is built node by node with the DOM API, because
 * string-to-markup sinks are banned tree-wide (`validate-security.mjs`), and
 * it speaks the service terminal's vocabulary — `.intro-panel`, `.chip`,
 * `.ghost-button`, `.dispatch__key` — with `style-garage.css` adding only what
 * those do not already cover.
 *
 * Every purchase is a pure transaction in `garage-economy.js`; this module
 * renders, commits the returned garage through `save.setGarage`, and asks the
 * game to refit. The craft behind the panel changes as the driver browses:
 * viewing a frame in the showroom previews its stance and signature colours on
 * the real TOTEM, and leaving the tab puts the fitted craft back.
 *
 * Modal the way the service terminal is (`menu-navigation.ts`): a capture
 * listener keeps every key from reaching the race loop while the bay is open,
 * keys aimed at the panel reach the panel, and Escape closes.
 */
import {
  FRAME_CARDS,
  PAINT_CARDS,
  PAINT_SLOTS,
  PART_CARDS,
  SCRAP_PRICE,
  STAT_ROWS,
  frameCard,
  formatCredits,
  paintCard,
  resolvePaint,
  statFill,
} from "./garage-catalog.js";
import {
  buyFrame,
  buyPart,
  contractFor,
  describeContract,
  fitPaint,
  scrapContract,
  selectFrame,
  type Contract,
  type Transaction,
} from "./garage-economy.js";
import {
  MAX_PART_STAGE,
  PARTS,
  defaultFit,
  handlingFor,
  type Garage,
  type Handling,
} from "./garage-rules.js";
import type { GarageStore } from "./garage-purse";

/**
 * Everything the bay needs from the running page. Handed over by `main.ts`
 * rather than imported, for the reason `garage-purse.ts` gives: a lazy chunk
 * that imported the save, the format or the circuit table would split those
 * modules out of the entry chunk.
 */
export interface GarageHooks {
  /** Re-installs the saved craft's handling and puts a look on the TOTEM. */
  refit(previewFrame: string | null): void;
  /** Drops any action the bay just swallowed before the game sees it. */
  suspendInput(): void;
  /** `save` from `persistence.ts`. */
  save: GarageStore & {
    setTrack(track: string): string;
    setRaceMode(mode: string): string;
    setTier(tier: string): string;
  };
  /** The circuit, format and field this page was loaded for. */
  here: { track: string; mode: string; tier: string };
  /** `TRACKS` from `map-selection.ts`, for the contract board's circuit lines. */
  tracks: readonly { selection: string; label: string; mapCode: string }[];
}

type Tab = "craft" | "parts" | "paint" | "contracts";
const TABS: readonly { code: Tab; label: string }[] = [
  { code: "craft", label: "CRAFT" },
  { code: "parts", label: "PARTS" },
  { code: "paint", label: "PAINT" },
  { code: "contracts", label: "CONTRACTS" },
];
const TIER_ORDER = ["rookie", "works", "feral"];
const ROMAN = ["", "I", "II", "III"];

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function button(className: string, key: string, onClick: () => void): HTMLButtonElement {
  const element = node("button", className);
  element.type = "button";
  element.dataset.key = key;
  element.addEventListener("click", onClick);
  return element;
}

function hexColor(hex: number): string {
  return `#${hex.toString(16).padStart(6, "0")}`;
}

/** The whole fitted handling of one frame, as it would race today. */
function frameHandling(garage: Garage, code: string): Readonly<Handling> {
  return handlingFor({
    ...garage,
    chassis: code,
    fleet: { ...garage.fleet, [code]: garage.fleet[code] ?? defaultFit() },
  });
}

export class GarageScreen {
  private readonly screen = node("section", "screen screen--garage");
  private readonly credits = node("strong", "garage__credits");
  private readonly tabButtons: HTMLButtonElement[] = [];
  private readonly body = node("div", "garage__body");
  private readonly note = node("p", "garage__note");
  private readonly closeButton: HTMLButtonElement;
  private tab: Tab = "craft";
  private viewed = "totem";
  private returnFocus: HTMLElement | null = null;
  private opened = false;

  constructor(private readonly hooks: GarageHooks) {
    this.screen.id = "garage-screen";
    this.screen.hidden = true;
    this.screen.setAttribute("aria-label", "Garage");
    const panel = node("div", "intro-panel options-panel garage");
    const code = node("p", "intro-code", "KAIRO DYNAMICS · KD-0714 · WORKS BAY");
    const head = node("div", "garage__head");
    head.append(node("h2", "options-title", "GARAGE"), this.credits);
    const tabs = node("div", "garage__tabs");
    tabs.setAttribute("role", "tablist");
    for (const [index, entry] of TABS.entries()) {
      const tab = button("chip garage__tab", `tab-${entry.code}`, () => this.showTab(entry.code));
      tab.setAttribute("role", "tab");
      tab.append(node("strong", "", entry.label), node("small", "", String(index + 1)));
      this.tabButtons.push(tab);
      tabs.append(tab);
    }
    tabs.addEventListener("keydown", this.handleTabKeys);
    this.body.setAttribute("role", "tabpanel");
    this.note.setAttribute("role", "status");
    this.closeButton = button("ghost-button", "close", () => this.hide());
    this.closeButton.id = "garage-close";
    const back = node("kbd");
    back.dataset.prompt = "back";
    // The service terminal's own ESC keycap is kept current by `input-prompts`,
    // so it is the label for the active device; a device change afterwards
    // re-labels this one too, because it carries the same `data-prompt`.
    back.textContent = document.querySelector('kbd[data-prompt="back"]')?.textContent || "ESC";
    this.closeButton.append(node("span", "", "RETURN TO PADDOCK"), back);
    panel.append(code, head, tabs, this.body, this.note, this.closeButton);
    this.screen.append(panel);
    this.screen.addEventListener("keydown", this.handlePanelKeys);
    (document.getElementById("app") ?? document.body).append(this.screen);
    window.addEventListener("keydown", this.handleWindowKeys, { capture: true });
  }

  get isOpen(): boolean {
    return this.opened;
  }

  show(tab: Tab = this.tab): void {
    if (!this.opened) {
      this.returnFocus = document.activeElement as HTMLElement | null;
      this.viewed = this.hooks.save.garage.chassis;
      this.opened = true;
      this.screen.hidden = false;
      document.body.dataset.garage = "true";
      this.hooks.suspendInput();
    }
    this.setNote("", "idle");
    this.showTab(tab);
    this.tabButtons[TABS.findIndex((entry) => entry.code === this.tab)]?.focus({ preventScroll: true });
  }

  hide(): void {
    if (!this.opened) return;
    this.opened = false;
    this.screen.hidden = true;
    document.body.dataset.garage = "false";
    this.hooks.refit(null);
    this.hooks.suspendInput();
    this.returnFocus?.focus({ preventScroll: true });
    this.returnFocus = null;
  }

  dispose(): void {
    window.removeEventListener("keydown", this.handleWindowKeys, { capture: true });
    this.screen.remove();
    delete document.body.dataset.garage;
  }

  private showTab(tab: Tab): void {
    this.tab = tab;
    for (const [index, entry] of TABS.entries()) {
      const selected = entry.code === tab;
      this.tabButtons[index].setAttribute("aria-selected", String(selected));
      this.tabButtons[index].setAttribute("aria-checked", String(selected));
      this.tabButtons[index].tabIndex = selected ? 0 : -1;
    }
    // The showroom previews the frame being looked at; every other tab shows
    // the craft that will actually race.
    this.hooks.refit(tab === "craft" && this.viewed !== this.hooks.save.garage.chassis ? this.viewed : null);
    this.render();
  }

  private render(): void {
    const focusKey = (document.activeElement as HTMLElement | null)?.dataset.key ?? null;
    const garage = this.hooks.save.garage;
    this.credits.textContent = formatCredits(garage.credits);
    const walletLine = document.getElementById("garage-credits");
    if (walletLine) walletLine.textContent = formatCredits(garage.credits);
    this.body.replaceChildren(
      ...(this.tab === "craft" ? this.renderCraft(garage)
        : this.tab === "parts" ? this.renderParts(garage)
        : this.tab === "paint" ? this.renderPaint(garage)
        : this.renderContracts(garage)),
    );
    if (focusKey) {
      const target = this.screen.querySelector<HTMLElement>(`[data-key="${focusKey}"]`);
      if (target && !target.hasAttribute("disabled")) target.focus({ preventScroll: true });
      else this.tabButtons[TABS.findIndex((entry) => entry.code === this.tab)]?.focus({ preventScroll: true });
    }
  }

  private stats(handling: Readonly<Handling>, reference: Readonly<Handling> | null): HTMLElement {
    const list = node("dl", "garage__stats");
    for (const row of STAT_ROWS) {
      const item = node("div", "garage__stat");
      const bar = node("span", "garage__bar");
      const fill = node("i", "garage__fill");
      fill.style.setProperty("--fill", statFill(row.stat, handling[row.stat]).toFixed(3));
      bar.append(fill);
      if (reference) {
        const mark = node("b", "garage__mark");
        mark.style.setProperty("--fill", statFill(row.stat, reference[row.stat]).toFixed(3));
        bar.append(mark);
      }
      const delta = Math.round((handling[row.stat] - 1) * 1000) / 10;
      const value = node("span", "garage__stat-value", delta === 0 ? "WORKS" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)}%`);
      value.dataset.tone = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
      const term = node("dt", "", row.label);
      const detail = node("dd");
      detail.append(bar, value);
      item.append(term, detail);
      list.append(item);
    }
    return list;
  }

  private renderCraft(garage: Garage): HTMLElement[] {
    const frames = node("div", "garage__frames");
    for (const card of FRAME_CARDS) {
      const owned = Object.hasOwn(garage.fleet, card.code);
      const entry = button("chip garage__frame", `frame-${card.code}`, () => {
        this.viewed = card.code;
        this.setNote("", "idle");
        this.showTab("craft");
      });
      entry.setAttribute("aria-pressed", String(this.viewed === card.code));
      entry.dataset.state = garage.chassis === card.code ? "grid" : owned ? "owned" : "shop";
      entry.append(
        node("strong", "", card.label),
        node("small", "", card.deck),
        node("span", "garage__tag", garage.chassis === card.code ? "ON THE GRID"
          : owned ? "IN THE BAY"
          : garage.contracts.done < card.licence ? `LICENCE ${garage.contracts.done}/${card.licence}`
          : formatCredits(card.price)),
      );
      frames.append(entry);
    }
    const card = frameCard(this.viewed);
    const owned = Object.hasOwn(garage.fleet, card.code);
    const detail = node("div", "garage__card");
    detail.append(
      node("p", "garage__card-title", `${card.label} · ${card.deck}`),
      node("p", "garage__card-note", card.note),
      this.stats(frameHandling(garage, card.code), card.code === garage.chassis ? null : handlingFor(garage)),
    );
    if (card.code !== garage.chassis) {
      const action = button("launch-button garage__action", "frame-action", () => {
        this.commit(owned ? selectFrame(this.hooks.save.garage, card.code) : buyFrame(this.hooks.save.garage, card.code),
          owned ? `${card.label} ON THE GRID` : `${card.label} SIGNED · ON THE GRID`);
      });
      action.append(node("span", "", owned ? "PUT ON THE GRID" : `BUY · ${formatCredits(card.price)}`));
      detail.append(action);
    } else {
      detail.append(node("p", "garage__card-grid", "ON THE GRID · THE MARK ON EACH BAR IS THIS FRAME"));
    }
    return [frames, detail];
  }

  private renderParts(garage: Garage): HTMLElement[] {
    const fit = garage.fleet[garage.chassis] ?? defaultFit();
    const title = node("p", "garage__card-title", `${frameCard(garage.chassis).label} · FITTED PARTS`);
    const list = node("ul", "garage__parts");
    for (const card of PART_CARDS) {
      const part = PARTS.find((entry) => entry.code === card.code);
      const stage = fit.parts[card.code as keyof typeof fit.parts];
      const row = node("li", "garage__part");
      const name = node("span", "garage__part-name");
      name.append(
        node("strong", "", card.label),
        node("small", "", `${card.stat} +${Math.round((part?.step ?? 0) * 1000) / 10}% PER STAGE`),
      );
      const pips = node("span", "garage__pips");
      pips.setAttribute("aria-label", `STAGE ${stage} OF ${MAX_PART_STAGE}`);
      for (let index = 0; index < MAX_PART_STAGE; index += 1) {
        const pip = node("i");
        pip.dataset.on = String(index < stage);
        pips.append(pip);
      }
      const maxed = stage >= MAX_PART_STAGE;
      const action = button("chip garage__buy", `part-${card.code}`, () => {
        this.commit(buyPart(this.hooks.save.garage, card.code), `${card.label} STAGE ${ROMAN[stage + 1]} FITTED`);
      });
      action.append(node("strong", "", maxed ? "MAXED" : `STAGE ${ROMAN[stage + 1]}`));
      if (!maxed) action.append(node("small", "", formatCredits(card.prices[stage])));
      action.disabled = maxed;
      row.append(name, pips, action);
      list.append(row);
    }
    return [title, this.stats(handlingFor(garage), null), list];
  }

  private renderPaint(garage: Garage): HTMLElement[] {
    const fit = garage.fleet[garage.chassis] ?? defaultFit();
    const title = node("p", "garage__card-title", `${frameCard(garage.chassis).label} · PAINT SHOP`);
    const hint = node("p", "garage__card-note", "A COLOUR IS BOUGHT ONCE AND FITS ANY SLOT ON ANY FRAME");
    const slots = PAINT_SLOTS.map((slot) => {
      const row = node("div", "dispatch__row garage__slot");
      const key = node("span", "dispatch__key", slot.label);
      const chips = node("div", "chip-row garage__paints");
      for (const paint of PAINT_CARDS) {
        if (slot.code === "under" ? paint.code === "stock" : paint.code === "off") continue;
        const owned = garage.paints.includes(paint.code);
        const chip = button("chip garage__paint", `paint-${slot.code}-${paint.code}`, () => {
          this.commit(fitPaint(this.hooks.save.garage, slot.code, paint.code),
            owned ? `${slot.label} · ${paint.label}` : `${paint.label} BOUGHT · ${slot.label}`);
        });
        chip.setAttribute("role", "radio");
        chip.setAttribute("aria-checked", String(fit[slot.code] === paint.code));
        const swatch = node("i", "garage__swatch");
        const shown = resolvePaint(garage.chassis, slot.code, paint.code);
        if (shown !== null) swatch.style.setProperty("--swatch", hexColor(shown));
        else swatch.dataset.swatch = paint.code === "off" ? "off" : "works";
        chip.append(swatch, node("strong", "", paint.label), node("small", "", owned ? "OWNED" : formatCredits(paintCard(paint.code).price)));
        chips.append(chip);
      }
      row.append(key, chips);
      return row;
    });
    return [title, hint, ...slots];
  }

  private renderContracts(garage: Garage): HTMLElement[] {
    const here = this.hooks.here.track;
    const list = node("ol", "garage__contracts");
    for (const [slot, serial] of garage.contracts.active.entries()) {
      const contract = contractFor(serial);
      const track = this.hooks.tracks.find((entry) => entry.selection === contract.track);
      const item = node("li", "garage__contract");
      item.dataset.here = String(contract.track === here);
      const actions = node("div", "garage__contract-actions");
      const go = button("chip garage__go", `contract-go-${slot}`, () => this.dispatch(contract));
      go.append(node("strong", "", contract.track === here ? "RACE IT HERE" : "DISPATCH"));
      const scrap = button("chip garage__scrap", `contract-scrap-${slot}`, () => {
        this.commit(scrapContract(this.hooks.save.garage, slot), "CONTRACT SCRAPPED · NEXT ONE DEALT");
      });
      scrap.append(node("strong", "", "SCRAP"), node("small", "", formatCredits(SCRAP_PRICE)));
      actions.append(go, scrap);
      item.append(
        node("p", "garage__contract-where", `${track?.mapCode ?? ""} · ${track?.label ?? contract.track.toUpperCase()}`),
        node("p", "garage__contract-goal", describeContract(contract)),
        node("p", "garage__contract-pay", `+ ${formatCredits(contract.reward)}`),
        actions,
      );
      list.append(item);
    }
    const halo = frameCard("halo");
    const done = garage.contracts.done;
    const logged = garage.circuits.length;
    const footer = node("p", "garage__card-note",
      `${done} CLOSED · ${halo.label} LICENCE ${Math.min(done, halo.licence)}/${halo.licence} · ${logged}/${this.hooks.tracks.length} CIRCUITS LOGGED`);
    return [list, footer];
  }

  /**
   * Sends the driver to a contract's circuit with a format and field that can
   * close it. The choices are stored before navigating, as the dispatch sheet
   * does, and a contract for the circuit already loaded just closes the bay.
   */
  private dispatch(contract: Contract): void {
    const mode = contract.mode === "field"
      ? (this.hooks.here.mode === "timeattack" ? "race" : this.hooks.here.mode)
      : contract.mode ?? this.hooks.here.mode;
    const tier = contract.tier && TIER_ORDER.indexOf(this.hooks.here.tier) < TIER_ORDER.indexOf(contract.tier)
      ? contract.tier
      : this.hooks.here.tier;
    this.hooks.save.setTrack(contract.track);
    this.hooks.save.setRaceMode(mode);
    this.hooks.save.setTier(tier);
    if (contract.track === this.hooks.here.track && mode === this.hooks.here.mode && tier === this.hooks.here.tier) {
      this.hide();
      if (document.body.dataset.phase === "intro") document.getElementById("start-button")?.focus({ preventScroll: true });
      return;
    }
    const parameters = new URLSearchParams(window.location.search);
    parameters.set("map", contract.track);
    parameters.set("mode", mode);
    parameters.set("tier", tier);
    parameters.delete("demo");
    window.location.search = parameters.toString();
  }

  private commit(result: Transaction, success: string): void {
    if (result.ok) {
      this.hooks.save.setGarage(result.garage);
      if (this.tab === "craft") this.viewed = this.hooks.save.garage.chassis;
      this.setNote(result.spent > 0 ? `${success} · −${formatCredits(result.spent)}` : success, "ok");
      this.showTab(this.tab);
      return;
    }
    const garage = this.hooks.save.garage;
    const card = frameCard(this.viewed);
    this.setNote(
      result.reason === "credits" ? `NOT ENOUGH CREDITS · ${formatCredits(garage.credits)} IN THE BANK`
        : result.reason === "licence" ? `${card.label} NEEDS ${card.licence} CONTRACTS ON FILE · ${garage.contracts.done} SO FAR`
        : result.reason === "maxed" ? "STAGE III IS THE LAST STAGE"
        : "NOT AVAILABLE",
      "refused",
    );
  }

  private setNote(text: string, tone: "idle" | "ok" | "refused"): void {
    this.note.textContent = text || "PREVIEW ON THE CRAFT BEHIND THIS PANEL · CHANGES SAVE AS YOU MAKE THEM";
    this.note.dataset.tone = tone;
  }

  private readonly handleTabKeys = (event: KeyboardEvent): void => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const index = TABS.findIndex((entry) => entry.code === this.tab);
    const next = TABS[(index + step + TABS.length) % TABS.length].code;
    this.showTab(next);
    this.tabButtons[TABS.findIndex((entry) => entry.code === next)]?.focus({ preventScroll: true });
  };

  /** Keys aimed at the panel stay in the panel; Tab still moves focus. */
  private readonly handlePanelKeys = (event: KeyboardEvent): void => {
    const digit = Number(event.key);
    if (Number.isInteger(digit) && digit >= 1 && digit <= TABS.length && !event.repeat) {
      this.showTab(TABS[digit - 1].code);
      this.tabButtons[digit - 1]?.focus({ preventScroll: true });
    }
    if (event.key !== "Tab") event.stopPropagation();
  };

  private readonly handleWindowKeys = (event: KeyboardEvent): void => {
    if (!this.opened) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.hide();
      return;
    }
    if (event.target instanceof Node && this.screen.contains(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
  };
}
