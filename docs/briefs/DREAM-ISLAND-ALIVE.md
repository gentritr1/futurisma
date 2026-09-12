# Dream Island — Phase F "ALIVE": the world fills up, the powers get seen, the screen becomes a game

**STATUS: FINAL (2026-09-12). Start from `main` at `aad5942` or later.** Two tracks run in parallel and never touch each other's files: **F-CODE** (Opus, game code and HUD) and **F-3D** (Codex, meshes, materials, shaders). Read `docs/briefs/DREAM-ISLAND-HANDOFF.md` first (environment, rules, report format), then round 1's collision rule and ceilings in `DREAM-ISLAND-CODEX-POLISH.md`. Both still bind, with the numbers in §6 below.

## 1. Why this pass exists — the first human playtest

The user drove the map on 2026-09-12. Verdict, in their words: quality and ambience are better, but the island **feels empty**; the super powers are **barely noticeable, barely seen on the road, and the player is not told how they can be used**; and the whole screen reads as **a dashboard, not a game**.

All three were checked against the frames the game actually draws (`art/references/dreamisland/phase-f/shipped-court-*.png`, captured at `aad5942` from the demo autopilot at CLOCK COURT, progress 0.575, works tier):

- The road is 26 m wide (`route.json`) and has no paint on it. No lines, no kerbs, no arrows. 593 placements, all static. Zero lamps. At night the only lit object on the island is the orange trigger plate.
- The power device is 1.6 m tall and stands 2.5 m past the road edge (`dreamisland-hardware-layout.js`, grove 3.4 m). What the player drives over is a flat plate on the tarmac. The HUD's only prompt is `COLLECT A DEVICE`, 13 px grey mono. Nothing says "press E", or when.
- Twelve static HUD blocks and one banner. A lap ends, a rival passes, the clock strikes, a surge fires: numbers change and nothing else does. The camera never moves.

Three directions were drawn on a design canvas (Race Weekend / Screensaver Alive / The Stage). **The user chose: Direction B's world and capsule pickups, Direction A's timing tower, Direction C's road paint.** Then, looking at the painted B frames: *"the water quality looks superb if we could make it like that, and then we ambience of balls added and overall so it feels more full and not empty."*

## 2. The target frames, and the gap measured with the instrument that found the pale look

`art/references/dreamisland/phase-f/target-court-day-gptimage2.png` and `target-court-night-gptimage2.png` are Higgsfield `gpt_image_2` edits of the two shipped frames (same camera, same road, same craft) with the chosen direction painted in. They are the look this pass aims at. They are paintings: they have soft global illumination, real refraction and a wet road with planar reflections, none of which we ship. What we CAN move is what `scripts/visual/grade/measure-frames.py` measures. Same script, `--full` on the paintings, HUD-cropped on the shipped frames:

| COURT pose | lumaMean | lumaStd | chroma | p01 | p99 | range | blackPct | whitePct |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| shipped day (`aad5942`) | 132.9 | 52.7 | 19.0 | 17.3 | 207.3 | 190.0 | 0.35 | **0.00** |
| target day (painting) | 117.2 | 47.3 | 22.1 | 27.2 | 219.2 | 192.0 | 0.41 | **0.35** |
| shipped night (`aad5942`) | 30.4 | 18.1 | 10.7 | 3.5 | **79.1** | **75.6** | 23.3 | 0.00 |
| target night (painting) | 31.0 | 34.9 | 8.9 | 2.1 | **193.5** | **191.5** | 38.9 | 0.06 |

Read it before touching a slider:

- **By day the colour is already there.** Chroma 19.0 vs 22.1, saturation within 15 %. What the painting has and we do not is **highlights**: 0.35 % of its pixels reach white; ours reach none, on any frame, on any circuit (see the pale-look scar). The day gap is specular: sun glint on the water, gloss on chrome and toys, a soft lens flare. It is a material-response problem, not a grade.
- **By night the gap is dynamic range.** Our night p99 is 79: the brightest 1 % of the frame is under a third of white, so the night is grey-blue mush. The painting's p99 is 193 with MORE true black (39 % vs 23 %). The night gap is emissive sources against a darker ground: lamps, the capsule, glowing fish, the wet road giving the lamps back.
- The painting is **softer** by day (lumaStd 47 vs 53): it has ambient occlusion and no hard flat facets. A vertex-colour AO bake closes part of that at zero runtime cost.

Every visual acceptance in this pass is a delta against these rows, on the same pose, with the same script, and the before/after table goes in the evidence README. No other number about "look" may be written.

