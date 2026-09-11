# Dream Island — POLISH-3 handoff

**Status: E1–E3 implemented and instrument-verified; E4 FAIL / pending scope decision. This pass is not accepted as complete. No commit made.**

Started clean on `main` at `7bf6dc2`. Other work advanced HEAD to `872e9f8` during the pass; that work was preserved. The report generator compares protected files to the starting commit in [protected-hashes.json](protected-hashes.json). `game.ts`, autopilot, route, schedule, powers configuration, pace, skies, water, original materials and painted GLB are byte-identical. The hardware placement follows the user's explicit verge/plate approval.

## Files added or changed

Audio joins EngineAudio's existing buses through a small shared port and strongest-duck precedence. Dream Island's graph, synthesis, measured profiles, hardware and clock remain in the lazy circuit path. The existing Surge/Shield effect renderer accepts circuit colours; rules and trigger positions are unchanged. Instrument changes collect actual physics inputs and renderer data; the optional width/grip experiments affect only the served test page.

- `art/blender/build_dreamisland_power_kit.py`
- `public/assets/dreamisland/audio/clock-quarter-chime.mp3`
- `public/assets/dreamisland/audio/clock-strike-three-tolls.mp3`
- `public/assets/dreamisland/audio/day-birds.mp3`
- `public/assets/dreamisland/audio/fish-rise.mp3`
- `public/assets/dreamisland/audio/tunnel-pass.mp3`
- `public/assets/dreamisland/audio/waterfall-loop.mp3`
- `public/assets/dreamisland/painted.json`
- `public/assets/dreamisland/power-kit.glb`
- `scripts/prepare-dreamisland-audio-positions.mjs`
- `scripts/prepare-dreamisland-audio.py`
- `scripts/validate-build.mjs`
- `scripts/validate-dreamisland-painted.mjs`
- `scripts/validate-dreamisland-runtime.mjs`
- `scripts/visual/dreamisland/atlas-claims.mjs`
- `scripts/visual/dreamisland/atlas-quadrant-proof.mjs`
- `scripts/visual/dreamisland/audio-capture.mjs`
- `scripts/visual/dreamisland/audio-checks.mjs`
- `scripts/visual/dreamisland/bed-match.py`
- `scripts/visual/dreamisland/calibrate-beds.py`
- `scripts/visual/dreamisland/calibrate-power-colors.py`
- `scripts/visual/dreamisland/calibrate-sound-levels.py`
- `scripts/visual/dreamisland/effect-pixels.py`
- `scripts/visual/dreamisland/feel.mjs`
- `scripts/visual/dreamisland/hardware-pixels.py`
- `scripts/visual/dreamisland/instrument.mjs`
- `scripts/visual/dreamisland/petal-measure.py`
- `scripts/visual/dreamisland/polish3-frames.mjs`
- `scripts/visual/dreamisland/polish3-report.py`
- `scripts/visual/dreamisland/power-effects.mjs`
- `scripts/visual/dreamisland/race.mjs`
- `scripts/visual/dreamisland/reference-power-colors.py`
- `scripts/visual/dreamisland/render-bed.mjs`
- `src/game/audio.ts`
- `src/game/data/dreamisland/bed-profile.json`
- `src/game/data/dreamisland/power-colors.json`
- `src/game/data/dreamisland/sound-levels.json`
- `src/game/dreamisland-audio-plan.js`
- `src/game/dreamisland-audio.ts`
- `src/game/dreamisland-beds.js`
- `src/game/dreamisland-clock.js`
- `src/game/dreamisland-course.ts`
- `src/game/dreamisland-hardware-layout.js`
- `src/game/dreamisland-hardware.ts`
- `src/game/dreamisland-heroes.ts`
- `src/game/dreamisland-painted-environment.ts`
- `src/game/dreamisland-powers.ts`
- `src/game/dreamisland-runtime.ts`
- `src/game/dreamisland-sound-graph.ts`
- `src/game/totem-evolution.ts`
- `src/game/totem.ts`

Evidence is in this directory. The final visual set is `frames-final/`; `atlas-final/`, `hardware/moss-final/` and `hardware/effects/` are separate proofs. Baseline/trial directories retain the inputs and failures used for calibration. Aborted or occluded capture attempts were removed; they are not acceptance evidence.

## Numbers this pass measured for the first time

All rows below are **VERIFIED by the named instrument**, including measurements that fail their target. Inherited limits and the prior round's budget are distinguished in the next section.

