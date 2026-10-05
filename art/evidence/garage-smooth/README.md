# Garage smoothness — evidence (branch `work/garage-smooth`, 2026-10-06)

Owner's ask: every switch in the garage animates smoothly at 60 fps, and the
camera glides between PAINT / UPGRADE / TEST / JOBS instead of snapping.

**Taste gate still open:** `before.mp4` and `after.mp4` (1280×720, ~14 s each:
open → PAINT → UPGRADE → ENGINE → FLEET → LANCE, cold profile) are for the
owner's eyes. The numbers below say the stalls are gone and the camera follows
the agreed curve; only watching says whether it *feels* right.

Both recordings were taken muted, cold, at load average ≈ 30 (before) and
19–77 (after). The recordings keep real frame timing (each screencast frame is held until the
next one arrived), so a stall shows as a held frame. Screencast delivers fewer
frames than the display (46–52 fps captured against 60), and an idle, unchanged
screen sends none, so a held frame on a still view is not a stall.

## Setup

Production build (`npx vite build`), `vite preview` on :5196, headless Chrome
154 (`--headless=new --use-angle=metal --mute-audio`, 1280×720), M1 Pro,
`?map=frostline`. **Cold** = a fresh `--user-data-dir` per run, so every GPU
shader cache is empty — what iOS Safari sees on every visit. **Warm** = the
same profile reloaded once. Each action is measured over a 1.4 s window from the
click; `frames/expected` is printed next to every number (`summarize.mjs`).
Worst frames are rAF deltas, quantised to vsync: 16.7 = no drop, 33.3 = one
dropped frame.

Machine load was high and variable (other agents; load average 7–78 during
these runs). A run taken at load ≈ 70 showed a 9.7 s menu stall and was
discarded; every run quoted here is listed in the table with its source file.

## Garage actions — worst frame per action family (ms)

65 actions: open; 3 rounds of UPGRADE, every part, WHOLE CRAFT, PAINT
(LIGHTS/UNDERGLOW/BODY slots, one chip hovered each), TEST, JOBS, DAILY, FLEET,
LANCE, CORONA, TOTEM; close.

| family | before cold (3 runs) | before warm (2 runs) | after cold (final) | after warm |
|---|---|---|---|---|
| open garage | **1366.5** / 250.1 / 333.3 | 50.0 / 166.6 | 50.0 | 16.8 |
| first UPGRADE tab | 150.1 / 16.8 / 16.8 | 16.8 | 16.8 | 16.8 |
| first part (ENGINE) | **800.0** / 66.7 / 66.7 | 50.0 / 83.3 | 16.8 | 16.8 |
| other parts, first view | 16.8 (1 relink each) | 16.8 (1 relink each) | 16.8 | 16.8 |
| first underglow hover | 50.1 / 16.8 / 16.8 | 16.8 | 16.8 | 16.8 |
| first LANCE | **466.6** / 33.4 / 33.3 | 33.4 / 50.0 | 16.8 | 16.8 |
| first CORONA | 133.4 / 16.8 / 16.8 | 16.8 | 16.8 | 16.8 |
| PAINT, TEST, JOBS, DAILY, FLEET (first) | 16.8 | 16.8 | 16.8 | 16.8 |
| rounds 2–3, every switch | 16.8 | 16.8 | 33.3 (one frame, no link, no long task) | 16.8 |
| close | 16.8 / 33.4 / 33.3 | 16.8 | 16.8 | 16.8 |
| program links during the visit | 25 cold (10 in rounds 2–3: UPGRADE_alloy relinked every preview) | 25 | **0** | **0** |
| `renderer.info.programs.length` after rounds 1/2/3 | 108 or 113, flat | 113, flat | 112/112/112 | 110/110/110 |

Sources (all summarised in `results.txt`): before = `g2-base-1` (cold+warm), `g2-base-2` (cold), `actions-before`
(cold+warm, muted, load ≈ 30); after = `actions-after` (cold+warm, muted, load
7–19). The before runs vary a lot (the cold open was 250–1366 ms) because the
first-use compiles race the driver's background compile; after has nothing left
to race. Further cold after-runs on the same code (before `--mute-audio` was added to
the harness; `g2-new-6/7/8`, `actions-after-cold`): open 49.9–66.6 ms, every
other action 16.8–33.4 ms, 0 links in every run.

**Where the cold open's last 50 ms frame goes:** no link, no texture upload, no
script over 7 ms (LoAF render phase 3–8 ms). It is the first composite of the
bay's DOM (new layers, glyphs) from an empty GPU cache; the warm repeat is
16.8 ms. Inside the brief's ≤ 100 ms for the open.

