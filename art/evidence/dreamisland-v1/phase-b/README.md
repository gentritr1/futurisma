# Dream Island (Map 07) — phase B evidence

Branch `work/dream-island`, uncommitted. Node v20.19.4
(`export PATH=$HOME/.nvm/versions/node/v20.19.4/bin:$PATH`). Every browser
capture ran against `npm run dev -- --host 127.0.0.1 --port 5200` and the
headless Chrome in `scripts/visual/tideline-v4/browser.mjs` (1280x720,
ANGLE/Metal). Blender is 5.2.0 LTS.

Phase A's evidence is beside this directory in `../phase-a/` and is NOT
superseded: it is the record of the route this phase revised.

## The exact commands, in the order they have to run

```
export PATH=$HOME/.nvm/versions/node/v20.19.4/bin:$PATH
npm run dev -- --host 127.0.0.1 --port 5200          # in another shell

# B0 route revision. Changing the GROVE wave moves where the loop ends, so the
# six section net turns are re-solved for closure before anything is built.
node scripts/design/solve-dreamisland-closure.mjs --grove-lobes=5 --grove-amplitude=0.0172
node scripts/measure-dreamisland-route.mjs \
  --out=../art/evidence/dreamisland-v1/phase-b/route-revision/curvature-before.json
node scripts/build-dreamisland-route.mjs
node scripts/measure-dreamisland-route.mjs \
  --out=../art/evidence/dreamisland-v1/phase-b/route-revision/curvature-after.json

# The cascade. A new route means a new lap time, so every tick, every rival
# cruise speed and every soak below is re-derived, never carried over.
node scripts/visual/dreamisland/race.mjs --calibrate \
  --out=art/evidence/dreamisland-v1/phase-b/route-revision/calibration
mv art/evidence/dreamisland-v1/phase-b/route-revision/calibration/race.json \
   art/evidence/dreamisland-v1/phase-b/route-revision/calibration/works-calibration.json
node scripts/build-dreamisland-route.mjs \
  --calibration=art/evidence/dreamisland-v1/phase-b/route-revision/calibration/works-calibration.json
node scripts/solve-dreamisland-pace.mjs --out=art/evidence/dreamisland-v1/phase-b/route-revision
node scripts/validate-dreamisland.mjs
node scripts/validate-dreamisland-runtime.mjs
for t in works rookie feral; do
  node scripts/visual/dreamisland/race.mjs --tier=$t \
    --out=art/evidence/dreamisland-v1/phase-b/route-revision/soak-$t
done
node scripts/visual/dreamisland/race.mjs --tier=works --reduced \
  --out=art/evidence/dreamisland-v1/phase-b/route-revision/soak-works-reduced

# B1 atlases, B3 skies.
python3 scripts/prepare-dreamisland-atlases.py
python3 scripts/prepare-dreamisland-skies.py          # exits 1: see "Skies" below

# B2 painted world.
/Applications/Blender.app/Contents/MacOS/Blender -b --python art/blender/build_dreamisland_painted.py
node scripts/validate-dreamisland-painted.mjs

# B5 evidence.
node scripts/visual/dreamisland/atlas-proof.mjs
python3 scripts/visual/dreamisland/atlas-proof.py
node scripts/visual/dreamisland/frames.mjs
for t in works rookie feral; do
  node scripts/visual/dreamisland/race.mjs --tier=$t \
    --out=art/evidence/dreamisland-v1/phase-b/soak-$t
done
node scripts/visual/dreamisland/race.mjs --tier=works --reduced \
  --out=art/evidence/dreamisland-v1/phase-b/soak-works-reduced
npx vite build && node scripts/validate-build.mjs
npm run test:code
```

## Files

