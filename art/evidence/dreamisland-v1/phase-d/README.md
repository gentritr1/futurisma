# Dream Island — phase D evidence (race modes)

Every file here was produced by one of the commands below, run from the repo
root with a vite dev server on `127.0.0.1:5200` serving this tree.

```
export PATH=$HOME/.nvm/versions/node/v20.19.4/bin:$PATH
npm run dev -- --host 127.0.0.1 --port 5200        # in another shell
```

Two things about the numbers before the tables.

**The tick at the flag is not the tick the harness reads.** The schedule clock
keeps advancing after the chequered flag — `game.ts` runs `updateCoast`, which
calls `advanceClocks`, for as long as the craft is coasting — so a tick sampled
once the harness has noticed `phase === "finished"` and walked the scene graph
is seconds of coast past the crossing. An event that fires in that coast reads
exactly like an event that fired in the race. `race.mjs` therefore latches the
clock in the page on the first frame the phase flips (`atFlag` in `race.json`),
and every claim below about what fired *in the race* is `eventsAtFlag`, not
`eventsAfterCoast`. The first phase-D run of `?laps=2` reported `struck: true`
from the un-latched read and it was wrong: the strike landed 1.5 s after the
race was already over.

**Lap times are identical across tiers** (33158 / 32125 / 31925 ms) because the
demo autopilot drives the same line whatever the field does — no rubber-banding
and no player collision, per `PRODUCT.md`. What the tier changes is the
finishing order, which is the column to read.

---

## D1 — sprint, three tiers

```
node scripts/visual/dreamisland/race.mjs --mode=sprint --tier=rookie --out=art/evidence/dreamisland-v1/phase-d/sprint-rookie
node scripts/visual/dreamisland/race.mjs --mode=sprint --tier=works  --out=art/evidence/dreamisland-v1/phase-d/sprint-works
node scripts/visual/dreamisland/race.mjs --mode=sprint --tier=feral  --out=art/evidence/dreamisland-v1/phase-d/sprint-feral
```

| run | laps | missed gates | recoveries | flag tick | events at the flag | min grip | finishing order (gap to winner) |
|---|---|---|---|---|---|---|---|
| `sprint-rookie/` | 2 | 0 | 0 | 7833 | chime · strike · fish-rise · night-settled | 0.85 | **P1 TOTEM**, P2 PRIVATEER 13 +3.65 s, P3 NIGHTFORM 24 +4.72 s, P4 NEEDLE 16 +5.82 s |
| `sprint-works/` | 2 | 0 | 0 | 7832 | chime · strike · fish-rise · night-settled | 0.85 | **P1 TOTEM**, P2 PRIVATEER 13 +1.05 s, P3 NIGHTFORM 24 +2.08 s, P4 NEEDLE 16 +3.19 s |
| `sprint-feral/` | 2 | 0 | 0 | 7834 | chime · strike · fish-rise · night-settled | 0.85 | P1 PRIVATEER 13, P2 NIGHTFORM 24 +1.07 s, **P3 TOTEM +1.58 s**, P4 NEEDLE 16 +2.13 s |

Two laps, hard-pinned: `intro.json` reads `LAP 1 / 2` in all three and
`?laps=` never reaches the format (`resolveModeLapCount`, asserted in
`validators/runtime-validation.json`).

**Grid reversal, read out of the runtime** (`grid.json`, each rival's
`raceDistanceMeters` on the grid, so it is where the fleet was actually placed
rather than what the query string asked for):

| format | PRIVATEER 13 | NIGHTFORM 24 | NEEDLE 16 |
|---|---|---|---|
| race (`race-default/grid.json`) | −12 m | −24 m | −36 m |
| sprint (`sprint-*/grid.json`) | **−36 m** | −24 m | **−12 m** |

The quickest profile takes the slot furthest back, which is what makes the
format a defence. `sprint-feral` is the proof that it can be lost.

**The schedule.** Sprint runs its own table, and the whole of it lands inside
two laps: all four events fired before the flag and `nightBlend` was 1 at the
crossing (`atFlag.nightBlend` in every `race.json`).

The table itself is in `src/game/data/dreamisland/schedule.json` under `modes`,
written by `scripts/build-dreamisland-route.mjs --calibration=…` from the same
measured Works lap (L = 32.579 s) the phase-A schedule came from. No tick is
typed; the sprint's factors are the race's scaled by
`SPRINT_LAP_COUNT / defaultLapCount`, both read from code rather than restated.

