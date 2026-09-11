# Audio instrument — PCM differential evidence

The user accepted C3 measured plume coverage and C4/C5 as recorded. Phase D was uncertain pending waveform evidence. No audio balance or routing correction was needed: the isolated music signal reaches the designed attenuation; the combined mix also contains unducked engine and launch sound.

## Captures and method

`scripts/visual/ascension/audio-capture.mjs` drives the same seeded Works surface demo in three private Chrome pages. A mutes launch and its duck only; B enables everything; C mutes klaxon and deluge only. All use seed 3868938316 and the shipped original Meridian Afterimage soundtrack. Private imported recordings are excluded. Rendering is live, so cue-to-context mappings and camera distance are measured separately for each run rather than presumed identical sample positions.

`public/ascension-pcm-worklet.js` records six synchronous signed 16-bit channels at 48 kHz: post-master L/R, post-duck music L/R, and event L/R. No MediaRecorder, codec, decoding or resampling. Each run contains 100 s × 48,000 Hz = 4,800,000 PCM frames, exactly matching the worklet start/end frame indices and its independently counted processed frames; residual zero. Stereo launch extracts contain 20 s × 48,000 = 960,000 frames each.

The read-only tap uses an extra unity-gain event bus. The captures used the audited module preserved in `captured-audio.ts.txt`. The final harness injects the same wiring into the served module; shipped game code is unchanged. A short harness smoke verifies those injection markers and frame counts. The early instrumented build exceeded the shared bundle cap; moving the tap entirely to the harness removed that regression. The initial test log and final build log are retained with this distinction.

## Waveform results

`scripts/visual/ascension/analyse-pcm.py` computes 50 ms RMS windows (2,400 samples each). Cue logs supply the time axis only; waveform differences determine onset. The launch event reference is matched against post-master PCM to establish that its signal reaches the output. The mixer lag is measured, not typed into the test. Music attenuation is measured on the music channel after its real gain node; total-mix RMS is also reported and must not be labelled music gain.

- Launch onset: 0.70 s after T-0; 242.946268 m / 343 = 0.708298158 s expected; residual -0.008298158 s. Pass ±0.1 s. Post-master matched-waveform confirmation also passes.
- Music duck: -11.76445 dB over four seconds, design -12.04120 dB; pass ±3 dB. Total mix changes -4.00283 dB; that includes engine and launch energy.
- Klaxon waveform lead before crossing: 3.016000 s, pass ≥2 s. Deluge onset is in the test's first 50 ms window.
- Envelope reconciliation: launch 3.5 s × 20 Hz = 70 windows; duck 4 s × 20 = 80; klaxon 4.5 s × 20 = 90; deluge 5.5 s × 20 = 110. All residuals zero. Full numerical rows, thresholds and band limits are in `differential.json`.

These are instrument gates, not subjective mix approval. RMS-window onset has 50 ms resolution. Post-master template matching confirms routing and timing, not how prominent the rumble feels against music. The old Opus evidence stays immutable but is superseded for timing and length claims.
