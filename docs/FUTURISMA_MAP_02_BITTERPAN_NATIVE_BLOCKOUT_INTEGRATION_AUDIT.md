# MAP 02 · BITTERPAN WORKS — Native Blockout Integration Audit

Status: implemented integration candidate  
Selection: `?map=bitterpan`  
Default without `map`: Greenwater Strip / Map 01  
`final_map02_native_blockout_freeze: false`

## Accepted provenance

The implementation uses the reviewed v0.2a.1 route package and v0.2b.2 massing
package as immutable production candidates. No accepted source payload was
re-solved, resampled, reshaped, re-exported, or merged.

- v0.2a.1 review archive SHA-256:
  `53f8e5f909a25185014f71310be04be11c8f25822777ba7354f963aa7ace95ce`
- v0.2b.2 review archive SHA-256:
  `3f53c7578963105b6cdea34ea7756aace30d7c24eb1efd6147d1c961cd282f44`
- Track GLB:
  `56bb30f1aa3446366c80cb5661ae616a07bc30bb026c5e6266435de3fa1f92f9`
- Massing GLB:
  `601287e2acd0dff1bdf7a76726e2a8949d9a17488fde488cb0f28e942c926778`
- Centreline:
  `031ecef06520c8895b4aaa10507243df02c6f7e702636d9a0f2687e82663e4bf`
- Checkpoints:
  `3af5895e69910e77412178570009362572c96f5190a5e498888549b6366ea979`
- Grid and recovery:
  `5c537f42a0d306ce6c668544001677fc5170a91456d7d027d6878158e8446748`
- Sectors and sequences:
  `a27f7b5ff22880188b62dfe2eb440896c643e50fcb78116d5e026c8f7aab3711`

`scripts/validate-map02.mjs` hashes the repository copies at full 64-character
equality before recomputing the route and GLB invariants.

## Runtime integration

- Map selection is explicit. Greenwater remains the fallback for an absent or
  unknown `map` query value; only `map=bitterpan` selects Map 02.
- Course modules are lazy-loaded. Greenwater players do not download the Map 02
  station table, and Map 02 players do not download the Greenwater course data.
- Track and massing GLBs load together through one environment operation.
- The hidden `GW2_COLLISION_PROXY` remains hidden. Runtime course containment is
  driven by the accepted station widths and the accepted +6 m recovery boundary.
- Massing remains visual-only. No massing collision was invented.
- The accepted course data drives 3,050 m lap length, 610 stations, variable
  22–30 m width, banking, 11 sector gates plus CP00, three sectors, authored
  sequence labels, turn cues, four grid slots, and 610 recovery stations.
- WORKS 07, PRIVATEER 13, NIGHTFORM 24, and NEEDLE 16 start from the accepted
  Map 02 grid stations and lateral offsets.
- The accepted recovery contract maps to a 1.2 s detection window plus a 1.6 s
  rejoin delay, with rejoin speed at 35% of the unchanged 86 m/s cruise basis.
- Twenty accepted environment primitives remain unbatched: 6,100 track
  triangles plus 5,168 massing triangles = 11,268 visible triangles.
- The pale review palette proved unreadable in the native fog treatment. The
  accepted GLBs remain byte-identical; runtime material overrides and a
  course-derived route-read layer provide a dark deck, cyan/orange edge bands,
  centre dashes, and complete checkpoint frames.
- The route-read layer uses the four integration calls held in reserve: one
  deck surface, one combined edge-band mesh, one instanced dash draw, and one
  instanced checkpoint-frame draw. The accepted 20-call environment therefore
  remains within the 24-call combined ceiling without batching or changing its
  geometry.
- The chase camera is biased toward the accepted centreline ahead on Map 02 and
  is kept at least 2.1 m above the projected course surface. This prevents the
  road from leaving the frame and prevents camera/road intersections at crests.
- Map 02 has no authored world-space lap board in this phase; the HUD remains
  authoritative until the art phase supplies a board surface.

## Native browser evidence

Five-lap autopilot soak, Chromium/WebGL, 960×540 internal render size:

- Finish: P1 / 4 in `03:21.066`
- Lap times: `38.775`, `40.533`, `40.583`, `40.592`, `40.583` seconds
- Best lap: `38.775` seconds
- Missed gates: 0
- Recoveries: 0
- Impacts: 0
- Wrong-way entries: 0
- Context losses: 0
- Console warnings/errors: 0
- Environment ready: true; load error: null
- Environment: 20 visible meshes, 11,268 visible triangles, 9 visible
  materials, 0 textures
- Peak whole-frame draw calls: 50, including TOTEM, three rivals, HUD-support
  world effects, checkpoint pylons, and the 20-call environment
- P95 frame time: 10.1 ms
- Maximum frame time: 10.5 ms
- Final measured heap growth: 0.8 MB

The automated soak had a suspended audio context, so it is not audio evidence.
A separate user-gesture recovery probe ran the audio context at its 30 Hz target
with no skipped one-shots.

Post-readability-repair one-lap drive, Chromium/WebGL, high quality:

- Finish: P1 / 4 in `00:38.775`
- Missed gates: 0
- Recoveries: 0
- Impacts: 0
- Wrong-way entries: 0
- Console warnings/errors: 0
- Peak whole-frame draw calls: 51
- P95 frame time: 8.4 ms
- Maximum frame time: 9.4 ms
- The dark route surface, both edge bands, centre dashes, checkpoint frames,
  final bend, and underpass approach remained visible in the native chase view.

Focused recovery probe:

- Probe exit station: 900 m
- Off-course time before recovery: 2.81 s
- Recoveries: 1
- Recovery source recorded as `BASIN ONE ENTRY@900m`
- Rejoin speed started at 35% cruise; the diagnostic sample was taken after the
  craft had already coasted forward from the rejoin station.

Greenwater regression smoke:

- No `map` query selects Greenwater Strip / Map 01.
- Original title, header, intro wording, eight-gate HUD, start label, and footer
  are preserved.
- Greenwater and Bitterpan both reach `TOTEM READY` after lazy course loading,
  with no console warnings or errors.

## Validation

Passing in this checkout:

- `validate:race-presence`
- `validate:map`
- `validate:map02`
- `validate:package-boundary`
- `validate:physics`
- `validate:race`
- `validate:rivals`
- `validate:control`
- `validate:audio`
- `validate:camera`
- `validate:presentation`
- `validate:graphics`
- `validate:frames`
- `validate:render`
- `validate:security`
- TypeScript and Vite production build
- `validate:build`: 739.3 KiB raw / 191.1 KiB gzip initial JavaScript;
  197.4 KiB gzip shell
- `git diff --check`

The umbrella `npm test` cannot complete in this checkout because the existing
`validate:assets` step requires preserved Greenwater archives under `artifacts/`,
starting with `GREENWATER_ENVIRONMENT_v1.0.zip`, and the entire `artifacts/`
directory is absent. No substitute archive was created and no accepted hash was
re-baselined. All validators that do not require those missing archives pass.

## Phase boundary

This is a playable native blockout integration, not a Map 02 freeze and not
final art. The route-read layer is functional blockout presentation; it is not
the final Bitterpan material or signage pass.
The next production phase may replace massing with authored art while preserving
the accepted route, widths, banking, checkpoints, grid, recovery, sequence
boundaries, and the Greenwater/TOTEM freezes.
