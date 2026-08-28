Neek — continue FUTURISMA with the deterministic final freeze for:

# GREENWATER RACE PRESENCE v1.6 — FINAL FREEZE

FUTURISMA is a Three.js anti-gravity racing game with remembered PlayStation 2
graphics, early-2000s/Y2K design, low-poly silhouettes and low-resolution
texture character.

This is a packaging and provenance task. The v1.6 design review has passed
independent Codex integration. Do not redesign, retouch or regenerate any
approved production asset.

## Working relationship

The design agent produces the deterministic final archive. Do not modify the
game repository directly. Codex has already integrated and audited the accepted
review bytes in the real game.

Do not start Map 02. Do not request another Greenwater identity lock, Facility
Story refreeze or Race Presence design pass.

## Frozen accepted history

Greenwater v1.2–v1.5 remain accepted deterministic final freezes. Preserve
their production bytes and do not re-baseline them.

Accepted Facility Story v1.5:

- Archive SHA-256: `118bc6f00f4db5d5ec18ec805d0738aa672765a849b2f2169ccb1a47ad8ca2a9`
- Runtime environment GLB SHA-256: `5b711fb7bc46533fa6eb6a4ce9b455efe7866061e4f6ea10f82eb0996da20177`
- Archive entries: `185`
- Environment meshes: `60`
- Authored environment triangles: `61,798`
- Gates: `94/94 PASS`

## Accepted v1.6 review

- Review archive: `GREENWATER_RACE_PRESENCE_v1.6_REVIEW.zip`
- Review bytes: `12,023,478`
- Review SHA-256: `94c0b7d58dbb5f4e8cb549259ceabcbacee84cbadcc3393a93ebe4530cd395b9`
- ZIP entries: `62`
- Manifest records: `61`
- CRC: PASS
- Clean-room rebuild: byte-identical
- Review flag: `final_v16_freeze: false`

The following production assets are accepted and must be copied byte-for-byte:

| Package path | SHA-256 | Bytes |
| --- | --- | ---: |
| `models/totem_runtime.glb` | `4bec092f1c85c78b00a4974532b0dda5f1f89f756d9741535820368e3cfd35ec` | 950,428 |
| `textures/totem_race_presence_fx_256.png` | `d5562ae064c9532fd447c89ae013642dc03f72f7354293caa952972ad5af8aa3` | 3,474 |
| `textures/totem_decals_1024_needle.png` | `2f8b3528845eaa7167062e93ae43fedf74e0d6c2ddc14cea14d565e8ec95dc1c` | 47,202 |

No production GLB, PNG, geometry payload, material value, node transform,
contract or evidence image may change during the freeze.

## Codex integration acceptance

Record the following measurements verbatim as integration evidence. Do not
present them as design-agent measurements.

Test surface:

- Real Three.js game
- Codex in-app Chromium browser
- Native 1600×900 viewport
- High quality mode
- One-lap before/after comparison plus five-lap v1.6 soak

One-lap comparison:

| Measurement | Pre-v1.6 runtime | v1.6 integration |
| --- | ---: | ---: |
| Lap time | 34.483 s | 34.483 s |
| p95 frame time | 10.0 ms | 9.8 ms |
| Maximum frame time | 10.4 ms | 10.4 ms |
| Peak draw calls | 89 | 85 |
| Peak visible triangles | 63,798 | 63,746 |
| Geometry resources at finish | 129 | 127 |
| Texture resources at finish | 27 | 28 |
| Rival draw calls | 6 | 6 |
| Rival triangles | 18,351 | 18,348 |

Five-lap v1.6 soak:

- Total: `02:52.800`
- Laps: `34.483`, `34.433`, `34.517`, `34.683`, `34.683` seconds
- Best lap: `34.433 s`
- p95 frame time: `9.8 ms`
- Maximum sampled frame time: `10.9 ms`
- Peak draw calls: `85`
- Peak visible triangles: `66,308`
- Geometry resources at finish: `127`
- Texture resources at finish: `28`
- Minimum surface grip: `0.801`
- Vehicle GLB requests: `1`
- Impacts, missed gates, recoveries and wrong-way entries: `0`
- WebGL context losses/restores: `0 / 0`
- Browser warnings/errors: `0 / 0`

The unattended soak used a suspended browser audio context. State that clearly;
do not convert it into an audio acceptance claim. Codex's existing deterministic
audio validator passed, but audio was not re-baselined by this visual phase.

Integration gates:

- Real game load and baked steering-fin correction: PASS
- Runtime correction removal: PASS
- Player and rival merged-geometry path: PASS
- Eight-slot atlas timing and three-family instanced batching: PASS
- Chase-route visibility: PASS
- Five-lap performance soak: PASS
- Collision, camera and handling regression: PASS
- Full repository validation and production build: PASS

## Final archive

Produce exactly:

`GREENWATER_RACE_PRESENCE_v1.6.zip`

The archive must be deterministic and timestamp-independent. Its root folder
must be `GREENWATER_RACE_PRESENCE_v1.6/`.

Set:

`final_v16_freeze: true`

The final manifest must also record:

- the accepted review filename, byte size and SHA-256
- `production_assets_identical: true`
- the exact native integration measurements above
- `integration_measurement.recorded_verbatim: true`
- prior freeze flags v1.2–v1.5 as true
- `re_baselined: false`
- every archive entry's logical path, byte count and SHA-256

The manifest must not hash itself. Every non-manifest entry must be declared
exactly once, and the archive must contain no undeclared file.

Replace the review note with `V16_FREEZE_NOTES.md`. Do not include a file still
named `REVIEW_NOTES.md`. Preserve sufficient source to reproduce the approved
production bytes, and include validation proving the three production assets
are byte-identical to the accepted review.

## Allowed final-freeze changes

Only freeze bookkeeping may change:

- manifest package/version/final flags
- final freeze notes
- validation status that records Codex's accepted measurements
- filenames that explicitly change from review to final-freeze semantics

Do not change:

- the production TOTEM GLB
- the effects atlas
- NEEDLE 16 livery
- any review evidence image
- any accepted contract value
- Greenwater environment, surface, signage or living-world bytes
- track geometry, collision, checkpoints, hazards, recovery, handling, camera,
  HUD, music or race rules
- the locked 200M/150M/100M/50M signage state

## Required validation

The final package must prove:

1. Accepted review archive hash and CRC match.
2. All three production assets match the accepted review byte-for-byte.
3. Runtime GLB remains 53 nodes, 18 meshes/primitives, four materials, two
   embedded textures, 6,114 visible triangles and 108 collision line segments.
4. Both steering-fin pivots remain baked at local Y `0.02 m`.
5. Node names and hierarchy remain unchanged.
6. No animations, skins, morph targets, negative scale or non-uniform runtime
   scale are introduced.
7. Effects atlas remains 256×256 RGBA with eight padded slots and clean
   transparent RGB.
8. NEEDLE 16 remains 1024×1024 RGBA with the accepted hash.
9. Every final manifest record matches the archived bytes.
10. A clean-room rebuild produces a byte-identical final archive.

## Final report

Report:

- archive filename
- archive byte size
- archive SHA-256
- entry count
- CRC result
- manifest record count
- clean-room reproducibility result
- runtime GLB SHA-256
- effects-atlas SHA-256
- NEEDLE 16 livery SHA-256
- triangle, mesh, material, texture and draw-call totals
- every passing and failing gate
- explicit confirmation that the three production assets are byte-identical to
  the accepted review
- explicit confirmation that Map 02 was not started

This task ends with the deterministic v1.6 final archive. Do not propose a new
design phase inside the package.
