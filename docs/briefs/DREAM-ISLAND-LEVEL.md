# Dream Island — Map 07, complete level brief

Status 2026-09-09. Written for an implementer (Codex) who has **no access to the conversation that produced it**. Everything needed to build the level is either in this file or named by path. Every engine fact below was extracted from the repo by a reader that reported file:line; where a fact could not be established, this brief says so rather than guessing.

Concept and art direction: `docs/briefs/DREAM-ISLAND-CONCEPT.md`. Art kit and per-image verdicts: `art/references/dreamisland/README.md`. Format exemplar: `docs/briefs/ASCENSION-PAD-LEVEL.md` — its render rule, sheet-prompt template, acceptance style and evidence format apply here unchanged.

## 0. Read this first — five facts that will otherwise cost you a day

1. **A new `CourseKind` silently breaks three sky lookups in three different ways.** `skyZonesFor('dreamisland')` falls through the if-chain and hands you Greenwater's twelve-sector wetland sky with no error; `cloudProfileFor('dreamisland')` returns `undefined` and the very next line of the `RaceAtmosphere` constructor reads `this.cloudProfile.coverage` (atmosphere.ts:297-298), so the map **throws at construction**; `bandStrengthFor` likewise. Add `dreamisland` to all three in `src/game/sky-profile.js` (:166, :173, :178) before anything else.
2. **The 12-second day→night crossfade cannot be done by flipping what `lightingAt` returns.** The atmosphere's smoothing is hard-coded at `1 - exp(-delta * 2.8)` for lights and `5.5` for fog (atmosphere.ts:725, :709-724) — that is 95% in ~1.07 s. The **course** must run its own 12 s interpolation and return an already-blended profile every frame. This is safe: the atmosphere will simply track a curve you are already driving.
3. **The render rule only runs for two map kinds.** `prepareTidelinePresentation` returns `null` unless `kind === 'tideline' || kind === 'ascension'` (race-presentation-setup.ts:13), which skips both `applyTidelineRenderRule` and the *throwing* `auditTidelineGameplayMaterials`. Add `dreamisland` there or you will ship `toneMapped:false` materials with nothing to catch them — exactly the defect that got Tideline v3 rejected.
4. **There is no shared scheduler.** Three unrelated scheduled-event systems exist and were never unified. Copy the **Ascension shape** (`src/game/ascension-schedule.js`): integer tick counter, build-produced JSON of absolute ticks, snapshot/restore, and a `state` object recomputed from absolute tick every call — never toggled.
5. **This repo has a ripgrep config that rewrites matched text in `rg` output.** Matches come back replaced by the letter `n` (`route.checkpoints.length` prints as `route.n.length`). Use `grep` for verification you intend to trust.

## 1. Context

Repo: `/Users/gentlegen/Desktop/futurisma-race/polarity_work` (**not** the older checkout at `~/Desktop/Projects/futurisma-race`, which is behind and lacks the Ascension and HUD work). Branch `work/dream-island` from the tip of `work/ascension-pad`. Dev server: `npm run dev -- --host 127.0.0.1 --port 5200`. Before any node script: `export PATH=$HOME/.nvm/versions/node/v20.19.4/bin:$PATH`. Use your own headless browser on your own port; never the shared Browser pane.

Product rules (`PRODUCT.md`): speed must stay readable; every effect has a racing purpose; the PS2 era is the memory, not the method; no rubber-banding, no player collision, no route obstruction by rivals; never communicate state by colour alone; `?motion=reduce` respected. Anti-references: clean sci-fi, neon cyberpunk, photoreal PBR, bloom.

**Scope note.** `art/references/dreamisland*/` and both Dream Island docs are currently **untracked** in git. Nothing about this map is committed; nothing in it is a shipped precedent yet.

## 2. Concept

A tropical island in a Y2K 3D-screensaver register — naive saturated colour, flat vertex-lit shading, low-poly, and one or two impossible things stated with total confidence. It is deliberately the first non-industrial FUTURISMA map: a dream level between the machinery maps.

The landmark is a stone grandfather-clock tower whose hands **are** the race schedule. When the clock strikes, day turns to night over 12 seconds: the sky goes to starfield, the waterfalls turn luminous blue, the sea goes black behind a glowing cyan foam line, the shallows light from within, and giant goldfish rise out of the basin and drift over the track for the rest of the race.

