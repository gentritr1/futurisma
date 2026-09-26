/**
 * Garage — the works bay. Five tabs over one save: CRAFT (buy and choose a
 * frame), PARTS (stage the frame on the grid), PAINT (body paint, lights,
 * boost flame, underglow and its pattern), CONTRACTS (the board that sends the
 * driver round all seven circuits) and DAILY (the day's three jobs, the week's
 * one and the streak).
 *
 * Nothing in the paint shop is bought blind: pointing at a finish, or tabbing
 * onto it, shows it on the craft behind the panel from a trial garage; the
 * click is the purchase, and leaving the row puts the fitted look back.
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
  PATTERN_CARDS,
  SCHEME_SWATCHES,
  SCRAP_PRICE,
  STAT_ROWS,
  frameCard,
  formatCredits,
  paintCard,
  resolvePaint,
  schemeCard,
  statFill,
} from "./garage-catalog.js";
import {
  STREAK_PAY,
  SWEEP_BONUS,
  buyFrame,
  buyPart,
  contractFor,
  dailyJobs,
  describeContract,
  describeJob,
  describeWeekly,
  fitBody,
  fitPaint,
  fitPattern,
  hasNews,
  jobDone,
  jobProgressLabel,
  liveStreak,
  readDaily,
  scrapContract,
  seenDaily,
  selectFrame,
  sweptToday,
  weeklyDone,
  weeklyJob,
  weeklyProgress,
  type Transaction,
} from "./garage-economy.js";
import {
  MAX_PART_STAGE,
  PARTS,
  bodySchemes,
  defaultFit,
  handlingFor,
  type FrameFit,
  type Garage,
  type Handling,
} from "./garage-rules.js";
import { demoCraft, restCraft, turnCraft, type DemoHold } from "./garage-look";
import { ShowroomSound } from "./garage-sound";
import { markDaily, msToMidnight, today, type GarageStore } from "./garage-purse";

/**
 * Everything the bay needs from the running page. Handed over by `main.ts`
 * rather than imported, for the reason `garage-purse.ts` gives: a lazy chunk
 * that imported the save, the format or the circuit table would split those
 * modules out of the entry chunk.
 */
export interface GarageHooks {
  /**
   * Re-installs the saved craft's handling and puts a look on the craft: the
   * saved one, a frame the showroom is viewing, or — with `trial` — a scheme or
   * pattern the paint shop is showing before it is bought.
   */
  refit(previewFrame: string | null, trial?: Garage | null): void;
  /** One more paddock frame (the paddock only draws on request). */
  requestRender(): void;
  /** `resolveReducedMotion` from `query-probes.ts`: patterns hold still. */
  reducedMotion(): boolean;
  /** `LIVERIES` from `liveries.js`: TOTEM's body paint is its livery. */
  liveries: readonly { code: string; label: string; deck: string }[];
  /** Issues a livery to TOTEM, as the paddock's LIVERY row does. */
  setLivery(code: string): void;
  /** Drops any action the bay just swallowed before the game sees it. */
  suspendInput(): void;
  /** `save` from `persistence.ts`. */
  save: GarageStore & {
    /** The listener's master volume, which the showroom's engine plays at. */
    readonly settings: { readonly masterVolume: number };
    readonly livery: string;
    setTrack(track: string): string;
    setRaceMode(mode: string): string;
    setTier(tier: string): string;
  };
  /** The circuit, format and field this page was loaded for. */
  here: { track: string; mode: string; tier: string };
  /** `TRACKS` from `map-selection.ts`, for the contract board's circuit lines. */
  tracks: readonly { selection: string; label: string; mapCode: string }[];
}