| | race | sprint | time attack |
|---|---|---|---|
| laps | 3 | 2 | 3 |
| honours `?laps=` | yes | **no** | yes |
| chime factor | 1.85 L | **1.2333 L** | 1.85 L |
| strike factor | 2.05 L | **1.3667 L** | 2.05 L |
| strike tick | 8014 (66.783 s) | 5343 (44.525 s) | 8014 |
| lands in | lap 3, 0.05 into it | lap 2, **0.37 into it** | lap 3 |
| as a fraction of its own race | **0.6833** | **0.6833** | **0.6833** |
| settled night before the flag | 18.95 s | 8.63 s | 18.95 s |

The 12 s ramp and the 4 s fish delay are **not** scaled — they are durations
authored against how the crossfade reads on screen (brief §5), not against how
long a race is. The consequence is stated rather than hidden: the sprint's
settled night is 8.63 s where the race's is 18.95 s, because an unscaled 12 s
ramp is a bigger slice of a shorter race. What is held constant is where the
turn *starts* relative to the race, which is what makes it the same event.

## D2 — time attack, ghost recorded then replayed

```
node scripts/visual/dreamisland/race.mjs --mode=timeattack --tier=works --profile=/tmp/di-ghost-profile --out=art/evidence/dreamisland-v1/phase-d/timeattack-run1
node scripts/visual/dreamisland/race.mjs --mode=timeattack --tier=works --profile=/tmp/di-ghost-profile --out=art/evidence/dreamisland-v1/phase-d/timeattack-run2
```

`--profile=` is new: it hands the browser a persistent `userDataDir`, which is
the only way one run's `localStorage` reaches the next. `/tmp/di-ghost-profile`
was empty before run 1.

| | run 1 | run 2 |
|---|---|---|
| `fieldSize` | 1 | 1 |
| `ghostActive` | **false** | **true** |
| `ghostDrawCalls` | 0 | 1 |
| `raceModeBestLapMs` (record read at reset) | null | **31925** |
| `sectorDeltas` (per-gate flashes) | **none** | **21** — lap 1 `+1.23`, lap 2 `+0.20`, lap 3 `0.00` at every gate |
| peak draws / triangles | 81 / 115,224 | 82 / 121,338 |
| save after the race | 8,930 chars | 8,930 chars |

`grid.json` records `fieldSize: 1, hasField: false, rivals: []` in both — no
rival is placed at all, which is `modeHasField` doing its job rather than a
fleet that failed to load.

Run 1 wrote `records["MAP 07"].bests["timeattack:works"] = { bestLapMs: 31925,
gateSplitsMs: [3883, 9442, 12983, 16442, 20608, 23175, 26150] }` and
`records["MAP 07"].ghosts.timeattack` (8,492 characters). Run 2 read both back:
the ghost drew (+1 call, +6,114 triangles), and the 21 gate deltas above are
the stored splits being measured against — run 1 flashed none because there was
nothing on file. The autopilot is deterministic, so run 2's third lap re-drives
the record lap and every gate reads `0.00`; laps 1 and 2 are the two slower laps
of the same race measured against it.

The `liveDelta` chip is deliberately **not** quoted here. It holds its last
written value, and the value it holds at the flag is a lap-boundary artifact
(two consecutive runs of the same race sampled `+0.11` and `−31.79` depending on
which side of the wrap the finish landed). The gate deltas are the same
comparison sampled somewhere meaningful.

The schedule runs in time attack exactly as in race — `eventsAtFlag` is all four
events, `nightBlend` 1 at the flag, minimum grip 0.85.

### The save, measured in the browser

`budget-*` is one profile raced three times, so the two-ghost budget actually
has to evict something:

```
node scripts/visual/dreamisland/race.mjs --mode=race       --tier=works --profile=/tmp/di-budget-profile --out=art/evidence/dreamisland-v1/phase-d/budget-1-race
node scripts/visual/dreamisland/race.mjs --mode=sprint     --tier=works --profile=/tmp/di-budget-profile --out=art/evidence/dreamisland-v1/phase-d/budget-2-sprint
node scripts/visual/dreamisland/race.mjs --mode=timeattack --tier=works --profile=/tmp/di-budget-profile --out=art/evidence/dreamisland-v1/phase-d/budget-3-timeattack
```

| after | save | ghost slots held | best-lap records held |
|---|---|---|---|
| (empty profile) | 0 | — | — |
| race | 8,918 chars / 8,918 bytes | `MAP 07:race` (8,492) | race |
| sprint | 17,491 chars / 17,491 bytes | `MAP 07:sprint` (8,471), `MAP 07:race` (8,492) | race, sprint |
| time attack | **17,612 chars / 17,612 bytes** | `MAP 07:timeattack` (8,492), `MAP 07:race` (8,492) | race, sprint, time attack |

