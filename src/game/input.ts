export interface InputFrame {
  throttle: number;
  brake: number;
  steer: number;
  boost: boolean;
}

const CONTROL_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Space",
  "Escape",
]);

function applyDeadzone(value: number, deadzone = 0.16): number {
  const magnitude = Math.abs(value);
  if (magnitude <= deadzone) return 0;
  return Math.sign(value) * ((magnitude - deadzone) / (1 - deadzone));
}

export class InputController {
  private readonly keys = new Set<string>();
  private startRequested = false;
  private resetRequested = false;
  private muteRequested = false;
  private previousGamepadButtons: boolean[] = [];

  constructor() {
    window.addEventListener("keydown", this.handleKeyDown, { passive: false });
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("blur", this.clearKeys);
  }

  read(): InputFrame {
    const keyboardSteer =
      (this.isDown("KeyD", "ArrowRight") ? 1 : 0) -
      (this.isDown("KeyA", "ArrowLeft") ? 1 : 0);
    const keyboardThrottle = this.isDown("KeyW", "ArrowUp") ? 1 : 0;
    const keyboardBrake = this.isDown("KeyS", "ArrowDown") ? 1 : 0;
    const keyboardBoost = this.isDown("ShiftLeft", "ShiftRight", "Space");

    const gamepad = navigator.getGamepads?.()[0];
    if (!gamepad) {
      this.previousGamepadButtons = [];
      return {
        throttle: keyboardThrottle,
        brake: keyboardBrake,
        steer: keyboardSteer,
        boost: keyboardBoost,
      };
    }

    const gamepadButtons = gamepad.buttons.map((button) => button.pressed);
    if (gamepadButtons[9] && !this.previousGamepadButtons[9]) this.startRequested = true;
    if (gamepadButtons[3] && !this.previousGamepadButtons[3]) this.resetRequested = true;
    if (gamepadButtons[8] && !this.previousGamepadButtons[8]) this.muteRequested = true;
    this.previousGamepadButtons = gamepadButtons;

    const stick = applyDeadzone(gamepad.axes[0] ?? 0);
    const triggerThrottle = gamepad.buttons[7]?.value ?? 0;
    const triggerBrake = gamepad.buttons[6]?.value ?? 0;

    return {
      throttle: Math.max(keyboardThrottle, triggerThrottle),
      brake: Math.max(keyboardBrake, triggerBrake),
      steer: Math.abs(keyboardSteer) > Math.abs(stick) ? keyboardSteer : stick,
      boost: keyboardBoost || Boolean(gamepad.buttons[0]?.pressed),
    };
  }

  requestStart(): void {
    this.startRequested = true;
  }

  consumeStart(): boolean {
    const requested = this.startRequested;
    this.startRequested = false;
    return requested;
  }

  consumeReset(): boolean {
    const requested = this.resetRequested;
    this.resetRequested = false;
    return requested;
  }

  consumeMute(): boolean {
    const requested = this.muteRequested;
    this.muteRequested = false;
    return requested;
  }

  private isDown(...codes: string[]): boolean {
    return codes.some((code) => this.keys.has(code));
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (CONTROL_KEYS.has(event.code)) event.preventDefault();
    this.keys.add(event.code);
    if (event.repeat) return;

    if (event.code === "Enter" || event.code === "Escape" || event.code === "KeyP") {
      this.startRequested = true;
    }
    if (event.code === "KeyR") this.resetRequested = true;
    if (event.code === "KeyM") this.muteRequested = true;
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private readonly clearKeys = (): void => {
    this.keys.clear();
  };
}
