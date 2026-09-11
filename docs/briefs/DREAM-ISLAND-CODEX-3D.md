# Dream Island — Codex 3D polish track (parallel-safe)

This is a brief for Codex to do focal-asset 3D work **in parallel** with, or after, the Phase B implementer, without the two overwriting each other. Read `docs/briefs/DREAM-ISLAND-HANDOFF.md` first for repo, node, Blender and the rules; read `docs/briefs/DREAM-ISLAND-LEVEL.md` §7 for the art contract.

## The collision rule (non-negotiable while Phase B is uncommitted)

Phase B owns these and you must NOT edit them: `art/blender/build_dreamisland_painted.py`, `art/blender/dreamisland_mesh.py`, `art/blender/dreamisland_painted.blend`, `public/assets/dreamisland/painted.glb`, `public/assets/dreamisland/painted.json`, `public/assets/dreamisland/textures/*`, `src/game/dreamisland-*.ts`, `scripts/*dreamisland*`. Check `git status --short` before you start; if any of those are still modified/untracked-and-growing, Phase B is live.

You own, and only you write to: `art/blender/build_dreamisland_heroes.py`, `art/blender/dreamisland_heroes.blend`, `public/assets/dreamisland/heroes/*.glb`, `public/assets/dreamisland/heroes/heroes.json`, `art/evidence/dreamisland-v1/heroes/**`. Nothing else. Integration into the painted world is a later, separate step done after Phase B is committed.

## What to build

Higher-fidelity versions of the four assets the player looks at longest, each as its own GLB on the **same six painted atlases** Phase B uses (`public/assets/dreamisland/textures/{concrete,metal,jungle,water,signage,emissive}.jpg` + `jungle-card.png`, UV rects in `public/assets/dreamisland/atlas-manifest.json` — read-only for you). Material names must be exactly `DI_MAT_<role>` so the runtime's material walk and the render rule treat them like the painted world's.

| Asset | Reference | Target metres | Tri budget | The five silhouette features a reviewer will look for |
|---|---|---|---|---|
| `clock-tower.glb` | `art/references/dreamisland/sheets/s5_clock_tower_ortho.png` (front/side/back/top at one scale) + `heroes/05d_clock_court_day.png` | 14 m tall, plinth 8 m square, face Ø 3.2 m | ≤ 6,000 | stepped three-tier plinth; square mossy shaft with visible block courses; round white face with two plain hands on the `emissive` face rect; pitched roof with finial; winding side stair with parapet that actually reads as steps at 40 m |
| `watchtower.glb` **(REVISED 2026-09-10 — rebuild)** | `sheets/s6_watchtower_ortho.png` + `heroes/03_watchtower_point_day.png` | **30 m tall; 28 m across at the base tapering to 20 m at the crown; ARCHED bore 14 m wide × 8 m high to the springing line, 10 m to the crown of the arch, through the full depth.** The first build (24 m / 16 m) left 1 m walls and read as a slab on two legs. The bore may take no more than half the footprint width: ≥ 7 m solid drum on each flank, ≥ 6 m of drum above the arch crown. Ivy is a vertex-tinted **band** on the drum, not separate flat slabs. | ≤ 10,000 | tapered drum with block courses; crenellations with exactly three missing merlons; two arched windows; the through-tunnel as a real arch with voussoirs and a keystone at both mouths, drum wall continuous around it; ivy/moss lower third via vertex tint on the `jungle` moss rect |
| `waterfall-cliff.glb` | `heroes/04_basin_causeway_night.png`, `05d_clock_court_day.png` | 16 m drop, 22 m wide cliff | ≤ 5,000 (cards excluded) | stacked mossy block cliff with ledges; a plunge-pool foam ring mesh; two blossom clumps (jungle-card); block ledges that cast readable shadows; a lip at the top the water sheet hangs from. The animated water sheet itself is runtime cards — leave a named empty `waterfall_sheet_anchor` at the lip |
| `sea-stack-set.glb` | `heroes/06_reef_shallows_day.png`, `06n_reef_shallows_night.png` | four stacks 18 / 26 / 32 / 40 m | ≤ 1,500 each | tapered block silhouette; moss cap; one with a natural arch; varied lean; all four read as distinct silhouettes against the sky at 300 m |

Model from the orthographic sheets, but **name the metres first** — generated sheets drift in scale and depth (Tideline's gantry had to be re-calibrated to explicit metres after the fact). Put the calibration you used in `heroes.json`.

## Output contract

`public/assets/dreamisland/heroes/heroes.json`:
```json
{ "script": "art/blender/build_dreamisland_heroes.py", "roles": ["concrete","metal","jungle","water","signage","emissive"],
  "assets": { "clock-tower": { "file": "clock-tower.glb", "triangles": 0, "bounds": {}, "targetMetres": {}, "calibration": "...",
              "features": ["...five..."], "anchors": ["..."] } } }
```
Every triangle count measured from the exported GLB (parse it; do not copy the Blender stat). Evidence in `art/evidence/dreamisland-v1/heroes/`: for each asset a turntable of 4 renders (front/side/back/three-quarter) at the target metres with a 2 m scale bar, and a `README.md` with the exact Blender command.

## Verification you must run before reporting

- Each GLB loads in three r184 with `GLTFLoader` from a 20-line node script (write it under `scripts/visual/dreamisland-heroes/` — your namespace) and reports mesh count, triangle count, material names (must be `DI_MAT_*` only) and bounds within 2% of the target metres.
- The watchtower bore clearance: a 14 × 8 m box centred on the tunnel axis intersects zero triangles (raycast or bounds check in the same script).
- No texture is embedded — GLBs reference the shared atlases by material name only (the painted-world loader binds them). File sizes should be well under 1 MB each as a consequence.

## Rules

"Never generate images" means **never use an AI image/texture generator** (Higgsfield, GPT Image, Flux, Tripo, any diffusion or text-to-3D tool). It does NOT cover rendering: Blender turntables, three.js frame captures, screenshots and atlas-cell proofs are **required evidence** and you must produce them — they are renders of geometry you built, not generated art. Never edit Phase B's files. Tag every claim VERIFIED (command/artifact) or UNVERIFIED. Use `grep`, not `rg`. Do not commit. Report: files, per-asset table (metres achieved, triangles measured, bounds, the five features and which turntable frame shows each), the loader-script output, bore clearance result, what's left.
