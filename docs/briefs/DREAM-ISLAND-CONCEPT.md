# Dream Island — Map 07 concept (parked until Ascension Pad ships)

Status 2026-09-09: **SUPERSEDED as the working document by `DREAM-ISLAND-LEVEL.md`**, the full build brief. This file is kept as the origin record: the TikTok references, the mood, and the first feasibility test. The route table, schedule, budgets and asset list in the brief take precedence over the sketch below wherever they differ.

Status 2026-09-06 (original): CONCEPT ONLY. Not a build brief yet. Written after a 3-credit Higgsfield feasibility test; the frames are in `art/references/dreamisland-test/` (see its README for prompts and costs).

## Reference

Two TikTok clips by "saveroom" (Y2K 3D screensaver look, early-2000s aquarium / island screensavers):
- **World Next** (day): dazzling white sand, ultra-saturated cobalt sea with a cyan foam line, hard blue sky with small puffy clouds, low-poly palms with big flat frond planes overhanging the camera, a round dry-stone watchtower ruin on a rocky point, mossy dark-green rock walls.
- **Time Pocket Zero** (night): black starfield, impossible glowing electric-blue waterfalls over mossy stone blocks, dense foliage with white blossoms, a weathered stone grandfather clock tower rising out of the jungle, and goldfish (orange, white-and-orange, violet) floating through the air.

What makes it read: naive saturated colour, flat vertex-lit shading, bilinear-blurry textures, clean silhouettes, one or two impossible things stated with total confidence (fish in air, glowing water, a clock in a jungle). This is the PS2-memory product principle taken to its cheerful extreme, and it is the first FUTURISMA map that is not industrial. That is the point: a dream level between the machinery maps.

## Concept

