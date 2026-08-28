I have enough grounding. Here is the roadmap.

---

# FUTURISMA — Next-Level Implementation Roadmap

## 0. Ground truth corrections to the brief (verify-first findings)

These change the plan, so read them before the phases.

| Brief claim | Verified reality | Consequence |
|---|---|---|
| "npm test broken (validate:assets expects absent archives)" | **All 19 validators pass right now in the main checkout.** But every archive they read is **untracked**: `git ls-files` shows only 4 of 12 `artifacts/*.zip` tracked, and `scripts/validate-assets.mjs:352` reads `../GREENWATER_SURFACE_CHARACTER_v1.4_REVIEW.zip` from the **repo root**, which is untracked. | **`npm test` will fail on the first command inside every `git worktree`.** This is the single hard blocker for the whole superpowers methodology. P0 must fix it or no phase can self-verify. |
| "Rivals have no engine glow" | `rivals.ts:192-224` already builds a 3-instance `engine_glow` InstancedMesh from the FX atlas. | Drop "add engine glow" — replace with "modulate existing glow by rival throttle state". |
| "Perf headroom vs 92 calls / 43k tris" | Table at top of `docs/PERFORMANCE_BASELINE.md` is stale. The **latest** recorded soak is **85 peak calls / 66,308 visible triangles** (baseline doc line 533); rivals alone are **6 calls / 18,351 tris**. | Real headroom: **35 calls / 153,692 tris**, not "4× geometry". Budget below uses 66,308 as the floor. |
| "No persistence" | True — and `scripts/validate-security.mjs:76` **actively bans** `localStorage`/`sessionStorage` anywhere under `src/` as a hard assertion. | Persistence is a **deliberate security-invariant amendment**, not an additive feature. Needs its own task + rationale, not a drive-by. |
| "Edge types A/B = ~70% invisible wall" | Confirmed precisely: 1258 samples → `A/A` 689, `B/B` 115, `B/A` 82 = **886 = 70.4%** closed. Per-sector map computed below. | The apron phase can be authored per-sector with exact distance ranges instead of a blanket rule. |
| "game.ts touched by everything" | 2789 lines, **one class**, ~60 methods. `reportDiagnostics` (game.ts:2366-2631) is a **265-line literal that every single track needs to extend**. | Splitting `reportDiagnostics` into subsystem contributors is the highest-value merge-conflict reduction available, and it is cheap. |

### Verified Greenwater edge map (input for Phase 1)

```
SECTOR              n     distance      width   left      right
RUNWAY_START        111   0-220m        22-24   A         A
T1_CRADLE_BEND      78    222-376m      22      A         A
WATER_TABLE         105   378-586m      21-22   A         A
LINK_APRON          15    588-616m      19.6-20 B         B
HANGAR_SIX          100   618-816m      19-19.6 B         B
HANGAR_EXIT         15    818-846m      19.2-22 B         A
GREENWATER_SWEEP    141   848-1128m     24      A         C
CANOPY_PASSAGE      176   1130-1480m    19-23.9 C         C
THE_ELBOW           55    1482-1590m    20-24   A         C
FUEL_ROW            265   1592-2120m    23-24   A         A
T10_TOTEM_TURN      67    2122-2254m    22      B         A
RUNWAY_HOME         130   2256-2514m    22-24   A         A
```

Key reading: `LINK_APRON` + `HANGAR_SIX` B-walls (588-816m) are **diegetically correct** — that is an interior hangar. Do not apron them. The offenders are the **A** edges: 885 left / 771 right occurrences across 9 sectors.

---

## 1. Pre-work: the seam plan (why P0.5 is non-negotiable)

**Collision map — which track touches which region of `src/game/game.ts`:**

| Region | Lines | P1 apron | P2 rivals | P3 audio | P4 light | P5 drift | P6 minimap | P7 meta | P8 bitterpan | P9 living | P10 ghost |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| constructor | 466-549 | | | | ● | | | ● | | | |
| initialize | 550-619 | | ● | | | | | ● | ● | ● | ● |
| frame | 646-688 | | | | | | | ● | | | ● |
| readDemoInput | 689-777 | ● | | | | ● | | | | | |
| update | 778-865 | | | ● | | | ● | | | ● | ● |
| updateRace | 948-1187 | ●● | | | | ●● | | | | | ●● |
| updateCamera | 1372-1495 | | | | | | | ● | | | |
| updateHud | 1559-1636 | ● | | | | ● | ●● | | | | |
| resetRaceState | 1718-1812 | | ● | | | ● | | ● | | | ● |
| installLighting/sky | 1813-1886 | | | | ●● | | | | ● | | |
| effects | 1887-2028 | ● | ● | | | ● | | | | | |
| loaders | 2029-2169 | | | | | | | | ●● | ● | |
| updateFog | 2170-2228 | | | | ●● | | | | ● | | |
| **reportDiagnostics** | **2366-2631** | **●** | **●** | **●** | **●** | **●** | **●** | **●** | **●** | **●** | **●** |

`reportDiagnostics` is a 10-way collision. Everything else is at most 3-way.

**P0.5 fixes this structurally**, not by discipline: `reportDiagnostics` becomes a core-report builder that spreads `subsystem.diagnostics()` results. Two subsystems (`audio.diagnostics()` at audio.ts:405+, `rivalFleet.diagnostics()` at rivals.ts:491) **already have this shape** — the pattern exists, it just isn't applied to environment/livingWorld/surfaceCharacter/course/render fields. After P0.5, a phase that adds telemetry edits **its own file**, and the 10-way collision drops to zero.

---

## 2. Phase table

| # | Phase | Effort | Depends on | Wave |
|---|---|:-:|---|:-:|
| P0 | Worktree-safe test gate & repo hygiene | S | — | 0 |
| P0.5 | Seams: diagnostics contributors + subsystem extraction | M | P0 | 0 |
| P1 | Authored apron — boundary removal | L | P0.5 | A |
| P2 | Rival aliveness | L | P0.5 | A |
| P6 | Minimap / radar | S | P0.5 | A |
| P3 | Spatial + zoned audio | M | P2 | B |
| P4a | Lighting motion | M | P0.5 | B |
| P5 | Drift as a mechanic + energy tradeoff | M | P1 | B (serialized after P1) |
| P4b | PS2 rendering commit (**taste gate**) | M | P4a | C |
| P7 | Meta layer (select / options / persistence) | L | P4b, P5, P6 | C |
| P8 | Bitterpan production pass | L | P1, P3, P4a | C |
| P9 | Living-world expansion | M | P8 | D |
| P10 | Ghost lap (**stretch**) | M | P7 | D |

### Parallel-worktree rules

