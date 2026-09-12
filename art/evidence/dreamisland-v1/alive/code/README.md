# Dream Island — Phase F "ALIVE", F-CODE evidence

Branch `work/dream-island-alive`, from `eafe0b9`. **Nothing is committed.**

Everything in this directory was produced by the commands below, in this order.
Every number in the report is one of these commands' output; nothing here is
typed from memory.

## Environment

```
export PATH=$HOME/.nvm/versions/node/v20.19.4/bin:$PATH
cd /Users/gentlegen/Desktop/futurisma-race/polarity_work
```

Two servers, because two different things have to be proved on two different
builds:

```
# the DEV server, for everything that needs scripts/visual/dreamisland/instrument.mjs
# (it rewrites /src/game/game.ts on the way through, which only a dev server serves)
npx vite --host 127.0.0.1 --port 5210 --strictPort

# a PRODUCTION preview, for everything that needs the HUD SKIN
npx vite build
npx vite preview --host 127.0.0.1 --port 5211 --strictPort
```

**Why the skin needs a production build.** `src/style-dreamisland.css` is
imported from `dreamisland-runtime.ts`, so Vite emits it with the island's lazy
chunk — in a production build, as a `<link>` to a file on the site's own origin,
which the shipped `style-src 'self'` allows. The **dev server** delivers the
same import by injecting a `<style>` element, and that same policy blocks it:
on `127.0.0.1:5210` the island's skin is simply absent and the console carries
one CSP violation per island load. It is a property of Vite's dev delivery, not
of the game. `race.mjs` records that one message under `ignoredErrors` and still
fails on every other console error; `alive-hud.mjs` refuses to run without an
explicit `--base` and aborts if the skin is not applied.

## The commands

### Data the pass authors (deterministic; re-running regenerates byte for byte)

```
node scripts/author-dreamisland-props.mjs      # -> src/game/data/dreamisland/props.json
node scripts/author-dreamisland-shoals.mjs     # -> appends six shoals to fish-paths.json
```

### Validators

```
npm run test:code                              # PASS, the whole suite
npm run validate:dreamisland-runtime           # determinism + the fish floors
npm run validate:dreamisland-painted           # the corridor, now with the props in the ray scene
npx vite build && node scripts/validate-build.mjs
```

### Soaks — `soaks/`

```
node scripts/visual/dreamisland/race.mjs --tier=rookie --base=http://127.0.0.1:5210 --out=art/evidence/dreamisland-v1/alive/code/soaks/rookie
node scripts/visual/dreamisland/race.mjs --tier=works  --base=http://127.0.0.1:5210 --out=art/evidence/dreamisland-v1/alive/code/soaks/works
node scripts/visual/dreamisland/race.mjs --tier=feral  --base=http://127.0.0.1:5210 --out=art/evidence/dreamisland-v1/alive/code/soaks/feral
node scripts/visual/dreamisland/race.mjs --tier=works --reduced --base=http://127.0.0.1:5210 --out=art/evidence/dreamisland-v1/alive/code/soaks/works-reduced
```

`soaks/ceilings.json` is the collated table; each run's own `metrics.json`,
`race.json` and `material-walk.json` sit beside it.

### The HUD — `hud/` and `hud-1440/`

```
node scripts/visual/dreamisland/alive-hud.mjs --base=http://127.0.0.1:5211
node scripts/visual/dreamisland/alive-hud.mjs --base=http://127.0.0.1:5211 --size=1440x810 --out=art/evidence/dreamisland-v1/alive/code/hud-1440
```

Ten frames, each keyed on the runtime's own published state rather than on a
timer: the five `data-power-state` values of §4.6, the first-armed teach state,
the world bubble, the fire, the strike flash, the goldfish, and the settled
night skin. `capture.json` records the live state beside every frame.

### The capsule and column, in pixels — `capsule/`

```
node scripts/visual/dreamisland/alive-capsule-pixels.mjs --base=http://127.0.0.1:5210
python3 scripts/visual/dreamisland/alive-capsule-pixels.py
```

`capsule/pixels.json` is the table. The camera is placed exactly where
`DreamIslandRuntime.updateCamera` puts it for a craft 300 / 150 / 40 m short of
the COURT pickup, and the height is the bounding box of everything that differs
from the same pose with every mesh hidden.

### The fish night glow — `fish/`

