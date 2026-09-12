# F-3D seam

Both GLBs are exported. Nodes carry geometry in metres with transforms applied and a common origin; Blender's Z is exported as glTF Y.

- props.glb: PR_ball (168), PR_ring (256), PR_sphere (216), PR_pipes (340, 4 m high), PR_bollard (64) and PR_bollard_core (12, combined 76), PR_plinth (36).
- capsule.glb: CAP_frame (240), CAP_glass (216), CAP_core (44), CAP_cap (88): 588 triangles, centred bounds Y = -1.5…+1.5.
- Each node has atlasRole, atlasCell, atlasRect and recipe extras. Geometry UVs are prepacked, including the glTF V flip. Retain the GLB maps and vertex colours when instancing.
- Reflections module exports createDreamIslandChrome, createDreamIslandGlass, bindDreamIslandEnvironment, DreamIslandReflections. Runtime binding and glow are being finished in F-3D; no edits to F-CODE files are needed from this task.
- PR_bollard_core is an additional required mesh node: a separate material needs its own instance draw unless F-CODE deliberately combines the core/base into a shader using a geometry attribute.
- CAP_glass is transparent and needs to render after opaque nodes. Separate chrome, glass, and core recipes inherently need separate draws; the brief's single capsule draw cannot retain the three materials with stock InstancedMesh. Count actual draws in the combined soak; do not report the one-draw estimate as measured.

F-3D runtime binding is complete: the water owner scans contracted node names and installs the chrome/glass recipes after PMREM is ready. Glow reads the capsule/bollard instance transforms and the baked/instanced fish transforms. The source geometry loader remains F-CODE's seam: its current sourceGeometry() still returns primitives. Replace those sources with the GLBs, retaining their maps/UVs/colours. F-3D's race evidence uses an isolated eafe0b9 tree and therefore does not claim the new props/capsules were loaded by the gameplay consumer.

AO is patched into painted.glb's existing colour accessors by `build_dreamisland_painted.py -- --alive-ao`. Its independent byte proof confirms all non-colour bytes identical. Do not run the AO option twice on the already baked output; `ao/painted-before.glb` is the source for reproducing this pass.
