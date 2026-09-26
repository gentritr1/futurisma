import {isMenuOnlyKey} from './menu-key.js';
/**
 * P7 — the meta layer's DOM: circuit dispatch, livery issue and the service
 * terminal.
 *
 * The fiction is the constraint. PRODUCT.md's anti-reference is "clean luxury
 * spacecraft and contemporary automotive dashboards", so none of this is a
 * settings menu with a gear icon: it is the same KAIRO DYNAMICS terminal the
 * rest of the game speaks, built from the panel's existing vocabulary — mono
 * type, thin rules, acid accents, and rows that read like a dispatch sheet.
 *
 * It lives outside `ui.ts` because `ui.ts` owns the *race* HUD and this owns
 * everything around it; the two only meet through a handful of `GameUi` calls.
 */
import { LIVERIES, liveryFor } from "./liveries.js";
import type { MapSelection } from "./map-selection";
import { TRACKS, trackFor } from "./map-selection";
import { storedBestLapMs } from "./meta-runtime";
import { save } from "./persistence";
import { applyInterfaceScale } from "./interface-scale.js";
import {
  RACE_MODES,
  RACE_MODE_DECKS,
  RACE_MODE_LABELS,
  RIVAL_TIERS,
  RIVAL_TIER_DECKS,
  RIVAL_TIER_LABELS,
} from "./race-modes-rules.js";
import { raceModes } from "./race-modes";
import type { GameUi } from "./ui";

/** Everything the meta layer needs from the running game, and nothing more. */
export interface MetaUiHooks {
  /** Swaps the player's decal sheet and re-issues the field, live. */
  applyLivery(code: string): Promise<void>;
  setMasterVolume(volume: number): void;
  setMusicVolume(volume: number): void;
  /** Drops any action the overlay just swallowed before the game sees it. */
  suspendInput(): void;
  /** Garage — opens the works bay; it decides for itself whether it may. */
  openGarage(): void;
}

/**
 * What the running build actually resolved, for the pending-relink notice.
 *
 * The `*Forced` flags say a QA override or the operating system is holding a
 * value the panel cannot move. Without them the notice would sit there telling
 * a soak run to relink for a setting that a relink would ignore.
 */
export interface ActivePresentation {
  quality: string;
  renderMode: string;
  reducedMotion: boolean;
  qualityForced: boolean;
  renderForced: boolean;
  motionForced: boolean;
}

interface ChipSpec {
  value: string;
  label: string;
  note?: string;
}

function requiredElement<T extends HTMLElement>(elementId: string): T {
  const element = document.getElementById(elementId);
  if (!element) throw new Error(`Missing required UI element: #${elementId}`);
  return element as T;
}

/**
 * A row of terminal chips behaving as an ARIA radiogroup with roving tabindex.
 *
 * `commit: "select"` is the ordinary radio pattern — an arrow key both moves
 * and chooses. `commit: "confirm"` moves focus without choosing, and only
 * Enter, Space or a click commits; the circuit row uses it because committing
 * a circuit navigates the page, and an arrow key must never do that by
 * accident.
 */
class ChipGroup {
  private readonly buttons: HTMLButtonElement[] = [];
  private selected = 0;
  private focused = 0;

