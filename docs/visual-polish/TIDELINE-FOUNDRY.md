# Tideline Foundry art edition

Open `?map=tideline&edition=foundry` to compare the restrained industrial edition with the original neon Tideline. The route, elevations, widths, eight gates, powers, racing rules and rival pace remain shared. The edition link retains the race seed for a fair comparison.

The six material roles and production habits come from `docs/GREENWATER_ENVIRONMENT_ART_BRIEF.md`. This focused prototype does not reproduce the unrelated Greenwater route, 44-module kit or complete atlas package.

## Production sequence

The focal **Tidal Pump Gantry** was designed from three separate original images, in order: an orthographic front/side/top sheet, a matching driver-height hero view, and a flat material-ID pass. They are stored under `art/references/tideline-foundry/`, with their generation record. The editable gantry source is `art/blender/build_tidal_pump_gantry.py` and `art/blender/tidal_pump_gantry.blend`.

`art/blender/build_tideline_foundry.py` then assembles a separate environment from the accepted Tideline silhouettes and three finished gantries. The gantry is positioned at progress .055, .185 and .325 using the route's full 3D frame. Its 18.6 m minimum support offset and 13.205 m central height leave the deck and forward view clear. Working lamp anchors come from the asset's physical-part manifest; the fourth lamp remains dead.

The reused scenery is simplified before assembly. Five hemisphere rays per vertex bake local ambient occlusion; damp staining, faded top faces, oxidised metal and algae tint are painted into the same vertex-colour channel. The gantry's own authored paint and repair boundaries are preserved, with only the local AO applied. No normal, roughness, metallic, AO or reflection textures are introduced.

The material roles are concrete, metal, jungle, water, signage and emissive, using the brief's `GW_MAT_*` names. The GLB uses five of them; the existing transparent water/glass layer supplies water. Jungle and signage export as MASK; solid structure and sodium emission are OPAQUE. One restrained amber emission colour replaces the original cyan/violet strips. The large pressure ring remains as an oxidised refinery hoop. Caged sodium fixtures replace the aqueduct's continuous glow; one third are dark.

The original neon environment and its image-generated signage remain separate and untouched. Foundry loads its own GLB and lamp map, disables optical halation/reflection effects, and uses muted green-brown water. The loader preserves vertex colours and alpha testing through the Lambert material conversion. Ordinary scenery groups are culled by a 200 m distance bound and the camera frustum.

## Final files and budgets

- Runtime environment: `public/assets/tideline-foundry/foundry_world.glb`.
- Editable assembly: `art/blender/tideline_foundry.blend`.
- Lights, placements and asset counts: the adjacent `lights.json`, `placements.json` and `manifest.json`.
- Three installed gantries; 63,517 authored triangles, 28 material primitives, 6.26 MiB.
- Runtime water/glass add 11,204 triangles, for 74,721 total environment triangles.
- Measured along the complete authored chase path: at most 10 visible authored draws and 48,971 visible authored triangles.

## Verification

`node scripts/validate-tideline-foundry.mjs` parses the exported GLB, checks role names and alpha modes, vertex colours, UV0, normals, indexes, prohibited maps, amber emission, route identity, placement count and budgets. It tests 394,036 exported vertex and triangle-interior points against the full 3D road and glide clearance envelope, then measures the actual distance/frustum visibility contract along the lap.

`node scripts/validate-tidal-pump-gantry.mjs` checks the focal asset's exact part counts, geometry attributes, materials, reference provenance, support offset and overhead clearance.

`node scripts/validate-tideline-environment.mjs` continues to verify the original environment. It also exercises the Foundry loader branch, proving it requests the separate world, omits the neon signage atlas, selects the subdued water palette and releases its resources. TypeScript validation passes.

The final integrated production-preview race on 2026-09-04 completed three laps in 97.108 seconds, with lap times of 33.442 / 32.242 / 31.425 seconds. This exactly matched the original edition's seeded run and classification: second place, 0.965 seconds behind the leading Works rival. The run recorded zero missed gates, recoveries or context losses, twelve pickups and activations, nine perfect launches and two shield absorptions. Observed local 95th-percentile frame time was 9.2–9.3 ms, with no browser warnings/errors; this is not a cross-device performance guarantee.

The final visual comparison was inspected in the actual game. The menu fits the observed 1280 × 720 viewport without horizontal overflow, and its comparison link was exercised in both directions with the same seed preserved. The production Blender preview and the runtime presentation were reviewed separately.
