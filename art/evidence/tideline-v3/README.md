# Tideline V3 evidence

All game images are literal browser screenshots. Cropping, resizing and side-by-side assembly only; image generation did not alter evidence.

- `tide-phase-pairs.png`: lap one / lap three at the same three route stations, seed 3868938316, 1280 × 720 fixed chase camera; captions are outside the captured frames.
- `after/station-*.png`: five stations × two laps. `blind/` uses anonymous filenames; the key was withheld from the reviewer.
- `gantry-hero-versus-model.png`: captured actual game material loader beside the generated hero. Camera is calibrated because the hero has no camera metadata. The standalone Blender PNG is refreshed in `art/references/tideline-foundry`.
- `lamp-frame-metrics.json` and `lighting-contract.json`: baseline camera, patches, luma ratio, post-baseline target and exact image hashes. Use `python3 scripts/visual/frame-metrics.py art/evidence/tideline-v3/before/lamp.png art/evidence/tideline-v3/after/lamp.png --lamp-patches=art/evidence/tideline-v3/before/lamp.json --json` from the repository root.
- `production-race.json`: actual production build, three laps, seed 3868938316, Works AI, private Rob Playford music through the existing bus. Recorded after the framing/geometry rebuild, before the final minor flooded-road colour adjustment.
- `independent-review.md`: includes remaining uncertainty; classification success is not a claim of perfect visual fidelity.

The public dev-only review page is `tide-review.html?lap=1&station=0` (stations 0–4), with `view=lamp` for the documented overhead measurement. It uses the actual course, world, environment, lights and textures. Its fixed lighting/camera excludes the race HUD and craft, so it is a controlled comparison rather than an exact live-race camera capture.