```
node scripts/visual/dreamisland/alive-fish-glow.mjs --base=http://127.0.0.1:5210
python3 scripts/visual/dreamisland/alive-fish-glow.py
```

### The six other circuits — `greenwater/`

```
node scripts/visual/dreamisland/greenwater-hud.mjs --base=http://127.0.0.1:5210 --out=<dir>
```

Run once on the tree with `src/game/ui.ts`, `src/game/circuit-runtime.ts` and
`src/game/input-prompt-map.js` reverted, and once with them in place. The
harness is deterministic by construction — the game's frames are cancelled,
every canvas is hidden, every CSS animation and transition is switched off, any
element covering most of the viewport is removed, and every HUD node is written
a fixed string — and it was proved deterministic by running it three times on
the unchanged tree for one hash before it was used to compare anything.

## What is in here

| Path | What it is |
|---|---|
| `soaks/` | four soaks, their metrics, their material walks, and `ceilings.json` |
| `hud/` | the ten 1280x720 HUD frames and `capture.json` |
| `hud-1440/` | the same at 1440x810, for the canvas comparison |
| `capsule/` | 30 isolation frames and `pixels.json` |
| `fish/` | the with/without pair and `glow.json` |
| `greenwater/` | the before and after frames, their hashes, and the diff |

---

## What the commands measured

Every number below is in one of the JSON files this directory holds. The table
that decides whether the pass fits is `soaks/ceilings.json`.

### §4.1 road paint — one draw, and a threshold nobody typed

| | measured |
|---|---|
| median \|curvature\| over the route's 800 stations | **0.0028408** |
| bends selected (above the median) | **10**, 1,170.0 m of the 2,400 m lap |
| geometric inside vs the sign of `curvature` | **0 disagreements** over 10 bends |
| kerb blocks placed | 577 (1.2 m x 2 m, alternating red and white) |
| centre dashes | 234 (3 m paint / 6 m gap, none on the BASIN causeway) |
| edge-line segments | 1,210 (0.25 m wide at +/-(halfWidth - 0.6 m)) |
| chevrons | 30 = 6 per pickup x 5 pickups, every 10 m over the last 60 m |
| draws / triangles | **1 / 4,630** |

The bend list, with each bend's start, end, peak curvature, chosen side and
block count, is in every soak's `race.json` under `dreamisland.roadPaint.bends`.

### §4.2 props — seven kinds, seven draws

`props.glb` landed from the 3D track during this pass, so the layer runs on the
real meshes; `report.source` reads `/assets/dreamisland/props.glb` and
`nodesMissing` is empty. The primitive fallback is still in the file and still
builds the same seven names.

| kind | instances | triangles each | triangles |
|---|---:|---:|---:|
| PR_ball | 22 | 168 | 3,696 |
| PR_ring | 14 | 256 | 3,584 |
| PR_sphere | 30 | 216 | 6,480 |
| PR_pipes | 7 | 340 | 2,380 |
| PR_bollard | 200 | 64 | 12,800 |
| PR_bollard_core | 200 | 12 | 2,400 |
| PR_plinth | 7 | 36 | 252 |
| **total** | **480** | | **31,592** |

280 authored rows; the 200 bollard cores ride on the bollard placements rather
than being authored again. **7 draws.** A per-instance frustum cull draws only
what is on screen — around 202 instances / 12,016 triangles at the pose the
soak samples.

### §4.3 fish — eight shoals

| shoal | source | declared floor | measured worst clearance | on-deck samples |
|---|---|---:|---:|---:|
| basin-eight | (baked) | — | 9.435 m | 9,840 |
| reef-loop | (baked) | — | 8.442 m | 11,409 |
| grove-cross | reef-loop | 8.85 m | **9.693 m** | 9,035 |
| court-cross | reef-loop | 8.85 m | **9.693 m** | 16,131 |
| court-arc | reef-loop | 8.85 m | **9.693 m** | 14,916 |
| reef-cross | reef-loop | 8.85 m | **9.693 m** | 10,773 |
| reef-arc | reef-loop | 8.85 m | **9.693 m** | 13,099 |
| cut-cross | reef-loop | 8.85 m | **9.693 m** | 10,488 |

Six shoals, two draws: they share one `InstancedMesh` per material.

The night-emissive acceptance is **not met** and `fish/emissive-sweep.json` is
the measurement that says why.

