# FUTURISMA — TOTEM Rival Livery v1.5 Review Prompt

Neek, prepare a tightly scoped production review package for one missing TOTEM
rival livery: **NEEDLE 16**.

This is a vehicle-atlas pass, not a new map phase and not a redesign of TOTEM.
Do not start Map 02.

## Accepted source state

The game already runs a deterministic four-ship, five-lap Greenwater race:

- player: TOTEM / WORKS 07
- rival: PRIVATEER 13
- rival: NIGHTFORM 24
- temporary rival: BASELINE 07

Works 07, Privateer 13, Nightform 24 and the base atlas are accepted Phase 1
vehicle assets. The runtime loads TOTEM once, reuses one merged geometry set,
and gives each rival body role its own decal atlas. Privateer and Nightform are
already active. BASELINE 07 is only a temporary third-rival identity because it
duplicates the player's race number.

Greenwater Visual Identity v1.2, Living World v1.3, Surface Character v1.4 and
Facility Story v1.5 are accepted and byte-locked. The accepted Facility Story
v1.5 final archive SHA-256 is:

`118bc6f00f4db5d5ec18ec805d0738aa672765a849b2f2169ccb1a47ad8ca2a9`

Do not modify or re-baseline any accepted Greenwater archive, runtime GLB,
texture, placement, lighting, fog, collision, checkpoint, hazard, recovery,
handling, music mapping or signage asset.

The current rival runtime also includes visual-only banking and restrained
per-rival exhaust tones in one shared glow batch. Preserve that code-side
presentation and its existing zero-geometry / zero-draw-call delta.

## Required production asset

Create exactly one new atlas:

`textures/totem_decals_1024_needle.png`

Requirements:

- exactly 1024 × 1024 RGBA PNG
- same UV layout, slot boundaries, orientation, alpha behaviour and
  nearest-filter character as `totem_decals_1024_base.png`
- no TOTEM geometry, material-role, node, anchor or UV changes
- race number **16** must be unmistakable at chase-camera distance
- ship name **NEEDLE** may appear only where the existing livery grammar allows
  team/technical text
- retain the remembered-PS2 low-resolution edge character; do not add modern
  micro-detail, photoreal grime, bloom-dependent marks or smooth vector polish

## Visual identity

NEEDLE 16 should occupy the missing field role:

- dark wet gunmetal and restrained oxide/bone panels
- one small cool service accent, subordinate to Greenwater's amber/acid route
  language
- thin, sharp technical divisions that support the name without creating a
  busy barcode surface
- humid aerospace salvage, not generic neon cyberpunk
- visibly distinct from the player's pale/acid Works 07, Privateer 13's orange
  warning grammar and Nightform 24's dark cyan identity

The livery must remain readable through fog and motion primarily through value
blocking and the number panel, not through emissive brightness. Do not change
the shared `totem_emissive_512.png`.

## Required review views

Supply native 1600 × 900 frames with HUD hidden only for the dedicated livery
turntable; race views must use the normal gameplay HUD and chase lens.

1. Atlas contact sheet at 1× and 4× nearest-neighbour scale with every used
   slot labelled.
2. Neutral three-quarter front and rear views of NEEDLE 16 on the loaded TOTEM
   runtime geometry.
3. Four-ship start grid: Works 07, Privateer 13, Nightform 24 and Needle 16.
4. A chase-camera overtake view with Needle 16 between 12 m and 28 m ahead.
5. V4 Hangar view near station 782 m with the route opening and crane still
   readable around the rival.
6. Fuel Row view proving the livery and rival silhouette do not make the route
   appear blocked.
7. The 300 m Cradle finish approach with all route-critical finish language
   still dominant.
8. Fog comparison against Works 07, Privateer 13 and Nightform 24 at the same
   camera, distance, lighting and exposure.

No view may use zoom, bloom, hidden fog, a non-gameplay lens or exposure changes
to make the livery pass.

## Hard gates

- The new atlas is the only production asset delta.
- Existing Works, Privateer, Nightform, base and emissive atlases remain
  byte-identical.
- TOTEM runtime and master GLBs remain byte-identical.
- The race still uses one vehicle GLB request.
- Rival geometry remains 18,342 visible triangles across three ships.
- Replacing BASELINE 07 with NEEDLE 16 adds zero draw calls, geometries or
  textures relative to the current four-ship runtime.
- Number 16 is readable at the approved chase distances and is not confused
  with 07, 13 or 24.
- The rival cannot be mistaken for a gate, hazard, route edge, finish beacon or
  open route.
- No accepted Greenwater or gameplay bytes change.

## Review package

Return one deterministic ZIP named:

`TOTEM_RIVAL_LIVERY_v1.5_REVIEW.zip`

It must contain:

- the new atlas
- `MANIFEST.json` with every file's relative path, byte size and SHA-256
- `reports/atlas_slot_report.json` with exact pixel bounds and use for every
  painted slot
- `reports/unchanged_source_hashes.json` proving the source TOTEM GLBs and all
  existing atlases are unchanged
- `reports/runtime_budget.json` confirming the zero-delta replacement budget
- all required native review frames
- a concise visual review explaining how Needle remains distinct at race speed
- deterministic canonicalisation instructions and a reproducibility check

The review package must say:

`final_v15_freeze: false`

Do not produce a final freeze yet. Codex will independently verify archive
structure, hashes, pixel dimensions, slot use, unchanged-source bytes, runtime
replacement, native views and full-race performance before authorising the
final v1.5 freeze.
