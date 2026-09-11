# Dream Island (Map 07) — phase C evidence

Branch `work/dream-island`, uncommitted. Node v20.19.4
(`export PATH=$HOME/.nvm/versions/node/v20.19.4/bin:$PATH`). Every browser
capture ran against `npm run dev -- --host 127.0.0.1 --port 5200` and the
headless Chrome in `scripts/visual/tideline-v4/browser.mjs` (1280x720,
ANGLE/Metal). Blender is 5.2.0 LTS. **Nothing here is a device measurement and
nothing here is a user eyeball.**

Phase A's and phase B's evidence sit beside this directory and are NOT
superseded. Phase C is the first phase whose validators write here rather than
into an earlier phase's record: `package.json` now passes
`--out=art/evidence/dreamisland-v1/phase-c/validators` to all three, and
`build_dreamisland_painted.py` writes its build record to `phase-c/build/`.

## The exact commands, in the order they have to run

```
export PATH=$HOME/.nvm/versions/node/v20.19.4/bin:$PATH
npm run dev -- --host 127.0.0.1 --port 5200          # in another shell

# C0/C1 skies and the gate amendment.
python3 scripts/visual/tideline-v4/sky-profile.py public/assets/ascension/horizon.png   sky-gate/before/ascension.json
python3 scripts/visual/tideline-v4/sky-profile.py public/assets/tideline-v4/horizon.jpg sky-gate/before/tideline-v4.json
#   ... amend scripts/visual/tideline-v4/sky-profile.py ...
python3 scripts/visual/tideline-v4/sky-profile.py public/assets/ascension/horizon.png   sky-gate/after/ascension.json
python3 scripts/visual/tideline-v4/sky-profile.py public/assets/tideline-v4/horizon.jpg sky-gate/after/tideline-v4.json
python3 scripts/prepare-dreamisland-skies.py                    # day source v2, --soften=0.25

# C2 the crossfade instrument, BEFORE any tuning.
node scripts/visual/dreamisland/crossfade-profile.mjs --out=art/evidence/dreamisland-v1/phase-c/crossfade
python3 scripts/visual/dreamisland/crossfade-profile.py art/evidence/dreamisland-v1/phase-c/crossfade
node scripts/visual/dreamisland/crossfade-profile.mjs --out=art/evidence/dreamisland-v1/phase-c/crossfade-repeat
python3 scripts/visual/dreamisland/crossfade-profile.py art/evidence/dreamisland-v1/phase-c/crossfade-repeat
#   ... only now is crossfade/crossfade-target.json written ...

# C3 heroes, C4 fish: the world is rebuilt without the four hero assets and with
# the goldfish split into two named shoals.
/Applications/Blender.app/Contents/MacOS/Blender -b --python art/blender/build_dreamisland_painted.py

# C5 the pier-edge contrast, before and after the two water fixes.
node scripts/visual/dreamisland/crossfade-profile.mjs --blends=1 --progress=0.72 --out=<before>
python3 scripts/visual/dreamisland/crossfade-profile.py <before>
#   ... fix dreamisland-water.ts ...
node scripts/visual/dreamisland/crossfade-profile.mjs --blends=1 --progress=0.72 --out=<after>

# C6 the quadrant-ID proof and the label lag.
node scripts/visual/dreamisland/atlas-quadrant-proof.mjs
node scripts/visual/dreamisland/atlas-proof.mjs --out=art/evidence/dreamisland-v1/phase-c/atlas-proof
python3 scripts/visual/dreamisland/atlas-proof.py    art/evidence/dreamisland-v1/phase-c/atlas-proof
node scripts/visual/dreamisland/label-lag.mjs > validators/label-lag.json

# Acceptance.
node scripts/validate-dreamisland.mjs         --out=art/evidence/dreamisland-v1/phase-c/validators
node scripts/validate-dreamisland-runtime.mjs --out=art/evidence/dreamisland-v1/phase-c/validators
node scripts/validate-dreamisland-painted.mjs --out=art/evidence/dreamisland-v1/phase-c/validators
node scripts/visual/dreamisland/crossfade-profile.mjs --out=art/evidence/dreamisland-v1/phase-c/crossfade-shipped
python3 scripts/visual/dreamisland/crossfade-profile.py art/evidence/dreamisland-v1/phase-c/crossfade-shipped
for t in works rookie feral; do node scripts/visual/dreamisland/race.mjs --tier=$t --out=art/evidence/dreamisland-v1/phase-c/soak-$t; done
node scripts/visual/dreamisland/race.mjs --tier=works --reduced --out=art/evidence/dreamisland-v1/phase-c/soak-works-reduced
node scripts/visual/dreamisland/frames.mjs --out=art/evidence/dreamisland-v1/phase-c/frames
python3 scripts/visual/dreamisland/contact-sheet.py
npm run test:code
```

