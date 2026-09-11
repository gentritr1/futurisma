# Dream Island — Phase C brief (the night turn, hero integration, residual closure)

For an implementer with no access to the conversation. Read `docs/briefs/DREAM-ISLAND-HANDOFF.md` (environment, rules, state detection) and `DREAM-ISLAND-LEVEL.md` §5 and §10.C first. Phase B is reviewed and approved with residuals; this phase closes them and finishes the night turn.

Branch `work/dream-island`. Phase B may be committed or still uncommitted when you start — check `git log --oneline -3`. Either way, do not commit. A vite dev server may already be listening on 5200 (PID from `lsof -nP -iTCP:5200`); if it serves this tree you may use it, otherwise start your own.

**Budget for this phase, measured at the end of B (works soak, 63+17):** you have **29 draws and 45,312 triangles** to the 110 / 180,000 phase gate, and the map ceiling is 145 / 220,000 including the shadow pass. Every step below reports its delta.

## C0. Adopt the revised day sky (source changed after the B review)

`art/references/dreamisland/phase-b/generation.json` → `sky_day_revision`: the chosen day source is now `sky-day-v2-gptimage2.png` with cloud contrast softened 25% (the exact operation is recorded there), pre-built at `sky-day-v2-soft25-4096x1024.jpg`. Re-run `scripts/prepare-dreamisland-skies.py` against the v2 source with the softening step added (make the step a documented parameter, default 0.25), regenerate `public/assets/dreamisland/sky-day.jpg`, and re-run `scripts/visual/tideline-v4/sky-profile.py` — it must report `accepted: true` (reference: warm .0466, ratio 1.077). Update `phase-b/skies/`-style evidence under `phase-c/skies/`.

## C1. The dark-sky gate clause (a deliberate instrument change, not a loophole)

`sky-profile.py`'s `skyLumaMaxMinRatio ≤ 2` cannot pass a near-black sky: the night panorama's band luma spans 0.0020–0.0137 (three display levels) and the ratio is a near-zero denominator. Amend the script: **when the band's maximum luma < 0.05, the acceptance term becomes absolute spread `max − min ≤ 0.02`** (still over rows 0..0.75h, still with the warm-step test unchanged). Print which clause fired. Prove the change is not a loophole: the Ascension and Tideline v4 panoramas must produce byte-identical JSON before and after (commit both runs as evidence), and the Dream Island night sky must now report `accepted: true` with the dark clause named. Add a one-line assertion to `validate-dreamisland-painted.mjs` that both Dream Island panoramas pass the profile script.

## C2. The crossfade instrument — BEFORE any tuning

