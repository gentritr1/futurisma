# Tideline — MAP 05

A drowned reactor circuit that climbs through a working port and crosses the sea on two guided glides. The route is 2,751.6 metres long, has eight ordered gates and defaults to three laps. Its broad ramps peak at 9.84 degrees and remain unbanked throughout.

The underwater section sits around 24 metres below the ocean. Cyan aqueduct ribs and transparent glazing frame the road; kelp, large manta silhouettes and sunken reactors give the water depth. Port Afterlight replaces the cyan with amber drydock halls, cranes and navigation towers. The two flight spans have no road triangles beneath them, with pairs of cyan beacons showing the guided corridor. The second span returns through an inclined aqueduct.

## Runtime contract

- `TidelineCourse` implements the current `RaceCourse` contract.
- `travelModeAt(progress)` returns `submerged`, `surface` or `air`.
- `flightArcs` contains SKYLIFT (.470–.645, 481.5 m) and PELAGIC (.750–.875, 343.9 m).
- Route stations contain 3D positions and tangents. The road is 24 m wide, the guided air corridor 20 m wide. Projection selects the nearest XZ segment and restores its true height, so temporary vertical lag cannot distort progress.
- Local right stays horizontal; local up follows the road pitch. There is no authored roll.
- `TidelineEnvironment.load()` loads the Blender scenery, then adds transparent water/glass and slow bubbles. Reduced motion freezes water and caustic drift and removes the bubble field.

## Authored assets

`art/blender/build_tideline.py` builds `art/blender/tideline_world.blend` and the public GLB/manifest/light anchors. The Blender asset has 84,668 triangles, 46 primitives and a 4.34 MiB payload. It contains 45 aqueduct ribs, 6 reactors, 64 kelp beds, 5 mantas, 12 port halls, 6 cranes, 8 boats, 4 flight lenses, the Pelagic Crown transfer ring and 49 lamp anchors. The runtime water and glass add 11,204 triangles; water, glass and bubbles use three draw calls.

Nine framed Pelagic Authority signs use an original embedded 1024-pixel atlas. Scenery and signage together contain 86,090 triangles, 49 primitives and a 4.75 MiB payload. Their colour and emission textures survive the runtime Lambert conversion; all resources share scene disposal.

## Verification

- `node scripts/validate-tideline.mjs`: physical route continuity, 8,262 lateral/height projection checks, zero roll and modest pitch, two actual road gaps, ordered gates and safe recovery, plus all rival tiers deterministic at 60/120/240 Hz without overlap.
- `node scripts/validate-tideline-environment.mjs`: GLB budgets and metadata, then 503,073 world-space vertex and triangle probes against the full 3D road/glide clearance envelope. Tests the actual loader's atlas preservation and resource cleanup for either partial asset-load failure.
- Works rivals complete three laps in 96.14 / 98.15 / 99.91 seconds before the player's runtime tuning. Their pace is authored and independent of player speed.
- Three visible phase bulkheads share the player's collision bounds. All rival tiers avoid them with a minimum 2.30 m hull clearance over 4,527 simulated near-field samples.

The course is a guided hover/glide circuit rather than unrestricted free flight.

## Racing and verification

The lit underwater lane returns nitro reserve at 1.85× the normal recharge rate.
Its side is fixed for each lap, then changes with the shared supply phase. Air
recharge is 0.75×. Three painted launch windows reward a timed Surge with one
extra second; shield timing can absorb a bulkhead and return reserve. Both
devices are Blender-built mechanisms that mount and deploy on the vehicle.
Space/Shift remain nitro; E deploys the held device. The camera stays upright.

The integrated production-preview race on 2026-09-04 finished three laps in
97.108 seconds, 0.965 seconds behind the leading Works rival. Lap times were
33.442 / 32.242 / 31.425 seconds. It recorded zero missed gates, zero recoveries,
zero context losses, twelve pickups and activations, nine perfect launches and
two shield absorptions. Time by travel mode was approximately 36.1 seconds
submerged, 35.6 on the surface and 25.4 in air. The local browser's observed
95th-percentile frame time was 9.2–9.3 ms; this is not a cross-device guarantee.
The browser reported no warnings/errors. A separate real-mix run confirmed
Rob Playford playback and the five active ambience beds; paused power clocks
held steady and resumed. Music balance still depends on the mix section and
the user's saved slider setting.


## Reference-first landmark refinement

The user's references established chunky silver industrial structures, cyan glass tunnels, hazard-yellow rails and saturated violet/indigo lighting. The new landmark is original: the Pelagic Crown. The built-in image generation tool first produced `art/reference/pelagic-crown-three-view.png`, showing the same machine from front, side and three-quarter views. Its exact generation prompt is saved beside it in `pelagic-crown-prompt.txt`.

The Blender pass then followed the sheet's measurable shape: 90 m outer ring, 76 m empty aperture, 12 m depth, two 24 m spherical pressure pods, dark turbine ports, amber windows, cyan inner lip, violet status strips and four hazard clamps. The port's silver/indigo material contrast was increased and the aqueduct frames thickened. The runtime model deliberately omits the concept's tiny surface bolts to preserve clarity and the geometry budget.

The ring frames the first glide approach at progress .435. Its plinth sits beneath the road and its aperture keeps the full driving volume clear. A Blender render (`pelagic-crown-blender-check.png`) exposed overlapping port rows; those four hall/crane placements were removed before the final export. The completed environment, signage, runtime water and glass total 97,294 triangles. Clearance validation also covers triangle interiors and the full air trajectory.