**The sprint ghost is the one that was evicted.** `capGhostBudget` visits the
course just raced first and, inside it, the mode just raced first, so the replay
you have just set is never the one dropped; the remaining slot went to the first
other mode in key order. All three best *times* survived — a time is eight bytes
and a replay is 8.5 KB, which is the whole reason the budget is on replays only.

Peak measured payload **17,612 of the 65,536 characters `parseSave` refuses
past — 26.9 %**. Characters, not bytes, is the number the ceiling is about
(`MAX_PAYLOAD_CHARACTERS` counts the stored text); the two are equal here
because the payload is ASCII.

## D3 — `?laps=` on race

```
node scripts/visual/dreamisland/race.mjs --mode=race --tier=works --laps=1 --out=art/evidence/dreamisland-v1/phase-d/race-laps1
node scripts/visual/dreamisland/race.mjs --mode=race --tier=works --laps=2 --out=art/evidence/dreamisland-v1/phase-d/race-laps2
node scripts/visual/dreamisland/race.mjs --mode=race --tier=works --laps=9 --out=art/evidence/dreamisland-v1/phase-d/race-laps9
node scripts/visual/dreamisland/race.mjs --mode=race --tier=works           --out=art/evidence/dreamisland-v1/phase-d/race-default
```

| run | `LAP 1 / n` on the panel | laps run | missed gates | flag tick | events **in the race** | min grip |
|---|---|---|---|---|---|---|
| `race-laps1/` | 1 | 1 | 0 | 3976 | none | 1.00 |
| `race-laps2/` | 2 | 2 | 0 | 7831 | chime-warning only | 1.00 |
| `race-default/` | 3 | 3 | 0 | 11663 | all four | 0.85 |
| `race-laps9/` | 9 | 9 | 0 | 34794 | all four | 0.85 |

`?laps=1` and `?laps=9` both reached the race unclamped (the course allows
1–9); `validators/runtime-validation.json` covers the clamp at 0 → 1 and 99 → 9.

**A one- or two-lap race finishes in daylight, by design.** The race table is
authored in absolute lap-times (1.85 L and 2.05 L), and the strike at tick 8014
lands **183 ticks — 1.53 s — after** the flag of the measured two-lap race
(7831). Two laps hears the tower strike the quarter and never sees the night.
That margin is thin and it is stated rather than rounded off: the schedule is
authored for the three-lap race the format defaults to, and `?laps=` is a QA
override, not a second format. Sprint is the format whose lap count is fixed,
which is exactly why its schedule could be pinned to a fraction of the race
instead. The intro panel says so per race — see `paddock/` and D5.

## D4 — pace, not re-solved

`route.json` has not changed since the pace was solved, so there is nothing to
re-solve. The anchor is the calibration capture the pace solve names
(`pace-solve.json` → `.../phase-b/route-revision/calibration/works-calibration.json`),
which recorded the sha256 of every input it ran against:

```
calibration-recorded route.json sha256   843494dc36353367249352ec9c4f398b7d2a3437389c443c658e1a9fcafb487f
current route.json sha256                843494dc36353367249352ec9c4f398b7d2a3437389c443c658e1a9fcafb487f   MATCH
git log -1 -- src/game/data/dreamisland/route.json   e458750 (phase B), working tree clean for that path
```

`validate-dreamisland.mjs` re-runs the isolated rival model against the shipped
`rival-pace.json` on every `test:code` and still lands on the solve's targets
(rookie 101.31 / 103.32 / 105.32 s, works 97.32 / 99.31 / 101.32, feral 93.32 /
95.32 / 97.32), so the pace reproduces as well as the route does.

## D5 — paddock and intro panel

```
node scripts/visual/dreamisland/paddock.mjs --out=art/evidence/dreamisland-v1/phase-d/paddock
```

`paddock/start-race.png`, `start-sprint.png`, `start-timeattack.png` at
1280×1000, plus `paddock.json`. The taller viewport is deliberate:
`style.css:2224` hides `.chip small` on any intro screen under 900 px, so the
1280×720 frames the soak shoots cannot show a deck line at all. `paddock.json`
records `noteVisible` per chip — 3 of 3 in every mode at this size.

FORMAT row, all three offered exactly as Ascension's is, with Dream Island's own
lap counts and what each format does to the map's one mechanic:

| chip | deck line |
|---|---|
| FIELD RACE | `3 LAPS · FULL FIELD · NIGHT LAP` |
| SPRINT | `2 LAPS · DEFEND · NIGHT ON LAP 2` |
| TIME ATTACK | `3 LAPS · SOLO + GHOST · NIGHT LAP` |

