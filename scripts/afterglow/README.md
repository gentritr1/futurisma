# Afterglow — Map 08

A 2,727 m closed racing circuit through a dusk communications district. This
adds a driving map to Futurisma's existing racer: shared craft, garage, manual
controls, rivals, checkpoints, race formats, records and minimap. Three laps
by default, configurable from one to nine; Sprint keeps its shared two-lap rule.

Play locally: `http://127.0.0.1:5218/?map=afterglow`. Start the server from this
repository with `npm run dev -- --host 127.0.0.1 --port 5218 --strictPort`.
Enter starts, W/S accelerate/brake, A/D steer, Shift boosts, P pauses and R
recovers. Existing arrow-key and controller bindings remain available.

## Art and motion

The direction is early-2000s low-poly city racing: cream concrete, navy panels,
orange industrial hardware, mint wayfinding, warm station windows, and a
lavender sunset. Three tracking dishes, a five-car elevated train, swaying palm
fronds, vent steam, pulsing aircraft beacons and light rain animate the city.
The skyline extends beyond a continuous barrier-bound, 28 m racing road.

Five original Blender kits are in `public/assets/afterglow`: relay dish,
terminal, gate, train and palm. `build_models.py` builds them from primitives
and authored mesh geometry, joins static pieces by material and exports GLB.
`afterglow-source.blend` is the editable source. No external model or texture
packs were downloaded.

Three images were generated with Codex's built-in image-generation tool:

| File | Generation brief |
| --- | --- |
| `materials.png` | Four-panel game material atlas: worn cream concrete, blue-gray asphalt, orange painted metal and navy industrial panels; flat material lighting, no labels. |
| `sky.png` | Wide painted city dusk panorama, indigo/lavender clouds over peach sunset and a low distant skyline; no foreground objects. |
| `facade.png` | Seamless early-2000s blue-gray tower facade with a regular window grid, dark panes and scattered amber occupied windows. |

The dream-loop racing reference was generated separately, then implementation
screenshots were compared by fresh independent visual judges. The target and
iteration captures are local evidence in `.dream-loop/afterglow/` (gitignored).
The source skill is https://github.com/achimala/dream-loop.

## Rendering tradeoff

Static structures are instanced; Blender meshes are merged by material. Most
surfaces use Lambert shading and generated texture atlases. The wet asphalt
uses a Phong shader with sky reflections and broken lamp highlights. The first
82 m have one 512-pixel planar puddle reflection, showing actual architecture,
craft and moving transit. The elevated remainder uses the cheaper sky/lamp
approximation. This preserves the retro style and frame budget without
full-screen reflection or bloom passes. Reflection resources release with the
map's materials.

## Route and verification

`build_route.mjs` generates 960 equal-distance stations, ordered gates and the
launch preview. `src/game/data/afterglow/route.json` is shared by road geometry,
physics, rivals and scenery. The common `build:launch-atlas` script also
includes Afterglow, so later rebuilds preserve its menu entry.

- `npm run validate:afterglow`: route closure, basis continuity, 2,880
  projection cases, road separation, five valid GLBs, animated dish pivot,
  checkpoint count, rival tiers and save/garage registration.
- `node scripts/afterglow/review.mjs manual`: acceleration, steering, boost,
  braking, pause/resume and recovery through the actual browser controls.
- `node scripts/afterglow/review.mjs drive 3`: a complete three-lap race.
- `node scripts/afterglow/review.mjs benchmark`: an uncapped single-lap Chrome
  benchmark at 1536×864, high quality, DPR 1. This uses a test-only renderer
  wrapper and excludes offscreen reflection renders from the frame count.
- `node scripts/afterglow/review.mjs capture 10`: opening screenshot and
  `public/assets/launch/afterglow.jpg` menu thumbnail.

The browser harness expects the server on port 5218 and a local macOS Chrome
installation. Reports contain browser errors, race state, frame timings and
diagnostics; no production test hook is shipped. Frame rate varies by display,
resolution and hardware.

## Satellite test and density follow-up

The boulevard now includes service walks, low shopfronts, canopies, parked
service vehicles, mechanical equipment, planters and amber beacons. A+ is the
default minimap in development and production; `?minimap=classic` selects the
older version.

The satellite attack activates only on the final configured lap: 1.6 seconds
of sky beam, a locked road-lane warning for 2 seconds, a 1.5-second strike, then
a 3-second cooldown. The warning follows the road curve and matches the hit
area. Steering into another lane avoids it. Each volley can hit once, reducing
hull integrity by 18, sharply slowing the craft and briefly weakening
acceleration. Cumulative damage limits acceleration/top speed and adds smoke.
Recovery gives temporary immunity; restarting repairs the craft. Damage is
race-local and does not charge or alter the garage save.

`npm run validate:afterglow-relay` covers final-lap activation in one-, two- and
three-lap formats, warning lock, dodge, one hit per volley, slowdown, damage,
recovery immunity and restart. `node scripts/afterglow/review.mjs relay` verifies
actual visible phases, speed loss, hull state, A+ HUD and pause in Chrome.
Final measurements are in `validation-summary.json`. Earlier screenshots and
benchmarks remain as historical evidence in `.dream-loop/afterglow/`.

## Last-lap radar interference

The approved A+ minimap develops slow drifting fog, scan lines and a slight
route echo when the relay activates on the final lap. Interference rises from
charging to targeting and peaks during a strike, easing during cooldown.
The actual player arrow and next gate are drawn above the fog, so it makes
navigation harder without supplying false positions. The signal clears on
restart/end of race; pausing holds it. Reduced motion uses stationary fog.
Frostline uses gentler snow-fog on its final lap; earlier circuits retain the clear minimap.

`node scripts/afterglow/review.mjs interference` verifies a clear opening,
final-lap interference, pause and reset in Chrome and saves actual minimap
screenshots. Add `reduce` to test the stationary version. Pure relay checks
cover final-lap activation in one-, two- and three-lap race formats.