  constructor(
    private readonly container: HTMLElement,
    specs: readonly ChipSpec[],
    private readonly commit: "select" | "confirm",
    private readonly onCommit: (value: string) => void,
  ) {
    const fragment = document.createDocumentFragment();
    for (const spec of specs) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chip";
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", "false");
      button.dataset.value = spec.value;
      button.tabIndex = -1;
      const label = document.createElement("strong");
      label.textContent = spec.label;
      button.append(label);
      if (spec.note) {
        const note = document.createElement("small");
        note.textContent = spec.note;
        button.append(note);
      }
      button.addEventListener("click", () => {
        this.focusAt(this.buttons.indexOf(button));
        this.choose(this.focused);
      });
      this.buttons.push(button);
      fragment.append(button);
    }
    container.replaceChildren(fragment);
    container.addEventListener("keydown", this.handleKeyDown);
  }

  /** Sets the checked chip without firing `onCommit` (the load-time sync). */
  setValue(value: string): void {
    const index = this.buttons.findIndex((button) => button.dataset.value === value);
    this.selected = index < 0 ? 0 : index;
    this.focused = this.selected;
    this.buttons.forEach((button, at) => {
      const checked = at === this.selected;
      button.setAttribute("aria-checked", checked ? "true" : "false");
      button.tabIndex = at === this.focused ? 0 : -1;
    });
  }

  private choose(index: number): void {
    const value = this.buttons[index]?.dataset.value;
    if (value === undefined) return;
    if (this.commit === "select") this.setValue(value);
    this.onCommit(value);
  }

  private focusAt(index: number): void {
    this.focused = Math.max(0, Math.min(this.buttons.length - 1, index));
    this.buttons.forEach((button, at) => {
      button.tabIndex = at === this.focused ? 0 : -1;
    });
    this.buttons[this.focused]?.focus({ preventScroll: true });
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown"
      ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? -1
        : 0;
    if (step !== 0) {
      // Wraps, so a gamepad d-pad or a repeated arrow always reaches every
      // chip without the user having to know where the row ends.
      const next = (this.focused + step + this.buttons.length) % this.buttons.length;
      this.focusAt(next);
      if (this.commit === "select") this.choose(next);
    } else if (event.key === "Home") this.focusAt(0);
    else if (event.key === "End") this.focusAt(this.buttons.length - 1);
    else if (event.key === "Enter" || event.key === " ") this.choose(this.focused);
    else return;
    event.preventDefault();
    // The race loop listens for Enter and the arrow keys on `window`. Stopping
    // here is what keeps choosing a livery from also launching the race.
    event.stopPropagation();
  };

  dispose(): void {
    this.container.removeEventListener("keydown", this.handleKeyDown);
  }
}

export class MetaUi {
  private navigation: import('./menu-navigation').MenuNavigation | null = null;
  private navigationLoading: Promise<import('./menu-navigation').MenuNavigation> | null = null;
  private readonly optionsButton = requiredElement<HTMLButtonElement>("options-button");
  private readonly optionsRelink = requiredElement<HTMLButtonElement>("options-relink");
  private readonly optionsNote = requiredElement<HTMLElement>("options-note");
  private readonly masterSlider = requiredElement<HTMLInputElement>("option-master");
  private readonly masterValue = requiredElement<HTMLElement>("option-master-value");
  private readonly musicSlider = requiredElement<HTMLInputElement>("option-music");
  private readonly musicValue = requiredElement<HTMLElement>("option-music-value");
  private readonly trackGroup: ChipGroup;
  private readonly formatGroup: ChipGroup;
  private readonly tierGroup: ChipGroup;
  private readonly liveryGroup: ChipGroup;
  private readonly motionGroup: ChipGroup;
  private readonly hudScaleGroup: ChipGroup;
  private readonly menuScaleGroup: ChipGroup;
  private readonly voiceGroup: ChipGroup;
  private readonly qualityGroup: ChipGroup;
  private readonly renderGroup: ChipGroup;

