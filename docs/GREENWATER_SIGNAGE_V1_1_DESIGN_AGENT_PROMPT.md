# Greenwater Signage v1.1 — Design Agent Prompt

> Historical decision record. The returned atlas packages did not remove the
> visible bare digit because it was positively identified as `lap_board`, not a
> distance-board slot. The game now performs the accepted correction at runtime:
> the repeated distance faces are cleared and the lap-board numeral is removed
> while its industrial plate remains. Do not send this prompt as the next phase.

Send the text below with the accepted `GREENWATER_ENVIRONMENT_v1.0.zip`.
This is a narrow atlas pass, not another map-production phase.

---

Neek, prepare a tightly scoped Greenwater Strip v1.1 signage-atlas patch from
the attached accepted `GREENWATER_ENVIRONMENT_v1.0.zip`.

The current Three.js build is accepted and performant. Do not redesign the
route, alter the centreline, move props, change geometry, touch UVs, re-export
either GLB, edit culling distances, or modify TOTEM, gameplay, physics, fog,
music, HUD, gates, hazards, recovery, or any non-signage atlas.

## Why this patch exists

The accepted signage sheet uses bare `3`, `2`, and `1` braking-board graphics.
In the chase camera, especially near Fuel Row and the harder turn approaches,
the repeated isolated digits can be mistaken for checkpoint numbers or an
unclear route instruction. The game now owns navigation explicitly:

- procedural boards read `200M`, `150M`, `100M`, and `50M`;
- amber inset turn-vector lights trace the inside edge of hard corners;
- the HUD provides direction, sequence, urgency, and distance;
- gameplay chevrons, gates, collision, and recovery remain procedural.

The art sheet must support that language instead of competing with it.

## Required atlas change

Return one replacement `greenwater_signage_1024.png` using the existing frozen
`GW_ATLAS_LAYOUT.json` exactly. Preserve its 1024 × 1024 dimensions, 4 × 4
slot grid, 1.5 px UV inset, colour-space assumptions, alpha/cutout behaviour,
slot boundaries, and every UV-facing orientation.

Change only these three slots:

- `board03` → an unmistakable `150M` board;
- `board02` → an unmistakable `100M` board;
- `board01` → an unmistakable `50M` board.

The `M` unit must read at actual chase-camera scale. Use a condensed,
machine-stencilled early-2000s motorsport face with deliberately low-resolution
edges, two-value contrast, sparse grime, and Greenwater's existing warm amber.
It should feel like humid, repaired industrial aerospace on PS2 hardware—not a
modern vector UI pasted into the world.

Preserve the remaining thirteen slots unless a purely corrective pixel-edge or
alpha cleanup is necessary. Do not introduce new standalone numbers elsewhere.
Keep the red false-route X unmistakable and keep chevrons directional rather
than decorative.

## Art direction guardrails

- Keep the accepted near-black, oxidized metal, damp concrete, amber and acid
  palette relationship.
- Prefer chunky pixels, limited values, restrained staining, stencil wear, and
  imperfect registration.
- Avoid generic neon cyberpunk, vaporwave gradients, holographic UI, luxury
  dashboard styling, photoreal materials, heavy bloom, and tiny illegible copy.
- Do not imitate Wipeout branding or reuse another game's marks.
- Route comprehension wins over surface detail at speed.

## Proof and delivery

Provide:

1. `greenwater_signage_1024.png` as the external replacement sheet;
2. `SIGNAGE_PATCH_NOTES.md` listing the three changed slots and confirming all
   other slots are pixel-identical, or naming every additional changed pixel
   region and why;
3. `MANIFEST.json` with exact byte size and SHA-256 for the returned files;
4. six 1600 × 900 chase-camera comparison frames—Start, Water Table, Hangar
   entry, Greenwater Sweep, Canopy Passage, and T10 return—plus close approaches
   to T1, T4, T8 and T10 where the unit suffix can be judged;
5. a small contact sheet showing all sixteen atlas slots at 1× and 4× nearest-
   neighbour scale.

Package those files as `GREENWATER_SIGNAGE_v1.1.zip`. Do not include or re-export
the accepted GLBs. We will bind the external PNG over the embedded signage map
in Three.js, preserving the locked v1.0 runtime geometry bytes.

Acceptance requires that a first-time viewer can identify every braking distance
without mistaking it for a checkpoint, that no sign fills the central chase
camera corridor, and that the correct opening remains legible at least 1.5
seconds ahead. If the existing placement makes those requirements impossible
with an atlas-only change, stop and report the exact placement IDs and camera
frames; do not silently move or rebuild them.