Intro panel deck, which now names the schedule in the same words the HUD counts
down in (`dreamisland-runtime.ts` prints `THE STRIKE IN mm:ss`):

- race / time attack — *"The clock strikes: day turns to night and the causeway goes wet. THE STRIKE IN 1:07 on lap 3, night settled by 1:19. 3 laps."*
- sprint — *"… SPRINT · THE STRIKE IN 0:45 on lap 2, night settled by 0:57. 2 laps."*
- `?laps=2` — *"… THE STRIKE IN 1:07 — after this race ends, so it stays day, night settled by 1:19. 2 laps."* (`race-laps2/intro.json`)

Start frames per soak are `*/start.png` (the paddock, shot before the click) and
finish frames are `*/finish.png`.

## D6 — validators

```
node scripts/validate-dreamisland.mjs
node scripts/validate-dreamisland-runtime.mjs --out=art/evidence/dreamisland-v1/phase-d/validators
```

`validators/runtime-validation.json` carries the phase-D sections: `modes`
(the factor table, where each format's strike lands, and the `?laps=` reach at
1/2/3/4/9 with its margin in ticks) and `save` (the ghost round trip and the
budget). Both validators are inside `npm run test:code`.

## File list

| path | what it is |
|---|---|
| `sprint-rookie/`, `sprint-works/`, `sprint-feral/` | D1 sprint soaks |
| `timeattack-run1/`, `timeattack-run2/` | D2 ghost record then replay, one shared browser profile |
| `budget-1-race/`, `budget-2-sprint/`, `budget-3-timeattack/` | D2 save/ghost budget, one shared browser profile |
| `race-laps1/`, `race-laps2/`, `race-laps9/`, `race-default/` | D3 `?laps=` |
| `paddock/` | D5 start screen per format at 1280×1000 |
| `validators/runtime-validation.json` | D6 validator report |

Inside every soak directory: `race.json` (url, input sha256s, full diagnostics,
`atFlag`, `save`), `metrics.json` (draws, triangles, p95 with its sample
reconciliation), `grid.json`, `intro.json`, `material-walk.json`, `start.png`,
`day-grove.png` + `.json`, `night-settled.png` + `.json` (absent where the race
never settles the night), `finish.png`.

## Budget

Highest of any phase-D run, against the phase gate of 110 draws / 180,000
triangles:

| run | peak draws (main + shadow) | peak triangles (main + shadow) | p95 | samples / expected (residual) |
|---|---|---|---|---|
| `race-laps9` | **95** | **151,916** | 8.40 ms | 35,987 / 35,828 (+158.6, 0.44 %) |
| `race-default` | 93 | 151,312 | 8.40 ms | 11,967 / 11,928 (+39.2, 0.33 %) |
| `sprint-works` | 93 | 150,878 | 8.40 ms | 7,995 / 7,983 (+12.5, 0.16 %) |
| `timeattack-run2` (ghost drawing) | 82 | 121,338 | 8.40 ms | 11,978 / 11,961 (+17.5, 0.15 %) |
| `timeattack-run1` (no ghost) | 81 | 115,224 | 8.30 ms | 11,990 / 11,884 (+105.8, 0.89 %) |

Reserve at the worst case: **15 draws / 28,084 triangles**. Time attack is the
cheapest format on this map by 12 draws and 30,000 triangles, because it spawns
no field. Material walk: **0 violations** in all twelve runs.

The p95 figures are reported, never gated (`ROADMAP.md:529`), and each is quoted
beside the sample count it was taken over against `window × the measured render
rate` — the residuals above are the reconciliation, all under 1 %.

## Bundle

Phase D's byte cost, measured on both trees with `npx vite build && node
scripts/validate-build.mjs` (baseline built in a detached worktree at HEAD
`ef36809`, since removed):

| | initial JS gzip | app shell gzip |
|---|---|---|
| HEAD `ef36809` | 264.8 KiB | 276.7 KiB |
| phase D | 264.8 KiB | **276.8 KiB** |
| ceiling | 266 | 277 |

**+0.1 KiB of shell, +0.0 KiB of initial JS.** The schedule's new `modes` block
costs nothing in the shell because `schedule.json` is a static import into
`dreamisland-course.ts`, which is lazy and pinned lazy by
`validate-build.mjs:46`; the shell delta is the format chip row's three deck
strings in `meta-ui.ts`. The 0.2 KiB of shell headroom left is **not** phase D's
doing — it was 0.3 KiB before this phase started.