  constructor(
    private readonly ui: GameUi,
    private readonly selection: MapSelection,
    private readonly active: ActivePresentation,
    private readonly hooks: MetaUiHooks,
  ) {
    this.trackGroup = new ChipGroup(
      requiredElement<HTMLElement>("track-select"),
      TRACKS.map((track) => ({
        value: track.selection,
        label: track.label,
        note: `${track.mapCode} · ${track.deck}`,
      })),
      "confirm",
      (value) => this.dispatchCircuit(value as MapSelection),
    );
    // G4 — the format and the field. Both commit with `"confirm"` and both
    // dispatch by navigating, for exactly the reason the circuit row does: the
    // lap count, whether a fleet is spawned at all and which pace table it
    // drives are all read once at load, so changing one means relinking with
    // the `?mode=` / `?tier=` a soak command already uses. An arrow key must
    // never be able to reload the page by drifting across the row.
    this.formatGroup = new ChipGroup(
      requiredElement<HTMLElement>("format-select"),
      RACE_MODES.map((mode) => ({
        value: mode,
        label: RACE_MODE_LABELS[mode],
        // Phase D — Dream Island's row says what each format DOES to the map's
        // one mechanic, because that is the choice being made: the clock
        // strikes on the last lap of a race, on lap 2 of the sprint, and the
        // solo run keeps the night turn because there is no field to hide it
        // behind. The lap counts are the course's own (3, and the sprint's 2),
        // not the five-lap default this row prints for the older circuits.
        note: selection === "dreamisland"
          ? mode === "sprint" ? "2 LAPS · DEFEND · NIGHT ON LAP 2"
            : mode === "timeattack" ? "3 LAPS · SOLO + GHOST · NIGHT LAP"
            : "3 LAPS · FULL FIELD · NIGHT LAP"
          : selection === "polarity" || selection === "tideline"
          ? mode === "sprint" ? "2 LAPS · DEFEND" : mode === "timeattack" ? "3 LAPS · SOLO" : "3 LAPS · FULL FIELD"
          : selection === "nightshift" ? RACE_MODE_DECKS[mode].replace("5 LAPS", "3 LAPS") : RACE_MODE_DECKS[mode],
      })),
      "confirm",
      (value) => this.dispatchFormat("mode", value),
    );
    this.tierGroup = new ChipGroup(
      requiredElement<HTMLElement>("tier-select"),
      RIVAL_TIERS.map((tier) => ({
        value: tier,
        label: RIVAL_TIER_LABELS[tier],
        note: RIVAL_TIER_DECKS[tier],
      })),
      "confirm",
      (value) => this.dispatchFormat("tier", value),
    );
    this.liveryGroup = new ChipGroup(
      requiredElement<HTMLElement>("livery-select"),
      LIVERIES.map((livery) => ({
        value: livery.code,
        label: livery.label,
        note: livery.deck,
      })),
      "select",
      (value) => {
        void this.hooks.applyLivery(value);
      },
    );
    /*
      The two interface scales. Unlike damping, resolution and pipeline, these
      need no relink: both are CSS custom properties on `<body>` that every
      block reads through `scale()`, so writing them applies on the next frame.
      That is why they call `applyInterfaceScale` directly instead of going
      through `refreshPending`'s pending-relink path.
    */
    const scaleChips = [
      { value: "s", label: "S" },
      { value: "m", label: "M" },
      { value: "l", label: "L" },
    ];
    this.hudScaleGroup = new ChipGroup(
      requiredElement<HTMLElement>("option-hud-scale"),
      scaleChips,
      "select",
      (value) => {
        save.updateSettings({ hudScale: value as "s" | "m" | "l" });
        applyInterfaceScale(save.settings);
      },
    );
    this.menuScaleGroup = new ChipGroup(
      requiredElement<HTMLElement>("option-menu-scale"),
      scaleChips,
      "select",
      (value) => {
        save.updateSettings({ menuScale: value as "s" | "m" | "l" });
        applyInterfaceScale(save.settings);
      },
    );
    this.motionGroup = new ChipGroup(
      requiredElement<HTMLElement>("option-motion"),
      [
        { value: "off", label: "OFF" },
        { value: "on", label: "ON" },
      ],
      "select",
      (value) => this.storeSetting({ reducedMotion: value === "on" }),
    );
    // H2b — the pit radio, and the only choice row on this panel that applies
    // LIVE. Damping, resolution and pipeline are all read once at construction
    // by the renderer and five motion consumers, so they honestly need a
    // relink; the voice is re-read on every audio control tick, so it belongs
    // with the two volume sliders rather than behind `refreshPending`. ON is
    // first because it is the default, which is the ordering the OFF/ON motion
    // row above deliberately inverts for the same reason.
    this.voiceGroup = new ChipGroup(
      requiredElement<HTMLElement>("option-voice"),
      [
        { value: "on", label: "ON" },
        { value: "off", label: "OFF" },
      ],
      "select",
      (value) => this.storeSetting({ voice: value === "on" }),
    );
    this.qualityGroup = new ChipGroup(
      requiredElement<HTMLElement>("option-quality"),
      [
        { value: "adaptive", label: "ADAPTIVE" },
        { value: "high", label: "HIGH" },
        { value: "low", label: "LOW" },
      ],
      "select",
      (value) => this.storeSetting({ quality: value as "adaptive" | "high" | "low" }),
    );
    this.renderGroup = new ChipGroup(
      requiredElement<HTMLElement>("option-render"),
      [
        { value: "agx", label: "AGX FILMIC" },
        { value: "ps2", label: "PS2 COMPOSITE" },
      ],
      "select",
      (value) => this.storeSetting({ renderMode: value as "agx" | "ps2" }),
    );

    this.masterSlider.addEventListener("input", this.handleMasterInput);
    this.musicSlider.addEventListener("input", this.handleMusicInput);
    this.optionsButton.addEventListener("click", this.handleOpenClick);
    this.optionsRelink.addEventListener("click", this.handleRelinkClick);
    window.addEventListener("keydown", this.handleWindowKeyDown, { capture: true });
    document.getElementById('controls-button')!.addEventListener('click',this.handleControlsOpen);


    this.syncFromSave();
  }

