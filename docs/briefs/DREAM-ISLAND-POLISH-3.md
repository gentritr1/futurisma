# Dream Island — POLISH-3: sound, the running clock, power-kit hardware, feel

**STATUS: FINAL (2026-09-11). Start from `main` (merge commit `311b5fa` or later — phases A–D, two polish rounds and the paddock fix are all on `main`).** For Codex, with no access to the conversation that produced this. Read `docs/briefs/DREAM-ISLAND-HANDOFF.md` first (environment, rules, report format), then round 1's §2 collision rule and §3 ceilings (`DREAM-ISLAND-CODEX-POLISH.md`) — they still bind, with the current numbers: **worst tier 94 draws / 157,650 triangles against the 110 / 180,000 gate**, shell gzip **0.2 KiB** spare, `src/game/game.ts` at its 2577-line seam ceiling (untouchable).

The map is scope-complete and visually polished twice. What it does not have: **any sound**, a clock whose hands **move**, real **power-kit hardware**, or a night turn that is **felt** on the stopwatch. That is this pass. Generated inputs are in `art/references/dreamisland/phase-e/` with `generation.json` (verbatim prompts, job ids, cost, verdicts) — eight signature SFX clips and one orthographic sheet for the two devices. **You may not generate images or audio**; if something is missing, say what and why.

## E1. Sound — the signature clips plus procedural beds

The game's audio is procedural WebAudio by design; sampled files are the exception (the shared 17-line radio bank at 24 kHz / 48 kbps mono, Ascension's three cue WAVs). Keep that shape: the eight clips are the sounds that must be *exactly* these — the bells, the water, the fish — and the district beds are synthesised to match them, as every other map's are.

Clips (`phase-e/audio/`, 44.1 kHz mono MP3 as generated — transcode to the radio bank's format and report bytes before/after):

| File | Role | Where it fires |
|---|---|---|
| `clock-quarter-chime.mp3` (5 s) | the `chime-warning` event | at `chimeTick`, from the clock tower's world position, audible across the map (this is the driver's cue — it must be heard on REEF/CUT, not only near the tower) |
| `clock-strike-three-tolls.mp3` (8 s) | the `strike` event | at `strikeTick`; the 12 s crossfade rides under it — toll 1 starts the ramp |
| `waterfall-loop.mp3` (8 s) | BASIN | positional loop at the waterfall lip; louder and lower-passed after the strike (wet causeway) |
| `fish-rise.mp3` (4 s) | `fish-rise` event | once per shoal, from each shoal's rise position |
| `surf-bed-day.mp3` (8 s) | reference for the BEACH/REEF procedural bed | **tone-match target**, not shipped as a loop unless the synthesis cannot get within the measure below |
| `night-bed.mp3` (8 s) | reference for the post-strike bed | same |
| `tunnel-pass.mp3` (4 s) | POINT bore | one-shot on bore entry, mixed with the existing `underpass` reverb zone (do not double the reverb) |
| `day-birds.mp3` (8 s) | GROVE/CUT verge | sparse; ducks to zero over the ramp |

Rules: everything goes through the existing audio graph and its ducking (music −3 dB / ambience −2 dB precedence as pit radio does); `?music=0` and `?voice=0` semantics unchanged; new served bytes get their **own measured ceiling** pinned in `validate-build.mjs` the way pit radio's 192 KiB is (measure the transcoded set, pin at measured + 10%, state both). Positional sources are attached to world positions from `painted.json`, never to the camera. Under `?motion=reduce` nothing changes for audio (motion, not sound).

**Beds: tone-matched, not eyeballed.** Build the procedural surf and night beds from the existing ambience synthesis, then prove the match: an offline render of 8 s of each bed vs the reference clip, compared by 1/3-octave band energy (a 30-line Python script with numpy; commit it). Target: every band within ±6 dB of the reference, reported per band. If the synthesis cannot get there, ship the clip as a loop and say so — a shipped clip with a stated reason beats a bed that "sounds about right".

**Pit radio.** The bank is one voice; do not add lines in another. Reuse existing lines where a meaning fits (`gate_clear`, `final_lap`, `slipstream_locked`…) and add three new **text-only** HUD callouts driven by the schedule instead: chime → "THE CLOCK — ONE LAP", strike → "NIGHT — CAUSEWAY WET", night-settled → nothing (the silence is the point). If the user later wants voiced lines, they must be generated in the bank's voice; note it as a gap.

## E2. The clock runs