## Files

| Path | Produced by | What it is |
|---|---|---|
| `sky-gate/before/*.json`, `sky-gate/after/*.json`, `sky-profile-{before,after}.py` | `sky-profile.py` | The dark-sky clause, proved inert. Ascension's and Tideline v4's records are **byte-identical** across the amendment (349,350 and 355,758 bytes, `cmp` clean); Dream Island's night record gains the dark-clause block because that is the only sky whose acceptance actually changed. |
| `skies/skies.json`, `skies/sky-profile-{day,night}.json` | `prepare-dreamisland-skies.py` | The revised day panorama and the unchanged night one, both accepted. The day source is now `sky-day-v2-gptimage2.png` with the recorded 25% cloud-contrast softening; the night file is byte-identical to phase B's. |
| `crossfade/` | `crossfade-profile.{mjs,py}` | **The base capture.** Five points of the ramp on one frozen BEACH pose, taken before anything in phase C was tuned. `crossfade-target.json` beside it is the midpoint target, written from these numbers and not before them. |
| `crossfade-repeat/` | the same, run again | The instrument's noise floor: an independent second five-point run reproduced every mean to all quoted digits, worst difference **0.000000**, identical pixel counts. |
| `crossfade-after-water-fix/` | the same | After the reef winding fix, before the beach lift. Shows the fix moved the BEACH pose by at most 0.00015 of luma — under one display level — while the REEF changed completely. |
| `crossfade-shipped/` | the same | The state that ships. All three targets still hold. |
| `pier-edge/{before,after}/` | the same at `--progress=0.72 --blends=1` | The REEF pose either side of the winding fix: the night state's racing argument, measured. |
| `atlas-quadrant-proof/` | `atlas-quadrant-proof.mjs` | **All fourteen atlas claims decided**, every one on the quadrant it names, with the sheet replaced by four flat colours so no chromatically adjacent pair can be ambiguous. |
| `atlas-proof/` | `atlas-proof.{mjs,py}` | The sheet proof re-run after the hero swap. Still nine of fourteen: the same five art-adjacency cases phase B recorded honestly. Kept because it is the check that measures the SHEET; the quadrant proof is the one that closes the obligation. |
| `build/model-build.json` | `build_dreamisland_painted.py` | The world as exported: 10 meshes, 64,944 triangles, 533 placements, with the four hero placements tagged `batch: "HERO"` and their contracts taken from `heroes.json`. |
| `validators/*.json`, `validators/test-code.log` | the three validators | Route, runtime (including the fish clearance sweep) and painted (including the bore containment and both sky gates). |
| `validators/label-lag.json` | `label-lag.mjs` | The one-station sector label lag, measured: 1 of 800, `gameplayAffected: false`. |
| `soak-*` | `race.mjs` | The four acceptance soaks with heroes, shoals and both water fixes in. |
| `frames/` | `frames.mjs` | The fourteen district frames re-shot after integration. |
| `eyeball-contact-sheet.png`, `.json` | `contact-sheet.py` | **The one image a person has to accept.** Day and night at BEACH/POINT/BASIN/REEF, the five crossfade points, and the two night fixes before and after. |

## What the numbers say