| Measurement | Result | Instrument / evidence |
| --- | --- | --- |
| Audio source / all-transcode / served bytes | 428,756 / 323,152 / 225,912 | `prepare-dreamisland-audio.py`, `audio/transcode.json` |
| New served audio ceiling | 248,504 B = ceil(measured × 1.10) | transcode report; enforced by `validate-build.mjs` |
| Surf / night maximum band error | 1.915807 / 1.385609 dB | `bed-match.py`, tables below |
| BEACH offline mix | 30 s, 24000 Hz, 2 channels; RMS -33.377059 dBFS, peak -11.414349 dBFS | `audio-capture.mjs`, `audio/offline-capture.json` |
| Waterfall night level change | +3.692797 dB RMS | `audio-checks.mjs`, actual shared graph render |
| Clock at strike | minute 0 rad, hour 0 rad in race, sprint, time attack | `validate-dreamisland-runtime.mjs`; rendered 40 m frames |
| Kit geometry / bytes | Surge 832 tris, Shield 990 tris; 168,012 B | Blender builder's exported GLB accessor measurement; painted validator |
| Live hardware | 7 meshes / 4,744 triangles | `polish3-frames.mjs`, live scene |
| Petal opening | 250 ms, measured final angle ≈ 0.700000 rad | `petal-measure.py`, actual instance matrices |
| Deck plates | top 0.085000 m; original five trigger coordinates | `validate-dreamisland-painted.mjs`, projected geometry vertices |
| Corridor | 0 intrusions / 9,729 rays | same validator, including closed/open hardware, lamps, plates and support |
| Final worst-tier rendering | 105 combined draws / 162,334 conservative triangles | four `race.mjs` soaks |
| Works BASIN night loss | 0.000078782 s — FAIL 0.25–0.40 s | `feel.mjs`, actual 120 Hz input samples |
| Works earlier night braking | -0.036228 m — FAIL ≥ 8 m | same instrument, turn-limited approach |

## Registration and asset checklist

**VERIFIED.** All eight supplied MP3s and the power-kit orthographic sheet exist. No image or audio generator was used. Six signatures are served as 24 kHz / 48 kbps mono MP3s; surf and night remain reference inputs because both procedural matches pass. No radio recording was added. Existing voice/music switches and text-only schedule callouts are retained: warning → “THE CLOCK — ONE LAP”; strike → “NIGHT — CAUSEWAY WET”; night-settled adds no flash or voiced line.

The power kit loads through `PowerKit.load` and satisfies both node contracts: `PK_surge_{cage,capacitors,core,mount}` and `PK_shield_{housing,petals,core,lattice}`. It reuses shared metal, concrete and emissive atlases, contains no embedded texture, and adds no power rule. Four whole petal instances rotate on collection. Existing effect geometry/shaders are skinned amber/cyan.

## Budget before / after / gate

The before column is **inherited**, from the approved round-2 evidence and brief; it is not a new measurement. Final values are **VERIFIED** by `race.mjs` and `validate-build.mjs`.

| Axis | Before | After | Gate / remaining |
| --- | --- | --- | --- |
| Worst combined draws | 94 | 105 | 110 / 5 |
| Main + shadow triangles | 157,650 | 162,334 | 180,000 / 17,666 |
| Initial JS gzip | 264.9 KiB (rounded) | 271,474 B (265.111328 KiB) | 272,384 B / 910 B |
| Initial shell gzip | 276.8 KiB (rounded) | 283,642 B (276.994141 KiB) | 283,648 B / **6 B** |
| New served signature audio | 0 B | 225,912 B | 248,504 B |
| Device triangles | marker boxes | 832 / 990 | 1,200 each |
| Frozen seam | game.ts 2,577 lines | byte-identical | no edit |

The shell margin is small and must be remeasured after any subsequent production change. No inherited ceiling or assertion was weakened. Triangles sum the independent main/shadow maxima conservatively. Combined draw peaks are measured per frame; adding independent draw maxima would give a different, invalid peak.

## Validators and code suite

**VERIFIED PASS:** `npm run test:code` with Python 3 + Pillow; full output in `logs/di-polish3-tests-final.log`. This includes the production build and its byte gate. Independent final build JSON: [validators/build.json](validators/build.json). Painted/runtime reports are copied here so the older phase-C reports can remain unchanged.

Clock assertions add 9:00 at start, exact 12:00 at strike and hold for every format, without removing existing assertions. Determinism, snapshot/restore and existing persistence checks remain in the suite. The corridor sweep remains unchanged in density and ceiling and now includes the hardware, both hinge endpoints, target plates, matching lamps and the REEF stone support. Existing bore containment remains 0.301969 m lateral clearance.

## Four soaks and p95 reconciliation

