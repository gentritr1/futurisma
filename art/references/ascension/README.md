# Ascension Pad — art starting kit (generated 2026-09-05, Higgsfield)

User-approved concept. Use these as the starting point; every asset is still rebuilt low-poly on the six painted atlases. Brief: `docs/briefs/ASCENSION-PAD-LEVEL.md`.

## Mood frames (FLUX.2 pro, chase height, no vehicles)

| File | Shows | Use |
|---|---|---|
| ascension-01-apron.png | Pad Road: apron, launch platform and service tower, countdown board T-04:12, sodium lamps, egrets, mangroves | Palette, road language, board scale. **The rocket here drifted toward a real shuttle silhouette and a logo appeared on the building: do not copy either.** |
| ascension-02-flame-trench.png | Trench: scorched walls, deluge pipes and valve wheels, cage lamps, puddles, deflector ramp, rocket visible above | The trench section look, lamp spacing, wet floor |
| ascension-03-crawler.png | Crawlerway: road passing under the crawler-transporter, CRAWLER CROSSING sign, beacon and klaxon | The moving set piece and the clearance the road needs |
| ascension-04-launch.png | Causeway at T+00:03: launch, steam wall crossing the apron, birds scattering, board reading T+00:03 | The launch event look and its lighting on the road |

## Asset sheets (GPT Image 2, counts checked against the prompt)

| File | Asset | Notes |
|---|---|---|
| sheet-rocket-platform-gptimage2.png | Mobile launch platform + original rocket + service tower | Matches: two olive boosters, blunt cone, four fins, stencil 09, three swing arms, beacon, deck hazard band, repair plate, exhaust hole in TOP. Original design, keep it that way. |
| sheet-crawler-transporter-gptimage2.png | Crawler-transporter CT-2 | Matches: four treads, four legs, two cabs, beacon + horn, hazard band, repair plate. FRONT shows the under-deck clearance the road passes through. |
| sheet-countdown-board-gptimage2.png | Launch countdown board | Matches: A-frame mast, T-04:12, PAD 09 CLEAR, beacon, horn, cage lamp, hazard band, plate. |
| sheet-trench-wall-module-gptimage2.png | Flame-trench wall module 24 x 14 x 3 m | Two pipes, ladder, grate, TRENCH 2 stencil, hazard band, plate. Has FOUR valve wheels instead of three; keep four. Ends read flat for tiling. |
| crawler-front-crop.png | Front view crop used for the Tripo maquette | |
| crawler-maquette-tripo.glb | Proportion maquette of the crawler (if present) | Normalised to 1 m; scale to 12 m tall beside the sheet planes, lock silhouette, delete before export. Never ship. |

## Hero views at chase height (FLUX.2 pro, added after the sheets)

| File | Notes |
|---|---|
| hero-rocket-platform-flux2.png | Platform on piers, original rocket 09 with two olive boosters, three swing arms, beacon, cage lamps. **A small logo-like mark appeared on the core: do not reproduce it.** |
| hero-crawler-transporter-flux2.png | CT-2 straddling the road, clearance under the girders, beacon + horn, painted deck. |
| hero-countdown-board-flux2.png | Board on A-frame, T-04:12 and PAD 09 CLEAR, beacon, horn, cage lamp, egrets. **A small logo appeared on the far gantry: do not reproduce it.** |
| hero-trench-wall-module-flux2.png | Tiled modules both sides, two pipes, red valves, cage lamps, deflector ramp, light shaft, puddles. |

Maquettes: `crawler-maquette-tripo.glb` and `rocket-platform-maquette-tripo.glb` (Tripo H3.1, normalised to 1 m; scale to sheet height, use for silhouette only, delete before export).

## Division of labour
Higgsfield (FLUX.2, Tripo) is run by the orchestrator, not Codex. Codex has GPT Image 2 only and uses it for every remaining sheet and material-ID pass, and for any secondary hero using `hero_prompt_template` in generation.json. Do not ask for Higgsfield access; everything that needed it is already here.

## Still to generate (Codex, GPT Image 2)
- Material-ID pass (GPT Image 2) for each of the four sheets above.
- Sheets for: deluge water tower, propellant tank, vent stack, crawlerway gravel bed, mangrove pier, egret card set, service-tower swing arm.
- Sky panorama 4096x1024, one lighting state, profile script before acceptance.

## Model routing rule (measured 2026-09-05)
Count-heavy sheets: GPT Image 2. Heroes and mood: FLUX.2 pro. Proportion maquette: Tripo H3.1 from the front view (9 credits); SAM 3 only lifts from a hero frame with the object named and returns a diorama. Record every prompt and job id in `generation.json`.
