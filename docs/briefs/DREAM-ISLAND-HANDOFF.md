# Dream Island (Map 07) — handoff for whoever continues (written for Codex)

You are taking over a level build mid-flight. You have no access to the conversation that produced it. Everything you need is in this file and the files it names. **Read this whole file before touching anything.**

## Where things are

- Repo: `/Users/gentlegen/Desktop/futurisma-race/polarity_work` (NOT `~/Desktop/Projects/futurisma-race`, an older checkout). Branch **`work/dream-island`**, cut from `work/ascension-pad` @ f2dc17d.
- Node: `export PATH=$HOME/.nvm/versions/node/v20.19.4/bin:$PATH` before any node command. Dev server: `npm run dev -- --host 127.0.0.1 --port 5200`. Blender: `/Applications/Blender.app/Contents/MacOS/Blender -b --python <script>`.
- The brief: `docs/briefs/DREAM-ISLAND-LEVEL.md`. §0 lists five engine traps that cost days if missed; §9 holds eight decisions that are **final**; §10 is the phase plan with acceptance criteria and the exact commands that close each phase. The concept record is `DREAM-ISLAND-CONCEPT.md` (origin only; the brief wins wherever they differ).
- Art: `art/references/dreamisland/` (heroes, day/night pairs, two orthographic model sheets), `art/references/dreamisland/phase-b/` (six atlases, magenta-key card sheet, two sky sources) — every image has a written verdict in its README / `generation.json`. **Do not generate new images.** If something is missing, say what and why.

## What is done

**Phase A — committed as `9109b6f`, reviewed and approved.** Route (2,400 m / 800 stations / 8 gates / 7 districts), course, integer-tick schedule calibrated from a measured Works lap (L = 31.254 s, strike tick 7688), powers config, solved rival pace, all registration points, procedural blockout at 70 draws / 66,042 triangles, `validate:dreamisland` + `validate:dreamisland-runtime` inside `npm run test:code`, evidence in `art/evidence/dreamisland-v1/phase-a/`. The works soak reproduces exactly: laps 32433/31375/31400 ms, 0 missed gates, grip 0.85 in BASIN after the strike.

**Phase B — DONE and reviewed 2026-09-10, APPROVE with residuals, UNCOMMITTED unless a commit after 9109b6f says otherwise.** Reviewer reproduced: test:code PASS, works soak 80 draws / 133,898 tris (gate 110 / 180k), 0 missed gates, 0 material-walk violations, both sky gates FAIL for source reasons (day warm-step .126; night ratio 6.76 on a near-black sky — the gate needs a dark-sky clause). Residuals carried to Phase C: day sky regeneration (orchestrator did it; sources in art/references/dreamisland/phase-b/), dark-sky gate clause, watchtower swap, 5 undecided atlas cells, parameterise phase-A validator output paths, draw reserve for C is 29 not 35. Evidence: art/evidence/dreamisland-v1/phase-b/.

**Phase C — DONE, reviewed 2026-09-10, APPROVE (reproduced: test:code PASS with fish-clearance, bore-containment and sky assertions inside it; feral soak 92 draws / 148,002 tris vs 110 / 180k, 0 missed gates, residual .72 frames). All four Codex heroes integrated (watchtower at scale 1.10 + 0.38 m offset — decision 5 ruling in the brief). Crossfade instrument + target as a measured delta, dark-sky gate clause with byte-identical control proof, fish drift at 8.442 m clearance, both-state shadow numbers, 14/14 atlas cells decided by quadrant-ID, validator --out. Evidence + eyeball contact sheet: art/evidence/dreamisland-v1/phase-c/. Reserve to the 110/180k gate: 18 draws / 32k tris. `test:code` now needs python3 + Pillow.

**Codex polish pass — DONE and reviewed 2026-09-11, APPROVE** (reproduced: test:code PASS; feral soak 93 draws / 151,404 tris vs 110 / 180k, 0 missed gates, residual +3.1 fr; crossfade T1/T2/T3 on a new polish baseline with bit-exact repeat; night road luma .1375 at blend 1, sky steps within 1.7x). Before/after: art/evidence/dreamisland-v1/polish/eyeball-before-after.png; strike flipbook polish/index.html. Reserve to the gate: 17 draws / 28.6k tris.

