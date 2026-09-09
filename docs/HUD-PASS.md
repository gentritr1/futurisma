# HUD pass — what was built, and what was actually verified

Branch `work/hud-redesign`, worktree `/private/tmp/hud-redesign`, from `8ad5931`.

Deliberately a separate worktree: `polarity_work` had in-flight Ascension phase-E
work uncommitted at the time (modified `scripts/visual/ascension/*`, untracked
`art/evidence/ascension-v1/phase-e/`), and this pass touches shared files. None
of that work was read, moved, staged or reverted.

## The rule this pass followed

The approved package is the visual reference. It is **not** the implementation:
its device clock, Worker beat, simulated race values and illustrative records
are prototype scaffolding and none of them shipped. Every value on screen still
comes from `HudFrame` and the simulation's own tick, and every node was
**re-parented** rather than recreated, so the ids `GameUi`, `polarity-runtime`,
`tideline-runtime` and `ascension-powers` resolve by `getElementById` all still
resolve to the same elements with the same meanings.

## What shipped

**Layout.** Nine blocks — standing, timing, gate, cue, the shared alert/banner
slot, drive, device, gravity, minimap — each anchored to an edge and scaled as
one unit from its own anchor corner. The `-10deg` plate with counter-skewed
content, the 8px chamfer, the acid dashed reserve band and the diagonal hazard
stripe for lockout all come from the reference.

**Type.** Barlow Condensed, latin subset, six faces, self-hosted under
`public/assets/fonts/barlow-condensed/` with its OFL licence. `style-src 'self'`
needed no change and the game still works offline. Every Barlow rule carries the
`'Arial Narrow'` fallback step; the prototype gave it to only five numerals,
which would have let a font failure reflow everything else.

**Interface scale.** `HUD SCALE` and `MENU TEXT` are stored settings with S/M/L
rows in the service terminal, applied live as two CSS custom properties on
`<body>`. `--hud-scale` carries a viewport term, `sqrt(height/720)` clamped to
`[1, 1.35]`, so 1080p is not a 720p HUD stretched.

**Save.** Schema v5. Purely additive: `settings.hudScale` and
`settings.menuScale`, both defaulting to `"m"`, the size the game already
shipped at. The migration rung is an identity for the same reason v3 → v4 was —
a file written before this build has neither key and `normalizeSettings`
supplies the default. **Wipe risk: none.** Nothing is relocated, renamed or
dropped. `validate:persistence` walks v1 → v5 field by field, and its fixture
deliberately stores `"l"`/`"s"` rather than the defaults, so a normalizer that
dropped the fields could not pass.

**Ladder.** Each row carries a signed gap against the player, computed from the
same distance-over-speed model as the gap line above it. Two models would
eventually disagree on screen and the driver would have no way to tell which was
lying.

**Ability slots.** The 56px glyph slots derive their state by *reading* the nodes
the three circuit runtimes already write — the device line, the deck line, the
action line and the charge fill's own `scaleX`. No circuit runtime was touched,
which is what let this land beside in-flight Ascension work. The parsers are
pure and live in `ability-text.js` so `validate:hud` can assert them against the
real phrases each runtime emits, including Ascension's deckless `PAD 09 / LAUNCH
DAY`.

**Pause panel.** RESUME, SYSTEM OPTIONS, and QUIT TO PADDOCK behind a 0.9s hold.
Quitting is store-then-reload; the paddock reads its selections back out of the
save, so the driver lands on the launch screen with their circuit, format, field
and livery intact.

## The quit hold

Polled, not event-latched, and accumulated **before** the paused early return in
`update()` — `phaseRunsContinuousPresentation("paused")` is false, so the physics
loop cannot host it. Being polled is the point: it is re-tested from the inputs
that are true this frame and dies the moment one stops being true, which covers
the releases an event-latched hold never receives.

Two sources, kept apart:

- **Escape** is global. It belongs to no control, so it needs no focus test, but
  it must be *armed* by a release first or the press that paused the race would
  also quit it.
- **The button** (Enter, Space or a pointer press on QUIT) additionally requires
  the button to still be focused, re-tested on **every frame including the one
  that completes**. This is the case that motivated the pass: focus Quit, hold
  Enter, Tab away, keep holding. The keyup lands on whatever Tab moved to, the
  button's own handler never fires, and an event-latched hold would complete
  off-screen. Here it dies twice over — `blur`/`focusout` drop the source, and
  the per-frame predicate would refuse it even if they had not.

A frame may contribute at most 0.1s, so a stalled tab cannot satisfy a hold in
one step.

## One bug found and fixed on the way

Window-level Enter reached the race even when a control had focus, so pressing
Enter on RESUME both clicked the button and toggled the pause, and the two
cancelled out — the race never resumed. Enter, NumpadEnter and Space now belong
to a focused control; the canvas is exempt, so the race keeps its shortcuts
while the player is driving. Escape is deliberately **not** in that set.

## Verified — executed and observed

| Claim | How |
| --- | --- |
| Typecheck | `npx tsc --noEmit` clean |
| Quit-hold logic, ability parsers, scale math | `npm run validate:hud` — 30+ assertions incl. the Tab-away case and the completing frame |
| Save round trip and v1 → v5 migration | `npm run validate:persistence` |
| No unsafe sinks, no remote URLs | `npm run validate:security` (160 files) |
| Race loop did not grow | `npm run validate:seams` — `game.ts` 2575/2577, **smaller than it started** |
| Physics, race, rivals, control, minimap, presentation, race-modes, package boundary | their validators, all pass |
| Pause → countdown → resume, live | `scripts/visual/hud/pause-quit.mjs`, real keyboard against a running race |
| Four quit cancellations, live | same script; each holds ~1.6s, longer than the 0.9s confirm, and the race stays paused |
| The hold that must work | same script; navigation counter confirms the reload, phase lands on `intro` |
| HUD at 1280×720 and 1920×1080, M and L, five states | `scripts/visual/hud/capture-hud.mjs`, 20 real races, 0 errors |

### The 20 captures, measured

Every frame is a real race with the clock already running — the capture waits
for `#time-value` to have advanced, not for a timeout, because on the heavier
circuits `phase === "race"` is set while the environment is still streaming and
an earlier version of this script caught Tideline on the GO card.