  /** Repaints the start screen's record line for the dispatched circuit. */
  syncRecord(): void {
    const track = trackFor(this.selection);
    // G4 — the record line names the FORMAT it belongs to. `storedBestLapMs`
    // now answers per map, mode and tier, so a line that said only
    // "GREENWATER STRIP · BEST LAP 00:32.517" would be advertising a target
    // without saying which race it was set in — and would appear to change on
    // its own when the player moved the field chip.
    this.ui.setStoredBest(
      storedBestLapMs(track.mapCode),
      `${track.label} · ${RACE_MODE_LABELS[raceModes.mode]} · ${
        RIVAL_TIER_LABELS[raceModes.tier]}`,
    );
  }

  /** Garage — the bay issued a livery; the paddock's LIVERY row follows it. */
  showLivery(code: string): void {
    this.liveryGroup.setValue(code);
  }

  private syncFromSave(): void {
    const settings = save.settings;
    this.trackGroup.setValue(this.selection);
    // G4 — the RESOLVED format, not the stored one. `?mode=` and `?tier=` are
    // overrides that win, so a soak launched with `&tier=feral` has to show the
    // chip row saying FERAL; syncing from the save file would put the panel and
    // the race it is sitting in front of into disagreement.
    this.formatGroup.setValue(raceModes.mode);
    this.tierGroup.setValue(raceModes.tier);
    this.liveryGroup.setValue(save.livery);
    this.motionGroup.setValue(settings.reducedMotion ? "on" : "off");
    this.hudScaleGroup.setValue(settings.hudScale);
    this.menuScaleGroup.setValue(settings.menuScale);
    this.voiceGroup.setValue(settings.voice ? "on" : "off");
    this.qualityGroup.setValue(settings.quality);
    this.renderGroup.setValue(settings.renderMode);
    this.masterSlider.value = String(settings.masterVolume);
    this.musicSlider.value = String(settings.musicVolume);
    this.masterValue.textContent = formatLevel(settings.masterVolume);
    this.musicValue.textContent = formatLevel(settings.musicVolume);
    this.hooks.setMasterVolume(settings.masterVolume);
    this.hooks.setMusicVolume(settings.musicVolume);
    this.ui.setRaceModeLabel(RACE_MODE_LABELS[raceModes.mode]);
    this.ui.setPlayerLivery(liveryFor(save.livery).label, []);
    this.syncRecord();
    this.refreshPending();
  }

  /**
   * Committing a circuit navigates: the course module is chosen at load, so
   * dispatching a different one means reloading with the `?map=` the QA
   * override already uses. The choice is stored first, so a bare reload later
   * lands on the same circuit.
   */
  private dispatchCircuit(track: MapSelection): void {
    save.setTrack(track);
    if (track === this.selection) {
      this.trackGroup.setValue(track);
      return;
    }
    const parameters = new URLSearchParams(window.location.search);
    parameters.set("map", track);
    window.location.search = parameters.toString();
  }

  /**
   * G4 — commits a format or a field strength, which means relinking.
   *
   * Deliberately the same shape as {@link dispatchCircuit}, including the
   * store-then-navigate order: the choice is written first so that a bare
   * reload later — or a crash between the two — lands on what the player asked
   * for rather than on what the URL happened to carry. Choosing the value this
   * session already loaded re-checks the chip and does nothing else, because
   * navigating to the page you are on to change nothing is a reload the player
   * did not ask for.
   *
   * The URL keeps every OTHER parameter it had. A soak driving `?map=` and
   * `?diagnostics=` through the panel must not lose them by picking a tier.
   */
  private dispatchFormat(parameter: "mode" | "tier", value: string): void {
    const active = parameter === "mode" ? raceModes.mode : raceModes.tier;
    if (parameter === "mode") save.setRaceMode(value);
    else save.setTier(value);
    if (value === active) {
      (parameter === "mode" ? this.formatGroup : this.tierGroup).setValue(value);
      return;
    }
    const parameters = new URLSearchParams(window.location.search);
    parameters.set(parameter, value);
    window.location.search = parameters.toString();
  }

