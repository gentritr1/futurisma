const CONTROL_INTENT_THRESHOLD = 0.05;

/**
 * Detects deliberate player input without treating normal analogue-stick noise
 * as a request to leave showcase autopilot.
 * @param {{ throttle: number; brake: number; steer: number; boost: boolean }} input
 */
export function hasPlayerControlIntent(input) {
  return (Number.isFinite(input.throttle) && input.throttle > CONTROL_INTENT_THRESHOLD)
    || (Number.isFinite(input.brake) && input.brake > CONTROL_INTENT_THRESHOLD)
    || (Number.isFinite(input.steer) && Math.abs(input.steer) > CONTROL_INTENT_THRESHOLD)
    || input.boost === true;
}