**VERIFIED.** Chrome, high quality, 1280×720, seed 3868938316, music disabled. All four reach the flag after strike and night-settled; all audio graphs load; all have zero browser errors and zero material-walk violations. The report generator checks every recorded soak/audio input hash against the delivered files.

| Run | Laps, ms | Misses / recoveries | Draws | Main + shadow tris | p95 ms | Residual frames |
| --- | --- | --- | --- | --- | --- | --- |
| works | 33158 / 32125 / 31925 | 0 / 0 | 104 | 133,370 + 28,872 | 8.500 | +2.738 |
| rookie | 33158 / 32125 / 31925 | 0 / 0 | 104 | 133,370 + 28,872 | 8.400 | -3.442 |
| feral | 33158 / 32067 / 31900 | 0 / 0 | 105 | 133,462 + 28,872 | 8.500 | -2.313 |
| works-reduced | 33158 / 32125 / 31925 | 0 / 0 | 103 | 132,936 + 28,872 | 8.400 | +4.168 |

The renderer wrapper measures main and shadow passes separately. The percentile uses the measured window below. Expected samples = calibrated refresh rate × window duration; residual = observed − expected. These are desktop/headless observations, not device performance promises.

| Run | Window samples | Window ms | Calibrated Hz | Expected samples | Observed − expected |
| --- | --- | --- | --- | --- | --- |
| works | 720 | 5816.400 | 123.317234 | 717.262357 | +2.737643 |
| rookie | 720 | 5822.500 | 124.249327 | 723.441706 | -3.441706 |
| feral | 720 | 5809.200 | 124.339447 | 722.312714 | -2.312714 |
| works-reduced | 720 | 5805.400 | 123.304562 | 715.832306 | +4.167694 |

Both lighting states retain the shadow pass:

| Run / lighting | Peak main draws | Peak shadow draws | Peak combined draws | Conservative triangles |
| --- | --- | --- | --- | --- |
| works / day | 86 | 23 | 103 | 161808 |
| works / crossfade | 86 | 17 | 103 | 156994 |
| works / night | 82 | 23 | 104 | 155840 |
| rookie / day | 86 | 23 | 103 | 161808 |
| rookie / crossfade | 86 | 17 | 103 | 156994 |
| rookie / night | 82 | 23 | 104 | 155840 |
| feral / day | 86 | 23 | 103 | 161808 |
| feral / crossfade | 86 | 17 | 103 | 157086 |
| feral / night | 83 | 23 | 105 | 155840 |
| works-reduced / day | 86 | 23 | 103 | 161808 |
| works-reduced / night | 86 | 23 | 103 | 161808 |

## E1 — sound and the 1/3-octave match

| Clip | Source bytes | Transcoded bytes | Served |
| --- | --- | --- | --- |
| clock-quarter-chime.mp3 | 40560 | 30620 | yes |
| clock-strike-three-tolls.mp3 | 64592 | 48620 | yes |
| day-birds.mp3 | 64592 | 48620 | yes |
| fish-rise.mp3 | 32618 | 24716 | yes |
| night-bed.mp3 | 64592 | 48620 | reference only |
| surf-bed-day.mp3 | 64592 | 48620 | reference only |
| tunnel-pass.mp3 | 32618 | 24716 | yes |
| waterfall-loop.mp3 | 64592 | 48620 | yes |

Transcoding strips metadata and preserves the supplied clip content. The six-file set measures 225,912 B; its independent pinned ceiling is 248,504 B. The two bed reference transcodes are evidence only.

The procedural beds use seeded versions of the existing brine/noise/canopy synthesis, with measured parametric EQ. `calibrate-beds.py` renders the actual JS synthesis on every iteration; it does not resynthesize from source PCM. `bed-match.py` compares 8 seconds against the original supplied references, resampling both inputs identically to the delivery bandwidth. All 28 complete 1/3-octave bands are included, including quiet bands. **Every band passes ±6 dB.** dB columns are integrated FFT band energy relative to full scale; deltas are render minus reference.

