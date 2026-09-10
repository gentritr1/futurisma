# Dream Island — Codex 3D polish pass ("next level")

**STATUS: FINAL (2026-09-10, after the Phase C review). Phases A–C are committed on `work/dream-island`; start from HEAD.**

You are Codex, taking the finished Dream Island map (FUTURISMA Map 07) from "built and validated" to "the best-looking map in the game", without breaking a single measured contract. Read `docs/briefs/DREAM-ISLAND-HANDOFF.md` first (environment, rules, state detection, report format), then this file, then `docs/briefs/DREAM-ISLAND-LEVEL.md` §2 (why the night turn exists), §7 (art contract), §8 (budgets), §9 (decisions — final).

## 1. What "next level" means here, concretely

The map is a Y2K screensaver dream — naive saturated colour, flat vertex-lit shading, clean silhouettes, one or two impossible things stated with confidence. Polish means **more silhouette and more colour discipline, not more detail**. Every change must survive three tests: it reads at 300 km/h from the chase camera; it fits the budget line in §3; it goes through the shared lighting/fog/tone-mapping (no `toneMapped:false`, no `fog:false`, no bloom, no PBR maps).

Look at, in this order: `art/references/dreamisland/heroes/08_the_strike.png` (the target frame), `01n_beach_straight_night.png` and `06n_reef_shallows_night.png` (why the night state works — the water lights the edges), `03_watchtower_point_day.png` (the tunnel moment), and the two orthographic sheets in `art/references/dreamisland/sheets/`. Then look at the game's own frames in `art/evidence/dreamisland-v1/phase-c/` and write down, before touching anything, the five biggest gaps between the reference and the game. That list is the first section of your report.

## 2. The collision rule

You own: `art/blender/build_dreamisland_heroes.py`, `art/blender/dreamisland_heroes.blend`, `public/assets/dreamisland/heroes/**`, `art/evidence/dreamisland-v1/polish/**`, `scripts/visual/dreamisland-heroes/**`, plus — **only in this pass** — `art/blender/build_dreamisland_painted.py`, `art/blender/dreamisland_mesh.py`, `public/assets/dreamisland/painted.glb`, `painted.json`, `signage-manifest.json`, and `src/game/dreamisland-painted-environment.ts` / `dreamisland-materials.ts` / `dreamisland-water.ts` / `dreamisland-sky.ts`. You do not touch the route, schedule, powers, pace, validators' assertions, or budgets. If a change needs one of those, stop and say why.

## 3. The lines you cannot cross (all measured, none negotiable)

| Axis | Ceiling | Where it is measured |
|---|---|---|
| Draws, main + shadow, worst tier | **≤ 110** at the end of this pass (map ceiling 145) | `scripts/visual/dreamisland/race.mjs --tier=feral` → `metrics.json` `peakTotalCalls` |
| Triangles, main + shadow | **≤ 180,000** | same, `peakTriangles + peakShadowTriangles` |
| p95 frame time | report only, ≤ 11.0 ms | same, quoted only with `sampleResidual` beside it |
| Initial JS gzip / shell gzip | 266 / 277 KiB | `npx vite build && node scripts/validate-build.mjs` — headroom is ~1 KiB; nothing you add may be eagerly imported |
| Corridor | 0 intrusions | `validate:dreamisland-painted` |
| Materials | 0 `toneMapped:false` / `fog:false` except the sky dome by name | the material walk in `race.mjs` |
| Signage | letters ≤ 0.59 m | `signage-manifest.json` glyph fractions |
| Determinism | 60/120/240 Hz identical | `validate:dreamisland-runtime` |
| Atlas cells | every consumer proven against its quadrant | `scripts/visual/dreamisland/atlas-proof` + the quadrant-ID debug method from phase C |

`npm run test:code` must pass at the end. A green suite proves no regression, never that the art loaded — every visual claim closes on a rendered frame in `art/evidence/dreamisland-v1/polish/`.

## 4. Residuals from the Phase C review — what actually needs polishing

*(filled in by the orchestrator after reviewing Phase C; expect 6–10 items, each with a frame path, what is wrong in it, and the measurable it must move)*

Read against `art/evidence/dreamisland-v1/phase-c/eyeball-contact-sheet.png` (17 tiles) and the reference frames in `art/references/dreamisland/heroes/`. Every item names the tile, the defect, and the number that must move. Re-shoot the same 17 tiles at the end (`scripts/visual/dreamisland/frames.mjs` + the crossfade script) so before/after is one sheet.

