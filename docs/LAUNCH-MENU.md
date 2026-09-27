# Final launch menu

Implemented from the published “Launch menu · final” board and the controls/header screenshots supplied on 2026-09-28. The earlier garage changes are included in this branch.

The menu uses the reference’s Saira Extra Condensed and Chivo Mono faces, locally served with their OFL licenses. It combines the oversized colour strip, angled circuit shelf, actual course outlines, compact race setup, stable launch action, and light controls/options sheets. The header uses separate keyboard and standard-pad badges and real credits/daily progress. Prototype records and credits are not copied into saves.

## Ownership

- `src/game/launch-menu.ts`: pending circuit/format/field choice, interrupted selection motion, real records and grid, touch browsing, launch curtain/countdown.
- `src/game/launch-header.ts`: header icons, dual input badges, sound state, credits and daily-job pips.
- `src/game/launch-panels.ts`: controls reference and existing settings surfaces; bindings reflect the chosen circuit.
- `src/game/launch-guide.ts`, `launch-atlas.json`: course-derived map and mechanic overlays. Polarity samples both upper express sections; Tideline/Ascension use their actual branch stations.
- `src/game/style-launch.css`: lazy reference styling and responsive/reduced-motion arrangements.
- `main.ts`, `meta-ui.ts`, `ui.ts`, `input-prompts.ts`: narrow dispatch, countdown, and menu-control seams.
- `scripts/build-launch-atlas.mjs`: regenerate the atlas after route/checkpoint changes.
- `scripts/visual/capture-launch-previews.mjs`: capture the game’s own scenes for the menu. The temporary renderer probe exists only in the capture server’s response.
- `scripts/visual/launch-menu.mjs`: browser acceptance check (`npm run check:launch-menu`).

## Motion and dispatch

Selection stays local and never reloads. Cards lift in 220 ms with the specified overshoot; identity enters in 200 ms, scenery crossfades in 220 ms, and the route draws in 500 ms before its mechanic appears. Only changed fact digits animate. There is no selection queue.

LAUNCH floods the circuit colour in 320 ms. Changing runtime configuration navigates once behind the curtain, preserves other query parameters, and waits for real assets. The five lights and rival entrance follow the game’s real countdown, then the curtain reveals the playable race. No prototype end card or second countdown is added. The one-shot `launch=1` flag is consumed. Failed loading releases the cover so the game’s error remains visible.

Reduced motion uses a cut/120 ms fade, no route pen, no staggered cards or wipe. Standard pad: LB/RB circuits, X controls, Y options, D-pad focus, A select, B return. Garage is a focused-A action, preserving the shipped mapping. On touch, scenery swipes select; card-shelf swipes only scroll.

## Tradeoffs

Only one full circuit runtime is loaded. Seven JPEGs provide instant scenery changes (about 1.1 MB total, cacheable); these are still scene captures, not seven running worlds. Seven locally subset webfonts total 87,552 bytes. Menu code and CSS remain lazy; the initial shell stays under the unchanged 282 KiB gzip and 986 KiB raw-JS limits.

The desktop follows the board’s proportions; portrait and short landscape screens reflow to keep LAUNCH reachable. Controls/options scroll on small screens, with the return action at the top. Real lap counts, records, saved craft and current balances remain authoritative.

## Verification

- Browser: 63 circuit/format/field combinations without navigation; accurate lap counts and sprint/solo grids; rapid input lands on the newest choice; 1440×900, 1280×720, 390×844, 390×680 and 844×390 layouts; both settings sheets; circuit-specific control labels; real standard-pad edges; real touch gestures; garage entry/return; real countdown; cross-circuit launch; reduced motion. No page errors.
- Build and unchanged size budgets pass: 281.5 KiB gzip shell, 985.9 KiB raw / 269.3 KiB gzip initial JavaScript. The new menu stylesheet and code remain outside that initial graph.
- All 58 code-validation commands were attempted individually so one missing input could not hide later failures. 55 pass after updating the garage import-boundary check to permit the independently lazy menu’s shared motion helper. The three remaining checks need art inputs already absent from this checkout: tidal-pump orthographic reference, Tideline atlas-generation metadata, Dream Island works calibration. Generated historical Dream Island reports were restored after testing; they are not menu changes.
- Garage B2 checks still pass (90 geometry views, visible upgrade limits, rewards and audio lifecycle). The game loop remains 2583 / 2584 lines.

Desktop screenshots are in `shots/launch-menu/`, alongside each phone/landscape menu and settings sheet. These are browser/GPU-emulation checks; physical phone ergonomics and controller feel are still best judged in play.

Production preview was also exercised: local stylesheet/fonts, all four header buttons, controls sheet, then the real countdown into the playable race. Zero page errors. Final lazy menu code is 18.7 KiB gzip and its stylesheet about 7.6 KiB gzip.
