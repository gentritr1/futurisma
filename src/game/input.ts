import { resolveActionSuppression } from "./action-gate";

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

const DRIVING_KEYS = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ShiftLeft",
  "ShiftRight",
  "Space",
]);

const START_KEYS = new Set(["Enter", "Escape", "KeyP"]);
const ACTION_KEYS = new Set([...START_KEYS, "KeyR", "KeyM"]);

function applyDeadzone(value: number, deadzone = 0.16): number {
  const magnitude = Math.abs(value);
  if (magnitude <= deadzone) return 0;
  return Math.sign(value) * ((magnitude - deadzone) / (1 - deadzone));
}

function hasHeldKeyboardAction(keys: ReadonlySet<string>): boolean {
  for (const code of ACTION_KEYS) {
    if (keys.has(code)) return true;
  }
  return false;
}

export class InputController {
  private readonly keys = new Set<string>();
  private readonly frame: InputFrame = {
    throttle: 0,
    brake: 0,
    steer: 0,
    boost: false,
  };
  private startRequested = false;
  private resetRequested = false;
  private muteRequested = false;
  private controlIntentRequested = false;
  private actionsSuppressedUntilRelease = false;
  private previousGamepadButtons: boolean[] = [];

  constructor() {
    window.addEventListener("keydown", this.handleKeyDown, { passive: false });
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("blur", this.clearKeys);
  }

  read(): InputFrame {
    const keyboardSteer =
      (this.keys.has("KeyD") || this.keys.has("ArrowRight") ? 1 : 0) -
      (this.keys.has("KeyA") || this.keys.has("ArrowLeft") ? 1 : 0);
    const keyboardThrottle = this.keys.has("KeyW") || this.keys.has("ArrowUp") ? 1 : 0;
    const keyboardBrake = this.keys.has("KeyS") || this.keys.has("ArrowDown") ? 1 : 0;
    const keyboardBoost = this.keys.has("ShiftLeft")
      || this.keys.has("ShiftRight")
      || this.keys.has("Space");

    const gamepad = this.activeGamepad();
    const actionControlHeld = hasHeldKeyboardAction(this.keys)
      || Boolean(gamepad?.buttons[9]?.pressed)
      || Boolean(gamepad?.buttons[3]?.pressed)
      || Boolean(gamepad?.buttons[8]?.pressed);
    const actionsWereSuppressed = this.actionsSuppressedUntilRelease;
    this.actionsSuppressedUntilRelease = resolveActionSuppression(
      actionsWereSuppressed,
      actionControlHeld,
    );
    const acceptActions = !actionsWereSuppressed;
    if (!acceptActions) this.clearPendingActions();

    if (!gamepad) {
      this.previousGamepadButtons.length = 0;
      this.frame.throttle = keyboardThrottle;
      this.frame.brake = keyboardBrake;
      this.frame.steer = keyboardSteer;
      this.frame.boost = keyboardBoost;
      return this.frame;
    }

    if (
      acceptActions
      && gamepad.buttons[9]?.pressed
      && !this.previousGamepadButtons[9]
    ) {
      this.startRequested = true;
    }
    if (
      acceptActions
      && gamepad.buttons[3]?.pressed
      && !this.previousGamepadButtons[3]
    ) {
      this.resetRequested = true;
    }
    if (
      acceptActions
      && gamepad.buttons[8]?.pressed
      && !this.previousGamepadButtons[8]
    ) {
      this.muteRequested = true;
    }
    this.previousGamepadButtons.length = gamepad.buttons.length;
    for (let index = 0; index < gamepad.buttons.length; index += 1) {
      this.previousGamepadButtons[index] = gamepad.buttons[index].pressed;
    }

    const stick = applyDeadzone(gamepad.axes[0] ?? 0);
    const triggerThrottle = gamepad.buttons[7]?.value ?? 0;
    const triggerBrake = gamepad.buttons[6]?.value ?? 0;

    this.frame.throttle = Math.max(keyboardThrottle, triggerThrottle);
    this.frame.brake = Math.max(keyboardBrake, triggerBrake);
    this.frame.steer = Math.abs(keyboardSteer) > Math.abs(stick) ? keyboardSteer : stick;
    this.frame.boost = keyboardBoost || Boolean(gamepad.buttons[0]?.pressed);
    return this.frame;
  }

  requestStart(): void {
    if (!this.actionsSuppressedUntilRelease) this.startRequested = true;
  }

  suspendActionsUntilRelease(): void {
    this.keys.clear();
    this.clearPendingActions();
    this.actionsSuppressedUntilRelease = true;
  }

  pulse(strongMagnitude: number, weakMagnitude: number, duration: number): void {
    const gamepad = this.activeGamepad();
    const actuator = gamepad?.vibrationActuator as GamepadHapticActuator & {
      playEffect?: (
        effect: "dual-rumble",
        parameters: {
          duration: number;
          strongMagnitude: number;
          weakMagnitude: number;
        },
      ) => Promise<unknown>;
    } | undefined;
    if (!actuator?.playEffect) return;
    void actuator.playEffect("dual-rumble", {
      duration,
      strongMagnitude: Math.min(1, Math.max(0, strongMagnitude)),
      weakMagnitude: Math.min(1, Math.max(0, weakMagnitude)),
    }).catch(() => undefined);
  }

  dispose(): void {
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("blur", this.clearKeys);
    this.clearKeys();
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

  consumeControlIntent(): boolean {
    const requested = this.controlIntentRequested;
    this.controlIntentRequested = false;
    return requested;
  }

  private activeGamepad(): Gamepad | null {
    const gamepads = navigator.getGamepads?.();
    if (!gamepads) return null;
    for (let index = 0; index < gamepads.length; index += 1) {
      const gamepad = gamepads[index];
      if (gamepad) return gamepad;
    }
    return null;
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (CONTROL_KEYS.has(event.code)) event.preventDefault();
    this.keys.add(event.code);
    if (DRIVING_KEYS.has(event.code)) this.controlIntentRequested = true;
    if (event.repeat) return;
    if (this.actionsSuppressedUntilRelease && ACTION_KEYS.has(event.code)) return;

    if (START_KEYS.has(event.code)) {
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

  private clearPendingActions(): void {
    this.startRequested = false;
    this.resetRequested = false;
    this.muteRequested = false;
    this.controlIntentRequested = false;
  }
}
