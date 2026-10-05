# Load and warm-up performance: render warm-up and the Greenwater corridor bake

Branch `work/perf-warmup`, cut from `origin/main` b93ff29. Measured on the production build
(`vite build` + `vite preview` on localhost), Chrome `--headless=new --use-angle=metal --mute-audio`,
1280x720, Apple M1 Pro. "Cold" means a fresh `--user-data-dir` for each browser. "Warm" means a
second navigation in the same browser.

## What changed

| Change | Where |
| --- | --- |
| Warm-up runs behind the loading screen, before `running = true`: `compileAsync(scene, raceCamera)`, then every shadow depth variant compiled explicitly, then `initTexture` on every texture, then one render with all meshes `frustumCulled=false`, hidden non-light objects shown and shadows on. All flags are restored afterwards. It logs `[FUTURISMA_WARMUP] {...}`. `?warmup=0` turns it off. It never throws, and each wait is capped at 10 s, because `compileAsync` never resolves on a lost context. | `src/game/render-warmup.ts` (lazy chunk), one line in `game.ts` |
| Hangar lamps are always `visible`, and their intensity carries the on/off state, so the light count (part of every program key) stays constant. The validator now asserts this, and a mutation test shows it fails on a reintroduced `visible` toggle. | `src/game/atmosphere.ts`, `scripts/validate-lighting.mjs` |
| `instanceColor` is allocated when a race-presence batch is created. A null `instanceColor` compiled an invalid `TOTEM_race_presence_masked_alpha` program during warm-up, and the shader-key change at the first effect compiled one more program mid-race. | `src/game/race-presence.ts` |
| Greenwater's corridor relocation is now baked data: `scripts/derive-corridor-relocation.mjs` replays the real runtime pass under Node (vite `ssrLoadModule`) and writes `src/game/data/GREENWATER_CORRIDOR_RELOCATION.json`. The `--check` mode runs in `test:code` as `validate:corridor-bake`. At runtime the bake is applied in O(moved vertices). The full pass still runs if any precondition misses, or with `?corridorbake=0`. | `src/game/corridor-bake.ts`, `environment.ts` (exports `repairGreenwaterRuntimeGeometry`), `scene-assets.ts` |
| Greenwater now awaits its environment behind the loading screen, as every other circuit already did. | `game.ts` (2589 -> 2587 lines) |

## Results

Mid-race programs and worst frames come from the final code, runs r5 to r9 (r9 is the final build).
Timings are noisy: the final rounds ran with a load average of 28 to 33 from other agents. The
interleaved r1/r2 A/B, run on the first version of the branch at the same time as the baseline, is
the cleaner timing comparison.

| Circuit | Mid-race programs (20 s, cold / warm) | Worst frame in 20 s window | Menu frozen after shown | Warm-up cost (cold drive) |
| --- | --- | --- | --- | --- |
| Greenwater | 52 / 52 -> **0 / 0** (5 rounds) | 317-333 ms -> 16.8-33.4 ms | 933 ms -> none over 50 ms | 425-660 ms |
| Frostline | 14 / 14 -> **0 / 0** | 16.8-33.3 ms -> 33.3-33.4 ms | 700 ms (r2) -> 133 ms in one of four rounds, under load | 628-725 ms |
| Night Shift | 10 / 10 -> **0 / 0** (3 rounds, see risks) | 33.4 ms -> 16.8 ms | 383 ms (r2) -> none | 286-420 ms |
| Dream Island | 11 / 11 -> **0 / 0** | 16.8 ms -> 16.8 ms (one 100 ms frame in one of eight windows, not attributed) | 933-1050 ms -> none | 807-967 ms |

The interleaved cold timing A/B (r1, r2), in ms from navigation:

| Circuit | Menu painted (base -> branch) | Race clock, cold | Race clock, warm |
| --- | --- | --- | --- |
| Greenwater | 1173 / 1300 -> 1012 / 1253 | 5865 / 6149 -> 4949 / 6251 | 5573 / 5558 -> 4928 / 4998 |
| Frostline | 1230 / 1118 -> 1493 / 1284 | 5138 / 5415 -> 5600 / 5208 | 5179 / 4881 -> 6449 / 4696 |
| Night Shift | 3151 / 1091 -> 1292 / 959 | 6125 / 5232 -> 5257 / 4928 | 4869 / 4496 -> 4519 / 4956 |
| Dream Island | 4855 / 2222 -> 1624 / 2349 | 7930 / 6283 -> 5862 / 5714 | 4997 / 5434 -> 5114 / 11303 (outlier) |

