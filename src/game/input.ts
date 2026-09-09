import {isMenuOnlyKey} from './menu-key.js';
import { resolveActionSuppression } from "./action-gate";
import { resolveSteeringInput, sanitizeTrigger } from "./input-shaping";

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
  "KeyE",
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
/**
 * The keys a focused control owns.
 *
 * Enter and Space ACTIVATE whatever has focus - that is what they mean to a
 * browser and to anyone driving the menus from the keyboard. So when focus is on
 * a button or a chip, they must not also reach the race as a global shortcut, or
 * pressing Enter on RESUME both clicks the button and toggles the pause, and the
 * two cancel out.
 *
 * Escape is deliberately NOT in here. It is the pause key and the quit-hold key,
 * it belongs to no control, and it has to work wherever focus happens to sit.
 */
const CONTROL_OWNED_KEYS = new Set(["Enter", "NumpadEnter", "Space"]);

/**
 * Is this event aimed at a control that owns its own keys?
 *
 * The canvas is explicitly not one: it carries `tabindex` so it can take focus
 * for driving, but it activates nothing, so the race keeps its shortcuts while
 * the player is actually driving.
 */
function targetOwnsKeys(target: EventTarget | null): boolean {
  // Duck-typed on purpose: the runtime validators drive this controller under a
  // Node stub with no global `Element`, and dispatch from a bare EventTarget.
  // Anything without `closest` (window, document, a stub) owns no keys.
  const element = target as Partial<Element> | null;
  if (!element || typeof element.closest !== "function") return false;
  if (element.id === "game-canvas") return false;
  return Boolean(
    element.closest(
      'button, a[href], input, select, textarea, [role="button"], [role="radio"], [tabindex]:not([tabindex="-1"])',
    ),
  );
}
const ACTION_KEYS = new Set([...START_KEYS, "KeyR", "KeyM", "Space", "KeyE"]);

function hasHeldKeyboardAction(keys: ReadonlySet<string>): boolean {
  for (const code of ACTION_KEYS) {
    if (keys.has(code)) return true;
  }
  return false;
}

export class InputController {
  activeDevice: "keyboard" | "gamepad" = "keyboard";
  onDeviceChange: ((device: "keyboard" | "gamepad") => void) | null = null;
  onMenuButton: ((button: number) => boolean) | null = null;
  private connectedPadIndex: number | null = null;

  private setActiveDevice(device: "keyboard" | "gamepad"): void {
    if (device === this.activeDevice) return;
    this.activeDevice = device;
    this.onDeviceChange?.(device);
  }
  private readonly handleKeyboardActivity = (): void => this.setActiveDevice("keyboard");
  private readonly handlePadConnection = (): void => {
    this.setActiveDevice(this.activeGamepad() ? "gamepad" : "keyboard");
  };

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
  private flipRequested = false;
  private powerRequested = false;
  private gravityControls = false;
  private powerControls = false;
  private controlIntentRequested = false;
  private actionsSuppressedUntilRelease = false;
  private previousGamepadButtons: boolean[] = [];

  constructor() {
    window.addEventListener("keydown", this.handleKeyboardActivity, {capture: true});
    window.addEventListener("keydown", this.handleKeyDown, { passive: false });
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("blur", this.clearKeys);
    window.addEventListener("gamepadconnected", this.handlePadConnection);
    window.addEventListener("gamepaddisconnected", this.handlePadConnection);
  }

  read(): InputFrame {
    const keyboardSteer =
      (this.keys.has("KeyD") || this.keys.has("ArrowRight") ? 1 : 0) -
      (this.keys.has("KeyA") || this.keys.has("ArrowLeft") ? 1 : 0);
    const keyboardThrottle = this.keys.has("KeyW") || this.keys.has("ArrowUp") ? 1 : 0;
    const keyboardBrake = this.keys.has("KeyS") || this.keys.has("ArrowDown") ? 1 : 0;
    const keyboardBoost = this.keys.has("ShiftLeft")
      || this.keys.has("ShiftRight")
      || (!this.gravityControls && this.keys.has("Space"));

    const gamepad = this.activeGamepad();
    if (gamepad) {
      if (this.connectedPadIndex !== gamepad.index || gamepad.buttons.some(button => button.pressed) || gamepad.axes.some(axis => Math.abs(axis) > .2)) this.setActiveDevice("gamepad");
      this.connectedPadIndex = gamepad.index;
    } else {
      this.connectedPadIndex = null;
      this.setActiveDevice("keyboard");
    }
    const actionControlHeld = hasHeldKeyboardAction(this.keys)
      || Boolean(gamepad?.buttons[9]?.pressed)
      || Boolean(gamepad?.buttons[3]?.pressed)
      || Boolean(gamepad?.buttons[8]?.pressed)
      || Boolean(gamepad?.buttons[2]?.pressed)
      || Boolean(gamepad?.buttons[1]?.pressed);
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

    const handled = gamepad.buttons.map((button,index) => acceptActions && button.pressed && !this.previousGamepadButtons[index] ? this.onMenuButton?.(index) ?? false : false);
    if (
      acceptActions && !handled[9]
      && gamepad.buttons[9]?.pressed
      && !this.previousGamepadButtons[9]
    ) {
      this.startRequested = true;
    }
    if (
      acceptActions && !handled[3]
      && gamepad.buttons[3]?.pressed
      && !this.previousGamepadButtons[3]
    ) {
      this.resetRequested = true;
    }
    if (
      acceptActions && !handled[8]
      && gamepad.buttons[8]?.pressed
      && !this.previousGamepadButtons[8]
    ) {
      this.muteRequested = true;
    }
    if (acceptActions) {
      if (!handled[2] && this.gravityControls && gamepad.buttons[2]?.pressed && !this.previousGamepadButtons[2]) this.flipRequested = true;
      if (!handled[1] && this.powerControls && gamepad.buttons[1]?.pressed && !this.previousGamepadButtons[1]) this.powerRequested = true;
      if (this.flipRequested || this.powerRequested) this.controlIntentRequested = true;
    }
    this.previousGamepadButtons.length = gamepad.buttons.length;
    for (let index = 0; index < gamepad.buttons.length; index += 1) {
      this.previousGamepadButtons[index] = gamepad.buttons[index].pressed;
    }

    const triggerThrottle = sanitizeTrigger(gamepad.buttons[7]?.value ?? 0);
    const triggerBrake = sanitizeTrigger(gamepad.buttons[6]?.value ?? 0);

    this.frame.throttle = Math.max(keyboardThrottle, triggerThrottle);
    this.frame.brake = Math.max(keyboardBrake, triggerBrake);
    this.frame.steer = resolveSteeringInput(
      keyboardSteer,
      gamepad.axes[0] ?? 0,
    );
    this.frame.boost = keyboardBoost || Boolean(gamepad.buttons[0]?.pressed);
    return this.frame;
  }