## 3. Roles

- **Higgsfield** (done, by the orchestrator; `art/references/dreamisland/phase-f/generation.json`): the two target frames, the capsule orthographic sheet, the props sheet. 9 credits spent (38.23 → 29.23) across these and the direction concepts. Nobody generates anything else in this pass; if an input is missing, say what and why.
- **F-3D, Codex**: water shader, chrome/glass materials, the capsule and props GLBs, glow sprites, an AO bake. Owns `art/blender/build_dreamisland_props.py`, `art/blender/build_dreamisland_capsule.py`, `public/assets/dreamisland/props.glb`, `public/assets/dreamisland/capsule.glb`, `src/game/dreamisland-water.ts`, `src/game/dreamisland-materials.ts` (additive changes only), a new `src/game/dreamisland-reflections.ts`, `art/evidence/dreamisland-v1/alive/3d/**`.
- **F-CODE, Opus**: road paint, the prop placement system, more fish, the capsule pickup behaviour, the HUD theme and timing tower, the feel moments. Owns everything else under `src/game/dreamisland-*`, `src/game/data/dreamisland/**`, `src/style-dreamisland.css` (new, lazy), the two shared-HUD touches in §4.5, `art/evidence/dreamisland-v1/alive/code/**`.
- **Orchestrator** (Fable): brief, contracts, review by re-running the soaks and the measurement, git.

Neither track edits `src/game/game.ts` (seam ceiling, untouchable), the route, the schedule, the powers config, the pace solver, or the autopilot. Determinism stays byte-identical at 60/120/240 Hz.

## 4. F-CODE (Opus)

### 4.1 Road paint — one decal mesh from `route.json`
Build a ribbon mesh over the road the way `dreamisland-water.ts` builds its foam ribbons (`ribbon(course, from, to, …)`), 2 cm above the deck, `polygonOffset` so it never z-fights: white edge lines 0.25 m wide at ±(halfWidth − 0.6 m) for the full lap; a dashed white centre line (3 m dash, 6 m gap) everywhere except the BASIN causeway (it is wet, it stays plain); red-white kerb blocks 1.2 m wide × 2 m long on the INSIDE of every bend whose curvature, sampled from the 800 route stations, exceeds the median curvature of the lap (compute it, print the threshold and the bends it selected); cyan chevrons 4 m wide every 10 m for 60 m before each of the five pickups. Vertex colour only, no new texture, one draw call (two if the kerbs need their own material). Corridor validator stays at 0 intrusions; the decal is not collidable.

### 4.2 Props — an instanced placement layer
New `src/game/data/dreamisland/props.json` in ROUTE space like `fish-paths.json` (`{kind, progress, lateral, rise, yaw, scale}`), consumed by a new `src/game/dreamisland-props.ts` that builds ONE `InstancedMesh` per kind from `public/assets/dreamisland/props.glb` (node contract §5). Until Codex's GLB lands, build from three.js primitives under the same node names so the placement, counts and budgets are provable now and the swap is a file replacement. Author the first set to the target paintings: beach balls and rings on the sand and in the shallows (BEACH, REEF, COURT), chrome spheres at three heights over the water and the verges (never over the deck below 8.85 m, the corridor rule), one pipes sculpture per district on the shore, cyan bollards 1.1 m tall every 24 m along BOTH road edges at halfWidth + 1.2 m, plinths under the sculptures. Bollard core emissive ∝ `nightBlend` (off by day, full at night, the same curve the foam uses). Every prop is a pure function of tick for its idle motion (spheres bob ± 0.4 m over 6 s, balls roll slowly on the spot); `?motion=reduce` freezes them. Report the count per kind and the draw calls added (target: 6 draws for 6 kinds).

### 4.3 Fish — from two shoals to eight, and over the road
Extend `fish-paths.json` with six more shoals (four fish each, the existing instanced path system, no new code path) whose paths cross the road in GROVE, COURT, REEF and CUT at ≥ 8.85 m deck clearance, measured by the existing dense-sampling clearance check, which must still pass. At night the fish carry the emissive term they already have on `DI_FISH*_DI_MAT_emissive`; raise its night intensity until a fish at 40 m contributes to the night p99 (measure it: one frame with fish, one without, same pose).

