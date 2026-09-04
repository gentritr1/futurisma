# Night Shift — Map 03

Play locally at `http://127.0.0.1:5173/?map=nightshift`, or choose **Night Shift** on the launch screen. Normal play uses the existing keyboard/controller controls. `&demo&diagnostics&start=manual` enables the demo driver and the existing diagnostic report for verification.

## Direction

A city circuit at 02:17 AM, inspired by the atmosphere of early 2000s nighttime missions: concrete apartment blocks, closed shops, sodium street lamps, deep blue fog, rain, and small pockets of neon. The route passes Motel Mile, Closed Arcade, North Tenements, The Underpass, Service Quay, and Last Exit before returning to the Meridian Motel.

The closed route is 1,958.9 metres long, has seven intermediate gates plus the finish, and runs for three laps by default. Its street width is 26 metres, narrowing to 23 beneath the elevated expressway. Existing steering, boost, recovery, opponents, classification, and race audio remain in use; music profiles change with the district.

## Blender source and runtime

- Editable scene: `art/blender/nightshift_city.blend`.
- Reproducible city authoring: `art/blender/build_nightshift.py`, seed 217.
- Route authoring: `scripts/build-nightshift-route.mjs` and the generated `src/game/data/nightshift/route.json`.
- Runtime city: `public/assets/nightshift/nightshift_city.glb`, with `lights.json` and `manifest.json` alongside it.
- Rebuild both route and city with `npm run build:nightshift` on this Mac's Blender installation.

The city contains 242 buildings with storefront shutters, window lights, cornices, roof equipment, neon lettering, bus shelters, street lamps, a Meridian marquee, and an overhead expressway. Distant buildings use fewer facade details. Glass and luminous strips use flat surfaces. The export contains 166,678 triangles across 57 material primitives, approximately 10.9 MiB, with one embedded concrete-grain image and no external decoder. Brick and concrete pigments are preserved by Blender's color Mix node.

District geometry is grouped by material for fewer draw calls. Four nearby light sources illuminate the city and vehicles; the total light count remains fixed to avoid shader recompilation while driving. Ninety authored light anchors also drive soft neon halos and puddle reflections. The road has a separate wet-asphalt shader with worn lane paint and colored light streaks. The lighting and cloud treatment apply only to this new map.

The city loads only when selected and must finish loading before the start button appears. The existing courses remain available through the new selector. The CSS gzip budget increased from 4 to 4.5 KiB for that selector and the Night Shift theme; the initial JavaScript and total shell limits are unchanged.

## Verification

- `npm run validate:nightshift`: continuous finish seam, bounded slopes and corner widths, separation of unrelated street sections, actual course sampling/projection, stale-hint recovery, ordered gates, safe recovery positions, exported pigments, and asset budgets.
- Full three-lap demo race: **1:33.416**, all gates cleared, **zero missed gates, recoveries, or impacts**; all four racers classified. Lap times in rounded diagnostics: 31,767 / 30,825 / 30,825 ms.
- Observed frame interval at the end of that run: 8.34 ms, with a recent 95th percentile of 9.2 ms. This is a local observation, not a hardware-wide performance guarantee.
- Production build and shell budget pass. Existing physics, race rules, rivals, control, audio, camera, presentation, graphics resources, frame scheduling, render quality, security, Map 01, Map 02, and race-presence checks pass.
- Course selector verified for all three maps; Night Shift launch screen checked in an 800×600 window as well as the normal browser size.
- The aggregate `npm test` command remains blocked at the existing asset validation step by the absent `artifacts/GREENWATER_ENVIRONMENT_v1.0.zip`. The missing archive check has not been removed or bypassed.

The wet reflections are lightweight authored effects, rather than a full screen-space reflection pass. Buildings are decorative outside the street boundary; the existing track-edge rules govern collisions.
