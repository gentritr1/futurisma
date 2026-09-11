# Blastworks — Map 06 concept phase

## Context (you have no access to the conversation that produced this)

Repo: `/Users/gentlegen/Desktop/futurisma-race/polarity_work`, branch from `work/tideline-tide` after the v4 polish lands (or from its current tip if instructed). Same environment rules as the Tideline v4 brief: Node 20 PATH, your own headless browser, port 5200 for the dev server.

FUTURISMA now has water (Tideline), night city (Night Shift), gravity decks (Polarity) and two daylight industrial maps (Greenwater, Bitterpan). The next map must be dry, bright and loud, with one new mechanic that reuses the deterministic scheduling built for the tide (`tideline-tide.js`, 120 Hz ability clock, published schedule, seeded, pause-safe) and gives the unused drift system (`src/game/drift-charge.ts`) a reason to exist.

## Concept

**Blastworks**: an open-pit quarry cut into ochre rock at dawn. Haul roads spiral the pit, conveyor bridges cross it, a crusher plant and stockpiles on the rim, white floodlights on masts still on, dust in the low sun. Palette: ochre and umber rock, white floodlight, rust machinery, pale dust haze. Same six material roles, same painted-atlas method, same fog-for-depth rule.

**Mechanic: the blast schedule.** Countdown boards along the route show the next blast (time and sector). Each blast changes the map on a published, seeded schedule:
- a rock face drops and opens a pass (shortcut) for the rest of the race;
- a slide closes one lane of a straight for one lap, then loaders clear it;
- debris litters a section, lowering grip until cleared;
- the shockwave itself is a timed event: a visible dust wall, camera shake (reduced-motion safe), a grip dip for 1 s on the affected sector.

The decision: beat the countdown through the pass at risk of the blast, or take the long haul road. Surfaces are gravel and packed dust: drift is the fast way through hairpins, and drift-charge feeds nitro.

## Route brief

Closed loop 2,300–2,700 m, 7–9 ordered gates, three laps. Sections: rim road (fast, wide, floodlit), spiral descent (banked hairpins, gravel), pit floor (crusher, conveyors overhead, the blast sectors), conveyor bridge climb (narrow, exposed), stockpile chicane back to the rim. Width 22–26 m, narrowing to 18 on the bridge. Roll allowed on the spiral. Two forks: the blast pass (opens after blast 2) and a service ramp (always open, slower by 4–6 s measured).

## Ambience

Sirens before each blast, the thud and pressure wave, dust rolling down the road, floodlights flickering when the shockwave passes, reversing-truck beepers, conveyors running, rock falls echoing. Pit radio lines for the countdown. Music: the existing jungle mixes, the drop aligned to blast 1 if the bar quantiser allows.

## Deliverables for this phase (concept and blockout, not final art)

1. `docs/visual-polish/BLASTWORKS.md`: concept, schedule table, route table, mechanics contract.
2. Route: `scripts/build-blastworks-route.mjs` → `src/game/data/blastworks/route.json`, `blastworks-course.ts` implementing `RaceCourse`, forks projected the way Tideline's pump hall is.
3. Schedule: `blastworks-blast.js` owning the seeded schedule; snapshot/restore compatible with the ability protocol.
4. Blockout: `art/blender/build_blastworks.py` → blockout GLB with flat material-ID colours only, plus `lights.json` for floodlights.
5. Reference triplets (orthographic, hero, material-ID) for two focal assets: the crusher plant and a blast countdown board. No modelling yet.
6. Validators: `validate:blastworks` (continuity, gates, recovery, both forks, deterministic rival pace at 60/120/240 Hz) and `validate:blastworks-runtime` (schedule, monotonic events, grip windows, pause/reset).
7. A three-lap demo race at a fixed seed with a lap-time table for the fork choices.

## Acceptance

- Route continuity and projection checks pass; every fork rejoin has no gate bypass.
- Fork timing measured, not guessed: the pass saves between 3 and 8 s over the haul road on the demo controller; the service ramp costs 4–6 s. Report the script and the numbers.
- Schedule readability: the countdown board is legible in a frame 150 m out at 300 km/h in the blockout.
- Rookie/works/feral tiers finish in different positions on the demo across three seeds, so the mechanic separates skill tiers.
- Budgets within `PERFORMANCE_BASELINE.md` on the blockout with 2x headroom for art.
- Reduced motion: no camera shake, dust wall still visible.

## Non-goals

No painted art, no final props, no audio files, no multiplayer. No changes to other maps. Stop and report if the blast mechanic conflicts with the no-route-obstruction principle in a way the schedule cannot resolve.

## Art starting kit (added 2026-09-05)

`art/references/blastworks/` already contains three FLUX.2 mood frames, GPT Image 2 orthographic sheets for the crusher plant and the countdown board, and a Tripo proportion maquette of the crusher (`crusher-maquette-tripo.glb`). Read its README first. Rules:

1. Generate remaining sheets with GPT Image 2 using the sheet prompt template from the Tideline v4 brief (asset / role / story wear / style / avoid, exact counts). Generate hero views with FLUX.2 pro. Store every prompt and job id in `generation.json` next to the images.
2. For each focal asset import the Tripo maquette (or lift one with Tripo H3.1 from the accepted sheet's front view) beside the sheet planes in Blender, scale it to the sheet's metre height, and use it only to lock silhouette and proportion. Delete it before export. Maquettes never ship: wrong scale, one baked texture, no material roles, 4-8x the triangle budget.
3. Acceptance for the blockout stays as written above; acceptance for any painted asset later is the hero-versus-model side-by-side with five shared details, as in Tideline v4.
