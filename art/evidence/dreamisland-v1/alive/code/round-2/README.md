# Dream Island — Phase F "ALIVE", F-CODE **round 2**

The six REQUEST CHANGES items of `docs/briefs/DREAM-ISLAND-ALIVE.md` §11.
Branch `work/dream-island-alive`. **Nothing is committed.**

Round 1's evidence is the directory above this one; this directory holds only
what round 2 produced. Every number in the report is one of the commands below.

## Environment

```
export PATH=$HOME/.nvm/versions/node/v20.19.4/bin:$PATH
cd /Users/gentlegen/Desktop/futurisma-race/polarity_work
npx vite --host 127.0.0.1 --port 5210 --strictPort          # the dev server
npx vite build
npx vite preview --host 127.0.0.1 --port 5211 --strictPort  # the production build
```

**Round 1 needed a production build for any frame of the HUD. Round 2 does
not** — that is item 1. Everything below except the dev-vs-build parity check
runs against the dev server on 5210.

## The commands

```
# item 1 — the skin on both servers, and the control that reads the noise
node scripts/visual/dreamisland/alive-skin-parity.mjs --base=http://127.0.0.1:5210 --out=<R>/skin/dev
node scripts/visual/dreamisland/alive-skin-parity.mjs --base=http://127.0.0.1:5211 --out=<R>/skin/preview

# item 2 — the faces (provenance, licence and hashes in public/assets/dreamisland/fonts/README.md)
npx vite build && node scripts/validate-build.mjs

# item 3 — contrast
node scripts/visual/dreamisland/alive-contrast.mjs --base=http://127.0.0.1:5210
python3 scripts/visual/dreamisland/alive-contrast.py

# item 4 — the toys, authored then counted
node scripts/author-dreamisland-props.mjs
node scripts/visual/dreamisland/alive-toys.mjs --base=http://127.0.0.1:5210
python3 scripts/visual/dreamisland/alive-toys.py

# item 5 — the capsule
node scripts/visual/dreamisland/alive-capsule-pixels.mjs --base=http://127.0.0.1:5210 --out=<R>/capsule
python3 scripts/visual/dreamisland/alive-capsule-pixels.py <R>/capsule

# item 6 — the bubble, measured off the DOM
node scripts/visual/dreamisland/alive-bubble-size.mjs --base=http://127.0.0.1:5210

# the rest
npm run test:code
node scripts/visual/dreamisland/race.mjs --tier=<rookie|works|feral> [--reduced] --base=http://127.0.0.1:5210 --out=<R>/soaks/<tier>
node scripts/visual/dreamisland/alive-hud.mjs --base=http://127.0.0.1:5210 --size=1440x810 --out=<R>/hud-1440
node scripts/visual/dreamisland/greenwater-hud.mjs --base=http://127.0.0.1:5210 --out=<R>/greenwater/<before|after>
```

`<R>` is `art/evidence/dreamisland-v1/alive/code/round-2`.

---

## 1. The skin applies on the dev server

`src/style-dreamisland.css` moved to `src/game/style-dreamisland.css` and is no
longer imported. `dreamisland-hud.ts` appends

```js
skin.href = new URL('./style-dreamisland.css', import.meta.url).href;
```

and removes the link on dispose. In dev that resolves to
`/src/game/style-dreamisland.css`, which Vite serves as `text/css` to a request
whose `Sec-Fetch-Dest` is `style`; in a build it is the hashed asset Vite emits
beside the chunk. Either way the CSP sees a stylesheet from this origin.

`race.mjs` no longer carries its ignored-CSP exception: every console error
fails a soak again.

**`skin/diff.json`** — and the honest verdict is *not* "pixel-identical":

| comparison | differing pixels of 1,166,400 | max channel delta |
|---|---:|---:|
| dev vs preview | **136** | **1** |
| CONTROL: preview run A vs preview run B, same server | **3,763** | **3** |
| CONTROL: dev vs dev repeat, same server | 0 | 0 |

Two runs against the *same* server, in two browser launches, differ 27× more
than the two servers do. Both differences sit inside the chrome conic gradients
of the position and speed roundels — GPU rasterisation noise between browser
processes. What *is* exact: `src/game/style-dreamisland.css` and
`dist/assets/style-dreamisland-xz9KTEfQ.css` are byte-identical (sha256
`9168e602…`), both woff2 are byte-identical between `public/` and `dist/`, and
the computed skin is the same on both pages — one stylesheet link, zero injected
`<style>` tags, lap plate radius 999px, slot font Michroma, bubble pill 45.09px.

## 2. The two faces, self-hosted

`public/assets/dreamisland/fonts/`, SIL OFL 1.1, licence and provenance in the
`README.md` beside them.

