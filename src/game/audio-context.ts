/**
 * The page's one AudioContext, shared by the race mix (`EngineAudio`) and the
 * garage's showroom voice, so the bay never opens a second one: the first
 * context a page makes costs a long, synchronous device start-up (about 330 ms
 * measured in headless Chrome), and a second only adds another audio thread.
 * Made on first use; a closed one (a disposed game) is replaced.
 *
 * The race CLAIMS it when its graph is built: from then on the race decides
 * when it runs, and the showroom, which suspends the context between its cues
 * while it is the only voice, leaves it running.
 */
let shared: AudioContext | null = null;
let claimed = false;
export const pageAudioContext = (claim = false): AudioContext => {
  if (!shared || shared.state === "closed") { shared = new AudioContext(); claimed = false; }
  claimed ||= claim;
  return shared;
};
/** True once the race mix runs on the page's context. */
export const pageAudioClaimed = (): boolean => claimed;
