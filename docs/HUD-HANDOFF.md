# FUTURISMA · UI / HUD pass — implementation handoff

Design reference: `gentritr1/futurisma` @ `main` (tree `1d4cbc1`), read 2026-09-07.
**Not verified against the local Desktop checkout.** Diff every file named below against the working tree, preserve uncommitted changes, treat the local build as truth.

## 0. Deliverables in this project (current)

| File | Status |
|---|---|
| `FUTURISMA UI Prototype.dc.html` | **Current.** Integrated prototype: approved art direction, 15 review states, wired player flow (Launch → HUD → Pause → Options/Quit → Results), simulated device clock, HUD/menu scale, four viewports, 1:1 pixel mode. |
| `HANDOFF.md` | This document. |
| `Art Direction.dc.html` | **Archived study.** The approved treatment's origin (3 frames + component sheet). Superseded by the prototype; keep for reference only. |
| `Before (reconstructed).dc.html`, `Before HUD.dc.html` | **Archived.** Current UI rebuilt from `index.html` + `style.css` at 1280×720. Mockups, not captures. |
| `backdrops/` | Synthetic contrast plates (nightshift/polarity/foundry), pixel-patched README capture (`bitterpan-clean.png`), HUD-free crops (`bitterpan-band.png`, `greenwater-band.png`). **All stand-ins.** |
| `liveries/` | Issue-number tiles cropped from the shipped decal sheets; TOTEM render crop from `power-kit/vehicle-preview.png`. Real assets. |

Earlier handoff sections describing a variant B, a 17-state count, a "≈330 px" cluster width or a 3 px/8 px meter are superseded by this document.

## 1. What actually works in the prototype vs. what is simulated

**Works (prototype behaviour you can click through)**
- Launch sheet: circuit / edition / format / field / livery chips drive title, map code, deck line, real lap length, band image, OBJECTIVE plate, record line (against a one-entry simulated save), livery tile and vehicle line.
- LAUNCH RACE (button, or Enter with no control focused) opens a HUD matching the selection (circuit, edition, lap count, time-attack field of one). Esc/P pauses. **Focus rule:** Enter/Space on a focused button or chip activates that control only — global shortcuts act only from a non-interactive target (launch, pause, results alike).
- Pause prompts are truthful: RESUME (Enter) runs a 3-second RESUME SEQUENCE (3·2·1 in the HUD, status RESUME SEQUENCE, device clock frozen for the whole countdown); QUIT TO PADDOCK requires a 0.9 s hold (Escape held, or mouse/Enter held on the button) with a fill and a KEEP HOLDING label. The hold belongs to the input that started it and is cancelled by that input's release wherever the event lands (window, capture phase), by window blur, by tab hide, and by leaving the pause screen (RESUME / SYSTEM OPTIONS / a completed quit); it can only complete while the pause screen is still up. See §8. SYSTEM OPTIONS returns to pause; Options/Controls return to the screen they were opened from. Enter in the HUD skips to results (prototype-only shortcut, labelled in the caption).
- Results are bound to the launched run: circuit (incl. FOUNDRY edition), format, tier, livery and lap count come from the run; rivals are the three liveries the player is not wearing (fieldLiveries rule); lap/race times are simulated but scaled by the circuit's real lap length. The standalone FIELD RACE / TIME ATTACK review fixture only appears when no run has been launched.
- Launch sheet reflows: the configuration column scrolls inside a bounded height while LAUNCH / CONTROLS / OPTIONS stay fixed beside it; checked at 1280×720 with MENU TEXT L, with Tideline's EDITION row, and with the FONT-FAILURE TEST toggle (forces the fallback stack on the stage) — no clipping, LAUNCH reachable.
- Device clock: one simulated clock drives the slot fill, the "Ns LEFT" text and expiry; pause **and** the resume countdown freeze it, racing continues it from the frozen value; the slot empties at zero. Reduced motion keeps the same values and removes only the outline pulse and the boost ignite/kick.
- Ladder is derived from the frame's position + gaps, so tab and ladder cannot disagree.
- Lockout: hazard-striped track + warning label; the fill still draws the true reserve.
- Lower-left cluster has a fixed 414 px footprint (34 pad + 340 instruments + 40 fade) with wrapping text columns; verified at 1280×720 in busy, cooldown, empty-device and Tideline states at HUD M and L.

