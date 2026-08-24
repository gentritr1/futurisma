# Greenwater Strip — Environment Art Production Brief

Status: ready for design-agent production

Target package: `GREENWATER_ENVIRONMENT_v1.0.zip`

Map authority: `src/game/data/greenwater-blockout.json`

Validation authority: `src/game/data/greenwater-validation.json`

## 1. Objective

Turn the approved Greenwater Strip blockout into the first authored FUTURISMA race environment. The result must feel like a remembered early-2000s PS2 racer: humid, low-resolution, industrial, slightly feral, and built from repaired aerospace infrastructure being reclaimed by jungle.

This is an asset-production pass, not another map-design pass. Preserve the proven route, handling, checkpoints, recovery behavior, hazards, fog zones, and music map exactly.

## 2. Locked runtime baseline

- Closed centreline: 2,515.982 m.
- Surface width: 19–24 m.
- Coordinate system: 1 unit = 1 metre, +Y up, +X east, +Z south, right-handed.
- World origin: centre of the start/finish line at surface height.
- Race direction, elevations, widths, banking, checkpoints, hazards, and recovery anchors come only from the map JSON.
- Target lap: 34–36 seconds; current clean autoplay lap: 34.499 seconds.
- Current measured peak after the Phase 1 fallback dressing: 92 draw calls,
  42,696 triangles, 86 geometries, and 17 textures during a five-lap
  1280 × 720 high-quality soak. The full measurement record and
  post-integration regression gates are in `docs/PERFORMANCE_BASELINE.md`.
- The existing procedural course remains the collision and gameplay source of truth.

The Phase 1 fallback dressing currently reuses TOTEM's accepted prop kit for 20
sparse placements: the two cable hazards, wetland reeds, canopy plants, two
off-track repair units, and the start-area pit lineup. Final environment
integration must hide or replace the distributed fallback dressing so those
objects are not duplicated; the pit lineup may remain if it still fits the
authored start-area composition.

Do not alter the centreline, widen or narrow the course, create alternate routes, move checkpoint gates, move hazards, change fog behavior, or edit TOTEM.

## 3. Art direction

### The read

The broad silhouette should be calm and legible at race speed. The player reads the route from large value groups and recurring signals before noticing surface detail.

- Pale wet concrete and faded runway paint form the navigable ribbon.
- Oxidized aerospace steel and sodium fixtures mark built structure.
- Deep blue-green jungle masses frame the track without hiding its next decision.
- Warm amber means route continuity, braking information, or a usable opening.
- Hazard red is reserved for danger, wrong-way edges, and the antenna beacon.
- Cyan is a scarce emissive accent, not a blanket cyberpunk wash.

### Visual texture

- Deliberate low-poly silhouettes with controlled faceting.
- Hand-painted 128–1024 px-era texture language, nearest-friendly and readable when downsampled.
- Vertex-colour AO, damp staining, sun bleaching, repairs, algae, and one or two strong material boundaries per object.
- Large, stable shapes; sparse decals; no micro-greeble noise.
- Jungle is card-based and chunky, with three strongly different canopy silhouettes rather than many near-duplicates.
- Water is opaque-to-translucent green-brown, graphic, and cheap; it is not a realistic reflective surface.

### Avoid

- Generic neon cyberpunk, vaporwave grids, purple-blue city glow, or sci-fi hologram clutter.
- Photoreal PBR, normal-map noise, ray-traced reflections, dynamic shadows, bloom-dependent readability, or volumetric effects baked into meshes.
- Direct imitation of a named game or franchise.
- Decorative arrows that contradict the runtime route grammar.
- Dense props, foliage, or hanging cables inside the track envelope or sightline to the next gate.

## 4. Navigation grammar

Art must strengthen the existing gameplay signals:

