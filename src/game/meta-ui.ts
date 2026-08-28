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
import type { GameUi } from "./ui";

/** Everything the meta layer needs from the running game, and nothing more. */
export interface MetaUiHooks {
  /** Swaps the player's decal sheet and re-issues the field, live. */
  applyLivery(code: string): Promise<void>;
  setMasterVolume(volume: number): void;
  setMusicVolume(volume: number): void;
  /** Drops any action the overlay just swallowed before the game sees it. */
  suspendInput(): void;
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
  private readonly optionsScreen = requiredElement<HTMLElement>("options-screen");
  private readonly optionsButton = requiredElement<HTMLButtonElement>("options-button");
  private readonly optionsClose = requiredElement<HTMLButtonElement>("options-close");
  private readonly optionsRelink = requiredElement<HTMLButtonElement>("options-relink");
  private readonly optionsNote = requiredElement<HTMLElement>("options-note");
  private readonly masterSlider = requiredElement<HTMLInputElement>("option-master");
  private readonly masterValue = requiredElement<HTMLElement>("option-master-value");
  private readonly musicSlider = requiredElement<HTMLInputElement>("option-music");
  private readonly musicValue = requiredElement<HTMLElement>("option-music-value");
  private readonly trackGroup: ChipGroup;
  private readonly liveryGroup: ChipGroup;
  private readonly motionGroup: ChipGroup;
  private readonly qualityGroup: ChipGroup;
  private readonly renderGroup: ChipGroup;
  private open = false;
  /** Where focus came from, so closing the terminal puts it back. */
  private returnFocus: HTMLElement | null = null;

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
    this.motionGroup = new ChipGroup(
      requiredElement<HTMLElement>("option-motion"),
      [
        { value: "off", label: "OFF" },
        { value: "on", label: "ON" },
      ],
      "select",
      (value) => this.storeSetting({ reducedMotion: value === "on" }),
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
    this.optionsClose.addEventListener("click", this.handleCloseClick);
    this.optionsRelink.addEventListener("click", this.handleRelinkClick);
    window.addEventListener("keydown", this.handleWindowKeyDown, { capture: true });
    this.optionsScreen.addEventListener("keydown", this.handlePanelKeyDown);

    this.syncFromSave();
  }

  /** Repaints the start screen's record line for the dispatched circuit. */
  syncRecord(): void {
    const track = trackFor(this.selection);
    this.ui.setStoredBest(storedBestLapMs(track.mapCode), track.label);
  }

  private syncFromSave(): void {
    const settings = save.settings;
    this.trackGroup.setValue(this.selection);
    this.liveryGroup.setValue(save.livery);
    this.motionGroup.setValue(settings.reducedMotion ? "on" : "off");
    this.qualityGroup.setValue(settings.quality);
    this.renderGroup.setValue(settings.renderMode);
    this.masterSlider.value = String(settings.masterVolume);
    this.musicSlider.value = String(settings.musicVolume);
    this.masterValue.textContent = formatLevel(settings.masterVolume);
    this.musicValue.textContent = formatLevel(settings.musicVolume);
    this.hooks.setMasterVolume(settings.masterVolume);
    this.hooks.setMusicVolume(settings.musicVolume);
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
      : "LEVELS APPLY LIVE · DAMPING, RESOLUTION AND PIPELINE ON NEXT RELINK";
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

  private readonly handleOpenClick = (): void => {
    this.setOpen(true);
  };

  private readonly handleCloseClick = (): void => {
    this.setOpen(false);
  };

  private readonly handleRelinkClick = (): void => {
    window.location.reload();
  };

  private setOpen(open: boolean): void {
    if (open === this.open) return;
    this.open = open;
    this.optionsScreen.hidden = !open;
    document.body.dataset.options = open ? "true" : "false";
    if (open) {
      this.returnFocus = document.activeElement as HTMLElement | null;
      this.masterSlider.focus({ preventScroll: true });
    } else {
      this.returnFocus?.focus({ preventScroll: true });
      this.returnFocus = null;
    }
    // Whatever key opened or closed the terminal must not also reach the race
    // loop as a start, pause or mute.
    this.hooks.suspendInput();
  }

  /**
   * The terminal opens from the paddock, from a pause and from the result
   * screen — never mid-race, where it would be a second pause with none of the
   * pause's consequences.
   */
  private canOpen(): boolean {
    const phase = document.body.dataset.phase;
    return phase === undefined
      || phase === "intro"
      || phase === "paused"
      || phase === "result";
  }

  /**
   * Capture phase on `window`, ahead of the race loop's own keyboard listener.
   * `O` opens the terminal; while it is up, anything typed *outside* it is
   * swallowed so the game underneath is not being driven by accident.
   *
   * Keys aimed at the panel's own controls are deliberately left alone here:
   * stopping them in the capture phase would stop them before they ever reached
   * the slider or chip they were meant for. {@link handlePanelKeyDown} catches
   * them on the way back up instead, after the control has had them.
   */
  private readonly handleWindowKeyDown = (event: KeyboardEvent): void => {
    if (this.open) {
      // `target` is only guaranteed to be an `EventTarget`; `contains()` throws
      // on anything that is not a `Node`, which would swallow the whole handler.
      const target = event.target;
      if (target instanceof Node && this.optionsScreen.contains(target)) return;
      if (event.key === "Escape") this.setOpen(false);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    // Matched on `key` as well as `code`: a non-QWERTY layout puts `o` on a
    // different physical key, and `code` alone silently loses it there.
    const wantsTerminal = event.code === "KeyO"
      || (event.key.length === 1 && event.key.toLowerCase() === "o");
    if (
      !wantsTerminal
      || event.repeat
      || event.altKey
      || event.ctrlKey
      || event.metaKey
      || !this.canOpen()
    ) return;
    event.preventDefault();
    event.stopPropagation();
    this.setOpen(true);
  };

  /**
   * Bubble phase on the terminal itself: whatever the panel's controls did not
   * already claim stops here rather than reaching the race loop's `window`
   * listener, so `Escape` closes the terminal instead of resuming the race and
   * `Enter` never launches from behind an open panel.
   */
  private readonly handlePanelKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Tab") return;
    if (event.key === "Escape") {
      event.preventDefault();
      this.setOpen(false);
    }
    event.stopPropagation();
  };

  dispose(): void {
    window.removeEventListener("keydown", this.handleWindowKeyDown, { capture: true });
    this.optionsScreen.removeEventListener("keydown", this.handlePanelKeyDown);
    this.masterSlider.removeEventListener("input", this.handleMasterInput);
    this.musicSlider.removeEventListener("input", this.handleMusicInput);
    this.optionsButton.removeEventListener("click", this.handleOpenClick);
    this.optionsClose.removeEventListener("click", this.handleCloseClick);
    this.optionsRelink.removeEventListener("click", this.handleRelinkClick);
    this.trackGroup.dispose();
    this.liveryGroup.dispose();
    this.motionGroup.dispose();
    this.qualityGroup.dispose();
    this.renderGroup.dispose();
  }
}

/** `0.85` reads as `085` on a terminal that only ever prints fixed-width. */
function formatLevel(volume: number): string {
  return Math.round(volume * 100).toString().padStart(3, "0");
}
