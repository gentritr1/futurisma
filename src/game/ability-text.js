/**
 * Reading the ability HUD's own words back out.
 *
 * Three circuit runtimes (polarity, tideline, ascension) write the ability
 * lines, each with its own vocabulary, and none of them stamps a machine-
 * readable state. Rather than change three runtime files - and collide with
 * whatever circuit work is in flight - the glyph slots derive their state from
 * the text that is already there.
 *
 * That makes these four functions the load-bearing part of the slot, so they
 * live here as plain functions with no DOM, and `validate-hud.mjs` asserts them
 * against the real phrases each runtime emits.
 */

/** @typedef {"surge" | "shield"} DeviceKind */
/** @typedef {"empty" | "held" | "active" | "perfect"} DeviceState */

/**
 * Which device the line is talking about, if any.
 * @param {string} text
 * @returns {DeviceKind | null}
 */
export function readDeviceKind(text) {
  const upper = text.toUpperCase();
  if (upper.includes("SHIELD")) return "shield";
  if (upper.includes("SURGE")) return "surge";
  return null;
}

/**
 * The four device states.
 *
 * Order matters: a chain line names a device AND a duration, so the perfect
 * test has to come before the active one, and the active test before held.
 *
 * @param {string} text
 * @returns {DeviceState}
 */
export function readDeviceState(text) {
  const upper = text.toUpperCase();
  if (upper.includes("COLLECT")) return "empty";
  if (upper.includes("CHAIN") || upper.includes("PERFECT")) return "perfect";
  // "SURGE 2.6s" - a remaining duration means it is running.
  if (/\d+(\.\d+)?\s*S\b/.test(upper)) return "active";
  // "E / SURGE" - a key prompt means it is held and ready to deploy.
  if (upper.includes("/")) return "held";
  return readDeviceKind(upper) ? "held" : "empty";
}

/**
 * `upper` / `lower` / `none`, from whatever the circuit calls its decks. A
 * circuit with no decks at all (Ascension writes a pad name here) returns
 * `none`, which is how the deck slot knows to stay out of the way.
 * @param {string} text
 * @returns {"upper" | "lower" | "none"}
 */
export function readDeck(text) {
  const upper = text.toUpperCase();
  if (upper.includes("UPPER")) return "upper";
  if (upper.includes("LOWER")) return "lower";
  return "none";
}

/**
 * The charge the runtimes wrote, parsed back out of the fill's own transform.
 * @param {string} transform
 * @returns {number} 0..1
 */
export function readCharge(transform) {
  const match = /scaleX\(([\d.]+)\)/.exec(transform);
  if (!match) return 0;
  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}