### 4.4 The capsule pickup — seen, taught, used
Rules unchanged (`polarity-simulation.js`: one collect per pickup per lap, E / B fires, launch zones and the bore field as they are). What changes is what the player sees:
- The trigger's visual is now a **capsule** (`capsule.glb`, §5; primitives until it lands) hovering with its centre 2.2 m above the deck at the pickup's `lateral`, spinning at 0.25 rev/s, with a **light column**: one additive vertical quad 1.2 m wide from the capsule to 40 m up, emissive cell, fading with height, and a **ring** decal 3 m across on the tarmac beneath it. The verge device stays and becomes the capsule's "charger" (no behaviour).
- On collect: the capsule scales to zero over 250 ms and the column fades; both return over 1 s when the pickup becomes collectable again on the next lap. Whole-mesh transforms, pure functions of tick.
- Pixel proof: the frames script (`polish3-frames.mjs` style) captures the capsule + column at 300 m, 150 m and 40 m by day and by night, and the README quotes the bounding-box height in pixels at 1280×720 for each. Estimated from the 62° chase camera before you measure: the 3 m capsule alone is ~14 px tall at 150 m; the 40 m column is what carries the distance. If the column is not ≥ 100 px tall at 150 m, raise it, not the capsule.
- Budget: one InstancedMesh for the five capsules, one for the five columns, one for the five rings: 3 draws.

### 4.5 HUD — the island's own skin, and A's timing tower
- **Theme hook (shared, tiny):** `circuit-runtime.ts` sets `document.documentElement.dataset.circuit` to the circuit id when a runtime loads and clears it on dispose. That attribute and nothing else is the shared change; the six other circuits must render byte-identically (prove it with one screenshot of Greenwater before/after and a pixel diff of zero).
- **The skin:** `src/style-dreamisland.css`, imported from `dreamisland-runtime.ts` so Vite emits it with the island's lazy chunk, scoped under `:root[data-circuit="dreamisland"]`. It restyles the EXISTING HUD elements (no new markup in `index.html` beyond what §4.6 needs): aqua glass pills (`border-radius: 999px`, white 1 px border at 75 %, the vertical gel gradient, inset highlight, `backdrop-filter: blur(6px)`), chrome roundels for position and speed (the conic chrome gradient), Michroma for labels and Share Tech Mono for numbers (both are Google Fonts; load them ONLY from the island chunk, never in the shell; fall back to the shell's condensed and mono faces). By day: cobalt `#0038d9` text on light glass. At night: cyan `#b8fbff` text on dark glass. Drive the switch from `nightBlend` through one CSS custom property set by the runtime. The full look is the canvas's Direction B board: `docs/briefs/DREAM-ISLAND-ALIVE.md` cannot carry pixels, so match the canvas, and put a 1440×810 screenshot of your HUD beside the canvas frame in the evidence.
- **Timing tower (Direction A):** the field list becomes a tower with LIVE gaps. Today `updateFieldOrder` keys its DOM rebuild on position and name only, so a rival's gap text goes stale until the order changes; that is a real bug, fix it (update the gap span's text when `gapMs` changes by ≥ 0.1 s, without rebuilding the rows). The player's row is highlighted; rival rows show `+x.x` to the player. Rival name tags in the WORLD are NOT in this pass.
- **The clock on screen:** a 64 px round dial in the HUD with hour and minute hands driven by the same tick function as `dreamisland-clock.js` (import it; do not duplicate the maths), beside the strike countdown chip. At the strike the hands snap to twelve as the tower's do.
- Shell gzip may not grow by more than 0.5 KiB (the attribute and its one-line setter). Measure and quote it.

### 4.6 The power slot — the thing the playtest was about
Bottom centre, replacing today's 56 px ability slot for this circuit: a 96 px glass pill holding a chrome orb with the capsule glyph, the power name, one line of advice, and a chrome **E keycap** that pulses cyan when a power is held. Five states, each a `data-power-state` on the slot, each verified by a frame in the evidence:
1. `hunting` — the nearest uncollected capsule ahead: name and distance (`SURGE · 300 M`), from the runtime's progress and the pickups' progress.
2. `in-range` (≤ 120 m) — a **bubble callout** in the world: a glass pill projected from the capsule's world position to screen space every frame (`camera.project`), reading `SURGE · DRIVE THROUGH · 120 M`, bobbing ± 5 px, hidden when the capsule is behind the camera or off screen.
3. `collected` — 400 ms: the orb fills cyan from the bottom, the existing clunk + pickup sounds.
4. `armed` — `SURGE READY`, the keycap pulses, the advice line names the next launch zone (`THE BEACH STRAIGHT IS NEXT` / `THE REEF STRIP IS NEXT`, from `launchZones` in the powers config) or, for shield, the bore (`THE BORE IS NEXT`). **First armed state of a race only:** the pill grows to 120 px and reads `HOLD E TO FIRE` for 3 s, then never again that race. No slow-motion: the sim tick is untouchable.
5. `active` — `SURGE 1.4 S`, the orb's ring drains over the power's duration; then back to `hunting`.
Keyboard label from the existing `data-prompt` system so a controller shows `B`.

