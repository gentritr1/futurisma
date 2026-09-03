#!/usr/bin/env python3
"""One-shot editor that inserted the P20.4 round-2 pins into the validator.
Kept with the harness so the insertion point is recoverable, not because it is
run again."""
import io

PATH = "scripts/validate-living-world.mjs"
ANCHOR = """/**
 * P20.4 - `upright` is opt-in and stays opt-in."""

BLOCK = '''/**
 * P20.4 ROUND 2 — THE NEAR CARDS READ AS DUST, NOT AS CRUST.
 *
 * Round 1 shipped these four zones tinted at the crust's own colour
 * (PAN_SCUD_NEAR 0xe6dcc4, PAN_SCUD_CROSSING 0xe2d8bf, SALT_DEVIL_ROAD
 * 0xded5bd, BRINE_HAZE_LOW 0xd9e0dc, Rec.709 luma 220 / 216 / 213 / 223) and
 * its own honest read was that the cards are placed and moving correctly and
 * are INVISIBLE in a still frame. A card tinted at the colour it is drawn over
 * has no luminance to contribute in either direction, whatever its alpha.
 *
 * Vertex colour is a LINEAR multiplier applied before AgX and before the alpha
 * blend (living-world.ts writes `(tint >> 16 & 255) / 255` straight into the
 * colour attribute with no sRGB decode), so the tint is not a colour the card
 * is drawn IN — it is a gain on the cell. The near crust renders at 78-102
 * display luma over the four pan stations, and the three DUST zones have to
 * land under that: the round-2 taste call, in the reviewer's words, is that
 * near cards read as dust — darker and warmer than the crust, never lighter.
 *
 * Asserted here rather than left to the digests, because a digest tells the
 * next phase that something moved and this tells it what may not:
 *   - the three dust zones stay at or under DUST_TINT_LUMA_CEILING;
 *   - the three dust zones stay WARM, red over green over blue, which is the
 *     crust's own hue and the thing that stops "darker" from becoming "grey";
 *   - BRINE_HAZE_LOW is the one zone allowed to be cool (blue at or over red),
 *     because it is the wet basin rather than lifted crust, and it still has to
 *     sit under the round-1 value it replaced.
 */
const DUST_TINT_LUMA_CEILING = 80;
const BRINE_TINT_LUMA_CEILING = 200;
const P20_DUST_ZONES = ["PAN_SCUD_NEAR", "PAN_SCUD_CROSSING", "SALT_DEVIL_ROAD"];
const P20_ROUND_ONE_TINTS = {
  PAN_SCUD_NEAR: 0xe6dcc4,
  PAN_SCUD_CROSSING: 0xe2d8bf,
  SALT_DEVIL_ROAD: 0xded5bd,
  BRINE_HAZE_LOW: 0xd9e0dc,
};
for (const [zoneId, roundOne] of Object.entries(P20_ROUND_ONE_TINTS)) {
  const cards = built.bitterpan.batches
    .flatMap((batch) => batch.cards)
    .filter((card) => card.motionId === zoneId);
  assert.ok(cards.length > 0, `${zoneId} authored no cards to tint.`);
  for (const card of cards) {
    const luma = rec709(card.tint);
    const red = (card.tint >> 16) & 0xff;
    const green = (card.tint >> 8) & 0xff;
    const blue = card.tint & 0xff;
    assert.ok(
      luma < rec709(roundOne),
      `${zoneId} is tinted at luma ${luma.toFixed(1)}; round 1 shipped `
        + `${rec709(roundOne).toFixed(1)} and was rejected for having no `
        + "luminance contrast against the crust. It may not go back up.",
    );
    if (P20_DUST_ZONES.includes(zoneId)) {
      assert.ok(
        luma <= DUST_TINT_LUMA_CEILING,
        `${zoneId} is tinted at luma ${luma.toFixed(1)}, over the `
          + `${DUST_TINT_LUMA_CEILING} ceiling. The near crust renders at `
          + "78-102 display luma and this is a linear gain on the cell, so a "
          + "dust card tinted above the ceiling reads as haze on the crust "
          + "rather than as dust in front of it.",
      );
      assert.ok(
        red > green && green > blue,
        `${zoneId} is tinted (${red}, ${green}, ${blue}); lifted salt crust is `
          + "warm — red over green over blue — and a neutral dark card reads as "
          + "a smudge on the lens rather than as air.",
      );
    } else {
      assert.ok(
        blue >= red && luma <= BRINE_TINT_LUMA_CEILING,
        `${zoneId} is tinted (${red}, ${green}, ${blue}) at luma `
          + `${luma.toFixed(1)}; the wet basin is the one zone allowed to be `
          + "cooler than the crust, and it still has to sit under "
          + `${BRINE_TINT_LUMA_CEILING}.`,
      );
    }
  }
}

/**
 * P20.4 ROUND 2 — THE TWO-TIER ALPHA, AND THE PLACEMENT IT DEPENDS ON.
 *
 * The 0.35 corridor cap is a rule about cards the craft flies THROUGH. Round 1
 * applied it to the whole near zone, which cost the outboard cards a factor of
 * two in density for nothing: measured on greenwater_motion_512, the MIST cell
 * averages 0.167 alpha, so a card at 0.34 vertex alpha averages 5.7% opacity —
 * under the 10-luma census threshold at every station.
 *
 * So PAN_SCUD_NEAR is two tiers, split on the same number the corridor rule
 * reads: inner cards at lateral 2.0-5.6 m stay on `rise` (0.34), shoulder cards
 * at 6.2-8.0 m ride `scudShoulder` (0.62). This asserts both halves — the
 * placement envelope the round-2 brief specifies, and that no card outside the
 * corridor exceeds 0.62 while no card inside it exceeds 0.35.
 */
const NEAR_ALPHA_CEILING_OUTSIDE = 0.62;
const P20_NEAR_ZONES = [...P20_DUST_ZONES, "BRINE_HAZE_LOW"];
const scudNear = built.bitterpan.batches
  .flatMap((batch) => batch.cards)
  .filter((card) => card.motionId === "PAN_SCUD_NEAR");
assert.equal(scudNear.length, 34, "PAN_SCUD_NEAR is 34 cards.");
for (const card of scudNear) {
  assert.ok(
    card.width >= 8 && card.width <= 18,
    `PAN_SCUD_NEAR authors a ${card.width.toFixed(1)} m card; the near band is `
      + "8-18 m wide.",
  );
  assert.ok(
    card.height >= 1.6 && card.height <= 3.4,
    `PAN_SCUD_NEAR authors a ${card.height.toFixed(1)} m card; the near band is `
      + "1.6-3.4 m tall.",
  );
  assert.ok(
    card.base >= 0.1 && card.base <= 1.0,
    `PAN_SCUD_NEAR bases a card at ${card.base.toFixed(2)} m; the near band `
      + "sits at 0.1-1.0 m.",
  );
}
const scudNearInBand = scudNear.filter(
  (card) => card.lateral >= 2 && card.lateral <= 8,
);
assert.ok(
  scudNearInBand.length >= 25,
  `Only ${scudNearInBand.length} of PAN_SCUD_NEAR's ${scudNear.length} cards sit `
    + "2-8 m outboard of the deck edge; at least 25 have to. Further out and the "
    + "zone is PAN_CRUST_SCUD again, which is the layer the driver never saw.",
);
const shoulderTier = scudNear.filter((card) => card.alphaKind === "scudShoulder");
assert.ok(
  shoulderTier.length >= 12,
  `PAN_SCUD_NEAR has ${shoulderTier.length} shoulder-tier cards; the tier that `
    + "carries the density is what makes the zone visible and it may not be "
    + "emptied by a re-author.",
);
assert.deepEqual(
  [...new Set(shoulderTier.map((card) => card.side))].sort(),
  [-1, 1],
  "PAN_SCUD_NEAR puts its whole shoulder tier on one side of the road. `side` "
    + "is `index % 2`, so a tier keyed off the same parity lands entirely on "
    + "one shoulder — the tier key has to be a different parity.",
);
for (const card of built.bitterpan.batches
  .filter((batch) => !batch.spec.lamps)
  .flatMap((batch) => batch.cards)) {
  if (!P20_NEAR_ZONES.includes(card.motionId)) continue;
  const reach = reachableLateral(card);
  if (reach <= CORRIDOR_LATERAL_METRES && card.base < CORRIDOR_HEIGHT_METRES) {
    continue; // covered by the corridor rule below, at the tighter 0.35.
  }
  assert.ok(
    peakAlpha(card) <= NEAR_ALPHA_CEILING_OUTSIDE,
    `BITTERPAN/${card.motionId} peaks at alpha ${peakAlpha(card).toFixed(2)} at `
      + `lateral reach ${reach.toFixed(2)} m. Outboard of the corridor a near `
      + `card may go to ${NEAR_ALPHA_CEILING_OUTSIDE}; past that it stops being `
      + "air over the pan and becomes weather over the track.",
  );
}

/**
 * P20.4 ROUND 2 — `forceSinglePass` on every living-world material.
 *
 * A transparent DoubleSide material is drawn twice by three.js, back faces then
 * front, so that a folded transparent surface sorts against itself. Measured on
 * the pinned station set, the seven Bitterpan batches cost 14 of
 * `renderer.info.render.calls` at every one of the thirteen stations (64 live
 * minus 50 with `?living=0` at station 150), and 7 after this flag.
 *
 * Every card is a flat quad with `depthWrite: false`; it has no self-sorting to
 * do. DoubleSide stays — the ring and the crossing scud are both seen from
 * behind — and only the duplicate pass goes. Asserted in the source because
 * there is no other place it can be caught: dropping it costs seven draw calls
 * a frame and changes not one pixel.
 */
const livingWorldSource = readFileSync(
  new URL("../src/game/living-world.ts", import.meta.url),
  "utf8",
);
assert.ok(
  /forceSinglePass:\\s*true/.test(livingWorldSource),
  "living-world.ts no longer sets `forceSinglePass: true`, so every one of the "
    + "seven transparent DoubleSide batches is drawn in two passes again — 14 "
    + "draw calls for 7 batches, with no visible difference to show for it.",
);
assert.ok(
  /side:\\s*THREE\\.DoubleSide/.test(livingWorldSource),
  "living-world.ts no longer sets DoubleSide. `forceSinglePass` is not a "
    + "substitute for it: cards are seen from behind at every station.",
);

'''


def main():
    with io.open(PATH, encoding="utf8") as fh:
        source = fh.read()
    assert ANCHOR in source, "anchor moved"
    source = source.replace(ANCHOR, BLOCK + ANCHOR, 1)
    with io.open(PATH, "w", encoding="utf8") as fh:
        fh.write(source)
    print("inserted")


if __name__ == "__main__":
    main()
