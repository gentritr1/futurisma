# GREENWATER RACE PRESENCE v1.6 — Codex Integration Audit

`integration_status: PASS`

`final_v16_freeze: true`

`final_freeze_accepted: true`

Recorded: 2026-08-28

## Accepted review input

- Archive: `GREENWATER_RACE_PRESENCE_v1.6_REVIEW.zip`
- Bytes: `12,023,478`
- SHA-256: `94c0b7d58dbb5f4e8cb549259ceabcbacee84cbadcc3393a93ebe4530cd395b9`
- ZIP entries: `62`
- Manifest records: `61` (the manifest correctly excludes itself)
- CRC: PASS
- Clean-room rebuild: byte-identical

The accepted Greenwater v1.2–v1.5 freezes were not re-baselined or modified.
The accepted Facility Story v1.5 archive remains
`118bc6f00f4db5d5ec18ec805d0738aa672765a849b2f2169ccb1a47ad8ca2a9`,
and its runtime environment GLB remains
`5b711fb7bc46533fa6eb6a4ce9b455efe7866061e4f6ea10f82eb0996da20177`.

## Accepted final freeze

- Archive: `artifacts/GREENWATER_RACE_PRESENCE_v1.6.zip`
- Bytes: `14,380,913`
- SHA-256: `2bd5adfd1350b2fd2a9302a8f4139918d1e1d0fe3a1b88b4b80f4cffeb4a6b8a`
- ZIP entries: `65`
- Manifest records: `64` (the manifest correctly excludes itself)
- CRC: PASS — all 65 entries re-parsed and recomputed
- Clean-room rebuild: byte-identical
- Production assets identical to the accepted review: PASS

The included final-freeze builder was executed unchanged from a freshly
extracted archive. Its rebuilt ZIP matched the accepted final archive byte for
byte, including the archive SHA-256 above.

## Integrated production bytes

| Runtime target | SHA-256 | Result |
| --- | --- | --- |
| `public/assets/totem/models/totem_runtime.glb` | `4bec092f1c85c78b00a4974532b0dda5f1f89f756d9741535820368e3cfd35ec` | Byte-identical to accepted review |
| `public/assets/totem/textures/totem_race_presence_fx_256.png` | `d5562ae064c9532fd447c89ae013642dc03f72f7354293caa952972ad5af8aa3` | Byte-identical to accepted review |
| `public/assets/totem/textures/totem_decals_1024_needle.png` | `2f8b3528845eaa7167062e93ae43fedf74e0d6c2ddc14cea14d565e8ec95dc1c` | Byte-identical to accepted review |

The runtime GLB retains 53 nodes, 18 meshes/primitives, four materials, two
embedded textures, 6,114 visible triangles and 108 collision line segments.
Both steering-fin pivots are baked at local Y `0.02 m`. The temporary
`STEERING_FIN_VERTICAL_CORRECTION_METERS` and `seatSteeringFinsOnBooms`
runtime path has been removed.

## Runtime implementation

- One shared 256×256 atlas drives eight effect slots.
- Player effects use one indexed quad geometry and three instanced blend
  families: additive, alpha and masked alpha.
- The effect layer is capped at three draw calls, 11 active instances and 22
  submitted triangles when every family is active.
- Every family keeps depth testing on and depth writing off. Per-slot opacity
  is clamped to the accepted contract.
- Hover, acceleration, boost, braking, wet spray, shallow mist, impact and ion
  mask timing are connected to existing visual state only. Physics is unchanged.
- Rivals retain shared TOTEM geometry. NEEDLE 16 replaces the temporary
  BASELINE 07 texture load, and the three rivals share one atlas-backed exhaust
  draw.

## Native browser evidence

Browser: Codex in-app Chromium browser. Viewport: native 1600×900. Quality:
high. The comparison used the same repository state and browser settings before
and after v1.6 integration.

### One-lap comparison

| Measurement | Pre-v1.6 runtime | v1.6 integration | Delta |
| --- | ---: | ---: | ---: |
| Lap time | 34.483 s | 34.483 s | 0.000 s |
| p95 frame time | 10.0 ms | 9.8 ms | -0.2 ms |
| Maximum frame time | 10.4 ms | 10.4 ms | 0.0 ms |
| Peak draw calls | 89 | 85 | -4 |
| Peak visible triangles | 63,798 | 63,746 | -52 |
| Geometry resources at finish | 129 | 127 | -2 |
| Texture resources at finish | 27 | 28 | +1 approved atlas |
| Rival draw calls | 6 | 6 | 0 |
| Rival triangles | 18,351 | 18,348 | -3 |

Both runs completed with zero impacts, missed gates, recoveries, wrong-way
events, WebGL losses or console errors. Live chase inspection at Runway 09,
Hangar Six and Fuel Row confirmed that the baked fins remain connected and the
new exhaust and braking cards stay below the projected route and corner
openings. The same run crossed Water Table at the expected `0.801` grip floor
without an impact or route-visibility fault.

### Five-lap v1.6 soak

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

The unattended soak intentionally ran with the browser audio context suspended;
audio behavior was not re-baselined by this visual integration pass. The
existing deterministic audio, physics, camera, race, rival, rendering and
security validators all passed in the live repository.

## Gate decision

| Deferred review gate | Result |
| --- | --- |
| Real game load and runtime correction removal | PASS |
| Native effect timing and three-family batching | PASS |
| Native five-lap performance soak | PASS |
| Collision, camera and handling regression | PASS |
| Final freeze authorization | PASS |

The live repository's complete `npm test` chain passes after integration,
including asset hashes, package boundaries, physics, race rules, rivals,
camera, graphics resources, frame scheduling, render quality, security,
TypeScript, production build and build budgets.

## Freeze boundary

The deterministic v1.6 final freeze is accepted and preserved under
`artifacts/GREENWATER_RACE_PRESENCE_v1.6.zip`. It changes freeze bookkeeping
only: the three production assets and 56 preserved review payloads remain
byte-identical to the accepted review. Map 02 was not started, and all accepted
Greenwater v1.2–v1.5 production bytes remain untouched.