1. Route-facing amber lamps repeat along the valid edge and through openings.
2. Chevron count communicates turn severity: one for guidance, two for commitment, three or four for hard braking.
3. Distance boards use `3`, `2`, `1` and remain readable before the braking point.
4. Checkpoints use paired pylons with a clear empty centre. They must not resemble the start/finish gantry.
5. The Cradle finish is the only full-span roof beam with chequer band and twin amber beacons.
6. Wrong-way openings use a broken red edge rhythm, closed silhouette, or large cross-hatching—not more arrows.
7. At every blind approach, the next valid opening must be the brightest and cleanest gap in the frame.
8. Foliage, fog cards, steam, and landmark detail must never obscure a gate, hard-turn chevron stack, or the next 1.5 seconds of racing line.

All signage must communicate through shape and value before text. Do not invent lore copy for gameplay-critical signs.

## 5. Eight landmark anchors

Build these at the exact dimensions and world positions below. Final orientation follows the route and notes in the map JSON; transforms must be recorded in the placement manifest.

| Node | World position (m) | Height / footprint | Required silhouette |
| --- | --- | --- | --- |
| `GW_LM_CRADLE` | `(0, 0, 0)` | 22 m / 38 × 10 m | 34 m clear-span start/finish gantry, full roof beam, twin amber beacons |
| `GW_LM_WATER_TOWER` | `(-61.816, 1.583, -258.184)` | 28 m / 12 × 12 m | 7° lean, inside T1, unmistakable thin-neck tank |
| `GW_LM_HANGAR` | `(-380.895, 0.5, -229.363)` | 34 m / 90 × 64 m | Monolithic shell with one warm lit mouth |
| `GW_LM_CRANE` | `(-431.881, 1, -228.701)` | 18 m / 26 × 6 m | Collapsed boom that frames the Hangar apex without crossing the route |
| `GW_LM_WEIR` | `(-690.362, -6.274, -187.455)` | 6 m / 160 × 8 m | Long horizontal water sheet on the outside of Greenwater Sweep |
| `GW_LM_ANTENNA` | `(-652.448, 12, 261.224)` | 60 m / 8 × 8 m | 12° lean and one red lamp; recognizable from three sectors |
| `GW_LM_TANKS` | `(-381.315, 8.252, 330.216)` | 18 m / 300 × 40 m | Nine spheres stepping from 18 m to 6 m toward T10 |
| `GW_LM_TOWER` | `(-63.592, 0.551, 286.115)` | 26 m / 18 × 18 m | Sodium-lit control tower behind the T10 apex |

The landmarks are orientation anchors first and lore objects second. Each must pass a flat-black silhouette test at its intended approach distance.

## 6. Modular environment kit

Deliver exactly 44 top-level kit roots. The source concept's row-level variant
totals do not match its category totals, so this contract resolves the ambiguity
explicitly. Only the family roots called out below may contain named child
variants; all other roots are one production module.

### Surface — 11 roots

1. `GW_MOD_surface_deck_straight` — children `w19`, `w22`, and `w24`, each 32 m long.
2. `GW_MOD_surface_deck_arc_r45`.
3. `GW_MOD_surface_deck_arc_r55`.
4. `GW_MOD_surface_deck_arc_r70`.
5. `GW_MOD_surface_deck_arc_r85`.
6. `GW_MOD_surface_deck_arc_r100`.
7. `GW_MOD_surface_deck_arc_r180`.
8. `GW_MOD_surface_banking_transition` — children `bank06` and `bank12`.
9. `GW_MOD_surface_grade_ramp` — children `grade02` and `grade06`.
10. `GW_MOD_surface_kerb_drain` — children `kerb` and `drain`.
11. `GW_MOD_surface_decal_set` — children for repairs, expansion joints, numerals, threshold bars, chequer, and hatching.

### Edge and signage — 9 roots

