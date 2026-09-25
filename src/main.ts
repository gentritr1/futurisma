import { FuturismaGame } from "./game/game";
import type { RaceCourse } from "./game/course";
import { InputController } from "./game/input";
import { TRACKS, resolveMapSelection } from "./game/map-selection";
import { handlingFor, installHandling } from "./game/garage-rules.js";
import type { GarageScreen } from "./game/garage-bay";
import { loadGarageBay, restoreStoredLivery } from "./game/meta-runtime";
import { MetaUi } from "./game/meta-ui";
import { save } from "./game/persistence";
import { raceModes } from "./game/race-modes";
import { configureRenderMode } from "./game/render-mode.js";
import { resolveQualityLock, resolveReducedMotion, searchParam } from "./game/query-probes";
import { GameUi } from "./game/ui";
import { applyInterfaceScale } from "./game/interface-scale.js";

const canvasElement = document.getElementById("game-canvas");
if (!(canvasElement instanceof HTMLCanvasElement)) {
  throw new Error("The game canvas is missing.");
}
const canvas: HTMLCanvasElement = canvasElement;

// P7 — the image pipeline is memoized on first read and every material
// treatment reads it during construction, so the stored choice has to be seeded
// before anything below builds a renderer or a material. `?render=` still wins.
const renderMode = configureRenderMode(save.settings.renderMode);

// The two interface scales are read from the same stored settings and written
// to `<body>` before the first frame, so the HUD never lays out at one size and
// then jumps to another. The resize listener re-runs only the viewport term.
applyInterfaceScale(save.settings);
window.addEventListener("resize", () => applyInterfaceScale(save.settings));

const ui = new GameUi();
// The ability glyph slots derive their state from the nodes the circuit
// runtimes already write, so this binds once and needs nothing from them.
// Circuit-specific presentation stays out of first paint, like the runtimes it
// reads: the slots only ever show something once a device circuit has loaded.
void import("./game/ability-slots").then(({ bindAbilitySlots }) => bindAbilitySlots());
const input = new InputController();
void import("./game/input-prompts").then(({bindInputPrompts}) => bindInputPrompts(input));
const courseAssemblyStartedAt = performance.now();
const selection = resolveMapSelection(window.location.search);
const course: RaceCourse = selection === "dreamisland"
  ? new (await import("./game/dreamisland-course")).DreamIslandCourse()
  : selection === "ascension"
  ? new (await import("./game/ascension-course")).AscensionCourse()
  : selection === "tideline"
  ? new (await import("./game/tideline-course")).TidelineCourse()
  : selection === "polarity"
  ? new (await import("./game/polarity-course")).PolarityCourse()
  : selection === "nightshift"
  ? new (await import("./game/nightshift-course")).NightshiftCourse()
  : selection === "bitterpan"
  ? new (await import("./game/bitterpan-course")).BitterpanCourse()
  : new (await import("./game/course")).GreenwaterCourse();
const game = new FuturismaGame(
  canvas,
  input,
  ui,
  course,
  performance.now() - courseAssemblyStartedAt,
);

const meta = new MetaUi(
  ui,
  selection,
  {
    quality: resolveQualityLock(),
    renderMode,
    reducedMotion: resolveReducedMotion(),
    // A QA override or an operating-system preference is holding these; the
    // options panel stores a choice but a relink would not honour it.
    qualityForced: searchParam("quality") !== null,
    renderForced: searchParam("render") !== null,
    motionForced: searchParam("motion") === "reduce"
      || window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  },
  {
    applyLivery: (code) => game.applyLivery(code),
    setMasterVolume: (volume) => game.setMasterVolume(volume),
    setMusicVolume: (volume) => game.setMusicVolume(volume),
    suspendInput: () => input.suspendActionsUntilRelease(),
    openGarage: () => openGarage(),
  },
);

// Garage — the fitted craft's handling is installed before the first fixed
// step. A demo, and `?craft=stock`, race the works TOTEM so every soak and
// autopilot baseline stays comparable with the ones recorded before the garage.
const stockCraft = new URLSearchParams(window.location.search).has("demo") || searchParam("craft") === "stock";
if (!stockCraft) installHandling(handlingFor(save.garage));
const garageCredits = document.getElementById("garage-credits");
if (garageCredits) garageCredits.textContent = `CR ${save.garage.credits.toLocaleString("en-US")}`;