| Centre Hz | Surf reference dB | Surf render dB | Δ dB | Night reference dB | Night render dB | Δ dB |
| --- | --- | --- | --- | --- | --- | --- |
| 19.686 | -65.363 | -65.011 | +0.352 | -54.949 | -54.927 | +0.022 |
| 24.803 | -61.435 | -61.771 | -0.336 | -52.779 | -52.803 | -0.024 |
| 31.250 | -59.008 | -59.268 | -0.260 | -52.869 | -52.862 | +0.007 |
| 39.373 | -57.480 | -57.741 | -0.260 | -48.227 | -48.232 | -0.005 |
| 49.606 | -52.927 | -53.100 | -0.173 | -49.659 | -49.657 | +0.002 |
| 62.500 | -52.936 | -53.051 | -0.116 | -48.033 | -48.034 | -0.000 |
| 78.745 | -49.949 | -50.031 | -0.082 | -45.865 | -45.866 | -0.000 |
| 99.213 | -48.064 | -48.117 | -0.053 | -48.466 | -48.464 | +0.001 |
| 125.000 | -48.924 | -48.960 | -0.036 | -50.474 | -50.475 | -0.000 |
| 157.490 | -47.868 | -47.892 | -0.024 | -50.886 | -50.889 | -0.004 |
| 198.425 | -45.751 | -45.766 | -0.014 | -53.348 | -53.304 | +0.044 |
| 250.000 | -42.809 | -42.821 | -0.012 | -54.476 | -54.474 | +0.001 |
| 314.980 | -41.083 | -41.087 | -0.004 | -53.835 | -53.800 | +0.035 |
| 396.850 | -37.903 | -37.911 | -0.008 | -54.312 | -54.259 | +0.052 |
| 500.000 | -35.776 | -35.779 | -0.004 | -53.815 | -53.712 | +0.103 |
| 629.961 | -34.862 | -34.872 | -0.010 | -54.717 | -54.590 | +0.127 |
| 793.701 | -34.614 | -34.623 | -0.009 | -56.722 | -56.529 | +0.193 |
| 1000.000 | -34.215 | -34.230 | -0.016 | -56.734 | -56.476 | +0.258 |
| 1259.921 | -33.851 | -33.875 | -0.025 | -56.523 | -56.205 | +0.318 |
| 1587.401 | -34.295 | -34.334 | -0.039 | -55.537 | -55.183 | +0.355 |
| 2000.000 | -34.413 | -34.476 | -0.062 | -54.555 | -54.234 | +0.321 |
| 2519.842 | -35.705 | -35.803 | -0.098 | -54.412 | -54.151 | +0.261 |
| 3174.802 | -37.086 | -37.242 | -0.156 | -32.721 | -32.565 | +0.156 |
| 4000.000 | -37.942 | -38.187 | -0.245 | -44.098 | -42.712 | +1.386 |
| 5039.684 | -39.454 | -39.846 | -0.392 | -16.512 | -17.582 | -1.070 |
| 6349.604 | -40.943 | -41.583 | -0.640 | -24.543 | -24.190 | +0.352 |
| 8000.000 | -44.145 | -46.061 | -1.916 | -35.130 | -34.412 | +0.718 |
| 10079.368 | -47.572 | -46.719 | +0.854 | -28.321 | -27.864 | +0.457 |

Level calibration uses the existing Works hum measurement (−27.3 dB, inherited from `audio-probe.mjs` and documented in `audio-ambience.ts`) as the reference. Bells target 9 dB above it, beds/water/fish/tunnel at it, birds 6 dB below it. Actual pre-gain buffer measurements and resulting gains are below; final shared-graph measurements follow, so a gain value is not treated as proof of output level.

| Sound | Measured input dBFS | Metric | Calibrated gain |
| --- | --- | --- | --- |
| surf | -23.4206 | full-buffer RMS dBFS | 0.63978029 |
| night | -16.1091 | full-buffer RMS dBFS | 0.27571076 |
| clock-quarter-chime | -18.3069 | strongest 100 ms RMS dBFS | 1.00079229 |
| clock-strike-three-tolls | -22.4637 | strongest 100 ms RMS dBFS | 1.61505061 |
| waterfall-loop | -19.1399 | full-buffer RMS dBFS | 0.39083624 |
| fish-rise | -28.5805 | full-buffer RMS dBFS | 1.15884207 |
| tunnel-pass | -13.0723 | full-buffer RMS dBFS | 0.19436463 |
| day-birds | -30.9214 | full-buffer RMS dBFS | 0.76044976 |

Positional source coordinates are derived from the painted manifest/GLB anchors by `prepare-dreamisland-audio-positions.mjs`; `--check` confirms they match the manifest. Birds use painted verge palms, fish use each shoal's mean starting position. The listener moves; sources stay at these world positions.

| Source | World position x / y / z, m |
| --- | --- |
| clock | 390.068 / 23.931 / 673.490 |
| waterfall | 506.499 / 27.000 / 623.003 |
| tunnel | 655.853 / 22.000 / 299.184 |
| birds-GROVE | 312.852 / 3.536 / -14.145 |
| birds-CUT | 56.844 / -0.200 / 241.606 |
| fish-basin-eight | 546.319 / 6.950 / 559.720 |
| fish-reef-loop | 4.338 / -3.400 / 492.490 |

