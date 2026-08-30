import { FuturismaGame } from "./game/game";
import type { RaceCourse } from "./game/course";
import { InputController } from "./game/input";
import { resolveMapSelection } from "./game/map-selection";
import { restoreStoredLivery } from "./game/meta-runtime";
import { MetaUi } from "./game/meta-ui";
import { save } from "./game/persistence";
import { configureRenderMode } from "./game/render-mode.js";
import { resolveQualityLock, resolveReducedMotion, searchParam } from "./game/query-probes";
import { GameUi } from "./game/ui";

const canvasElement = document.getElementById("game-canvas");
if (!(canvasElement instanceof HTMLCanvasElement)) {
  throw new Error("The game canvas is missing.");
}
const canvas: HTMLCanvasElement = canvasElement;

// P7 — the image pipeline is memoized on first read and every material
// treatment reads it during construction, so the stored choice has to be seeded
// before anything below builds a renderer or a material. `?render=` still wins.
const renderMode = configureRenderMode(save.settings.renderMode);

const ui = new GameUi();
const input = new InputController();
const courseAssemblyStartedAt = performance.now();
const selection = resolveMapSelection(window.location.search);
const course: RaceCourse = selection === "bitterpan"
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
  },
);

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
    meta.dispose();
    game.dispose();
  });
}