**Phase D — DONE, reviewed 2026-09-11, APPROVE** (reproduced: test:code PASS with per-mode schedule + persistence assertions; works sprint soak 2 laps, 0 missed gates, strike 5343 < flag 7831, night settled at the flag). Sprint runs a lap-scaled copy of the schedule (same 0.6833 fraction of the race, ramp/fish durations unscaled → settled night 8.6 s vs 19 s); timeattack ghost records on run 1 and replays on run 2; save peak 17,612 of 65,536 chars, sprint ghost evicted by the 2-ghost budget; ?laps= clamps [1,9] and race strikes only at laps ≥ 3 (2-lap race misses it by 1.53 s — by design). Route hash unchanged → no pace re-solve. Evidence art/evidence/dreamisland-v1/phase-d/. game.ts is at its 2577-line seam ceiling with ZERO headroom — the next change there forces a re-split. Time-attack paddock shows a phantom 4-car grid (cross-map, pre-existing, filed separately).

**Paddock grid fix — committed 23e6d8f** (generic, verified on Ascension; validate-race-modes §5). **Codex polish round 2 — DONE, reviewed 2026-09-11, APPROVE, 6 of 7** (reproduced: test:code PASS; feral 94 draws = 77+21 / 157,650 tris vs 110/180k; crossfade T1–T3 on a new baseline). The distant-beacon target (item 3) was withdrawn as an unmeasured number — see POLISH-2.md. Sheet: art/evidence/dreamisland-v1/polish/round-2/eyeball-before-after.png. Reserve: 16 draws / 22k tris.

**THE MAP IS SCOPE-COMPLETE (A–D + two polish rounds).** Open: user eyeball on polish/eyeball-before-after.png → optional second polish round; device verification (everything is headless desktop Chrome); snapshot/restore still not wired into gameplay (validator-only, by design).

**Codex hero track (parallel, docs/briefs/DREAM-ISLAND-CODEX-3D.md):** clock-tower, waterfall-cliff, sea-stack-set APPROVED; watchtower being REBUILT to the revised spec (28 m base → 20 m crown, 30 m tall, arched 14×8 bore, 14×10 clearance box). Evidence art/evidence/dreamisland-v1/heroes/. Integration into painted.json is a Phase C step: bind DI_MAT_* (incl. DI_MAT_jungle-card) to the shared atlases, replace the painted world's own four, re-measure draws against the reserve.

**Phase B — original in-flight note, kept for context:** An implementer was working on: B0 GROVE esses fix (≥3 alternating turns, radius 50–65 m) with the full re-calibration cascade; B1 atlases → `public/assets/dreamisland/textures/`; B2 painted Blender world (`art/blender/build_dreamisland_painted.py` → `public/assets/dreamisland/painted.glb` + `painted.json` with five named features per focal asset); B3 two-sampler sky dome `dreamisland_panorama` mixed by `nightBlend`; B4 water with night emissive edges; B5 evidence in `art/evidence/dreamisland-v1/phase-b/`. End-of-B gate: ≤ 110 total draws, ≤ 180,000 total triangles.

## First thing you do: establish the real state, do not trust this file's tense

```
cd /Users/gentlegen/Desktop/futurisma-race/polarity_work
git log --oneline -3          # is HEAD still 9109b6f, or did phase B land?
git status --short            # uncommitted phase-B work?
ls art/evidence/dreamisland-v1/   # phase-b/ present? read its README if so
```

Then decide which of these you are in:

1. **Tree clean, HEAD = 9109b6f, no `phase-b/` evidence** → Phase B never started or was lost. Start it from §10.B of the brief plus the Phase B scope below.
2. **Uncommitted Phase B work present** → do NOT discard it and do NOT commit it blind. Read `art/evidence/dreamisland-v1/phase-b/README.md` if it exists, run the four checks under "How to verify" below, and finish whatever the checks show unfinished. Then report; the orchestrator (or the user) commits.
3. **A commit after 9109b6f titled phase B** → Phase B landed. Verify it anyway (a green report is a premise, not a fact), then move to Phase C.

## How to verify any state (this is the review, not "tests pass")

