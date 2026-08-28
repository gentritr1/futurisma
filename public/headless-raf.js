// Headless soak harness. Activated ONLY by `?headless=1`; inert otherwise.
//
// Background/occluded pages never fire requestAnimationFrame, which freezes
// the fixed-step loop and makes automated soaks impossible. With the flag set,
// this file (loaded before the game module) replaces rAF with a MessageChannel
// pump — postMessage tasks are not background-throttled — paced to ~120 Hz,
// and pins document visibility to "visible" so the focus-loss pause never
// arms. Ships as a static file because the CSP forbids inline scripts.
//
// It never runs for players: no real player adds the flag, and the game's own
// behaviour (frame cadence aside) is unchanged — physics is fixed-step and
// frame-rate independent, which the validate-physics 60/120 Hz harness pins.
(() => {
  if (!new URLSearchParams(window.location.search).has("headless")) return;
  const channel = new MessageChannel();
  let queue = [];
  let last = performance.now();
  channel.port1.onmessage = () => {
    const now = performance.now();
    if (now - last < 8) {
      channel.port2.postMessage(0);
      return;
    }
    last = now;
    const callbacks = queue;
    queue = [];
    for (const callback of callbacks) {
      try {
        callback(now);
      } catch (error) {
        console.error("headless rAF callback failed", error);
      }
    }
    if (queue.length) channel.port2.postMessage(0);
  };
  window.requestAnimationFrame = (callback) => {
    queue.push(callback);
    channel.port2.postMessage(0);
    return queue.length;
  };
  window.cancelAnimationFrame = () => {
    queue = [];
  };
  Object.defineProperty(document, "visibilityState", {
    value: "visible",
    configurable: true,
  });
  Object.defineProperty(document, "hidden", {
    value: false,
    configurable: true,
  });
})();
