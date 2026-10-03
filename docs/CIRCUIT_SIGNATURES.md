# Nine working places — 2 October 2026

Every circuit now has an original articulated Blender scene. Each belongs to
the map's industry, weather or everyday life. The common service hardware makes
the scenes feel built by the same world; the hero silhouette and motion identify
the individual circuit.

Review the [captured gallery](../art/evidence/circuit-signatures/index.html).
With Vite running on port 5218, open
http://127.0.0.1:5218/art/evidence/circuit-signatures/index.html.
The gallery offers driving approaches, installation views and changed states,
with links to play the corresponding maps. Captures come from the actual game.

## Meaning and composition

| Circuit | Installation and reason it belongs | Motion and state |
| --- | --- | --- |
| Greenwater | Marsh Air Service: a floatplane survey/rescue dock in Water Table, with pontoons, mooring space, fuel hoses and life rings. | Gentle buoyancy and opposing twin propellers. |
| Bitterpan | Salt Reclaimer 04: a recovery wheel, conveyor and salt heaps on the pan. | Bucket-wheel rotation and contained salt flow. |
| Night Shift | Meridian Wash: a night-crew laundrette on the open quay, with benches, roof ventilation and rain downpipes. | Three staggered washer drums, roof fan and awning runoff. |
| Polarity | Vector Balance: a gyroscopic plant in the switchyard, with two structural towers and service cabinets. | Cradle tilt and status follow the actual selected deck and transfer state; nested rings rotate slowly. |
| Tideline | Intake Survey: a remote inspection vehicle in a suspended recovery cradle beside the intake gallery. | The ROV lowers with the actual tide; suspension cables adjust to remain attached. Survey, draining and dry-dock status follow the course. |
| Ascension | Deluge Reserve: twin elevated feed tanks within the existing tank farm, with pipes, valves and a contained drain tray. | Valves, supply flow and status follow the existing launch/deluge schedule. |
| Dream Island | Point Observatory: a reef-watch and astronomy shelter beside Watchtower Point. The tower frames its approach. | The dome retracts on supported rails and the telescope rises toward the sky as the actual night blend increases. It stows beneath the closed day dome. |
| Afterglow | Relay Exchange 03: a capacitor bank on the return section, with ceramic stacks, paired cooling cabinets and fans. | Local indicators reflect idle, acquisition, marking, strike and cooldown; strike uses the same warm warning family as the existing race. |
| Frostline | Ridge Road Crew: a groomer bay among the frosted trees, with snow-covered roof, thermal stores and snow piles. | A restrained blade check and warm service/head lights. |

Supports, lamps, cabinets and railings use balanced pairs. Motion stays small
enough to preserve racing cues. Signs explain the installation rather than
advertise unrelated decoration. Crew access leads toward the service verge.
Scenes face the road and slightly into the approach, using a proper rotation
instead of mirroring the model. Large signs sit above machinery or below its
silhouette so they do not obscure the hero.

The surrounding procedural district leaves a reserved working parcel and crew
approach. Afterglow's overlapping midground building, palms and roof equipment
leave this parcel clear. Greenwater moves one complete procedural tree and 38
small connected marsh vegetation components beyond the dock; plant relocation
checks the full main-loop envelope and restores original geometry on disposal.
Buildings, terrain, track and checkpoints retain their authored ownership.

## Shared art and runtime bounds

All nine scenes use the same generated worn petrol-blue, ivory, rubber and ochre
paint atlas as the timing pylons. Map accents remain restrained. Geometry,
articulation and UV placement are authored in Blender, with editable sources in
`art/blender/circuit-signatures/`. The original raster and generation prompt are
documented in [RACE_POLISH.md](RACE_POLISH.md).

| Circuit | GLB triangles | Selected-map download |
| --- | ---: | ---: |
| Greenwater | 3,932 | 547,704 bytes |
| Bitterpan | 4,028 | 558,128 bytes |
| Night Shift | 3,560 | 508,240 bytes |
| Polarity | 3,056 | 474,176 bytes |
| Tideline | 2,652 | 461,420 bytes |
| Ascension | 3,588 | 507,888 bytes |
| Dream Island | 2,840 | 466,792 bytes |
| Afterglow | 5,868 | 642,228 bytes |
| Frostline | 4,924 | 630,128 bytes |

Only the selected map's GLB downloads. Static parts share meshes by material;
moving pivots retain hierarchy. Including crew access, signs, lamps, gauges and
instanced flow, each scene remains below 6,500 rendered triangles and 22 possible
mesh draws. No additional point lights are introduced. These are local art bounds,
not measured full-game FPS guarantees.

Ambient audio is original procedural machinery sound, quiet and local within
95 metres. It starts through the already user-unlocked audio system, uses the
existing ambience bus and inherits pause, mute, user gain and radio ducking.
Distance falloff, stereo direction and map-state strength are bounded. Sources
reuse on retry and disconnect on disposal.

