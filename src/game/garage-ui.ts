/** B2 service bay. Saved transactions remain in garage-economy; this screen owns navigation and confirmations. */
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
  type PartCode,
} from "./garage-rules.js";
import { demoCraft, restCraft, type DemoHold } from "./garage-look";
import { GarageScene, type GarageView } from "./garage-scene";
import { FLEET_CODES, TEAM_COLORS, FRAME_ANCHORS } from "./garage-anchors";
import { refreshRewardOffer } from "./garage-reward";
import { ShowroomSound } from "./garage-sound";
import { GarageMotion } from "./garage-motion";
import { GarageMusic } from "./garage-music";
import { PART_BENEFITS, PART_HARDWARE } from "./garage-upgrades";
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
  refit(previewFrame: string | null, trial?: Garage | null): Promise<void>;
  setView(view: GarageView | null): void;
  toggleSound(): void;
  confirmHeld(): boolean;
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
    readonly settings: { readonly masterVolume: number; readonly musicVolume: number };
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

type Tab = "craft" | "parts" | "paint" | "test" | "contracts" | "daily";
const TABS: readonly { code: Tab; label: string }[] = [
  { code: "craft", label: "FLEET" }, { code: "parts", label: "UPGRADE" },
  { code: "paint", label: "PAINT" }, { code: "test", label: "TEST" },
];
const TIER_ORDER = ["rookie", "works", "feral"];
type PaintSlot = "body" | "flame" | "glow" | "under" | "pattern";
interface Purchase { label: string; price: number; key: string; confirm: () => Transaction; }
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
  private readonly background = new Map<HTMLElement, boolean>();
  private opened = false;
  /** The paint shop's what-if: the saved garage with one finish changed. */
  private trial: Garage | null = null;
  /** The bay's camera transition and test hold loop. */
  private animation = 0;
  private last = 0;

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
  private readonly music: GarageMusic;
  private readonly motion: GarageMotion;
  private readonly scene: GarageScene;
  private readonly slab = node("div", "garage__slab");
  private readonly footer = node("nav", "garage__footer");
  private readonly soundButton: HTMLButtonElement;
  private readonly jobsButton: HTMLButtonElement;
  private readonly marker = node("div", "garage__anchor");
  private readonly leader = node("div", "garage__leader");
  private selectedPart: PartCode | null = null;
  private previewUpgrade = false;
  private fittedPart: PartCode | null = null;
  private pending: Purchase | null = null;
  private paintSlot: PaintSlot = "flame";
  private fitting = 0;
  private lastSound = "";
  private padWasDown = false;
  private padHold: DemoHold = null;
  private lastDevice = "";
  private backgrounded = false;

  constructor(private readonly hooks: GarageHooks) {
    this.screen.id = "garage-screen";
    this.screen.hidden = true;
    this.screen.setAttribute("role", "dialog");
    this.screen.setAttribute("aria-modal", "true");
    this.screen.setAttribute("aria-label", "Garage service bay");
    this.scene = new GarageScene(hooks.reducedMotion, point => this.positionOrder(point));
    this.motion = new GarageMotion(hooks.reducedMotion);
    this.music = new GarageMusic(() => hooks.save.settings);
    const header = node("header", "garage__header");
    this.closeButton = button("garage__button", "close", () => this.hide());
    this.closeButton.id = "garage-close";
    this.closeButton.append(node("span", "", "◂ RETURN TO GRID"), this.keycap("back", "ESC"));
    this.soundButton = button("garage__button garage__sound", "sound", () => { hooks.toggleSound(); this.syncSound(); });
    this.jobsButton = button("garage__button garage__jobs-button", "jobs", () => this.showTab("contracts"));
    this.jobsButton.textContent = "JOBS";
    const wallet = node("div", "garage__wallet");
    wallet.append(node("small", "", "CREDITS"), this.credits);
    this.credits.setAttribute("aria-live", "polite");
    const tabs = node("nav", "garage__tabs");
    tabs.setAttribute("aria-label", "Garage modes");
    for (const [index, entry] of TABS.entries()) {
      const tab = button("garage__tab", `tab-${entry.code}`, () => this.showTab(entry.code));
      tab.append(node("small", "", String(index + 1)), node("strong", "", entry.label));
      this.tabButtons.push(tab); tabs.append(tab);
    }
    tabs.addEventListener("keydown", this.handleTabKeys);
    header.append(this.closeButton, tabs, this.jobsButton, this.soundButton, wallet);
    this.note.setAttribute("role", "status");
    this.sound = new ShowroomSound(() => hooks.save.settings.masterVolume);
    this.boostHold = this.holdButton("boost", "BOOST");
    this.brakeHold = this.holdButton("brake", "BRAKE");
    const meter = node("span", "garage__meter");
    meter.setAttribute("aria-hidden", "true");
    for (let quarter = 0; quarter < 4; quarter++) this.meter.push(meter.appendChild(node("i")));
    this.boostHold.append(meter); this.syncMeter(1, false);
    this.boostHold.setAttribute("aria-label", "Hold to boost · reserve 4 of 4");
    this.brakeHold.setAttribute("aria-label", "Hold to brake");
    this.demoStrip.setAttribute("role", "group");
    this.demoStrip.setAttribute("aria-label", "Test craft");
    this.demoStrip.append(node("p", "garage__test-copy", "PLASMA RESERVE · HOLD TO TEST"), this.brakeHold, this.boostHold);
    this.leader.setAttribute("aria-hidden", "true");
    this.marker.setAttribute("aria-hidden", "true");
    this.screen.append(header, this.slab, this.body, this.footer, this.leader, this.marker, this.demoStrip, this.note);
    this.screen.addEventListener("keydown", this.handlePanelKeys);
    this.screen.addEventListener("pointerdown", this.resumeMusic);
    this.screen.addEventListener("keydown", this.resumeMusic);
    (document.getElementById("app") ?? document.body).append(this.screen);
    window.addEventListener("keydown", this.handleWindowKeys, { capture: true });
    window.addEventListener("blur", this.interrupt);
    window.addEventListener("focus", this.resumeMusic);
    document.addEventListener("visibilitychange", this.interrupt);
  }

  private keycap(prompt: string, label: string): HTMLElement {
    const key = node("kbd", "", document.querySelector(`kbd[data-prompt="${prompt}"]`)?.textContent || label);
    key.dataset.prompt = prompt; return key;
  }

  private syncSound(): void {
    const label = document.body.dataset.muted === "true" ? "SOUND OFF" : "SOUND ON";
    if (label === this.lastSound) return;
    this.lastSound = label; this.soundButton.textContent = label;
    this.soundButton.setAttribute("aria-label", `${label}, toggle sound`);
    this.music.sync(0, this.demoing);
    if (label === "SOUND ON") this.music.resume();
  }

  private positionOrder(point: {x: number; y: number; ready: boolean}): void {
    const shown = this.selectedPart !== null && point.ready;
    this.marker.hidden = this.leader.hidden = !shown;
    this.screen.dataset.modelReady = String(point.ready);
    if (!shown) return;
    this.marker.style.transform = `translate(${point.x}px, ${point.y}px)`;
    const order = this.body.querySelector<HTMLElement>(".garage__work-order");
    if (!order) return;
    const rect = order.getBoundingClientRect();
    const portrait = window.innerWidth / window.innerHeight < .85;
    const x = portrait ? Math.max(rect.left + 24, Math.min(rect.right - 24, point.x)) : rect.left;
    const y = portrait ? rect.top : rect.top + Math.min(80, rect.height / 2);
    this.leader.style.width = `${Math.hypot(x - point.x, y - point.y)}px`;
    this.leader.style.transform = `translate(${point.x}px, ${point.y}px) rotate(${Math.atan2(y - point.y, x - point.x)}rad)`;
  }

  get isOpen(): boolean {
    return this.opened;
  }

  show(tab: Tab = "craft", frame?: string, confirm = false): void {
    if (!this.opened) {
      this.returnFocus = document.activeElement as HTMLElement | null;
      this.opened = true; this.screen.hidden = false;
      document.body.dataset.garage = "true";
      for (const element of document.querySelectorAll<HTMLElement>("#start-screen, #result-screen")) {
        this.background.set(element, element.inert); element.inert = true;
      }
      this.closeButton.querySelector("span")!.textContent = document.body.dataset.phase === "result" ? "◂ RETURN TO RESULTS" : "◂ RETURN TO GRID";
      this.viewed = frame ?? this.hooks.save.garage.chassis;
      this.scene.show(); this.hooks.setView(this.scene);
      this.backgrounded = false; this.music.show();
      this.hooks.suspendInput();
    } else if (frame) this.viewed = frame;
    this.setNote("", "idle");
    this.showTab(tab);
    if (confirm && frame && !Object.hasOwn(this.hooks.save.garage.fleet, frame)) this.offerFrame();
    this.tabButtons[TABS.findIndex(entry => entry.code === tab)]?.focus({preventScroll: true});
  }

  hide(): void {
    if (!this.opened) return;
    this.opened = false; this.pending = null; this.selectedPart = null; this.trial = null;
    cancelAnimationFrame(this.animation); this.animation = 0; clearTimeout(this.rollCheck);
    this.endDemo(); this.sound.rest(); this.music.hide(); this.motion.cancel(); this.scene.hide(); this.hooks.setView(null);
    this.screen.hidden = true; document.body.dataset.garage = "false";
    for (const [element, inert] of this.background) element.inert = inert;
    this.background.clear();
    this.refit(null); this.hooks.suspendInput();
    refreshRewardOffer(this.hooks.save.garage);
    this.returnFocus?.focus({preventScroll: true}); this.returnFocus = null;
  }

  dispose(): void {
    this.hide(); this.scene.dispose(); this.sound.dispose(); this.music.dispose();
    window.removeEventListener("keydown", this.handleWindowKeys, {capture: true});
    window.removeEventListener("blur", this.interrupt);
    window.removeEventListener("focus", this.resumeMusic);
    document.removeEventListener("visibilitychange", this.interrupt);
    this.screen.remove(); delete document.body.dataset.garage;
  }

  private showTab(tab: Tab): void {
    const direction = TABS.findIndex(entry => entry.code === tab) >= TABS.findIndex(entry => entry.code === this.tab) ? 1 : -1;
    this.endDemo(); this.pending = null; this.selectedPart = null; this.fittedPart = null; this.trial = null;
    this.previewUpgrade = false;
    this.tab = tab;
    if (tab !== "craft") this.viewed = this.hooks.save.garage.chassis;
    for (const [index, entry] of TABS.entries()) {
      this.tabButtons[index].setAttribute("aria-pressed", String(entry.code === tab));
    }
    if (tab === "daily") this.hooks.save.setGarage(seenDaily(this.hooks.save.garage));
    this.refit(this.viewed === this.hooks.save.garage.chassis ? null : this.viewed);
    this.render(); this.animate();
    this.sound.cue();
    this.motion.enter(this.body, direction * 18, 0);
    this.motion.enter(this.slab, -12, 0, 180);
    this.motion.enter(this.footer, 0, 10, 200);
    this.motion.enter(this.demoStrip, 0, 12);
  }

  /**
   * Shows one finish on the craft without buying it, or — with null — puts the
   * fitted look back. The trial is the saved garage with the change on the
   * frame on the grid, so everything else about the craft stays as it races.
   */
  private previewLook(change: Partial<FrameFit> | null): void {
    const garage = this.hooks.save.garage;
    if (change === null) {
      if (this.pending) return;
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

  private animate(): void {
    if (!this.opened || this.animation) return;
    this.last = performance.now();
    this.animation = requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number): void => {
    const seconds = Math.max(0, Math.min(.1, (now - this.last) / 1000)); this.last = now;
    this.syncSound();
    this.music.sync(seconds, this.demoing);
    this.pollPadHold();
    if (this.demoing) {
      const frame = demoCraft(this.hold, seconds, this.hooks.reducedMotion());
      this.sound.set(frame.throttle, frame.speedRatio, frame.brake, frame.firing, frame.recharging);
      this.syncMeter(frame.reserve, frame.recharging);
      if (!this.hold && frame.reserve >= 1) this.endDemo();
      this.hooks.requestRender();
    } else if (!this.backgrounded && !document.hidden && this.scene.animating) this.hooks.requestRender();
    this.animation = this.opened ? requestAnimationFrame(this.tick) : 0;
  };

  private pollPadHold(): void {
    const device = document.body.dataset.inputDevice ?? "keyboard";
    if (device !== this.lastDevice && !this.rolling()) {
      this.lastDevice = device;
      for (const button of [this.boostHold, this.brakeHold]) button.querySelector("small")!.textContent = device === "gamepad" ? "HOLD · A" : "HOLD · SPACE";
    }
    const down = this.hooks.confirmHeld();
    const focused = document.activeElement;
    const kind = focused === this.boostHold ? "boost" : focused === this.brakeHold ? "brake" : null;
    if (this.padHold && (!down || kind !== this.padHold || this.tab !== "test")) {
      this.endHold(this.padHold); this.padHold = null;
    }
    if (down && !this.padWasDown && kind && this.tab === "test" && !this.hold) {
      this.startHold(kind); this.padHold = kind;
    }
    this.padWasDown = down;
  }

  private refit(previewFrame: string | null, trial?: Garage | null): void {
    this.endDemo();
    const serial = ++this.fitting;
    this.screen.dataset.loading = "true";
    void this.hooks.refit(previewFrame, trial).finally(() => {
      if (serial !== this.fitting) return;
      this.screen.dataset.loading = "false";
      this.scene.animating = true; this.hooks.requestRender();
    });
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
    this.scene.select(this.viewed, null, true);
    this.scene.animating = true;
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

  private readonly resumeMusic = (): void => { if (this.opened) { this.backgrounded = false; this.music.resume(); } };
  private readonly interrupt = (): void => { this.backgrounded = true; this.endDemo(); this.sound.rest(); this.music.interrupt(); this.motion.cancel(); };

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
    this.hooks.requestRender();
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
    const shown = this.tab === "test";
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
    const wallet = document.getElementById("garage-credits");
    if (wallet) wallet.textContent = formatCredits(garage.credits);
    markDaily(garage);
    this.screen.dataset.tab = this.tab;
    this.screen.dataset.service = String(this.selectedPart !== null);
    this.screen.style.setProperty("--team", TEAM_COLORS[this.viewed]);
    this.jobsButton.dataset.news = String(hasNews(readDaily(garage.daily, today())));
    const card = frameCard(this.viewed);
    this.slab.replaceChildren(node("span", "garage__fleet-code", FLEET_CODES[this.viewed]),
      node("div", "garage__identity", card.label.split(" ")[0]), node("p", "garage__deck", card.deck),
      node("p", "garage__tradeoff", card.note), node("small", "garage__service-label", "SERVICE"));
    this.body.replaceChildren(...(this.tab === "craft" ? this.renderCraft(garage)
      : this.tab === "parts" ? this.renderParts(garage)
      : this.tab === "paint" ? this.renderPaint(garage)
      : this.tab === "test" ? [node("p", "garage__test-instruction", "Feel the response. Hold BRAKE or BOOST.")]
      : this.tab === "contracts" ? this.renderContracts(garage) : this.renderDaily(garage)));
    if (this.tab === "contracts" || this.tab === "daily") {
      const tabs = node("nav", "garage__job-tabs");
      for (const [key, label] of [["contracts", "CONTRACTS"], ["daily", "DAILY + WEEKLY"]] as const) {
        const tab = button("garage__button", key, () => this.showTab(key));
        tab.textContent = label; tab.setAttribute("aria-pressed", String(this.tab === key)); tabs.append(tab);
      }
      this.body.prepend(tabs);
    }
    this.renderFooter(garage);
    const closeKey = this.closeButton.querySelector("kbd");
    if (closeKey) closeKey.hidden = !!this.screen.querySelector("#garage-back");
    this.scene.select(this.viewed, this.selectedPart, this.tab === "test", this.tab === "paint");
    this.scene.animating = true; this.hooks.requestRender(); this.syncStrip();
    this.marker.hidden = this.leader.hidden = !this.selectedPart;
    if (focusKey) this.screen.querySelector<HTMLElement>(`[data-key="${focusKey}"]`)?.focus({preventScroll: true});
  }

  private renderFooter(garage: Garage): void {
    this.footer.replaceChildren();
    this.footer.hidden = this.tab !== "craft" && !this.selectedPart;
    this.footer.setAttribute("aria-label", this.selectedPart ? "Switch service part" : "Choose craft");
    if (this.selectedPart) {
      const back = button("garage__button", "whole", () => this.back());
      back.id = "garage-back"; back.append(node("span", "", "WHOLE CRAFT"), this.keycap("back", "ESC"));
      this.footer.append(back);
      for (const part of PART_CARDS) {
        const code = part.code as PartCode;
        const stage = garage.fleet[garage.chassis]?.parts[code] ?? 0;
        const chip = button("garage__part-chip", `switch-${code}`, () => this.choosePart(code));
        chip.append(node("strong", "", part.label), node("small", "", stage ? `STAGE ${ROMAN[stage]}` : "STOCK"));
        chip.setAttribute("aria-pressed", String(code === this.selectedPart)); this.footer.append(chip);
      }
    } else {
      for (const card of FRAME_CARDS) {
        const chip = button("garage__frame", `frame-${card.code}`, () => { this.viewed = card.code; this.showTab("craft"); });
        chip.setAttribute("aria-label", `${card.label}, ${garage.chassis === card.code ? "on the grid" : Object.hasOwn(garage.fleet, card.code) ? "owned" : formatCredits(card.price)}`);
        chip.setAttribute("aria-pressed", String(card.code === this.viewed));
        chip.style.setProperty("--frame-team", TEAM_COLORS[card.code]);
        chip.append(node("b", "", FLEET_CODES[card.code]), node("span", "", card.label.split(" ")[0]),
          node("small", "", garage.chassis === card.code ? "GRID" : Object.hasOwn(garage.fleet, card.code) ? "OWNED" : formatCredits(card.price)));
        this.footer.append(chip);
      }
    }
  }

  private stats(handling: Readonly<Handling>, reference: Readonly<Handling>): HTMLElement {
    const list = node("dl", "garage__stats");
    for (const row of STAT_ROWS) {
      const rating = Math.round(statFill(row.stat, handling[row.stat]) * 100);
      const stock = Math.round(statFill(row.stat, reference[row.stat]) * 100);
      const delta = rating - stock;
      const item = node("div", "garage__stat");
      const bar = node("span", "garage__bar");
      const fill = node("i", "garage__fill"); fill.style.setProperty("--fill", String(rating / 100));
      const mark = node("b", "garage__mark"); mark.style.setProperty("--fill", String(stock / 100)); bar.append(fill, mark);
      const detail = node("dd");
      detail.append(node("strong", "", String(rating)), node("span", "garage__comparison", `vs ${stock}`), node("b", "garage__delta", `${delta > 0 ? "+" : delta === 0 ? "±" : ""}${delta}`), bar);
      item.append(node("dt", "", row.label), detail); list.append(item);
    }
    return list;
  }

  private renderCraft(garage: Garage): HTMLElement[] {
    const card = frameCard(this.viewed), owned = Object.hasOwn(garage.fleet, this.viewed);
    const stockGarage = { ...garage, fleet: { ...garage.fleet, [this.viewed]: defaultFit() } };
    const detail = node("div", "garage__comparison-panel");
    detail.append(node("h2", "garage__card-title", "HEAD TO HEAD"), node("p", "garage__card-note", this.viewed === garage.chassis ? "FITTED VS STOCK · RATINGS / 100" : "THIS FRAME VS YOUR GRID CRAFT · RATINGS / 100"),
      this.stats(frameHandling(garage, this.viewed), frameHandling(this.viewed === garage.chassis ? stockGarage : garage, this.viewed === garage.chassis ? this.viewed : garage.chassis)));
    const commerce = node("div", "garage__commerce");
    const short = Math.max(0, card.price - garage.credits), licence = garage.contracts.done < card.licence;
    commerce.append(node("p", "garage__status", owned ? "IN YOUR FLEET" : licence ? `${card.licence} CONTRACTS REQUIRED` : short ? `${formatCredits(short)} SHORT` : "AVAILABLE TO BUY"));
    if (this.pending) commerce.append(this.purchaseOrder());
    else {
      const action = button("garage__button garage__primary", "frame-action", () => owned
        ? this.commit(selectFrame(this.hooks.save.garage, card.code), `${card.label} ON THE GRID`)
        : this.offerFrame());
      action.textContent = card.code === garage.chassis ? "ON THE GRID" : owned ? "SET ON GRID" : `BUY ${FLEET_CODES[card.code]} · ${formatCredits(card.price)}`;
      action.disabled = card.code === garage.chassis || !owned && (short > 0 || licence); commerce.append(action);
    }
    if (!owned && (short || licence)) {
      const earn = button("garage__button", "earn", () => this.showTab("contracts")); earn.textContent = "FIND A PAYING CONTRACT"; commerce.append(earn);
    }
    if (card.code === garage.chassis) {
      const fit = garage.fleet[card.code] ?? defaultFit();
      const ready = PART_CARDS.filter(part => fit.parts[part.code as PartCode] < 3 && part.prices[fit.parts[part.code as PartCode]] <= garage.credits).length;
      const upgrade = button("garage__button garage__primary", "upgrade-craft", () => this.showTab("parts"));
      upgrade.textContent = ready ? `UPGRADE CRAFT · ${ready} READY` : "PLAN YOUR NEXT UPGRADE";
      commerce.append(upgrade);
    }
    detail.append(commerce); return [detail];
  }

  private offerFrame(): void {
    const card = frameCard(this.viewed);
    this.pending = {label: card.label, price: card.price, key: "frame-action", confirm: () => buyFrame(this.hooks.save.garage, card.code)};
    this.render(); this.focusConfirm();
  }

  private purchaseOrder(): HTMLElement {
    const pending = this.pending!;
    const order = node("div", "garage__purchase"); order.setAttribute("role", "group"); order.setAttribute("aria-label", `Confirm ${pending.label}`);
    const balance = this.hooks.save.garage.credits - pending.price;
    order.append(node("strong", "", pending.label), node("p", "", `${formatCredits(pending.price)} · ${balance < 0 ? `NEED ${formatCredits(-balance)} MORE` : `LEAVES ${formatCredits(balance)}`}`));
    const confirm = button("garage__button garage__primary", "confirm-purchase", () => this.commit(pending.confirm(), `${pending.label} FITTED`, pending.key));
    confirm.textContent = "CONFIRM PURCHASE"; confirm.disabled = this.hooks.save.garage.credits < pending.price;
    const cancel = button("garage__button", "cancel-purchase", () => this.back()); cancel.textContent = "CANCEL"; cancel.id = "garage-back";
    order.append(confirm, cancel); return order;
  }

  private choosePart(part: PartCode): void {
    this.setNote("", "idle");
    this.selectedPart = part; this.fittedPart = null; this.pending = null; this.endDemo();
    this.previewUpgrade = (this.hooks.save.garage.fleet[this.viewed]?.parts[part] ?? 0) < MAX_PART_STAGE;
    this.previewPart(); this.render(); this.motion.enter(this.body, 16, 0);
    this.sound.cue();
    (this.body.querySelector<HTMLButtonElement>('[data-key="fit-part"]:not(:disabled), [data-key="done-part"]') ?? this.body.querySelector<HTMLButtonElement>('[data-key="cancel-part"]'))?.focus({preventScroll: true});
  }

  private previewPart(): void {
    const garage = this.hooks.save.garage, part = this.selectedPart;
    const fit = garage.fleet[garage.chassis] ?? defaultFit();
    this.trial = part && this.previewUpgrade ? {...garage, fleet: {...garage.fleet, [garage.chassis]: {...fit, parts: {...fit.parts, [part]: Math.min(MAX_PART_STAGE, fit.parts[part] + 1)}}}} : null;
    this.refit(null, this.trial);
  }

  private renderParts(garage: Garage): HTMLElement[] {
    const fit = garage.fleet[garage.chassis] ?? defaultFit();
    if (!this.selectedPart) {
      const list = node("div", "garage__parts");
      const available = PART_CARDS.filter(card => fit.parts[card.code as PartCode] < MAX_PART_STAGE && card.prices[fit.parts[card.code as PartCode]] <= garage.credits).length;
      const remaining = PART_CARDS.filter(card => fit.parts[card.code as PartCode] < MAX_PART_STAGE);
      const gap = remaining.length ? Math.max(0, Math.min(...remaining.map(card => card.prices[fit.parts[card.code as PartCode]])) - garage.credits) : 0;
      list.append(node("h2", "garage__card-title", available ? `${available} UPGRADES READY` : remaining.length ? "YOUR NEXT UPGRADE" : "BUILD COMPLETE"),
        node("p", "garage__card-note", available ? `${formatCredits(garage.credits)} TO SPEND · CHOOSE ONE TO PREVIEW` : remaining.length ? `${formatCredits(gap)} TO YOUR NEXT PART · RACE CONTRACTS TO EARN` : "EVERY PART AT STAGE III · TAKE IT TO THE GRID"));
      const current = handlingFor(garage);
      for (const card of PART_CARDS) {
        const code = card.code as PartCode, stage = fit.parts[code];
        const rule = PARTS.find(part => part.code === code)!;
        const next = handlingFor({...garage, fleet: {...garage.fleet, [garage.chassis]: {...fit, parts: {...fit.parts, [code]: Math.min(3,stage + 1)}}}});
        const from = Math.round(statFill(rule.stat, current[rule.stat]) * 100), to = Math.round(statFill(rule.stat, next[rule.stat]) * 100);
        const price = card.prices[stage] ?? 0, affordable = stage < 3 && garage.credits >= price;
        const part = button("garage__part", `part-${code}`, () => this.choosePart(code));
        part.dataset.affordable = String(affordable);
        part.append(node("strong", "", card.label), node("span", "", stage === 3 ? `${card.stat} ${from} · MAX` : `${card.stat} ${from} → ${to} · +${to - from}`),
          node("b", "", stage === 3 ? "III / III" : `${stage ? ROMAN[stage] : "STOCK"} → ${ROMAN[stage + 1]}`),
          node("small", "", stage === 3 ? "FULLY FITTED" : affordable ? `FIT NOW · ${formatCredits(price)}` : `NEED ${formatCredits(price - garage.credits)} MORE`));
        const progress = node("div", "garage__stages"); progress.setAttribute("aria-hidden", "true");
        for (let step = 1; step <= 3; step++) { const bar = node("i"); bar.dataset.fitted = String(step <= stage); bar.dataset.next = String(step === stage + 1); progress.append(bar); }
        part.append(progress);
        list.append(part);
      }
      if (!available && remaining.length) {
        const jobs = button("garage__button garage__primary", "earn-upgrades", () => this.showTab("contracts")); jobs.textContent = "FIND A PAYING CONTRACT"; list.append(jobs);
      }
      return [list];
    }
    const code = this.selectedPart, card = PART_CARDS.find(part => part.code === code)!;
    const stage = fit.parts[code], maxed = stage === MAX_PART_STAGE, fitted = this.fittedPart === code;
    const part = PARTS.find(part => part.code === code)!;
    const current = handlingFor(garage);
    const next = handlingFor({...garage, fleet: {...garage.fleet, [garage.chassis]: {...fit, parts: {...fit.parts, [code]: Math.min(3, stage + 1)}}}});
    const from = Math.round(statFill(part.stat, current[part.stat]) * 100), to = Math.round(statFill(part.stat, next[part.stat]) * 100);
    const price = maxed ? 0 : card.prices[stage], short = Math.max(0, price - garage.credits);
    const order = node("section", "garage__work-order");
    order.dataset.fitted = String(fitted);
    order.setAttribute("aria-label", `${card.label} work order`);
    order.append(node("p", "garage__order-label", fitted ? "FITTED · READY FOR THE GRID" : "WORK ORDER · SERVICE"), node("h2", "", card.label),
      node("p", "garage__stage", fitted || maxed ? `STAGE ${ROMAN[stage]}` : `${stage ? ROMAN[stage] : "STOCK"} → ${ROMAN[stage + 1]}`),
      node("p", "garage__rating", `${card.stat} RATING ${from}${maxed || fitted ? "" : ` → ${to} · +${to - from}`}`), node("small", "garage__part-location", FRAME_ANCHORS[this.viewed][code].label));
    order.append(node("p", "garage__benefit", PART_BENEFITS[code]), node("p", "garage__hardware", PART_HARDWARE[code][Math.max(0, (fitted || maxed ? stage : stage + 1) - 1)]));
    if (!fitted && !maxed) {
      const compare = node("div", "garage__compare-build"); compare.setAttribute("role", "group"); compare.setAttribute("aria-label", "Preview upgrade hardware");
      for (const [next,label] of [[false,"FITTED"],[true,`PREVIEW ${ROMAN[stage + 1]}`]] as const) {
        const toggle = button("garage__button", next ? "preview-next" : "preview-fitted", () => { this.previewUpgrade = next; this.previewPart(); this.render(); });
        toggle.textContent = label; toggle.setAttribute("aria-pressed", String(this.previewUpgrade === next)); compare.append(toggle);
      }
      order.append(compare, node("small", "garage__preview-label", this.previewUpgrade ? "NEXT STAGE ON CRAFT · NOT PURCHASED" : "YOUR CURRENT FITTED HARDWARE"));
    }
    if (!fitted && !maxed) order.append(node("strong", "garage__price", formatCredits(price)), node("p", "garage__balance", short ? `NEED ${formatCredits(short)} MORE` : `YOU HAVE ${formatCredits(garage.credits)} · LEAVES ${formatCredits(garage.credits - price)}`));
    if (short && !fitted) {
      const contract = garage.contracts.active.map(contractFor).sort((a,b) => b.reward - a.reward)[0];
      const earn = button("garage__button garage__earn", "earn", () => this.showTab("contracts"));
      earn.textContent = `${this.hooks.tracks.find(track => track.selection === contract.track)?.label ?? contract.track} · +${formatCredits(contract.reward)}`;
      order.append(earn);
    }
    const actions = node("div", "garage__order-actions");
    const cancel = button("garage__button", "cancel-part", () => this.back()); cancel.textContent = "CANCEL";
    if (maxed || fitted) {
      const done = button("garage__button garage__primary", "done-part", () => this.back()); done.textContent = "DONE"; actions.append(done);
    } else {
      const confirm = button("garage__button garage__primary", "fit-part", () => this.commit(buyPart(this.hooks.save.garage, code), `${card.label} FITTED`));
      confirm.textContent = short > 0 ? `NEED ${formatCredits(short)} MORE` : `FIT ${ROMAN[stage + 1]}`; confirm.disabled = short > 0; actions.append(cancel, confirm);
    }
    order.append(actions); return [order];
  }

  private focusConfirm(): void { this.body.querySelector<HTMLButtonElement>('[data-key="confirm-purchase"]')?.focus({preventScroll: true}); }

  private offerPaint(label: string, price: number, confirm: () => Transaction, key: string): void {
    if (price === 0) { this.commit(confirm(), label, key); return; }
    this.pending = {label, price, confirm, key}; this.render(); this.focusConfirm();
  }

  private renderPaint(garage: Garage): HTMLElement[] {
    const fit = garage.fleet[garage.chassis] ?? defaultFit();
    const tabs = node("nav", "garage__paint-tabs"); tabs.setAttribute("aria-label", "Paint slot");
    for (const [code, label] of [["flame", "FLAME"], ["body", "BODY"], ["glow", "LIGHTS"], ["under", "UNDERGLOW"], ["pattern", "PATTERN"]] as const) {
      const tab = button("garage__button", `slot-${code}`, () => { this.pending = null; this.paintSlot = code; this.previewLook(null); this.render(); });
      tab.textContent = label; tab.setAttribute("aria-pressed", String(this.paintSlot === code)); tabs.append(tab);
    }
    let row: HTMLElement;
    if (this.paintSlot === "body") row = this.renderBody(garage, fit, frameCard(garage.chassis).label);
    else if (this.paintSlot === "pattern") row = this.renderPatterns(garage, fit)[0];
    else {
      const slot = PAINT_SLOTS.find(slot => slot.code === this.paintSlot)!;
      const chips = node("div", "garage__paints");
      for (const paint of PAINT_CARDS) {
        if (slot.code === "under" ? paint.code === "stock" : paint.code === "off") continue;
        const owned = garage.paints.includes(paint.code), price = owned ? 0 : paint.price;
        const chip = this.previewable(button("garage__paint", `paint-${slot.code}-${paint.code}`, () => this.offerPaint(`${slot.label} · ${paint.label}`, price,
          () => fitPaint(this.hooks.save.garage, slot.code, paint.code), `paint-${slot.code}-${paint.code}`)), {[slot.code]: paint.code});
        chip.setAttribute("role", "radio"); chip.setAttribute("aria-checked", String(fit[slot.code] === paint.code));
        const swatch = node("i", "garage__swatch"), shown = resolvePaint(garage.chassis, slot.code, paint.code);
        if (shown !== null) swatch.style.setProperty("--swatch", hexColor(shown));
        else swatch.dataset.swatch = paint.code === "off" ? "off" : "works";
        chip.dataset.affordable = String(!owned && garage.credits >= price);
        chip.append(swatch, node("strong", "", paint.label), node("small", "", owned ? "OWNED · FIT FREE" : garage.credits < price ? `${formatCredits(price - garage.credits)} SHORT` : formatCredits(price))); chips.append(chip);
      }
      row = this.paintRow(slot.label, chips);
    }
    const panel = node("div", "garage__paint-panel"); panel.append(tabs, row);
    if (this.pending) panel.append(this.purchaseOrder());
    return [panel];
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
        this.offerPaint(`${card.label} · ${label}`, owned ? 0 : card.price ?? 0, () => fitBody(this.hooks.save.garage, code), `body-${code}`);
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
        owned ? "OWNED · FIT FREE" : card.price === null ? "7-DAY STREAK" : garage.credits < card.price ? `${formatCredits(card.price - garage.credits)} SHORT` : formatCredits(card.price)));
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
        this.offerPaint(`UNDERGLOW · ${pattern.label}`, owned ? 0 : pattern.price, () => fitPattern(this.hooks.save.garage, pattern.code), `pattern-${pattern.code}`);
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
      this.pending = null;
      if (this.selectedPart) this.fittedPart = this.selectedPart;
      this.previewUpgrade = false;
      this.trial = null; this.refit(null); this.render(); this.animate();
      this.motion.fitted(this.body); this.motion.fitted(this.credits); this.sound.cue(true);
      this.screen.querySelector<HTMLButtonElement>(this.selectedPart ? '[data-key="done-part"]' : `[data-key="${key || "frame-action"}"]`)?.focus({preventScroll: true});
      refreshRewardOffer(this.hooks.save.garage);
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
    this.note.textContent = text;
    this.note.dataset.tone = tone;
    this.note.hidden = !text;
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

  private back(): void {
    if (this.pending) { const key = this.pending.key; this.pending = null; this.previewLook(null); this.render(); this.screen.querySelector<HTMLButtonElement>(`[data-key="${key}"]`)?.focus({preventScroll: true}); return; }
    if (this.selectedPart) { this.selectedPart = null; this.fittedPart = null; this.previewUpgrade = false; this.trial = null; this.refit(null); this.render(); this.motion.enter(this.body, -16, 0); this.body.querySelector<HTMLButtonElement>("button")?.focus(); return; }
    if (this.tab === "contracts" || this.tab === "daily") { this.showTab("craft"); return; }
    this.hide();
  }

  /** Keys aimed at the panel stay in the panel; Tab still moves focus. */
  private readonly handlePanelKeys = (event: KeyboardEvent): void => {
    const digit = Number(event.key);
    if (Number.isInteger(digit) && digit >= 1 && digit <= TABS.length && !event.repeat) {
      this.showTab(TABS[digit - 1].code);
      this.tabButtons[digit - 1]?.focus({ preventScroll: true });
    }
    if (event.key === "Tab") {
      const controls = [...this.screen.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]')].filter(control => control.getClientRects().length > 0 && control.tabIndex >= 0);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    } else event.stopPropagation();
  };

  private readonly handleWindowKeys = (event: KeyboardEvent): void => {
    if (!this.opened) return;
    if (event.key.toLowerCase() === "m") { event.preventDefault(); event.stopPropagation(); if (!event.repeat) this.hooks.toggleSound(); this.syncSound(); return; }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.back();
      return;
    }
    if (event.target instanceof Node && this.screen.contains(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
  };
}
