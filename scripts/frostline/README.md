# Frostline — Map 09

A 3,028 m Christmas and New Year circuit for the existing Futurisma racer.
Play at http://127.0.0.1:5218/?map=frostline. Enter starts; W/S accelerate and
brake, A/D steer, Shift boosts, P pauses, R recovers. Existing gamepad and
arrow-key controls, race formats, rivals, garage, records and the approved A+
minimap are retained. The classic minimap is available with `?minimap=classic`.

The route runs through Christmas Square, Lantern Climb, Gondola Ridge,
Frosted Forest, Silver Lake and Midnight Return. Four stretches are covered
in packed snow, with darker cleared tracks that offer more grip. Silver Lake
also has central ice; its outside line is safer. Barriers constrain driving
while the mountains and forest extend well beyond the road.

## Living holiday village

- Falling snow, drifting chimney smoke and five moving gondolas.
- Decorated tree, slowly twinkling lights, and windows that gently dim and
  brighten at different times, suggesting occupied rooms.
- A working clock face, quiet alternating ticks near the square and periodic
  bell phrases. Audio uses the existing ambience bus, volume and mute controls.
- Small distant fireworks throughout the race. The final configured lap brings
  midnight bells, a New Year greeting and a stronger firework celebration.
- Effects use the race clock; pausing holds motion and sound scheduling.
  Reduced motion freezes environmental animation.

## Original art and rendering

`build_models.py` builds six original Blender kits: two chalets, clock tower,
snow pine, market stall and gondola. `frostline-source.blend` is editable, and
`public/assets/frostline/*.glb` contains the browser exports. Static pieces are
joined by material and repeated with instancing. No third-party assets were
downloaded.

Codex image generation created a reference image and four texture images:

| Image | Generation brief |
| --- | --- |
| materials.png | Four-panel low-poly game atlas: aged timber, pale blue stone masonry, snow grain, warm amber four-pane window with curtains. |
| road.png | Dark wet winter asphalt, irregular ice and snow dust, seamless, no road markings. |
| sky.png | Wide purple-blue twilight alpine panorama, layered snowy mountains, distant forest, stars, no foreground props. |
| visor-frost.png | Transparent, irregular crystalline snow residue around the visor edges, with a clear central window; no geometric bubbles or UI. |

The dream-loop reference and actual iteration screenshots are in the ignored
`.dream-loop/frostline/` folder. Reference art is not presented as gameplay.
The workflow source is https://github.com/achimala/dream-loop.

The road combines a generated bump texture, broken light highlights and one
512-pixel planar reflection over the opening 84 m. Other sections use cheaper
painted highlights. Two reusable lights follow the nearest real lanterns,
lighting the road and craft; a third light follows a nearby pickup or active
device, while the hero tree retains its warm light. The rest is instanced
emissive decoration. This keeps the early-2000s style and
avoids full-screen bloom or reflection passes. Reflection targets and shared
scene resources are disposed with the environment. Environmental sounds are
synthesized, with no downloaded audio and no extra AudioContext.

## Verification

- `npm run validate:frostline`: route closure, continuous basis, 2,880 road
  projections, non-overlapping route, six GLBs, checkpoint and save registration,
  rival tiers and the safer outside ice lane.
- `node scripts/frostline/review.mjs manual`: actual keyboard driving, braking,
  boost, steering, pause/resume and recovery.
- `node scripts/frostline/review.mjs alive`: running audio context, clock ticks,
  shared animation clock, moving gondolas, pause freeze and final-lap celebration.
- `node scripts/frostline/review.mjs drive 3`: full race with rivals and gates.
- `node scripts/frostline/review.mjs benchmark`: uncapped full lap at 1536×864,
  DPR1, high quality, headless Chrome with Metal. Offscreen reflection renders
  are excluded from frame counts.
- `node scripts/frostline/review.mjs capture 10`: actual opening frame and menu
  thumbnail. Other distances inspect the rest of the route.

The harness expects the local server on port 5218 and macOS Chrome. Its game
inspection hook is injected only into browser test responses, never shipped.
Original measurements are in `validation-summary.json`; current winter measurements
are in `winter-validation-summary.json`. Frame rate depends on
hardware and resolution. Production art, routes and runtime remain lazy-loaded.
The integrated nine-map shell, including shared launch boot changes, is
286.5 KiB gzip. Size ceilings are pinned to 287 KiB shell, 275 KiB gzip JS
and 995 KiB raw JS with explicit lazy-map assertions.

Earlier baseline verification, before the winter mechanics: both three-lap races completed without recovery,
missed gates or browser errors at approximately 60 fps on the capped browser.
Frostline's uncapped full lap measured 306.7 fps, 4.8 ms p95 frame interval,
at 1536×864 high quality. These are local measurements, not a device guarantee.
The four independent dream-loop reviews scored 3.9, 6.2, 6.7 and 7.0/10.
Warm light integration and richer forested hillside depth remain below the
generated reference; the timebox ends at this cohesive playable iteration.