**A tropical island raced from day into night.** The lap follows the shore, cuts through the palm grove, tunnels under the watchtower ruin, crosses the waterfall basin on a stone causeway, and comes back along the reef shallows. The landmark is the **clock tower**: its hands ARE the race schedule. When the clock strikes (a scheduled event on the seeded 120 Hz clock, computed from the measured Works lap time L like Ascension's T-0), day crossfades to night in ~12 s: the sky goes to starfield, the waterfalls turn luminous blue, the sea goes black with a cyan foam line, and the goldfish rise out of the basin and drift over the track for the rest of the race.

Racing purpose of the night turn (every effect needs one):
- Night halves fog distance on the Palm Grove and Basin sectors: braking points move.
- The fish are slow moving soft obstacles over the Basin causeway only (never over the main line; they are readable at speed because they are 4-6 m long and glow).
- The waterfall spray on the causeway goes from dry (day) to wet (night): grip 0.85 on the causeway after the strike.
- Two launch strips (Beach Straight, Reef Shallows), one phase bulkhead (the watchtower tunnel). Same Surge / Phase Shield rules as Tideline. No gravity, no tide.

## Route sketch (closed loop, 2,200-2,600 m, 8 ordered gates, 3 laps)

| # | Section | Character | Width |
|---|---|---|---|
| 1 | Beach Straight | start/finish on a sand-and-concrete strip along the surf line, foam on the right | 24 m |
| 2 | Palm Grove | fast esses under overhanging frond cards, sand, blossoms | 22 m |
| 3 | Watchtower Point | climbs the rocky point, tunnels through the base of the round stone tower (phase bulkhead) | 18 m |
| 4 | Basin Causeway | stone causeway across the waterfall pool, falls on the left, clock tower ahead | 20 m |
| 5 | Clock Court | banked right around the clock tower's foot, the face in full view | 24 m |
| 6 | Reef Shallows | flat-out over cyan shallows on a low pier, launch strip, reef towers on the horizon | 26 m |
| 7 | Mossy Cut | tight left-right between mossy rock blocks back to the Beach Straight | 22 m |

Fork: optional. If one is wanted, a short blind cut through the waterfall itself (behind the sheet) that only opens at night when the falls glow (the water reads as a wall by day). Savings measured on the demo controller, as always.

## Higgsfield pipeline for this map (what the test proved)

VERIFIED 2026-09-06 (3 credits, flux_2 pro, 1 cr per image):
- **Hero frames nail the look on the first try.** Both moods came back as convincing PS2/screensaver frames at chase height (`day_beach_hero.png`, `night_clock_hero.png`). The style words that worked: "Y2K 3D screensaver aesthetic (like early-2000s aquarium and island screensavers)", "painted flat-shaded textures, vertex lighting, no PBR, slightly blurry bilinear textures, naive cheerful colours". flux_2 is the hero model for this map.
- **Count-heavy sheets still fail on flux_2**: the 4x4 foliage/fish sheet came back as two mirrored 2x2 quadrants (identical palms left and right; "single frond cards" drawn as whole crowns). Same class as the gantry failure on 2026-09-05. Rule stands: sheets go to `gpt_image_2` (1.5 cr).
- **Two drifts to prompt against**: the night frame drew a wheeled race car (say "hover craft, no wheels" explicitly), and the fish rendered semi-photoreal next to flat-shaded foliage (say "flat-shaded low-poly goldfish, 200 triangles, painted eye").

Plan per asset class:
- **Heroes (flux_2, 1 cr each):** clock tower, watchtower ruin, waterfall + stone blocks, palm grove at chase height, reef shallows pier, mossy cut. About 6 credits.
- **Sheets (gpt_image_2, 1.5 cr each):** palm frond cards (single fronds, 8 bends), palm trunks, bush/fern/blossom cards, goldfish (4 liveries, side + 3/4), stone block faces (mossy, dry, wet), clock face + hands. About 9 credits.
- **Maquettes (tripo_h3_1_image_to_3d, 9 cr each, texture on, pbr off, face_limit 20000):** clock tower and watchtower only, from the hero frames. Silhouette reference, rebuilt low-poly in Blender on the painted atlases. Never shipped. 18 credits.
- **Not generated:** sand, sea, waterfall, sky. Sand and sea are shaders (the day frame's checker sea is exactly the "flat sea plane" that failed on Tideline; the shallows need a proper foam-line + caustic shader, the deep sea a two-tone vertex-lit swell). The waterfall is animated UV cards. Skies are two hand-painted 4096x1024 panoramas (day, night) plus a crossfade, with the per-column luma profile check from the Tideline v4 review before acceptance.
- Estimated total 33 of the 72 credits on the account (starter plan).

## Risks (carry into the build brief)

- **Water is the whole map.** Tideline's verdict was "water + air feel forced". This map has sea on both sides of half the lap. The shallows shader needs its own eyeball gate before any other art lands.
- **Foliage cards through the atlas-row scar**: every card cell gets a rendered-pixel check against the sheet (P20.8 rule).
- **Two lighting states = two skies + two lighting profiles + fog change.** Every gameplay object renders through the shared lighting/fog/tonemap (render rule); the fish glow must be an emissive term, not `toneMapped:false`.
- **Draw budget**: fronds as alpha cards over the road are overdraw; reserve headroom per phase (≤110 draws after art so events keep 35).
- **Product rule tension**: PRODUCT.md says "humid organic space against repaired aerospace machinery". This map has no machinery. Proposal: the race strip itself is the machinery (concrete kerbs, launch strips, the pier), and the clock is a machine. Needs the user's yes before the brief is written.
- The night frame's fish read like a 2010s render; the target is the naive screensaver fish. Prompt fix above, verify on the sheet.

## Open decisions for the user

1. Name. Working title "Dream Island"; candidates: Clockfall, Saveroom Shallows (too close to the source), Time Pocket (same).
2. Day-into-night as a scheduled event (recommended: it is the race's story, like T-0) vs two fixed editions (`?edition=night`).
3. Fish as soft obstacles (recommended, Basin only) vs pure ambience.
4. Whether a fork is wanted at all.