1. **Max 3 concurrent worktrees.** Beyond that, rebase churn costs more than it saves.
2. **Hard mutex on `updateRace` (game.ts:948-1187):** P1, P5, P10 must never run concurrently. They are serialized: P1 → P5 → P10.
3. **Hard mutex on `ui.ts` + `index.html` + `style.css`:** P6 and P7 must not run concurrently. P6 first (it defines the HUD overlay slot P7's options panel reuses).
4. **Hard mutex on `audio.ts`:** P3 owns it exclusively. P2 must **not** add rival audio — it only exposes `rivalFleet.worldPositions()`; P3 consumes it.
5. Every worktree **rebases onto `main` immediately before its review stage**, then re-runs its own acceptance scenario. A phase that cannot rebase cleanly is a planning failure, not an implementer failure — escalate.
6. **Waves:** A = {P1, P2, P6}; B = {P3, P4a} then P5; C = {P4b, P8} then P7; D = {P9, P10}.

---

## 3. Per-phase detail

---

### P0 — Worktree-safe test gate & repo hygiene · **S**

**Goal:** `npm run test:code` passes in a fresh `git worktree` with zero untracked archives present. Asset provenance keeps its teeth but stops gating every feature branch.

**Tasks (one subagent session each):**

1. **Split the test script** (`package.json:9-33`). Add:
   - `test:code` = the 16 archive-independent validators (`race-presence`, `map`, `map02`, `package-boundary`, `physics`, `race`, `rivals`, `control`, `audio`, `camera`, `presentation`, `graphics`, `frames`, `render`, `security`, `build`) + `npm run build`.
   - `test:archives` = `validate:assets` + `validate:environment:history` + `validate:environment:accepted`.
   - `test` = `test:code && test:archives` (unchanged behaviour in the main checkout).
   - Every phase gate uses **`test:code`**. `test:archives` runs only when art lands.
2. **Resolve archives from a configurable root.** Add `scripts/lib/archive-root.mjs` exporting a resolver that reads `FUTURISMA_ARCHIVE_ROOT` (default: repo root). Rewrite `scripts/validate-assets.mjs:352` and the `artifacts/` URLs (lines 68, 77, 149, 424, 630, 657, 765) to go through it, and **skip with a printed WARN + exit 0 when the root is absent**, fail hard when the root exists but a file inside it is wrong. This makes `test:archives` runnable from a worktree by pointing at the main checkout.
3. **Move root zips into `artifacts/`.** Physically relocate the 8 root-level `FUTURISMA_MAP_02_*` / `GREENWATER_*` zips + 2 extensionless files (~205 MB) into `artifacts/` and extend `.gitignore` with `artifacts/*.zip` + `!artifacts/TOTEM_Phase1_*.zip` + `!artifacts/GREENWATER_MAP01_v1.0.zip` + `!artifacts/GREENWATER_ENVIRONMENT_PRODUCTION_INPUT_v1.0.zip` (keep the 4 already tracked). Update the resolver default.
4. **De-brittle asset contracts.** `environment.ts:7` (`EXPECTED_RUNTIME_MESHES = 60`), `environment.ts:11-12` (`EXPECTED_RELOCATED_HANGAR_COMPONENTS = 76`, `..._VERTICES = 2400`), and `bitterpan-environment.ts:190` (`!== EXPECTED_VISIBLE_TRIANGLES`) currently **`throw` at runtime**, i.e. a re-exported GLB black-screens the game. Convert all four to `console.warn` + a `stats.contractDrift: string[]` field surfaced in diagnostics. Move the *hard* assertion into `scripts/validate-assets.mjs` where it belongs (build-time, not player-time).
5. **Delete dead payloads.** `public/assets/totem/models/totem_master.glb` (669 KB, never fetched by any `src/` file — verify with grep first) and `public/assets/totem/textures/totem_decals_1024_base.png` + `..._works.png` if unreferenced. Remove their entries from `scripts/validate-assets.mjs:14-27` `expectedHashes` and from `public/assets/totem/MANIFEST.json`.

**Files touched:** `package.json`, `scripts/validate-assets.mjs`, `scripts/lib/archive-root.mjs` (new), `.gitignore`, `src/game/environment.ts:7-12,+stats`, `src/game/bitterpan-environment.ts:185-200`, `public/assets/totem/MANIFEST.json`, `README.md` (Verification section, README.md:144-185).

**NON-GOALS:** No gameplay change. No renderer change. No `git filter-repo` on the 588 MB `.git` — history rewrite is out of scope and would invalidate every reviewer's clone.

**Acceptance criteria (all automatable):**
- `git worktree add ../fut-p0-verify && cd ../fut-p0-verify && npm ci && npm run test:code` exits **0**.
- `npm run test` in the main checkout still exits 0 with all 19 validators reporting PASS.
- `FUTURISMA_ARCHIVE_ROOT=/Users/gentlegen/Desktop/Projects/futurisma-race npm run test:archives` from the worktree exits 0.
- `npm run test:archives` with the root unset prints `ARCHIVES SKIPPED` and exits 0.
- Repo root contains **0** `*.zip` files.
- `du -sh` of the working tree (excluding `.git`, `node_modules`) drops by ≥ 200 MB.
- Corrupting `EXPECTED_RUNTIME_MESHES` to `61` and loading `?demo=1&diagnostics=1` → game **still runs**, diagnostics reports `environmentContractDrift: ["meshes 60 != 61"]`, and `npm run test:archives` **fails**.

**Reviewer command:** `git worktree add /tmp/fut-verify main && cd /tmp/fut-verify && npm ci && npm run test:code` — this is the gate every subsequent phase inherits.

---

### P0.5 — Seams · **M**

**Goal:** cut `game.ts` from 2789 → ~1900 lines along the seams the roadmap will repeatedly cross, so ten phases stop fighting over one file.

**Tasks:**

1. **`src/game/diagnostics.ts` (new).** Move `reportDiagnostics` (game.ts:2366-2631) + `resetDiagnosticsPeak` (game.ts:2632-2686). Signature: `buildDiagnosticsReport(core, contributors)` where `contributors` is `{ audio, rivals, environment, livingWorld, surfaceCharacter, course, render }` and each contributes a **flat object it owns**. Preserve the exact current JSON key set and the `[FUTURISMA_DIAGNOSTICS]` console line byte-for-byte.
2. **`src/game/atmosphere.ts` (new).** Move `installLighting` (1813), `createSkyBackdrop` (1832), `createSunDisc` (1871), `updateFog` (2170). Owns `hemisphereLight`, `keyLight`, `rimLight`, `presenceLight`, `skyDome`, `sunDisc`, `skyUniforms`. This is P4's entire workspace.
3. **`src/game/effects.ts` (new).** Move `createSpeedLines` (1887), `updateSpeedLines` (1517), `createImpactSparks` (1917), `emitImpactSparks` (1942), `updateImpactSparks` (1986), `resetImpactSparks` (2014) + the three `impactSpark*` Float32Arrays (268-270).
4. **`src/game/scene-assets.ts` (new).** Move `loadAuthoredEnvironment` (2029), `loadLivingWorld` (2089), `loadSurfaceCharacter` (2116), `loadAssetKit` (2141) and the module-scope helpers `mergeStaticSceneByMaterial` (110), `placeCourseAlignedObject` (155), `createNormalizedPropInstance` (174), `createAssetKitCourseDressing` (193). This is P8's workspace.
5. **`src/game/autopilot.ts` (new).** Move `readDemoInput` (689-777) + `demoProjection`/`demoLookAhead`/`demoTurnCue`. Ghost replay (P10) will slot in beside it.

**Files touched:** `src/game/game.ts` (net −890 lines), 5 new modules, `scripts/validate-package-boundary.mjs` (extend its module graph rules).

**NON-GOALS:** **Zero behaviour change.** No renaming of diagnostics keys. No new fields. No perf work. Do not touch `updateRace`, `updateCamera`, `physics.js`, `course.ts`, `rivals.ts`, `audio.ts`.

**Acceptance criteria (all automatable):**
- `npm run test:code` exits 0.
- `wc -l src/game/game.ts` ≤ **1950**.
- **Byte-identical diagnostics:** capture the `[FUTURISMA_DIAGNOSTICS]` JSON at the 60-second mark of `?demo=1&diagnostics=1&laps=5&quality=high` before and after; `Object.keys()` sets are **identical** and every non-timing key is identical.
- 5-lap `?demo=1&diagnostics=1&laps=5&quality=high&start=manual` soak reproduces the locked lap sequence **34.500 / 34.442 / 34.517 / 34.683 / 34.683** and total **02:52.825**, each lap within **±0.010 s**.
- `p95FrameMs` ≤ **10.5**, `peak.calls` ≤ **92**, `peak.triangles` ≤ **67,000**.
- New validator `scripts/validate-module-seams.mjs`: asserts `game.ts` no longer imports `THREE.HemisphereLight`/`DirectionalLight`/`PointLight` directly, no longer contains the string `impactSpark`, and that `diagnostics.ts` exports `buildDiagnosticsReport`. Wire into `test:code`.

**Reviewer command:** `npm run test:code`, then browser soak at `http://localhost:5173/?demo=1&diagnostics=1&laps=5&quality=high&start=manual`, click LAUNCH RACE, read `document.getElementById('futurisma-diagnostics').textContent` at `phase: "finished"`, diff `lapTimesMs` against `[34500, 34442, 34517, 34683, 34683]`.

---

### P1 — Authored apron (boundary removal) · **L** · Wave A

**Goal:** delete the invisible wall on all 9 `A`-edge sectors. Leaving the racing line becomes a **cost**, not a **stop**. No terrain system — the apron is a widening of the existing 1D ribbon.

**Design:** extend `CourseSample` with `apronLeft` / `apronRight` (metres) and `apronGripLeft` / `apronGripRight`. `edgeType` stays as-is for the visual/audio treatment; a new `RaceCourse.apronAt(sample, lateral): { width, grip, wall: boolean }` drives the clamp.

Authored values (per edge type, tunable in `greenwater-blockout.json`, **not** hardcoded):

| Edge | Apron width | Grip | Wall beyond? | Rationale |
|---|---:|---:|:-:|---|
| `A` (runway/apron shoulder) | **5.0 m** | **0.68** | yes, soft (0.88× speed) | The 885/771 offenders — biggest win |
| `B` **inside HANGAR_SIX + LINK_APRON** (588-816 m) | **0.0 m** | — | yes, hard (0.60×) | Interior walls are correct; do not apron |
| `B` **elsewhere** (HANGAR_EXIT-L 818-846 m, T10_TOTEM_TURN-L 2122-2254 m) | **2.0 m** rumble | **0.55** | yes, hard | Structure is nearby but a scrub-off is fairer |
| `C` | **5.8 m** (unchanged) | **0.80** (was 1.0) | no, auto-recovery | Grip penalty added for consistency |

**Tasks:**

1. **Course data + API.** Add `apron` block to `src/game/data/greenwater-blockout.json` keyed by edge type; extend `CourseSample` (course.ts:126-139) with the 4 fields; populate in `GreenwaterCourse.sample` (course.ts:740); implement `apronAt` on `RaceCourse` (course.ts:200-247 interface, ~966 impl) and stub it on `BitterpanCourse` (bitterpan-course.ts:444).
2. **Clamp rewrite.** Replace game.ts:1098-1156. `lateralLimit = halfWidth + apron.width`; grip multiplies into `surfaceGripAt` result before `integrateSurfaceGrip` (game.ts ~1030); wall impact only fires when `apron.wall && |lateral| > lateralLimit`. Preserve: `openEdgeWarning`, `offCourseTime` accumulation, `recoveryImmunity`, `hazardTripCooldown`, `diagnosticMaxLateralRatio`.
3. **Apron geometry.** Extend the existing edge-furniture ribbon builder (course.ts:1255-1360, which already walks `edgeL`/`edgeR` per sample and extrudes at `halfWidth ± offset`) to emit an apron deck strip merged **by edge type into 2 materials** (apron-A gravel, apron-B rumble). Reuse `applyPs2MaterialTreatment`.
4. **Feedback.** Grip loss already pulses the gamepad (game.ts:1046-1048) and drops `surfaceGrip`; add an apron-entry HUD flash reusing `ui.flashHazard` (ui.ts) with label `RUN-OFF` and a one-shot via `audio.playImpact(0.25)`.
5. **Autopilot re-baseline.** `readDemoInput` (now `autopilot.ts`) must still hold the racing line. Re-record the reference lap sequence in `docs/PERFORMANCE_BASELINE.md`.

**Files touched:** `src/game/data/greenwater-blockout.json`, `src/game/course.ts:126-139,200-247,740,966,1255-1360`, `src/game/game.ts:1098-1156` (+grip at ~1030), `src/game/bitterpan-course.ts:444-455`, `src/game/ui.ts`, `src/game/autopilot.ts`, `docs/PERFORMANCE_BASELINE.md`.

**NON-GOALS:** **No terrain, no heightfield, no physics-mesh collision.** No change to `HANGAR_SIX`/`LINK_APRON` walls. No change to `recoveryHoldSeconds` or the auto-recovery path (`recoverVehicle`, game.ts:1269). No new hazards. No Bitterpan authoring (P8).

**Perf budget:** **+3 draw calls / +18,000 triangles.** Post-phase target: ≤ 95 calls / ≤ 85,000 tris.

**Acceptance criteria:**

*Automatable:*
- New `scripts/validate-apron.mjs`, wired into `test:code`: loads `greenwater-blockout.json`, asserts every sample resolves an apron entry; asserts `HANGAR_SIX` + `LINK_APRON` samples (d ∈ [588, 816]) resolve `width === 0 && wall === true`; asserts every `A` edge resolves `width === 5.0 && grip === 0.68`; asserts `apronAt` is pure and side-effect free across 10,000 progress/lateral samples.
- New probe `?diagnostics=1&probe=apron`: spawns TOTEM at `progress = 1700/2515.982` (FUEL_ROW, A/A), lateral `+13.5 m` at 60 m/s. Diagnostics must report `minimumSurfaceGrip ≤ 0.70`, `impacts === 0`, `recoveries === 0`, and `maxLateralRatio ≥ 1.35` — i.e. the player drove **onto** the apron without hitting anything.
- Same probe at lateral `+17.5 m` → `impacts === 1` (soft wall at halfWidth+5.0 ≈ 16.5 m).
- Probe at `progress = 700/2515.982` (HANGAR_SIX, B/B) lateral `+11.0 m` → `impacts === 1`, wall preserved.
- 5-lap `?demo=1&diagnostics=1&laps=5&quality=high&start=manual`: `impacts === 0`, `recoveries === 0`, `missedGates === 0`, `p95FrameMs ≤ 11.0`, `peak.calls ≤ 95`, `peak.triangles ≤ 85000`, `heapGrowthMb ≤ 1.0`.
- `npm run test:code` exits 0.

*Taste gate (screenshots required — human sign-off):*
- Screenshot pair at `FUEL_ROW` d≈1700 m and `RUNWAY_HOME` d≈2400 m, on-line vs 4 m onto the apron, at 1280×720 `quality=high`. Question for the human: **does the apron read as authored ground or as a bug?** Fog must still hide the far apron edge — readability-first (PRODUCT.md principle 1) beats width.
- Screenshot at `T10_TOTEM_TURN` d≈2180 m showing the left `B` rumble strip vs the right `A` apron in one frame — the two must be visually distinguishable **without colour alone** (accessibility clause).

**Reviewer command:** `npm run test:code`; then browser: the three `probe=apron` scenarios and the 5-lap soak; then capture the 3 screenshots and present them to the user before merge.

---

### P2 — Rival aliveness · **L** · Wave A

**Goal:** three rivals stop being frozen statues. Articulation + ground contact + throttle-reactive glow, at **net zero** draw-call cost.

**The draw-call trick that makes this affordable:** rivals currently cost 6 calls because `TOTEM_body` is split into 3 `InstancedMesh(count=1)` purely so each rival gets its own 1024² livery texture (`rivals.ts:151-169`). Pack the 3 liveries (`totem_decals_1024_{privateer,nightform,needle}.png`, ~228 KB total) into one **2048×2048 atlas** with a per-instance UV offset attribute → **one `InstancedMesh(count=3)`**. That frees **2 draw calls** which fund articulation and shadow blobs.

**Tasks:**

1. **Livery atlas.** Build `public/assets/totem/textures/totem_liveries_2048.png` (2×2 grid, 4th quadrant = `works` for P7's livery select). Add `aLiveryOffset` instanced attribute + a 3-line `onBeforeCompile` UV remap. Rewrite `rivals.ts:151-190`. Register the new hash in `validate-assets.mjs`; retire the 3 single-livery PNGs from the served set.
2. **Articulated sub-batches.** Change `TotemVehicle.createRivalVisualBatches` (totem.ts:198-266) to merge per `(role × articulation group)` instead of per `role` alone. Groups: `hull` (static), `steering_fins` (`steering_fin_L/R_pivot`), `airbrakes` (`airbrake_L/R_pivot`), `elevons` (`elevon_L/R_pivot`). Emit `TotemRivalVisualBatch { role, group, geometry, material, pivotOrigin, pivotAxis, triangles }`. Rival fleet drives each moving group's `InstancedMesh(count=3)` per-instance matrix by composing the pivot rotation — same maths as `TotemVehicle.setRotation` (totem.ts:301-323) but instanced.
3. **Rival pose signals.** `rival-race.js` already produces `lateralMeters` deltas and `calculateRivalBankRadians` (rival-race.js:179-199). Derive per-rival `steer` (from lateral velocity), `brake` (from `speedMetersPerSecond` deceleration vs `brakingMetersPerSecondSquared`), and `throttle` (from acceleration) as **pure exported functions in `rival-race.js`** so they are validator-testable and 60/120 Hz identical.
4. **Shadow blobs.** One `InstancedMesh(count=4)` — 3 rivals + player — of a 2-triangle disc with a radial-falloff alpha from the existing FX atlas (`totem_race_presence_fx_256.png`, already loaded), `depthWrite: false`, positioned at `courseSample.position + up * 0.02`, scaled by hover height. **1 draw call, 8 triangles.** No `shadowMap` — the brief's no-shadow decision (game.ts:502) stands.
5. **Glow modulation.** Modulate the existing `engineGlow` (rivals.ts:192-224) instance scale + colour by the derived throttle/boost signal, not a constant.
6. **Expose positions for P3.** Add `RivalFleet.worldPosition(index, target): THREE.Vector3` and `RivalFleet.worldVelocity(index, target)`. **Do not add any audio in this phase.**

**Files touched:** `src/game/rivals.ts` (heavy), `src/game/totem.ts:198-266`, `src/game/rival-race.js` (+3 pure functions), `src/game/game.ts:565-591`, `scripts/validate-assets.mjs`, `scripts/validate-rivals.mjs`, new atlas PNG.

**NON-GOALS:** No change to `stepRivalState` pacing, `RIVAL_PROFILES` values, grid start, or classification — **rival determinism is sacred**. No rival audio (P3). No rival collision with the player (PRODUCT.md principle 5). No 4th rival. No `shadowMap.enabled = true`.

**Perf budget:** liveries **−2 calls**, articulation **+2 calls** (steering_fins, airbrakes as separate body batches; elevons folded into airbrakes if budget is tight), shadow blobs **+1 call / +8 tris**. **Net +1 call / +8 tris.** Post-phase target: ≤ 96 calls / ≤ 85,010 tris. Rival layer moves 6 → 7 calls, triangles unchanged at 18,351.

**Acceptance criteria:**

*Automatable:*
- `scripts/validate-rivals.mjs` extended: the new `rivalSteerSignal`/`rivalBrakeSignal`/`rivalThrottleSignal` pure functions produce **bit-identical** output at `deltaSeconds = 1/60` and `1/120` over a full 5-lap simulation; existing determinism assertions (60/120 Hz identical lap + finish times) still pass **unchanged**.
- 5-lap soak: `rivalDrawCalls === 7`, `rivalTriangles === 18359`, `rivalUpdateHz` in `[119.0, 121.0]`, `rivalMinimumSeparationMeters ≥ 2.20`, and `rivals[].finishTimeMs` **identical to the pre-phase values** (rival race unchanged).
- `peak.calls ≤ 96`, `peak.triangles ≤ 85010`, `p95FrameMs ≤ 11.0`, `textures` at finish ≤ **17** (atlas replaces 3 → net −2, so expect 15).
- New diagnostics field `rivalArticulation: { steerRad, brakeRad }[]` — assert `max(|steerRad|) ≥ 0.10` (≈5.7°) somewhere in the 5-lap run, proving the fins actually moved.
- `npm run test:code` exits 0.

*Taste gate (screenshots required):*
- Screenshot at `GREENWATER_SWEEP` d≈1000 m with a rival 12 m ahead mid-corner: **fins visibly deflected**, blob shadow visibly under the hull.
- Before/after pair at the start grid: does the fleet read as three *machines* or three *decals*?
- Screenshot verifying the atlas didn't smear liveries across quadrant seams (bilinear bleed at 2048² with `NearestFilter` — the PS2 treatment at totem.ts:93 sets `magFilter = NearestFilter`, so seams are a real risk).

**Reviewer command:** `npm run test:code` (validate-rivals is the determinism guard); browser 5-lap soak, diff `rivals[].finishTimeMs` against the pre-phase capture; capture the 3 screenshots.

---

### P6 — Minimap / radar · **S** · Wave A

**Goal:** course position + rival proximity readable without leaving the racing line.

**Design:** a **DOM `<canvas>` 2D overlay**, not a WebGL render target — **zero draw-call cost**, no extra render pass, and it inherits the CSS scanline treatment. Two elements: (1) a ribbon-shaped course outline with a player dot and 8 gate ticks, drawn once as a cached `Path2D` from `course.sample()` at 128 stations; (2) a short-range radar strip showing rivals within ±80 m longitudinal / ±20 m lateral.

**Tasks:**

1. Add `<canvas id="minimap">` to `index.html` inside `<main class="hud">` (after `#boost-meter`), + `style.css` placement honouring `prefers-reduced-motion`.
2. `src/game/minimap.ts` (new): `buildCourseOutline(course)` → cached `Path2D` (pure, validator-testable), `render(ctx, playerProgress, playerLateral, rivals)`.
3. Drive from `game.ts` at the existing **30 Hz HUD tick** (`update`, game.ts:855-865) — never per-frame.
4. Rival dots consume `RivalFleet.fieldOrder()` (rivals.ts:428) — no new coupling.

**Files touched:** `index.html`, `src/style.css`, `src/game/minimap.ts` (new), `src/game/ui.ts`, `src/game/game.ts:855-865`.

**NON-GOALS:** No WebGL render target. No second camera. No 3D minimap. No per-frame updates. No new textures.

**Perf budget:** **0 draw calls / 0 triangles.** `p95FrameMs` must not move by more than **0.3 ms**.

**Acceptance criteria:**

*Automatable:*
- New `scripts/validate-minimap.mjs`: `buildCourseOutline` over `GreenwaterCourse` produces 128 points, all within the course bounding box, closed loop (first/last within 1 m); `projectRivalToRadar(dLong, dLat)` returns `null` beyond ±80 m / ±20 m and clamped `[0,1]` coordinates inside.
- 5-lap soak: `peak.calls` **unchanged from P2's recorded value ± 0**, `p95FrameMs ≤ 11.0`, `renderedFrames` within 1% of the P2 run.
- `?motion=reduce` → minimap renders statically (no pulse animation); assert via a `minimapAnimated: false` diagnostics field.

*Taste gate (screenshots required):*
- Screenshot at 380 km/h in `CANOPY_PASSAGE` (heaviest fog): **does the minimap compete with the racing line?** PRODUCT.md anti-reference "busy HUD chrome that competes with the racing line" is the specific failure mode to check.
- Screenshot with a rival 6 m off the left rear quarter — is the radar dot findable in peripheral vision?

---

### P3 — Spatial + zoned audio · **M** · Wave B

**Goal:** you hear a rival before you see it, and the hangar sounds like a hangar.

**Tasks:**

1. **Panner-per-rival.** Three `PannerNode`s (`panningModel: "HRTF"`, `distanceModel: "inverse"`, `refDistance: 4`, `maxDistance: 90`, `rolloffFactor: 1.4`) each fed by a per-rival sawtooth+triangle pair mirroring the player engine (`audio.ts:135-152`). Add `EngineAudio.updateRivals(positions, velocities, throttles)` driven at the **existing 30 Hz control tick** (`audio.ts:43` `CONTROL_INTERVAL_SECONDS = 1/30`) — do **not** add a second tick. Listener orientation from the chase camera, set in the same 30 Hz block.
2. **Reverb zones.** One `ConvolverNode` fed by a **procedurally generated** impulse response (exponentially-decaying seeded noise — reuse `seededRandom(714)`, audio.ts:158; no audio files, `media-src 'none'` in the CSP forbids them). Two authored profiles: `open` (0.4 s decay, 0.08 wet) and `hangar` (1.9 s decay, 0.34 wet, 240 Hz high-pass). Wet/dry crossfaded over 0.6 s.
3. **Zone data.** Add `audio.zones` to `greenwater-blockout.json` and `RaceCourse.audioZoneAt(progress)`. Greenwater: `hangar` for d ∈ [588, 846] (LINK_APRON + HANGAR_SIX + HANGAR_EXIT — exactly the B-wall interior), `open` elsewhere.
4. **Diagnostics.** Extend `audio.diagnostics()` (audio.ts:405+) with `rivalPanners: number`, `rivalPanX: number[]` (last computed X in listener space), `reverbZone: string`, `reverbWet: number`, `activeOneShots` unchanged.

**Files touched:** `src/game/audio.ts` (heavy), `src/game/audio-timing.js` (zone crossfade quantization, pure), `src/game/course.ts` (+`audioZoneAt`), `src/game/data/greenwater-blockout.json`, `src/game/bitterpan-course.ts` (stub returns `open`), `src/game/game.ts:839-850`, `scripts/validate-audio-timing.mjs`.

**NON-GOALS:** No music change (stems, BPM, key, bar quantization all frozen). No audio files — 100% procedural stays. No `AudioWorklet`. No second control tick. No volume slider (P7). No Doppler (`PannerNode` Doppler is deprecated and unstable across browsers).

**Perf budget:** **0 draw calls / 0 triangles.** Audio graph grows by 3 panners + 6 oscillators + 1 convolver. Constraint: `audioControlHz` must stay in `[29.0, 31.0]` and `p95FrameMs` must not move by more than **0.4 ms**.

**Acceptance criteria:**

*Automatable:*
- Extend `scripts/validate-audio-timing.mjs`: zone crossfade start times remain **bar-quantized** at 174 BPM (reuse `nextQuantizedTime`); the procedural IR generator is deterministic (same seed → identical `Float32Array` across runs); `hangar` IR RT60 ∈ [1.7, 2.1] s measured from the generated buffer.
- New probe `?diagnostics=1&probe=rival-audio`: places a rival at exactly **4.0 m to the player's left**, same longitudinal position. Diagnostics must report `rivalPanX[i] ≤ -0.85` (hard-left in listener space) and `rivalPanX[i] ≥ 0.85` for the mirrored right-side case. **This is the brief's named criterion, made mechanical.**
- 5-lap soak: `reverbZone` transitions **exactly 10 times** (5 laps × 2 boundaries at 588 m and 846 m); `reverbWet` reaches `0.34 ± 0.01` inside the hangar and `0.08 ± 0.01` on the runway; `audioControlHz ∈ [29.0, 31.0]`; `audioControlUpdates ≈ 5185 ± 50` (matches the locked baseline); `peakAudioOneShots` unchanged; `skippedAudioOneShots === 0`.
- `p95FrameMs ≤ 11.0`, `heapGrowthMb ≤ 1.0` over 5 laps (convolver leak check).
- `npm run test:code` exits 0 (`validate:security` will re-scan `audio.ts` — no new sinks).

*Taste gate (headphone listen required, no screenshot substitute):*
- Human listens to a 1-lap run on headphones at `?demo=1&laps=1`. Questions: does a passing rival **track across the stereo field** convincingly? Does the hangar reverb feel like architecture or like an effect? Does the reverb muddy the 174 BPM stems (readability-first applies to audio too)?

---

### P4a — Lighting motion · **M** · Wave B

**Goal:** light stops being static. Three motions, all inside `atmosphere.ts` (created in P0.5), all zero-cost.

**Tasks:**

1. **Sector-lerped key light *direction*.** Today `keyLight.position` is nailed at `(80, 130, -35)` (game.ts:1821) while only colour/intensity lerp (updateFog:2183-2189). Add `keyDirection: THREE.Vector3` to `CourseLightingProfile` (course.ts:182-191) and to the 12 `SECTOR_PALETTE_DEFINITIONS` (course.ts:272-409). Lerp the direction with the same `LIGHTING_CROSSFADE_METRES = 90` crossfade. Effect: the sun visibly swings as you round `THE_ELBOW`.
2. **Hangar lamp flicker.** Two additional `PointLight`s enabled only for d ∈ [618, 816] (`HANGAR_SIX`), driven by a **seeded deterministic** flicker (`seededRandom(714)` pattern, sampled at the existing 30 Hz atmosphere tick — `ATMOSPHERE_UPDATE_INTERVAL_SECONDS`, course.ts:252). Disabled entirely under `prefers-reduced-motion`.
3. **Lap-based time-of-day drift.** A `lapProgress ∈ [0,1]` term (lap N of 5) that shifts hemisphere sky/ground and key colour along a 5-stop authored ramp — dusk creeping in over a race. Applied **multiplicatively over** the sector palette so sector identity survives.

**Files touched:** `src/game/atmosphere.ts`, `src/game/course.ts:182-191,272-409,+lightingAt`, `src/game/data/greenwater-blockout.json` (time-of-day ramp), `src/game/game.ts` (pass `lap`/`totalLaps` to atmosphere).

**NON-GOALS:** **No shadow maps.** No 5th/6th permanent light (hangar lamps are conditional and pooled). No post-processing pass. No tone-mapping change (that is P4b). No Bitterpan lighting work (P8).

**Perf budget:** **0 draw calls / 0 triangles.** 2 conditional lights only inside `HANGAR_SIX` → max concurrent lights goes 4 → 6, Lambert forward-render cost is measurable: `p95FrameMs` must not move by more than **0.5 ms**.

**Acceptance criteria:**

*Automatable:*
- New `scripts/validate-lighting.mjs`: all 12 sector palettes define a normalized `keyDirection`; `lightingAt` is continuous — sampling every 1 m around the lap, the max frame-to-frame `keyDirection` angular delta is **≤ 0.9°** (no popping); the flicker generator is deterministic for a fixed seed and produces intensity ∈ [0.55, 1.0].
- 5-lap soak: `p95FrameMs ≤ 11.0`, `peak.calls` unchanged from P3's recorded value, `atmosphereHz ∈ [29.0, 31.0]`, lap sequence still within **±0.05 s** of baseline (lighting must not touch physics).
- `?motion=reduce` → new diagnostics field `hangarFlickerActive: false`, `timeOfDayDrift: 0`.

*Taste gate (screenshots required — 6 shots):*
- Same camera position at `THE_ELBOW` d≈1530 m on **lap 1 vs lap 5** — is the time-of-day drift felt or just noticed?
- `HANGAR_SIX` d≈700 m, three frames 0.5 s apart — does the flicker read as failing industrial lighting or as a rendering glitch?
- `GREENWATER_SWEEP` d≈1000 m before/after the key-direction change.

---

### P5 — Drift as a mechanic + boost/energy tradeoff · **M** · Wave B (serialized after P1)

**Goal:** drift stops being cosmetic. This is a **feel change** — it needs user sign-off on numbers *before* implementation, not after.

**Design gate — the orchestrator must get explicit user sign-off on this table before spawning the implementer:**

| Parameter | Proposed | Note |
|---|---:|---|
| Charge rate | `driftIntensity × 0.55 /s` | full charge ≈ 1.8 s of committed drift |
| Charge cap | `1.0` | one bank |
| Release reward | `+0.30` boost reserve | vs `integrateBoostReserve` passive `+0.075/s` (physics.js:107) — a good drift is worth **4 s of passive regen** |
| Minimum charge to reward | `0.35` | prevents twitch-farming |
| Charge decay off-drift | `−1.2 /s` | must commit |
| Boost drain | `0.20 /s` → **`0.26 /s`** | boost becomes scarcer so the drift loop matters |
| Passive regen | `0.075 /s` → **`0.045 /s`** | ditto |

**Tasks:**

1. **Pure physics functions in `physics.js`** (this is the TDD core): `integrateDriftCharge(charge, driftIntensity, delta)`, `resolveDriftRelease(charge, wasDrifting, isDrifting) → { reward, consumed }`, and updated `integrateBoostReserve` constants. All pure, all validator-testable at 60/120 Hz.
2. **Wire into `updateRace`** (game.ts:975-1000 drift region, ~1010 boost region). Reward feeds `boostReserve`.
3. **Feedback:** HUD charge arc on the existing `#boost-meter` (`index.html`, `ui.ts`), `audio.playDriftEngage()` pitch-shifted by charge, sparks via existing `emitImpactSparks` at low strength, `input.pulse` on release.
4. **Re-baseline the autopilot.** The demo line must exploit the new loop or lap times will *rise*; expect a new locked lap sequence.

**Files touched:** `src/game/physics.js`, `src/game/game.ts:975-1010`, `src/game/ui.ts`, `index.html`, `src/style.css`, `src/game/effects.ts`, `src/game/autopilot.ts`, `scripts/validate-physics.mjs`, `docs/PERFORMANCE_BASELINE.md`.

**NON-GOALS:** No rubber-banding (PRODUCT.md principle 5). No rival drift AI. No change to `CRUISE_MAX_SPEED`/`BOOST_MAX_SPEED`. No new boost pads. No handling model rewrite — `calculateGripRate`/`calculateTurnRate` keep their current shape.

**Perf budget:** **0 draw calls / 0 triangles** (sparks reuse the existing 48-slot buffer).

**Acceptance criteria:**

*Automatable:*
- `scripts/validate-physics.mjs` extended (mirroring its existing `simulateSpeed` 60/120 Hz pattern): `integrateDriftCharge` reaches 1.0 in **1.80 s ± 0.02 s** at `driftIntensity = 1.0`; 60 Hz and 120 Hz results differ by **< 0.001**; charge decays 1.0 → 0 in **0.833 s ± 0.02 s**; `resolveDriftRelease` returns `reward === 0` below 0.35 charge and `0.30` above; a 240 s mixed-control soak never produces `reserve > 1.0` or `< 0`, and never NaN.
- 5-lap soak: `driftEntries ≥ 12`, `driftSeconds ≥ 8.0`, `boostSeconds` within `[baseline − 4.0, baseline + 4.0]` (the tradeoff should roughly hold total boost time constant while making it *earned*), `boostLocked` never true for more than 2 consecutive samples.
- New diagnostics: `driftCharge`, `driftRewards`, `driftRewardTotal`. Assert `driftRewards ≥ 8` over 5 laps.
- `p95FrameMs ≤ 11.0`, `peak.calls` unchanged.

*Taste gate (human must play, not watch — mandatory):*
- Human drives 3 laps manually. Questions: does the drift *charge* communicate through the HUD arc without looking at it? Is 1.8 s to full charge too long for `T1_CRADLE_BEND`? Does boost feel scarce-but-fair or stingy? **A failing answer means re-tuning the table and re-running, not shipping.**

---

### P4b — PS2 rendering commit · **M** · Wave C · **PURE TASTE GATE**

**Goal:** resolve the contradiction between PRODUCT.md ("beautifully remembered PlayStation 2 title", "prefer deliberate low-resolution character over modern rendering complexity") and `game.ts:500` `AgXToneMapping` — a 2023 filmic curve.

**This phase must not be implemented until the user picks a side.** The orchestrator's job is to produce the A/B evidence first.

**Task 0 (do this first, alone): build the A/B.** Behind `?render=ps2` vs `?render=agx`, capture **8 matched screenshot pairs** at 1280×720 `quality=high`: `RUNWAY_START` d=80, `WATER_TABLE` d=480, `HANGAR_SIX` d=700, `GREENWATER_SWEEP` d=1000, `CANOPY_PASSAGE` d=1300, `THE_ELBOW` d=1530, `FUEL_ROW` d=1800, `RUNWAY_HOME` d=2400. Present to the user. **Stop. Await decision.**

**Tasks (only if the user commits to PS2):**

1. `toneMapping = THREE.NoToneMapping` + a hand-authored 3-point contrast curve baked into material colours (game.ts:500-501, now `atmosphere.ts`).
2. **Vertex snapping** — quantize clip-space XY to a 320×240 virtual grid via `onBeforeCompile` in `applyPs2MaterialTreatment` (totem.ts:64-105). Applies to course + environment; **exclude the vehicle and rivals** (readability-first — the ship must not jitter).
3. **Affine texture warble** — drop perspective correction on course deck materials only, via a `noperspective`-equivalent varying trick. Highest risk of looking like a bug rather than a period detail.
4. **Dither depth reduction** — the treatment already sets `material.dithering = true` (totem.ts:74); add an explicit 16-bit-equivalent ordered-dither quantization in the fragment stage.

**Files touched:** `src/game/totem.ts:64-105`, `src/game/atmosphere.ts`, `src/game/game.ts:499-502`, `scripts/validate-render-quality.mjs`.

**NON-GOALS:** No post-processing chain (`EffectComposer`) — it costs a full-screen pass and the budget doesn't need it. No CRT curvature. No colour-depth reduction on the HUD (accessibility contrast clause). No change to the CSS scanline layer (`src/style.css`).

**Perf budget:** **0 draw calls / 0 triangles.** Shader patches must not push `p95FrameMs` above **11.0 ms**. `NoToneMapping` should be marginally *cheaper*.

**Acceptance criteria:**

*Automatable:*
- `scripts/validate-render-quality.mjs` extended: `ps2CourseMaterials`/`ps2CourseTextures` diagnostics counts non-zero and unchanged from baseline; a new `ps2VertexSnapMaterials` count matches the course material count and is **0 for vehicle + rival materials**.
- 5-lap soak: `p95FrameMs ≤ 11.0`, `peak.calls` unchanged, lap sequence within ±0.01 s (rendering must not touch physics).

*Taste gate — this phase closes on the human's eye and nothing else:*
- The 8 A/B pairs above, re-shot post-implementation.
- Plus: **HUD contrast check** at `CANOPY_PASSAGE` with dither active — PRODUCT.md's accessibility clause requires strong HUD contrast survive the treatment.
- Plus: a 30-second capture at speed — vertex snap that looks charming in a still can read as z-fighting in motion. **Motion evidence is required; stills are insufficient for this phase.**

---

### P7 — Meta layer · **L** · Wave C

**Goal:** the game becomes a *product* — pick your track, pick your livery, set your volume, keep your best lap.

**Tasks (5 subagent sessions):**

1. **Security-invariant amendment (do first, standalone).** `scripts/validate-security.mjs:76` bans `localStorage` in all of `src/`. Amend to: banned everywhere **except** `src/game/persistence.ts`, and add three new assertions — persistence must write only under the key prefix `futurisma.`, must store a `schemaVersion` integer, and must not reference any of `email|name|user|id|token`. Document the rationale in README.md's Verification section. **This is a deliberate policy change; the orchestrator should surface it to the user for acknowledgement.**
2. **`src/game/persistence.ts` (new) — the first save schema.** `{ schemaVersion: 1, settings: { masterVolume, musicVolume, reducedMotion, quality, ps2Render }, records: { [mapCode]: { bestLapMs, bestRaceMs, laps } }, livery: string }`. **Every read must be defensive**: try/catch on `JSON.parse`, per-field type-guard, unknown `schemaVersion` → discard and start fresh, quota-exceeded → degrade to in-memory. Never throw into the game.
3. **Track + livery select.** Promote `resolveMapSelection` (map-selection.ts, currently 6 lines, URL-only) into a real selection surface on `#start-screen` (index.html:141-186). 2 tracks × 4 liveries (`works` livery already ships as `totem_decals_1024_works.png` and lands in P2's atlas 4th quadrant). URL params stay as an override for QA.
4. **Options panel.** Master volume + music volume sliders (`EngineAudio.master.gain`, audio.ts:117 — currently a hardcoded `0.34`; and the stem bus), reduced-motion toggle, quality lock, PS2-render toggle (if P4b landed). Reachable from `#start-screen` and from the pause state (`togglePause`, game.ts:2242).
5. **Best-lap surfacing.** Show stored best lap on the start screen and a `NEW BEST` flash on the result screen (`ui.ts:270`).

**Files touched:** `src/game/persistence.ts` (new), `src/game/map-selection.ts`, `src/game/ui.ts`, `index.html`, `src/style.css`, `src/main.ts`, `src/game/audio.ts` (volume API only — coordinate with P3), `src/game/game.ts` (constructor + `finishRace`), `scripts/validate-security.mjs`, `scripts/validate-persistence.mjs` (new), `README.md`.

**NON-GOALS:** No server, no accounts, no leaderboards, no telemetry upload (`/https?:\/\//` remains banned in `src/`). No cookie/consent banner — `localStorage` for local settings needs none. No key rebinding (deferred: `input.ts:21-35` hardcodes `KeyW`/`KeyA`/`KeyS`/`KeyD` sets; a rebinding layer is its own phase).

**Perf budget:** **0 draw calls / 0 triangles.**

**Acceptance criteria:**

*Automatable:*
- `scripts/validate-persistence.mjs` (new, wired into `test:code`), run in Node with a stubbed `localStorage`: round-trips a valid v1 payload; returns defaults for `null`, `""`, `"{"`, `"[]"`, `'{"schemaVersion":99}'`, `'{"schemaVersion":1,"settings":null}'`, and a 5 MB string; **never throws** on any of the 12 hostile fixtures; a quota-exceeded stub degrades silently and reports `persistenceMode: "memory"`.
- `npm run validate:security` passes with the amended rule, and **still fails** if `localStorage` is added to any file other than `persistence.ts` (add a negative fixture test).
- Browser: set volume to 0.2, reload → slider reads 0.2 and diagnostics reports `masterVolume: 0.2`. Set a best lap, reload → start screen shows it. Clear storage, reload → defaults, no error panel.
- `?map=bitterpan` URL override still wins over the stored selection.
- 5-lap soak on both maps: `p95FrameMs ≤ 11.0`, `peak.calls` unchanged.

*Taste gate (screenshots):*
- Start screen with track+livery select — does it still read as "KAIRO DYNAMICS · KD-0714" in-fiction, or has it become a generic settings menu? PRODUCT.md anti-reference: "clean luxury spacecraft and contemporary automotive dashboards."

---

### P8 — Bitterpan production pass · **L** · Wave C

**Goal:** Map 02 stops being a `?map=` blockout and becomes shippable.

Current state, verified: `bitterpan-course.ts:444-460` returns hardcoded `edgeType() → "C"`, `surfaceGripAt() → 1`, `cableTripSideAt() → 0`, `isOnBoostPad() → false`, `setLapBoard() → {}`, and `musicAt()` returns a constant. `bitterpan-environment.ts` has 0 textures and **hard-throws** on exact triangle counts (line 190 — softened in P0).

**Tasks (5 sessions):**

1. **Edge types + apron.** Author per-station `edgeL`/`edgeR` in `src/game/data/map02/CENTRELINE_STATIONS.json` (or a sidecar) and implement `edgeType(sample, lateral)` properly. Inherit P1's apron table.
2. **Hazards + boost pads + surface grip.** Author a Bitterpan hazard set (mirroring the Greenwater `hazards` schema: `standing_water`, `steam_vent`, `cable_coil`) and boost-pad distances; implement `surfaceGripAt`, `cableTripSideAt`, `isOnBoostPad`.
3. **Music triggers + audio zones.** Author `music.triggers` per sector using the same 174 BPM / F-minor / 4-stem 0-3 level schema; author P3's `audioZoneAt` zones.
4. **Environment culling + textures.** Bitterpan currently loads its GLBs with no distance/frustum culling (`environment.ts` has `CullGroup`; Bitterpan doesn't use it). Port the culling. Apply `applyPs2MaterialTreatment`. Note `camera.far = 1800` for Bitterpan vs 650 for Greenwater (game.ts:479) — **culling matters much more here**.
5. **Lap board + P4a lighting.** Implement `setLapBoard`; author the 12-equivalent sector lighting palettes with `keyDirection`.

**Files touched:** `src/game/bitterpan-course.ts` (heavy), `src/game/bitterpan-environment.ts`, `src/game/data/map02/*.json`, `src/game/scene-assets.ts`, `scripts/validate-map02.mjs`.

**NON-GOALS:** No new GLB authoring (the blockout + massing are frozen — see `INTEGRATION_CONTRACT.json`). No living world (P9). No new Bitterpan-specific mechanics.

**Perf budget:** **+12 draw calls / +60,000 triangles** — but Bitterpan is a *separate scene*, so it does not stack with Greenwater's 95. Bitterpan target: ≤ **100 calls / ≤ 140,000 tris** at `camera.far = 1800`. This is the phase most likely to strain the ceiling; culling (task 4) is the mitigation and should land **before** tasks 1-3 if measurements look tight.

**Acceptance criteria:**

*Automatable:*
- `scripts/validate-map02.mjs` extended: every centreline station resolves an edge type from the authored set; every music trigger has all 4 stems at levels 0-3; boost pads are ≥ 40 m apart and ≥ 60 m from any checkpoint; hazards are inside the ribbon.
- `scripts/validate-apron.mjs` extended to cover Bitterpan.
- 5-lap soak `?map=bitterpan&demo=1&diagnostics=1&laps=5&quality=high&start=manual`: completes with `missedGates === 0`, `recoveries === 0`, `p95FrameMs ≤ 12.0` (relaxed vs Greenwater — 1800 m far plane), `peak.calls ≤ 100`, `peak.triangles ≤ 140000`, `environmentVisibleGroups < environmentMeshes` (proves culling is active), `musicTransitions ≥ 20`.
- Map selector (P7) reaches Bitterpan without a URL param.

*Taste gate (screenshots, 6+):* one per sector at speed. Question: does Bitterpan have an *identity* distinct from Greenwater, or is it Greenwater in a different colour? PRODUCT.md: "the tension between humid organic space and repaired aerospace machinery" is Greenwater's; Bitterpan needs its own sentence.

---

### P9 — Living-world expansion · **M** · Wave D

**Goal:** 155 cards / 4 calls is Greenwater-only and covers 6 of 12 sectors (`living-world.ts:107-132` — zones span 300-470, 690-820, 760-800, 860-1030, 1180-1330 m). Extend coverage and bring the system to Bitterpan.

**Tasks:** (1) author 4 new Greenwater zones covering `FUEL_ROW` (1592-2120 m, currently barren — 265 samples, the longest sector with nothing alive in it) and `RUNWAY_HOME`; (2) generalize `GreenwaterLivingWorld` into a course-agnostic `LivingWorld` taking a zone spec + course; (3) author a Bitterpan zone set; (4) extend the 30 Hz update budget guard.

**Perf budget:** **+4 draw calls / +2,000 triangles** (Greenwater 4 → 8 calls, 155 → ~260 cards). Greenwater post-phase: ≤ **99 calls / ≤ 87,000 tris**.

**Acceptance:** `livingWorldDrawCalls ≤ 8`, `livingWorldCards ≤ 280`, `livingWorldUpdateHz ∈ [29,31]`, `p95FrameMs ≤ 11.0`, `heapGrowthMb ≤ 1.0`. Taste gate: `FUEL_ROW` before/after screenshots at speed.

---

### P10 — Ghost lap · **M** · Wave D · stretch

**Goal:** race your own best lap.

**Design decision to make in the plan doc:** record **positions**, not inputs. Input replay requires the physics to be bit-reproducible across code versions — it isn't, and every future physics change would invalidate every stored ghost. Position recording at 20 Hz (`progress`, `lateral`, `speed`, `steer`) is ~34 s × 20 = 680 frames × 4 floats = **10.9 KB per lap**, trivially storable in P7's schema, and version-independent.

**Tasks:** (1) `src/game/ghost.ts` — recorder + interpolating player, both pure; (2) hook the recorder into `updateRace`; (3) render the ghost as a 4th instance of P2's rival batches with a translucent material (**+1 draw call / +6,117 tris**); (4) persist best-lap ghost per map in P7's schema (schemaVersion → 2, with a v1 → v2 migration path — this is the first schema migration and should be exercised by a validator fixture).

**Perf budget:** **+1 call / +6,117 tris.** Greenwater post-phase: ≤ **100 calls / ≤ 93,500 tris**.

**Acceptance:** `scripts/validate-ghost.mjs` — round-trip a 680-frame recording with < 0.05 m position error; interpolation is monotonic in progress; a v1 payload migrates to v2 without data loss; a truncated recording is rejected without throwing. Soak: `ghostDrawCalls === 1`, `p95FrameMs ≤ 11.0`, ghost lap time reproduces the stored value within **±0.05 s**.

---

## 4. Perf budget ledger (Greenwater, `quality=high`)

Ceiling: **120 draw calls / 220,000 visible triangles** (`docs/PERFORMANCE_BASELINE.md` line 542; environment sub-cap 24 calls / 175,000 tris).

| After phase | Δ calls | Δ tris | Cumulative calls | Cumulative tris | Gate |
|---|---:|---:|---:|---:|---|
| *(baseline)* | — | — | **92** | **66,308** | — |
| P0 / P0.5 | 0 | 0 | 92 | 66,308 | ≤92 / ≤67,000 |
| P1 apron | +3 | +18,000 | 95 | 84,308 | ≤95 / ≤85,000 |
| P2 rivals | +1 | +8 | 96 | 84,316 | ≤96 / ≤85,010 |
| P6 minimap | 0 | 0 | 96 | 84,316 | ≤96 |
| P3 audio | 0 | 0 | 96 | 84,316 | ≤96 |
| P4a lighting | 0 | 0 | 96 | 84,316 | ≤96 |
| P5 drift | 0 | 0 | 96 | 84,316 | ≤96 |
| P4b PS2 | 0 | 0 | 96 | 84,316 | ≤96 |
| P7 meta | 0 | 0 | 96 | 84,316 | ≤96 |
| P9 living world | +4 | +2,000 | 99 | 86,316 | ≤99 / ≤87,000 |
| P10 ghost | +1 | +6,117 | **100** | **92,433** | ≤100 / ≤93,500 |

**Reserve at completion: 20 draw calls, 127,567 triangles.** Bitterpan (P8) is budgeted separately at ≤ 100 calls / ≤ 140,000 tris because it is a distinct scene.

**Frame-time budget:** baseline `p95FrameMs = 9.9`. Ceiling **11.0 ms** for every Greenwater phase (12.0 ms for Bitterpan). Per-phase allowances: P1 +0.6, P2 +0.3, P3 +0.4, P4a +0.5, all others +0.3. Any phase exceeding its allowance ships a mitigation or does not merge.

---

## 5. Taste gates vs automatable — the explicit split

**Closes on math alone (validator + diagnostics soak, no human eye needed):**
P0 (all), P0.5 (all), P3 zone-transition counts and pan values, P5 physics determinism and charge curves, P6 zero-cost proof, P7 persistence hostile-fixture suite, P10 round-trip fidelity.

**Cannot close without the human — screenshots or a play session are a merge blocker:**

| Phase | Evidence required | The question being asked |
|---|---|---|
| P1 | 3 screenshots (apron on-line vs off-line; A vs B in one frame) | Does the apron read as authored ground? Does fog still hide the far edge? |
| P2 | 3 screenshots (fins mid-corner, blob shadow, atlas seams) | Machines or decals? Any texture bleed at 2048² nearest-filtered? |
| P3 | **Headphone listen, 1 lap** — no screenshot substitute | Does a passing rival track across the field? Does reverb muddy the stems? |
| P4a | 6 screenshots (lap 1 vs lap 5; 3-frame flicker; key-direction) | Felt or merely noticed? Failing lighting or rendering glitch? |
| P4b | 8 A/B pairs **+ a 30 s motion capture** | The whole phase is this question. Motion evidence mandatory — vertex snap fails in motion, not in stills. |
| P5 | **Human drives 3 laps manually** | Does charge communicate without looking? Is boost scarce-but-fair? |
| P6 | 2 screenshots (fog + peripheral rival) | Does it compete with the racing line? |
| P7 | 1 screenshot (start screen) | Still in-fiction, or a generic settings menu? |
| P8 | 6+ screenshots (one per sector) | Does Bitterpan have its own sentence? |
| P9 | 2 screenshots (`FUEL_ROW` before/after at speed) | Alive, or busy? |

**Rule for the orchestrator: a visual/feel phase whose validators are green but whose screenshots have not been shown to the user is NOT reviewed.** Stage-2 review means re-running the acceptance scenario *and* surfacing the images.

---

## 6. Risk register — top 5

| # | Risk | Blast radius | Likelihood | Mitigation | Tripwire |
|---|---|---|:-:|---|---|
| **1** | **Worktree test failure from untracked archives** — every phase's TDD loop is dead on arrival. `scripts/validate-assets.mjs:352` + 6 `artifacts/` URLs read files that `git ls-files` says do not exist. | **Total.** Blocks all 11 phases. Failure mode is silent-looking: implementers "fix" a validator that was never broken. | **Certain** (already true) | P0 tasks 1-2, before anything else. `test:code` must never touch an archive. | `git worktree add /tmp/x && cd /tmp/x && npm ci && npm run test:code` — if this doesn't exit 0, stop the entire roadmap. |
| **2** | **Rival-race determinism break (P2)** — `validate-rivals.mjs` asserts 60 Hz and 120 Hz produce identical lap and finish times. Adding pose-derivation functions to `rival-race.js` invites frame-rate-dependent state (e.g. deriving steer from a raw per-frame lateral delta). | Rival classification, `finalClassification`, the locked 5-lap baseline, and every subsequent phase's soak comparison. Silent: a 0.3% pace drift only shows at lap 5. | **High** | Derive pose signals **from state, not from deltas** — use `lateralMeters` vs `lastSafeLateralMeters` and the profile's authored `lateralSpeedMetersPerSecond`, never `(current − previous)/dt`. Keep the derivation in `rival-race.js` (pure, JS, validator-reachable), never in `rivals.ts`. | Extend `validate-rivals.mjs` to snapshot `rivals[].finishTimeMs` and assert **exact equality** across 60/120 Hz. Compare against the P1-merge capture. |
| **3** | **120 Hz physics contamination (P1, P5, P10)** — `update` (game.ts:790-800) runs a fixed-step accumulator loop; anything added inside that loop must be frame-rate independent, and anything added *outside* must not write simulation state. The apron grip term and drift charge both sit at this boundary. | Handling feel diverges between a 60 Hz laptop and a 165 Hz monitor. Reproduces as "it feels different on my machine" — the hardest class of bug to catch in review. | **Medium-High** | All new integration goes in `physics.js` as pure `(state, delta) → state` functions with 60/120 Hz equality assertions in `validate-physics.mjs` (the file already has the `simulateSpeed` harness for exactly this). Nothing new writes `this.speed`/`this.lateral`/`this.boostReserve` outside the accumulator loop. | `validate-physics.mjs` 60-vs-120 Hz delta must stay under the existing thresholds (< 0.2 m/s post-boost, < 0.7 m stopping distance). |
| **4** | **Perf regression that only appears at lap 5** — the budget table is per-phase, but heap growth, texture churn, and audio-node leaks compound. P3's `ConvolverNode` + 3 panners and P9's card expansion are the two most likely leaks. | Late discovery forces a revert of a merged, "reviewed" phase. | **Medium** | Every phase's acceptance includes `heapGrowthMb ≤ 1.0` and `geometries`/`textures` counts at finish, over the **full 5-lap** soak — never a 1-lap check. The diagnostics already track `maxHeapMb` and `heapGrowthMb`. | `heapGrowthMb > 1.0` or `textures` at finish exceeding the previous phase's value = automatic reject. |
| **5** | **First save schema (P7)** — there is no persistence today, so P7 introduces the very first on-disk contract, *and* it requires amending a hard security assertion (`validate-security.mjs:76`). A schema mistake is permanent for every player who has already run the build; a security-rule mistake reopens a class of sink the project deliberately closed. | Corrupt or unparseable storage → error panel on load → **game unlaunchable**, with no in-game way to clear it. Plus a weakened `src/`-wide invariant. | **Medium** | Defensive-read-only design: `schemaVersion` from day one; unknown version → silently discard; every field type-guarded; `try/catch` around parse *and* write; quota exceeded → in-memory mode. Persistence lives in exactly one file and the security validator enforces that. The rule amendment is surfaced to the user for acknowledgement, not slipped in. | `validate-persistence.mjs` must pass 12 hostile fixtures (null, empty, truncated JSON, wrong types, future version, 5 MB blob, quota throw) **without throwing**, and `validate-security.mjs` must still fail when `localStorage` appears in a second file. |

**Runner-up risks worth naming:** asset-contract breakage from the P2 livery atlas (hash re-baselining in `validate-assets.mjs` — mitigated by P0 task 4 converting runtime throws to warnings); Bitterpan's 1800 m far plane blowing the triangle budget (P8 — mitigate by landing culling first); and P4b's affine warble reading as z-fighting (mitigated by the mandatory motion capture).

---

## 7. Shippability rule (applies to every merge)

A phase merges only when **all four** hold:

1. `git worktree add /tmp/fut-verify <branch> && cd /tmp/fut-verify && npm ci && npm run test:code` exits **0**.
2. The 5-lap soak `?demo=1&diagnostics=1&laps=5&quality=high&start=manual` **completes** — `phase: "finished"`, `missedGates === 0`, `recoveries === 0`, `contextLosses === 0` — and meets the phase's named `peak.calls` / `peak.triangles` / `p95FrameMs` / `heapGrowthMb` numbers.
3. Manual play at `http://localhost:5173/` (no params) reaches the finish with keyboard input. **Every merge leaves the game playable** — no "temporarily broken while we land the next bit."
4. Taste-gate evidence (per §5) has been shown to the user and acknowledged, where the phase requires it.

The orchestrator's stage-2 review re-runs items 1-3 from a **clean worktree of the merge commit**, not from the implementer's tree.

---

## 8. Suggested plan-doc layout (superpowers convention)

```
docs/plans/P0_TEST_GATE_AND_HYGIENE.md
docs/plans/P05_MODULE_SEAMS.md
docs/plans/P1_AUTHORED_APRON.md
...
```
Each carries: Goal · Task list (one per subagent session) · Files+lines touched · NON-GOALS · Perf budget · Acceptance criteria (automatable / taste-gate, split) · Exact reviewer command · Rollback note.

Branch naming: `phase/p1-authored-apron`, worktree at `../fut-p1-apron`.

---

### Critical Files for Implementation

- `/Users/gentlegen/Desktop/Projects/futurisma-race/src/game/game.ts` — 2789 lines, one class; the universal touch point. Key anchors: renderer/tone mapping `499-502`, rival construction `565-591`, fixed-step loop `790-800`, lateral clamp + edge handling `1098-1156`, `position.y` from course sample `1074`, lighting `1813-1886`, `updateFog` `2170-2228`, `reportDiagnostics` `2366-2631` (the 10-way merge conflict).
- `/Users/gentlegen/Desktop/Projects/futurisma-race/src/game/course.ts` — 2134 lines; `RaceCourse` interface `200-247`, `CourseSample` `126-139`, `edgeType` `966-968`, `surfaceGripAt` `970-984`, sector palettes `272-409`, edge-furniture ribbon builder `1255-1360` (the apron geometry hook).
- `/Users/gentlegen/Desktop/Projects/futurisma-race/scripts/validate-assets.mjs` — line `352` reads an **untracked repo-root zip**; this single line is what breaks `npm test` in every worktree and gates the whole methodology.
- `/Users/gentlegen/Desktop/Projects/futurisma-race/src/game/rivals.ts` — `RivalFleet` constructor `129-247`; the 3 × `InstancedMesh(count=1)` livery split at `151-169` is the 2 draw calls that fund P2.
- `/Users/gentlegen/Desktop/Projects/futurisma-race/scripts/validate-security.mjs` — line `76` hard-bans `localStorage`/`sessionStorage` across `src/`; P7 cannot proceed without a reviewed amendment here.
- `/Users/gentlegen/Desktop/Projects/futurisma-race/src/game/physics.js` — 191 lines, all pure; the TDD substrate for P1 grip and P5 drift charge. `integrateBoostReserve` at `107-113`, `calculateDriftIntent` at `30-32`.