**Simulated (labelled on screen)**
- All race values, gaps, times, charges, cooldowns, records and the save file.
- Backdrops (see §0). The Bitterpan HUD sits on a pixel-patched capture; Polarity / Night Shift / Tideline sit on synthetic plates.
- Barlow Condensed is loaded from Google Fonts here (this environment cannot download binaries); fallback stack `'Arial Narrow', Inter, sans-serif` and fixed button heights keep layout intact if the font fails — verifiable with the FONT-FAILURE TEST toolbar toggle (a prototype-only `[data-font-test] * { font-family … !important }` hook).
- Timers: the device clock, resume countdown and quit-hold share one 100 ms beat. The design-tool runtime clears main-thread timers created around a logic mount, so the beat is posted from a tiny Worker (rAF fallback) injected by a page-realm script and dispatched to the live logic instance; hidden tabs throttle it to ~1 beat/s, so test in a visible tab. None of this applies to the game — the race loop already owns its clock and pauses on FOCUS LOST.
- Gamepad menu buttons (START / B / Y / X) are proposals; the game documents only Start (pause) and Back (mute) for menus.
- "Next supply" glyph on an empty slot is hard-coded to Shield.

**Needs local-game integration (not demonstrable here)**
- Real `HudFrame` binding, per-frame update discipline, `getTransferStatus()` / `launchZoneAt()` / `powerSeconds` reads, save schema changes, input-device detection, QUIT TO PADDOCK teardown, genuine HUD-free captures, contrast measurement on real frames, performance and accessibility validation, playtest.

## 2. Design decisions (approved)

Shape language from `totem_decals_1024_works.png`: −10° parallelogram plates (`skewX(-10deg)` on the plate, `skewX(10deg)` on content), 8 px chamfer on dark plates, the acid dashed band as the reserve meter, the hazard stripe for lockout. Type: Barlow Condensed 800 italic for position / speed / circuit title / LAUNCH, 700 for lap, percent, distance, device and action names; the repo mono for every precise value. Colour: existing five accents only, as solid surfaces where they carry meaning (acid position tab — cyan in time attack; cyan RACE TIME tag; acid LAUNCH; lavender device fill; amber/cyan deck bar; warning stripe).

Priority gate: safety (recovery › wrong way › missed gate › edge) owns the slot under the nav cue; navigation keeps its own slot; rewards (lap banner, near miss) and ambient (soundtrack) are held while a safety alert is up. GUST / SALT / SQUALL and SLIPSTREAM sit above the reserve they affect.

## 3. Component boundaries (CSS + DOM, no framework)

| Block | Contents | Existing ids preserved |
|---|---|---|
| `.hud-standing` (top-left, 34/48) | acid tab (`P2` / `TA`), dark lap tab with pips, gap line, 3-row ladder with gaps | `#position-value` `#lap-value` `#gap-value` `#field-order` |
| `.hud-timing` (top-right) | cyan tag, 36 px mono time, TA delta 34 px, gate delta, secondary line | `#time-value` `#last-lap-value` `#delta-chip` `#delta-chip-value` `#sector-delta` |
| `.hud-gate` (top-centre, 500 px) | gate, sector, clean chain, finish distance, 4 px track | `#checkpoint-value` `#sector-value` `#clean-chain` `#finish-value` `#progress-fill` |
| `.hud-cue` (top 136) | turn / finish cue | `#turn-cue` `#turn-arrow` `#turn-label` `#turn-distance` |
| `.hud-alert` / `.hud-banner` (top 196, shared slot) | safety text + recovery bar / lap & race event | `#edge-warning` `#edge-warning-label` `#edge-warning-fill` / `#lap-event` `#lap-event-label` `#lap-event-time` |
| `.hud-drive` (bottom-left, **414 × auto**) | chips, 92 px speed, drive state, 300 × 14 reserve + 3 px drift lip, `.hud-device`, `.hud-gravity` | `#speed-value` `#drive-state` `#boost-meter` `#boost-label` `#boost-value` `#boost-fill` `#drift-charge` `#slipstream-chip` `#slipstream-fill` `#track-event-chip` `#track-event-label` `#soundtrack-chip` |
| `.hud-device` (56 px slot + 268 px text) | glyph mask + outline, fill = charge (held) or remaining fraction (active), key tab, name + strength, state line | `#polarity-hud` `#polarity-power` `#power-charge-fill` |
| `.hud-gravity` (56 px slot + 268 px text) | two deck bars, arrow, gap label (cooldown s / junction m / depth), key tab, deck+supply line, action, reason | `#polarity-deck` `#polarity-flip` `#polarity-route` |
| `.minimap` | 132 × 140 plate, unchanged canvas | `#minimap` |

