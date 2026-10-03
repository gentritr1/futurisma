# Fable 5.1 — refinement review

**Verdict: both main issues are resolved in the implementation, with one comprehension gap left at the handoff.**

**Issue 1, hold the finish.** Validated by the screenshots and code, not by driving. The held Night Shift capture shows the game's own result card, with lap count, best lap and the four-row order, under a toolbar reading finish, points and next circuit. In `experiments/grand-tour/tour.js:83` the frame goes inert and the leave control is swapped for Continue. The start-gate wrapper in `race-entry.js:21` is a clean guard. The itinerary now shows best laps. This is done.

**Issue 2, name the reachable target.** The enumeration in `cup.js:40` is correct for the 4/3/2/1 scheme and the final-round tie breaker, and the after-finish capture matches my hand calculation: P1 gone, P2 one point away, NIGHTFORM 24 named. "Final round won" appears on the lost cup. Done.

**Remaining concerns, in priority order.**

- **Contradictory persistence copy.** The held screen says "NEW BEST LAP · ENTERED ON FILE" while the menu footer says "Preview progress lasts for this visit." The game writes its own records regardless of the preview. A tester will not know which claim is true. Either suppress the game line in preview or change the footer to say cup points are session-only but lap records are real. This is the one thing I would fix before the human test.
- **Points without a scale.** The toolbar reads "+1 PTS" but the scoring table lives only on the menu. On first finish nobody has seen it. Consider "+1 PTS OF 4" or nothing until the menu.
- **Duplicated deck copy.** The route sentence appears twice in the stage, once under the title and again beside the button. The render function feeds the same string to both slots.
- **Defending a position reads oddly.** When the player already holds the best reachable place, the target becomes the driver below and the detail says "P2 is possible", which sounds like something to gain rather than keep.
- **Dream Island still shows a noon capture** while the route line now says day/night. The copy fix is honest; the image remains a mismatch until a night capture exists.
- **Ledger idiom.** Mono font is in. The tick bar and delta column from the in-race standings are not. Fine to leave.

**Hypotheses from my first review, status.** The unreachable-lead demotivation hypothesis is now addressed in copy but untested with people. The recognition-beat hypothesis is addressed structurally. The toolbar-as-chrome hypothesis is deferred, as you said. None are validated.

**Playtest question.** After round two, once the tester is back on the cup menu and before they press Race, ask: "What is the best you can still finish in this cup, and who decides it?" A correct answer without looking back at the ledger confirms the verdict line carries the target on its own.
