# Paddock starting grid — a fieldless format now lists what it spawns

## The defect

`index.html` shipped four hard-coded rows inside `<ol id="grid-order">`, and
`GameUi` replaced them only when it was handed a non-empty grid. The only
producer of that grid is `RivalFleet.gridEntries`, and `RivalFleet.create`
returns `null` in a fieldless format — so in `timeattack` nothing ever replaced
the placeholder and the start screen listed **three rivals the race does not
spawn**. `src/style.css:2225` hides `#grid-order` on any intro screen under
900 px tall, which is why every 1280x720 soak missed it.

Not specific to Dream Island: the `ascension-before/` capture below shows the
same four rows on Map 06, which is what settled the fix's scope.

## Commands

All run from the repo root (`~/Desktop/futurisma-race/polarity_work`,
branch `work/dream-island`) with

```
export PATH=$HOME/.nvm/versions/node/v20.19.4/bin:$PATH
```

and the vite dev server of this tree listening on 127.0.0.1:5200
(`npm run dev -- --host 127.0.0.1 --port 5200`).

### Before (HEAD 40e5856, tree clean)

```
node scripts/visual/paddock/paddock.mjs --map=ascension   --out=art/evidence/paddock-grid-fix/ascension-before
node scripts/visual/paddock/paddock.mjs --map=dreamisland --out=art/evidence/paddock-grid-fix/dreamisland-before
```

### After (fix applied)

```
node scripts/visual/paddock/paddock.mjs --map=dreamisland --out=art/evidence/paddock-grid-fix/dreamisland-after
node scripts/visual/paddock/paddock.mjs --map=ascension   --out=art/evidence/paddock-grid-fix/ascension-after
node scripts/visual/dreamisland/paddock.mjs --out=/tmp/di-paddock-after   # copied to dreamisland-harness-after/
```

`scripts/visual/paddock/paddock.mjs` is a copy of the Map 07 harness that takes
`--map=` and additionally reads `#grid-order li` out of the DOM plus whether the
list is painted at this viewport; the Map 07 harness itself is untouched, so
`dreamisland-harness-after/` is the unmodified instrument re-run against the fix.
Every capture is 1280x1000 — the viewport the list is visible at.

### Validators

```
node scripts/validate-race-modes.mjs      # section 5 carries the new assertions
npm run test:code                          # exit 0, 75 PASS lines
```

The new assertions were confirmed to FAIL on the pre-fix source: with
`index.html` and `src/game/ui.ts` reverted to HEAD,
`node scripts/validate-race-modes.mjs` throws
``AssertionError: `#grid-order` must ship empty.`` and prints the four
placeholder `<li>` rows as `actual`.

## Result, as read from `paddock.json`

| circuit | mode | before | after |
| --- | --- | --- | --- |
| Dream Island | race | 4 rows (P1 · YOU / PRIVATEER 13 / NIGHTFORM 24 / NEEDLE 16) | unchanged, 4 rows |
| Dream Island | sprint | 4 rows, same names | unchanged, 4 rows |
| Dream Island | timeattack | 4 rows — `P1 · YOU`, then three `P?TOTEMFIELD` placeholders | **1 row** — `P1 · YOUTOTEMWORKS 07` |
| Ascension Pad | race | 4 rows, same names | unchanged, 4 rows |
| Ascension Pad | sprint | 4 rows, same names | unchanged, 4 rows |
| Ascension Pad | timeattack | 4 rows — same placeholders | **1 row** — `P1 · YOUTOTEMWORKS 07` |

0 console errors in all twelve captures.

`grid-band-strip.png` and `ascension-grid-band.png` crop the grid band out of the
frames side by side. The surviving row is also now highlighted (`data-best`), which
the hand-written placeholder never carried — the player's row reads the same in a
time attack as it does in a field race.

## The pre-fix failure, reproduced on today's tree

The same instrument that recorded the original defect
(`art/evidence/dreamisland-v1/phase-d/timeattack-run1/intro.json`) was re-run on
the reverted source — `git checkout -- index.html src/game/ui.ts
src/game/race-modes-rules.js`, everything else identical — and reproduced it:

```
node scripts/visual/dreamisland/race.mjs --mode=timeattack --out=/tmp/prefix-ta-race
```

| | `intro.json` -> `startingGrid` |
| --- | --- |
| pre-fix (`dreamisland-timeattack-race-prefix/`) | `["P1 · YOUTOTEMWORKS 07","P2TOTEMFIELD","P3TOTEMFIELD","P4TOTEMFIELD"]` |
| post-fix (`dreamisland-timeattack-race/`) | `["P1 · YOUTOTEMWORKS 07"]` |

`grid.json` in both reads `{"phase":"standby","fieldSize":1,"hasField":false,
"rivals":[]}` — one craft is what the format spawns in both, and only the
post-fix paddock says so.

### Known, pre-existing: this harness does not reach the flag

BOTH runs then timed out at `scripts/visual/dreamisland/race.mjs:136`, the
`current.phase === "finished"` wait, after 240 s. The PRE-FIX run did not even
reach `night-settled`, so the post-fix run got strictly further. The hang is
therefore not caused by this change; it is reproduced on unmodified source and
is left undiagnosed here. Note that at the time of these runs the working tree
carried another session's in-flight edits to the Dream Island runtime and its
GLB assets (`dreamisland-heroes.ts`, `dreamisland-painted-environment.ts`,
`dreamisland-sky.ts`, `dreamisland-water.ts`, `public/assets/dreamisland/*`),
which is a plausible cause and a confounder for anything Map-07-specific — it is
why the **Ascension** captures, untouched by that work, carry the scope claim.

`intro.json` is written BEFORE the start button is clicked, so the grid readings
above are unaffected by the timeout.

## Files changed

- `index.html` — `#grid-order` ships empty; every row is written by the runtime.
- `src/game/race-modes-rules.js` — new pure `startingGridRows(mode, fieldGrid, playerTeam)`.
- `src/game/ui.ts` — `GameUi.applyStartingGrid` replaces the two `grid.length > 0` guards.
- `scripts/validate-race-modes.mjs` — section 5 assertions.
- `scripts/visual/paddock/paddock.mjs` — new, this evidence's instrument.

`src/game/game.ts` is untouched and still 2577/2577 lines
(`node scripts/validate-module-seams.mjs`).