| Path | Produced by | What it is |
|---|---|---|
| `route-revision/closure-solve.json`, `…-phase-a-shape.json` | `scripts/design/solve-dreamisland-closure.mjs` | The six section net turns re-solved for closure with the new wave, and the same solve run on the phase-A wave as a control. Every correction to a district other than GROVE is under 0.13 degrees. |
| `route-revision/curvature-before.json` | `scripts/measure-dreamisland-route.mjs` | Per-district minimum radius, alternating turns and fold guard on the phase-A route. GROVE: 87.85 m, three turns. |
| `route-revision/curvature-after.json` | same script, after the rebuild | The same measurement on the revised route. GROVE: 55.95 m, five alternating turns. |
| `route-revision/calibration/works-calibration.json` | `race.mjs --calibrate` | The measuring run for the NEW route. `?calibrate=1` passes a null config, so the scheduler is inert and the laps in it are free of the schedule they define. This file is named inside `src/game/data/dreamisland/schedule.json`. |
| `route-revision/pace-solve.json` | `scripts/solve-dreamisland-pace.mjs` | Cruise speeds re-bisected against the new player total. The solver now reads whichever capture the PUBLISHED schedule names, so a route revision cannot leave the field solved against a lap that no longer exists. |
| `route-revision/soak-*` | `race.mjs --tier=…` | Four soaks on the revised route with the phase-A blockout still in place. This is the BEFORE half of the draw/triangle table. |
| `atlases/atlas-manifest.json` | `scripts/prepare-dreamisland-atlases.py` | Copy of the served manifest: every UV rect by role and quadrant, what it is, the wrap error before and after, the posterise parameters and the sha256 of every written file. |
| `atlases/posterise-strip.png` | same script | Raw left, flattened right, for concrete TL/TR and water TL/TR. This is the before/after the posterise decision was made on. |
| `skies/skies.json`, `skies/sky-profile-{day,night}.json` | `scripts/prepare-dreamisland-skies.py` | Resample, seam measurement and the still-image gate for both panoramas. **Both fail the gate**; see below. |
| `build/model-build.json` | `art/blender/build_dreamisland_painted.py` | The manifest as exported: 9 meshes, 67,526 triangles, 533 placements, 18 assets with five features and a target-versus-measured line each. |
| `painted-validation.json` | `scripts/validate-dreamisland-painted.mjs` | Five features per asset, target metres, atlas cells agreeing with the manifest ACROSS THE V FLIP, the signage cap, and 9,729 corridor rays with zero intrusions. |
| `atlas-proof/*.png`, `atlas-proof.json` | `scripts/visual/dreamisland/atlas-proof.mjs` | One isolation frame and one background frame per claim, plus the UV census taken off the shipped buffers. |
| `atlas-proof/atlas-proof-decision.json` | `scripts/visual/dreamisland/atlas-proof.py` | The pixel decision: which quadrant each consumer actually drew. 8 of 13 decided in favour of the named quadrant; the other five are recorded honestly below. |
| `frames/*.png`, `frames/frames.json` | `scripts/visual/dreamisland/frames.mjs` | One chase-height frame per district by day and by night — fourteen — with the measured `nightBlend`, grip and painted-module counters beside each. |
| `soak-*` | `race.mjs` | The four acceptance soaks with the painted world in. This is the AFTER half of the table. |
| `route-validation.json`, `runtime-validation.json` | the two phase-A validators | Copies taken after the route revision. **`scripts/validate-dreamisland.mjs` and `…-runtime.mjs` write into `../phase-a/` unconditionally**, so running them overwrites phase A's own record with the revised route's numbers; the originals were restored from `9109b6f` and these copies are the phase-B reading. Worth parameterising before the next revision. |

The two phase-A poses are still captured by every soak: `soak-works/day-grove.png`
and `soak-works/night-settled.png`, each with its diagnostics blob.

## What the numbers say

**Route (B0).** GROVE went from a single 87.85 m sweeper to five alternating
turns of 55.95 / 59.3 / 56.2 / 59.6 / 55.9 m — RIGHT, LEFT, RIGHT, LEFT, RIGHT.
Every other district's arc length is unchanged (300 / 380 / 260 / 300 / 340 /
460 / 360 m), the loop is 2,400.0 m, station gaps run 2.9995–3.0000 m including
the closing seam, the fold guard peaks at 0.229 (limit 0.8) and pitch at 5.30
degrees (limit 10.5). The measured Works lap moved 31.388 s → **32.579 s**, so
`strikeTick` moved 7,533 → **8,014** and the strike still lands inside lap 3:
laps 1 and 2 of the calibration run total 66.166 s against a strike at 66.783 s.

**Budget.** Ceilings for the end of this phase are 110 total draws and 180,000
total triangles (main plus shadow), leaving 35 / 40,000 for phase C.

| Soak | Draws (main + shadow) | Triangles (main + shadow) | p95 |
|---|---|---|---|
| works, before art | 53 + 17 = 70 | 41,536 + 23,624 = 65,160 | 8.30 ms |
| works, after | 63 + 17 = 80 | 110,274 + 23,624 = 133,898 | 8.40 ms |
| rookie, after | 63 + 17 = 80 | 110,274 + 23,624 = 133,898 | 8.40 ms |
| feral, after | 64 + 17 = 81 | 111,064 + 23,624 = 134,688 | 8.40 ms |
| works reduced, after | 63 + 17 = 80 | 110,274 + 23,624 = 133,898 | 8.40 ms |

