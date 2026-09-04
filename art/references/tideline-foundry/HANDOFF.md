# Tidal Pump Gantry

The three generated deliverables were inspected before modeling: `tidal-pump-orthographic.png`, `tidal-pump-hero.png`, and `tidal-pump-material-id.png`. `generation.json` records the built-in image generation prompts and sequence, including the two orthographic corrections. The image tool did not expose a named model override.

The generated ortho panels still drift in scale. Separate front, side and top image planes in `art/blender/tidal_pump_gantry.blend` are calibrated to the explicit metre dimensions; they guide the silhouette while measured mesh geometry governs placement. The three open overhead trusses are parallel in depth at the same elevation. Five packed image planes live in the hidden `REFERENCE_PLANES_NOT_EXPORTED` collection. References are not runtime texture assets.

The local-origin `GW_LM_TIDAL_PUMP_GANTRY` GLB uses metres and +Y up. Local X spans the route and local Z follows its depth. Bounds are `[-24.284, 0, -4]` to `[27.45, 20.05, 4]`. Lower supports remain at least 18.6 m from centre; the opening has 13.205 m minimum vertical clearance. The map assembly places three copies outside flight sections and validates actual world geometry.

The model has two concrete feet, two welded repair plates, one exterior ladder, one side pump drum, three overhead trusses, and four caged lamp heads. Three lenses emit restrained amber and one is dead. It contains 3,180 triangles, five indexed material primitives, and no images or PBR texture maps. All primitives have normals, UV0 and painted CORNER vertex colours with dampening, ambient occlusion, wear and sun bleaching. Materials use the brief's `GW_MAT_concrete`, `metal`, `jungle`, `signage` and `emissive` roles. Water is absent from this dry module.

Rebuild with Blender 5.2:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python art/blender/build_tidal_pump_gantry.py
node scripts/validate-tidal-pump-gantry.mjs
```

Runtime output is `public/assets/tideline-foundry/tidal-pump-gantry.glb` plus its manifest and validation JSON. The public preview is a small WebP; the full rendered PNG is retained here as source review evidence. The source Blender file embeds the reference sheets and excludes its lights, cameras and references from export.
