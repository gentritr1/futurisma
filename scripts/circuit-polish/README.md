# Existing circuit ambience pass

Eight maps gain original, instanced roadside scenes. Frostline keeps its completed holiday pass.

| Map | Added roadside life | Driving systems |
| --- | --- | --- |
| Greenwater | Reed-radio canteens, swaying reeds, insects, residents | Aqua Grip + Dynamo pickups; existing standing water/squalls |
| Bitterpan | Salt service stops, turbines, vanes, supply carts | Salt Anchor + Solar Charge; existing salt and crosswinds |
| Nightshift | Noodle kiosks, neon canopies, fans, floating service drones | Rain Lock + Neon Charge; two rain sheets, dry center strip |
| Polarity | Rotating field-service machinery and crews | Existing fitted powers and gravity flip |
| Tideline | Dock cafés, winches, service tanks, steam, crews | Existing powers, tides, algae, current and shortcut |
| Ascension | Observation booths, scanning dishes, flight crews | Existing launch schedule, deluge and fitted powers |
| DreamIsland | Mango stands, palms, surfboards, visitors | Existing island powers, wet basin and day/night events |
| Afterglow | Night-market kiosks, warm awnings, fans and drones | Road Anchor + Relay Charge; final-lap satellite still damages hull |

Cyan automatic pickups restore **surface grip for 8 seconds**. Amber restores boost reserve 2.5× faster and adds gentle thrust for 6 seconds. They collect once per lap, respect braking and existing faster boost, expire on recovery, and cannot cancel satellite damage. They do not grant wall or beam immunity. Existing E/B inventories are preserved on the other four circuits.

The full-lap run also exposed an Afterglow stall: continuous barrier drag exceeded the damaged engine’s pull-away force. Continuous drag is now 4 m/s²; the initial barrier impact still removes 24% of speed, and satellite damage is unchanged. A browser check starts a 28%-integrity craft at the barrier and verifies that it can drive away.

`circuit-enrichment.ts` wraps the existing runtime rather than replacing its rules. Legacy circuits use the shared chase camera. The race clock drives all animation; pause and reduced-motion mode freeze it. Geometry is instanced by material, uses one original canvas sign texture per map, and adds no shadow-casting lights. The footprint includes the platform corners, clears the sampled road envelope by at least 3 m, and skips submerged/banked locations. This is decorative scenery outside the playable road, not new obstacles.

The tradeoff is deliberately small procedural scenery and shared geometry instead of new large landmark models or dynamic reflections. Existing map landmarks, audio beds and lighting remain in use. Runtime registration is lazy so the initial download stays under its existing limits.

## Reproduce

With the existing dev server on port 5218:

- `node scripts/circuit-polish/review.mjs smoke` — all eight maps, manual throttle, physical pickups, HUD state, pause, animation, grip, recharge, brake/recovery behavior and screenshots.
- `node scripts/circuit-polish/review.mjs reduce greenwater nightshift` — reduced-motion matrix stability.
- `node scripts/circuit-polish/review.mjs benchmark` — full lap on each circuit, recovery/missed-gate counts and uncapped Chrome/Metal performance at 1536×864 DPR 1, high quality.
- `npm run build && npm run validate:build && npm run validate:seams && npm run validate:hud`.

Raw browser reports and screenshots are in ignored `.dream-loop/circuit-polish/`. The harness exposes a game reference only in its intercepted development response; production has no debug global.

## Second ambience pass

The first pass's 132 larger stops now alternate enclosed cafés, open market canopies and service bays, with map-specific sign subtitles. Residents have faces, a resting arm and staggered greetings. Soft local light and contact shadows use a shared original radial texture.

The intervals between stops now contain 868 small roadside clusters (see the current summary for exact counts), with the greatest density on Greenwater, Bitterpan and Nightshift. Another 182 large groups fill the older outdoor maps' midground: broad wetland groves in Greenwater; tanks, salt stockpiles and conveyor frames in Bitterpan. All clusters are checked against the road envelope and stay outside the racing surface. The second layer is reserved for these two open maps; the city maps keep their existing buildings and gain sidewalk activity instead.

Static and animated geometry use separate instance batches. Only animation roots and moving instances update each frame. The denser scenery remains below 30 draw calls per map and adds no dynamic lights or downloaded assets.

Grip pickups now have cyan circular road beacons; charge pickups have amber hexagonal beacons. Approach arrows point to available devices, disappear after collection, and return next lap. Spent rings remain dim. Their brightness follows the paused/reduced-motion race clock. The browser checks cover availability, collection, lap refresh and reduced-motion stability.

`detail` mode additionally captures three roadside variants and a pickup approach. Screenshots remain in `.dream-loop/circuit-polish/`.

## Bitterpan driving view

Bitterpan previously added 1.5 m of chase distance, 0.55 m of height and a 58% blend toward a point 42–84 m along the route. That made the camera aim into bends independently of the driver's steering. Its reset camera also used a different offset. These overrides are removed; Bitterpan now uses Greenwater/Nightshift's vehicle-directed chase view, including the same damping, speed lens and road/visibility guards. Its longer far clip remains for the expansive saltworks skyline. Shared acceleration/steering physics and authored salt/crosswind hazards are unchanged.

`node scripts/circuit-polish/bitterpan-camera.mjs` compares 36 identical poses across six route locations, three speeds and two steering inputs, changing only course identity. The initial and settled camera positions, aim and FOV must match, and the craft must remain within the reviewed frame window above the road. `--baseline` records the previous difference without asserting parity.

## Blender asset and lighting pass

Greenwater, Bitterpan and Nightshift now use an original Blender booth kit at their 54 roadside stops: cafés, markets and service bays. These have modeled canopies, lanterns, cabinets, counter props, seats and rooftop ventilation, with a generated material atlas. The older procedural booths remain available if the optional asset fails to load. The other maps keep their existing scenery kits.

The lighting pass adds a graded recessed interior, a compact HDR probe for curved metal reflections, soft lantern halos and floor pools, and two unshadowed lights that follow the nearest stops. Their number is bounded independently of the 54 placements. Fans and soft steam stay on the race clock. The shared source kit contains 24,520 triangles in 16 nodes, with the atlas embedded in a 1,987,296-byte GLB. Actual exported vertices remain inside the existing 12×11 m checked site envelope.

The wider material/mesh variety raises the three upgraded maps' scenery draw-call guard from 30 to 44; the other maps retain the previous guard. Full-lap performance is measured separately rather than inferred from draw count. No build-size limits were raised.

The Dream Loop target was refined through six independent visual reviews, scoring 5.2 → 6.3 → 7.0 → 7.4 → 7.8 → 8.0. `art/evidence/circuit-booths/README.md` contains asset provenance, exact generation prompts, the editable Blender source and reproduction steps. `blender-polish-summary.json` records final verification.