**Skies (C0/C1).** The day panorama is rebuilt from `sky-day-v2-gptimage2.png`
with cloud contrast softened 25% toward each sky row's own median, applied after
the resample over rows 0..0.75h — the operation recorded in the reference
`generation.json`. It measures **warm-step 0.046911, ratio 1.078317, accepted**
(the orchestrator's pre-built file measures 0.046564 / 1.077156; the 0.00035
difference is JPEG encoder settings, and no PIL quality/optimize/subsampling
combination reproduced that file's 541,689 bytes — the floor was a mean absolute
difference of 0.86/255, i.e. the same picture). The night panorama is unchanged
and now passes on the **dark-sky absolute spread** clause: band maximum luma
0.013667 is below 0.05, spread 0.011646 against a 0.02 limit. Both clauses are
named in the script's own output.

**The crossfade (C2), first measurement of its kind in this repo.**

| nightBlend | sky mean luma | sky mean warmth | road mean luma | sky pixels | road pixels |
|---|---|---|---|---|---|
| 0.00 | 0.70973 | −0.27386 | 0.42379 | 350,301 | 418,413 |
| 0.25 | 0.64833 | −0.28259 | 0.35736 | 350,301 | 418,418 |
| 0.50 | 0.56391 | −0.29087 | 0.28000 | 350,649 | 418,412 |
| 0.75 | 0.42737 | −0.29612 | 0.18967 | 350,321 | 418,442 |
| 1.00 | 0.02346 | −0.03417 | 0.08539 | 354,892 | 418,251 |

The finding that matters: **the sky is heavily back-loaded and the road is not.**
At blend 0.75 the sky still holds 60.2% of its day luma while the road holds
44.8%, and **58.8% of the whole sky luma fall happens in the last quarter of the
ramp**. That is a property of mixing two panoramas in linear light before tone
mapping, and it is the argument for getting the edge cues up early: the driver
loses long-range reference in the last three seconds of a twelve second ramp
rather than evenly across it.

**Both lighting states (C5).** The shadow pass is **17 draws / 23,624 triangles
in the day state, in the crossfade and in the night state** — minimum equals
maximum in all three, so it is not a peak that happens to coincide. The key light
falls 1.35 → 0.30 and the hemisphere 1.056 → 0.352 (read off the live lights in
`crossfade-shipped/crossfade-capture.json`). **The key is deliberately not near
black and casting stays armed**: 0.30 is a moon that still throws a readable
shadow under the craft, the pass costs the same either way because `castShadow`
is armed once in `installLighting` and nothing re-arms it, and nothing the
painted world or the heroes adds casts at all.

**The night edge cue (C5), and two defects it uncovered.** See §8b of
`docs/briefs/DREAM-ISLAND-LEVEL.md` for the full scars. In short: the reef's
left-hand shallows and foam were wound backwards and backface-culled (0 lit
pixels in the left half of the screen), and the beach foam rail was authored
below the single 7.2 km sea plane and covered by it (0 glow pixels at all five
blends). Both are fixed and both are measured:

| pose | before | after |
|---|---|---|
| REEF, blend 1 | 45,135 glow pixels, left half 0 | 90,041 glow pixels, left half 59,697 |
| REEF, blend 1, contrast | 0.40549 (glow 0.41588 vs sea 0.01040) | 0.39990 (glow 0.42132 vs sea 0.02142) |
| BEACH, blend 1 | 0 glow pixels, no contrast to measure | 24,125 glow pixels, contrast 0.41221 |

**No emissive multiplier was changed.** The two fixes restored the cue that was
missing; a further tweak to `1.45` / `1.15` / `1.25` would be a multiplier on a
small constant with no acceptance criterion behind it, which this project treats
as a way to ship an invisible change. The instrument now exists for that tuning
whenever a person has looked at the sheet.

**Fish (C4).** Two shoals of four, on closed paths authored in ROUTE space in
`src/game/data/dreamisland/fish-paths.json`, read by both the Blender build and
the runtime. Minimum clearance of the lowest point of the real geometry above
the deck, wherever a fish is genuinely over the road: **8.442 m** against a 6 m
floor. Two independent measurements agree to three decimals — the runtime
counter over the race (4,067 on-deck samples) and the validator's own
re-implementation over the rise plus two full circuits at one-tick resolution
(21,249 on-deck samples). Under `?motion=reduce` the shoals never spawn:
`fishVisible` 0, `fishDeckSamples` 0.

