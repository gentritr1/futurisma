# Phase D: live audio and refreshed launch evidence

## Executed and observed

- Added local pit-radio clips, crawler klaxon, deluge, distance-delayed launch, egret chirps and trench drips/echo to the game audio bus. The music duck composes with radio ducking and volume changes. Recovery also clears an outstanding CHAIN absorption window.
- `scripts/build-ascension-radio.py` records the local speech engine, exact text, samples and hashes in `radio-generation.json` and the reference manifest. No remote generation job is claimed.
- `scripts/visual/ascension/audio-capture.mjs` records the actual post-master game mix, using the shipped original Meridian Afterimage track. Private imported recordings are excluded. The trench recording starts and stops inside the shortcut; launch uses two seconds of scheduled pre-roll.
- `scripts/visual/ascension/reconcile-audio.py` decodes the raw recordings and writes ten-second and twenty-second PCM clips. Full arithmetic is in `audio-reconciliation.json`.
- trench: 10 s × 48,000 Hz = 480,000 PCM frames, residual 0. Raw context window 10.338684807 s × 48,000 = 496256.871; decoded 492,480, residual -3776.871. Wall-clock reconciliation is recorded separately in JSON.
- launch: 20 s × 48,000 Hz = 960,000 PCM frames, residual 0. Raw context window 23.167709751 s × 48,000 = 1112050.068; decoded 1,103,040, residual -9010.068. Wall-clock reconciliation is recorded separately in JSON.
- Launch: 243.394664 m ÷ 343 = 0.709605436 s; observed 0.716666667 s, residual 0.007061231 s. The music-duck control window is 480 ticks ÷ 120 Hz = 4 s; residual 0 ticks. This is the control envelope, not a waveform measurement of perceived loudness.

## Limits and inference

The raw Opus files emit packet-header decoding warnings. Their decoded durations are shorter than the measured audio-context windows by the amounts above. The exact-length WAV files are usable listening clips, but their T-0 trim remains approximate; they do not establish sample-exact audio/video synchronization. Nonzero RMS establishes signal presence, not subjective mix quality. Independent listening remains open.

The final plume pack is `visibility/`; its claim and reconciliation name the capture and analysis scripts. Camera coverage is the normal seeded Works driving path. A geometric column-top angle is not image-classified plume height or an exhaustive heading test.

Phase C budget and race results remain frozen at `551e4c8` in `../phase-c-revision/carry-overs/`. Phase D changes audio and one recovery reset, with no added geometry. Those historical benchmark input hashes are not represented as a new performance run.

All remaining art, device, ambience and Phase E review gates are listed in [OPEN-GAPS.md](OPEN-GAPS.md). Whole-level acceptance is not claimed.

Refreshed visibility: `launch-visibility.mjs` observed plume pixels in 201/201 frames (100%). Simulation: 20 s × 10 Hz + 1 inclusive endpoint = 201, residual 0. Wall: 27.3957 s × 10 Hz + 1 = 274.957, residual −73.957. The extra renders and PNG work slow wall time; this is not an FPS benchmark. `reconcile-launch.mjs` reports geometric 25° at T+0.7 s and 78.8445° at T+3 s. The video is 20.1 s because 201 frames at 10 fps include the endpoint hold.

The first full code check caught a 262.7 KiB shared-bundle regression against the 262 KiB cap. The Ascension sound graph now loads dynamically only when enabled. The captures precede this loading-only adjustment; cue implementation and captured render inputs are unchanged.

Validation: `npm run test:code` passed after the loading change, including TypeScript, production build and the initial-JavaScript size gate (`scripts/validate-build.mjs`, rounded result 262.0 KiB gzip). `scripts/validate-ascension-audio.mjs` passed two fixed-distance runs: each 73.775 s × 120 Hz + 1 inclusive endpoint = 8,854 samples, residual 0. Build output before the loading-only fix is kept in `build.txt`; the final build is included in `code-tests.txt`. The private-Chrome startup smoke result is in `lazy-load-smoke.json`.
