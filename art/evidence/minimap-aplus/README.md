# Minimap A+ and the phone gate strip — evidence (2026-09-27)

A+ is the chosen minimap direction. It ships **dev-only and off by default**
(`?minimap=aplus` on the Vite dev server); production builds are unchanged.
Enabling it by default waits for a real-device driving check.

## A+ (dev-only)

- Code: `src/game/minimap-aplus.ts`, reached through a dev-only delegate in
  `src/game/minimap.ts` (`import.meta.env?.DEV`). `game.ts` is untouched
  (seam budget 2577/2577).
- Production build: every JS/CSS file byte-identical to `main` for the A+
  change (3,161,032 B over 91 files); no A+ symbol in `dist/`.
- `driving-test/`: baseline vs A+ recordings on the dev server, 1280x720, demo
  autopilot, laps=3, same seed, 0.5 s samples. Per circuit: ~27.6 s of race
  clock, 7 gate announcements with the real sector names, closest rival
  3.8 m (Night Shift) / 4.2 m (Greenwater), A+ tick p95 0.3–0.4 ms at a 0.1 ms
  timer, ~22 ticks/s (one per rendered headless frame), 0 page errors.
  Reduced motion: 4 announcements, 0 plate animations. `facts.json` is
  generated from these logs.

## Gate strip on phones (`src/style.css`)

Before: at 844x390 the NEXT GATE text crossed the P-plate (21.9 px) and the
lap block (125.6 px) and the progress bar crossed the race clock (50 px); at
390x844 the 400 px strip ran off both edges and hit the P-plate, lap block,
RACE TIME tag and clock (`before/rects.json`).

After: landscape phones (`max-height: 520px`) place a two-row strip
bottom-right; portrait (`max-width: 700px`) places it at 264px, under the
turn cue and the alert/banner slot (196–255px when active).

- `after/rects.json`: Night Shift, Greenwater, Tideline, Dream Island at
  844x390, 667x375, 390x844, 1280x720, 1920x1080 — no strip overlaps on any
  phone size. Desktop rects are identical to before on Night Shift and
  Greenwater at 1280x720 and 1920x1080.
- `announcements/announce.json`: every gate announcement with `?minimap=aplus`,
  sampled at 0/120/300/700 ms with the alert and banner forced on: 18 runs
  (4 circuits x 3 sizes, reduced motion, a synthetic 30-character sector
  name), 53 announcements, 212 samples, 0 overlaps, position/lap/finish never unreadable,
  nothing off-screen; the long name truncates with an ellipsis.
- `capture-hud/`: the project harness (`capture-hud.mjs --port=5173
  --out=<scratch>`) on 1280x720 m race, race-rivals and 1920x1080 l race:
  3 captures, 0 errors; `art/evidence/hud` untouched.
- Build: stylesheet +593 B raw / +137 B gzip (7,504 -> 7,641 B; 551 B left
  under the 8 KiB ceiling), shell 1,264 B under its 279 KiB ceiling, JS
  unchanged. `npm run test:code` exit 0 (57 validators + build).

## Pre-existing, not changed here

- Dream Island at 1280x720: its lap block overlaps the gate strip by 27.5 px,
  identical with the committed stylesheet
  (`before/dreamisland-1280x720-HEAD-rects.json`).
- Dream Island's HUD skin in portrait: its header pill covers the P-plate and
  the turn cue runs off the right edge.
- Portrait 390x844: RACE TIME overlaps the lap block. Tideline 844x390: the
  ability column pushes the drive block over the standing block.
