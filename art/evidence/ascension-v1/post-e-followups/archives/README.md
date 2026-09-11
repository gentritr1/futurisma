# Greenwater archive recovery

## Executed and observed

Located original ZIP downloads, validated each candidate with `scripts/validate-greenwater-package.mjs`, then restored the passing files unchanged into this checkout's `artifacts/`. `recovery.json` records source names, byte sizes, SHA-256 hashes, exit codes and validation output, including the rejected candidates.

| Required archive | Selected download |
| --- | --- |
| GREENWATER_ENVIRONMENT_STAGE1.zip | GREENWATER_ENVIRONMENT_STAGE1.zip |
| GREENWATER_ENVIRONMENT_STAGE2.zip | GREENWATER_ENVIRONMENT_STAGE2 (1).zip |
| GREENWATER_ENVIRONMENT_v1.0.zip | GREENWATER_ENVIRONMENT_v1.0 (1).zip |

The unsuffixed Stage 2 download fails on a placement containing null coordinates. The unsuffixed v1.0 download fails the deck-winding correction assertion. Neither was installed. No validator was weakened and no archive was regenerated.

`python3 scripts/restore-greenwater-archives.py` was executed successfully. It checks all source hashes and refuses to overwrite different destination bytes before copying, then verifies each copy. Three expected archives, three restored, residual zero. Archive payloads remain ignored local provenance files under the repository's existing policy; Git contains the recovery record and script, not these ZIPs. Another checkout can run the script with the directory containing these original downloads as its argument.

`npm run test:archives` was rerun; see `entry-point.txt`. Both environment checks now execute and PASS, rather than skip. Stage 2 preserves 12 immutable files and 895 geometry buffers; v1.0 preserves 14 immutable files and 1186 unchanged accessor payloads, with exactly 12 corrected deck meshes. These are structural counts from `validate-greenwater-package.mjs`, not sampled time series.

## Inference and remaining limits

Passing the existing structural and byte-preservation checks supports choosing the suffixed downloads. It does not manufacture any historical human approval beyond what those contracts already encode.

Gap 9 is resolved for the three requested environment archives, but the full archive entry point still reports one skip: `validate:assets` requires seven additional provenance inputs not found in Downloads, the two project trees (including ignored files), Documents or the local Codex tree:

- GREENWATER_VISUAL_IDENTITY_v1.2.zip
- GREENWATER_LIVING_WORLD_v1.3.zip
- GREENWATER_SURFACE_CHARACTER_v1.4_REVIEW.zip
- GREENWATER_SURFACE_CHARACTER_v1.4.zip
- GREENWATER_FACILITY_STORY_v1.5_PROVENANCE_GAP.json
- quarantine/GREENWATER_FACILITY_STORY_v1.5_REVIEW_REJECTED_4c1f3da4.zip
- GREENWATER_FACILITY_STORY_v1.5.zip

The similarly named VISUAL_IDENTITY_LOCK downloads are not substituted for a different pinned package. Reconstructing an accepted or rejected historical package from current runtime files would not restore its provenance. These seven inputs remain an explicit gap.
