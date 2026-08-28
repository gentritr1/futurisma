# Greenwater Visual Identity Lock — Design Agent Prompt

Send the text below with the accepted `GREENWATER_ENVIRONMENT_v1.0.zip` and, if
available, current gameplay captures. This is a direction-lock phase. It must
not export or replace production geometry yet.

---

Neek, prepare the next visual-direction lock for FUTURISMA Map 01, Greenwater
Strip. The current Three.js vertical slice is playable, performant and accepted.
This phase should make the environment unmistakably its own before we authorize
another GLB or atlas production pass.

## The identity to sharpen

Greenwater is a flooded equatorial aerospace proving ground built from heavy
concrete, drainage infrastructure and repaired flight hardware, then partially
reclaimed by wet jungle. It should feel maintained just enough to remain lethal:
service lamps work, route equipment has been repaired many times, water has
stained everything below knee height, and foliage pushes through every seam the
crew stopped sealing.

The target is a beautifully remembered early-2000s PlayStation 2 racer:
low-poly silhouettes, authored vertex colour, baked two- or three-value surface
shading, chunky low-resolution texture edges, deliberate fog planes and sparse
emissive accents. It is not photorealism and not a modern retro filter laid over
generic geometry.

The mood should move with the race and music while remaining one coherent site:

- The Cradle and opening runway — suspended trance, pale wet air, long symmetry,
  acid route lamps and the feeling of a dormant launch facility waking up.
- Water Table — atmospheric jungle, flooded concrete, low weir reflections,
  leaning utilities and a strong horizontal waterline.
- Hangar Six — sharp techstep, a genuinely dark industrial volume, one sodium
  mouth, exposed repair gantries, cable hazards and the crane as the apex read.
- Greenwater Sweep — deep drum and bass, the broadest sense of speed, banked deck,
  hydro infrastructure and a huge drainage rhythm on the outside line.
- Canopy Passage — jungle percussion, close organic walls, broken sightlines,
  antenna glimpses and wet leaves catching only a few service lights.
- The Elbow, Fuel Row and Totem Turn — deep DnB becoming techstep: stepped tanks,
  pipe bridges, oxide-orange maintenance light and a hard silhouette behind the
  final apex.
- Home straight — trance returns, the fog opens, The Cradle becomes the unmistakable
  finish target and the course visually resolves rather than simply stopping.

## Locked gameplay language

Do not redesign the centreline, widths, banks, collision, gates, hazards,
recovery, checkpoint order, camera, handling or music map.

Navigation already belongs to the game:

- explicit `200M`, `150M`, `100M`, and `50M` braking boards;
- amber turn vectors and chevrons;
- acid course-edge lights;
- red wrong-way / false-route marks;
- eight checkpoint gates and The Cradle finish;
- HUD direction, urgency, gate state and distance remaining.

Do not reintroduce bare standalone `3`, `2`, or `1` signs. The authored duplicate
distance faces are now hidden and the Cradle lap-board numeral has been removed,
leaving its dark plate and header bar as an industrial fixture. Keep that hierarchy.
The route opening must read at least 1.5 seconds ahead, and The Cradle must read
as the finish from 300 m without relying on HUD text.

## What to design in this phase

Create a bounded visual-identity proposal, not an unlimited asset wish list.
Choose at most twelve environment upgrades and rank the six that would produce
the largest on-track improvement. Every proposed detail must serve at least one
of these jobs: navigation, sense of speed, hazard telegraph, sector identity,
scale, or atmosphere.

Cover three levels deliberately:

1. Macro silhouettes — the landmark or skyline forms that identify a sector at
   150–400 m.
2. Mid-frequency race framing — walls, gantries, pipes, drainage ribs, foliage
   masses and light cadence that shape the next 1.5 seconds of route.
3. Sparse close detail — decals, grime, cable runs, moss seams and repair plates
   that reward slower viewing without becoming visual noise at race speed.