`node scripts/frostline/production-check.mjs` checks both built maps with the
actual Content Security Policy, the A+ minimap, external map HUD styles and the
generated frost texture.
It expects `npm run preview -- --host 127.0.0.1 --port 5219 --strictPort`.

The final lap also adds a gentle snow-fog layer and slow signal distortion to
the A+ minimap. Your true position and the next gate stay sharp above the fog.
This uses stationary fog with reduced motion and clears when the race ends or
restarts. The `alive` browser check verifies that it activates with the finale.

## Snow handling and catch-up mechanics

The same authored snow envelope drives the road shader, grip and physical
lateral drift. Snow sway scales with speed and fades near the barriers; it
stops when the craft stops. The two cleared tracks are safer. Steering and
braking remain under player control.

Nine original gyro pickups sit in different lanes and activate on contact:

- Cyan stabilizers: 10 seconds of full grip, 92% less snow sway, and snowball
  deflection. Cyan light and the craft's shield hardware show activation.
- Amber thermal drive: 5.5 seconds of extra thrust and restored grip, with 82%
  less sway. Braking and releasing the accelerator still work normally.

Each pickup can be collected once per lap. Recovery gives two seconds of
protection and clears the visor, without respawning collected devices. Restart
resets the race-local state; no garage or save balance changes.

Snow cannons at two forest/lake stations fire without a warning only when the
player leads every rival by at least 150 metres. This is a catch-up rule on any
lap, not an automatic final-lap penalty. No rivals means no attack. Each cannon
fires at most once per lap, with an 18-second global cooldown. Shots aim ahead
and lock a lane; moving out of it still avoids the hit. A hit adds 2.4 seconds
of textured frost and blurred vision, then clears smoothly. Active stabilizers
deflect the snowball. The existing final-lap minimap fog remains separate.

The forest sections now include 24 additional lodge placements (subject to road
clearance), 76 illuminated roadside trees, benches, gifts, fences and more
over-road garlands. All use the existing original art and instancing.

`npm run validate:frostline` includes the winter rules checks.
`node scripts/frostline/review.mjs winter` exercises real pickup collection,
snow grip, close-race immunity, lead-triggered shots, visor blur/clear and pause.
Final measured evidence is recorded in `winter-validation-summary.json`.

The updated winter build completed three laps at 59.88 fps in the capped
browser, with no missed gates, recoveries or rendering errors. An uncapped
full lap, including the themed HUD, measured 280.39 fps, with a 5.1 ms p95 frame interval at 1536×864,
DPR1 and high quality on local Chrome/Metal.

## Map-aware instruments

The shared HUD now chooses a palette, original SVG emblem, translucent plates
and control advice for each of the nine circuits. Frostline adds a small snow
cap and snowflake detailing; the winter display changes with actual low grip,
stabilizers, thermal drive, visor icing and the midnight finale. Afterglow
reports active relay strikes. Other circuits retain their existing ability
interfaces and gain themed surroundings and condition readouts.

Race numbers and their anchors remain fixed. Only a small decorative layer
moves with the race clock; state labels fade in over 180 ms. Pause freezes
the decoration, and the composed reduced-motion preference disables it.
Keyboard/gamepad hints change with the active input device. Compact layouts
reserve separate positions for driving instruments, environment and powers.

The skin module and CSS load after course selection, outside the initial shell;
they add no render loop, downloaded assets or animation dependency.
`node scripts/frostline/validate-map-hud.mjs` checks all nine assets/palettes,
contextual controls, pause, input hints, compact layouts, and both OS/query
reduced motion. Results are in `map-hud-validation.json`.

## Holiday life pass

`frostline-holiday-life.ts` adds original low-poly roadside stories: paired
villagers waving in knitted hats and scarves, snowman families, present-filled
sleighs, footprints and benches, six cocoa carts with rising steam, a lit
skating pond and a four-car miniature gift train. The carts, pond and railway
have painted signs. Soft warm pools under the carts and pond lanterns use a
shared translucent material instead of adding expensive scene lights.

The villagers wave, the skaters follow closed paths and the gift train loops
on its rails. Market banners now bend gently from their fixed top edge. Quiet
sleigh-bell phrases are audible near the railway through the existing ambience
bus. All activity uses the world clock, freezes on pause and stays still with
reduced motion. Scenery is decorative and remains outside the racing corridor;
each activity site checks its clearance against every road segment.

Static and moving parts share instanced batches; original geometry and materials
are released by the existing scene teardown. No new downloaded art, animation
library, independent timer or render loop is used.

`node scripts/frostline/review.mjs holiday` checks site clearance, activity,
pause and repeatable poses, then captures the village, cocoa stop, railway and
pond. `node scripts/frostline/review.mjs holiday reduce` checks the composed
reduced-motion mode. Measurements are in `holiday-validation-summary.json`.

The holiday pass measured 255.08 fps over an uncapped full lap (7.1 ms p95)
at 1536×864, DPR1, high quality, local Chrome/Metal. The run finished with
no missed gates, recoveries or browser errors. The 30 activity sites include
50 villagers (five skating), six cocoa carts, five gift sleighs and a four-car
train, using 20 shared geometry/material batches.