### What the warm-up costs in the menu

The warm-up runs on idle once the menu is up and finished 4.4 s after the menu
appeared in the final cold run (1.7 s warm). Its one long task is the page's
first `AudioContext` (184 ms in the final cold run; 131–330 ms across runs —
the device start-up, measured directly by wrapping the constructor). It used to
land on the first garage click; now it lands on an idle menu, where nothing is
animated by script. Every other step is sliced (≤ 2 new programs per idle
slice, one texture per slice, one hidden draw per frame).

**Opening the bay before the warm-up finishes** (`OPEN_EARLY=1`, 0.5 s after
the menu, cold): open 400 ms (programs still linking), one later 133 ms frame,
then every action ≤ 33 ms with 0 links. Before: 250–1366 ms open plus the
first part, LANCE and CORONA stalls.

## Camera (every rendered bay frame, `camera-trace.mjs`)

Moves measured from the last frame before the click; times from the click.

| move | before: first step / peak frame / t90 / t99 | after (final) |
|---|---|---|
| FLEET → TEST | 19.6 % / 1 / 169 ms / 353 ms | 2.62 % / 5 / 291 ms / 525 ms |
| TEST → PAINT | 47.8 % / 1 / 143 / 327 | 2.62 % / 6 / 291 / 524 |
| PAINT → FLEET | 20.2 % / 1 / 169 / 352 | 2.62 % / 5 / 289 / 521 |
| → ENGINE close-up | 21.0 % / 1 / 169 / 351 | 2.62 % / 7 / 306 / 523 |
| ENGINE → PLASMA | 48.0 % / 1 / 138 / 288 | 2.62 % / 5 / 301 / 517 |
| → WHOLE CRAFT | 47.8 % / 1 / 145 / 329 | 2.62 % / 5 / 305 / 522 |

Overshoot 0 % everywhere, before and after. The framing offset (141 px on a
part close-up) now moves 2.62 % on its first frame (before 21–48 %). The 48 %
"before" steps are moves started from an idle bay: the old code took the whole
idle gap, clamped to 50 ms, as one frame. Across the other after-runs the peak
frame was 4–7 and t90 286–313 ms; the frame-4 peaks are one frame of vsync
jitter (the curve's peak at 77 ms sits on the frame 4/5 boundary).

**Rapid retarget** (PAINT, then TEST 103–114 ms later): before, worst
frame-to-frame step ratio 2.44 and a 129° reversal; after, 1.12–1.16 and
34–40°, no reversal.

`validate:garage-b2` now runs the real `GarageScene` on a fake 60 Hz clock and
pins: first step ≤ 3 %, peak frame 5–10, t90 280–340 ms, t99 ≤ 600 ms, no
overshoot, offset glide, retarget step ratio ≤ 2 and turn < 90°, idle resume,
reduced-motion cut, all bay lights visible. It fails on the old scene (the
light check fires first).

## Build

| | before | after | ceiling | headroom after |
|---|---|---|---|---|
| initial JS raw | 996.416 KiB | 996.653 KiB | 997 KiB | 355 B |
| initial JS gzip | 276.120 KiB | 276.216 KiB | 276.6 KiB | 393 B |
| shell gzip | 288.503 KiB | 288.598 KiB | 289 KiB | 412 B |
| lazy `garage-bay` chunk | 80.5 / 27.9 KiB | 85.2 / 29.6 KiB | — | — |

The entry chunk grows by +243 B raw (the shared `audio-context.ts` and the
`main.ts` warm-up call); everything else is in the lazy garage chunk.

## Re-run

```sh
npx vite build --outDir /tmp/gs-dist
npx vite preview --outDir /tmp/gs-dist --port 5196 --strictPort &   # note the PID, kill it after
cd art/evidence/garage-smooth/harness
export OUT=/tmp/garage-smooth DEBUG_PORT=9531      # results + temp profiles (removed per run)
WARM_REPEAT=1 node --experimental-websocket garage-actions.mjs http://localhost:5196 after
OPEN_EARLY=1  node --experimental-websocket garage-actions.mjs http://localhost:5196 early
node --experimental-websocket camera-trace.mjs http://localhost:5196 after
node --experimental-websocket record.mjs http://localhost:5196 $OUT/after.mp4
node --experimental-websocket probe-hull.mjs http://localhost:5196   # craft back where it was after the hidden draws
node summarize.mjs $OUT/actions-after.json
node measure-shell.mjs /tmp/gs-dist
```

For "before", build `origin/main` b93ff29 the same way. Every Chrome is
launched with `--mute-audio` (the AudioContext is still created, so its cost
is still measured).