**The night turn earns its place on readability, not mood** — this is the answer to "every effect has a racing purpose", and the art kit demonstrates it (`heroes/01n_beach_straight_night.png`, `heroes/06n_reef_shallows_night.png`): at night the water itself lights the track edges. The foam line becomes a glowing rail along the Beach Straight, the shallows glow from beneath and define both edges of the Reef Shallows pier, and the watchtower tunnel becomes a lit beacon visible down the straight. Meanwhile fog closes in and the mid-distance goes dark. The driver trades **long-range** reference for **edge-proximate** reference. Braking points move; the racing line does not.

## 3. Route

Closed loop, **2,400 m**, **800 stations** at 3.000 m spacing (`count = ceil(length/3)`), **8 gates**, 3 laps, single road (no fork in v1 — see §9 decision 4).

| # | District id | Name | Character | Width | Length |
|---|---|---|---|---|---|
| 1 | `BEACH` | BEACH STRAIGHT | start/finish along the surf line, foam on the right, launch strip | 26 m | 300 m |
| 2 | `GROVE` | PALM GROVE | fast esses under overhanging frond cards, dappled sand | 22 m | 380 m |
| 3 | `POINT` | WATCHTOWER POINT | climbs the rocky headland, tunnels through the tower base (phase bulkhead) | 14 m | 260 m |
| 4 | `BASIN` | BASIN CAUSEWAY | stone causeway across the waterfall pool, clock tower ahead | 20 m | 300 m |
| 5 | `COURT` | CLOCK COURT | banked right around the tower's foot, the face in full view | 24 m | 340 m |
| 6 | `REEF` | REEF SHALLOWS | flat-out over cyan shallows on a low pier, launch strip | 26 m | 460 m |
| 7 | `CUT` | MOSSY CUT | tight left-right between mossy blocks back to the beach | 22 m | 360 m |

Widths are authored **per district** in Ascension's variable-width form (`build-ascension-route.mjs:20-21`); `width` in route.json is the FULL road width and per-sample `halfWidth` is derived as `width/2`. The course class still declares `readonly halfWidth = 12`.

**Gates.** `checkpoints = [0, 0.125, 0.283, 0.392, 0.517, 0.658, 0.750, 0.850]` — gate 0 is the start line, the rest sit at district entries with one extra mid-Reef. Resulting gaps in metres: 300, 379, 262, 300, 338, 221, 240, 360. `orderedCheckpointCount = 8`, `checkpointCount = 7`. **Do not copy Night Shift's `gap × length < 280 m` assertion** into your validator — Ascension ships a 1,274 m gap and the rule is that map's own.

**Elevation.** Sea level `y = 0` across BEACH and REEF; climb to `y = +22` at the tower; BASIN at `y = +14`; descend through CUT. Tideline carries 23.6 m of real relief so this is supported. **Pitch guard:** keep `max |asin(t.y)| < 10.5°` (validate-tideline.mjs:130). The 22 m climb over 260 m is 4.8° average — comfortable.

**Bank.** CLOCK COURT only. Copy `ascension-course.ts:120-121` exactly, including its units: **bank is RADIANS there** and applied via `right.applyAxisAngle(tangent, bank)`. Peak `0.055` rad (3.15°) as a half-sine across the district. Greenwater's course stores bank in *degrees* and converts — do not mix the two conventions.

**Curvature.** The fold guard is `|curvature| * width/2 < 0.8` (validate-tideline.mjs:83). Design floor: minimum turn radius **45 m** through the CUT chicane and GROVE esses, absolute floor 30 m. For reference the two most recent maps measure 55.28 m (Ascension) and 57.50 m (Tideline) minimum radius, and max |curvature| 0.018 / 0.017.

**Edges.** Single edge type `A` (hard wall) everywhere, as both modern maps do. Apron table: copy `tideline-course.ts:15-24` verbatim (`deckMarginMetres 2.05, gripFloor .5`, edge A `widthMetres 0, grip 1, wall true, wallSpeedMultiplier .76, wallImpactStrength .5, wallScrubMetresPerSecondSquared 24, surface "asphalt"`).

## 4. The published schedule

Copy the **Ascension shape**. `src/game/dreamisland-schedule.js` mirroring `ascension-schedule.js`; `src/game/data/dreamisland/schedule.json` emitted by the build script from a measured calibration run.

