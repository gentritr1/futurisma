# Dream Island (Map 07) — phase A evidence

Branch `work/dream-island`, uncommitted. Node v20.19.4
(`export PATH=$HOME/.nvm/versions/node/v20.19.4/bin:$PATH`). Every browser
capture was taken against a dev server started with
`npm run dev -- --host 127.0.0.1 --port 5200` and a headless Chrome
(`scripts/visual/tideline-v4/browser.mjs`, 1280x720, ANGLE/Metal).

`?autostart=1` does not exist. `demo=1` autostarts **unless** `diagnostics` and
`start=manual` are both present, which they are in every run below, so the
harness clicks `#start-button` itself after a 120-frame requestAnimationFrame
rate calibration. That calibration is what `expectedRateHz` in each
`metrics.json` is reconciled against — it is not assumed to be 60.

## Files

| Path | Produced by | What it is |
|---|---|---|
| `calibration/works-calibration.json` | `node scripts/visual/dreamisland/race.mjs --calibrate` | The measuring run. `?calibrate=1` passes a null config, so the scheduler is inert and the HUD reads CALIBRATING; the laps in it are therefore free of the schedule they go on to define. **This file is the schedule's provenance** and is named inside `src/game/data/dreamisland/schedule.json`. |
| `calibration/metrics.json` | same run | Render budget **before** the blockout cuts: 60 main + 22 shadow = 82 draws, 42,260 + 24,456 = 66,716 triangles. |
| `calibration/start.png`, `calibration/finish.png`, `calibration/material-walk.json` | same run | The material walk found one violation at this point (`totem_ghost_hull`, `toneMapped:false`), which is what put `dreamisland` into the ghost-adoption line of `race-presentation-setup.ts`. |
| `pace-solve.json` | `node scripts/solve-dreamisland-pace.mjs` | Cruise speeds bisected over [75, 115] for 18 iterations against the measured player race total, tiers rookie +4 s / works 0 / feral −4 s, per-profile offsets −1/+1/+3 s. |
| `route-validation.json` | `node scripts/validate-dreamisland.mjs` | Route geometry, sampling, gates, apron, powers config, schedule provenance, isolated rival model. |
| `runtime-validation.json` | `node scripts/validate-dreamisland-runtime.mjs` | 60/120/240 Hz determinism with its sample reconciliation, snapshot/restore, grip, and the twelve-second ramp. |
| `soak-works/` | `node scripts/visual/dreamisland/race.mjs --tier=works` | The acceptance soak. |
| `soak-rookie/`, `soak-feral/` | `--tier=rookie`, `--tier=feral` | The other two tiers, for the finishing order. |
| `soak-works-reduced/` | `--tier=works --reduced` | `?motion=reduce`, for decision 6. |

Each soak directory holds `race.json` (URL, input file sha256s, rate
calibration, every instrumented frame, both diagnostics blobs),
`metrics.json`, `material-walk.json`, `start.png`, `day-grove.png` +
`.json`, `night-settled.png` + `.json`, and `finish.png`.

## The exact commands

```
export PATH=$HOME/.nvm/versions/node/v20.19.4/bin:$PATH
npm run dev -- --host 127.0.0.1 --port 5200          # in another shell

node scripts/build-dreamisland-route.mjs             # route.json
node scripts/visual/dreamisland/race.mjs --calibrate  # -> calibration/race.json
mv art/evidence/dreamisland-v1/phase-a/calibration/race.json \
   art/evidence/dreamisland-v1/phase-a/calibration/works-calibration.json
node scripts/build-dreamisland-route.mjs \
  --calibration=art/evidence/dreamisland-v1/phase-a/calibration/works-calibration.json
node scripts/solve-dreamisland-pace.mjs
node scripts/visual/dreamisland/race.mjs --tier=works
node scripts/visual/dreamisland/race.mjs --tier=rookie
node scripts/visual/dreamisland/race.mjs --tier=feral
node scripts/visual/dreamisland/race.mjs --tier=works --reduced
node scripts/validate-dreamisland.mjs
node scripts/validate-dreamisland-runtime.mjs
npx vite build && node scripts/validate-build.mjs
```

The soak URL is
`http://127.0.0.1:5200/?map=dreamisland&seed=3868938316&tier=works&demo=1&headless=1&diagnostics=1&start=manual&quality=high&music=0`
(`&calibrate=1` for the measuring run, `&motion=reduce` for the reduced run).

## What the numbers say

- **Laps, works:** 32.433 / 31.375 / 31.400 s, **0 missed gates**, 0 recoveries,
  0 browser errors. Best lap 31.375 s.
- **Draws:** 53 main + 17 shadow = **70 of the 72 phase-A gate** (the repo's own
  2x rule against the 145 ceiling). `renderer.info.render.calls` excludes the
  shadow pass, so the shadow figure is probed separately by wrapping
  `renderer.shadowMap.render` in `scripts/visual/dreamisland/instrument.mjs`.
- **Triangles:** 42,418 main + 23,624 shadow = **66,042 of the 110,000 gate**
  (main+shadow, the Tideline rule, stated because the repo applies two).
- **p95 frame time:** 8.3 ms over a 720-frame window whose measured length is
  5.805 s. At the separately calibrated 123.67 Hz that window should hold 718.0
  frames; it holds 720, a residual of +2.0 frames (0.28%). The percentile is
  quoted only because that reconciliation holds. Nothing gates p95 in this
  repo — it is reported, never enforced.
- **The schedule reaches the craft.** `minimumGrip` observed in the browser is
  0.85, over 440 frames (3.6 s at 123.7 Hz) inside BASIN on the final lap
  — BASIN is 300 m and the player averages 76 m/s, so ~3.9 s is the whole
  district and the sampled window is that minus the 0.3 s of it driven before
  the strike — and the game's
  own `minimumSurfaceGrip` diagnostic agrees. `maximumNightBlend` is 1 and the
  four events fire once each, in order.
- **Reduced motion.** Identical lap times and an identical event list to the
  normal run. `framesAtFullNight` is 3,898 against the ramped run's 2,398 —
  a difference of 1,493 frames, which at 123.7 Hz is 12.1 s. That is the ramp the
  reduced run skips, measured rather than asserted.

## What this evidence does NOT show

- **The sky does not follow the night turn yet.** `night-settled.png` shows a
  night ground under a day sky. That is phase A's declared scope: the two
  cross-faded panoramas are §5 item 2 and belong to phases B/C. Lighting and fog
  blend correctly and the plumbing is exercised; the dome is not wired to it.
- **No crossfade instrument exists.** `scripts/visual/dreamisland/crossfade-profile.*`
  is phase C work and no midpoint luma/warmth target has been written, because
  no base capture exists to write one against.
- **No user eyeball has accepted the look.** These are numbers and two rendered
  frames. The blockout's proportions, the bore and the night readability are
  taste calls and phase A does not close them.