Animation uses the existing 120 Hz race step, freezes during pause and resets
on retry. Finish-coast delegation counts fractional ticks once. Reduced motion
freezes ambient cycles and hides flow while retaining meaningful map-state
changes. Failed or incomplete optional art leaves the original race playable.
Landmark footprints clear sampled main roads and authored shortcuts by at least
five metres beyond the reserved run-off envelope; captured sites measure over
6.45 metres. Crew paths stay outside the race surface.

Tradeoff: these are bounded presentation layers. They explain and enrich existing
mechanics without adding collision bodies or changing race rules. This is a
coherent environment pass; release-level animation, observed player tuning,
performance testing across target devices and actual online multiplayer remain
separate work. The earlier snapshot/input boundary is described in RACE_POLISH.

## Reproduce and verify

```sh
blender --background --python scripts/race-polish/build_circuit_signatures.py
node scripts/race-polish/validate-signatures.mjs
node scripts/race-polish/validate-signature-audio.mjs
node scripts/race-polish/signatures.mjs
node scripts/race-polish/signatures.mjs --reduce
node scripts/race-polish/systems.mjs
npm run build
npm run validate:build
```

The browser harness uses Playwright with installed Chrome and exposes the game
only by a development response interceptor. Normal and reduced-motion reports
record placement, dimensions, state, animation clocks, mesh positions and
console errors. Changing-state fixtures use the actual map clocks and command
APIs. Audio verification uses mocked Web Audio ports to check routing, bounded
mix values, falloff, panning, user unlock and source lifecycle; it does not claim
a human listening test. Road, physics, race, resource ownership, presentation and
module seam checks also pass. Evidence lives in `art/evidence/circuit-signatures/`.

## Visual review verdict

All nine installations were inspected in close views and from the driving
approach. Flood/drained, standby/deluge, day/night, lower/upper and relay-strike
states were checked where applicable. The installations now have distinct
silhouettes, consistent materials, restrained accents and a visible purpose.

The review changed the work: signs were resized or lowered to expose machinery;
Night Shift moved away from an overlapping block; the gravity plant moved to an
open switchyard; Afterglow's parcel cleared an overlapping building and palms;
the marsh dock cleared connected vegetation; crew access gained correct normals;
the ROV gained extending suspension cables; the observatory gained outward-facing
dome surfaces, stowed day optics, retraction rails, rollers and braced supports;
the groomer bay gained roof snow. These are fixes made in the assets and runtime,
not photographic substitutions.

The driving composition intentionally keeps the road dominant. Dream Island's
tower frames a partial first glimpse of the observatory; the installation view
reveals its full structure. Tideline's inspection dock belongs beyond pressure
glazing, so the flooded view is filtered and the drained view becomes clearer.
Signs are readable up close; the asset silhouette does the work at racing speed.

The new installations pass this stylized game's coherence and completion check.
The whole game still has visible differences in texture sharpness and distant
scenery density between older maps. They are the next environment quality targets;
these captures do not establish photorealistic AAA production quality.

## Lighting and completion refinement

The follow-up polish adds contact shading beneath actual equipment footprints
and restrained warm spill below service lamps. Two merged decal meshes per map
keep the addition bounded; pools stay on the service platform. Authored opaque
equipment now casts and receives the existing sun shadows. No new point lights
or shadow maps are introduced, although existing shadow passes now include this
equipment. Contact patches retain some grounding outside the moving sun-shadow
coverage. These patches are art-directed approximations, not physical lighting.

Low sign frames and their live labels move together beside the crew entrance.
Greenwater's pontoons now meet the dock water. Polarity's cradle follows the real
transfer blend and, with reduced motion, cuts at the same midpoint as the camera.
Afterglow's strike ring follows the sampled road normal and sits 0.16 m above it;
a controlled fixture verified this on a road grade greater than 10%.

The driving-view review also repaired Bitterpan's disconnected checkpoint
crossbars: their shared box is 0.52 m wide, but the old transform assumed a unit
box. Each beam now reaches both resolved post faces. A browser geometry check
verifies all twelve gates, without changing their scoring envelope or post positions.

Current captures and reports: `art/evidence/circuit-polish-final/`, with gallery at
http://127.0.0.1:5218/art/evidence/circuit-polish-final/index.html.
All nine maps passed the updated browser checks; the five state-changing scenes
also passed reduced-motion checks. The Circuit Tour launch display was checked
against real settlement and persisted progress at five viewport sizes. Demo runs
do not count and repeated finishes do not repay the first-finish bonus. Circuit
completion labels are available to assistive technology.

```sh
node scripts/race-polish/signatures.mjs --polish
node scripts/race-polish/signatures.mjs polarity afterglow tideline dreamisland ascension --reduce --polish
node scripts/race-polish/tour.mjs
```

[Replayability review](REPLAYABILITY.md) distinguishes the implemented tour from
proposed map mastery, modes, ability variants and a possible free season journey.