**All times are computed from the measured Works lap time L. Never type a tick.** `L = (laps[1]+laps[2])/2000` from a `?calibrate=1` run's `diagnostics.current.lapTimesMs`, guarded exactly as `build-ascension-route.mjs:34-38` guards it (throw if the capture has browser errors; throw if it did not complete three laps). Every tick is `Math.round(factor * L * 120)`.

| Event | When | Racing effect |
|---|---|---|
| `chime-warning` | 1.85 L | The tower strikes the quarter. Telegraph only — no world change. Pit radio line; the HUD clock hand advances. This is the driver's cue to choose a line for the turn. |
| `strike` | 2.05 L | The turn begins. A 12 s interpolation, driven by the course (see §5), takes lighting, fog, sky and water from day to night. |
| `fish-rise` | `strikeTick + 4*120` | Goldfish rise out of the basin and begin drifting. |
| `night-settled` | `strikeTick + 12*120` | Interpolation complete; state is fully night for the rest of the race. |

On the default 3-lap race that puts the strike just after the lap-2/lap-3 boundary, so **the final lap is the night lap** and the warning lands late in lap 2.

Grip is a pure function of `(sector, tick, lap)` exactly as `ascension-schedule.js:29-35` is, and reaches the craft **only** through `course.surfaceGripAt()` — never write `this.surfaceGrip` directly.

| Sector | Condition | Grip |
|---|---|---|
| `BASIN` | `tick >= strikeTick` (waterfall spray wets the causeway) | 0.85 |
| all others | — | 1.0 |

These are design values in the range the shipped map uses (Ascension: 0.72 / 0.80 / 0.90) and are yours to tune against feel; report what you settled on.

**Schedule mechanics you must copy exactly, not approximate:**
- Tick derivation: use **Tideline's clamped variant** (tideline-runtime.ts:109-114), not Ascension's — it clamps `delta` to `[0, .25]` and floors the remainder at zero. Ascension's is safe today only because `game.ts` only ever passes `FIXED_STEP`.
- Event emission is a half-open window on the tick delta: `if (event.tick > before && event.tick <= this.tick)`. **An event at tick 0 can never fire — do not author one.** `restore()` also filters `e.tick > 0`, so a tick-0 event makes every later restore throw.
- Derived booleans are **rebuilt from absolute tick every call**, never toggled, so any tick jump lands in the right state.
- `advanceTicks(0, lap)` must be legal (the 240 Hz path calls it every other frame). Reject non-integer or negative ticks by throwing.
- `events` in the JSON must be **sorted**; `restore()` rebuilds `sequence` from array index, so an unsorted array breaks restore silently while playback still looks fine.
- `schedule.json` must carry provenance: `{script, measurementScript, measurement, worksLapSeconds, definition, <named ticks>, events:[{id,tick}]}`.
- Determinism test, copy the shape of `validate-ascension-runtime.mjs:7-13`: for `hz` in `[60,120,240]`, run `hz*120` frames, snapshot, `assert.deepEqual` all three, and **record the sample reconciliation** (`renderRates`, `windowSeconds`, `expectedTicks`, `ticks[]`) beside the result.

**Known limitation to state plainly, not paper over:** snapshot/restore is never wired into gameplay — pause, resume and the save system do not snapshot the schedule. `restore` has exactly one caller, the validator. It exists to make determinism *provable*, not to make pause deterministic. Do not claim otherwise in your report.

## 5. The day→night turn (the hard part)

This is the map's central mechanic and the highest-risk work in the brief. Four things change together over 12 s, and **the course owns the interpolation**.

Implement a single normalised `nightBlend` in the course: `clamp((tick - strikeTick) / (12*120), 0, 1)`, smoothstepped. Then:

1. **Lighting and fog.** `lightingAt(progress)` and `fogAt(progress)` return `lerp(dayProfile, nightProfile, nightBlend)` — a blended profile, every frame. Do not flip between two frozen constants.
2. **Sky.** Two 4096×1024 panoramas, day and night, cross-faded. **This is unprecedented in the codebase**: both existing sky shaders carry exactly one `sampler2D`, and how to blend two is an open design call with no code to copy. Recommended shape: one shader, two samplers, one `mix` uniform driven by `nightBlend` — one dome, one draw, no opacity ramp between two domes (which would double the sky cost and cross-fade through the fog term twice). Follow the Ascension panorama contract otherwise: `SphereGeometry(560, 40, 20)`, BackSide, `depthWrite:false`, `depthTest:false`, `renderOrder = -990`, `frustumCulled = false`, position copied to the camera each frame, and an edge-blend across a narrow azimuth band so a non-tiling panorama closes.
3. **Water.** Foam line and shallows go from lit-from-above to lit-from-within. This is an emissive term on a lit material — **never** `toneMapped:false`.
4. **Fish.** Spawn at `fish-rise`, drift on authored paths.

**Two traps specific to the night state:**
- **The cloud band can only ADD light** — `color += min(add, max(hazeColor - color, 0))` (atmosphere.ts:557) is a line pinned by `validate-lighting.mjs`. A night sky whose clouds are meant to be *darker* than the sky behind them cannot be built on this shader. Author the night sky as a clear starfield, or change that line deliberately and re-pin the validator.
- **Shadows do not get cheaper at night.** `castShadow` is armed once in `installLighting` (atmosphere.ts:341) and nothing ever re-arms it, so a night state with `keyIntensity ≈ 0` still pays a full 2048 PCF pass over a 140 m box every frame *and* draws shadows from an almost-black key. Decide explicitly what the key light does at night and measure the shadow draw count in both states.

### The instrument you must build before you can accept any of this

**No script in this repo measures a sky or lighting crossfade.** `sky-profile.py` hard-asserts one 4096×1024 still; `turntable-profile.py` and `check-sky-frames.py` each score 24 frames at **one** schedule tick. Two panoramas that each pass the 2× luma-range gate independently prove **nothing** about the 50% blend, which is exactly where a mismatched pair goes muddy.

Therefore: **there is no defensible numeric target for the midpoint yet, and this brief refuses to invent one.** Before you tune anything, build `scripts/visual/dreamisland/crossfade-profile.mjs` + `.py` that captures the same frame at `nightBlend` = 0, 0.25, 0.5, 0.75, 1.0 on a frozen pose and reports per-column luma and warmth for each. **Measure the base first, then set the target as a delta against it**, and name the script in the report. A target written before that capture exists is an invented number, and this project treats that as a review-blocking defect.

Both panoramas individually must still pass the existing still-image gate: 4096×1024, `warm_step <= .05`, luma `ratio <= 2` over rows `0 .. 0.75h`.

## 6. Powers and handling

Sixth ability config module, `src/game/dreamisland-powers-config.js`, modelled on `ascension-powers-config.js:7-16`. `validConfig` (polarity-simulation.js:223-249) throws at construction on any violation, so get it right first time.

- `id: "dream-island-powers-v1"` (must match `/^[a-z0-9-]{1,80}$/`), `allowGravity: false`, therefore `transferWindows` must be **empty**.
- **Pickups** (`{id, progress, lane:0, lateral, kind, alternateKind?, charge}`): 5, spread one per district except POINT and BASIN. Collect radius is `|lateral - pickup.lateral| <= 3.2 m`. Ascension ships 4, Tideline 7, Polarity 10.
- **Launch strips** (`launchZones:[{id, from, to, lane}]`, progress fractions): 2 — one on BEACH, one on REEF. Width `.02` as Ascension uses. Surge fired inside one gets +1 s.
- **Phase bulkhead** (`FIELDS:[{id, progress, lateral, halfWidth}]`, and `fieldIds` **must** be `FIELDS.map(f => f.id)` or snapshot validation fails): 1, at the watchtower tunnel mouth, `halfWidth 3.8`.
- Surge 3 s base scaled `3*(.8+.2*charge)`, +1 s on a strip. Shield 5 s, perfect-absorb window 144 ticks. E is the only ability key.
- The power-kit GLB must contain nodes `PK_surge` and `PK_shield` with their named children or `PowerKit`'s constructor throws.

**Rival pace.** `src/game/data/dreamisland/rival-pace.json`. Top-level constants are identical on all four modern maps — `cornerSpeedGain 0.25, cornerSpeedFloor 0.72, noBlockSide -1, driftCurvature 0.55, straightCurvature 0.13`. Profile order is always privateer, nightform, needle. **Cruise speeds must be solved, not typed:** follow `scripts/solve-ascension-pace.mjs` — bisect `cruiseSpeedMetersPerSecond` over `[75,115]` for 18 iterations against `simulateRivalField` with `totalLaps:3`, tier shifts rookie +4 s / works 0 / feral −4 s, per-profile offsets `[-1,+1,+3]` s against the measured player lap total. Write the JSON **and** an evidence file.