`audio-checks.mjs` measures the clock's strongest 100 ms through the existing master/compressor at BEACH -29.019, REEF -27.068, CUT -28.584 dBFS. The waterfall measures -35.370 → -31.678 dBFS, with its actual filter at 11000 → 2600 Hz. Birds reach zero over the audio ramp. The tunnel clip takes the dry effects bus; the engine retains its existing underpass reverb, avoiding another send on the recorded echo.

Shared music/ambience ducking takes the stronger radio or clock duck (−3 / −2 dB), rather than multiplying them. Checks exercise overlap and release, music=0, voice=0, reset/rearm/dispose, and the actual wrapper under normal/reduced motion with identical audio-level samples. Audio uses its own schedule-derived 12-second ramp and never reads the visual reduced-motion jump. See [audio/checks.json](audio/checks.json).

**Listening artifact:** [30-second BEACH strike WAV](audio/strike-beach-30s.wav), float32 stereo, 5,760,044 bytes. `audio-capture.mjs` schedules the shipped graph into native OfflineAudioContext using the real EngineAudio master, compressor, buses and idle engine. It pins the BEACH chase listener, disables music/voice, and applies no post-normalization. Strike starts at 10.000 s; the ramp ends at 22.000 s. Output peak 0.268709213 is below clipping. This is an offline mix, not a live microphone or video recording.

**UNVERIFIED listening gap:** the supplied strike file's strongest 100 ms begins at 7.9 s within the clip; the quarter chime's at 2.0 s (`level-calibration.json`). Playback is scheduled at the exact event, with the supplied attacks preserved. Three perceptually distinct tolls and immediate cue recognition require the user's audition of the WAV; the file name alone is not that proof. No voiced Dream Island lines were generated.

## E2 — running clock

**VERIFIED:** the 40 m captures pin race tick 7414 (`strikeTick − 600`) and strike tick 8014. Before strike, minute = 5.812769636565 rad and hour = -0.117603917654 rad. At strike both are exactly zero. The minute completes one revolution, the hour moves 9→12, then both hold; Sprint reads its own schedule. Matrices are set from the pure tick function, never accumulated delta time. The two authored hand meshes retain independent pivots and shared materials.

See `frames-final/clock-before-strike.png`, `clock-at-strike.png`, `capture.json`, and `validators/runtime-validation.json`.

## E3 — hardware, trigger plates and colour measurements

**VERIFIED:** source heights are 1.591680 m Surge and 1.580000 m Shield. Exported kit SHA-256: `bad78568990a69ee1757a9153c0d5023f0b4f0369b97f0d1993c67c5d9ced5bd`. Runtime batches five devices, lamps, plates and support into seven draws. All use lit, fogged, tone-mapped shared atlas materials. Bronze compensation uses float vertex attributes because the GLB exporter's normalized colour accessor clamps values above one.

The five trigger positions, collect radius and power simulation are unchanged. Tall hardware sits on the verge at the same progress; the plate is the target. Each device carries a matching core lamp, and plate/core emission follows the same charge/availability. Collected targets go dark. The GROVE foot is raycast onto the actual flat sand shoulder beyond its steep inner bank. REEF has no sand under the foot, so a stone outrigger meets the pier edge flush with the deck.

| Pickup | Progress | Trigger lateral m | Hardware lateral m | Offset from trigger m | Foot Y m | Plate top m |
| --- | --- | --- | --- | --- | --- | --- |
| beach-turbine | 0.045 | 0 | 15.5 | +15.5 | -0.169876 | 0.085000 |
| grove-projector | 0.205 | -4 | -14.4 | -10.4 | 10.506487 | 0.085000 |
| court-turbine | 0.575 | 4 | 14.5 | +10.5 | 8.661289 | 0.085000 |
| reef-projector | 0.715 | -5 | -15.5 | -10.5 | 0.000000 | 0.085000 |
| cut-turbine | 0.905 | 0 | 13.5 | +13.5 | -0.169876 | 0.085000 |

The positive/negative offset sign follows the course's lateral axis. Plates are 2.8 × 3.6 m and 0.08 m thick, with tops 0.085 m above the deck, below the user's 0.3 m allowance. These dimensions and the two hinge envelopes are checked by the painted validator; all corridor rays pass.

The four petals are independent whole-mesh hinges. Actual float32 instance matrices measure about 0.612500 rad at 125 ms and 0.700000 rad at 250 ms. `petal-measure.py` checks the measured endpoint; no per-vertex animation is used. See the 0/15/30-tick collected frames.