### §4.4 the capsule and its column, in pixels at 1280x720

| state | distance | capsule | column | ring |
|---|---:|---:|---:|---:|
| day | 300 m | 7 px | 83 px | 1 px |
| day | 150 m | 13 px | **169 px** | 1 px |
| day | 40 m | 37 px | 326 px | 6 px |
| night | 300 m | 6 px | 83 px | 1 px |
| night | 150 m | 13 px | **171 px** | 1 px |
| night | 40 m | 37 px | 326 px | 6 px |

§4.4's floor is 100 px of column at 150 m; it measures 169 by day and 171 at
night. The brief's own estimate for the capsule at 150 m was about 14 px; it
measures 13.

### The six other circuits

`greenwater/diff.json`: **0 differing pixels, max channel delta 0** — all five
runs (three before, two after) produced the same sha256
`f50151d3f835bfce61d77e93a7cc9099f3b556a27b34740ac6349c0f33bdcbe1`.

Getting there took four attempts, and the failures are recorded in the harness
because each one is a thing that could have been read as a regression: the first
version hid only `document.querySelector('canvas')`, which is the minimap, and
left the WebGL canvas in the frame (401,018 differing pixels between two runs of
the same tree); the second froze the game mid-countdown and caught a "3" and a
lap-pip row (3,877); the third left CSS animations running (10,178); the fourth
pinned every HUD string but not the `data-boost` / `data-state` attributes the
plasma bar keys its colour on, so one run's bar was cyan and the next acid green
(8,851). None of those were the change under test.

### Bytes

| | before | after | ceiling |
|---|---:|---:|---:|
| shell gzip | 277.000 KiB | **277.233 KiB** | 277.5 (= 277.0 + the brief's 0.5) |
| initial JS raw | 971.4 KiB | **972.1 KiB** | 973 |
| island lazy chunk gzip | not previously pinned | **93.39 KiB** over 6 files | **102.72 KiB** = measured + 10 % |

The shell grew by **0.233 KiB**, all of it the three shared touches: measured
277.06 KiB with every phase-F island module present and those three files
reverted, 277.27 with them in place. `dist/index.html` references no
`dreamisland-*` asset.

### The four soaks — `soaks/ceilings.json`

| tier | draws (main+shadow) | triangles | p95 | window samples / expected (residual) | missed gates | material violations |
|---|---:|---:|---:|---|---:|---:|
| rookie | **123** = 104 + 23 | **185,612** | 8.80 ms | 720 / 713.4 (+6.63) | 0 | 0 |
| works | **123** = 104 + 23 | **185,612** | 8.70 ms | 720 / 714.1 (+5.95) | 0 | 0 |
| feral | **124** = 104 + 23 | **185,708** | 8.80 ms | 720 / 720.3 (−0.32) | 0 | 0 |
| works, `?motion=reduce` | **120** = 103 + 23 | **181,964** | 8.70 ms | 720 / 718.8 (+1.20) | 0 | 0 |
| **ceiling** | ≤ 130 | ≤ 205,000 | ≤ 11.0 report-only | — | 0 | 0 |

The largest sample residual is 6.63 frames on a 720-frame window, 0.93 % — no
percentile here is quoted over a window that lost frames.

Lap times are identical across rookie, works and works-reduced
(33,158 / 32,125 / 31,925 ms) and differ only on feral
(33,158 / 32,067 / 31,900 ms), which is the pre-existing tier behaviour.

**The p95 numbers are load-sensitive and the draws and triangles are not.** An
identical earlier round of these four soaks, taken while the F-3D track was
running its own soaks on the same machine (load average 15–22), reported the
same 123/123/124/120 draws and the same triangle counts but p95 11.1 and 11.2 ms
on rookie and works, with 2.9 % of the expected frames missing from the window.
Draws and triangles are per-frame maxima and cannot be moved by the scheduler;
a p95 over a window that lost 3 % of its frames is a measurement of the machine.
Every row above was taken below load average 12.

Under `?motion=reduce`: `fishVisibleMeshes` 0, `goldfishSwims` 0,
`strikeFlashesShown` 0 against `strikeEvents` 1 — the clock still strikes and
the flash is the 0 ms cut §4.7 asks for.

All five power-slot states (`hunting`, `in-range`, `collected`, `armed`,
`active`) and `firstArmedShown: 1` appear in every one of the four runs.