### 4.7 Feel — three moments, all in the island's runtime
- **Fire:** camera FOV 62 → 70 over 120 ms, back over 600 ms (the runtime owns `camera.fov` at `dreamisland-runtime.ts:60`); a CSS speed-lines overlay at the screen edges for the power's duration; cyan (surge: amber) edge sweep.
- **The strike:** a 300 ms white-to-cyan full-screen flash from the HUD layer, the hands snap, and one goldfish SVG swims across the top of the HUD over 2.4 s (the audio kit's chime already fires here).
- **Overtake / overtaken:** a glass pill floats up from the timing tower for 1.6 s with the rival's name. Driven from the field order change the HUD already receives.
All three are `?motion=reduce`-aware: no FOV move, no sweep, no fish; the flash becomes a 0 ms cut.

### 4.8 What F-CODE proves
`npm run test:code` PASS; four soaks with the ceiling table (§6); `validate:dreamisland-runtime` byte-identical at three rates; the corridor at 0; the six-circuit HUD pixel diff; the five power-slot state frames; the three feel moments as short frame sequences; the capsule pixel-height table; the prop count table; the Greenwater before/after. Evidence in `art/evidence/dreamisland-v1/alive/code/` with a README naming every command.

## 5. F-3D (Codex)

### 5.1 The water — the user's first ask
`dreamisland-water.ts` is three draws on one atlas, vertex-lit and flat. The painting's water has depth colour, sun glint, reflections and soft foam. Do, in this order, measuring after each with `measure-frames.py` on the COURT and REEF poses:
1. **Reflection of the sky.** One `PMREMGenerator` pass over the existing `dreamisland_panorama` (day and night textures, blended by `nightBlend` in the shader or two env maps cross-faded), generated once at load; report the milliseconds it costs on the works tier. Blend it into the sea and shallows with a Schlick fresnel (F0 0.02) so the horizon mirrors the sky and the near water shows its depth cell. Keep the materials on the lit path: `toneMapped` and `fog` at their defaults, as the file's own comment demands.
2. **Sun glint.** A specular term (Blinn-Phong is fine at this art level) against the sun direction the sky module already knows, over a normal perturbed by two scrolling sines (no new texture; if you want a normal tile it must live in a free cell of the water atlas and obey the quadrant rule). The target's whitePct is 0.35 %; ours is 0.00 on every frame. Acceptance: **whitePct ≥ 0.15 on the COURT day pose with the sky region excluded** (mask the top 30 % of the frame and report both numbers), no pixel of the sky itself clipping harder than before.
3. **Depth gradient.** The cobalt and turquoise cells already exist; sharpen the transition with vertex colour so the shallows read as a band, not a fade. Report the 8-colour palette of the painting's water vs yours.
4. **Night.** Sea to true black (the painting's blackPct is 39 %, ours 23): lower the night sea colour and raise the emissive foam so the p99 climbs. Then the wet road: the road's concrete material gets, ∝ `nightBlend`, a fresnel reflection of the same env map plus a specular term that catches the bollards' colour (a single cyan "lamp" direction is enough; real per-lamp reflections are out of budget). Acceptance: **night p99 ≥ 150 and range ≥ 140 on the COURT night pose** (target 193 / 191), with the road surface between the edge lines still reading (its p50 must not fall below today's 30.9).
The shared budget for all four: 0 new draw calls, ≤ 1.0 ms p95 on the works tier, measured with the residual quoted.

### 5.2 Materials — one chrome recipe, one glass recipe
`dreamisland-reflections.ts` exports the env map and two materials: **chrome** (`MeshStandardMaterial`, metalness 1, roughness 0.08, the env map, on the metal atlas cell for tint) and **glass** (metalness 0, roughness 0.15, `transparent`, opacity 0.55, the env map, emissive from the emissive atlas cell, depthWrite off, rendered after the opaque props). Both keep tone mapping and fog on. The props and capsule builders use these by node name.

### 5.3 Props GLB — `public/assets/dreamisland/props.glb`
From `props-sheet-gptimage2.png`, on the six shared atlases, node contract: `PR_ball` (≤ 200 tris, vertex-coloured stripes on the jungle cell), `PR_ring` (≤ 300), `PR_sphere` (≤ 240, chrome), `PR_pipes` (≤ 900, chrome, 4 m), `PR_bollard` (≤ 160, concrete base + emissive core node `PR_bollard_core`), `PR_plinth` (≤ 60, concrete). Opus's `dreamisland-props.ts` instances these by name; if a name is missing it throws, so match exactly. Atlas-cell proof for every consumer as in phase C.

### 5.4 Capsule GLB — `public/assets/dreamisland/capsule.glb`
From `capsule-ortho-gptimage2.png`: 3 m tall, ≤ 800 tris, nodes `CAP_frame` (chrome), `CAP_glass` (glass), `CAP_core` (emissive cell, the cyan cylinder), `CAP_cap` (chrome). Origin at the geometric centre so Opus's 2.2 m rise puts the centre at 2.2 m.

### 5.5 Glow
Additive billboard sprites (one `InstancedMesh`, emissive cell, `depthWrite` off) for the capsule core, the bollard cores and the fish at night, sized in world metres so they do not grow with distance. This is the cheap bloom. Measure the night p99 with and without them.

### 5.6 AO bake (if the triangle count is unchanged)
Bake ambient occlusion into the vertex colours of `painted.glb`'s static meshes in Blender (`build_dreamisland_painted.py` grows a step; the world export stays byte-identical in topology, proven by the validator's triangle counts). Report the day lumaStd delta on the COURT pose (target 47 from 53). Skip it if it costs a single triangle.