Move nodes in `index.html`; do not recreate them in JS. `GameUi` resolves by id, so re-parenting is binding-safe if ids and `data-*` stay. Fold the trailing override block of `style.css` (from `.polarity-hud` down) into these blocks. Four HUD type sizes, all `calc(N px * var(--hud-scale))`: 11–12 px mono label, 13–14 px mono body, 36 px mono time, 62 / 92 px condensed numerals.

Glyph paths (authored): SURGE `M14,18 L26,18 L40,36 L26,54 L14,54 L28,36 Z M34,18 L46,18 L60,36 L46,54 L34,54 L48,36 Z`; PHASE SHIELD (evenodd ring) `M36,10 L58,23 L58,49 L36,62 L14,49 L14,23 Z M36,21 L49,28.5 L49,43.5 L36,51 L23,43.5 L23,28.5 Z`. Draw each twice: as the mask cut and as a 1.5 px outline on top, so identity survives an empty fill.

## 4. State model the HUD reads (reuse, no new mechanics)

- Speed, boost, lockout, drift bank, slipstream, track event, gates, turn cue, edge/recovery/wrong-way, position + gaps: `HudFrame` (ui.ts) — unchanged. Add `gapMs` to `FieldOrderEntry`.
- Device: `heldPowerKind`, `heldPowerCharge` (strength while held), `state.activePower`, `state.activeCharge` (**strength, constant while active**), `powerSeconds` (**remaining duration**), `powerPerfect`, `launchZoneAt(progress)`. Fill = `heldCharge` when held, `powerSeconds / totalSeconds` when active (total = `SURGE_SECONDS·(.8+.2·charge)+perfect` or `SHIELD_SECONDS`, from polarity-rules.js). Show strength as text beside the name; never conflate the two.
- Gravity: `getTransferStatus(progress, lateral)` → `ready`, `reason`; `cooldownSeconds`; `course.transferAvailable(progress)`; `course.nextTransferDistance(progress)`; `state.lane`. Arrow solid + key tab only when `ready && transferAvailable`.
- Tideline: `course.travelModeAt`, sample height, `ridingCurrent` (1.85×), `flightArcs` — same two slots, TRAVEL vocabulary.
- Time attack: `RaceModes.updateLiveDelta` (4 Hz, dead band), `flashSectorDelta`, `deltaTone`, `formatDeltaSeconds`.
- Course facts: `course.length` (3050 / 2515.982 / 1958.9 / 2173.9 / 2751.6 m), `defaultLapCount`, `checkpointCount`, `mapName`, `mapCode`, `finishName`. `finishDistance = (totalLaps − lap + 1 − lapProgress) × length`.
- Reason strings shown verbatim: `HOLD COURSE Ns`, `CENTRE THE SHIP TO TRANSFER`, `JUNCTION USED · COMMIT TO THIS ROUTE`, `STAY LOWER · ENTRY AHEAD`, `WAIT FOR A ROUTE JUNCTION`.

## 5. TypeScript changes

