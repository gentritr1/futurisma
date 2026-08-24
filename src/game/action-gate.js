/**
 * External interruptions suppress pause/reset/mute edges until every action
 * control has been released. The neutral frame rearms the gate but does not
 * accept an action itself, so an event queued during focus loss cannot leak
 * into the resumed session.
 * Returns the next suppression state. Callers use the previous state to decide
 * whether the current frame may accept actions, which avoids allocating a
 * result object on every render frame.
 * @param {boolean} suppressedUntilRelease
 * @param {boolean} actionControlHeld
 */
export function resolveActionSuppression(
  suppressedUntilRelease,
  actionControlHeld,
) {
  return Boolean(suppressedUntilRelease && actionControlHeld);
}
