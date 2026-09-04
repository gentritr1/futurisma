# Tidal Pump Gantry / painted revision

The original orthographic, hero and material-ID references remain here with their generation record. The hero is now followed by six painted 1024 role sheets. `atlas-generation.json` records their exact native image-generation prompts and delivery hashes. Lossless PNG sources are in `art/textures/tideline-foundry`; JPEG delivery sheets are embedded by Blender. The image tool did not expose a named model override.

The exported model uses metres, +Y up and a zero root. X spans the road; +Z faces the approach. Its bounds are approximately [-23.80, 0, -4] to [27.45, 23.71, 4]. The steelwork's height was calibrated against the hero composition; the concrete feet retain their authored scale. Supports stay 18.6 m from center and the portal clears 15.36 m vertically.

There are two concrete feet, two welded repair plates, three parallel overhead trusses, one exterior ladder, one side pump and four caged lamp heads. Three glow amber and the last is dead. The 3,504-triangle asset uses five indexed material primitives with normals, UV0 and restrained vertex tints. Painted base atlases carry the wear and baked shading. No PBR detail maps are used. The sixth role, water, is used by the map instead of the dry gantry.

Rebuild with Blender using `art/blender/build_tidal_pump_gantry.py`. It produces the GLB, manifest, preview and editable `art/blender/tidal_pump_gantry.blend`. Packed image planes are in the hidden `REFERENCE_PLANES_NOT_EXPORTED` collection; lights, cameras and reference planes are excluded from the GLB.

Inspect the actual game-loader comparison at `http://127.0.0.1:5200/art-review.html`. The Blender and engine cameras share position (4, 2.4, 74) and look-at (0, 9.5, 0). The hero's camera is estimated from its composition because generated artwork has no camera metadata. Five shared visible details, independently named by a reviewer, are the acceptance condition; a green validator is not visual approval.
