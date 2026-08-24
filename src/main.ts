import { FuturismaGame } from "./game/game";
import { InputController } from "./game/input";
import { GameUi } from "./game/ui";

const canvasElement = document.getElementById("game-canvas");
if (!(canvasElement instanceof HTMLCanvasElement)) {
  throw new Error("The game canvas is missing.");
}
const canvas: HTMLCanvasElement = canvasElement;

const ui = new GameUi();
const input = new InputController();
const game = new FuturismaGame(canvas, input, ui);

async function beginTrial(): Promise<void> {
  if (!game.canStart()) return;
  await game.startTrial();
  canvas.focus({ preventScroll: true });
}

const handleStartClick = (): void => {
  void beginTrial();
};

const handleWindowKeyDown = (event: KeyboardEvent): void => {
  if (event.code === "Enter" && !event.repeat) void beginTrial();
};

ui.startButton.addEventListener("click", handleStartClick);
ui.restartButton.addEventListener("click", handleStartClick);
window.addEventListener("keydown", handleWindowKeyDown);

game
  .initialize()
  .then((initialized) => {
    if (!initialized) return;
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
    ui.restartButton.removeEventListener("click", handleStartClick);
    window.removeEventListener("keydown", handleWindowKeyDown);
    game.dispose();
  });
}
