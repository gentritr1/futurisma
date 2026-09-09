# Dream Island (Map 07) — art kit

Generated 2026-09-09 on Higgsfield. **14.5 credits** across two rounds (balance 72.48 → 57.98, starter plan): 11 heroes at 1.0 and 7 sheets at 0.5. Every image below was opened and eyeballed before it was written down; the verdict column is an observation, not an inference.

Build brief: `docs/briefs/DREAM-ISLAND-LEVEL.md`. Concept: `docs/briefs/DREAM-ISLAND-CONCEPT.md`. Earlier 3-credit feasibility test: `art/references/dreamisland-test/`.

## Measured model costs (supersedes the remembered 1.5 cr figure)

| Model | Config | Cost | Use |
|---|---|---|---|
| `flux_2` | 16:9, pro default | **1.0 cr** | heroes / mood frames |
| `gpt_image_2` | 1:1, resolution `1k`, quality `low` (server defaults) | **0.5 cr** | count-heavy sheets and ortho model sheets |

8 heroes × 1.0 + 7 sheets × 0.5 = 11.5, matching the balance delta exactly. `gpt_image_2` was submitted without `resolution`/`quality`; the server logged `1k` / `low` as defaults. Quality was more than sufficient for reference — do not pay for `high` on sheets without a reason.

## Heroes — `heroes/`, flux_2, 1280×720

| File | Section | Verdict |
|---|---|---|
| `01_beach_straight_day.png` | 1 Beach Straight | **KEEP.** Kerbed strip along the surf, cyan foam band, watchtower on the point ahead, low-poly palms. The sea is a flat plane with a painted caustic band — the exact Tideline failure mode; treat as composition reference only, not as a water target. |
| `02_palm_grove_day.png` | 2 Palm Grove | **KEEP.** Best foliage frame: overhanging fronds, dappled road shadows, blossom verges, kerb reads clearly at speed. |
| `03_watchtower_point_day.png` | 3 Watchtower Point | **KEEP — hero of the map.** The arched tunnel pierces the tower base with daylight at the far end; this is the phase-bulkhead moment, drawn exactly as specified. Paved road, mossy headland, sea below. |
| `04_basin_causeway_night.png` | 4 Basin Causeway | **KEEP as mood.** Glowing falls, mossy blocks, blossoms, starfield, fish in air. Two drifts: the clock tower reads as a small lantern-scale structure rather than a 14 m landmark, and the fish are glossy/semi-photoreal. Use `s4` and `s5` for the actual models. |
| `05_clock_court_night.png` | 5 Clock Court | **WEAKEST — mood only.** Banked road and pool are right, but the tower reads as a garden clock and the craft has visible wheels. Do not use for tower proportion; `s5` supersedes it. |
| `06_reef_shallows_day.png` | 6 Reef Shallows | **KEEP.** Excellent: coral visible through turquoise shallows, the reef drop-off foam line, sea stacks on the horizon, real sense of speed. This frame is the shallows-shader target. |
| `07_mossy_cut_day.png` | 7 Mossy Cut | **KEEP.** Mossy block walls, ferns and blossoms in the joints, beach and sea framed in the gap ahead. Good readable chicane. |
| `08_the_strike.png` | the scheduled event | **KEEP — key art.** A single frame split day/night: blue sky and clouds on the left, starfield on the right, the waterfall half white and half igniting blue, sea turning black behind a cyan foam line, and — unlike every earlier attempt — genuinely **flat-shaded faceted goldfish**. This is the visual target for the transition and for the fish. |

### Day/night pair frames (added in the same session, +3 cr)

The single most useful part of the kit for building the crossfade: the same section rendered in both lighting states.

| File | Pairs with | Verdict |
|---|---|---|
| `01n_beach_straight_night.png` | `01_beach_straight_day.png` | **KEEP — the night-state target.** Foam line glows cyan along the sand, palms drop to silhouettes with rim-lit fronds, the watchtower tunnel mouth glows as a lit beacon down the straight, fish perfectly faceted. |
| `06n_reef_shallows_night.png` | `06_reef_shallows_day.png` | **KEEP — the night-state target.** The shallows light from *within*, so the two glowing bands define both edges of the pier and the deep water beyond goes black. |
| `05d_clock_court_day.png` | `05_clock_court_night.png` | **KEEP, supersedes `05`.** The tower is finally at landmark scale with a spiral stair, mossy block cliff and an ordinary white waterfall. One drift: the clock face came back with a single hand. |