1. `ui.ts` — priority gate `resolveMessageSlots(frame)`; `flashLap` / `flashRaceEvent` / soundtrack chip defer while an alert is active; missed gate promotes into the alert slot.
2. `ui.ts` — `FieldOrderEntry.gapMs`; signed gap per ladder row.
3. `polarity-runtime.ts` / `tideline-runtime.ts` — stamp `data-transfer="ready|wait"`, `data-device="held|active|empty|perfect"`, `data-deck`; write device strength and remaining seconds to separate nodes; route pickup/power/absorb `flashHazard` calls to the device state line.
4. `input.ts` — `activeDevice: "keyboard" | "gamepad"` + change hook; one prompt map for every `<kbd>`.
5. `meta-ui.ts` — CONTROLS view (`C`, Escape back to origin); INTERFACE rows HUD SCALE / MENU TEXT → `save.updateSettings({ hudScale, menuScale })` + `--hud-scale` / `--menu-scale` on `<body>` (live); `returnTo` for options opened from pause.
6. `save-schema.js` — `settings.hudScale`, `settings.menuScale` ∈ `"s"|"m"|"l"`, default `"m"`; fixtures.
7. `game.ts` / `meta-ui.ts` — QUIT TO PADDOCK from pause (hold-to-confirm): store-then-reload to the stored selection is the safe first implementation.
8. `hud-presentation.js` + `ui.ts` — replace hard-coded `THE CRADLE` with `course.finishName`.
9. Results — `showResult` leads with position (field/sprint) or best lap + `previousBestLapMs` (time attack); `NEW BEST LAP` only when `summary.newBestLap`; add CIRCUIT SELECT.

Physics, AI, geometry, ability timing, save semantics, ghosts and race rules untouched.

## 6. Scale, fonts, assets

- `--hud-scale = user(S .88 / M 1 / L 1.2) × clamp(1, √(viewportHeight/720), 1.35)`; `--menu-scale = user(S .9 / M 1 / L 1.15)`. The 340 px instrument width and 300 px meter multiply it.
- Fonts: download Barlow Condensed OFL woff2 (500, 600, 700, 800, 700i, 800i) into `public/assets/fonts/barlow-condensed/`, add `@font-face` in `style.css`; CSP `style-src 'self'` needs no change. Keep `'Arial Narrow', Inter, sans-serif` fallback and fixed heights on LAUNCH / RESUME / RACE AGAIN.
- Livery tiles: crop `8,8,240,240` of each `totem_decals_1024_*.png` (or `background-position`), no new art. TOTEM render: `public/assets/power-kit/vehicle-preview.png`.
- Captures: replace every backdrop in `backdrops/` with genuine HUD-free 1280×720 captures per circuit (hide the HUD, `?diagnostics=0`, seed 714). Only then measure contrast.

## 7. Local verification

1. `git status`; record uncommitted files.
2. Baseline captures at 1280×720 / 1440×900 / 1920×1080 / 2560×1080: paddock, countdown, lap 2, pause, result; seeds 714; hand-driven Polarity states (transfer ready, cooldown, device pickup/use/expiry), recovery, wrong way, lockout.
3. Repeat after the change; `scripts/visual/frame-diff.py` / `chip-contrast.py`: 4.5:1 for 11–14 px text over Bitterpan salt and Night Shift wet road, 3:1 for the 62/92 px numerals.
4. HUD SCALE L + MENU TEXT L at 1280×720: LAUNCH, RETURN TO PADDOCK, RACE AGAIN reachable without scrolling; lower-left cluster ≤ 497 px wide, never overlapping the standing block.
5. Reduced motion from all three sources: no transitions on alert/banner, no ignite/kick/pulse; device values unchanged.
6. Keyboard: paddock → controls → options → back; `O`/`C` never reach the race loop; pause → options → pause; quit → paddock keeps selections. Gamepad: record which buttons actually confirm/back before mapping prompts.
7. Device clock: `powerSeconds` text, fill and expiry agree on every frame; pause freezes all three.
8. `npm run test:code`; new fixtures for the two settings; separate pre-existing failures from regressions.
9. Per-frame: no layout reads in `GameUi.update`; all new writes are text / `data-*` / `transform`.

