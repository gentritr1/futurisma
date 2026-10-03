# Fable 5.1 review request — Grand Tour preview

Please critique the concrete FUTURISMA Grand Tour preview. This is a read-only design consultation: do not edit files, change runtime settings, or generate assets. Use the exact requested model `claude-fable-5-1`; successful model usage must be verified by the caller. This request has been prepared but has not yet been sent.

Read `PRODUCT.md` and `art/evidence/grand-tour-preview/README.md` first. Inspect these actual screenshots: `cup-desktop.png`, `cup-mobile.png`, `sample-result.png`, `sample-complete.png`, `in-game.png`, and the three `*-cup-result-settled.png` files (presentation replays of the recorded real classifications, as documented in `capture-provenance.json`) in the same evidence folder. Distinguish the explicitly labelled sample standings from the automated real-race results. Inspect `experiments/grand-tour/` if needed to understand interactions.

The preview is available locally at `http://127.0.0.1:5201/experiments/grand-tour/` while its development server is running. It offers a sample-results walkthrough and human-driven races on Greenwater, Night Shift and Dream Island. It carries the existing structured classifications forward. The preview's cup progress lasts for the page visit. It is excluded from the production build.

Assess these questions:

- Does the cup establish a clear reason to continue after losing the first race? Identify the actual player decision it adds and any promise its interface fails to support.
- Does the scenic menu, standings ledger and itinerary belong to FUTURISMA's repaired industrial / humid organic identity? Point to specific pixels, hierarchy or copy; avoid generic calls for polish or more effects.
- Does the transition from a finish to the next circuit provide enough recognition and anticipation? Would retaining the ordinary result screen briefly improve understanding? Explain the tradeoff.
- Is the persistent race toolbar useful orientation or distracting chrome? Evaluate its effect on the available game view.
- What should be cut or changed first? Limit proposals to a small, coherent next iteration, with a concrete human playtest question for each change.

The controller and physics are frozen, `game.ts` remains at its seam ceiling, and no route, pace, power, schedule or handling change is authorised. Dream Island's causeway and fog targets remain closed by ruling for human playtesting. The production shell has almost no remaining budget. Do not prescribe brighter materials, new thresholds, more geometry, hitstop, camera shake or arbitrary glow values without appropriate measurements and scope.

The screenshots and automated race sequence demonstrate presentation and integration. They do not establish that human driving feels good or that the cup is fun. Separate observations from hypotheses. We will use your critique as design input and test the chosen changes with people and the existing instruments.