  requestStart(): void {
    if (!this.actionsSuppressedUntilRelease) this.startRequested = true;
  }

  setGravityControls(enabled: boolean): void { this.gravityControls = enabled; this.powerControls = enabled; }
  setPowerControls(enabled: boolean): void { this.powerControls = enabled; }
  consumeFlip(): boolean {
    const requested = this.flipRequested;
    this.flipRequested = false;
    return requested;
  }
  consumePower(): boolean {
    const requested = this.powerRequested;
    this.powerRequested = false;
    return requested;
  }

  suspendActionsUntilRelease(): void {
    this.keys.clear();
    this.clearPendingActions();
    this.actionsSuppressedUntilRelease = true;
  }

  /**
   * Is this physical key down right now?
   *
   * The hold-to-quit confirm polls this once per presentation frame instead of
   * latching a keyup listener of its own. `keys` is filled by window-level
   * handlers and emptied by `clearKeys` on blur, so a release that lands on
   * some other element - or an OS-swallowed keyup after Alt-Tab - still reads
   * as "not held" here. That is the whole reason the hold is poll-based: an
   * event-latched hold can only be cancelled by an event it actually receives.
   */
  isHeld(code: string): boolean {
    return this.keys.has(code);
  }

  /**
   * True while an action key held from before a focus loss must be released
   * before it can act again. A quit hold resets on this: it is exactly the
   * window where the matching keyup may never arrive.
   */
  get actionsSuppressed(): boolean {
    return this.actionsSuppressedUntilRelease;
  }

  /** Gamepad B - the pad's own quit-hold source. */
  isGamepadCancelHeld(): boolean {
    return Boolean(this.activeGamepad()?.buttons[1]?.pressed);
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
    window.removeEventListener("keydown", this.handleKeyboardActivity, {capture: true});
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("blur", this.clearKeys);
    window.removeEventListener("gamepadconnected", this.handlePadConnection);
    window.removeEventListener("gamepaddisconnected", this.handlePadConnection);
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
    this.setActiveDevice("keyboard");
    if (isMenuOnlyKey(event.code,event.key)) return;
    if (CONTROL_KEYS.has(event.code)) event.preventDefault();
    this.keys.add(event.code);
    if (DRIVING_KEYS.has(event.code)) this.controlIntentRequested = true;
    if (event.repeat) return;
    if (this.actionsSuppressedUntilRelease && ACTION_KEYS.has(event.code)) return;
    // The key is already in `keys` above, so a hold that polls `isHeld` still
    // sees it; what stops here is only the global ACTION it would have fired.
    if (CONTROL_OWNED_KEYS.has(event.code) && targetOwnsKeys(event.target)) return;

    if (START_KEYS.has(event.code)) {
      this.startRequested = true;
    }
    if (event.code === "KeyR") this.resetRequested = true;
    if (event.code === "KeyM") this.muteRequested = true;
    if (this.gravityControls && event.code === "Space") this.flipRequested = true;
    if (this.powerControls && event.code === "KeyE") this.powerRequested = true;
    if (this.flipRequested || this.powerRequested) this.controlIntentRequested = true;
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private readonly clearKeys = (): void => {
    this.keys.clear();
  };

  private clearPendingActions(): void {
    this.flipRequested = false;
    this.powerRequested = false;
    this.startRequested = false;
    this.resetRequested = false;
    this.muteRequested = false;
    this.controlIntentRequested = false;
  }
}
