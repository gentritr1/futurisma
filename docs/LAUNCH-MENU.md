# Final launch menu

Implemented from the published “Launch menu · final” board and the controls/header screenshots supplied on 2026-09-28. The earlier garage changes are included in this branch.

The menu uses the reference’s Saira Extra Condensed and Chivo Mono faces, locally served with their OFL licenses. It combines the oversized colour strip, angled circuit shelf, actual course outlines, compact race setup, stable launch action, and light controls/options sheets. The header uses separate keyboard and standard-pad badges and real credits/daily progress. Prototype records and credits are not copied into saves.

## Ownership

- `src/game/launch-menu.ts`: pending circuit/format/field choice, interrupted selection motion, real records and grid, touch browsing, launch curtain/countdown.
- `src/game/launch-header.ts`: header icons, dual input badges, sound state, credits and daily-job pips.
- `src/game/launch-panels.ts`: controls reference and existing settings surfaces; bindings reflect the chosen circuit.
- `public/launch-boot.js`: same-origin pre-paint circuit colour during a changed-race reload.
- `src/game/launch-guide.ts`, `launch-atlas.json`: course-derived map and mechanic overlays. Polarity samples both upper express sections; Tideline/Ascension use their actual branch stations.
- `src/game/style-launch.css`: lazy reference styling and responsive/reduced-motion arrangements.
- `main.ts`, `meta-ui.ts`, `ui.ts`, `input-prompts.ts`: narrow dispatch, countdown, and menu-control seams.
- `scripts/build-launch-atlas.mjs`: regenerate the atlas after route/checkpoint changes.
- `scripts/visual/capture-launch-previews.mjs`: capture the game’s own scenes for the menu. The temporary renderer probe exists only in the capture server’s response.
- `scripts/visual/launch-menu.mjs`: browser acceptance check (`npm run check:launch-menu`).

## Motion and dispatch

Selection stays local and never reloads. Cards lift in 220 ms with the specified overshoot; identity enters in 200 ms, scenery crossfades in 220 ms, and the route draws in 500 ms before its mechanic appears. Only changed fact digits animate. There is no selection queue. Changed format/field explanations fade in over 140 ms (120 ms with reduced motion), retargeting from the visible opacity.

LAUNCH floods the circuit colour in 320 ms. Changing runtime configuration navigates once behind the curtain, preserves other query parameters, and waits for real assets. A small blocking same-origin script in the head colours the standard loader before first paint and hides its assembly mark/text; the ready menu then takes over the curtain. The CSP is unchanged. The five lights and rival entrance follow the game’s real countdown, then the curtain reveals the playable race. No prototype end card or second countdown is added. The one-shot `launch=1` flag is consumed. Failed loading releases the cover so the game’s error remains visible.

Reduced motion uses a cut/120 ms fade, no route pen, no staggered cards or wipe. Standard pad: LB/RB circuits, X controls, Y options, D-pad focus, A select, B return. Garage is a focused-A action, preserving the shipped mapping. On touch, scenery swipes select; card-shelf swipes only scroll.

## Tradeoffs

Only one full circuit runtime is loaded. Seven JPEGs provide instant scenery changes (about 1.1 MB total, cacheable); these are still scene captures, not seven running worlds. Seven locally subset webfonts total 87,552 bytes. Menu code and CSS remain lazy; the initial shell stays under the unchanged 282 KiB gzip and 986 KiB raw-JS limits.

The desktop follows the board’s proportions; portrait and short landscape screens reflow to keep LAUNCH reachable. Controls/options scroll on small screens. On portrait and short landscape phones the top action bar hides while a sheet is open, and RETURN stays in the sticky sheet header even after scrolling. Desktop titles use the approved longest-word formula, scaled with the strip; their deck lines follow the resulting title height. Real lap counts, records, saved craft and current balances remain authoritative.

## Verification

- Browser: 63 circuit/format/field combinations without navigation; accurate lap counts and sprint/solo grids; rapid input lands on the newest choice; 1440×900, 1280×720, 390×844, 390×680 and 844×390 layouts; both settings sheets; circuit-specific control labels; real standard-pad edges; real touch gestures; garage entry/return; real countdown; cross-circuit launch; reduced motion. No page, console or CSP errors. RETURN is tested with real coordinate taps, including after scrolling; SVG gate delays are read from computed styles. A changed-circuit launch deliberately holds back the main module to verify the loader colour before the menu exists.
- Fresh `npm ci` build: **269.50 KiB gzip initial JS / 281.72 KiB gzip shell**, against unchanged limits of 270 / 282. Raw initial JS is 980.83 KiB against 986. Menu bindings now load dynamically alongside the circuit, before the menu is exposed. This adds one asynchronous module boundary; it does not defer control readiness. The size validator now also counts root-level boot scripts, including the existing headless helper, and its JSON report uses the actual 270 / 282 ceilings. These measurements replace the inaccurate earlier local figures.
- The full `npm run test:code` gate passes with locked dependencies and the art inputs restored to the sparse checkout. The earlier three missing-input failures were a local checkout limitation, not upstream defects. Generated historical Dream Island reports are restored after testing; they are not menu changes.
- Garage B2 checks still pass (90 geometry views, visible upgrade limits, rewards and audio lifecycle). The game loop remains 2583 / 2584 lines.

Desktop screenshots are in `shots/launch-menu/`, alongside each phone/landscape menu and settings sheet. These are browser/GPU-emulation checks; physical phone ergonomics and controller feel are still best judged in play.

Production preview was also exercised: local stylesheet/fonts, all four header buttons, controls sheet, then the real countdown into the playable race. Zero page errors. Menu code and styling remain outside the initial graph.

## Release follow-ups

The three gantry-obstructed scenery captures (Greenwater, Night Shift, Polarity) still need replacement. The A+ minimap remains the development opt-in `?minimap=aplus` for this review fix; promoting it to the production default remains a separate release decision after the moving-scenery/device check. No HUD default is changed here.