| Viewport | HUD SCALE | `--hud-scale` | Cluster width | Clear of standing block |
| --- | --- | ---: | ---: | ---: |
| 1280×720 | M | 1.0000 | 414 px | 128–292 px |
| 1280×720 | L | 1.2000 | **496.8 px** | 19–216 px |
| 1920×1080 | M | 1.2247 | 507.03 px | 366–566 px |
| 1920×1080 | L | 1.4697 | 608.46 px | 233–473 px |

414 → 496.8 px at L is the reference's own acceptance number (≤ 497) reached
exactly, which is the check that anchor-corner scaling reproduces the intended
geometry rather than approximating it.

**The margin worth watching:** 19.3 px. That is Tideline at 1280×720, HUD SCALE
L — the circuit with two ability rows, which makes the drive cluster its
tallest. It clears the standing block, so the acceptance holds, but it is the
tightest configuration the game can currently produce and a third ability row
would break it.

Ladder rows 4/4 and lap pips correct (5 on Greenwater's five laps, 3 on
Polarity and Tideline's three) in all 20. Barlow Condensed reported loaded in
all 20. Speeds 207–329 km/h, i.e. every frame is a moving race.

The captures set HUD SCALE **through the terminal**, not by writing the save
file. The first run of that script wrote a fixture with no `schemaVersion`,
`parseSave` correctly refused it, and every "L" capture was silently an "M" —
recorded here because it is exactly the shape of a test that reports a pass it
did not earn.

## Not verified

- **No human has looked at this at full size and said it feels right.** Every
  frame here is mine or a script's.
- **Gamepad.** `isGamepadCancelHeld` reads button 1 for the pad's quit hold; no
  pad was connected, so that path is written and typechecked but unobserved.
- **Contrast measurement** against real frames per circuit. The reference asks
  for 4.5:1 on small text and 3:1 on the big numerals; not measured.
- **Performance.** No before/after frame-time or draw-call comparison was taken.
  The HUD is DOM, not a render pass, and per-frame writes are text, `data-*` and
  transforms only, but that is an argument, not a measurement.
- **Touch and mobile.** Still not claimed, as before this pass.
- **`npm run test:code`** in full was not run end to end here; the validators
  listed above were run individually.

## Deliberate departures from the reference

1. **Scaling** is `transform: scale()` from each block's anchor corner rather
   than the prototype's whole-subtree `zoom` or the handoff's per-property
   `calc()`. `zoom` on a full-bleed HUD root grows the root past the viewport and
   carries the right-hand blocks off screen. Anchor-corner scaling gives the
   reference's own acceptance number exactly: 414px → 496.8px at L.
2. **The nav arrow** stays a glyph the game writes, not a CSS triangle, because
   the cue carries a *second* arrow for the following turn — information the
   reference did not have and a border-triangle cannot express.
3. **Meter fills** stay `transform: scaleX()`, which is what `GameUi` already
   writes and what keeps them off the layout path. The reference used `width`.
4. **The soundtrack chip** sits in the header rather than the drive cluster. The
   cluster is for things acting on the lap; a track title is not one.
5. **The device slot's charge** is read back from `#power-charge-fill`'s own
   transform rather than having the runtimes publish a new value, so no circuit
   file changed.

## Known gaps against the full handoff

Not attempted in this pass, and none of it is blocked by what is here: the
CONTROLS view and its `C` binding, `activeDevice` keyboard/gamepad prompt
swapping, the results-screen changes (`showResult` leading with position or best
lap, CIRCUIT SELECT), `data-transfer`/`data-device` stamping from inside the
circuit runtimes, and genuine HUD-free per-circuit backdrop captures.