Core, plate, bronze and moss colours were sampled/corrected against the supplied sheet and rendered again through the shared AgX/light/fog path. `reference-power-colors.py` records the source ROIs and RGBs; `calibrate-power-colors.py` records input/output corrections. `hardware-pixels.py` measures only visible pixels matching the isolated object within 2/255 and differing from its blank by more than 5/255. Source linear values are linearized mean sRGB; rendered luma is the mean of per-pixel linear luma. They are labelled separately and are not claimed to be pixel-exact matches.

Bronze's separate ratio calculation is retained in `hardware/color-fit/bronze-correction.json`: before × targetLinear / measuredLinear, followed by the normal-material verification below. Its earlier moss ROI is historical; the final moss correction uses the green joint mask in `reference-colors.json` and `moss-baseline/color-correction.json`.

| Pinned shot | Visible pixels | Mean linear luma |
| --- | --- | --- |
| surge-day-8m | 2539 | 0.152984 |
| surge-night-8m | 2559 | 0.197140 |
| shield-day-8m | 1478 | 0.224046 |
| shield-night-8m | 1493 | 0.313479 |
| surge-half-charge | 2573 | 0.124643 |
| shield-moss-day | 211 | 0.043537 |
| shield-moss-night | 211 | 0.003183 |
| shield-metal-day | 5869 | 0.084743 |
| shield-metal-night | 5890 | 0.019469 |
| surge-plate-day | 140639 | 0.193481 |
| surge-plate-night | 140639 | 0.253093 |
| shield-plate-day | 138272 | 0.319079 |
| shield-plate-night | 138272 | 0.389303 |

The existing effect shader proof (`power-effects.mjs` + `effect-pixels.py`) compares fixed-pose active/off frames: Surge's added light is warm (R > G > B), Shield's is cyan (G/B > R). Bright jet centres remain white from the existing effect; the outer burst carries the warm tint. See `hardware/effects/`.

## Rendered-pixel atlas checks

**VERIFIED 28/28, zero undecided.** The debug instrument substitutes quadrant ID textures while retaining each mesh's actual UVs. Each consumer must render and its mask must choose the claimed quadrant. Original consumers remain covered, with additional claims for the kit's metal/stone/moss/support and both independent clock hands. The four core/plate claims are:

| Consumer | Atlas cell | Claim / measured | Mask pixels | Nearest-colour margin |
| --- | --- | --- | --- | --- |
| surge-core | emissive/lamp-disc | BL / BL | 379 | 268.696 |
| shield-core | emissive/shallows-glow | TR / TR | 683 | 185.816 |
| surge-plate | concrete/road-sand | TL / TL | 25060 | 252.099 |
| shield-plate | concrete/road-sand | TL / TL | 25784 | 249.763 |

This explicitly covers **both concrete road-cell plates**, as requested, as well as both emissive cores. Full proof and frames: [atlas-final/atlas-quadrant-proof.json](atlas-final/atlas-quadrant-proof.json). It is a cell-selection proof; final colour/luma uses the normal-material frames above.

## E4 — stopwatch and braking evidence (targets not met)

**VERIFIED measurements, FAIL acceptance.** `feel.mjs` interpolates district boundary crossings from the real driver's 120 Hz samples, unwrapping progress at the physical seam. It does not use the lap UI counter, which advances slightly before that seam. Incomplete first BEACH / final CUT splits are omitted. Full Works splits:

| Sector | Lap 1 ms | Lap 2 ms | Lap 3 ms |
| --- | --- | --- | --- |
| BEACH | incomplete | 4053.317 | 3861.425 |
| GROVE | 5604.529 | 5593.867 | 5592.778 |
| POINT | 3500.139 | 3501.011 | 3499.985 |
| BASIN | 3458.720 | 3460.238 | 3459.558 |
| COURT | 4189.614 | 4189.489 | 4189.672 |
| REEF | 5537.457 | 5534.824 | 5537.299 |
| CUT | 5787.457 | 5785.232 | incomplete |

Night BASIN enters at the tail of the lighting ramp (the shipped grip change has already happened) and exits at full night. The 8.333 ms input interval limits temporal resolution; fractional interpolation digits are retained for reproducibility, not claimed as physical sub-tick accuracy.

| Run | Day BASIN mean ms | Night BASIN ms | Night loss ms | Earlier night brake m |
| --- | --- | --- | --- | --- |
| works | 3459.479 | 3459.558 | +0.078782 | -0.036228 |
| rookie | 3459.479 | 3459.558 | +0.078782 | -0.036228 |
| feral | 3459.578 | 3459.803 | +0.225571 | -0.623913 |
| works-reduced | 3459.479 | 3459.558 | +0.078782 | -0.036228 |