| file | bytes | sha256 |
|---|---:|---|
| `michroma-latin-v21.woff2` | 11,620 | `b1209818…` |
| `share-tech-mono-latin-v16.woff2` | 7,408 | `73b87eb7…` |
| **served total** | **19,028** | ceiling **20,931** = measured + 10 % |

`@font-face` lives in the island stylesheet only, `font-display: swap`, latin
subset only. `validate-build.mjs` asserts the two filenames, that each begins
with a `wOF2` signature, the byte ceiling, and that the shell references
neither.

## 3. Day and night legibility

`scripts/visual/dreamisland/alive-contrast.{mjs,py}`, four poses at 1440×810.

**158 text elements, 0 below 4.5:1.** Worst per pose:

| pose | worst ratio | element |
|---|---:|---|
| day BEACH | 4.78 | `.di-bubble__advice` |
| day COURT | 5.28 | `.field-order .gap` |
| day REEF | **4.79** | `#finish-value` |
| night COURT | 7.84 | — |

Before the fix, 68 of 188 were under the gate, the worst at 1.12:1. The fix is
glass, not darker ink: the gate strip, the race clock, the plasma labels, the
bottom-left ability block and the header identity all gained the pill recipe;
the day glass went from 62 % to 94 % opacity because cobalt's luminance of 0.056
needs a ground at 0.427 to make 4.5:1; the night glass went darker and more
opaque for the same reason in reverse; and the gel highlight now scales with
`--di-night`, because a fixed 50 % white top stop was lifting the *night* pill to
a mid grey and it was the pill, not the scene, that was failing.

Two measurement bugs were found and fixed before any of that was believed, and
both would have produced a confident wrong answer:

- every colour in this skin is a `color-mix(in oklab, …)` and
  `getComputedStyle().color` hands it back as `oklab(0.94 0.06 0.02)`. Reading
  three numbers out of that as R, G and B scored bright cyan on a near-black
  night road at **1.01:1**. The ink is now resolved to sRGB by the browser
  itself, through a 1×1 canvas.
- `.di-bubble` carries `opacity: 0` until it is active while its children stay
  at 1, so a visibility check on the element alone measured the *hidden*
  bubble's stale text against the sky and reported it as the frame's worst
  contrast. The walk now tests effective visibility up the tree.

## 4. Toys at the road edge

`props.json` regenerated by `scripts/author-dreamisland-props.mjs`.

| rule | required | measured |
|---|---|---:|
| balls and rings in halfWidth + 1.5 … + 10 m | ≥ 60 % | **91.7 %** (66 of 72) |
| ball diameter | ≥ 1.8 m | **2.25 – 3.30 m** |
| spheres in halfWidth + 2 … + 12 m at 2–6 m | ≥ 1/3 | **41.7 %** (25 of 60) |
| counts | 44 / 28 / 60 | **44 balls, 28 rings, 60 spheres** |

Acceptance, `toys/toys.json`, autopilot chase pose at each district's
mid-point, 1440×810, counted by the isolation method the capsule table uses:

| pose | balls and rings ≥ 20 px | with spheres | tallest |
|---|---:|---:|---|
| day BEACH | **4** of 8 drawn | 6 of 18 | 95, 45, 30, 23 px |
| day COURT | **7** of 25 drawn | 7 of 37 | 63, 40, 34, 32 px |
| day REEF | **4** of 25 drawn | 5 of 40 | 48, 45, 38, 36 px |

The gate is four; it passes on balls and rings alone, so the wider reading is
reported but not needed.

**The near band is a grid, not a scatter, and that is the point.** The first
three attempts scattered the toys and counted: 4/4/3, then 5/5/3, then 5/3/4,
then 4/7/2. Every change to a count re-rolled the seeded generator and re-rolled
the answer — a die being thrown, not a placement being tuned. The near toys now
sit one every 16 m of road with no jitter along the road, and 16 m is arithmetic:
a 2.8 m ball subtends 20 px at 1440×810 through a 62° camera at 94 m, a toy
nearer than ~30 m is off the side of the frame, so the window is ~64 m of road
and one toy every 16 m puts four in it with one spare.

The runtime's corridor guard refused two versions of this data before it was
right — `PR_ball at progress 0.1061 lateral 14.23 clears the deck by -2.494 m` —
so the lateral offset now carries each toy's own half-extent rather than a
constant, in the near band and the far band both. `validate:dreamisland-painted`
still reports the corridor clear, with every prop in the ray scene.

## 5. The capsule

Instance scale ×2.2 on the matrix; the GLB is untouched and still 3 m at scale
1. Column 3 m wide, ring 6 m across.

| state | 300 m | 150 m | 40 m |
|---|---|---|---|
| day — capsule | 14 px | 28 px | **81 px** |
| day — column width | 7 px | **20 px** | 47 px |
| night — capsule | 14 px | 28 px | **81 px** |
| night — column width | 7 px | **20 px** | 47 px |