```
export PATH=$HOME/.nvm/versions/node/v20.19.4/bin:$PATH
npm run test:code                                    # must PASS; both dreamisland validators are inside it
npx vite build && node scripts/validate-build.mjs    # gzip JS ≤ 266 KiB, shell ≤ 277 KiB — headroom is ~1 KiB, every dreamisland chunk must be lazy
# in another shell: npm run dev -- --host 127.0.0.1 --port 5200
node scripts/visual/dreamisland/race.mjs --tier=works --out=/tmp/di-review
#   expect 0 missedGates, minimumSurfaceGrip 0.85, draws ≤ the phase gate, sample residual printed beside p95
python3 scripts/visual/tideline-v4/sky-profile.py public/assets/dreamisland/sky-day.png     # if skies exist: 4096x1024, warm_step ≤ .05, ratio ≤ 2
```
Then LOOK at the frames the harness wrote (`day-grove.png`, `night-settled.png`). A visual change closes on a rendered-pixel check or a user eyeball, never on tests passing. Any atlas consumer must be proven with one known cell against its sheet (kerb samples the kerb quadrant, frond card samples the frond) — this repo shipped mirrored atlas rows for 13 phases once.

## Phase B scope (if you have to do or finish it)

Per-asset material roles, target metres and the five features are in the brief §7 and were expanded in the implementer's dispatch; the short form:
clock tower 14 m (C shaft/plinth/roof/stair, M ring+hands, E face) · watchtower 24 m tall / 16 m across, bore 14×8 m through the full depth (C, J ivy, E lamps) · waterfall + block cliff 16 m (C blocks, W scrolling sheet, E glow) · palms 7–11 m, 3 lean variants (J bark, jungle-card fronds) · undergrowth cards · goldfish set ≤ 200 tris, 4 liveries, static in the basin this phase · causeway module · reef pier with chevron launch strip · sea stacks · mossy block wall · kerb/strip/gate furniture with signage plates, letters ≤ 0.59 m, `signage-manifest.json`.
Sky: resample both 1344×576 sources to 4096×1024, pass `sky-profile.py`, one dome with two samplers mixed by `nightBlend` before tone mapping, named `dreamisland_panorama`, exempted by name in the material walk.
Water: lit materials only (no `toneMapped:false`, no `fog:false`); at night the foam line and shallows take an emissive term ∝ `nightBlend` — that glow defining the pier/shore edges is the map's whole racing argument for the night turn.
`painted.json` is fetched at runtime, never statically imported (byte headroom).

## Phase C (after B is verified)

The night turn's remaining half, per brief §5 and §10.C: build `scripts/visual/dreamisland/crossfade-profile.{mjs,py}` capturing the same pose at `nightBlend` 0/.25/.5/.75/1 **before** writing any luma target (there is none yet — a target written before that capture is an invented number and blocks review); fish drift on authored paths ≥ 6 m above the deck from `fish-rise`; waterfall/foam emissive tuning against the capture; shadow draw counts reported in BOTH lighting states (the key light never disarms — see §5); `?motion=reduce` acceptance per decision 6 (blend jumps 0→1 at `strikeTick`, no fish, no flicker). Budget: 35 draws / 40,000 triangles reserved for C.

## Phase D

Sprint, timeattack, solo ghost; pace re-solved if the route changed; `PRODUCT.md` gets decision 8's reading. Then the polish pass.

## Rules that are not optional here

- Never type a number that should be measured: schedule ticks come from `--calibration=`, cruise speeds from `scripts/solve-dreamisland-pace.mjs`, draws/triangles from the instrument (shadow pass probed separately — `renderer.info` excludes it), sky luma from `sky-profile.py`.
- Tag every claim VERIFIED (command/artifact) or UNVERIFIED (why). Reconcile sample counts before quoting a percentile.
- Use `grep`, not `rg` — this repo's ripgrep config rewrites matched text.
- Validators run from the repo root. They must be read-only, throw on failure, `mkdirSync` their evidence dir.
- Do not commit unless the user tells you to. If they do: one commit per phase, message ending `Co-Authored-By:` line as the repo's recent commits do.
- If the brief contradicts the code, follow the code and record the discrepancy with file:line.
- Every new dreamisland module stays lazily imported. `validate-build.mjs` pins this by name and the shell ceiling has 0.3 KiB spare.

## Report format expected

Files added/changed · numbers actually measured (with the command) · registration/asset checklist · budget table before/after vs the phase gate · validators and `test:code` result · soak table (laps, missed gates, p95 reconciled) · rendered-pixel atlas checks · discrepancies vs brief · open verification gaps · what is left undone and why.
