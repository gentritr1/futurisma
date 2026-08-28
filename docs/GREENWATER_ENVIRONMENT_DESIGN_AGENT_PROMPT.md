# Greenwater Environment — Completed Stage 3 Design Agent Prompt

> Status: completed and accepted on 2026-08-24. Do not resend this prompt. The
> returned `GREENWATER_ENVIRONMENT_v1.0.zip` includes all 18 acceptance renders,
> the relocatable source snapshot, and the Stage 4 deck-winding correction. A
> later route-readability pass is now scoped separately in
> `GREENWATER_SIGNAGE_V1_1_DESIGN_AGENT_PROMPT.md`; keep this completed prompt
> only as the production decision record.

Neek, complete Stage 3 for FUTURISMA Map 01, Greenwater Strip, using the
attached accepted `GREENWATER_ENVIRONMENT_STAGE2.zip` as the production source.

Stage 2 is accepted and already integrated in the Three.js game. This is a
presentation, acceptance-render and final-package pass. Do not redesign the map,
rebuild the kit, change placements, or silently re-export accepted geometry.

## Accepted bytes and measured contract

- Stage 2 ZIP SHA-256:
  `4eae06930b7e7f5ea487f0cdd6a9ade627aa3e155733c121f5d5459241ee9be0`
- Runtime GLB SHA-256:
  `4a92340a35f95ec0cad5f0e5640d3722f9e816d74413c2033613c3c81cf84841`
- Runtime: 2,267 placements, 63 sector/material meshes, 55,488 triangles,
  six materials, six embedded textures.
- Art kit: 44 roots, 179 named meshes, 2,296 triangles.
- Atlas contract: five 1024² sheets plus one 512² emissive sheet, 71 painted
  slots and 25 reserved slots.
- Authored-environment authoring measurement: 19 worst-case visible draw calls
  and 23,772 worst-case visible triangles, within the 24 / 175,000 limits.

Independent validation also proved that the accepted Stage 1 geometry contract
is preserved: 12 immutable files are byte-identical, the art-kit hierarchy and
materials are semantically identical, and all 895 geometry buffers are
byte-identical. The differing art-kit GLB hash comes only from reordered copies
of the same six embedded PNG byte ranges.

## In-engine findings to work from

The accepted runtime loads and renders correctly in the actual game. A
high-quality deterministic five-lap run completed in 02:52.800 with a 00:34.433
best lap, zero impacts, missed gates, recoveries, wrong-way events or WebGL
failures. The complete scene peaked at 67 draw calls and 39,332 visible
triangles. The authored deck, rails, navigation boards, jungle silhouettes and
landmarks coexist with the retained gameplay gates and turn calls without
obscuring the clean line.

Do not alter the runtime to chase those numbers. Stage 3 must preserve or improve
them through presentation only.

## Stage 3 deliverables

Build the final `GREENWATER_ENVIRONMENT_v1.0.zip` from the same validated
in-memory source state. It must contain every accepted Stage 2 deliverable plus:

1. Six real 1600 × 1000 in-scene chase-camera PNG renders at the locked framing
   stations in the art brief. They must be rendered from the actual runtime
   geometry and textures, not painted concept art or framing diagrams.
2. A flat-black silhouette view and an unlit material-ID view for each of the
   six stations, either as additional PNGs or as clearly selectable render modes
   whose exact outputs are included in the package.
3. Updated `HANDOFF.md`, `MANIFEST.json` and `VALIDATION.json` generated from the
   final bytes, plus the complete relocatable `source/` snapshot.
4. A Stage 3 acceptance report naming the next opening, orientation landmark,
   fog depth and any deliberate occluder at each station.

The six standard views must use the approved chase-camera lens range and fog
grammar. In every view:

- the correct next opening is the clearest value gap;
- at least one unique landmark gives orientation;
- fog and foliage preserve at least the next 1.5 seconds of racing line;
- no visual suggests a false exit or a route beyond the track boundary;
- gates, chevrons and distance boards remain readable at gameplay scale;
- no art intersects the track envelope, hazard footprint or clean line.

## Freeze rules

- Treat the accepted Stage 2 GLBs, placement JSON, atlas layout and map JSON as
  locked. Do not change them for screenshot composition.
- Keep the current deterministic code-painted atlases in v1.0. Hand-painted
  replacement sheets are a later optional art pass and must use the frozen slot
  layout without a geometry or UV re-export.
- Generate all renders, byte counts, hashes, validation and ZIP entries from the
  same source state.
- The freeze button must require art-kit, runtime, placement, budget and render
  validation to pass before packaging.
- After assembling the ZIP, parse it back, verify the central directory, every
  local header and CRC-32, then compare all bytes and SHA-256 values with the
  generated manifest. Refuse the download on any mismatch.
- Keep every source path relocatable. Do not return a project card that omits
  generated GLBs, PNGs, validation or source.
- Do not modify TOTEM, gameplay, physics, fog logic, music, HUD, gates, hazards,
  recovery anchors or the accepted 2,515.982 m route.

When finished, return the direct `GREENWATER_ENVIRONMENT_v1.0.zip` download,
the exact archive SHA-256, complete counts and budgets, a concise PASS/FAIL table,
and any remaining visual limitation by sector. If any accepted byte must change,
stop and identify the exact file and reason before exporting.
