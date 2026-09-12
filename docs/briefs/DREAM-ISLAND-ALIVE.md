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