**Why these three matter beyond mood:** together they show the night turn is a *readability trade*, not a filter — the driver loses long-range reference (fog closes, mid-distance darkens) and gains edge-proximate reference (glowing foam, glowing shallows, lit tunnel). That is the racing purpose the night state is justified by in `docs/briefs/DREAM-ISLAND-LEVEL.md` §2.

Craft caveat: prompts said "no wheels" and several frames still drew wheels or wheel pods. The craft in these frames is **not** reference for TOTEM — ignore it everywhere.

## Sheets — `sheets/`, gpt_image_2, 1024×1024

| File | Contents | Verdict |
|---|---|---|
| `s1_palm_fronds.png` | 4×4 = 16 distinct single fronds, isolated on flat grey | **KEEP.** Counts held, no mirrored duplicates, no whole trees. Alpha-card source. Rendered slightly photoreal — posterise to the flat palette before atlasing. |
| `s2_palm_trees.png` | 3×3 = 9 whole palms, varied lean and crown count, 3 with coconuts | **KEEP.** Silhouette library for the grove; use for trunk-bend variety. |
| `s3_undergrowth.png` | 4×4 = 16, rows: broadleaf / fern / blossom shrub / grass | **KEEP.** Exactly the four authored rows, all sixteen distinct. |
| `s4_goldfish.png` | 4 liveries × 3 views (side, three-quarter, top) | **KEEP — best sheet.** Genuinely flat-shaded low-poly with a painted round eye, and the top-down row is present, which is what the drifting-overhead fish actually need. The 2026-09-06 photoreal-fish drift is fixed. |
| `s5_clock_tower_ortho.png` | front / right side / back / top-down plan of the clock tower | **KEEP — build directly from this.** Four aligned views at one scale: stepped plinth, square mossy shaft, white clock face with plain hands and no numerals, winding side stair, pitched roof with finial. |
| `s6_watchtower_ortho.png` | front / right side / back / top-down plan of the watchtower ruin | **KEEP — build directly from this.** Tapered drum, crenellations with missing merlons, arch windows, and the **through-tunnel visible in both front and back elevations** — the geometry the route actually needs. |
| `s7_stone_materials.png` | 3×2 = 6 flat-on stone swatches (dry, mossy, wet/dark, cracked, blossomed, volcanic) | **KEEP with a caveat.** The "orthographic, camera exactly perpendicular, zero vanishing point" wording **beat the perspective failure** that killed the 2026-09-03 ground tiles — these are true flat-on swatches. They are photoreal-leaning and not yet tileable; posterise, tone-match to the flat palette and verify seam wrap before use. |

## Prompt rules that produced these (reuse verbatim)

- Style anchor: *"Early-2000s PS2-era real-time game look with a Y2K 3D screensaver feel: painted flat-shaded textures, vertex lighting, no PBR, no bloom, slightly blurry bilinear textures, naive saturated colours, low-poly geometry with visible flat facets, clean readable silhouettes."*
- Sheets: state the grid **and** the total in words ("a 4 by 4 grid of SIXTEEN DIFFERENT…"), say "each isolated in its own cell with clear empty grey space around it", and add "no cell repeated, no mirrored duplicates". This is what fixed the mirrored-quadrant failure of 2026-09-06.
- Ortho model sheets: name all four views and their positions explicitly, plus "all four at exactly the same scale", "no ground plane", "no dimension lines, no arrows", "no text, no labels, no numerals".
- Flat-on materials: *"camera pointing exactly perpendicular at the surface, absolutely zero perspective and no vanishing point"* — this is the phrasing that beat the horizon-view ground-tile failure.
- Always append: "No text, no letters, no logos, no HUD, no watermark."
- Still-unfixed drift: "hover craft with NO wheels" is ignored roughly half the time by flux_2.

## Known gaps (not generated)

Sea, shallows, waterfall, sand and both sky panoramas are **deliberately absent**: they are shader and hand-painted-panorama work, and a generated flat sea plane is the exact thing the user rejected on Tideline. No 3D maquettes were lifted (Tripo, 9 cr each) — `s5` and `s6` are better modelling references than a normalised 15 k-tri lift would be.
