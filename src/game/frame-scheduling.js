/**
 * Standby and pause keep polling input, but their world state is deliberately
 * frozen. The result keeps presenting while TOTEM coasts, then settles too.
 * @param {string} phase
 * @param {number} speed
 */
export function phaseRunsContinuousPresentation(phase, speed) {
  if (phase === "standby" || phase === "paused") return false;
  if (phase === "finished") return speed > 0;
  return true;
}

/**
 * Idle phases only draw when a resize, asset arrival, pause, or context restore
 * has explicitly invalidated the last canvas image.
 * @param {string} phase
 * @param {number} speed
 * @param {boolean} renderRequested
 * @param {boolean} contextLost
 */
export function shouldRenderGameFrame(phase, speed, renderRequested, contextLost) {
  if (contextLost) return false;
  return renderRequested || phaseRunsContinuousPresentation(phase, speed);
}