There is no measurement of a sky/lighting crossfade anywhere in this repo. Build `scripts/visual/dreamisland/crossfade-profile.mjs` + `.py`: pin one pose (BEACH straight, progress 0.05, looking down the road toward the watchtower) on a frozen frame, render it at `nightBlend` = 0, .25, .5, .75, 1 (add a review-only `?nightBlend=` override honoured only with `diagnostics`), and report per-column luma and warmth of the sky region and mean luma of the road region for each of the five. Commit the five frames and the JSON under `art/evidence/dreamisland-v1/phase-c/crossfade/`. **Only after that capture exists**: state the midpoint target as a delta against the measured endpoints (e.g. "midpoint road luma within ±X of the linear interpolation of the 0 and 1 captures", with X chosen from the capture's own noise, and say how). A target written before the capture is an invented number and blocks review.

## C3. Hero integration (Codex's parallel track)

`public/assets/dreamisland/heroes/{clock-tower,waterfall-cliff,sea-stack-set}.glb` are **approved** and `watchtower.glb` is being rebuilt to the revised spec (brief §9 decision 5, revised: 28 m base → 20 m crown, 30 m tall, arched 14×8 bore). Read `heroes/heroes.json` and `art/evidence/dreamisland-v1/heroes/loader-check.json`.
- Extend `dreamisland-painted-environment.ts` to load the hero GLBs and bind their `DI_MAT_<role>` materials (including `DI_MAT_jungle-card`, the magenta-key sheet) to the same shared atlases and the same magenta-key discard the painted world uses. No embedded textures, no new downloads beyond the GLBs.
- Replace the painted world's own clock tower, waterfall cliff and sea stacks with the hero versions at the same placements (`painted.json` placements are the source of truth for position/yaw). **Watchtower: swap only if `heroes.json` records the rebuilt one** (bounds 28 × 30 × 28 or the tapered equivalent, bore box 14×10 clearance). If the rebuilt file is not there, keep Phase B's tower and say so — never swap in the 16 m version.
- Re-run the corridor validator (`validate-dreamisland-painted.mjs`, must stay 0 intrusions with the 21 bore stations probed at 7.4 m) and the P20.8 atlas proof on one cell per hero (clock face → emissive face rect; watchtower drum → wall-block rect).
- Report the draw/triangle delta per hero. Each hero GLB is 6–13 meshes; if the four cost more than ~12 draws, merge by material at load (one mesh per `DI_MAT_*` per hero) and report before/after.

## C4. Fish drift

The four goldfish (2 placed, `fishVisible` 0 → 2) are static in the basin. From `fish-rise` they rise over 6 s and drift on authored closed paths — a slow figure-eight over the BASIN pool and a long loop over the REEF shallows — staying **≥ 6 m above the deck wherever a path crosses the road** (decision 3: ambience, never an obstacle). Author paths as data (`src/game/data/dreamisland/fish-paths.json`), advance them on the schedule tick (deterministic, snapshot-safe: position is a pure function of tick), animate as a whole-mesh transform (no skinning). Under `?motion=reduce` fish do not spawn (`fishVisible` stays 0). Add a diagnostics counter `fishMinimumDeckClearance` (metres, over the whole race) and assert ≥ 6 in the runtime validator.

## C5. Both lighting states, measured

- Shadow draws and triangles in the day state and the night state (the key light never disarms — brief §5). Report both; if the night key is near-black, decide explicitly whether to keep casting and say why.
- Foam/shallows emissive at night: tune only against the C2 capture; report the before/after of the pier-edge contrast at the REEF pose (mean luma of the glowing band vs the black water beside it) — that contrast IS the night state's racing argument.
- `?motion=reduce`: acceptance per decision 6 — blend steps 0→1 at `strikeTick`, grip changes on the same tick (already validated), no fish, no flicker; add a soak-level assertion that no per-frame emissive intensity changes occur after `strikeTick` in reduced mode.

## C6. Residual housekeeping (from the B review)

- Phase-A validators write into `art/evidence/dreamisland-v1/phase-a/` unconditionally → take an `--out=` (default the phase dir they were written for) so a route revision never overwrites older evidence.
- Five atlas cells are undecided on pixels (road-deck, frond-card, gate-markers, causeway-paving, signage-plate — chromatically adjacent pairs or too-small samples). Decide them with a stronger isolation: render each consumer with the atlas temporarily replaced by a **quadrant-ID debug texture** (each quadrant a unique flat colour) via a review-only flag, and assert the sampled colour is the claimed quadrant's. This closes the P20.8 obligation without ambiguity. Record all thirteen as decided.
- `sample().sector` vs `district()` label lag (one station): pre-existing and shared with Tideline/Ascension; leave it, but document it in the brief's §8-style scars list.

## Acceptance (each closes only on the named command or artifact)

- `npm run test:code` PASS with the amended sky assertion and the fish clearance assertion inside it.
- `sky-profile.py` accepted on both panoramas, the dark clause named for night; Ascension/Tideline JSON byte-identical before/after the amendment.
- Crossfade evidence: five frames + JSON committed; midpoint target stated as a measured delta.
- Works soak: 0 missed gates, ≤ 110 draws / ≤ 180,000 triangles **with heroes and fish**, p95 reconciled, 0 material-walk violations; fish clearance ≥ 6 m; reduced-mode run with `fishVisible` 0.
- Corridor 0 intrusions after the hero swap.
- Frames: the 14 district frames re-shot after integration, plus the five crossfade frames. **A user eyeball is still owed on all of it** — Phase B's frames were never accepted by a person; put the eyeball set (day/night at BEACH, POINT, BASIN, REEF, plus the five crossfade frames) in one contact sheet so it can be accepted in one look.

Report in the handoff's format, with a "numbers this phase measured for the first time" section (the crossfade capture, shadow draws per state, pier-edge contrast, fish clearance).