  private storeSetting(patch: Parameters<typeof save.updateSettings>[0]): void {
    save.updateSettings(patch);
    this.refreshPending();
  }

  /**
   * Damping, resolution and pipeline are all read once at construction — by the
   * renderer, the material treatments and five motion consumers — so changing
   * one is honest about needing a relink rather than pretending to apply.
   */
  private refreshPending(): void {
    const settings = save.settings;
    const pending = (!this.active.qualityForced && settings.quality !== this.active.quality)
      || (!this.active.renderForced && settings.renderMode !== this.active.renderMode)
      || (!this.active.motionForced && settings.reducedMotion !== this.active.reducedMotion);
    this.optionsNote.dataset.pending = pending ? "true" : "false";
    this.optionsNote.textContent = pending
      ? "CONFIGURATION CHANGED · RELINK TO APPLY"
      : "LEVELS, RADIO AND INTERFACE SIZE APPLY LIVE · DAMPING, RESOLUTION AND PIPELINE ON NEXT RELINK";
    this.optionsRelink.hidden = !pending;
  }

  private readonly handleMasterInput = (): void => {
    const volume = save.updateSettings({
      masterVolume: Number(this.masterSlider.value),
    }).masterVolume;
    this.masterValue.textContent = formatLevel(volume);
    this.hooks.setMasterVolume(volume);
  };

  private readonly handleMusicInput = (): void => {
    const volume = save.updateSettings({
      musicVolume: Number(this.musicSlider.value),
    }).musicVolume;
    this.musicValue.textContent = formatLevel(volume);
    this.hooks.setMusicVolume(volume);
  };

  private openMenu(surface:'controls'|'options'): void {
    this.hooks.suspendInput();
    this.navigationLoading ??= import('./menu-navigation').then(({MenuNavigation})=>this.navigation=new MenuNavigation(this.hooks.suspendInput));
    void this.navigationLoading.then(menu=>{if(['intro','paused','result'].includes(document.body.dataset.phase??'intro'))menu.show(surface);});
  }
  private readonly handleOpenClick = (): void => this.openMenu('options');
  private readonly handleControlsOpen = (): void => this.openMenu('controls');
  private readonly handleRelinkClick = (): void => window.location.reload();
  private readonly handleWindowKeyDown = (event:KeyboardEvent): void => {
    if(!isMenuOnlyKey(event.code,event.key))return;
    event.preventDefault();event.stopPropagation();
    if(event.repeat||event.altKey||event.ctrlKey||event.metaKey||document.body.dataset.garage==='true'||!['intro','paused','result'].includes(document.body.dataset.phase??'intro'))return;
    if(event.code==='KeyG'||event.key.toLowerCase()==='g')this.hooks.openGarage();
    else this.openMenu(event.code==='KeyC'||event.key.toLowerCase()==='c'?'controls':'options');
  };

  dispose(): void {
    window.removeEventListener("keydown", this.handleWindowKeyDown, { capture: true });
    this.navigation?.dispose();
    document.getElementById('controls-button')?.removeEventListener('click',this.handleControlsOpen);
    this.masterSlider.removeEventListener("input", this.handleMasterInput);
    this.musicSlider.removeEventListener("input", this.handleMusicInput);
    this.optionsButton.removeEventListener("click", this.handleOpenClick);
    this.optionsRelink.removeEventListener("click", this.handleRelinkClick);
    this.trackGroup.dispose();
    this.formatGroup.dispose();
    this.tierGroup.dispose();
    this.liveryGroup.dispose();
    this.motionGroup.dispose();
    this.voiceGroup.dispose();
    this.qualityGroup.dispose();
    this.renderGroup.dispose();
  }
}

/** `0.85` reads as `085` on a terminal that only ever prints fixed-width. */
function formatLevel(volume: number): string {
  return Math.round(volume * 100).toString().padStart(3, "0");
}
