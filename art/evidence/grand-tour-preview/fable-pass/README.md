# Grand Tour — Fable-guided refinement

VERIFIED: Claude authentication succeeded and the primary reviewer was `claude-fable-5-1`, recorded in the CLI initialization and model usage. Both reviews were restricted to reading local evidence and preview code. Fable inspected actual PNGs; it did not drive the game. Its [initial critique](../fable-review.md) identified lost finish recognition and an unreachable championship target. Its [follow-up](fable-followup.md) says both are resolved. The CLI also records a small Haiku helper request; the design responses are attributed to Fable, not that helper.

## Files added / changed

- `experiments/grand-tour/cup.js`: enumerate legal remaining classifications to identify the best reachable cup position; name the relevant rival; recognize a final-round win even when the cup is lost; format measured best laps.
- `experiments/grand-tour/tour.js`: retain the real finish screen until Continue, reject duplicate finishes while held, restore keyboard focus, promote the next circuit's name and show recorded best laps.
- `experiments/grand-tour/race-entry.js`: preview-only guard against restarting an already consumed finish through the existing start gate; hide the old result navigation controls. The source game and its controller are unchanged.
- `experiments/grand-tour/index.html` and `tour.css`: finish toolbar, map heading, monospace ledger, responsive layout and explicit persistence copy.
- `scripts/visual/grand-tour-fable-review.mjs`: scoring, recorded-message flow and fresh live finish verification. The two existing Grand Tour capture/integration scripts now explicitly continue past a held finish.
- This evidence directory and the parent report; no commit.

The existing tracked `neon-environment.ts` correction is preserved from the previous pass. `game.ts` remains unchanged at 2,577 lines. No physics, controller, route, pace, schedule or pickup change.

## Numbers this pass measured for the first time

VERIFIED by `node scripts/visual/grand-tour-fable-review.mjs`, recorded in [review.json](review.json):

| Instrument observation | Result |
|---|---:|
| Best reachable position after the recorded Greenwater finish | P1 |
| Best reachable position after the recorded Night Shift finish | P2 |
| Gap to NIGHTFORM 24 in that second-round classification | 1 point |
| Fresh Night Shift player classification | P4 |
| Fresh Night Shift best lap, diagnostics rounded ms | 30,408 |
| Fresh Night Shift missed gates / recoveries | 0 / 0 |
| Browser page errors in refinement harness | 0 |

Reachability is a calculation over legal finishes using the authored 4/3/2/1 scoring rule and final-round tie break; it is not a prediction of driving pace. The fresh race repeated previously observed timing, so it is not a newly calibrated lap target.

VERIFIED after the final footer edit: Chrome's `document.documentElement.scrollWidth - innerWidth` returned 0 px at 320, 390, 768 and 1280 px viewport widths. The one-off browser check used `scripts/visual/tideline-v4/browser.mjs`, asserted the exact persistence copy, and saved [final-copy-check.json](final-copy-check.json) and [final-copy-mobile.png](final-copy-mobile.png). Existing colour tokens were preserved; no new tint or light-level calibration is claimed.

## Budget before / after

VERIFIED by fresh `npm run build` and `node scripts/validate-build.mjs --out=art/evidence/grand-tour-preview/fable-pass/build`; see [build.json](build/build.json). The later footer-only edit is in the excluded development entry.

| Production measurement | Before | After | Existing ceiling |
|---|---:|---:|---:|
| Shell gzip | 283,639 B | 283,639 B | 283,648 B |
| Initial JS gzip | 271,472 B | 271,472 B | 272,384 B |
| Dream Island audio | 225,912 B | 225,912 B | 248,504 B |

This remains an unshipped development preview. No new scene budget certification: the previously reported Polarity combined draw count of 149 against 145 remains open in the earlier map-polish evidence.

## Registration / assets / rendered-pixel checks

No new registration, atlas consumer, geometry, audio source, generated media or Blender output. The existing game renders the race through its existing graph and materials. Atlas-cell proof is not applicable to the menu changes. Desktop, mobile and held-finish screenshots were inspected. The final mobile footer is readable and fits; no new game HUD contrast claim.

## Validators and race evidence

VERIFIED: build and budget validator PASS; `git diff --check` PASS. The refinement harness passes reachable/unreachable title, locked P4, final tie, lap rollover, duplicate-finish handling, keyboard continuation and separation of sample results. The existing full `test:code` suite was not rerun for this isolated preview; its previous production pass remains in the map-polish report.

| Run | Laps | Missed gates | Recoveries | Reconciled p95 |
|---|---:|---:|---:|---|
| Fresh Night Shift, normal Works autopilot | 3 | 0 | 0 | Not measured by this instrument |

Only the opening Greenwater classification was seeded from the previous recorded cup before the fresh Night Shift run. The retained Night Shift result and subsequent cup transition were live. The other three-round captures replay recorded classifications; they are not additional races. A whole fresh cup was not rerun this pass. Raw diagnostics include a percentile, but sample reconciliation was not performed, so no performance-soak claim is made. The corridor sweep did not run; its zero counters are not collision proof.

## Review decision, discrepancies and open gaps

Fable's follow-up identified contradictory persistence wording as its one fix before human testing. The footer now states: “Cup points reset on reload. Lap records stay in this preview.” Chrome verified this final edit. Lap records belong to the preview origin on port 5201; championship progress remains memory-only.

Deferred suggestions: collapse the race toolbar, simplify repeated route copy, clarify defending an already held position, and consider a day/night image pair. These are further presentation choices, not demonstrated gameplay defects. Dream Island's daylight capture is genuine; its unchanged schedule still transitions into night. No asset generation was needed.

UNVERIFIED: human enjoyment, recognition timing and gamepad interaction with the parent Continue button. The existing gamepad restart gate was checked, but a physical controller was not tested. The preview requires keyboard or pointer to continue between rounds. Livery labels remain the temporary roster identity; cup persistence and stable racer IDs remain outside this prototype.

Human playtest question from Fable: after round two, before starting the next race, ask “What is the best you can still finish in this cup, and who decides it?” Then observe whether the player wants to race for that position. The critique is design advice, not a substitute for this test. Dream Island E4 remains closed by ruling; no controller extension or new map work was started.