The CUT measurement identifies the first nonzero brake during the actual turn-limited approach to the first CUT turn. It also retains the literal first brake after the district boundary in `feel.json`; the driver is already braking there, so that later point is not substituted for the approach measurement.

| Lap | Progress at first turn-limited brake | Course distance m | Fog density |
| --- | --- | --- | --- |
| 1 | 0.793288763 | 1903.893030 | 0.0016 |
| 2 | 0.793470207 | 1904.328496 | 0.0016 |
| 3 | 0.793394580 | 1904.146991 | 0.0034 |

The day mean minus night position is -0.036228 m: night is slightly later. `src/game/autopilot.ts:318` calculates braking distance from speed and turn target; the controller never reads fog. Increasing rendering fog therefore cannot produce the requested ≥8 m shift on its own.

Permitted grip/width experiments were run through the actual driver in an isolated browser response, leaving production route/physics unchanged:

| Instrument run | Day / night grip; trial width | Day BASIN ms | Night BASIN ms | Loss ms |
| --- | --- | --- | --- | --- |
| baseline-works | 1 / 0.85; original width | 3459.479 | 3459.558 | 0.078782 |
| grip-trial-030 | 1 / 0.30; original width | 3459.479 | 3463.020 | 3.540637 |
| grip-floor-control | 1 / 0.20; original width | 3459.479 | 3466.664 | 7.185027 |
| width-grip-trial | 1 / 0.20; BASIN 14 m | 3461.989 | 3674.518 | 212.528778 |
| width-floor-trial | 1 / 0.20; BASIN 13.9 m | 3462.304 | 3674.284 | 211.980563 |

The minimum-grip control at original width loses 0.007185027 s. The strongest tested combination loses 0.212528778 s; it also remains below the target.

The width trials are diagnostic course-sample overrides, not a rebuilt authored route or an accepted solution. All trial runs completed with zero misses/recoveries, but neither meets 250–400 ms. The 13.9 m trial reaches the existing station-width validator floor. This is evidence of these failed trials, not a proof over every possible width profile.

**Pending user decision:** the proposed next step is a Dream Island wet-surface drag term applied to human and demo craft plus a fog-based demo braking margin, then calibration against the requested measurements. That crosses the inherited collision-rule boundary and extends E4 beyond its stated grip/width/fog-density levers; approval was requested and has not arrived. No such extension was implemented. Production grip remains 0.85. No pace solve was run because the production route/physics and Works lap times are unchanged; if subsequently needed, the named solver is `scripts/solve-dreamisland-pace.mjs`. Fog is unchanged, so the existing crossfade baseline was not replaced or rerun.

## Discrepancies, open gaps and work left undone

- **E4 remains open** for the measured reasons above. E5's evidence package is present, but the overall acceptance cannot close while E4 fails.
- The original five coordinates were inside the protected driving corridor. The user's explicit amendment authorizes verge hardware plus low road plates; offsets and plate atlas proof are above. No collect trigger moved.
- Audio references are complete. Only six files ship because both procedural beds pass. The brief's “commit” wording for scripts/WAV is superseded by the user's **do not commit** instruction; all deliverables remain uncommitted.
- **UNVERIFIED:** user listening judgment on bell recognition, three tolls, water/bed character and mix; user visual judgment on the 40 m landmark silhouettes and reference likeness; non-desktop/device performance. Headless pixels and spectra establish the listed properties, not those judgments.
- The shared radio bank is unchanged. New voiced callouts remain a future request; none are needed for the specified text-only behaviour.
- Only the newly touched hardware/clock/effects were visually remeasured. Skies, water and fog are byte-identical; no new crossfade claim is made.

## Commands and reproduction

Run from the repository root with Node 20.19.4 on PATH, Python 3 + Pillow + numpy, ffmpeg/ffprobe and the existing local Chrome harness. The local preview used port 5200. Browser commands are serial for uncontended timing; the user's server was left running.

This is a command ledger, not an end-to-end rerun recipe: calibration commands were interleaved with captures and apply corrections to the palette/profile used for those captures. To verify the delivered state, start with `npm run test:code` and rerun the capture/measurement commands without the prepare/build/calibrate authoring steps.