### 5.7 What F-3D proves
The measurement table (shipped / yours / target) for COURT and REEF, day and night, after each of §5.1's steps; the palette comparison; the PMREM cost; four soaks; the atlas proofs; frames of every prop and the capsule at 8 m and 40 m, day and night. Evidence in `art/evidence/dreamisland-v1/alive/3d/` with a README naming every command.

## 6. Ceilings for this pass (all measured, none negotiable)

| Axis | Ceiling | Where measured |
|---|---|---|
| Draws, main + shadow, worst tier | **≤ 130** (map ceiling 145; today 105) | `race.mjs --tier=feral` → `metrics.json` `peakTotalCalls` |
| Triangles, main + shadow | **≤ 205,000** (ceiling 220,000; today 162,334) | same |
| p95 frame time | report only, ≤ 11.0 ms, with `sampleResidual` | same |
| Shell gzip | 277.0 KiB + 0.5 KiB | `npx vite build && node scripts/validate-build.mjs` |
| Island chunk | new measured ceiling pinned at measured + 10 % in `validate-build.mjs`, both numbers stated | same |
| Corridor | 0 intrusions | `validate:dreamisland-painted` |
| Materials | 0 `toneMapped:false` / `fog:false` except the sky dome | the material walk in `race.mjs` |
| Determinism | 60/120/240 Hz identical | `validate:dreamisland-runtime` |
| Other circuits | pixel-identical HUD | Greenwater screenshot diff |

## 7. Order of work and the seam between tracks

Opus starts now with primitives under the §5 node names; Codex starts now on the water (§5.1), which touches no Opus file. The GLBs land as file replacements. If a contract in §5 has to change, the change is written into this file first, by the orchestrator, and both tracks are told. Commit nothing; report in the handoff's format with a "numbers this pass measured for the first time" section.

## 8. F-3D REVIEW 2026-09-12 — REQUEST CHANGES on §5.1 (water and wet road); the rest of §5 stands

Reviewed against `art/evidence/dreamisland-v1/alive/3d/` by re-reading the final frames (`final/court/blend-000.png`, `blend-100.png`, `autopilot-final/court-day.png`, `court-before-after.png`) and the shader in `dreamisland-reflections.ts`. The GLB contracts, atlas proofs, glass/chrome recipes, glow batch, AO byte-proof and the four isolated soaks are **accepted as reported** (VERIFIED by re-running `inspect-glb.py` and reading the soak tables; the combined build is still to be validated once F-CODE lands).

**What failed, and why the gates did not catch it.** Both water gates in §5.1 were met, and the look is wrong:

