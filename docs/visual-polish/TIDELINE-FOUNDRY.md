# Tideline / painted pumpworks

The Foundry material language is now the default Tideline. `?map=tideline` and the older `?map=tideline&edition=foundry` link open the same rebuilt reactor and port circuit. This revision supersedes the vertex-color prototype and its airborne route.

## Art contract

A beautifully remembered PS2 racer: painted detail on simple, legible geometry. Six 1024 × 1024 role atlases carry broad shading, damp stains, rust runoff, sun bleach, patched paint and stencils. The original PNG sheets live in `art/textures/tideline-foundry/`; lighter JPEG delivery sheets live in `public/assets/tideline-foundry/textures/`. `atlas-generation.json` records the original prompts, native image-generation provenance and delivery hashes.

Concrete, metal, jungle, water, signage and emissive are the only material roles. The GLB embeds the five structural roles; the water shader uses the sixth sheet. Lambert conversion preserves the UV textures and restrained vertex tints. No normal, roughness, metallic or separate AO maps, bloom or optical halation are used. Sodium amber is the environment's emissive accent.

Repeated concrete/steel modules use normal, repaired and damaged atlas regions. Gantries also vary their wear by instance. Every fourth retained tunnel rib is heavy; two are broken. Crown pipes and sagging cables provide close parallax. The pump-hall fork has real mouths through the retaining walls and tunnel bays. Place names use small plates with letters below 0.6 m; instructions are confined to the HUD. Worn approach bars lead to the three gantries.

## Reference to model

The gantry has an original front/side/top sheet, separate hero image and material-ID pass. The new painted atlases reference that hero. It contains two mossy concrete feet, two welded repair plates, three parallel trusses, one ladder, one side pump and four caged lamps, one dead. Its taller steelwork is calibrated to the hero silhouette while preserving the open 36 m portal and metre-scale feet.

The asset has 3,504 triangles and five material draws. Its lower support offset is 18.6 m and its central clearance exceeds 15 m. The editable Blender scene packs reference planes and texture sheets; only named runtime geometry and part markers export.

`/art-review.html` on the development server displays the original hero beside the exported asset using the game's actual `NeonEnvironment` Lambert loader. Its fixed camera is shared with the Blender preview: position (4, 2.4, 74), look-at (0, 9.5, 0), aspect 1.5. The generated hero has no camera metadata, so this is a calibrated composition, not a claim of recovered source-camera data. Review material and silhouette separately from the simplified test ground/background.

Visual acceptance requires a reviewer to name five shared visible details. Geometry validators are an independent clearance and delivery check; passing them cannot accept the artwork.

The independent five-detail review was repeated on 5 September 2026 against the [saved comparison file](../../art/evidence/tideline-v3/gantry-hero-versus-model.png). A reviewer who did not author the asset identified these details in both views:

- Weathered olive pillars on flared concrete feet.
- Triangular steel bracing across the overhead span.
- An exterior ladder on the left pillar.
- Four caged lamps, three amber and one dark.
- A circular pump on the right pillar above a rectangular service plate.

The reviewer also noted the larger pump, heavier truss and more regular rust streaks in the model. The test ground is more repetitive and its broad stripe brighter than the hero. This passes the shared-detail criterion; it is not a claim of identical rendering or background fidelity.

## Build and budgets

1. Run `scripts/build-tideline-route.mjs` if the route changes.
2. Run Blender with `art/blender/build_tidal_pump_gantry.py`.
3. Run Blender with `art/blender/build_tideline.py`; `build_tideline_foundry.py` remains a compatibility entry point.
4. Run `npm run test:code`, then inspect the side-by-side and actual race.

Runtime assembly: `public/assets/tideline-foundry/foundry_world.glb`. Editable assembly: `art/blender/tideline_foundry.blend`. Lights, placements and counts are beside the GLB. The assembly shares five atlas materials across its three gantries and sector meshes. Current export: 75,526 triangles, 52 primitives and 8.45 MiB. The environment remains below 100,000 triangles including water/glass. Distance/frustum culling limits authored visibility to 18 draws in the measured chase sweep.

See [course notes](TIDELINE.md) for the tide, shortcut and runtime limitations. Earlier Crown/flight reference art remains archival and is not loaded by this map.