10. Focus/keys: Tab to OPTIONS on the paddock and press Enter → the terminal opens, no launch; Tab to a circuit chip and press Enter → that circuit commits (`ChipGroup` confirm), no launch. In the game this means `GameUi`'s window-level Enter handler must ignore events whose target is a focusable control (the `MetaUi` ChipGroup already stops propagation for its own keys).
11. Pause: hold Escape 0.9 s → paddock (proposed binding; implement as hold-to-confirm to avoid an accidental quit from the same key that pauses); Enter → `setResuming()` countdown, then race.

Nothing here claims a playtest, contrast measurement on real frames, performance figure or accessibility audit — none were performed.

## 8. State transitions across pause (this pass)

Two transition defects were fixed in the prototype and specified for the game. The prototype fix is prototype code; the game notes below are read from `gentritr1/futurisma@main` (tree `1d4cbc16`) and **not executed** — nothing in this section was run against the local checkout, and no gameplay capture, test run or playtest backs it.

### 8a. Device state frozen through pause and the resume countdown

**Prototype defect (reproduced, now fixed).** The device clock froze on the pause screen but not during the resume countdown: `resume()` sets `clockStart` in the future by the countdown length, so `(now − clockStart)` was negative and clamped to 0 elapsed — the slot showed the device's *full* duration for the length of the countdown, then snapped back. A device with 1.4 s left read 2.4 s while 3·2·1 was on screen.

**Fix.** `deviceClock()` treats `screen === "pause" || (screen === "hud" && resumeUntil > now)` as frozen and reads the stored elapsed value; only a racing frame advances or stores elapsed. Remaining, fill, expiry and the "Ns LEFT" text all derive from that one value, so they cannot disagree.

*Verified in the prototype* by sampling `deviceClock()` across the transition (Polarity, Surge active): 1.12 s racing → 1.12 s paused → 1.12 s at three points inside the countdown → decreasing again once racing resumed. No jump to full, no reset.

**In the game this must not be re-implemented — it must not be broken.** The authoritative value is already tick-derived and already frozen:

- `polarity-simulation.js:69` — `powerSeconds = max(0, powerUntilTick − tick) / ABILITY_TICK_RATE`; `cooldownSeconds` likewise (`:66`). Both read the simulation tick, not a wall clock.
- `game.ts:716–728` — inside the fixed-step loop, `updateRace` runs only under `phase === "running"` (`:720`) and `updateCoast` only under `phase === "finished"` (`:724`); `"resuming"` reaches `updateResumeCountdown(FIXED_STEP)` (`:719`) and nothing else. `circuitRuntime.step()` is the first statement of `updateRace` (`:890–891`) and `advanceClocks()` of `updateCoast` (`:1223–1224`), so the ability tick cannot advance while paused or resuming.
- `polarity-runtime.ts:102` clamps each step's delta to 0.25 s, so even a mis-fed delta cannot dump a pause's worth of time into the tick.

The exposure is therefore entirely in the new HUD binding:

1. Compute the device fill as `powerSeconds / total` (total per §4) **on every `updateHud`**, from the values read that frame. Never from `performance.now()` sampled at activation, and never as a CSS transition or animation with its own duration — `phaseRunsContinuousPresentation` (`frame-scheduling.js:7`) returns **true** for `"resuming"`, so any self-timed fill keeps running through the countdown, which is exactly the prototype's bug in CSS form.
2. `"paused"` returns `false` from the same function, so no update runs while the pause screen is up; the last written width and text stay on screen, which is the wanted behaviour. Do not add a pause-time HUD refresh that recomputes from anything but the frozen tick.
3. Write width and text in the same `updateHud` pass; do not split them across paths.
4. The countdown is `RESUME_COUNTDOWN_SECONDS = 2.7` (`game.ts:171`). The prototype's 3.0 s and its caption are prototype values — use the game constant, and do not port the prototype's Worker beat, `PRESETS` frames or any of its illustrative times, gaps and charges.