- **Day sea.** The sea is a pale white-blue field covered by a regular lattice of white dashes. Whole-frame chroma fell from 21.8 (step 0) to 16.8 against a painting at 22.1; the day mean rose from 142 to 151 against a painting at 117. The cause is two things in the shader: (1) the fresnel term `.02+.98*(1-cosθ)^5` reaches ≈1 at the grazing angles a chase camera sees, so most of the sea becomes the sky dome, which is bright and pale; (2) the "glint" is `pow(max(dot(N,H),0),128)*60` over a normal built from TWO fixed-frequency sines (`sin(.72x+.31z)`, `sin(.83z−.23x)`), which is a perfectly periodic lattice, so every crest saturates to white in a grid. The whitePct gate rewarded exactly that.
- **Night road.** The wet-road term uses the same sine lattice at 18× frequency with exponent 24, so the tarmac is a screen-wide grid of cyan dots; the kerb rails went bright cyan-white with it. The p99 gate rewarded that too.

**Lesson, recorded for every later brief:** a highlight or range gate must travel with (a) a floor on the metric it can steal from (chroma, the road's darkness) and (b) an aperiodicity check plus a 2× crop for the eyeball. A number that can be satisfied by tiling white over a surface is not a gate.

**Corrected §5.1 acceptance (replaces the two gates; same poses, same script, same isolation masks as `measure.py`):**

1. *Sea keeps its colour.* Sea-band chroma (the `-sea` isolation) ≥ its step-0 value, and whole-frame day chroma ≥ 21.8. Sea-band p50 luma within ±8 of step 0. Achieve it by capping the reflection weight (fresnel × ≤ 0.35 at grazing, ≤ 0.08 at normal incidence) and multiplying the reflected sky by the sea's own cell colour so the mirror is cobalt, not white.
2. *Glints are sparse and aperiodic.* Sea-band whitePct between 0.15 and 1.0 %. No white connected component larger than 60 px at 1280×720. The 2-D autocorrelation of the sea band's white mask has no secondary peak above 0.30 of the zero-lag value (a 12-line numpy script, committed beside `measure.py`). The normal must come from a non-repeating field: ≥ 4 sines at incommensurate frequencies and directions, or a hashed noise; amplitude such that the surface normal tilts ≤ 8°; glint exponent ≥ 64, magnitude clamped so a single crest never adds more than 1.0 to `outgoingLight`. Attach a 400×200 px crop of the sea at 2× in the README.
3. *Wet road is a streak, not a pattern.* Road band (the `-road` isolation) at night: p50 ≥ 30.9 (unchanged), whitePct 0.00, and the same autocorrelation test passes. The reflection on the road uses the smooth surface normal (perturbation ≤ 0.01) and a low exponent (≤ 8) so the lamp reflection is one broad vertical streak that moves with the camera, as it does in `target-court-night-gptimage2.png`. The kerb rail material is excluded from the wet term: a crop of the rails must be pixel-identical to step 0.
4. *Night range still climbs.* Night p99 ≥ 150 and range ≥ 140 stand, but they must be earned by the emissive foam, shallows, bollard cores and the capsule (the sources), not by the road: the road band's night p99 must stay ≤ the painting's road band p99, measured with the same mask on `target-court-night-gptimage2.png` (state the number).
5. *Sky unchanged* as before (sky-only frames pixel-identical).

Redo steps 1, 2 and 4 of §5.1 under these criteria, re-run the ordered table, and re-report. Steps 3 (depth band), 5.2–5.6 need no change. Commit nothing.

## 9. F-3D REVIEW 2 (2026-09-12, `review-8/`) — three rulings, one new REQUEST CHANGES

Read `review-8/README.md`, the ordered table and the frames `step-4/court/blend-000.png`, `blend-000-sea-2x.png`, `blend-100.png`, `step-4/reef/blend-100.png`.

**Accepted:** the sea is cobalt again with no lattice (sea chroma 51.6 vs 51.3 at step 0, whole-frame 21.86 vs 21.79); the wet road at night has no pattern and the rails are excluded; skies pixel-identical; works Δp95 0.0 ms; the autocorrelation script and its results.

**Rulings on the three residuals Codex reported honestly:**

1. *REEF whole-frame chroma 17.78 vs "21.8".* My error: 21.8 was COURT's step-0 value written as if it were universal. The floor is per pose, its own step 0: COURT ≥ 21.79, REEF ≥ 17.57. REEF passes at 17.78. §8 item 1 reads that way from now on.
2. *One rail pixel differs by one red level.* Below the instrument's resolution (a 1/255 step in one pixel of a 1280×720 frame). Passes. "Pixel-identical" in §8 item 3 means: no pixel differs by more than 2 levels in any channel.
3. *The glint cannot reach white.* Two of my constraints fought each other: the 1.0 additive cap is compressed by AgX to ≈212, so white is unreachable whatever the geometry; and at COURT the real sun's half-vector needs a 60° tilt, so a physically placed sun never sparkles for this camera. The painting's sparkle is art-directed, and ours may be too. **Ruling:** drop the 1.0 cap (the sparsity gates — coverage 0.15–1.0 %, max blob 60 px, autocorrelation ≤ 0.30 — are what stop tiling, and they stay); and let the glint use a *sparkle direction*, not the shadow light: the sun's azimuth with an elevation chosen so the far band of the sea sparkles from the chase camera at both poses. State the vector in the README and keep it a single uniform. Re-run the day rows of the table with the sea white % now between 0.15 and 1.0 at COURT and REEF.

**New REQUEST CHANGES — REEF night is blown out.** `step-4/reef/blend-100.png`: the shallows either side of the pier render as flat white slabs (whole-frame white 0.98 %, p99 239). The painting's night shallows are a cyan glow, never white. The "distance boost" of the shallows/foam emission to 64/96 beyond 160 m is withdrawn. New gates for the water at night, both poses: no water pixel above 239 (water-band whitePct 0.00), and the shallows band keeps chroma ≥ its step-0 value (it must read cyan, not white). Consequently the COURT night p99 ≥ 150 gate is **moved to the combined build**: in the isolated tree there are no bollards and no capsule, and the range must come from those sources plus the foam, not from overdriven water. Report the isolated COURT night p99 as a number, not as a gate.

Redo: the glint (item 3) and the REEF night emission (new REQUEST CHANGES). Re-run the ordered table, re-report in `review-9/`. Commit nothing.

## 10. F-3D REVIEW 3 (2026-09-12, `review-9/`) — APPROVED in isolation; combined gates pending

Read `review-9/README.md`, the ordered table, `step-4/court/blend-000.png`, `blend-000-sea-2x.png`, `step-4/reef/blend-100.png`. Sea white 0.234 % (COURT) / 0.269 % (REEF), blob ≤ 60 px, AC ≤ 0.30, per-pose chroma floors met (21.86 / 17.87), night water maximum 166.9 / 194.2 with shallows chroma at baseline, road AC 0.000, rails within tolerance, skies identical. Sparkle direction is one stated uniform. Feral: the first run's 12.2 ms carried a −40-frame residual (a starved capture on a shared host, most likely the concurrent F-CODE soaks); the unchanged-source repeat at 9.3 ms with residual −0.6 is the valid row, and the combined soaks will re-measure it anyway. The isolated COURT night p99 is 88.9, reported as a number; its ≥ 150 gate is decided on the combined build with the bollards and capsule present. F-3D is done for this pass; it waits for F-CODE's GLB integration and the orchestrator's combined run.

## 11. COMBINED REVIEW 1 (2026-09-12) — both tracks in one tree; F-3D accepted, F-CODE REQUEST CHANGES (round 2)

Run by the orchestrator on the merged working tree (F-3D review-9 water + F-CODE), evidence in `art/evidence/dreamisland-v1/alive/combined/`: `npm run test:code` PASS (76 PASS lines, exit 0); `vite build` + `validate-build` PASS (shell 277.2 KiB gzip, initial JS 972.1 KiB raw / 265.4 gzip); four soaks on a dev server of the merged tree (the render-walk hook `__diScene` exists only on the dev server, so a `vite preview` soak fails at the material walk — both tracks measured on dev servers for that reason):

| tier | draws (main+shadow) | triangles | p95 ms | window / expected (residual) |
|---|---:|---:|---:|---|
| rookie | 123 | 185,612 | 8.7 | 720 / 722.3 (−2.3) |
| works | 123 | 185,612 | 8.6 | 720 / 716.1 (+3.9) |
| feral | 124 | 185,708 | 8.6 | 720 / 708.6 (+11.4) |
| works-reduced | 120 | 182,060 | 8.6 | 720 / 721.5 (−1.5) |

All inside §6 (≤ 130 / ≤ 205,000). Missed gates 0, material violations 0, laps byte-identical to the shipped calibration (33158 / 32125 / 31925 ms).

**The moved night gate passes on the combined build.** Autopilot chase camera, `court-autopilot/`, `measure-frames.py` HUD-cropped: COURT night p99 **204.2**, range **201.4** (gate ≥ 150 / ≥ 140; the painting is 193.5 / 191.5). REEF night 157.6 / 156.8. COURT day chroma 18.5 (shipped 19.0), whitePct 1.53 — the capsule column, not the sea.

**F-3D: ACCEPTED for merge.** Nothing further.

**F-CODE: accepted as built with these rulings** — capsule as 6 draws (the node contract makes it four meshes plus column and ring); raw JS ceiling 972 → 973 KiB (documented); the `input-prompt-map.js` row for the power prompt; the per-instance prop cull; the fish "contributes to p99" target is **withdrawn**: AgX saturates at ≈185 for any emissive value while the frame's p99 is set by the capsule column at 212, so the target was unreachable by construction (same lesson as E4: a target must be reachable by the actor it names; this one was not reachable by any actor under the tone curve). Emissive stays at 6.0.

**F-CODE round 2 — REQUEST CHANGES, six items, all measurable:**

1. **The skin must apply on the dev server.** Today the island stylesheet is injected by Vite as a `<style>` element and the shipped CSP (`style-src 'self'`) blocks it, so on `npm run dev` the new HUD renders unstyled (raw bubble text, black circles where the chrome roundels are — see `combined/court-autopilot/court-day.png`). That is what the user's own playtest would show. Load the skin through a `<link rel="stylesheet">` whose `href` is `new URL('./style-dreamisland.css', import.meta.url)` (a self URL in dev and in the build), appended by the runtime and removed on dispose. Acceptance: `alive-hud.mjs` frames shot on the dev server and on `vite preview` are pixel-identical for every state; `race.mjs` no longer needs its ignored CSP message (remove the exception). No CSP or validator change.
2. **Self-host the two faces.** Michroma and Share Tech Mono (both SIL OFL) as woff2 under `public/assets/dreamisland/fonts/`, `@font-face` in the island stylesheet only, `font-display: swap`. Pin the new served bytes in `validate-build.mjs` at measured + 10 % and state both numbers. Nothing in the shell references them. (Orchestrator's decision: they are lazy bytes on one circuit; the look was chosen with these faces.)
3. **Day legibility of every HUD text.** In `hud-1440/slot-in-range.png` the gate strip (`NEXT GATE … BEACH STRAIGHT`, `12.0 KM TO FINISH`) and the bottom-left labels (`SPACE / SHIFT · NITRO`, `DREAM ISLAND / DAY INTO NIGHT`, `THE STRIKE IN`) sit on bare sky and sand with no backing. Acceptance: for every visible HUD text element, the WCAG contrast ratio between its ink and the mean colour of the frame behind its bounding box is ≥ 4.5 on the day BEACH, COURT and REEF frames and the night COURT frame at 1440×810 — a 30-line script over the DOM rects and the screenshot, committed beside `alive-hud.mjs`, its table in the README. Fix with glass backings (the pill recipe), not by darkening the day ink alone.
4. **Toys where the driver can see them.** `props.json` puts balls and rings 14–34 m from the road centre and spheres 8–26 m beyond the edge, so from the chase camera they are dots. The painting's toys sit at the road's edge. New placement rules: ≥ 60 % of balls and rings within halfWidth + 1.5 … + 10 m; ball scale so the ball is ≥ 1.8 m across; ≥ 1/3 of spheres within halfWidth + 2 … + 12 m at 2–6 m height (never over the deck — the corridor rays still decide); counts doubled (balls 44, rings 28, spheres 60) — the cull keeps the drawn triangles bounded, report the new peak. Acceptance: in each of the three day frames (BEACH, COURT, REEF, autopilot chase pose) at least four toys are ≥ 20 px tall, counted by the isolation method the capsule table used.
5. **The capsule reads too small.** 37 px at 40 m. The painting's capsule at ~60 m is ~110 px of 752, i.e. an 8–9 m object. Scale the capsule instances ×2.2 (6.6 m; the GLB stays 3 m at scale 1 — a runtime scale on the instance matrix) and the column to 3 m wide, ring to 6 m. Acceptance: capsule ≥ 70 px tall at 40 m, column ≥ 12 px wide at 150 m, same capture script; corridor still 0 (the capsule's bottom stays above 8.85 m? No — it hovers at 2.2 m over the lane and is a pickup, not an obstacle: it has no collision, state that in the README).
6. **The world bubble is a whisper.** Name 14 px, range 12 px, pill ≈ 26 px tall. The canvas board is the reference: name ≥ 20 px Michroma, pill ≥ 40 px tall, chevron below it, bobbing ± 5 px. Acceptance: DOM-measured sizes in the README and the `slot-in-range` frame re-shot.

Evidence to `art/evidence/dreamisland-v1/alive/code/round-2/`, `npm run test:code` PASS, four soaks re-run (draws now ≤ 130 with doubled toys — report), the Greenwater diff re-run. Commit nothing.