The clock tower's hands (`heroes/clock-tower.glb`, meshes `clock_hour_hand` / `clock_minute_hand`) are static. Drive them from the schedule tick: the minute hand completes one revolution between race start and `strikeTick`, the hour hand moves from 9 to 12 over the same span, both snapping to 12 at the strike and holding. Pure function of tick (snapshot-safe, reduced-motion-safe — hands still move; they are gameplay information). Sprint uses its own table. Measurable: a 40 m frame at `strikeTick − 600` and at `strikeTick` showing the hands' angles, plus a runtime-validator assertion that the hand angle at `strikeTick` is exactly 12:00 in every format.

## E3. Power-kit hardware

`phase-e/power-kit-ortho-gptimage2.png`: SURGE "sunburst" (iron cage on a cyan-striped stone mount, four capacitor cylinders, amber core, sunburst finial) and SHIELD "tide bell" (bronze bell housing on a stone mount, four hinged petals, cyan core, lattice ring, moss in the joints), four views each at one scale, both ≈ 1.6 m tall. Build `public/assets/dreamisland/power-kit.glb` on the six shared atlases (metal for cage/bell/capacitors, concrete for mounts, emissive for both cores ∝ charge state and nightBlend) with the node contract the engine requires: `PK_surge` with `PK_surge_{cage,capacitors,core,mount}` and `PK_shield` with `PK_shield_{housing,petals,core,lattice}` (`power-kit.ts:118-126` throws otherwise). ≤ 1,200 triangles per device. Replace the phase-A marker boxes at the five pickup positions from `dreamisland-powers-config.js`; petals open on collect (whole-mesh transform, ≤ 300 ms). Skin the existing effects only — surge burst warm amber, shield ring cyan — no rule changes. Corridor validator must stay at 0 intrusions; atlas-cell proof for both cores.

## E4. Feel, on the stopwatch

Two things the instruments say are true but the driver cannot feel:

- **The wet causeway.** Grip 0.85 reaches the craft (proven) but the demo line loses **0.0 s** to it. Tune grip and/or the causeway's authored width so the demo line loses **0.25–0.40 s** on the BASIN sector on the night lap versus the day laps (measured from per-sector times in the soak — add sector splits to the diagnostics if absent), without a single missed gate at any tier, and re-solve pace only if the works lap moves by more than 0.2 s (name the solver). This is the one number in this pass that is authored, and it is authored against a measurement.
- **Night fog and the braking board.** Measure the demo autopilot's braking point into the CUT chicane by day and by night (progress at first brake input); if night does not move it by ≥ 8 m, raise night fog density until it does, then re-run the crossfade instrument so T1–T3 still hold on a new baseline.

## E4 — RULING 2026-09-12 (both targets closed, one accepted as measured, one withdrawn)

- **Wet causeway: accepted at the measured 0.213 s.** The 0.25–0.40 s band was an authored feel value, not a measurement; the demo autopilot's near-straight line through BASIN loads almost no lateral grip, so it is the wrong instrument for "felt". 0.213 s on that line is the honest number, and pushing grip lower to satisfy a band written before the measurement would trade rival determinism and gate safety for a figure nobody has felt. Whether 0.85 is *felt* is a controller-in-hand question and is now on the playtest list, not the build list.
- **Night fog moving the braking point: withdrawn.** The demo autopilot brakes on curvature, not visibility — it cannot see fog by construction — so the ≥ 8 m target measured the wrong actor. The proposed controller/physics extension to make it react to fog is **not approved**: it would change the deterministic demo that calibrates the schedule and solves rival pace, re-baselining every soak on every map, and it lands against `game.ts` at its seam ceiling. Human braking under night fog belongs to the same playtest.
- Lesson recorded: a feel target must name the *actor* it is measured on; an autopilot target is only valid for behaviour the autopilot has.

## E5. Evidence and acceptance

`art/evidence/dreamisland-v1/polish-3/` with a README naming every command. Closes only on: `npm run test:code` PASS (python3 + Pillow); the transcoded audio set under its new pinned ceiling; the bed match table; a **30-second capture with audio** of the strike from the BEACH pose (headless Chrome can record the WebAudio graph offline — mix to a WAV and commit it; the user listens to that); the two clock frames and the hand assertion; power-kit frames at 40 m day/night and the corridor result; the sector-split table showing the causeway delta and the braking-point delta; four soaks with the ceiling table (≤ 110 draws / ≤ 180,000 tris worst tier, p95 reconciled). Report in the handoff's format, with a "numbers this pass measured for the first time" section.