### 8b. Incomplete quit holds cancelled reliably

**Prototype defect (reproduced, now fixed).** The hold was event-latched: only a keyup whose target was the QUIT button (React `onKeyUp`) or a global Escape keyup cancelled it. Focus Quit, hold Enter, Tab away, release — the release landed on another element, nothing cancelled, and the 0.9 s timer completed and quit. A hold also survived into SYSTEM OPTIONS, where it completed off-screen.

**Fix (prototype).** The hold records the input that started it (`"Escape"`, `"Enter"`, `" "`, `"pointer"`) and is cancelled by: a keyup with a matching key anywhere (window listener, capture phase, target ignored), any `pointerup`/`pointercancel` for a pointer hold, `window` blur, `visibilitychange` to hidden, and any route out of pause (RESUME, SYSTEM OPTIONS, quit). Completion additionally requires `screen === "pause"` on the frame that fires, and a hold found pending on a non-pause screen is dropped. A release of a *different* key does not cancel someone else's hold.

*Reviewed, not automated:* the four cancellation paths were exercised by hand in the prototype; scripted verification of this one was abandoned after the harness proved unable to drive the design-tool runtime's logic instance reliably. Re-check by hand: hold Enter on Quit → Tab away → release; hold Escape → open SYSTEM OPTIONS; hold the button with the mouse → Alt-Tab; and one uninterrupted 0.9 s hold, which must still quit.

**In the game, implement it poll-based, not event-latched.** `InputController` already gives the right primitive:

- `input.ts:61–67` — window-level `keydown`/`keyup` plus `blur → clearKeys`; held codes live in one set, so a release or a focus loss is already target-independent. Add `isHeld(code: string): boolean` and expose `actionsSuppressedUntilRelease` (read-only); do not add new DOM listeners for the hold.
- Accumulate the hold where pause-phase input is already polled — **before** the early return at `game.ts:707` (`phaseRunsContinuousPresentation("paused") === false`, so the physics loop never runs while paused and cannot host the timer). Clamp the accumulated delta (`min(delta, 0.1)`) so an rAF stall cannot complete a hold in one frame.
- Per frame, require all of: `phase === "paused"`, the pause panel is the active surface (`MetaUi` terminal **not** open — this is the "completes after opening Options" case), a hold source recorded, and that source still held (`input.isHeld("Escape")`, gamepad `buttons[1].pressed`, or the pointer still down). If any is false, reset elapsed to 0 and clear the source. Never accumulate from a stored timestamp.
- Also reset when `actionsSuppressedUntilRelease` is set — `handleWindowBlur` (`game.ts:2269`, `:2336`) calls `suspendActionsUntilRelease()` (`input.ts:158–168`), which is the case where the OS may never deliver the keyup.
- Escape both pauses and quits: ignore the Escape that caused the pause. Require one observed release of Escape after entering `"paused"` before a hold may arm — the same shape as `action-gate.js`'s suppress-until-release.
- Pointer path: `pointerdown` on the button sets the source and calls `setPointerCapture`; cancel on `pointerup`, `pointercancel` and `lostpointercapture`. With the per-frame predicate this is belt-and-braces, which is the point.
- Fire the quit once behind a latch, then the §5.7 teardown (store-then-reload to the stored selection). Confirm only while the initiating input is still held and the pause screen is still active.

### 8c. Still unverified after this pass

Unchanged from §7 and still owed on the local checkout: `git status` and preservation of uncommitted work, `npm run test:code` (plus new cases for 8a's frozen-through-countdown invariant and 8b's four cancellation paths), gameplay captures at 1280×720 and 1920×1080 across the pause → countdown → racing transition with a device active, keyboard-only traversal of pause → options → pause → quit, HUD SCALE L + MENU TEXT L, reduced motion from all three sources, and the real time-attack delta / ghost / ability timing check. Everything in §8 above is a reading of the source, not a run of it.