Reuse the accepted 44-part kit wherever its silhouette is sufficient. Propose a
new mesh only when scaling, recombining or redressing the current kit cannot
produce the required read. Prefer sector-specific arrangements over a larger
generic prop library.

## Required comparison views

Return eight same-camera 1600 × 900 current/proposed pairs:

1. The Cradle launch;
2. Water Table approach;
3. Hangar Six mouth;
4. Hangar interior / crane apex;
5. Greenwater Sweep at racing speed;
6. Canopy Passage;
7. Fuel Row toward Totem Turn;
8. Home straight with The Cradle finish visible.

Use the real chase-camera height, FOV and fog depth. Proposed frames may be
procedurally staged concept renders, but label any geometry, texture or lighting
that does not yet exist. Do not present framing diagrams as finished art.

For each proposed frame also provide:

- an unlit silhouette/value pass;
- a route-read overlay showing the predicted path opening 1.5 seconds ahead;
- the dominant landmark and navigation cue;
- the music state and intended visual energy;
- the new or reused kit roots visible in frame.

## Material and lighting lock

Provide one compact material sheet covering damp concrete, repaired dark metal,
oxide, jungle cutout, shallow water and emissive service hardware. State the
intended vertex-colour contribution and show the result at nearest-neighbour
texture sampling. Preserve the existing six-material runtime structure unless
you can prove a seventh material is worth its draw-call cost.

Provide a sector lighting/fog matrix with exact colours, intensity relationships
and transition distances. Build on the current runtime's direction:

- pale acid-lit runway;
- cold shell plus oxide rim in Hangar Six;
- humid green Sweep and Canopy;
- sodium/oxide Fuel Row;
- cool acid return at The Cradle.

Lighting must clarify silhouettes and route edges. Avoid bloom-dependent reads,
full-scene colour filters and abrupt palette cuts. Transitions should feel like
moving through weather and infrastructure, not changing levels.

## PS2 / Y2K guardrails

- Keep geometry chunky and silhouettes intentional.
- Use low-resolution authored texture character, limited values and imperfect
  registration rather than photoreal noise.
- Keep emissive accents sparse enough that amber, acid and red retain gameplay meaning.
- Avoid generic neon cyberpunk, vaporwave decoration, holographic billboards,
  luxury vehicle language, clean white sci-fi, excessive bloom and mirror water.
- Do not imitate another anti-gravity racing franchise's logos, typography or motifs.
- Do not solve uniqueness by covering every surface in decals.

## Runtime constraints for the later production pass

The accepted environment currently contains 63 runtime meshes, 55,488 total
triangles, six materials and six textures. Preserve the established limits:

- no more than 24 worst-case visible environment draw calls;
- no more than 175,000 worst-case visible environment triangles;
- indexed geometry, normals, UV0 and vertex colours on every primitive;
- no skins, animation, morph targets or runtime lights in the GLB;
- existing cull-distance, naming and sector/material merge conventions;
- the procedural course remains the sole gameplay authority.

This phase must estimate the cost of every proposed upgrade, but it must not
export a replacement GLB or alter the accepted package.

## Delivery

Package the direction lock as `GREENWATER_VISUAL_IDENTITY_LOCK_v1.2.zip` with:

- `GREENWATER_VISUAL_IDENTITY_LOCK.md`;
- the eight current/proposed render pairs and eight value/read overlays;
- `GW_VISUAL_UPGRADE_PLAN.json` listing all proposed upgrades, ranking, sector,
  reused/new roots, estimated triangles, materials and cull range;
- `GW_LIGHTING_FOG_LOCK.json`;
- one material-treatment sheet;
- a manifest with exact byte sizes and SHA-256 values.

End with one explicit recommendation for the six upgrades that should enter the
next production package. Stop there and wait for approval. Do not freeze a v1.2
runtime, atlas or placement patch until we accept this visual lock.
