/** Offline events vary between sessions; a supplied room/test seed replays exactly. */
let sessionSeed: number | undefined;
export function resolveAbilitySeed(search = location.search): number {
  const parameters = new URLSearchParams(search);
  const explicit = parameters.get("seed");
  if (explicit !== null) {
    const seed = Number(explicit);
    return Number.isSafeInteger(seed) && seed >= 0 && seed <= 0xffffffff ? seed : 714;
  }
  if (parameters.has("diagnostics")) return 714;
  return sessionSeed ??= crypto.getRandomValues(new Uint32Array(1))[0];
}
