Critique complete. I read the brief, the evidence README, all eight screenshots, the provenance file, and the four experiment source files. I did not drive the game or open the local server, and the automated results are integration evidence only.

## Observations

**Reason to continue after a loss.** The cup adds no decision inside a race. Points follow finish position only, rounds run in a fixed order, and there is no tier, livery or risk choice. What it adds is a changed target: after a bad round the race is about a specific rival, not the win. The interface does not say this. In the real run the ledger after Night Shift reads "4 points to the lead", but the lead was already unreachable:

| Driver | Points after round 2 | Best final outcome |
|---|---:|---:|
| PRIVATEER 13 | 8 | 9 (last place) |
| TOTEM | 4 | 8 (win) |

The tie rule cannot help either. Yet the stage note for the final says "Settle the classification", and the finished-cup verdict says "Cup finish: P2." without acknowledging that the player won that round. The live fight, P2 against NIGHTFORM 24 by one point, is the real reason to race and the copy never names it. The verdict logic in `experiments/grand-tour/tour.js:26` only computes the gap to first.

**Identity.** The captures carry the identity. The interface mostly does not.
- The stage scrim darkens the bottom half to near black, so on Dream Island the sky and tower survive while the causeway and kerbs, which the brief calls the machinery, sink into the gradient.
- The Dream Island stage and itinerary thumbnails are a noon capture, while the note and footer both say "Island nightfall".
- The ledger is Inter, hairlines, sixteen pixel rows, right-aligned tabular figures. That is a clean sports app table. The game already has its own ledger idiom, visible in the in-game capture: monospace rows, a tick bar at the player row, and a delta column. None of it reappears in the menu. No skew, plate or hazard-stripe language from the HUD carries over. The acid button and cyan accent do.
- The best line on the page, "HUMID CONCRETE → CITY AFTER DARK → ISLAND NIGHTFALL", is nine pixel footer text. "THE COASTAL CIRCUIT" is unexplained. "A clean slate." appears twice and is generic.
- The same cropped cockpit rings sit under the headline in every state, which reads as a template rather than a place.

**Finish to next circuit.** The parent closes the frame the moment the classification arrives. The game's result screen is invoked and destroyed in the same tick, so lap times, best lap and the finishing order in the race's own world are never seen. Elapsed, best lap and lap times are received by the adapter and never rendered. On return, the only stage elements that change are an eleven pixel round label and the button text. The "GRAND TOUR" headline is the largest element in all six states. The round result itself is muted thirteen pixel text beneath a headline about the cup gap.

**Toolbar.** It is forty-two pixels of a seven-hundred-twenty pixel viewport. The HUD reflows without letterbox bars, so the loss is height, not aspect. The toolbar heading duplicates the game's own strip name directly beneath it, and "LEAVE ROUND" sits in the corner where position-change notices appear. The brief lists HUD chrome that competes with the racing line as an anti-reference.

## Hypotheses

- Players who lose round one will read "N points to the lead" as the only goal, and once it is unreachable the final will feel like a formality even when a podium place is still live.
- Without a held result screen, testers will not have a recognition beat for their own finish before being told the cup state.
- The toolbar is orientation for the first seconds and chrome for the rest of the race.

## Three changes for the next iteration

1. **Hold the finish.** Keep the frame alive at the game's existing result screen, with the frame inert, until the player presses continue. Turn the toolbar into the handoff line with round finish, points, and next circuit. Show best lap under each finished round in the itinerary from data already received. Playtest question: after the first race, can the tester state their finishing position and their next circuit unprompted?
2. **Name the reachable target.** Compute the best reachable cup position given rounds remaining and write the verdict around it, for example "P1 is gone. P2 is one point away. Beat NIGHTFORM 24." Drop "Settle the classification" when it is false, and acknowledge a round win at cup end. Reuse the in-race standings idiom for the ledger and promote the footer route line above the itinerary. Fix the nightfall copy or use a nightfall capture only if one exists. Playtest question: after losing round two, does the tester name a specific rival they intend to beat, and does self-reported motivation for the final differ between the current copy and this copy?
3. **Collapse the toolbar after start.** Show it through loading and countdown, then collapse it to a top-edge reveal on pointer or focus, with no animation under reduced motion and keyboard access to leave retained. Playtest question: does any tester look for the leave control mid-race, and do testers notice the extra game height?

Cut first: the "points to the lead" verdict when the lead is unreachable, and the duplicate toolbar heading. All three changes are copy, CSS and experiment script only. None touch the frozen controller, physics, routes, schedule, materials or the production shell.
