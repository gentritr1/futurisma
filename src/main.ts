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

ui.startButton.addEventListener("click", () => void beginTrial());
ui.restartButton.addEventListener("click", () => void beginTrial());
window.addEventListener("keydown", (event) => {
  if (event.code === "Enter" && !event.repeat) void beginTrial();
});

game
  .initialize()
  .then(() => {
    if (new URLSearchParams(window.location.search).has("demo")) void game.startTrial();
    else ui.showReady();
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown assembly error";
    ui.showError(message);
  });

if (import.meta.hot) {
  import.meta.hot.dispose(() => game.dispose());
}