type Tab = "craft" | "parts" | "paint" | "contracts" | "daily";
const TABS: readonly { code: Tab; label: string }[] = [
  { code: "craft", label: "CRAFT" },
  { code: "parts", label: "PARTS" },
  { code: "paint", label: "PAINT" },
  { code: "contracts", label: "CONTRACTS" },
  { code: "daily", label: "DAILY" },
];
const TIER_ORDER = ["rookie", "works", "feral"];
/** One turn of the showroom every 24 s, in radians per millisecond. */
const TURN_RATE = (Math.PI * 2) / 24_000;
/** Reduced motion's still showroom angle: a three-quarter view of the flank. */
const STILL_YAW = -0.7;
/** How far up the track the demo moves the craft, so its boosted plume stays in frame (m). */
const DEMO_PUSH = 3;
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
  /** The paint shop's what-if: the saved garage with one finish changed. */
  private trial: Garage | null = null;
  /** The showroom's own frame loop: the turntable, and the demo while it runs. */
  private animation = 0;
  private last = 0;
  private yaw = 0;
  private push = 0;
  /** The showroom demo: two momentary holds under CRAFT and PAINT. */
  private readonly demoStrip = node("div", "garage__demo");
  private readonly boostHold: HTMLButtonElement;
  private readonly brakeHold: HTMLButtonElement;
  private readonly meter: HTMLElement[] = [];
  private hold: DemoHold = null;
  /** Something of the demo is on the craft: a hold, or a reserve still refilling. */
  private demoing = false;
  private quarters = 4;
  private rollCheck = 0;
  private readonly sound: ShowroomSound;

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
    this.sound = new ShowroomSound(() => this.hooks.save.settings.masterVolume);
    this.boostHold = this.holdButton("boost", "BOOST");
    this.brakeHold = this.holdButton("brake", "BRAKE");
    const meter = node("span", "garage__meter");
    meter.setAttribute("aria-hidden", "true");
    for (let quarter = 0; quarter < 4; quarter += 1) this.meter.push(meter.appendChild(node("i")));
    this.boostHold.append(meter);
    this.syncMeter(1, false);
    this.boostHold.setAttribute("aria-label", "Hold to boost · reserve 4 of 4");
    this.brakeHold.setAttribute("aria-label", "Hold to brake");
    this.demoStrip.setAttribute("role", "group");
    this.demoStrip.setAttribute("aria-label", "Showroom");
    this.demoStrip.append(this.boostHold, this.brakeHold);
    panel.append(code, head, tabs, this.body, this.demoStrip, this.note, this.closeButton);
    this.screen.append(panel);
    this.screen.addEventListener("keydown", this.handlePanelKeys);
    this.screen.addEventListener("pointerdown", (event) => {
      // A touched preview stays through a demo hold: that is how a flame is heard and seen before it is bought.
      if (event.pointerType === "touch" && !(event.target instanceof Element && event.target.closest(".garage__paints, .garage__demo"))) {
        this.previewLook(null);
      }
    });
    (document.getElementById("app") ?? document.body).append(this.screen);
    window.addEventListener("keydown", this.handleWindowKeys, { capture: true });
    // Leaving the page ends the demo at once: a hidden tab runs no frame to end it on.
    window.addEventListener("blur", this.interrupt);
    document.addEventListener("visibilitychange", this.interrupt);
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
      // A finish that closed a job lands the next visit on DAILY, once.
      const garage = this.hooks.save.garage;
      if (hasNews(readDaily(garage.daily, today()))) {
        tab = "daily";
        this.hooks.save.setGarage(seenDaily(garage));
      }
    }
    this.setNote("", "idle");
    this.showTab(tab);
    this.tabButtons[TABS.findIndex((entry) => entry.code === this.tab)]?.focus({ preventScroll: true });
  }

  hide(): void {
    if (!this.opened) return;
    this.opened = false;
    this.trial = null;
    this.animate();
    this.screen.hidden = true;
    document.body.dataset.garage = "false";
    this.refit(null);
    this.hooks.suspendInput();
    this.returnFocus?.focus({ preventScroll: true });
    this.returnFocus = null;
  }

  dispose(): void {
    cancelAnimationFrame(this.animation);
    clearTimeout(this.rollCheck);
    this.sound.dispose();
    window.removeEventListener("keydown", this.handleWindowKeys, { capture: true });
    window.removeEventListener("blur", this.interrupt);
    document.removeEventListener("visibilitychange", this.interrupt);
    this.screen.remove();
    delete document.body.dataset.garage;
  }

  private showTab(tab: Tab): void {
    this.tab = tab;
    for (const [index, entry] of TABS.entries()) {
      const selected = entry.code === tab;
      this.tabButtons[index].setAttribute("aria-selected", String(selected));
      this.tabButtons[index].tabIndex = selected ? 0 : -1;
    }
    // The showroom previews the frame being looked at; every other tab shows
    // the craft that will actually race.
    this.trial = null;
    this.refit(tab === "craft" && this.viewed !== this.hooks.save.garage.chassis ? this.viewed : null);
    this.render();
    this.animate();
  }

  /**
   * Shows one finish on the craft without buying it, or — with null — puts the
   * fitted look back. The trial is the saved garage with the change on the
   * frame on the grid, so everything else about the craft stays as it races.
   */
  private previewLook(change: Partial<FrameFit> | null): void {
    const garage = this.hooks.save.garage;
    if (change === null) {
      if (!this.trial) return;
      this.trial = null;
      this.refit(null);
    } else {
      const fit = garage.fleet[garage.chassis] ?? defaultFit();
      this.trial = { ...garage, fleet: { ...garage.fleet, [garage.chassis]: { ...fit, ...change } } };
      this.refit(null, this.trial);
    }
    this.animate();
  }

  /** Pointer or keyboard focus on a chip previews it; leaving its row restores. */
  private previewable(chip: HTMLButtonElement, change: Partial<FrameFit>): HTMLButtonElement {
    chip.addEventListener("pointerenter", () => this.previewLook(change));
    chip.addEventListener("focus", () => this.previewLook(change));
    return chip;
  }

  /**
   * A row of chips is one radio group: Tab lands on the fitted chip and the
   * arrows (with Home and End) move along the row — previewing as they go,
   * because focus previews — so the paint shop is five tab stops, not forty.
   * On touch, leaving is not a gesture: a tap ends with `pointerleave`, so a
   * touched preview stays until the driver taps somewhere else.
   */
  private previewRow(row: HTMLElement, label: string): HTMLElement {
    row.setAttribute("role", "radiogroup");
    row.setAttribute("aria-label", label);
    const chips = [...row.querySelectorAll<HTMLButtonElement>("button")];
    const fitted = Math.max(0, chips.findIndex((chip) => chip.getAttribute("aria-checked") === "true"));
    chips.forEach((chip, index) => { chip.tabIndex = index === fitted ? 0 : -1; });
    row.addEventListener("keydown", (event) => {
      const at = chips.indexOf(event.target as HTMLButtonElement);
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
      const to = event.key === "Home" ? 0 : event.key === "End" ? chips.length - 1
        : step === undefined || at < 0 ? -1 : (at + step + chips.length) % chips.length;
      if (to < 0) return;
      event.preventDefault();
      chips[to].focus({ preventScroll: false });
    });
    row.addEventListener("pointerleave", (event) => {
      if (event.pointerType !== "touch") this.previewLook(null);
    });
    row.addEventListener("focusout", (event) => {
      if (!(event.relatedTarget instanceof Node && row.contains(event.relatedTarget))) this.previewLook(null);
    });
    return row;
  }

  /**
   * The showroom turntable. While the bay is open the craft turns slowly in
   * place, so a body and its paint are seen from every side rather than only
   * from the chase camera behind it; the same frame loop draws an underglow
   * pattern in motion, because the paddock only draws when asked. Under
   * reduced motion nothing turns: the craft is held at a still three-quarter
   * angle instead, and closing the bay puts it back exactly as it races.
   *
   * The same loop runs the showroom demo, under reduced motion too: while a
   * hold is on, or its reserve is still refilling, the craft eases to the rear
   * three-quarter (the side whose plume stays on screen) and a few metres up
   * the track, where its jets, gauge and airbrakes face the camera in frame.
   */
  private animate(): void {
    const still = this.hooks.reducedMotion();
    if (!this.opened) {
      cancelAnimationFrame(this.animation);
      this.animation = 0;
      this.endDemo();
      this.yaw = 0;
      this.push = 0;
      turnCraft(0);
      this.hooks.requestRender();
      return;
    }
    if (this.demoing || !still) {
      // From the three-quarter view, not the race pose the driver just left.
      if (this.yaw === 0) this.yaw = STILL_YAW;
      if (!this.animation) {
        this.last = performance.now();
        this.animation = requestAnimationFrame(this.tick);
      }
      return;
    }
    cancelAnimationFrame(this.animation);
    this.animation = 0;
    this.yaw = STILL_YAW;
    this.push = 0;
    turnCraft(this.yaw);
    this.hooks.requestRender();
  }

  private readonly tick = (now: number): void => {
    const seconds = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const still = this.hooks.reducedMotion();
    const ease = 1 - Math.exp(-seconds * 10);
    if (this.demoing) {
      // The short way round to the three-quarter.
      const yaw = Math.atan2(Math.sin(this.yaw), Math.cos(this.yaw));
      const turn = Math.atan2(Math.sin(STILL_YAW - yaw), Math.cos(STILL_YAW - yaw));
      this.yaw = still ? STILL_YAW : yaw + turn * ease;
      const frame = demoCraft(this.hold, seconds, still);
      this.sound.set(frame.throttle, frame.speedRatio, frame.brake, frame.firing, frame.recharging);
      this.syncMeter(frame.reserve, frame.recharging);
      // Let go and refilled: the craft goes back to rest and the turntable resumes.
      if (!this.hold && frame.reserve >= 1) this.endDemo();
    } else if (!still) {
      this.yaw = (this.yaw + seconds * 1000 * TURN_RATE) % (Math.PI * 2);
    }
    const push = this.demoing ? DEMO_PUSH : 0;
    this.push = still ? push : this.push + (push - this.push) * ease;
    turnCraft(this.yaw, this.push);
    this.hooks.requestRender();
    this.animation = this.opened && (this.demoing || !still) ? requestAnimationFrame(this.tick) : 0;
  };

  /** Every refit from the bay ends the demo first, on the body it is on now. */
  private refit(previewFrame: string | null, trial?: Garage | null): void {
    this.endDemo();
    this.hooks.refit(previewFrame, trial);
  }

  /** A momentary button: held by pointer, or by Space or Enter while focused. */
  private holdButton(kind: "boost" | "brake", label: string): HTMLButtonElement {
    const element = node("button", "chip garage__hold");
    element.type = "button";
    element.dataset.key = `hold-${kind}`;
    element.append(node("strong", "", label), node("small", "", "HOLD · SPACE"));
    const end = (): void => this.endHold(kind);
    element.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || element.disabled) return;
      event.preventDefault();
      element.setPointerCapture(event.pointerId);
      this.startHold(kind);
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture", "blur"]) element.addEventListener(type, end);
    element.addEventListener("keydown", (event) => {
      if (event.key !== " " && event.key !== "Enter") return;
      event.preventDefault();
      if (!event.repeat) this.startHold(kind);
    });
    element.addEventListener("keyup", (event) => {
      if (event.key !== " " && event.key !== "Enter") return;
      event.stopPropagation();
      end();
    });
    element.addEventListener("contextmenu", (event) => event.preventDefault());
    return element;
  }

  private startHold(kind: "boost" | "brake"): void {
    if (!this.opened || this.hold || this.rolling()) return;
    this.hold = kind;
    this.demoing = true;
    this.demoStrip.dataset.running = "true";
    this.sound.wake();
    (kind === "boost" ? this.boostHold : this.brakeHold).dataset.held = "true";
    this.animate();
  }

  private endHold(kind: "boost" | "brake"): void {
    if (this.hold !== kind) return;
    this.hold = null;
    delete (kind === "boost" ? this.boostHold : this.brakeHold).dataset.held;
  }

  private readonly interrupt = (): void => this.endDemo();

  private readonly releaseHold = (): void => {
    if (this.hold) this.endHold(this.hold);
  };

  /** Ends any demo at once: the craft back at rest, the engine faded, the meter full. */
  private endDemo(): void {
    this.releaseHold();
    if (!this.demoing) return;
    this.demoing = false;
    this.demoStrip.dataset.running = "false";
    restCraft();
    this.sound.rest();
    this.syncMeter(1, false);
  }

  private syncMeter(reserve: number, recharging: boolean): void {
    const quarters = Math.ceil(reserve * 4 - 1e-6);
    this.meter.forEach((bar, index) => { bar.dataset.on = String(index < quarters); });
    const label = this.boostHold.querySelector("strong");
    if (label) label.textContent = recharging ? "RECHARGING" : "BOOST";
    if (quarters !== this.quarters) {
      this.quarters = quarters;
      this.boostHold.setAttribute("aria-label", `Hold to boost · reserve ${quarters} of 4`);
    }
  }

  /**
   * On RESULT the race loop still drives the craft while it coasts, so the
   * demo waits for the HUD's 000. That is enough: the coast snaps the speed to
   * exactly zero at 1.26 km/h (physics.js COAST_STOP_SPEED), before the readout
   * could round to 000, and the loop stops presenting at zero.
   */
  private rolling(): boolean {
    return document.body.dataset.phase === "result" && document.getElementById("speed-value")?.textContent !== "000";
  }

  /** The strip on CRAFT and PAINT only, disabled while the craft is still rolling. */
  private syncStrip(): void {
    clearTimeout(this.rollCheck);
    const shown = this.tab === "craft" || this.tab === "paint";
    this.demoStrip.hidden = !shown;
    const rolling = shown && this.rolling();
    for (const hold of [this.boostHold, this.brakeHold]) {
      hold.disabled = rolling;
      const prompt = hold.querySelector("small");
      if (prompt) prompt.textContent = rolling ? "CRAFT STILL ROLLING" : "HOLD · SPACE";
    }
    if (rolling && this.opened) this.rollCheck = window.setTimeout(() => this.syncStrip(), 250);
  }

  private render(): void {
    const focusKey = (document.activeElement as HTMLElement | null)?.dataset.key ?? null;
    const garage = this.hooks.save.garage;
    this.credits.textContent = formatCredits(garage.credits);
    const walletLine = document.getElementById("garage-credits");
    if (walletLine) walletLine.textContent = formatCredits(garage.credits);
    markDaily(garage);
    this.body.replaceChildren(
      ...(this.tab === "craft" ? this.renderCraft(garage)
        : this.tab === "parts" ? this.renderParts(garage)
        : this.tab === "paint" ? this.renderPaint(garage)
        : this.tab === "contracts" ? this.renderContracts(garage)
        : this.renderDaily(garage)),
    );
    this.syncStrip();
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
          owned ? `${card.label} ON THE GRID` : `${card.label} SIGNED · ON THE GRID`, `frame-${card.code}`);
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
        this.commit(buyPart(this.hooks.save.garage, card.code), `${card.label} STAGE ${ROMAN[stage + 1]} FITTED`, `part-${card.code}`);
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
    const label = frameCard(garage.chassis).label;
    const title = node("p", "garage__card-title", `${label} · PAINT SHOP`);
    const hint = node("p", "garage__card-note", "POINT AT A FINISH TO SEE IT ON THE CRAFT · BODY PAINT IS PER FRAME, COLOURS AND PATTERNS FIT ANY");
    const slots = PAINT_SLOTS.map((slot) => {
      const chips = node("div", "chip-row garage__paints");
      for (const paint of PAINT_CARDS) {
        if (slot.code === "under" ? paint.code === "stock" : paint.code === "off") continue;
        const owned = garage.paints.includes(paint.code);
        const chip = this.previewable(button("chip garage__paint", `paint-${slot.code}-${paint.code}`, () => {
          this.commit(fitPaint(this.hooks.save.garage, slot.code, paint.code),
            owned ? `${slot.label} · ${paint.label}` : `${paint.label} BOUGHT · ${slot.label}`, `paint-${slot.code}-${paint.code}`);
        }), { [slot.code]: paint.code });
        chip.setAttribute("role", "radio");
        chip.setAttribute("aria-checked", String(fit[slot.code] === paint.code));
        const swatch = node("i", "garage__swatch");
        const shown = resolvePaint(garage.chassis, slot.code, paint.code);
        if (shown !== null) swatch.style.setProperty("--swatch", hexColor(shown));
        else swatch.dataset.swatch = paint.code === "off" ? "off" : "works";
        chip.append(swatch, node("strong", "", paint.label), node("small", "", owned ? "OWNED" : formatCredits(paintCard(paint.code).price)));
        chips.append(chip);
      }
      return this.paintRow(slot.label, chips);
    });
    return [title, hint, this.renderBody(garage, fit, label), ...slots, ...this.renderPatterns(garage, fit)];
  }

  private paintRow(key: string, chips: HTMLElement): HTMLElement {
    const row = node("div", "dispatch__row garage__slot");
    row.append(node("span", "dispatch__key", key), this.previewRow(chips, key));
    return row;
  }

  /**
   * BODY. A bodied frame's schemes, each chip showing its paint over its
   * accent; TOTEM's body paint is the livery the paddock issues, free, so its
   * row is those liveries and fitting one is issuing it.
   */
  private renderBody(garage: Garage, fit: FrameFit, label: string): HTMLElement {
    const chips = node("div", "chip-row garage__paints");
    if (garage.chassis === "totem") {
      for (const livery of this.hooks.liveries) {
        const chip = button("chip garage__paint", `body-${livery.code}`, () => {
          this.hooks.setLivery(livery.code);
          this.setNote(`${livery.label} ISSUED TO TOTEM`, "ok");
          this.render();
        });
        chip.setAttribute("role", "radio");
        chip.setAttribute("aria-checked", String(this.hooks.save.livery === livery.code));
        const swatch = node("i", "garage__swatch");
        swatch.dataset.swatch = "works";
        chip.append(swatch, node("strong", "", livery.label), node("small", "", "ISSUED FREE"));
        chips.append(chip);
      }
      return this.paintRow("BODY", chips);
    }
    const frame = garage.chassis;
    // Five schemes on a bodied frame: one row of five, so GOLD LEAF is never
    // left on a line of its own.
    chips.classList.add("garage__paints--body");
    for (const code of bodySchemes(frame)) {
      const card = schemeCard(code);
      const owned = code === "factory" || (code === "gold" ? garage.goldLeaf : garage.schemes.includes(`${frame}:${code}`));
      const chip = this.previewable(button("chip garage__paint", `body-${code}`, () => {
        this.commit(fitBody(this.hooks.save.garage, code), owned ? `${card.label} ON ${label}` : `${card.label} BOUGHT · ON ${label}`, `body-${code}`);
      }), { body: code });
      chip.setAttribute("role", "radio");
      chip.setAttribute("aria-checked", String(fit.body === code));
      if (!owned && card.price === null) chip.setAttribute("aria-disabled", "true");
      chip.title = card.note;
      const swatch = node("i", "garage__swatch");
      const [paint, accent] = SCHEME_SWATCHES[frame]?.[code] ?? ["#000000", "#000000"];
      swatch.dataset.swatch = "scheme";
      swatch.style.setProperty("--swatch", paint);
      swatch.style.setProperty("--swatch-accent", accent);
      chip.append(swatch, node("strong", "", card.label), node("small", "",
        owned ? (code === "gold" ? "UNLOCKED" : "OWNED") : card.price === null ? "STREAK" : formatCredits(card.price)));
      chips.append(chip);
    }
    return this.paintRow("BODY", chips);
  }

  /**
   * PATTERN. With no underglow fitted a pattern has nothing to move, so the
   * preview borrows the running-light colour to show it on.
   */
  private renderPatterns(garage: Garage, fit: FrameFit): HTMLElement[] {
    const chips = node("div", "chip-row garage__paints");
    const card = frameCard(garage.chassis);
    const under = fit.under !== "off" ? fit.under : fit.glow !== "stock" ? fit.glow : card.glow !== "stock" ? card.glow : "acid";
    for (const pattern of PATTERN_CARDS) {
      const owned = garage.patterns.includes(pattern.code);
      const chip = this.previewable(button("chip garage__paint", `pattern-${pattern.code}`, () => {
        this.commit(fitPattern(this.hooks.save.garage, pattern.code),
          owned ? `UNDERGLOW · ${pattern.label}` : `${pattern.label} BOUGHT · UNDERGLOW`, `pattern-${pattern.code}`);
      }), { pattern: pattern.code, under });
      chip.setAttribute("role", "radio");
      chip.setAttribute("aria-checked", String(fit.pattern === pattern.code));
      const swatch = node("i", "garage__swatch");
      swatch.dataset.swatch = "pattern";
      swatch.dataset.pattern = pattern.code;
      chip.append(swatch, node("strong", "", pattern.label), node("small", "", owned ? "OWNED" : formatCredits(pattern.price)));
      chips.append(chip);
    }
    const notes = [
      fit.under === "off" ? "NO UNDERGLOW FITTED · A PATTERN SHOWS ONCE ONE IS" : "",
      this.hooks.reducedMotion() ? "REDUCED MOTION IS ON · PATTERNS HOLD STEADY" : "",
    ].filter(Boolean);
    return [
      this.paintRow("PATTERN", chips),
      ...(notes.length > 0 ? [node("p", "garage__card-note", notes.join(" · "))] : []),
    ];
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
      const go = button("chip garage__go", `contract-go-${slot}`, () => this.dispatch(contract.track, contract.mode, contract.tier));
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
   * DAILY. The streak up top as seven pips (today's lit once it counts), the
   * day's three jobs with their bars, the sweep, the week's job and GOLD
   * LEAF's standing. The reset time is computed on render, not ticked: a live
   * countdown would be a region re-announcing itself every minute.
   */
  private renderDaily(garage: Garage): HTMLElement[] {
    const day = today();
    const state = readDaily(garage.daily, day);
    const streak = liveStreak(state);
    const rung = streak === 0 ? 0 : ((streak - 1) % STREAK_PAY.length) + 1;
    const countedToday = state.lastDay === day;
    const left = msToMidnight();
    const head = node("div", "garage__daily-head");
    const heading = node("div", "garage__daily-title");
    heading.append(
      node("p", "garage__card-title", streak === 0 ? "STREAK · ONE JOB TODAY STARTS IT"
        : `STREAK · DAY ${rung} OF ${STREAK_PAY.length}${countedToday ? " · TODAY COUNTED" : " · ONE JOB TODAY KEEPS IT"}`),
      node("p", "garage__card-note", `NEW JOBS IN ${Math.floor(left / 3_600_000)} H ${Math.floor(left / 60_000) % 60} MIN`),
    );
    const pips = node("ol", "garage__streak");
    pips.setAttribute("aria-label", `STREAK LADDER · DAY ${rung} OF ${STREAK_PAY.length}`);
    for (const [index, pay] of STREAK_PAY.entries()) {
      const pip = node("li");
      const today = countedToday && index === rung - 1;
      pip.dataset.on = String(index < rung);
      pip.dataset.today = String(today);
      // The state is in the words as well as the colour.
      const prize = index === STREAK_PAY.length - 1 && !garage.goldLeaf ? `GOLD LEAF + ${pay}` : `+${pay}`;
      pip.setAttribute("aria-label", `DAY ${index + 1} · ${prize} · ${today ? "COUNTED TODAY" : index < rung ? "COUNTED" : "TO COME"}`);
      if (today) pip.setAttribute("aria-current", "step");
      pip.append(node("small", "", index === STREAK_PAY.length - 1 && !garage.goldLeaf ? `GOLD +${pay}` : `+${pay}`));
      pips.append(pip);
    }
    head.append(heading, pips);

    const list = node("ol", "garage__contracts garage__jobs");
    for (const [slot, job] of dailyJobs(day).entries()) {
      const track = job.track ? this.hooks.tracks.find((entry) => entry.selection === job.track) : undefined;
      const done = jobDone(state, slot);
      const item = this.jobItem(
        job.track ? `CIRCUIT OF THE DAY · ${track?.mapCode ?? ""} · ${track?.label ?? job.track.toUpperCase()}`
          : job.cumulative ? "TODAY'S TOTAL" : "BEST SINGLE RACE",
        describeJob(job),
        done ? "PAID" : `+ ${formatCredits(job.reward)}`,
        done ? "DONE" : jobProgressLabel(job, state.progress[slot]),
        Math.min(state.progress[slot], job.target),
        job.target,
        done,
      );
      item.dataset.here = String(job.track !== null && job.track === this.hooks.here.track);
      if (job.track && !done) {
        const go = button("chip garage__go", `daily-go-${slot}`, () => this.dispatch(job.track ?? "", null, null));
        go.append(node("strong", "", job.track === this.hooks.here.track ? "RACE IT HERE" : "DISPATCH"));
        const actions = node("div", "garage__contract-actions");
        actions.append(go);
        item.append(actions);
      }
      list.append(item);
    }
    const sweep = node("p", "garage__card-note garage__sweep",
      sweptToday(state) ? "SWEPT · ALL THREE PAID TODAY" : `SWEEP ALL THREE · + ${formatCredits(SWEEP_BONUS)}`);
    sweep.dataset.done = String(sweptToday(state));

    const weekly = weeklyJob(state.week);
    const weekDone = weeklyDone(state);
    const progress = Math.min(weeklyProgress(state, weekly), weekly.target);
    const week = node("ol", "garage__contracts garage__jobs");
    week.append(this.jobItem("THIS WEEK · NEW JOB EVERY MONDAY", describeWeekly(weekly),
      weekDone ? "PAID" : `+ ${formatCredits(weekly.reward)}`, weekDone ? "DONE" : `${progress}/${weekly.target}`,
      progress, weekly.target, weekDone));
    const gold = node("p", "garage__card-note", garage.goldLeaf
      ? "GOLD LEAF · UNLOCKED · FITS ANY BODIED FRAME IN THE PAINT SHOP"
      : "GOLD LEAF · DAY 7 OF A STREAK UNLOCKS IT · NEVER SOLD");
    return [head, list, sweep, week, gold];
  }

  private jobItem(where: string, goal: string, pay: string, count: string, value: number, target: number, done: boolean): HTMLElement {
    const item = node("li", "garage__contract garage__job");
    item.dataset.done = String(done);
    const bar = node("span", "garage__bar garage__job-bar");
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-label", goal);
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", String(target));
    bar.setAttribute("aria-valuenow", String(value));
    const fill = node("i", "garage__fill");
    fill.style.setProperty("--fill", (target > 0 ? value / target : 0).toFixed(3));
    bar.append(fill);
    const meter = node("div", "garage__job-meter");
    meter.append(bar, node("span", "garage__job-count", count));
    item.append(
      node("p", "garage__contract-where", where),
      node("p", "garage__contract-goal", goal),
      node("p", "garage__contract-pay", pay),
      meter,
    );
    return item;
  }

  /**
   * Sends the driver to a contract's (or the day's) circuit with a format and
   * field that can close it. The choices are stored before navigating, as the dispatch sheet
   * does, and a contract for the circuit already loaded just closes the bay.
   */
  private dispatch(track: string, wanted: string | null, minimum: string | null): void {
    const mode = wanted === "field"
      ? (this.hooks.here.mode === "timeattack" ? "race" : this.hooks.here.mode)
      : wanted ?? this.hooks.here.mode;
    const tier = minimum && TIER_ORDER.indexOf(this.hooks.here.tier) < TIER_ORDER.indexOf(minimum)
      ? minimum
      : this.hooks.here.tier;
    this.hooks.save.setTrack(track);
    this.hooks.save.setRaceMode(mode);
    this.hooks.save.setTier(tier);
    if (track === this.hooks.here.track && mode === this.hooks.here.mode && tier === this.hooks.here.tier) {
      this.hide();
      if (document.body.dataset.phase === "intro") document.getElementById("start-button")?.focus({ preventScroll: true });
      return;
    }
    const parameters = new URLSearchParams(window.location.search);
    parameters.set("map", track);
    parameters.set("mode", mode);
    parameters.set("tier", tier);
    parameters.delete("demo");
    window.location.search = parameters.toString();
  }

  private commit(result: Transaction, success: string, key = ""): void {
    // A refusal leaves the preview on the craft: the driver is still pointing
    // at it, and leaving the row puts the fitted look back as usual.
    if (result.ok) {
      this.hooks.save.setGarage(result.garage);
      if (this.tab === "craft") this.viewed = this.hooks.save.garage.chassis;
      this.setNote(result.spent > 0 ? `${success} · −${formatCredits(result.spent)}` : success, "ok");
      this.showTab(this.tab);
      // A purchase lands with a one-shot flash on the chip it bought (never on
      // a refusal, never under reduced motion).
      const bought = key && result.spent > 0 && !this.hooks.reducedMotion()
        ? this.screen.querySelector<HTMLElement>(`[data-key="${key}"]`) : null;
      if (bought) bought.dataset.bought = "true";
      return;
    }
    const garage = this.hooks.save.garage;
    const card = frameCard(this.viewed);
    this.setNote(
      result.reason === "credits" ? `NOT ENOUGH CREDITS · ${formatCredits(garage.credits)} IN THE BANK`
        : result.reason === "licence" ? `${card.label} NEEDS ${card.licence} CONTRACTS ON FILE · ${garage.contracts.done} SO FAR`
        : result.reason === "maxed" ? "STAGE III IS THE LAST STAGE"
        : result.reason === "streak" ? "GOLD LEAF IS DAY 7 OF A DAILY STREAK · SEE DAILY"
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