The worst case is feral: **81 of 110 draws, 134,688 of 180,000 triangles**. The
shadow pass is unchanged at 17 draws / 23,624 triangles in both lighting states,
because nothing the painted world adds casts: `castShadow` is set false on every
mesh it loads, which is what the two shipped maps do with their static
environment.

p95 is quoted only because the sample reconciliation holds: 720 frames in a
window whose measured length implies 719.5–727.8 at the separately calibrated
rate, a residual between −7.8 and +0.5 frames (≤1.1%). Nothing in this repo
gates p95; it is reported, never enforced.

**Skies.** Both panoramas resample cleanly and both FAIL the existing
still-image gate, for different reasons, and neither failure is caused by the
conversion:

* day — ten-degree warmth step **0.1260**, limit 0.05. Measured on the NATIVE
  1344x576 source it is 0.1255, so the resample contributes 0.0005: the drift is
  the source's own uneven cloud coverage. It gets worse, not better, if the
  horizon haze band is excluded (0.1405 over rows 0..0.70h).
* night — sky-band luma max/min ratio **6.76**, limit 2. The band's absolute
  luma runs 0.00202 to 0.01367, a spread of 0.0117 on a 0–1 scale, or about
  three display levels: the ratio is dominated by a denominator near zero. The
  same source measures 6.60 before any resample.

Controls, so the gate is known to be passable: Ascension's shipped
`horizon.png` measures 0.0366 / 1.206 and Tideline v4's `horizon.jpg` measures
0.0062 / 1.120, both accepted. The seam check the brief asks for passes on both
Dream Island skies: mean |Δ| between the first and last column is 0.0142 (day)
and 0.0062 (night) against a 6/255 = 0.0235 limit.

**Atlas proof.** The claim is that each consumer draws the quadrant it names.
The instrument isolates the shipped mesh over the longest contiguous run of its
own index buffer whose UVs land in the claimed rect, renders it unlit (base
colour black, map on emissive, vertex tint off, fog off, tone mapping off) so
the rendered pixel is the served texel, and compares the masked pixels against
all four quadrants of that role decoded from the file. Eight of thirteen decide
in favour of the named quadrant. The other five are recorded, not hidden:

| Claim | Named | Nearest | Margin | Reading |
|---|---|---|---|---|
| road-deck | concrete TL road-sand | BR wall-block | 0.030 | sand road against limestone block: both pale grey-tan |
| frond-card | jungle-card TL frond | BL blossom-shrub | 0.013 | two green foliage sprites |
| gate-markers | metal TR rail | TL chevron-strip | 0.056 | two grey steels, 774 masked pixels |
| causeway-paving | concrete TR paving | BR wall-block | 0.009 | two grey stones |
| signage-plate | signage TL plate | — | — | 21 masked pixels; the 0.62 m plate never covered enough of a frame |

Every one of the five is a chromatically adjacent pair or too small a sample,
not a wrong rect: the geometric half of the same instrument shows all 1,600
road-deck triangles, all 8,232 kerb triangles and all 4,620 frond triangles with
their UVs inside the rect they name, and
`scripts/validate-dreamisland-painted.mjs` asserts the runtime's cells equal the
manifest's across the V flip. **This is the part of phase B most worth a
sceptical second pass**, and the five rows above are what to attack.

The instrument earned its keep twice. It is what found the V-convention defect —
the road named the road-sand quadrant and a `flipY:false` sampler put it on the
cyan kerb stone one quadrant below, so a sand road drew teal at speed — and it
is what found the shallows rendering black in an earlier version of the proof
itself, because the environment rewrites `emissiveIntensity` every frame.

## What this evidence does NOT show

* **No user has eyeballed the look.** The fourteen district frames, the
  posterise strip and the isolation frames are numbers and pictures; the
  proportions, the palette, the density of the grove and the readability of the
  night state are taste calls and phase B does not close them.
* **The night turn is still phase C.** `nightBlend` drives the two-sampler dome,
  the water's emissive term and the sea's darkening, and the fourteen frames
  show both settled states — but no crossfade instrument exists yet and no
  midpoint target has been written, exactly as the brief requires it not to be.
* **The two failing sky gates are unresolved.** They need a re-generated day
  panorama with a more even cloud field, which is an image-generation job this
  phase was explicitly not allowed to run, and an instrument amendment for
  near-black skies that should be decided rather than assumed.
* **Nothing here measures a device.** Every capture is desktop headless Chrome
  on ANGLE/Metal.
