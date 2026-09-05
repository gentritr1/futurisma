# Blastworks — art starting kit (generated 2026-09-05, Higgsfield)

Use these as the starting point. Do not treat them as final art; every asset is still rebuilt low-poly on the six painted atlases.

| File | Made with | Use |
|---|---|---|
| hero-01-rim-countdown.png | FLUX.2 pro | Mood: rim road, countdown board 00:42, crusher and stockpiles, sun through dust. Palette and kerb/road language reference. |
| hero-02-hairpin-blast.png | FLUX.2 pro | Mood: spiral hairpin under the conveyor bridge, a blast firing on the pit floor (dust wall, debris), board at 00:00. Reference for the blast event look. |
| hero-03-pit-fork.png | FLUX.2 pro | Mood: pit-floor fork, PASS OPEN sign, loader by the rubble, siren mast, crusher on the right. Reference for the fork signage and the drained-pass rubble. |
| countdown-board-ortho-gptimage2.png | GPT Image 2 | Focal asset sheet: 6 x 5 x 1.2 m board, two lattice legs, 4-digit red timer, amber SECTOR panel, beacon, siren horn, hazard band, repair plate, stencil 27. Counts verified. |
| crusher-ortho-gptimage2.png | GPT Image 2 | Focal asset sheet: 30 x 24 x 16 m crusher plant, hopper tower, one inclined conveyor, two sheds, three floodlight heads on one mast, ladder, plate, stencil 07. Counts verified. Preferred over the FLUX sheet. |
| crusher-ortho-flux2.png | FLUX.2 pro | Alternate crusher sheet; wear reads well, top view has a perspective mast. Use for paint reference only. |
| crusher-maquette-tripo.glb | Tripo H3.1 from the FLUX front view | Proportion maquette: 15.6k tris, one baked texture, normalised to 1 m. Import beside the sheet planes, scale to 24 m tall, lock silhouette against it, then model low-poly. Never ship it. |

## Model routing rule (measured on the Tidal Pump Gantry, same prompt to both)
- Count-heavy orthographic sheets: **GPT Image 2** (matched every count). FLUX.2 failed the complex sheet.
- Hero / mood frames and simple props: **FLUX.2 pro** (stronger painted early-2000s look, 1 credit).
- Proportion maquette: **Tripo H3.1 image-to-3D** from the front view (9 credits). SAM 3 (1 credit) only works on a hero frame with the object named, and returns a diorama with the ground attached.

## What is still missing before modelling
- Hero view at chase height for each focal asset (generate with FLUX.2, same asset description as the sheet).
- Material-ID pass per asset (GPT Image 2 from the accepted sheet, six flat colours).
- Sheets for: conveyor bridge span, floodlight mast, siren mast with beacon, PASS OPEN sign, haul truck (static prop), loader (static prop).