**Modes.** `race` and `timeattack` take `defaultLapCount 3` and honour `?laps=` clamped to `[1, 9]`; `sprint` is hard-pinned at 2 laps and reverses the grid. `timeattack` has no rival field, so the map must be raceable solo with a ghost.

## 7. Art

Kit: `art/references/dreamisland/` — 8 day/night hero frames, 3 day↔night pair frames, and 7 sheets including **two orthographic model sheets you can build directly from** (`s5_clock_tower_ortho.png`, `s6_watchtower_ortho.png`, each front/side/back/top at one scale; the watchtower's through-tunnel is drawn in both front and back elevations). Read that folder's README for the per-image verdicts and the prompt rules — several images carry named drifts (the craft is wrong in every frame; ignore it).

**Six painted atlases**, always these roles in this order: `concrete, metal, jungle, water, signage, emissive`. Five are embedded material draws on the GLB; `water` is sampled by the water shader. Pick **one** resolution and state it — Tideline ships six at 1024², Ascension five at 1254² with emissive at 1024² (1254 is not a power of two and nothing in the repo explains it; do not inherit that mismatch by accident). No normal/roughness/metallic/AO maps, no bloom.

For Dream Island the `jungle` role carries the foliage cards and the `water` sheet does more work than on any previous map. Rename nothing — the six role names are load-bearing in the manifests.

**Focal assets**, each with **exactly 5 named silhouette features** recorded in the world JSON's `features` map (the review checks them one by one, as `public/assets/ascension/painted.json` does for its 14 assets):

clock tower · watchtower ruin with through-tunnel · waterfall + stone block cliff · palm (3 trunk bends) · understory card set · goldfish card set (4 liveries) · stone causeway module · reef pier module · sea stack · mossy block wall module · kerb/launch-strip furniture.

**Maquettes: none.** The two orthographic sheets are better modelling reference than a normalised Tripo lift, and the concept doc's 18-credit maquette line is superseded. If you do lift one, record `source sha256, sourceDimensions, targetHeight, uniformScale, removedObjectNames` and assert `maquettesRemovedBeforeWorldExport: true` — maquettes never ship.

**Name target metres for every asset before modelling.** Tideline's gantry drifted in scale and depth and had to be calibrated to explicit metres (46 m wide, 20 m high, 8 m deep; hero silhouette 23.7 m). A brief that says "model from the sheet" without target metres inherits that drift. Start from: clock tower **14 m**, watchtower **30 m tall / 28 m across at the base tapering to 20 m** with an arched tunnel bore **14 m wide × 8 m high** through the full depth (the road is 14 m wide there — §9 decision 5, revised), waterfall drop **16 m**, palms 7–11 m.

**Signage.** Environmental letters cap at **0.59 m**; instructions live in the HUD, not the world. Only a gameplay clock may exceed it and it must be flagged `gameplaySizeException: true`. A signage manifest listing every sign individually (progress, side, tile, position, sector, measured clearance) is mandatory.

**`generation.json` is mandatory** and must record, per job: model, job_id, output_id, the **full prompt verbatim**, and a review verdict. Budget a correction round per material-ID sheet — Ascension's shipped kit needed them.

**Do not add Dream Island cells to `ATLAS_REGIONS.json`.** That file serves Greenwater, Bitterpan and Totem only (10 atlases, 143 cells); neither Tideline nor Ascension uses it. They use the six-role painted atlases with UV rects in per-asset manifests. Use that system.

**Living-world cards do not exist for maps 03–06.** `LIVING_WORLD_SPECS` has exactly two keys. If the drifting fish or the foliage want that system, it is a **new spec plus a new validator budget**, not a reuse — and zones are authored off one seeded stream in declaration order, so appending is safe and reordering breaks every pinned digest.

## 8. Budgets

| Axis | Ceiling | Source | Headroom reality |
|---|---|---|---|
| Draw calls | **145 total per frame, shadow pass included** | PERFORMANCE_BASELINE.md:688 | Effectively full. Tideline's shipped final race is **143 of 145**. `renderer.info.render.calls` **excludes** shadows — probe them separately via `Object3D.onBeforeShadow`. |
| Triangles | **220,000** | PERFORMANCE_BASELINE.md:426 | Applied inconsistently: main-pass-only on Ascension, main+shadow on Tideline. **State which rule you adopt.** Under Tideline's rule, Ascension's trench would be 17,432 over. |
| p95 frame time | 11.0 ms | ROADMAP.md:529 | Real room — every measured map runs 8.4–9.6 ms. **Nothing enforces it**; it is reported, never gated. |
| Initial JS gzip | 266 KiB | validate-build.mjs:277 | **2.2 KiB** left (measured 263.8). |
| App shell gzip | 277 KiB | validate-build.mjs:330 | **1.5 KiB** left (measured 275.5). |

The byte headroom is the binding constraint and it is nearly gone. **Every Dream Island course/runtime/world/sky/environment chunk must stay lazy** — `validate-build.mjs:46-48` fails the build outright if a circuit-specific chunk lands in the initial bundle. Note that `route.json` is a static import into the TS bundle; Ascension's is 220 KB raw and Polarity's 231 KB, so an 800-station Dream Island route lands in the same class and its gzip contribution must be measured, not assumed.

**Phase A gate, derived from the repo's own 2× rule** (`validate-ascension-evidence.mjs:15` asserts `peakTotalCalls*2 <= 145` and `(peakTriangles+peakShadowTriangles)*2 <= 220000`): the blockout must measure **≤ 72 total draws** and **≤ 110,000 total triangles**, leaving the art phases room to double the scene. Then declare a per-phase delta table with a running total and a named reserve at completion, as `ROADMAP.md:515-529` does.

## 8b. Scars — defects found, and what was done about them

Added as they are found, with the command that measures each one. A scar that is
LEFT ALONE says so and says why; a scar with no measurement beside it is a
rumour.

| Scar | Measured by | Verdict |
|---|---|---|
| **`sample().sector` lags `sectorLabelAt()` by one station.** `sample()` reads `route.stations[floor(progress * count)].sector`; `sectorLabelAt()` reads the district table by `progress >= district.from`. At station 227 (progress 0.28375) `euclideanModulo(227/800, 1) * 800` is 226.99999999999997, which floors to 226, so the sample carries GROVE for one 3 m station while the HUD already says POINT. **1 of 800 stations.** | `node scripts/visual/dreamisland/label-lag.mjs` | **LEAVE.** Pre-existing and identical in shape in `tideline-course.ts` and `ascension-course.ts`; fixing it here would put this map's sampling out of step with both. Nothing on this map turns on it: grip differs only in BASIN and this seam is GROVE into POINT, so the script's own `gameplayAffected` reads false. |
| **The reef's left-hand water bands never drew.** `ribbon()` pushes the same index order for a band on either side of the road, so a band whose `outer` is more negative than its `inner` came out wound backwards, with downward normals, and was backface-culled by a `FrontSide` material. The shallows carried 78 down-facing vertices of 233 and the foam 78 of 208 — exactly the two negative-lateral reef ribbons — and an isolation frame at the REEF pose had **0 lit pixels in the left half of the screen**. Half of the night state's edge cue was missing from every frame phase B shot. | `node scripts/visual/dreamisland/crossfade-profile.mjs --blends=1 --progress=0.72` then `crossfade-profile.py`; before/after in `art/evidence/dreamisland-v1/phase-c/pier-edge/` | **FIXED** in phase C (`dreamisland-water.ts`): the winding is reversed when `outer < inner`. Glow pixels 45,135 → 90,041; left half 0 → 59,697. |
| **The beach foam rail was underneath the sea.** The sea is one 7,200 m plane at `y = -0.8` and depth testing does not care about `renderOrder`, so the beach shallows at `-1.2` and the beach foam at `-1.1` were drawn and then covered. Section 2 calls that foam line the start straight's night cue, and it measured **0 glow pixels at all five crossfade blends** at the BEACH pose. | the same instrument at `--progress=0.05` | **FIXED** in phase C: the beach bands moved to `-0.55` and `-0.5`, the reef's own values, which are above the sea. 0 → 24,125 glow pixels; night contrast against the black sea 0.412. |
| **A 14 m bore cannot contain a 14 m road through 28.5 m of a 137 m radius curve.** Decision 5's revision made the drum 28 m across, which made the bore 28.5 m deep; over that depth the road's two edges sweep an envelope **14.778 m** wide. No placement in POINT fixes it — the flattest station in the district still misses by 0.112 m, because the bore and the road are the same width to begin with. | `scripts/validate-dreamisland-painted.mjs` section 4b, which reports `sweptEdgeWidthMetres` and `lateralClearanceMetres` | **DEVIATION, FLAGGED.** The hero is placed at scale **1.10** with a **0.38 m** lateral offset, leaving 0.302 m of measured clearance. The asset is unmodified and decision 5's "the opening may take no more than half the footprint" still holds. Needs an orchestrator or user ruling. |
| **A vertical ray cannot see a road buried in a wall.** The corridor check casts upward rays; inside solid masonry there is no floor and no ceiling, so the ray exits its 7.4 m probe having hit nothing. Verified rather than assumed: the hero drum moved 2.6 m sideways over the road still produced **zero** ray hits. | same | **FIXED** by adding the lateral containment assertion (section 4b) beside the ray sweep. The ray sweep is kept; it catches what containment cannot. |

## 9. Decisions — settled 2026-09-09 (user delegated all eight to the orchestrator)

These are final for v1. Do not reopen them in an implementation report; if one proves unbuildable, say so with evidence and stop.

1. **Name: "Dream Island".** `CourseKind` / map code / `TRACK_CODES` token: `dreamisland`. `mapCode` for UI: `DI`. Finish name: `THE STRIKE LINE`. Start label: `BEACH STRAIGHT`.
2. **Day→night is a scheduled event** on the integer-tick scheduler (§4–5). No `?edition=` switch.
3. **Fish are pure ambience in v1.** No collision, no telegraph. Authored drift paths stay at least **6 m above the deck** wherever they cross the road, so they never read as an obstacle at speed. **Ruling 2026-09-10:** measured minimum clearance 8.442 m (two independent implementations) is accepted; the 8.85 m figure is the static-geometry corridor rule and does not apply to ambience — 6 m stays the fish floor, asserted in the runtime validator. The night state's racing purpose is the readability trade in §2, not the fish.
4. **No fork in v1.** Single road, 8 gates as tabled.
5. **WATCHTOWER POINT narrows to 14 m** (table in §3 updated). The bore is **14 m wide × 8 m high, arched, through the full depth**. **Revised 2026-09-10 after the first hero build:** a 14 m bore through a 16 m drum leaves 1 m of wall and the tower reads as a slab on two legs, not a tower with a tunnel. The drum is therefore **28 m across at the base tapering to 20 m at the crown, 30 m tall**, so the arch keeps ≥ 7 m of solid drum on each flank and a ≥ 6 m lintel above the crown of the arch; the `s6` sheet's proportions apply to the *upper* drum. Rule for any future bore: the opening may take no more than **half** the footprint width. The pinch *is* the corner. **Ruling 2026-09-10 (phase C):** the road's two edges sweep a **14.778 m** envelope through the 28.5 m-deep drum on POINT's 137 m curve, so a 14 m bore cannot contain a 14 m road anywhere in the district — the spec was unsatisfiable as written. Accepted: the hero placed at **uniform scale 1.10 with a 0.38 m lateral offset** (30.8 m drum, 15.4 m bore, 0.302 m measured lateral clearance; the half-footprint rule still holds). The bore-containment assertion in `validate-dreamisland-painted.mjs` pins it. Lesson for briefs: an opening's width must be specified against the road's *swept* envelope over the opening's depth, not the road's nominal width.
6. **`?motion=reduce`:** the night state still happens (it is gameplay and it changes grip), but `nightBlend` jumps `0 → 1` **at `strikeTick`** with no 12 s ramp, fish do not spawn, and no flicker/shimmer effects run. Grip therefore changes at the same tick in both modes — determinism across modes holds.
7. **`validate:dreamisland` and `validate:dreamisland-runtime` go into `test:code`.** They must be read-only, `mkdirSync` any evidence dir they write, use the `new URL('../…', import.meta.url)` idiom, and fail by throwing (not `process.exitCode`).
8. **Product rule reading adopted:** the racing surface is the machinery — concrete kerbs, launch strips, the pier, the causeway — and the clock is a machine. Foliage and water are the "humid organic space". Record this reading in `PRODUCT.md` in phase B, not before.

## 10. Phases, acceptance criteria and verification

Each phase closes only on the named command or artifact. "Tests pass", "looks good" and "matches the brief" are not evidence.

**A. Route, schedule, blockout.**
Deliver `scripts/build-dreamisland-route.mjs` → `src/game/data/dreamisland/route.json`; `dreamisland-course.ts` implementing `RaceCourse`; `dreamisland-schedule.js` + `schedule.json` from a real calibration run; registration in `map-selection.ts` TRACKS, `main.ts`'s import chain, `save-schema.js` TRACK_CODES, `sky-profile.js` (×3), `race-presentation-setup.ts`, `scene-assets.ts`, `circuit-runtime.ts`, `ui.ts`; `validate:dreamisland` and `validate:dreamisland-runtime`.
*Accept when:* every station gap is `2.8 < g < 3.05` including the closing seam; summed gaps equal `length` within 1.0 m; every tangent unit to 1e-6; every value finite; `|curvature|*width/2 < 0.8`; max pitch `< 10.5°`; 8 ascending checkpoints with `checkpoints[0] === 0`; a 3-lap demo completes with **0 missed gates**; the determinism test passes at 60/120/240 Hz with its sample reconciliation printed; and the blockout measures **≤ 72 total draws / ≤ 110,000 total triangles**.
*Verified by:* `node scripts/validate-dreamisland.mjs && node scripts/validate-dreamisland-runtime.mjs` from the repo root (validators use bare relative paths and throw ENOENT elsewhere), plus a headless 3-lap soak at `http://127.0.0.1:5200/?map=dreamisland&demo=1&headless=1&diagnostics=1&start=manual&seed=3868938316`. **`?autostart=1` does not exist** — `demo=1` autostarts unless `diagnostics` *and* `start=manual` are both present. Any harness copied from `shoot-stations.mjs`'s comment will mis-time its first capture.

**B. Art.**
*Accept when:* every focal asset has its 5 named silhouette features present and individually checkable in a rendered frame; every asset was modelled to a stated target in metres; the signage manifest lists every sign with measured clearance and no environmental letter exceeds 0.59 m; `generation.json` records model, job_id, output_id, verbatim prompt and verdict per job; both panoramas pass the still gate at 4096×1024, warm_step ≤ .05, ratio ≤ 2.
*Verified by:* a rendered-pixel check per consumer — **not** a soak. A green soak proves no regression, never that the art loaded: decoration is non-interactive, so lap times and p95 are identical before and after integration. Add a diagnostics counter per new module that reads zero when the module silently no-ops.

**C. The night turn and effects.**
*Accept when:* the crossfade instrument from §5 exists and its five-point capture is committed as evidence; the midpoint target is stated **as a delta against a base measured before the target was written**, with the producing script named; no material anywhere in the scene has `toneMapped === false` or `fog === false` except the sky dome, exempted by name; shadow draw counts are reported for **both** lighting states; `?motion=reduce` behaves as decision 6 settles.
*Verified by:* the material walk (copy `scripts/visual/ascension/race.mjs:34-35`, traversing hidden objects too, and add the Dream Island panorama to its exemption list — a ShaderMaterial sky has `fog === false` by three's default and reads as a violation otherwise), plus the crossfade capture, plus a user eyeball on the five-point strip. **A visual change closes on a rendered-pixel check or a user eyeball, never on tests passing.**

**D. Pace and modes.** Rival pace solved and written with its evidence file; race / sprint / timeattack all complete; ghost works solo.

---

### Numbers this brief deliberately does not pin

Because no measurement exists for them yet, and a pinned number without a naming measurement is a review-blocking defect in this project:

- The lap time L, and therefore every schedule tick — produced by the calibration run.
- Rival cruise speeds — produced by the pace solver.
- The crossfade midpoint luma/warmth target — requires the §5 instrument and a base capture that does not exist.
- Day and night fog densities — derive them from a braking-point readability check against the measured day baseline; do not type a ratio.
- Per-asset triangle budgets — **no shipped precedent exists.** Only aggregates are recorded (Ascension 194,748 across 538 meshes; Tideline 74,554). Express the budget as an aggregate or compute per-asset counts from the GLBs first.