1. `GW_MOD_edge_soft_rail_8m`.
2. `GW_MOD_edge_soft_rail_post`.
3. `GW_MOD_edge_hard_revetment_8m`.
4. `GW_MOD_edge_hard_revetment_corner`.
5. `GW_MOD_edge_catch_net_8m`.
6. `GW_MOD_sign_chevron_set` — children `count01` through `count04`.
7. `GW_MOD_sign_distance_set` — children `board03`, `board02`, and `board01`.
8. `GW_MOD_sign_checkpoint_pylon_pair`.
9. `GW_LM_CRADLE` — the unique, non-modular finish gantry.

### Structures — 14 roots

1. `GW_MOD_structure_hangar_bay`.
2. `GW_MOD_structure_hangar_mouth`.
3. `GW_MOD_structure_hangar_corner`.
4. `GW_MOD_structure_gantry_leg`.
5. `GW_MOD_structure_gantry_span`.
6. `GW_MOD_structure_gantry_walkway_12m`.
7. `GW_MOD_structure_pipe_run_8m`.
8. `GW_MOD_structure_pipe_elbow`.
9. `GW_MOD_structure_tank_sphere` — children `small`, `medium`, and `large`.
10. `GW_MOD_structure_weir` — children `wall_16m` and `culvert`.
11. `GW_LM_WATER_TOWER`.
12. `GW_LM_ANTENNA`.
13. `GW_LM_CRANE`.
14. `GW_LM_TOWER`.

### Nature and light — 10 roots

1. `GW_MOD_nature_canopy_tree_a` — three-card hybrid.
2. `GW_MOD_nature_canopy_tree_b` — three-card hybrid.
3. `GW_MOD_nature_canopy_tree_c` — three-card hybrid.
4. `GW_MOD_nature_fern_cluster`.
5. `GW_MOD_nature_vine_drape`.
6. `GW_MOD_nature_reed_card`.
7. `GW_MOD_water_set` — children `plane_32m` and `weir_sheet`.
8. `GW_MOD_light_sodium_fixture`.
9. `GW_MOD_light_flood_mast`.
10. `GW_MOD_light_beacon_lamp` — compatible in colour language with TOTEM's emissive sheet.

`GW_LM_HANGAR`, `GW_LM_WEIR`, and `GW_LM_TANKS` are placed landmark
assemblies composed from these kit roots. They are not additional art-kit roots,
which keeps the manifest at exactly 44 while retaining all eight runtime
landmark anchors.

## 7. Placement and hazard constraints

Build the environment around the exact twelve sector ranges in the map JSON:

`RUNWAY_START`, `T1_CRADLE_BEND`, `WATER_TABLE`, `LINK_APRON`, `HANGAR_SIX`, `HANGAR_EXIT`, `GREENWATER_SWEEP`, `CANOPY_PASSAGE`, `THE_ELBOW`, `FUEL_ROW`, `T10_TOTEM_TURN`, and `RUNWAY_HOME`.

Preserve clear, readable space around these functional hazards:

- Standing water: 432.271–586.519 m, left third of surface.
- Steam vents: 674.519 m at -8 m lateral and 736.115 m at +7 m lateral.
- Cable coils: 781.239 m at -8.5 m lateral and 1,278.982 m at +9 m lateral.
- Dense fog bank: 1,391.152–1,451.152 m.
- Cosmetic cargo hook: 724.115 m; it must remain non-colliding.

Art may improve the visual telegraph but must not change the hazard footprint or block the clean racing line.

## 8. Runtime budgets

These are hard acceptance limits, measured in the normal chase camera:

- Final complete scene: at most 120 peak draw calls.
- New authored environment contribution: at most 24 simultaneously visible draw calls, leaving integration headroom.
- Final complete scene: at most 220,000 simultaneously visible triangles.
- New authored environment contribution: at most 175,000 simultaneously visible triangles.
- Exactly five 1024 × 1024 RGBA art atlases: concrete, metal, jungle, water, and signage.
- One 512 × 512 RGBA emissive atlas.
- No normal, roughness, metallic, AO, height, or reflection texture maps. Put AO/weathering in vertex colours and use material scalar values.
- At most six environment material roles: `concrete`, `metal`, `jungle`, `water`, `signage`, `emissive`.
- OPAQUE for concrete, metal, and emissive; MASK for jungle and cutout signage; BLEND only for water.
- No dynamic shadow requirement, skinned meshes, bones, morph targets, video textures, or lights embedded in the GLB.
- Use indexed geometry, UV0 and normals on every primitive, painted vertex colours, and no negative or non-uniform root scale.
- Hard-cull ordinary decoration beyond 200 m. Preserve simplified far silhouettes only for deliberate landmark views, especially the antenna.
- Repeated vegetation and props must be instanced or merged per sector and material. Never merge the entire course into one object.

The six-sheet limit deliberately resolves the concept document's atlas ambiguity as five 1024 base sheets plus one 512 emissive sheet.

## 9. Naming and export contract

Use stable ASCII names with no spaces.

- Landmark roots: `GW_LM_<NAME>`; optional far silhouette child: `GW_LM_<NAME>_LOD1`.
- Kit roots: `GW_MOD_<CATEGORY>_<NAME>_<VARIANT>`.
- Fully placed sector roots: `GW_SECTOR_<SECTOR_NAME>`.
- Placement records: `GW_PLACE_<MODULE>_<NNN>`.
- Materials: `GW_MAT_concrete`, `GW_MAT_metal`, `GW_MAT_jungle`, `GW_MAT_water`, `GW_MAT_signage`, `GW_MAT_emissive`.
- Textures: `greenwater_<role>_1024.png`, except `greenwater_emissive_512.png`.

Every GLB must be glTF 2.0, metre scale, +Y up, with zeroed root transform and the start/finish world origin unchanged.

## 10. Required package

`GREENWATER_ENVIRONMENT_v1.0.zip` must contain:

1. `models/greenwater_artkit.glb` — all 44 modules at useful local origins and pivots.
2. `models/greenwater_environment_runtime.glb` — final visual environment fully placed at world coordinates, grouped and merged per sector/material, with no gameplay collision.
3. `data/greenwater_art_placements.json` — module ID, world position, rotation, scale, sector, material role, cull distance, and optional LOD relationship for every placement.
4. `textures/` — the five 1024 atlases and one 512 emissive atlas as PNG.
5. `previews/` — six 1600 × 1000 chase-camera views: start, Water Table, Hangar entry, Greenwater Sweep, Canopy/Antenna, and T10/return.
6. `MANIFEST.json` — file list, byte sizes, SHA-256 hashes, module counts, mesh/triangle/material/texture counts, bounds, and coordinate declaration.
7. `VALIDATION.json` — GLB parse result plus pass/fail for transforms, normals, UV0, vertex colours, indexes, alpha modes, missing images, naming, bounds, and budgets.
8. `HANDOFF.md` — export notes, known limitations, material roles, placement format, and exact rebuild steps.
9. `source/` — complete editable source snapshot that regenerates the exported package.

The GLBs may embed their image bytes for portability, but the identical source atlas PNGs must also be present in `textures/` and their hashes documented.

## 11. Acceptance views

The package is accepted only if all six views show:

- The next valid route opening within one glance.
- A landmark or unique sector silhouette without relying on HUD text.
- Fog depth that preserves the next gameplay decision.
- No false openings brighter than the correct route.
- No foliage or prop intersection with the surface envelope, gate centres, chevrons, or distance boards.
- A readable dark-silhouette version and a flat unlit material-ID version.

The previews are evidence, not a substitute for exports. Do not return a concept document alone.

## 12. Stop conditions

If a requirement conflicts with the locked map JSON, stop and report the conflict instead of changing the course. If a visual idea exceeds a runtime budget, simplify the material, silhouette, or placement density before proposing a budget increase.

Keep TOTEM, gameplay code, map JSON, music, HUD, and physics untouched.
