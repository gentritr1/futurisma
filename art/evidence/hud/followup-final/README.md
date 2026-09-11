# HUD follow-up review evidence

Work is on `work/ascension-pad`, from `2862475`. No HUD restyle or visual variant. No changes to physics, AI, geometry, ability timing, or save semantics. Shield art and all withheld Ascension review keys remain untouched. No merge to main.

## Executed-and-observed

- `9102665`: the three circuit runtimes publish device, deck and transfer attributes (plus device kind and charge). `ability-slots.ts` reads these attributes; production `ability-text.js` is deleted. `scripts/validate-hud.mjs` tests attribute state rather than display phrases.
- `b269b6a`: input tracks keyboard/gamepad and all `<kbd>` nodes use one prompt map. `scripts/visual/hud/gamepad-prompts.mjs --probe-only=true` first observed standard button 0 confirming the focused Options button and button 1 returning. The final mapped run is [gamepad/gamepad.json](gamepad/gamepad.json): connection, keyboard activity while connected, and disconnection exercise the real menu route. All 11 prompt nodes switch and restore; visible prompts are also checked in paddock and options.
- `7371a5f`: C opens Controls. `scripts/visual/hud/menu-paths.mjs` observes paddock → controls → options → controls → paddock, race O/C ignored, and pause → options → pause. The paused race clock is unchanged. [Eight path observations](menus/paths.json). `validate:hud` dispatches O/C to the production input controller and asserts no held key, movement or race action.
- The fourth commit changes result presentation: field and sprint lead with position; time attack leads with best lap and shows `previousBestLapMs`; the badge consumes only strict `summary.newBestLap === true`. CIRCUIT SELECT returns to the paddock. `scripts/visual/hud/result-finishes.mjs` drove four actual finishes without injecting race state: field **P2 / 4**, sprint **P1 / 4**, and two time attacks (the first supplies a genuine previous record). All three format routes returned through Circuit Select. [Finish records](../followup-4-results/finishes.json), [field](../followup-4-results/race.png), [sprint](../followup-4-results/sprint.png), [time attack](../followup-4-results/timeattack.png).
- Time attack's second run has `previousBestLapMs = 27625`, `newBestLap = false`, and the badge hidden. `validate:hud` also rejects badge display for false and missing flags in every format, and for a null summary.
- Full `npm run test:code`: **exit code 0**, recorded in [test-code-exit.txt](test-code-exit.txt); full output [test-code.txt](test-code.txt). This includes `validate:hud`, runtime validation and build validation.
- The first full build exceeded the existing raw initial-JS cap: **970.9 KiB / 969 KiB**. [Failed output preserved](test-code-before-menu-split.txt). Controls/options navigation now loads on its first request. Final `scripts/validate-build.mjs` reports **968.9 KiB raw / 264.4 KiB gzip initial JS** and **276.3 KiB gzip shell**, below unchanged **969 / 266 / 277 KiB** caps. This is a bundle measurement, not a frame-time claim.
- `scripts/visual/hud/pause-quit.mjs` ran solo after the final production edit: **9 observations, 0 failures**, including pause/countdown/resume, cancelled holds, and completed quit. [Records](pause/pause-quit.json).

## HUD capture comparison and reconciliation

The final capture and pause scripts run serially, each with its own headless browser on the dev server at 127.0.0.1:5200. No shared Browser pane or concurrent capture run. Report scripts accept **`--flag=value` only**.

`capture-merged.json` has 24 named captures but does **not** record slot states. Therefore historical slot equality cannot be directly established from that JSON. The capture script compares recorded layout fields directly against it, and compares current slot state to the exact `2862475` parser applied to the same live labels at each new frame. The old parser exists only as a test oracle read from Git; the application does not import it.

`capture-hud.mjs` checks device state, deck, transfer readiness, device identity and rendered fill against that oracle. `report-followup.mjs` performs the final reconciliation and fails for any mismatch. [Reconciliation](reconciliation.json), [capture records](captures/capture.json).

Expected discrete scenario counts: **24 = 2 viewports × 2 scales × 6 cases**; **12 device cases = 3 circuits × 4 viewport/scale pairs**; **8 menu observations**; **9 pause observations**; **33 prompt-node states = 11 nodes × 3 device states**; **4 real finishes = 3 formats + 1 previous-record setup**. These are discrete observations, not a fixed-rate sampling window. No FPS or p95 comparison is made; unrelated diagnostics embedded in finish records are not performance acceptance claims. Observed counts are **24 / 12 / 8 / 9 / 33 / 4**, respectively: every residual is **0**. Layout differences, slot differences, capture errors and scenario errors are all empty. The reconciliation script completed with exit **0**.

Reproduction (from `polarity_work`; dev server already on 5200):

```sh
export PATH=$HOME/.nvm/versions/node/v20.19.4/bin:$PATH
npm run test:code
export PATH=$HOME/.nvm/versions/node/v20.19.4/bin:$PATH
node scripts/visual/hud/menu-paths.mjs --port=5200 --out=art/evidence/hud/followup-final/menus
export PATH=$HOME/.nvm/versions/node/v20.19.4/bin:$PATH
node scripts/visual/hud/gamepad-prompts.mjs --port=5200 --out=art/evidence/hud/followup-final/gamepad
export PATH=$HOME/.nvm/versions/node/v20.19.4/bin:$PATH
node scripts/visual/hud/pause-quit.mjs --port=5200 --out=art/evidence/hud/followup-final/pause
export PATH=$HOME/.nvm/versions/node/v20.19.4/bin:$PATH
node scripts/visual/hud/capture-hud.mjs --port=5200 --out=art/evidence/hud/followup-final/captures
export PATH=$HOME/.nvm/versions/node/v20.19.4/bin:$PATH
node scripts/visual/hud/result-finishes.mjs --port=5200 --out=art/evidence/hud/followup-4-results
export PATH=$HOME/.nvm/versions/node/v20.19.4/bin:$PATH
node scripts/visual/hud/report-followup.mjs --out=art/evidence/hud/followup-final
```

## Inferred and open limits

- Slot parity covers the captured states and the validator cases. It cannot prove equality with unrecorded historical slot values, nor every possible frame of every race.
- Standard gamepad behavior is executed with a synthetic Gamepad API device. Physical controller hardware and nonstandard mappings are untested.
- Existing presentation precision differs: `formatRaceTime` floors floating milliseconds, while persistence rounds lap records. The second time-attack image consequently shows current **00:27.624** and previous **00:27.625** despite an equal rounded record and correctly absent badge. No formatter or save logic was changed. The values come from `result-finishes.mjs`; the explanation follows inspection of the existing formatter and persistence code.
- Real result finishes preceded the final asynchronous menu-load guard; their result rendering code is unchanged. The full suite and final keyboard/gamepad/pause captures exercise the final production code.
- Whole-level Ascension acceptance and unrelated earlier art/provenance gaps are outside this HUD follow-up and remain as previously recorded.