**Reduced motion (C5/decision 6).** The reduced soak records **no crossfade
state at all** (`lightingStates.crossfade` is null — the blend is only ever 0 or
1), grip drops on the same tick, and **0 frames out of 3,810 settled-state
comparisons show any emissive intensity change**, sampled off the live materials
inside the render wrapper. The works soak reads 0 of 2,314 the same way.

**Budget.** Ceilings for the end of this phase are 110 total draws and 180,000
total triangles; the map ceiling is 145 / 220,000 including the shadow pass.

| Stage | Draws (main + shadow) | Triangles (main + shadow) | p95 |
|---|---|---|---|
| end of phase B, works *(read from phase B's record, not re-measured here)* | 63 + 17 = 80 | 110,274 + 23,624 = 133,898 | 8.40 ms |
| after C3 heroes, works | 74 + 17 = 91 | 124,794 + 23,624 = 148,418 | 8.40 ms |
| shipped, works | 74 + 17 = 91 | 124,282 + 23,624 = 147,906 | 8.50 ms |
| shipped, rookie | 74 + 17 = 91 | 124,282 + 23,624 = 147,906 | 8.50 ms |
| shipped, feral | 75 + 17 = 92 | 124,378 + 23,624 = 148,002 | 8.50 ms |
| shipped, works reduced | 74 + 17 = 91 | 123,852 + 23,624 = 147,476 | 8.40 ms |

Worst case is feral: **92 of 110 draws, 148,002 of 180,000 triangles**, leaving
18 draws and 31,998 triangles to the phase gate. The eleven draws phase C spent
reconcile exactly: the painted world lost its `water` batch when the waterfall
left it (−1) and gained a second shoal batch (+2), and the four heroes cost 12.
Forty-two hero source meshes across nine placements merged to twelve.

p95 is quoted only because the sample reconciliation holds: 720 frames per
window against 718.0 / 719.7 / 725.4 / 722.6 expected at the separately
calibrated rate — residuals +2.0, +0.3, −5.4, −2.6 frames, at worst 0.74%.
Nothing in this repo gates p95.

**Atlas proof.** The quadrant-ID instrument decides **all fourteen claims** in
favour of the quadrant they name, with margins of 177–283 in RGB distance where
the maximum possible separation between the four ID colours is about 360, and
mask sizes from 774 pixels (the gate markers) to 921,600 (the sea). Seventeen
materials were swapped. The five cases the sheet proof still cannot decide
(road-deck, frond-card, gate-markers, causeway-paving, signage-plate) are
recorded as decided **by the quadrant proof**, which is the stronger instrument
for exactly the reason they were undecided: the ambiguity was in the art, not
the UVs.

## What this evidence does NOT show

* **No user has eyeballed anything yet.** `eyeball-contact-sheet.png` is the
  whole ask. Phase B's look was never accepted and phase C's is not either.
* **The watchtower placement deviates from decision 5** and needs a ruling. The
  hero is placed at scale 1.10 with a 0.38 m lateral offset because a 14 m bore
  cannot contain a 14 m road across the hero's own 28.5 m depth on this route.
  The measurement is in `validators/painted-validation.json` under `bore`.
* **Nothing here measures a device.** Every capture is desktop headless Chrome
  on ANGLE/Metal at 1280x720.
* **The day/night draw split is confounded by where on the lap each state
  occurs.** `lightingStates` splits frames by `nightBlend`, and the night frames
  are the last lap, so the lower night main-call peak (71 against 74) is the
  camera's position, not the lighting's. The shadow columns are not confounded:
  they are identical in every state.
* **`?nightBlend=` is a review-only pin.** It is honoured only alongside
  `?diagnostics` and it is visual only — grip still comes from
  `schedule.grip(sector, tick)` — so nothing measured through it says anything
  about how the ramp behaves in a played race. That is what the soaks are for.