1. **The sea is a flat blue plane** — every day tile. This is the exact "flat sea plane" verdict that failed Tideline. Reference: `01_beach_straight_day.png`, `06_reef_shallows_day.png`. Target: the cobalt facet cell must read as a *swell* — add a second, slower UV layer at a different scale and a per-vertex height ripple on a subdivided near-field sea patch (≤ 2,000 tris, one draw), and a horizon haze band so sea and sky do not meet on a hard line. Measurable: at the BEACH day pose, the sea region's luma standard deviation (currently near zero) must rise to ≥ 0.03 and the horizon row's luma step must fall below 0.10; report both before/after.
2. **Watchtower reads as a green tunnel, not a stone tower** — POINT day/night tiles + `heroes/watchtower-three-quarter.png`. The lower third is the moss quadrant tiled as a solid band. Rebuild as the stone cell with a vertex-tint moss gradient (dark green at the base fading out by ~10 m) plus a few jungle-card ivy strands (`s6` shows streaks on stone), and light the tunnel interior with the two `emissive` lamp discs so the bore reads as a beacon at night (§2). Measurable: at the 40 m frame the lower band's mean chroma sits between stone and current moss (report all three) with block courses visible; at the POINT night tile the tunnel-mouth region's mean luma ≥ 3× the surrounding drum's.
3. **The road is a hard-edged sand ribbon with no kerb definition** — BEACH/BASIN/REEF day tiles vs `02_palm_grove_day.png`. The kerb's cyan stripe is invisible at chase distance and the road-to-verge edge is a razor line. Target: kerb geometry with a real top face and a shadow-catching lip, the cyan stripe at a width that survives mip-filtering (measure the stripe's on-screen width at the chase pose; must be ≥ 3 px), and a sand-to-road blend strip. Measurable: kerb stripe visible ≥ 3 px at 40 m in both day and night tiles.
4. **Foliage is sparse, small and sits on a flat verge** — GROVE tile (`frames/day-grove.png`) vs `02_palm_grove_day.png`. Palms should overhang the road; understory should crowd the verge. Raise palm height at the GROVE to the 9–11 m variants leaning over the road (fronds ≥ 2 m above the corridor ceiling — the corridor validator must stay at 0), double understory card density on GROVE and CUT verges within the jungle batch (0 extra draws; report the triangle delta against the 32k reserve). Measurable: in the GROVE day tile, foliage pixels above the horizon line ≥ 25% of the frame width's columns.
5. **Night is too dark to read the road** — all night tiles. §2 promises a readability *trade*, not a loss: the glowing edges exist now but the road surface between them is near-black. Target: raise the night ground/hemisphere so the road's mean luma at the BEACH night pose sits in 0.12–0.18 (measured 0.085 at blend 1), keeping the edge glow contrast ≥ 0.35. Calibrate by rendered luma at the pinned pose (P20.4 rule), not by hex. Also give the night fog a slightly cooler, lighter colour so the mid-distance silhouettes (palms, tower) stay separable from the sky.
6. **The crossfade pops in its last quarter** — crossfade row: 0.00/0.25/0.50/0.75 are all clearly day, then 1.00 is night. Phase C measured 58.8% of the sky luma fall in the last 25% of the ramp because the mix happens in linear light. Target: shape `nightBlend` through an easing (e.g. a perceptual curve, gamma ≈ 2.2 on the sky mix only) so the five captures' sky luma steps are within 2× of each other; re-run `crossfade-profile` and report the five values — T1–T3 in `crossfade-target.json` must still hold.
7. **The landmarks are not landmarks** — BASIN and COURT tiles: the clock tower and waterfall are small and the clock face is not readable from the COURT entry. Target: scale the clock tower hero to 18 m (the brief's 14 m was set before the road widths; the half-footprint rule is unaffected) and give the waterfall its scrolling sheet cards at full 16 m drop with the foam ring visible; at the COURT-entry pose (progress ≈ 0.52) the clock face must be ≥ 40 px across with both hands distinct.
8. **Sea stacks vanish on the day horizon** — REEF day tile. The hero silhouettes are there but tone-matched into the haze. Give them a darker vertex tint and place two of the four nearer (≤ 250 m) so the horizon has depth. Measurable: at the REEF day pose, ≥ 2 stacks with silhouette contrast ≥ 0.15 against the sky behind them.
9. **The sky panorama shows a hard horizon band** — day tiles: the painted sea in the panorama's bottom quarter conflicts with the rendered sea plane. Clamp the panorama's `v` so the dome never shows its painted sea below the rendered horizon (Ascension uses `v = clamp(.15 + d.y*.8)`), and rely on the haze mix for the join. Measurable: no visible double horizon at any of the four day poses (frame + a row-luma profile across the horizon).

## 5. Standing polish targets (apply regardless of §4)

- **Silhouettes at 40 m and 300 m.** Render every focal asset at both distances against the day sky and the night sky (16 frames). Anything that dissolves into a blob at 300 m gets a stronger outline shape, not more polygons.
- **Vertex-tint discipline.** The painted world multiplies atlas colour by vertex colour before AgX. Calibrate tints by rendered luma at a pinned pose (the P20.4 rule: a hex value says nothing about screen luma), and record the pose + measured luma for every tint you change.
- **Palette lock.** Extract the 8 dominant colours of `08_the_strike.png` (day half and night half separately) and report the same 8 for your day and night frames; the map should sit inside the reference's gamut, not drift muddier.
- **Night edge contrast** is the map's argument: pier-edge and shore-line glow vs the black water beside it. Phase C measured it; you may only raise it, and you report the before/after number.
- **Card foliage.** Fronds and understory as crossed alpha cards must not show as flat planes edge-on at the chase camera; report a frame from each district verge.
- **The clock face** is readable as a clock from the COURT entry (progress ≈ 0.52) at speed — hands distinct, face round, not a white disc. One frame proves it.
- **The strike moment.** One captured sequence (10 frames across the 12 s ramp at the BEACH pose) that a person can flip through and see day become night without a pop. This is the frame set the user will judge the whole map on.

## 6. Report

The handoff's format, plus: the §1 gap list with a before/after frame per item; the §3 table with measured values; the palette comparison; the strike sequence path; every number's producing command; open gaps. Do not commit.