Gates: capsule ≥ 70 px at 40 m, column ≥ 12 px wide at 150 m. Both met.

**The capsule has no collision.** It is a visual; the pickup is the existing
progress-and-lateral trigger in `polarity-simulation.js`, unchanged. The
corridor rule does not apply to it and the corridor validator does not see it.

**One number moved that §11 did not name.** At ×2.2 the capsule reaches 3.3 m
below its own centre, so the 2.2 m rise §4.4 set buried 1.1 m of it in the
tarmac — measured, and photographed in `capsule-rise/`. The rise is now 3.8 m,
which puts its lowest point 0.5 m clear of the deck and matches the reference
painting, where the capsule floats with the ring on the road beneath it. The
pixel height is unchanged by the move: 80 px at 40 m before, 81 px after.

## 6. The world bubble

`bubble/bubble.json`, measured off the DOM at 1440×810 in a live race, sampled
until both labels had been seen:

| | gate | measured (worst of the samples) |
|---|---|---|
| name font | ≥ 20 px Michroma | **21 px, Michroma** |
| pill height | ≥ 40 px | **45 px** |
| chevron below the pill | yes | **yes, in every sample** |
| name inside the pill | — | **yes, in every sample** |
| bob | ± 5 px | ± 5 px |

Labels sampled: `SURGE`, `PHASE SHIELD`. The bubble is anchored by its chevron
tip now, not its centre, so the pill sits above the capsule and the chevron
points at it.

---

## The rest of the round-2 gates

### `npm run test:code`

**PASS**, exit 0, with `validate:security` (the island HUD builds its DOM with
`createElement`, never a markup string), `validate:dreamisland-runtime`
(60/120/240 Hz byte-identical), `validate:dreamisland-painted` (corridor clear
over 9,729 rays with every prop in the ray scene) and `validate-build` inside it.

### Four soaks — `soaks/ceilings.json`

| tier | draws (main+shadow) | triangles | p95 | window / expected (residual) | missed gates | material violations | console errors |
|---|---:|---:|---:|---|---:|---:|---:|
| rookie | **123** = 104 + 23 | **192,172** | 8.70 ms | 720 / 721.7 (−1.66) | 0 | 0 | 0 |
| works | **123** = 104 + 23 | **192,172** | 8.60 ms | 720 / 717.2 (+2.80) | 0 | 0 | 0 |
| feral | **124** = 104 + 23 | **192,268** | 8.70 ms | 720 / 724.3 (−4.32) | 0 | 0 | 0 |
| works, `?motion=reduce` | **120** = 103 + 23 | **188,524** | 8.70 ms | 720 / 721.8 (−1.77) | 0 | 0 | 0 |
| **ceiling** | ≤ 130 | ≤ 205,000 | ≤ 11.0 report-only | — | 0 | 0 | — |

Draws are unchanged from round 1. Triangles rose 185,612 → 192,172 (+6,560):
the doubled toys and the ×2.2 capsule. 12,732 triangles of headroom remain. The
largest sample residual is 4.32 frames of 720, 0.6 %.

**The console-error column is the point of item 1.** `race.mjs` no longer
ignores anything, and all four soaks run clean.

Laps are byte-identical to the shipped calibration on every tier except feral,
which is the pre-existing tier behaviour: 33,158 / 32,125 / 31,925 ms.

### Greenwater — `greenwater/diff.json`

**0 differing pixels, max channel delta 0.** Three before-runs (the three shared
files reverted to `eafe0b9`) and two after-runs, five identical sha256
`f50151d3f835bfce…` — the same hash round 1 measured. Greenwater never imports
the island chunk, so neither the new stylesheet link nor the two faces reach it.

### Bytes

| | round 1 | round 2 | ceiling |
|---|---:|---:|---:|
| shell gzip | 277.233 KiB | **277.222 KiB** | 277.5 |
| initial JS raw | 972.1 KiB | **972.0 KiB** | 973 |
| island lazy chunk gzip | 93.39 KiB | **99.90 KiB** over 6 files | **109.89 KiB** = measured + 10 % |
| island faces served | — | **19,028 B** over 2 woff2 | **20,931 B** = measured + 10 % |

The shell did not grow; the skin moved OUT of the JS chunk and into an asset, so
the island chunk's stylesheet went 2.4 KiB → 7.1 KiB gzip (it is no longer
minified, being copied rather than pipelined) and the rest is the glass
backings, the `@font-face` rules and the doubled prop placements.
`validate-build.mjs` now counts `style-dreamisland-*.css` in the island total —
a pattern that only matched `dreamisland-*` had quietly stopped counting it the
moment the skin moved.