/** Re-reads the saved garage onto the craft: handling now, the look lazily. */
const refitCraft = (preview: string | null): void => {
  if (stockCraft) return;
  const garage = save.garage;
  installHandling(handlingFor(garage));
  // Non-fatal like the livery swap: a look that cannot load costs the paint,
  // never the race — the handling above is already installed.
  void loadGarageBay().then(({ applyCraftLook }) => {
    game.refitCraft((vehicle) => applyCraftLook(vehicle, garage, preview));
  }, () => undefined);
};

let garageScreen: Promise<GarageScreen> | null = null;
const openGarage = (): void => {
  const body = document.body.dataset;
  if (!["intro", "result"].includes(body.phase ?? "") || body.options === "true" || body.controls === "true") return;
  garageScreen ??= loadGarageBay().then(({ GarageScreen }) => new GarageScreen({
    refit: refitCraft,
    suspendInput: () => input.suspendActionsUntilRelease(),
    save,
    here: { track: selection, mode: raceModes.mode, tier: raceModes.tier },
    tracks: TRACKS,
  }));
  // A chunk that fails to arrive is retried on the next press, not cached.
  void garageScreen.then((screen) => screen.show(), () => {
    garageScreen = null;
  });
};
// The G key reaches this through `MetaUi`, which owns every menu key.
const garageButtons = ["garage-button", "result-garage-button"].map((id) => document.getElementById(id));
for (const button of garageButtons) button?.addEventListener("click", openGarage);

async function beginTrial(): Promise<void> {
  if (!game.canStart()) return;
  await game.startTrial();
  canvas.focus({ preventScroll: true });
}

const handleStartClick = (): void => {
  void beginTrial();
};

// A finished race may have entered a new best on file, so the paddock's record
// line is repainted whenever the start screen could come back into view.
const handleRestartClick = (): void => {
  meta.syncRecord();
  void beginTrial();
};

const circuitSelect=document.getElementById('circuit-select-button')!;
const handleCircuitSelect=():void=>{
  const url=new URL(window.location.href);
  url.searchParams.delete('demo');url.searchParams.delete('start');
  window.location.assign(url.href);
};
circuitSelect.addEventListener('click',handleCircuitSelect);

ui.startButton.addEventListener("click", handleStartClick);
ui.restartButton.addEventListener("click", handleRestartClick);

game
  .initialize()
  .then(async (initialized) => {
    if (!initialized) return;
    // P17.1 — the stored livery goes ON THE CRAFT, not just in the chip row.
    // Here rather than in `MetaUi.syncFromSave` because the panel is built
    // before this promise resolves, so at sync time there is no loaded model to
    // swap a decal sheet on; and awaited before the grid is shown or the demo
    // starts, so the field is never issued against paint the player can see is
    // wrong. Returns null and keeps the works sheet if it cannot be applied.
    await restoreStoredLivery((code) => game.applyLivery(code));
    // Garage — the fitted look goes on after the fleet and the ghost have
    // cloned their materials in `initialize()`, so it stays on the player's
    // craft. Loading it warms the purse too, so a finish settles in-frame.
    refitCraft(null);
    if (stockCraft) void loadGarageBay().catch(() => undefined);
    const parameters = new URLSearchParams(window.location.search);
    const manualDemoStart = parameters.has("diagnostics")
      && parameters.has("demo")
      && parameters.get("start") === "manual";
    if (parameters.has("demo") && !manualDemoStart) void game.startTrial();
    else ui.showReady();
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown assembly error";
    ui.showError(message);
  });

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    ui.startButton.removeEventListener("click", handleStartClick);
    ui.restartButton.removeEventListener("click", handleRestartClick);
    circuitSelect.removeEventListener('click',handleCircuitSelect);
    for (const button of garageButtons) button?.removeEventListener("click", openGarage);
    void garageScreen?.then((screen) => screen.dispose(), () => undefined);
    meta.dispose();
    game.dispose();
  });
}