"Menu painted" means the first frame after `data-phase=intro`. On the baseline, that paint waited
for the first-frame compile: 400-633 ms straddle frames. Greenwater and Dream Island also froze for
a further 933-1050 ms after the menu appeared. On the branch, the loading screen stays up through the
warm-up, which adds 0.3-1.0 s. The loading animation keeps moving during that time because it is a
compositor transform animation. The menu then shows no frame over 50 ms in 15 of 16 rounds. Frame
counts were checked against window x 60 Hz in every run: about 1200 of about 1200 frames in each 20 s
window, and 297-300 of 300 frames in the 5 s menu window.

**What these numbers do not cover.** All runs used localhost, so there was no network cost.
Greenwater's menu now also waits for its 5.9 MB environment GLB and five secondary layers. On a real
connection, the Greenwater loading screen gets longer by that download time. Before this change, the
same download landed after the menu, followed by a ~2 s freeze, and the race could start against the
procedural fallback. Neither the iPhone nor any GPU slower than this one was measured.

## Residual long frames: attributed, not GPU

`residual-attribution.json` comes from `trace2.mjs`: a CDP trace with devtools.timeline, gpu, and
the V8 sampling profiler. The 50-117 ms frame when the race view appears is the first `EngineAudio`
update. It runs `ensureAmbience` and builds the `AmbienceField` beds (`audio-ambience`,
`ambience-beds`), 49-66 ms of JS. `EngineAudio.start`, 160-200 ms, runs just before it. On Dream
Island, `dreamisland-runtime startLoops` adds a 98 ms synthesis pass that also exists on main
(133 ms there). The traces show no GL or GPU-process work inside these frames. This is audio code,
outside this brief, and remains an open item.

## Greenwater bake equivalence

`corridor-equivalence.json`: a hash of every environment position attribute, plus the diagnostics
relocation stats. The results are identical (`f56c366a`, 49 components, max shift 10.038 m) for
origin/main, branch-baked and branch `?corridorbake=0`. `npm run validate:corridor` is hermetic and
untouched. `validate:corridor-bake` re-derives the bake byte-for-byte and reports 49 of 6626
components, 18,314 vertices over 21 meshes, and GLB `5b711fb7bc46`. The data chunk is 502 KB raw and
82 KB gzip, Greenwater only. Bitterpan still runs the full pass behind its loading screen.

## Shadow-variant finding

`compileAsync` plus one warm render still left one depth program, a plain double-sided
`MeshDepthMaterial` for `static_signature_steel` (the dock), compiling at about +6.8 s on roughly one
cold run in four. The cause is in three r184: the shadow pass shares one depth material and re-keys
its program only when instancing, skinning or morph flips, never on side, map or normals. Which key it
lands on therefore depends on draw order. `compileShadowVariants` compiles every caster's key with a
private copy of the depth material, under a render target and without fog, to match the pass. After
that, 0 late depth shaders appeared over 14 hunted runs (`late-shadow-caster.mjs`) plus 18 bench
windows.

## Re-run

```sh
ln -s <a checkout>/node_modules node_modules          # no install needed
npm run build && npx vite preview --port 5197 --strictPort &
# per circuit: cold menu + cold drive + warm drive (writes $PERF_OUT/<map>-<label>.json, prints one line)
PERF_OUT=/tmp/pw DEBUG_PORT=9431 node --experimental-websocket scripts/perf-warmup/bench.mjs http://localhost:5197 greenwater mine
node scripts/perf-warmup/summarize.mjs <file of bench lines> /tmp/pw/summary.json
node --experimental-websocket scripts/perf-warmup/envhash.mjs http://localhost:5197 "" bake          # and "&corridorbake=0" runtime
node --experimental-websocket scripts/perf-warmup/trace2.mjs http://localhost:5197 greenwater t1 demo  # residual attribution
node --experimental-websocket scripts/perf-warmup/late-shadow-caster.mjs http://localhost:5197 greenwater 25 8
node --experimental-websocket scripts/perf-warmup/depth-keys.mjs http://localhost:5197 greenwater
node scripts/derive-corridor-relocation.mjs --check
# A/B on one build: append &warmup=0 (no warm-up) or &corridorbake=0 (full relocation pass)
```

The harness uses only Node 20 and the installed Google Chrome, with no dependencies. It kills only
the Chrome it spawned.