```sh
export PATH="$HOME/.nvm/versions/node/v20.19.4/bin:$PATH"
python3 scripts/prepare-dreamisland-audio.py
node scripts/prepare-dreamisland-audio-positions.mjs
node scripts/prepare-dreamisland-audio-positions.mjs --check
python3 scripts/visual/dreamisland/calibrate-beds.py
node scripts/visual/dreamisland/render-bed.mjs
node scripts/visual/dreamisland/audio-capture.mjs --out=art/evidence/dreamisland-v1/polish-3/audio/level-baseline
python3 scripts/visual/dreamisland/calibrate-sound-levels.py
node scripts/visual/dreamisland/audio-capture.mjs --out=art/evidence/dreamisland-v1/polish-3/audio
node scripts/visual/dreamisland/audio-checks.mjs --out=art/evidence/dreamisland-v1/polish-3/audio
python3 scripts/visual/dreamisland/bed-match.py art/references/dreamisland/phase-e/audio/surf-bed-day.mp3 art/evidence/dreamisland-v1/polish-3/audio/surf-bed-offline.wav art/evidence/dreamisland-v1/polish-3/audio/surf-band-match.json
python3 scripts/visual/dreamisland/bed-match.py art/references/dreamisland/phase-e/audio/night-bed.mp3 art/evidence/dreamisland-v1/polish-3/audio/night-bed-offline.wav art/evidence/dreamisland-v1/polish-3/audio/night-band-match.json
python3 scripts/visual/dreamisland/reference-power-colors.py
python3 scripts/visual/dreamisland/calibrate-power-colors.py art/evidence/dreamisland-v1/polish-3/hardware/color-trial
python3 scripts/visual/dreamisland/calibrate-power-colors.py art/evidence/dreamisland-v1/polish-3/hardware/moss-baseline --moss
/Applications/Blender.app/Contents/MacOS/Blender -b --python art/blender/build_dreamisland_power_kit.py
npm run test:code
node scripts/validate-build.mjs --out=art/evidence/dreamisland-v1/polish-3/validators
node scripts/visual/dreamisland/polish3-frames.mjs --out=art/evidence/dreamisland-v1/polish-3/frames-final
python3 scripts/visual/dreamisland/hardware-pixels.py art/evidence/dreamisland-v1/polish-3/frames-final
node scripts/visual/dreamisland/polish3-frames.mjs --out=art/evidence/dreamisland-v1/polish-3/hardware/moss-final --shots=shield-moss-day,shield-moss-night
python3 scripts/visual/dreamisland/hardware-pixels.py art/evidence/dreamisland-v1/polish-3/hardware/moss-final
python3 scripts/visual/dreamisland/petal-measure.py art/evidence/dreamisland-v1/polish-3
node scripts/visual/dreamisland/power-effects.mjs --out=art/evidence/dreamisland-v1/polish-3/hardware/effects
python3 scripts/visual/dreamisland/effect-pixels.py art/evidence/dreamisland-v1/polish-3/hardware/effects
node scripts/visual/dreamisland/atlas-quadrant-proof.mjs --out=art/evidence/dreamisland-v1/polish-3/atlas-final
for tier in works rookie feral; do
  node scripts/visual/dreamisland/race.mjs --tier="$tier" --out="art/evidence/dreamisland-v1/polish-3/soak-$tier"
done
node scripts/visual/dreamisland/race.mjs --tier=works --reduced --out=art/evidence/dreamisland-v1/polish-3/soak-works-reduced
for tier in works rookie feral works-reduced; do
  node scripts/visual/dreamisland/feel.mjs "art/evidence/dreamisland-v1/polish-3/soak-$tier"
done
node scripts/visual/dreamisland/race.mjs --tier=works --grip=0.3 --out=art/evidence/dreamisland-v1/polish-3/grip-trial-030
node scripts/visual/dreamisland/race.mjs --tier=works --grip=0.2 --out=art/evidence/dreamisland-v1/polish-3/grip-floor-control
node scripts/visual/dreamisland/race.mjs --tier=works --grip=0.2 --basin-width=14 --out=art/evidence/dreamisland-v1/polish-3/width-grip-trial
node scripts/visual/dreamisland/race.mjs --tier=works --grip=0.2 --basin-width=13.9 --out=art/evidence/dreamisland-v1/polish-3/width-floor-trial
for trial in baseline-works grip-trial-030 grip-floor-control width-grip-trial width-floor-trial; do
  node scripts/visual/dreamisland/feel.mjs "art/evidence/dreamisland-v1/polish-3/$trial"
done
python3 scripts/visual/dreamisland/polish3-report.py
git diff --check
```

Calibration commands mutate their profile/palette files; run them only when recalibrating, followed by rebuilt assets, new frames and measurements. Acceptance commands read production assets and write evidence. The original baseline predates implementation and cannot be regenerated from this changed checkout without the recorded starting revision. The report/contact sheet generator only reads inputs and writes this evidence directory.
