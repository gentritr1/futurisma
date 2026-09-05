# Tideline V4 — independent fog-distance visual review

I inspected all 24 PNGs in this folder: specimens 0–7 at the labeled 45, 100, and 180 m distances. I accessed no source, code, JSON, or test results. The common gantry, camera, and lighting arrangement were supplied as context; I judged the visible images only.

**Result: no blanket acceptance.** Several specimens look compatible with the gantry's warm scene response, but small image size prevents a reliable judgment for others. Two comparisons contain conspicuous foreground geometry that makes their nominal distance difficult to interpret. Specimen 6 is the strongest visual outlier.

| Specimen | Visible assessment |
| --- | --- |
| 0 | The small rectangular hanging-device frame shares the warm brown scene cast at all three distances. Its visibility reduces with distance, and I see no conspicuous pasted outline or saturated element detached from the scene. The hanging device itself is too small to judge in detail at 100/180 m. |
| 1 | The small object is already tiny at 45 m and nearly a speck at 100/180 m. Its overall color does not visibly clash, but these images cannot support an independent judgment of its material, fog, or tone response. Unjudgeable at the two farther distances. |
| 2 | The same limitation applies: a tiny object at 45 m, effectively a few pixels at 100/180 m. There is no obvious bright outlier, but I cannot responsibly convert that into a material/fog pass. |
| 3 | The shallow ground strips and pale marks look warm and subdued at 45 m and become faint at greater distances. There is no conspicuous overlay appearance in the visible portions. Their near-edge-on presentation and small size at 100/180 m limit the conclusion. |
| 4 | The narrow dark strip is subdued at 45 m, but `4-100.png` also contains a much larger strip extending diagonally into the lower-right foreground, separated from the small distant portion beside the gantry. At 180 m only small fragments remain visible. This is not a clean comparison of an entire specimen at one distance. The foreground strip's hard dark outline stands out, but apparent proximity and layout could explain it; a fog bypass is not established. |
| 5 | The oval mechanical ring has warm highlights and dark surfaces consistent with the reference scene. It becomes small and subdued at 100/180 m without an obvious detached bright halo or pasted-color appearance. This is one of the more usable comparisons. |
| 6 | The two pale vertical posts remain nearly flat white/cream against the brown scene, with far less visible surface shading than the gantry. In `6-180.png`, additional much larger pale posts appear in the foreground while the small distant pair remains beside the gantry. These posts are the strongest visual outlier. They could be intentionally illuminated markers, but the stills do not establish whether the weak visible shading/tint is intentional or whether they bypass part of the scene response. The extra foreground pair also prevents treating the whole image as a single 180 m specimen. |
| 7 | The small pale lattice/dome is compatible with the warm scene at 45 m and becomes faint at 100/180 m. Its appearance could reasonably be an illuminated effect, but it is too small at the farther distances to verify the detailed fog/tone relationship. No conspicuous pasted halo is visible. |

The images show objects getting smaller and less apparent with distance. Shrinkage and rasterization also cause that effect, so disappearance alone does not demonstrate correct fog attenuation. I cannot verify implementation behavior from these images, and none was inferred from a test.

For a conclusive visual acceptance, the tiny specimens need an additional view with enough projected size to inspect their surfaces, while preserving a meaningful depth comparison. Specimens 4 and 6 need the foreground portions distinguished from the nominally distant specimen. Specimen 6 also needs a clear visual basis for judging its intentional illumination against the scene. Until then, the honest result is compatible appearance for the clearly visible hardware, with specific unresolved evidence and appearance qualifications above.

Only this review file was written. No implementation or other evidence was changed.
