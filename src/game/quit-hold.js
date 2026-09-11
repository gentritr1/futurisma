/**
 * Hold-to-confirm for QUIT TO PADDOCK.
 *
 * Quitting mid-race throws away the run, and the key that quits is the key that
 * paused, so the confirm is a hold rather than a press. The hold is POLLED, not
 * event-latched: it is re-tested from scratch every frame against the inputs
 * that are true right now, and it resets the moment any of them stops being
 * true. An event-latched hold can only be cancelled by an event it actually
 * receives, which is the whole class of bug this shape removes - a release that
 * lands on another element, a keyup the OS swallows during Alt-Tab, or a hold
 * that outlives the screen it started on.
 *
 * Two sources, deliberately kept apart:
 *
 * - `escape` is global. Escape is not focused on anything, so it holds wherever
 *   the pointer is, and it needs no focus test. It does need arming: the same
 *   Escape press that opened the pause screen must be released before a hold can
 *   begin, or one long press would pause and immediately quit.
 * - `button` belongs to the QUIT button - Enter, Space or a pointer press on the
 *   control itself. It additionally requires the button to STILL BE FOCUSED at
 *   every step including the one that completes. Tab away mid-hold and the hold
 *   dies, even though the key is still down, because the driver is no longer
 *   pointed at the thing they were confirming.
 *
 * The state is a plain object and the step is pure, so the transitions can be
 * asserted without a DOM. `test/quit-hold.test.js` walks all of them.
 */

/** How long the control must be held. */
export const QUIT_HOLD_SECONDS = 0.9;
/**
 * The largest slice of time one frame may contribute. A stalled tab or a
 * breakpoint can hand the loop a multi-second delta; without this clamp a single
 * frame could satisfy the whole hold, which would turn a stutter into a quit.
 */
export const QUIT_HOLD_MAX_STEP = 0.1;

/** @typedef {"escape" | "button"} QuitHoldSource */

/**
 * @typedef {object} QuitHoldState
 * @property {QuitHoldSource | null} source Which input owns the hold, or `null`.
 * @property {number} elapsed Seconds accumulated so far.
 * @property {boolean} escapeArmed Has Escape been released since the pause opened?
 * @property {boolean} fired Latched once the quit runs, so one hold fires once.
 */

/**
 * @typedef {object} QuitHoldInputs
 * @property {boolean} paused The race is on the pause screen.
 * @property {boolean} terminalOpen The options terminal is over the pause panel.
 * @property {boolean} actionsSuppressed A held key survived a focus loss.
 * @property {boolean} escapeHeld Escape is physically down.
 * @property {boolean} buttonHeld A press that began on QUIT is still down.
 * @property {boolean} buttonFocused QUIT is the focused element right now.
 */

/** @returns {QuitHoldState} */
export function createQuitHoldState() {
  return { source: null, elapsed: 0, escapeArmed: false, fired: false };
}

/** Progress 0..1, for the fill on the button. */
/** @param {QuitHoldState} state @returns {number} */
export function quitHoldProgress(state) {
  return Math.min(1, Math.max(0, state.elapsed / QUIT_HOLD_SECONDS));
}

/** @param {QuitHoldState} state */
function clear(state) {
  state.source = null;
  state.elapsed = 0;
}

/**
 * Advance one frame. Mutates and returns the state; `fired` goes true on the
 * single frame the hold completes.
 *
 * @param delta Seconds since the previous frame.
 * @returns true when the quit should run this frame.
 */
/**
 * @param {QuitHoldState} state
 * @param {QuitHoldInputs} inputs
 * @param {number} delta Seconds since the previous frame.
 * @returns {boolean} true on the single frame the quit should run.
 */
export function stepQuitHold(state, inputs, delta) {
  // Off the pause screen there is nothing to confirm, and a hold must never
  // survive the route out of pause - not into the options terminal, not into
  // the resume countdown, not into a finished race.
  if (!inputs.paused) {
    clear(state);
    state.escapeArmed = false;
    state.fired = false;
    return false;
  }
  if (state.fired) return false;

  // Escape arms only after the press that caused the pause has been released.
  if (!inputs.escapeHeld) state.escapeArmed = true;

  if (inputs.terminalOpen || inputs.actionsSuppressed) {
    clear(state);
    return false;
  }

  // Which source is live this frame? The button wins ties: if a driver is
  // holding Enter on a focused QUIT button, that is the hold they mean.
  const buttonLive = inputs.buttonHeld && inputs.buttonFocused;
  const escapeLive = inputs.escapeHeld && state.escapeArmed;
  /** @type {QuitHoldSource | null} */
  const live = buttonLive ? "button" : escapeLive ? "escape" : null;

  if (live === null) {
    clear(state);
    return false;
  }
  // Swapping source mid-hold restarts it. Two half-holds are not one hold.
  if (state.source !== live) {
    state.source = live;
    state.elapsed = 0;
  }

  state.elapsed += Math.min(Math.max(delta, 0), QUIT_HOLD_MAX_STEP);
  if (state.elapsed < QUIT_HOLD_SECONDS) return false;

  state.fired = true;
  clear(state);
  return true;
}
